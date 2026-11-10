-- =====================================================================================
-- Financial integrity suite (business A, as founder A unless stated).
-- Expected cash figures are hand-computed in the comments, not derived by the code under test.
--
-- Accounts (all opened 2026-04-01 unless stated)
--   bank1 HDFC 10000 · bank2 ICICI 5000 · cashbox 500 · credit -2000 · escrow 0
--   bank3 opened 2026-09-01 with 1000 · old bank 300 (deactivated)
-- =====================================================================================
SELECT qa.suite('20_financial');

-- -------------------------------------------------------------------------------------
-- Setup (fails loudly into qa.results if anything here is rejected)
-- -------------------------------------------------------------------------------------
DO $$
DECLARE ba uuid := qa.id('biz_a'); v uuid; f uuid := qa.id('part_a_founder'); c uuid := qa.id('part_a_cofounder');
        b1 uuid := qa.id('acct_a_bank1'); b2 uuid := qa.id('acct_a_bank2');
BEGIN
    PERFORM qa.as_user('a');
    INSERT INTO public.financial_accounts (business_id, name, account_type, opening_balance, opening_balance_date) VALUES (ba, 'Petty cash', 'cash', 500, '2026-04-01') RETURNING id INTO v; PERFORM qa.setid('acct_a_cash', v);
    INSERT INTO public.financial_accounts (business_id, name, account_type, opening_balance, opening_balance_date) VALUES (ba, 'Credit line', 'credit', -2000, '2026-04-01') RETURNING id INTO v; PERFORM qa.setid('acct_a_credit', v);
    INSERT INTO public.financial_accounts (business_id, name, account_type, opening_balance, opening_balance_date) VALUES (ba, 'Escrow', 'escrow', 0, '2026-04-01') RETURNING id INTO v; PERFORM qa.setid('acct_a_escrow', v);
    INSERT INTO public.financial_accounts (business_id, name, account_type, opening_balance, opening_balance_date) VALUES (ba, 'Kotak (new)', 'bank', 1000, '2026-09-01') RETURNING id INTO v; PERFORM qa.setid('acct_a_bank3', v);
    INSERT INTO public.financial_accounts (business_id, name, account_type, opening_balance, opening_balance_date) VALUES (ba, 'Old bank', 'bank', 300, '2026-04-01') RETURNING id INTO v; PERFORM qa.setid('acct_a_old', v);
    UPDATE public.financial_accounts SET is_active = false WHERE id = qa.id('acct_a_old');

    INSERT INTO public.funding_requirements (business_id, title, required_amount, needed_by) VALUES (ba, 'Seed round', 30000, '2026-12-31') RETURNING id INTO v; PERFORM qa.setid('req_seed', v);
    INSERT INTO public.funding_commitments (business_id, requirement_id, participant_id, funder_name, committed_amount) VALUES (ba, qa.id('req_seed'), f, 'Asha (founder)', 20000) RETURNING id INTO v; PERFORM qa.setid('c_founder', v);
    INSERT INTO public.funding_commitments (business_id, requirement_id, participant_id, funder_name, committed_amount) VALUES (ba, qa.id('req_seed'), c, 'Chandra (cofounder)', 10000) RETURNING id INTO v; PERFORM qa.setid('c_cofounder', v);
    INSERT INTO public.funding_commitments (business_id, requirement_id, funder_name, committed_amount) VALUES (ba, qa.id('req_seed'), 'Angel fund', 5000) RETURNING id INTO v; PERFORM qa.setid('c_angel', v);

    INSERT INTO public.transactions (business_id, account_id, participant_id, transaction_date, amount, type, contribution_type, description)
        VALUES (ba, b1, f, '2026-05-10', 10000, 'income', 'capital_contribution', 'Founder capital 1') RETURNING id INTO v; PERFORM qa.setid('t1', v);
    INSERT INTO public.transactions (business_id, account_id, participant_id, transaction_date, amount, type, contribution_type, description)
        VALUES (ba, b1, f, '2026-05-20', 10000, 'income', 'capital_contribution', 'Founder capital 2') RETURNING id INTO v; PERFORM qa.setid('t2', v);
    INSERT INTO public.transactions (business_id, account_id, participant_id, transaction_date, amount, type, contribution_type, description)
        VALUES (ba, b2, c, '2026-06-01', 4000, 'income', 'capital_contribution', 'Cofounder capital part') RETURNING id INTO v; PERFORM qa.setid('t3', v);
    INSERT INTO public.transactions (business_id, account_id, participant_id, transaction_date, amount, type, contribution_type, description)
        VALUES (ba, b1, f, '2026-06-05', 1000, 'income', 'capital_contribution', 'Founder top-up') RETURNING id INTO v; PERFORM qa.setid('t4', v);
    INSERT INTO public.transactions (business_id, account_id, transaction_date, amount, type, contribution_type, description)
        VALUES (ba, b2, '2026-06-10', 2500, 'income', 'third_party_grant', 'Startup grant') RETURNING id INTO v; PERFORM qa.setid('t5', v);
    INSERT INTO public.transactions (business_id, account_id, transaction_date, amount, type, description)
        VALUES (ba, b1, '2026-06-12', 3000, 'income', 'Customer invoice 001') RETURNING id INTO v; PERFORM qa.setid('t6', v);
    INSERT INTO public.transactions (business_id, account_id, transaction_date, amount, type, contribution_type, description)
        VALUES (ba, b2, '2026-06-14', 3000, 'income', 'third_party_equity', 'Angel tranche') RETURNING id INTO v; PERFORM qa.setid('t7', v);
    PERFORM qa.as_admin();
    PERFORM qa.record('FIN-SETUP', 'financial fixtures created by founder A through RLS', true, 'ok', 'ok');
