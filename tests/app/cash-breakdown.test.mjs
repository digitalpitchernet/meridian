import test from 'node:test';
import assert from 'node:assert/strict';
import { cashBreakdown } from '../../app/modules/projections.js';

test('cashBreakdown: Case 1 - all counted accounts have positive balances', () => {
  const balances = [
    { name: 'Operating Bank', balance: '1000.00', counts_as_available_cash: true },
    { name: 'Petty Cash', balance: '200.00', counts_as_available_cash: true },
    { name: 'Security Deposit', balance: '500.00', counts_as_available_cash: false },
  ];
  const r = cashBreakdown(balances, '1200.00');
  assert.equal(r.counted.length, 2);
  assert.equal(r.notCounted.length, 1);
  assert.equal(r.grossPositiveCents, 120000);
  assert.equal(r.grossNegativeCents, 0);
  assert.equal(r.netCents, 120000);
  assert.equal(r.hasNegative, false);
  assert.equal(r.sharesMeaningful, true);
  assert.equal(r.isReconciled, true);
  assert.equal(r.discrepancyCents, 0);
  assert.equal(r.counted[0].share, '83.3%');
  assert.equal(r.counted[1].share, '16.7%');
});

test('cashBreakdown: Case 2 - mixed positive and negative counted balances (clarified overdraft subtraction)', () => {
  const balances = [
    { name: 'Operating Bank', balance: '1000.00', counts_as_available_cash: true },
    { name: 'Overdrawn Credit Line', balance: '-200.00', counts_as_available_cash: true },
  ];
  const r = cashBreakdown(balances, '800.00');
  assert.equal(r.counted.length, 2);
  assert.equal(r.grossPositiveCents, 100000);
  assert.equal(r.grossNegativeCents, -20000);
  assert.equal(r.netCents, 80000);
  assert.equal(r.hasNegative, true);
  assert.equal(r.sharesMeaningful, false);
  assert.equal(r.isReconciled, true);
  assert.equal(r.discrepancyCents, 0);
  assert.equal(r.counted[0].share, null);
  assert.equal(r.counted[1].share, null);
  assert.equal(r.counted[1].cents, -20000);
});

test('cashBreakdown: Case 3 - zero-balance counted account included in breakdown', () => {
  const balances = [
    { name: 'Operating Bank', balance: '500.00', counts_as_available_cash: true },
    { name: 'Reserve Cash', balance: '0.00', counts_as_available_cash: true },
  ];
  const r = cashBreakdown(balances, '500.00');
  assert.equal(r.counted.length, 2);
  assert.equal(r.grossPositiveCents, 50000);
  assert.equal(r.grossNegativeCents, 0);
  assert.equal(r.netCents, 50000);
  assert.equal(r.hasNegative, false);
  assert.equal(r.sharesMeaningful, true);
  assert.equal(r.isReconciled, true);
  assert.equal(r.counted[0].share, '100.0%');
  assert.equal(r.counted[0].share, '100.0%');
});

test('cashBreakdown: Case 4 - net negative available cash result', () => {
  const balances = [
    { name: 'Operating Bank', balance: '100.00', counts_as_available_cash: true },
    { name: 'Facility Overdraft', balance: '-400.00', counts_as_available_cash: true },
  ];
  const r = cashBreakdown(balances, '-300.00');
  assert.equal(r.grossPositiveCents, 10000);
  assert.equal(r.grossNegativeCents, -40000);
  assert.equal(r.netCents, -30000);
  assert.equal(r.hasNegative, true);
  assert.equal(r.sharesMeaningful, false);
  assert.equal(r.isReconciled, true);
});

test('cashBreakdown: Case 5 - accounts excluded by counts_as_available_cash', () => {
  const balances = [
    { name: 'Operating Bank', balance: '800.00', counts_as_available_cash: true },
    { name: 'Escrow Account', balance: '5000.00', counts_as_available_cash: false },
    { name: 'Credit Card', balance: '-1200.00', counts_as_available_cash: false },
  ];
  const r = cashBreakdown(balances, '800.00');
  assert.equal(r.counted.length, 1);
  assert.equal(r.notCounted.length, 2);
  assert.equal(r.netCents, 80000);
  assert.equal(r.hasNegative, false);
  assert.equal(r.sharesMeaningful, true);
  assert.equal(r.isReconciled, true);
});

test('cashBreakdown: Case 6 - zero net available cash result', () => {
  const balances = [
    { name: 'Operating Bank', balance: '0.00', counts_as_available_cash: true },
  ];
  const r = cashBreakdown(balances, '0.00');
  assert.equal(r.counted.length, 1);
  assert.equal(r.grossPositiveCents, 0);
  assert.equal(r.grossNegativeCents, 0);
  assert.equal(r.netCents, 0);
  assert.equal(r.sharesMeaningful, false);
  assert.equal(r.isReconciled, true);
});

test('cashBreakdown: Case 7 - headline cash amount that does not reconcile with counted balances', () => {
  const balances = [
    { name: 'Operating Bank', balance: '1000.00', counts_as_available_cash: true },
    { name: 'Petty Cash', balance: '200.00', counts_as_available_cash: true },
  ];
  const r = cashBreakdown(balances, '1500.00');
  assert.equal(r.isReconciled, false);
  assert.equal(r.netCents, 150000);
  assert.equal(r.countedSumCents, 120000);
  assert.equal(r.discrepancyCents, 30000);
  assert.equal(r.sharesMeaningful, false);
  assert.equal(r.counted[0].share, null);
  assert.equal(r.counted[1].share, null);
});
test('cashBreakdown: Case 8 - negative counted account AND headline cash discrepancy', () => {
  // Operating is 1000.00, Overdrawn line is -300.00 -> Counted sum is 700.00.
  // But headline cash reports 900.00 (e.g. stale cache or upstream discrepancy of +200.00).
  const balances = [
    { name: 'Operating Bank', balance: '1000.00', counts_as_available_cash: true },
    { name: 'Credit Facility', balance: '-300.00', counts_as_available_cash: true },
  ];
  const r = cashBreakdown(balances, '900.00');
  assert.equal(r.hasNegative, true);
  assert.equal(r.grossPositiveCents, 100000);
  assert.equal(r.grossNegativeCents, -30000);
  assert.equal(r.countedSumCents, 70000);
  assert.equal(r.netCents, 90000);
  assert.equal(r.isReconciled, false);
  assert.equal(r.discrepancyCents, 20000);
  // Shares must be suppressed
  assert.equal(r.sharesMeaningful, false);
  assert.equal(r.counted[0].share, null);
  assert.equal(r.counted[1].share, null);
});
