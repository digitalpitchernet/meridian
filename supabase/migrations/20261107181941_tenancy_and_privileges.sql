-- =====================================================================================
-- Meridian V1 · Gate 1 · Migration 1/6: privilege baseline, tenancy, activity ledger
-- Forward-only. Every table created here gets RLS, policies and grants in this file.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 1. Fail-closed privilege baseline for every object postgres creates in public.
--    Supabase defaults grant anon/authenticated ALL on new tables and EXECUTE on new
--    functions; Meridian grants explicitly per object instead. service_role keeps its
--    defaults (trusted server key) except where revoked per table below.
-- -------------------------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated, PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated, PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated, PUBLIC;

-- -------------------------------------------------------------------------------------
-- 2. Shared helpers
-- -------------------------------------------------------------------------------------
CREATE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END $$;

CREATE FUNCTION public.reject_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION '% on % is not permitted: % history is append-only', TG_OP, TG_TABLE_NAME, TG_TABLE_NAME
        USING ERRCODE = 'insufficient_privilege';
END $$;

-- -------------------------------------------------------------------------------------
-- 3. businesses (tenant root). Created only through create_workspace().
-- -------------------------------------------------------------------------------------
CREATE TABLE public.businesses (
    id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_name               text NOT NULL CHECK (char_length(btrim(business_name)) BETWEEN 1 AND 200),
    legal_entity_name           text,
    industry                    text,
    base_currency               char(3) NOT NULL CHECK (base_currency ~ '^[A-Z]{3}$'),
    locale                      text NOT NULL CHECK (locale ~ '^[a-z]{2,3}(-[A-Z]{2})?$'),
    timezone                    text NOT NULL CHECK (char_length(timezone) BETWEEN 2 AND 64),
    financial_year_start_month  smallint NOT NULL DEFAULT 4 CHECK (financial_year_start_month BETWEEN 1 AND 12),
    accent_color                text NOT NULL DEFAULT '#3B82F6' CHECK (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
    logo_storage_key            text,
    created_by_user_id          uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE RESTRICT,
    created_at                  timestamptz NOT NULL DEFAULT now(),
    updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION public.guard_business_identity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.base_currency IS DISTINCT FROM OLD.base_currency THEN
        RAISE EXCEPTION 'base_currency is fixed at onboarding and cannot change' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id OR NEW.id IS DISTINCT FROM OLD.id THEN
        RAISE EXCEPTION 'business ownership cannot change' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_businesses_identity BEFORE UPDATE ON public.businesses
    FOR EACH ROW EXECUTE FUNCTION public.guard_business_identity();
CREATE TRIGGER trg_businesses_updated_at BEFORE UPDATE ON public.businesses
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_businesses_no_delete BEFORE DELETE ON public.businesses
    FOR EACH ROW EXECUTE FUNCTION public.reject_mutation();

-- -------------------------------------------------------------------------------------
-- 4. profiles (application login of the founder). Created only through create_workspace().
-- -------------------------------------------------------------------------------------
CREATE TABLE public.profiles (
    id                      uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    business_id             uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    full_name               text NOT NULL CHECK (char_length(btrim(full_name)) BETWEEN 1 AND 200),
    email                   text NOT NULL,
    role_title              text,
    avatar_storage_key      text,
    theme                   text NOT NULL DEFAULT 'dark' CHECK (theme IN ('dark', 'light', 'system')),
    date_format             text NOT NULL DEFAULT 'DD/MM/YYYY' CHECK (date_format IN ('YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY')),
    time_format             text NOT NULL DEFAULT '24h' CHECK (time_format IN ('12h', '24h')),
    week_start_day          text NOT NULL DEFAULT 'Monday' CHECK (week_start_day IN ('Monday', 'Sunday', 'Saturday')),
    number_format           text NOT NULL DEFAULT 'en-IN' CHECK (char_length(number_format) BETWEEN 2 AND 16),
    countdown_preferences   jsonb NOT NULL DEFAULT '{"show_milestone_countdowns": true, "show_runway_days": true}',
    widget_layout           jsonb NOT NULL DEFAULT '{"order": ["kpi", "attention", "projects", "finance", "funding", "schedule", "activity"], "hidden": []}',
    onboarding_completed    boolean NOT NULL DEFAULT false,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_profiles_business UNIQUE (business_id, id)
);

CREATE FUNCTION public.guard_profile_identity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.business_id IS DISTINCT FROM OLD.business_id THEN
        RAISE EXCEPTION 'a profile cannot move to another user or business' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_profiles_identity BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.guard_profile_identity();
CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -------------------------------------------------------------------------------------
-- 5. Tenant resolution. SECURITY DEFINER so it can read profiles under FORCE RLS
--    (owner postgres has BYPASSRLS on Supabase; see spec §Security, prerequisite P-1).
-- -------------------------------------------------------------------------------------
CREATE FUNCTION public.get_current_business_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
    SELECT p.business_id FROM public.profiles p WHERE p.id = auth.uid()
$$;

-- -------------------------------------------------------------------------------------
-- 6. participants (founders, cofounders, investors... business records, not logins)
-- -------------------------------------------------------------------------------------
CREATE TABLE public.participants (
    id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id                 uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    profile_id                  uuid,
    full_name                   text NOT NULL CHECK (char_length(btrim(full_name)) BETWEEN 1 AND 200),
    participant_type            text NOT NULL CHECK (participant_type IN ('founder', 'cofounder', 'investor', 'advisor', 'lender', 'other')),
    designation                 text,
    email                       text,
    phone                       text,
    agreed_equity_percentage    numeric(5,2) NOT NULL DEFAULT 0 CHECK (agreed_equity_percentage BETWEEN 0 AND 100),
    avatar_storage_key          text,
    is_active                   boolean NOT NULL DEFAULT true,
    notes                       text,
    created_at                  timestamptz NOT NULL DEFAULT now(),
    updated_at                  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_participants_business UNIQUE (business_id, id),
    CONSTRAINT fk_participants_profile FOREIGN KEY (business_id, profile_id)
        REFERENCES public.profiles(business_id, id) ON DELETE SET NULL (profile_id)
);

CREATE TRIGGER trg_participants_updated_at BEFORE UPDATE ON public.participants
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -------------------------------------------------------------------------------------
-- 7. activity_records: append-only, written only by server-side triggers and RPCs.
-- -------------------------------------------------------------------------------------
CREATE TABLE public.activity_records (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id     uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    actor_type      text NOT NULL CHECK (actor_type IN ('user', 'system')),
    actor_id        uuid,
    event_type      text NOT NULL,
    entity_table    text NOT NULL,
    entity_id       uuid NOT NULL,
    summary         text NOT NULL,
    metadata        jsonb NOT NULL DEFAULT '{}',
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_activity_business UNIQUE (business_id, id),
    CONSTRAINT fk_activity_actor FOREIGN KEY (business_id, actor_id)
        REFERENCES public.profiles(business_id, id) ON DELETE SET NULL (actor_id),
    CONSTRAINT chk_activity_actor CHECK ((actor_type = 'user') = (actor_id IS NOT NULL))
);

CREATE TRIGGER trg_activity_append_only BEFORE UPDATE OR DELETE ON public.activity_records
    FOR EACH ROW EXECUTE FUNCTION public.reject_mutation();
CREATE TRIGGER trg_activity_no_truncate BEFORE TRUNCATE ON public.activity_records
    FOR EACH STATEMENT EXECUTE FUNCTION public.reject_mutation();

-- Internal writer. Not executable by clients.
CREATE FUNCTION public.log_activity(p_business_id uuid, p_event_type text, p_entity_table text,
                                    p_entity_id uuid, p_summary text, p_metadata jsonb DEFAULT '{}')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor uuid;
BEGIN
    SELECT p.id INTO v_actor FROM public.profiles p WHERE p.id = auth.uid() AND p.business_id = p_business_id;
    INSERT INTO public.activity_records (business_id, actor_type, actor_id, event_type, entity_table, entity_id, summary, metadata)
    VALUES (p_business_id, CASE WHEN v_actor IS NULL THEN 'system' ELSE 'user' END, v_actor,
            p_event_type, p_entity_table, p_entity_id, left(p_summary, 500), COALESCE(p_metadata, '{}'));
END $$;

-- Generic AFTER trigger for domain tables (attached in later migrations).
CREATE FUNCTION public.record_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_row   jsonb := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
    v_label text  := COALESCE(v_row->>'name', v_row->>'title', v_row->>'funder_name', v_row->>'description', v_row->>'filename', '');
BEGIN
    PERFORM public.log_activity(
        (v_row->>'business_id')::uuid,
        TG_TABLE_NAME || '.' || lower(TG_OP),
        TG_TABLE_NAME,
        (v_row->>'id')::uuid,
        initcap(replace(TG_TABLE_NAME, '_', ' ')) || ' ' || lower(TG_OP) || CASE WHEN v_label <> '' THEN ': ' || v_label ELSE '' END,
        jsonb_strip_nulls(jsonb_build_object('status', v_row->>'status', 'amount', v_row->>'amount'))
    );
    RETURN NULL;
END $$;

-- -------------------------------------------------------------------------------------
-- 8a. Installation settings (server-only singleton). V1 = one business per installation.
--     The data model keeps business_id everywhere; the limit lives here so validation
--     environments can raise it to exercise tenant isolation.
-- -------------------------------------------------------------------------------------
CREATE TABLE public.installation_settings (
    singleton       boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    max_workspaces  integer NOT NULL DEFAULT 1 CHECK (max_workspaces >= 1),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.installation_settings DEFAULT VALUES;
ALTER TABLE public.installation_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.installation_settings FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.installation_settings FROM PUBLIC, anon, authenticated;

-- -------------------------------------------------------------------------------------
-- 8b. Onboarding RPC: the only way to create a business and its founder profile.
-- -------------------------------------------------------------------------------------
CREATE FUNCTION public.create_workspace(
    p_business_name text,
    p_base_currency text,
    p_locale text,
    p_timezone text,
    p_full_name text,
    p_financial_year_start_month integer DEFAULT 4
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_email text;
    v_business uuid;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'create_workspace requires a signed-in user' USING ERRCODE = 'insufficient_privilege';
    END IF;
    -- serialise onboarding so two concurrent sign-ups cannot both pass the workspace limit
    LOCK TABLE public.businesses IN SHARE ROW EXCLUSIVE MODE;
    IF EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid)
       OR EXISTS (SELECT 1 FROM public.businesses WHERE created_by_user_id = v_uid) THEN
        RAISE EXCEPTION 'this user already has a workspace' USING ERRCODE = 'unique_violation';
    END IF;
    IF (SELECT count(*) FROM public.businesses) >= (SELECT max_workspaces FROM public.installation_settings) THEN
        RAISE EXCEPTION 'this installation already has its business workspace' USING ERRCODE = 'unique_violation';
    END IF;
    SELECT email INTO v_email FROM auth.users WHERE id = v_uid;

    INSERT INTO public.businesses (business_name, base_currency, locale, timezone, financial_year_start_month, created_by_user_id)
    VALUES (btrim(p_business_name), upper(btrim(p_base_currency)), btrim(p_locale), btrim(p_timezone), p_financial_year_start_month, v_uid)
    RETURNING id INTO v_business;

    INSERT INTO public.profiles (id, business_id, full_name, email)
    VALUES (v_uid, v_business, btrim(p_full_name), COALESCE(v_email, ''));

    INSERT INTO public.participants (business_id, profile_id, full_name, participant_type, email)
    VALUES (v_business, v_uid, btrim(p_full_name), 'founder', v_email);

    PERFORM public.log_activity(v_business, 'businesses.created', 'businesses', v_business, 'Workspace created: ' || btrim(p_business_name));
    RETURN v_business;
END $$;

-- -------------------------------------------------------------------------------------
-- 9. RLS, policies, grants
-- -------------------------------------------------------------------------------------
ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.businesses FORCE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.participants FORCE ROW LEVEL SECURITY;
ALTER TABLE public.activity_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_records FORCE ROW LEVEL SECURITY;

CREATE POLICY businesses_tenant ON public.businesses FOR ALL TO authenticated
    USING (id = public.get_current_business_id()) WITH CHECK (id = public.get_current_business_id());
CREATE POLICY profiles_tenant ON public.profiles FOR ALL TO authenticated
    USING (business_id = public.get_current_business_id()) WITH CHECK (id = auth.uid() AND business_id = public.get_current_business_id());
CREATE POLICY participants_tenant ON public.participants FOR ALL TO authenticated
    USING (business_id = public.get_current_business_id()) WITH CHECK (business_id = public.get_current_business_id());
CREATE POLICY activity_tenant_read ON public.activity_records FOR SELECT TO authenticated
    USING (business_id = public.get_current_business_id());

REVOKE ALL ON public.businesses, public.profiles, public.participants, public.activity_records FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.businesses, public.profiles, public.participants, public.activity_records TO authenticated;
GRANT UPDATE (business_name, legal_entity_name, industry, locale, timezone, financial_year_start_month, accent_color, logo_storage_key)
    ON public.businesses TO authenticated;
GRANT UPDATE (full_name, role_title, avatar_storage_key, theme, date_format, time_format, week_start_day, number_format,
              countdown_preferences, widget_layout, onboarding_completed)
    ON public.profiles TO authenticated;
GRANT INSERT (business_id, profile_id, full_name, participant_type, designation, email, phone, agreed_equity_percentage, avatar_storage_key, is_active, notes),
      UPDATE (profile_id, full_name, participant_type, designation, email, phone, agreed_equity_percentage, avatar_storage_key, is_active, notes),
      DELETE
    ON public.participants TO authenticated;

REVOKE TRUNCATE, DELETE, UPDATE ON public.activity_records FROM service_role;
REVOKE TRUNCATE ON public.businesses, public.profiles FROM service_role;

REVOKE ALL ON FUNCTION public.get_current_business_id(), public.log_activity(uuid, text, text, uuid, text, jsonb),
    public.record_activity(), public.create_workspace(text, text, text, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_current_business_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_workspace(text, text, text, text, text, integer) TO authenticated;

CREATE INDEX idx_activity_business_created ON public.activity_records (business_id, created_at DESC);
CREATE INDEX idx_participants_business ON public.participants (business_id) WHERE is_active;