EXCEPTION WHEN OTHERS THEN
    PERFORM qa.as_admin();
    PERFORM qa.record('FIN-SETUP', 'financial fixtures created by founder A through RLS', false, 'ok', SQLSTATE || ' ' || SQLERRM);
END $$;

-- -------------------------------------------------------------------------------------
-- Requirement -> commitment -> payment -> reconciliation; partial and multiple payments
-- -------------------------------------------------------------------------------------
DO $$
DECLARE ba uuid := qa.id('biz_a');
BEGIN
    PERFORM qa.as_user('a');
    PERFORM qa.v('FIN-01', 'a pledge is not money: a new commitment shows 0 received', format($q$SELECT status || '/' || received_amount FROM public.vw_funding_commitment_status WHERE commitment_id = %L$q$, qa.id('c_founder')), 'pledged/0.00');
    PERFORM qa.t('FIN-02', 'allocate founder receipt 1 (10000) to founder commitment', format($q$INSERT INTO public.payment_allocations (business_id, commitment_id, transaction_id, amount) VALUES (%L, %L, %L, 10000)$q$, ba, qa.id('c_founder'), qa.id('t1')), 'ok:1');
    PERFORM qa.v('FIN-03', 'one of two payments -> partially_paid, 10000 outstanding', format($q$SELECT status || '/' || outstanding_amount FROM public.vw_funding_commitment_status WHERE commitment_id = %L$q$, qa.id('c_founder')), 'partially_paid/10000.00');
    PERFORM qa.t('FIN-04', 'allocate founder receipt 2 (10000)', format($q$INSERT INTO public.payment_allocations (business_id, commitment_id, transaction_id, amount) VALUES (%L, %L, %L, 10000)$q$, ba, qa.id('c_founder'), qa.id('t2')), 'ok:1');
    PERFORM qa.v('FIN-05', 'multiple payments -> fulfilled', format($q$SELECT status || '/' || received_amount || '/' || outstanding_amount FROM public.vw_funding_commitment_status WHERE commitment_id = %L$q$, qa.id('c_founder')), 'fulfilled/20000.00/0.00');
    PERFORM qa.t('FIN-06', 'cofounder partial payment 4000 of 10000', format($q$INSERT INTO public.payment_allocations (business_id, commitment_id, transaction_id, amount) VALUES (%L, %L, %L, 4000)$q$, ba, qa.id('c_cofounder'), qa.id('t3')), 'ok:1');
    PERFORM qa.v('FIN-07', 'requirement: required/committed/received/outstanding/gap', format($q$SELECT required_amount || '/' || committed_amount || '/' || received_amount || '/' || outstanding_commitments || '/' || uncommitted_gap FROM public.vw_funding_requirement_summary WHERE requirement_id = %L$q$, qa.id('req_seed')),
        '30000.00/35000.00/24000.00/11000.00/0.00');

    -- who may satisfy what
    PERFORM qa.t('FIN-08', 'founder money cannot satisfy the cofounder commitment', format($q$INSERT INTO public.payment_allocations (business_id, commitment_id, transaction_id, amount) VALUES (%L, %L, %L, 1000)$q$, ba, qa.id('c_cofounder'), qa.id('t4')), '23514');
    PERFORM qa.t('FIN-09', 'a payment with no participant cannot satisfy a participant commitment', format($q$INSERT INTO public.payment_allocations (business_id, commitment_id, transaction_id, amount) VALUES (%L, %L, %L, 100)$q$, ba, qa.id('c_cofounder'), qa.id('t5')), '23514');
    PERFORM qa.t('FIN-10', 'customer revenue cannot satisfy a funding commitment', format($q$INSERT INTO public.payment_allocations (business_id, commitment_id, transaction_id, amount) VALUES (%L, %L, %L, 100)$q$, ba, qa.id('c_angel'), qa.id('t6')), '23514');
    PERFORM qa.t('FIN-11', 'third-party grant satisfies the third-party commitment', format($q$INSERT INTO public.payment_allocations (business_id, commitment_id, transaction_id, amount) VALUES (%L, %L, %L, 2500)$q$, ba, qa.id('c_angel'), qa.id('t5')), 'ok:1');
    PERFORM qa.t('FIN-12', 'a transaction cannot be allocated beyond its amount', format($q$INSERT INTO public.payment_allocations (business_id, commitment_id, transaction_id, amount) VALUES (%L, %L, %L, 1)$q$, ba, qa.id('c_angel'), qa.id('t5')), '23514');
    PERFORM qa.t('FIN-13', 'angel tranche 3000 on top of 2500 against 5000 committed', format($q$INSERT INTO public.payment_allocations (business_id, commitment_id, transaction_id, amount) VALUES (%L, %L, %L, 3000)$q$, ba, qa.id('c_angel'), qa.id('t7')), 'ok:1');
    PERFORM qa.v('FIN-14', 'over-commitment is visible, not hidden', format($q$SELECT status || '/' || received_amount || '/' || outstanding_amount FROM public.vw_funding_commitment_status WHERE commitment_id = %L$q$, qa.id('c_angel')), 'over_allocated/5500.00/0.00');
    PERFORM qa.as_admin();
