-- MER-ENG-SPEC-001 Rev 2.2, Section 6.1 -- transcribed verbatim for disposable validation. Not a production migration.
-- MIGRATION 00001.up.sql: EXTENSIONS, TENANT ROOT, PROFILES, PARTICIPANTS & UPDATED_AT ENGINE

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TABLE public.businesses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_name TEXT NOT NULL CHECK (char_length(trim(business_name)) > 0),
    legal_entity_name TEXT,
    brand_logo_url TEXT,
    brand_icon_url TEXT,
    brand_logo_dark_url TEXT,
    accent_color TEXT NOT NULL DEFAULT '#3B82F6' CHECK (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
    base_currency CHAR(3) NOT NULL CHECK (base_currency ~ '^[A-Z]{3}$'),
    locale TEXT NOT NULL CHECK (char_length(trim(locale)) >= 2),
    timezone TEXT NOT NULL CHECK (char_length(trim(timezone)) >= 2),
    financial_year_start_month SMALLINT NOT NULL DEFAULT 1 CHECK (financial_year_start_month BETWEEN 1 AND 12),
    created_by_user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_businesses_OnlyOneInV1 UNIQUE (created_by_user_id)
);

CREATE TRIGGER trg_businesses_updated_at
BEFORE UPDATE ON public.businesses
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL CHECK (char_length(trim(full_name)) > 0),
    email TEXT NOT NULL,
    avatar_url TEXT,
    phone TEXT,
    role_title TEXT,
    is_primary_founder BOOLEAN NOT NULL DEFAULT TRUE,
    theme TEXT NOT NULL DEFAULT 'dark' CHECK (theme IN ('dark', 'light', 'system')),
    time_format TEXT NOT NULL DEFAULT '24h' CHECK (time_format IN ('12h', '24h')),
    date_format TEXT NOT NULL DEFAULT 'YYYY-MM-DD' CHECK (date_format IN ('YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY')),
    week_start_day TEXT NOT NULL DEFAULT 'Monday' CHECK (week_start_day IN ('Monday', 'Sunday', 'Saturday')),
    countdown_preferences JSONB NOT NULL DEFAULT '{"show_milestone_countdowns":true,"show_runway_days":true}'::jsonb,
    onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE,
    onboarding_step TEXT NOT NULL DEFAULT 'workspace_identity',
    widget_layout JSONB NOT NULL DEFAULT '{"order":["kpi","attention","projects","finance","funding","schedule","activity"],"hidden":[]}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_profiles_business_id UNIQUE (business_id, id)
);

CREATE TRIGGER trg_profiles_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    profile_id UUID,
    full_name TEXT NOT NULL CHECK (char_length(trim(full_name)) > 0),
    participant_type TEXT NOT NULL CHECK (participant_type IN ('founder', 'cofounder', 'investor', 'advisor', 'lender', 'other')),
    role TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    agreed_equity_percentage NUMERIC(5,2) NOT NULL DEFAULT 0.00 CHECK (agreed_equity_percentage BETWEEN 0.00 AND 100.00),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_participants_business_id UNIQUE (business_id, id),
    CONSTRAINT fk_participants_profile FOREIGN KEY (business_id, profile_id)
        REFERENCES public.profiles(business_id, id) ON DELETE SET NULL (profile_id)
);

CREATE TRIGGER trg_participants_updated_at
BEFORE UPDATE ON public.participants
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
