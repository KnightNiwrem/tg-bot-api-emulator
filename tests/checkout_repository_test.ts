import { assertEquals, assertThrows } from '@std/assert';
import { CheckoutRepository } from '../src/repositories/checkout/checkout.ts';

const ATTEMPT_INPUT = {
  payerAccountId: 1,
  merchantBotId: 2,
  invoiceMessageId: 'invoice',
  invoiceChatMessageId: 3,
  invoice: {
    title: 'Premium access',
    description: 'Unlocks every premium chapter',
    startParameter: '',
    currency: 'XTR',
    price: { label: 'Access', amount: 50 },
    payload: 'order-42',
  },
} as const;

Deno.test('CheckoutRepository keeps one active attempt per invoice, under fresh IDs', () => {
  const checkouts = new CheckoutRepository();
  const first = checkouts.addPendingAttempt(ATTEMPT_INPUT);
  const otherInvoice = checkouts.addPendingAttempt({ ...ATTEMPT_INPUT, invoiceMessageId: 'other' });

  assertThrows(() => checkouts.addPendingAttempt(ATTEMPT_INPUT), Error, 'already has');
  checkouts.changeActiveAttemptState(first.id, { status: 'approved' });
  assertThrows(() => checkouts.addPendingAttempt(ATTEMPT_INPUT), Error, 'already has');
  checkouts.changeActiveAttemptState(first.id, { status: 'abandoned' });
  const second = checkouts.addPendingAttempt(ATTEMPT_INPUT);

  assertEquals(
    [first.id, otherInvoice.id, second.id, first.state, second.state],
    ['1', '2', '3', { status: 'pending' }, { status: 'pending' }],
  );
  assertEquals(checkouts.findActiveAttempt('invoice'), second);
  assertEquals(checkouts.getAttempt(first.id)?.state, { status: 'abandoned' });
});

Deno.test('CheckoutRepository changes only an active attempt', () => {
  const checkouts = new CheckoutRepository();
  const refused = checkouts.addPendingAttempt(ATTEMPT_INPUT);
  const ended = checkouts.changeActiveAttemptState(refused.id, {
    status: 'refused',
    errorMessage: 'Sold out',
  });

  assertThrows(
    () => checkouts.changeActiveAttemptState(refused.id, { status: 'abandoned' }),
    Error,
    'has already ended as refused',
  );
  assertThrows(
    () => checkouts.changeActiveAttemptState('unknown', { status: 'expired' }),
    Error,
    'does not exist',
  );
  assertEquals(
    [checkouts.getAttempt(refused.id), checkouts.findActiveAttempt('invoice')],
    [ended, undefined],
  );
});

const PAYMENT = {
  receiptMessageId: 'receipt',
  receiptChatMessageId: 4,
  charge: {
    telegramPaymentChargeId: 'emulator_telegram_charge_1',
    providerPaymentChargeId: 'emulator_provider_charge_1',
  },
} as const;

Deno.test('CheckoutRepository completes only an approved attempt, and pays its invoice for good', () => {
  const checkouts = new CheckoutRepository();
  const attempt = checkouts.addPendingAttempt(ATTEMPT_INPUT);

  assertThrows(
    () => checkouts.completeApprovedAttempt(attempt.id, PAYMENT),
    Error,
    'is pending, not approved',
  );
  checkouts.changeActiveAttemptState(attempt.id, { status: 'approved' });
  const completed = checkouts.completeApprovedAttempt(attempt.id, PAYMENT);

  assertEquals(completed.state, { status: 'completed', payment: PAYMENT });
  assertEquals(
    [
      checkouts.getAttempt(attempt.id),
      checkouts.findPaidAttempt('invoice'),
      checkouts.findActiveAttempt('invoice'),
    ],
    [completed, completed, undefined],
  );
  assertThrows(
    () => checkouts.completeApprovedAttempt(attempt.id, PAYMENT),
    Error,
    'has already ended as completed',
  );
  assertThrows(() => checkouts.addPendingAttempt(ATTEMPT_INPUT), Error, 'was paid by attempt 1');
  assertEquals(checkouts.findPaidAttempt('other'), undefined);
});