END $$;

-- -------------------------------------------------------------------------------------
-- Reversal cascade, immutability, committed-amount change, revocation
-- -------------------------------------------------------------------------------------
DO $$
DECLARE ba uuid := qa.id('biz_a');
BEGIN
    PERFORM qa.as_user('a');
    PERFORM qa.t('FIN-20', 'a reversal needs a reason', format($q$SELECT public.reverse_transaction(%L, '  ')$q$, qa.id('t2')), '23514');
    PERFORM qa.t('FIN-21', 'reverse founder receipt 2 through the RPC', format($q$SELECT public.reverse_transaction(%L, 'Bank returned the transfer')$q$, qa.id('t2')), 'ok');
    PERFORM qa.v('FIN-22', 'its allocation was reversed with it', format($q$SELECT bool_and(is_reversed)::text FROM public.payment_allocations WHERE transaction_id = %L$q$, qa.id('t2')), 'true');
    PERFORM qa.v('FIN-23', 'commitment drops back to partially_paid immediately', format($q$SELECT status || '/' || received_amount FROM public.vw_funding_commitment_status WHERE commitment_id = %L$q$, qa.id('c_founder')), 'partially_paid/10000.00');
    PERFORM qa.v('FIN-24', 'reversal is in the activity ledger with the cascade count', format($q$SELECT metadata->>'allocations_reversed' FROM public.activity_records WHERE entity_id = %L AND event_type = 'transactions.reversed'$q$, qa.id('t2')), '1');
    PERFORM qa.t('FIN-25', 'a reversed transaction cannot be reversed again', format($q$SELECT public.reverse_transaction(%L, 'again')$q$, qa.id('t2')), '23514');
    PERFORM qa.t('FIN-26', 'a reversed transaction cannot be allocated again', format($q$INSERT INTO public.payment_allocations (business_id, commitment_id, transaction_id, amount) VALUES (%L, %L, %L, 1)$q$, ba, qa.id('c_founder'), qa.id('t2')), '23514');
    PERFORM qa.t('FIN-27', 'founder cannot edit the amount of an allocated transaction', format($q$UPDATE public.transactions SET amount = 1 WHERE id = %L$q$, qa.id('t1')), '42501');
    PERFORM qa.t('FIN-28', 'committed amount lowered to what was received', format($q$UPDATE public.funding_commitments SET committed_amount = 10000 WHERE id = %L$q$, qa.id('c_founder')), 'ok:1');
    PERFORM qa.v('FIN-29', 'status follows the new committed amount at once', format($q$SELECT status FROM public.vw_funding_commitment_status WHERE commitment_id = %L$q$, qa.id('c_founder')), 'fulfilled');
    PERFORM qa.t('FIN-30', 'a commitment with received money cannot be revoked', format($q$SELECT public.revoke_funding_commitment(%L, 'Cofounder withdrew')$q$, qa.id('c_cofounder')), '23514');
    PERFORM qa.t('FIN-31', 'reverse the cofounder allocation first', format($q$SELECT public.reverse_payment_allocation((SELECT id FROM public.payment_allocations WHERE commitment_id = %L AND NOT is_reversed), 'Moved to loan')$q$, qa.id('c_cofounder')), 'ok');
    PERFORM qa.t('FIN-32', 'now the commitment can be revoked', format($q$SELECT public.revoke_funding_commitment(%L, 'Cofounder withdrew')$q$, qa.id('c_cofounder')), 'ok');
    PERFORM qa.v('FIN-33', 'revoked commitment shows revoked with nothing outstanding', format($q$SELECT status || '/' || outstanding_amount FROM public.vw_funding_commitment_status WHERE commitment_id = %L$q$, qa.id('c_cofounder')), 'revoked/0.00');
    PERFORM qa.t('FIN-34', 'a revoked commitment cannot receive payments', format($q$INSERT INTO public.payment_allocations (business_id, commitment_id, transaction_id, amount) VALUES (%L, %L, %L, 1)$q$, ba, qa.id('c_cofounder'), qa.id('t3')), '23514');
    PERFORM qa.t('FIN-35', 'a revoked commitment cannot be edited', format($q$UPDATE public.funding_commitments SET committed_amount = 1 WHERE id = %L$q$, qa.id('c_cofounder')), '23514');
    PERFORM qa.v('FIN-36', 'revocation is in the activity ledger as the founder', format($q$SELECT actor_type || '/' || (metadata->>'reason') FROM public.activity_records WHERE entity_id = %L AND event_type = 'funding_commitments.revoked'$q$, qa.id('c_cofounder')), 'user/Cofounder withdrew');
    PERFORM qa.t('FIN-37', 'an allocation cannot be un-reversed by the founder', format($q$UPDATE public.payment_allocations SET is_reversed = false WHERE transaction_id = %L$q$, qa.id('t2')), '42501');
    PERFORM qa.as_admin();
    PERFORM qa.as_service();
    PERFORM qa.t('FIN-38', 'even service_role cannot un-reverse a transaction', format($q$UPDATE public.transactions SET is_reversed = false, reversed_at = NULL, reversal_reason = NULL WHERE id = %L$q$, qa.id('t2')), '23514');
    PERFORM qa.t('FIN-39', 'even service_role cannot un-reverse an allocation', format($q$UPDATE public.payment_allocations SET is_reversed = false, reversed_at = NULL, reversal_reason = NULL WHERE transaction_id = %L$q$, qa.id('t2')), '23514');
    PERFORM qa.t('FIN-40', 'even service_role cannot back-date a transaction', format($q$UPDATE public.transactions SET transaction_date = '2026-04-02' WHERE id = %L$q$, qa.id('t1')), '23514');
    PERFORM qa.as_admin();
