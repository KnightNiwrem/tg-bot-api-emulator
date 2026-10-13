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