END $$;

-- -------------------------------------------------------------------------------------
-- Founder loans and reimbursable expenses are distinct from equity and from each other
-- -------------------------------------------------------------------------------------
DO $$
DECLARE ba uuid := qa.id('biz_a'); f uuid := qa.id('part_a_founder'); c uuid := qa.id('part_a_cofounder'); b1 uuid := qa.id('acct_a_bank1'); v uuid;
BEGIN
    PERFORM qa.as_user('a');
    PERFORM qa.t('FIN-50', 'founder pays a business expense personally as a reimbursable expense',
        format($q$WITH x AS (INSERT INTO public.transactions (business_id, participant_id, transaction_date, amount, type, contribution_type, is_personal_founder_payment, description) VALUES (%L, %L, '2026-06-15', 1200, 'expense', 'reimbursable_expense', true, 'Domain + hosting paid personally') RETURNING id) SELECT qa.setid('re1', id) FROM x$q$, ba, f), 'ok');
    PERFORM qa.t('FIN-51', 'a personally paid expense cannot be silently operational', format($q$INSERT INTO public.transactions (business_id, participant_id, transaction_date, amount, type, is_personal_founder_payment, description) VALUES (%L, %L, '2026-06-15', 10, 'expense', true, 'x')$q$, ba, f), '23514');
    PERFORM qa.t('FIN-52', 'capital contribution needs a participant', format($q$INSERT INTO public.transactions (business_id, account_id, transaction_date, amount, type, contribution_type, description) VALUES (%L, %L, '2026-06-15', 10, 'income', 'capital_contribution', 'x')$q$, ba, b1), '23514');
    PERFORM qa.t('FIN-53', 'the business reimburses 700', format($q$INSERT INTO public.transactions (business_id, account_id, participant_id, settles_transaction_id, transaction_date, amount, type, contribution_type, description) VALUES (%L, %L, %L, %L, '2026-06-20', 700, 'expense', 'reimbursement', 'Reimburse domain + hosting')$q$, ba, b1, f, qa.id('re1')), 'ok:1');
    PERFORM qa.v('FIN-54', 'reimbursement outstanding 500 of 1200', format($q$SELECT settled_amount || '/' || outstanding_amount FROM public.vw_settlement_status WHERE transaction_id = %L$q$, qa.id('re1')), '700.00/500.00');
    PERFORM qa.t('FIN-55', 'cannot reimburse more than is owed', format($q$INSERT INTO public.transactions (business_id, account_id, participant_id, settles_transaction_id, transaction_date, amount, type, contribution_type, description) VALUES (%L, %L, %L, %L, '2026-06-21', 600, 'expense', 'reimbursement', 'x')$q$, ba, b1, f, qa.id('re1')), '23514');
    PERFORM qa.t('FIN-56', 'cannot reimburse the wrong participant', format($q$INSERT INTO public.transactions (business_id, account_id, participant_id, settles_transaction_id, transaction_date, amount, type, contribution_type, description) VALUES (%L, %L, %L, %L, '2026-06-21', 100, 'expense', 'reimbursement', 'x')$q$, ba, b1, c, qa.id('re1')), '23514');
    PERFORM qa.t('FIN-57', 'a reimbursement cannot settle ordinary revenue', format($q$INSERT INTO public.transactions (business_id, account_id, participant_id, settles_transaction_id, transaction_date, amount, type, contribution_type, description) VALUES (%L, %L, %L, %L, '2026-06-21', 100, 'expense', 'reimbursement', 'x')$q$, ba, b1, f, qa.id('t6')), '23514');
    PERFORM qa.t('FIN-58', 'a reimbursable expense with reimbursements cannot be reversed', format($q$SELECT public.reverse_transaction(%L, 'x')$q$, qa.id('re1')), '23514');
    PERFORM qa.t('FIN-59', 'founder lends the business 5000',
        format($q$WITH x AS (INSERT INTO public.transactions (business_id, account_id, participant_id, transaction_date, amount, type, contribution_type, description) VALUES (%L, %L, %L, '2026-06-25', 5000, 'income', 'founder_loan', 'Founder loan') RETURNING id) SELECT qa.setid('loan1', id) FROM x$q$, ba, b1, f), 'ok');
    PERFORM qa.t('FIN-60', 'the business repays 2000 of the loan', format($q$INSERT INTO public.transactions (business_id, account_id, participant_id, settles_transaction_id, transaction_date, amount, type, contribution_type, description) VALUES (%L, %L, %L, %L, '2026-07-01', 2000, 'expense', 'loan_repayment', 'Loan repayment 1')$q$, ba, b1, f, qa.id('loan1')), 'ok:1');
    PERFORM qa.v('FIN-61', 'founder summary keeps capital, loans and reimbursements separate (and equity untouched)',
        format($q$SELECT agreed_equity_percentage || '/' || capital_contributed || '/' || loans_advanced || '/' || loans_outstanding || '/' || reimbursements_owed FROM public.vw_participant_contribution_summary WHERE participant_id = %L$q$, f),
        '60.00/11000.00/5000.00/3000.00/500.00');
    PERFORM qa.as_admin();
END $$;

-- -------------------------------------------------------------------------------------
-- Capital structure: targets, participant allocations, over-allocation visibility
-- -------------------------------------------------------------------------------------
DO $$
DECLARE ba uuid := qa.id('biz_a'); s uuid; s2 uuid; tseed uuid; tother uuid;
BEGIN
    PERFORM qa.as_user('a');
    INSERT INTO public.capital_structures (business_id, agreed_capital_target, contribution_basis) VALUES (ba, 1000000, '60/40 founders') RETURNING id INTO s; PERFORM qa.setid('cs1', s);
    INSERT INTO public.capital_targets (business_id, structure_id, name, target_amount) VALUES (ba, s, 'Seed', 200000) RETURNING id INTO tseed;
    INSERT INTO public.capital_targets (business_id, structure_id, name, target_amount) VALUES (ba, s, 'Series A', 900000);
    INSERT INTO public.capital_structures (business_id, agreed_capital_target, is_current, title) VALUES (ba, 1, false, 'Draft structure') RETURNING id INTO s2;
    INSERT INTO public.capital_targets (business_id, structure_id, name, target_amount) VALUES (ba, s2, 'Other', 1) RETURNING id INTO tother;
    PERFORM qa.t('FIN-70', 'founder allocated 300000 against the 200000 Seed target', format($q$INSERT INTO public.participant_capital_allocations (business_id, structure_id, capital_target_id, participant_id, allocated_amount) VALUES (%L, %L, %L, %L, 300000)$q$, ba, s, tseed, qa.id('part_a_founder')), 'ok:1');
    PERFORM qa.t('FIN-71', 'cofounder allocated 400000 at structure level', format($q$INSERT INTO public.participant_capital_allocations (business_id, structure_id, participant_id, allocated_amount) VALUES (%L, %L, %L, 400000)$q$, ba, s, qa.id('part_a_cofounder')), 'ok:1');
    PERFORM qa.t('FIN-72', 'a target from another structure is rejected by the key', format($q$INSERT INTO public.participant_capital_allocations (business_id, structure_id, capital_target_id, participant_id, allocated_amount) VALUES (%L, %L, %L, %L, 1)$q$, ba, s, tother, qa.id('part_a_founder')), '23503');
    PERFORM qa.v('FIN-73', 'target view flags Seed over-allocated by 100000', format($q$SELECT allocation_status || '/' || over_allocated_amount FROM public.vw_capital_target_summary WHERE capital_target_id = %L$q$, tseed), 'over_allocated/100000.00');
    PERFORM qa.v('FIN-74', 'structure view: 700000 allocated, under-allocated overall, targets exceed structure by 100000, 1 target over',
        format($q$SELECT allocated_amount || '/' || allocation_status || '/' || targets_exceed_structure_by || '/' || over_allocated_target_count FROM public.vw_capital_structure_summary WHERE structure_id = %L$q$, s),
        '700000.00/under_allocated/100000.00/1');
    PERFORM qa.v('FIN-75', 'ownership percentages are unaffected by capital allocations', $q$SELECT string_agg(agreed_equity_percentage::text, '/' ORDER BY agreed_equity_percentage DESC) FROM public.participants WHERE agreed_equity_percentage > 0$q$, '60.00/40.00');
    PERFORM qa.as_admin();
END $$;

-- -------------------------------------------------------------------------------------
-- Available cash (hand-computed). Movements added here:
--   2026-07-05 transfer bank1 -> bank2 1500 (cash-neutral)
--   2026-07-10 transfer bank1 -> escrow 2000 (cash leaves available cash)
--   2026-07-12 transfer credit -> bank1 1000 (drawing on credit adds cash)
--   2026-07-15 expense bank2 800
--   2099-01-01 income bank1 9999 (future-dated)
-- bank1 @2026-07-31 = 10000 +10000(t1) +1000(t4) +3000(t6) +5000(loan) +1000(credit in)
--                     -700(reimb) -2000(repay) -1500 -2000 = 23800   (t2 reversed: excluded)
-- bank2 @2026-07-31 = 5000 +4000(t3) +2500(t5) +3000(t7) +1500 -800 = 15200
-- cash  = 500 ; bank3 opens 2026-09-01 ; old bank inactive ; credit/escrow never count
-- Available @2026-07-31 = 23800 + 15200 + 500 = 39500
-- Available @2026-05-15 = (10000+10000) + 5000 + 500 = 25500
-- Available @2026-11-08 = 39500 + 1000 (bank3) = 40500 ; @2099-12-31 = 40500 + 9999 = 50499
-- -------------------------------------------------------------------------------------
DO $$
DECLARE ba uuid := qa.id('biz_a'); b1 uuid := qa.id('acct_a_bank1'); b2 uuid := qa.id('acct_a_bank2');
BEGIN
    PERFORM qa.as_user('a');
    -- 2026-07-04: bank1 10000+10000+1000+3000+5000-700-2000 = 26300 ; bank2 5000+4000+2500+3000 = 14500 ; cash 500
    PERFORM qa.v('CASH-01', 'cash before the July transfer', $q$SELECT public.get_available_cash('2026-07-04')::text$q$, '41300.00');
    PERFORM qa.t('CASH-02', 'transfer bank1 -> bank2 1500', format($q$INSERT INTO public.transactions (business_id, account_id, transfer_to_account_id, transaction_date, amount, type, description) VALUES (%L, %L, %L, '2026-07-05', 1500, 'transfer', 'Rebalance')$q$, ba, b1, b2), 'ok:1');
    PERFORM qa.v('CASH-03', 'an internal transfer is cash-neutral', $q$SELECT (public.get_available_cash('2026-07-05') - public.get_available_cash('2026-07-04'))::text$q$, '0.00');
    PERFORM qa.t('CASH-04', 'transfer bank1 -> escrow 2000', format($q$INSERT INTO public.transactions (business_id, account_id, transfer_to_account_id, transaction_date, amount, type, description) VALUES (%L, %L, %L, '2026-07-10', 2000, 'transfer', 'Security deposit to escrow')$q$, ba, b1, qa.id('acct_a_escrow')), 'ok:1');
    PERFORM qa.v('CASH-05', 'moving money into escrow reduces available cash', $q$SELECT (public.get_available_cash('2026-07-10') - public.get_available_cash('2026-07-09'))::text$q$, '-2000.00');
    PERFORM qa.t('CASH-06', 'draw 1000 from the credit line', format($q$INSERT INTO public.transactions (business_id, account_id, transfer_to_account_id, transaction_date, amount, type, description) VALUES (%L, %L, %L, '2026-07-12', 1000, 'transfer', 'Credit draw')$q$, ba, qa.id('acct_a_credit'), b1), 'ok:1');
    PERFORM qa.v('CASH-07', 'drawing on credit adds available cash', $q$SELECT (public.get_available_cash('2026-07-12') - public.get_available_cash('2026-07-11'))::text$q$, '1000.00');
    PERFORM qa.t('CASH-08', 'expense 800 from bank2', format($q$INSERT INTO public.transactions (business_id, account_id, transaction_date, amount, type, description) VALUES (%L, %L, '2026-07-15', 800, 'expense', 'Office rent July')$q$, ba, b2), 'ok:1');
    PERFORM qa.t('CASH-09', 'future-dated income 9999', format($q$INSERT INTO public.transactions (business_id, account_id, transaction_date, amount, type, description) VALUES (%L, %L, '2099-01-01', 9999, 'income', 'Scheduled receivable')$q$, ba, b1), 'ok:1');
    PERFORM qa.t('CASH-10', 'a transaction before the account opened is refused', format($q$INSERT INTO public.transactions (business_id, account_id, transaction_date, amount, type, description) VALUES (%L, %L, '2026-08-01', 10, 'income', 'x')$q$, ba, qa.id('acct_a_bank3')), '23514');
    PERFORM qa.t('CASH-11', 'a transaction on an inactive account is refused', format($q$INSERT INTO public.transactions (business_id, account_id, transaction_date, amount, type, description) VALUES (%L, %L, '2026-08-01', 10, 'income', 'x')$q$, ba, qa.id('acct_a_old')), '23514');
    PERFORM qa.v('CASH-12', 'available cash on 2026-07-31', $q$SELECT public.get_available_cash('2026-07-31')::text$q$, '39500.00');
    PERFORM qa.v('CASH-13', 'available cash on 2026-05-15 (as-of date respected)', $q$SELECT public.get_available_cash('2026-05-15')::text$q$, '25500.00');
    PERFORM qa.v('CASH-14', 'before any account opened there is no cash', $q$SELECT public.get_available_cash('2026-03-31')::text$q$, '0.00');
    PERFORM qa.v('CASH-15', 'today (business timezone) excludes the 2099 receivable, includes bank3', $q$SELECT public.get_available_cash('2026-11-08')::text$q$, '40500.00');
    PERFORM qa.v('CASH-16', 'far future includes the scheduled receivable', $q$SELECT public.get_available_cash('2099-12-31')::text$q$, '50499.00');
    PERFORM qa.v('CASH-17', 'per-account balances on 2026-07-31',
        $q$SELECT string_agg(name || '=' || balance || ':' || counts_as_available_cash, ', ' ORDER BY name) FROM public.get_account_balances('2026-07-31')$q$,
        'Credit line=-3000.00:false, Escrow=2000.00:false, HDFC Current=23800.00:true, ICICI Current=15200.00:true, Old bank=300.00:false, Petty cash=500.00:true');
    PERFORM qa.v('CASH-18', 'the personally paid expense never touched business cash', $q$SELECT (public.get_available_cash('2026-06-16') - public.get_available_cash('2026-06-14'))::text$q$, '0.00');
    PERFORM qa.as_admin();
    PERFORM qa.as_service();
    PERFORM qa.v('CASH-19', 'service_role gets the same figure by naming the business', format($q$SELECT public.get_available_cash_for_business(%L, '2026-07-31')::text$q$, ba), '39500.00');
    PERFORM qa.as_admin();
    -- added with migration 9 (CREATE OR REPLACE must not widen grants)
    PERFORM qa.v('CASH-20', 'get_available_cash is executable by authenticated only',
        $q$SELECT has_function_privilege('authenticated', 'public.get_available_cash(date)', 'EXECUTE')::text || '/' || has_function_privilege('anon', 'public.get_available_cash(date)', 'EXECUTE')::text || '/' || has_function_privilege('service_role', 'public.get_available_cash(date)', 'EXECUTE')::text$q$, 'true/false/false');
END $$;

SELECT test_id, status, expected, actual FROM qa.results WHERE suite = '20_financial' AND status <> 'PASS' ORDER BY seq;
