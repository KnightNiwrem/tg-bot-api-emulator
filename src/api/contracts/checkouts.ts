/**
 * The contracts of the checkouts an account makes of the invoices bots send to its private chats:
 * confirming a checkout, which the bot receives as a pre-checkout query, reading the attempt with
 * the bot's answer and, once completed, its payment, completing or abandoning it, and the test
 * control that expires a pending attempt.
 */
import { z } from 'zod';

import { accountPathSchema, messageIdParameterSchema } from './accounts.ts';
import { controlRefusalSchema, controlValidationErrorSchema } from './control_errors.ts';
import { invoiceSchema } from './invoices.ts';
import { defineControlOperation } from './operation_contract.ts';
import { createdResourceHeadersSchema, privateMessageTargetSchema } from './wire_fields.ts';

/** The invoice to check out, by its message in the account's private chat with the bot. */
const submitCheckoutRequestSchema = z.strictObject({
  chat: privateMessageTargetSchema,
  /** The ID of the invoice message, as message history shows it. */
  message_id: messageIdParameterSchema,
});

/** What every checkout attempt shows, whatever its state. */
const checkoutAttemptIdentityShape = {
  /** The identifier the bot receives in its `pre_checkout_query` update. */
  id: z.string().min(1),
  chat: privateMessageTargetSchema,
  /** The ID of the invoice message, as message history shows it. */
  message_id: messageIdParameterSchema,
  /** The invoice as the account confirmed it, which the attempt keeps unchanged. */
  invoice: invoiceSchema,
};

/**
 * The payment of a completed attempt: the receipt it sent the bot, and the charge's identifiers,
 * which the emulator makes up in a format of its own.
 */
const checkoutPaymentSchema = z.strictObject({
  /** The ID of the `successful_payment` service message, as message history shows it. */
  receipt_message_id: messageIdParameterSchema,
  telegram_payment_charge_id: z.string().min(1),
  provider_payment_charge_id: z.string().min(1),
});

/**
 * An account's checkout of an invoice: `pending` until the bot answers its pre-checkout query,
 * then `approved`, or `refused` with the bot's explanation. The account completes an approved
 * attempt, which pays the invoice, and abandons a pending or approved one; a test expires a pending
 * one. A completed, refused, abandoned or expired attempt has ended for good.
 */
const checkoutAttemptSchema = z.discriminatedUnion('status', [
  z.strictObject({
    ...checkoutAttemptIdentityShape,
    status: z.enum(['pending', 'approved', 'abandoned', 'expired']),
  }),
  z.strictObject({
    ...checkoutAttemptIdentityShape,
    status: z.literal('completed'),
    /** The payment, apart from the invoice, which shows no receipt. */
    payment: checkoutPaymentSchema,
  }),
  z.strictObject({
    ...checkoutAttemptIdentityShape,
    status: z.literal('refused'),
    /** The bot's explanation of why the checkout cannot proceed, as the account's app shows it. */
    error_message: z.string().min(1),
  }),
]);

const checkoutAttemptResponseSchema = z.strictObject({ checkout_attempt: checkoutAttemptSchema });

/** The path parameters of a checkout attempt the account made. */
const accountCheckoutAttemptPathSchema = accountPathSchema.extend({
  checkoutAttemptId: z.string(),
});

/** The refusal of a control of an attempt the account did not make, or of a missing session. */
const checkoutAttemptNotFoundSchema = controlRefusalSchema([
  'checkout_attempt_not_found',
  'session_not_found',
]);

/**
 * Confirms the checkout of an invoice a bot sent to the account's private chat, as the final
 * confirmation of the payment form does, which starts a pending attempt that the bot receives as
 * a `pre_checkout_query` update. The payment's details all come from the stored invoice.
 */
export const submitCheckoutContract = defineControlOperation({
  operationId: 'submitCheckout',
  method: 'POST',
  path: '/sessions/{sessionId}/accounts/{accountId}/checkout-attempts',
  params: accountPathSchema,
  body: { required: true, schema: submitCheckoutRequestSchema },
  success: {
    status: 201,
    headers: createdResourceHeadersSchema,
    body: { kind: 'json', schema: checkoutAttemptResponseSchema },
    actionReceipt: 'before_action',
  },
  refusals: {
    // A message that is no invoice is input the schema accepts but the server refuses.
    400: z.union([controlValidationErrorSchema, controlRefusalSchema(['message_not_invoice'])]),
    404: controlRefusalSchema([
      'account_not_found',
      'bot_not_found',
      'message_not_found',
      'session_not_found',
    ]),
    409: controlRefusalSchema(['invoice_already_paid', 'bot_blocked', 'checkout_attempt_active']),
  },
});

/** Returns a checkout attempt the account made, with the bot's answer once given. */
export const getCheckoutAttemptContract = defineControlOperation({
  operationId: 'getCheckoutAttempt',
  method: 'GET',
  path: '/sessions/{sessionId}/accounts/{accountId}/checkout-attempts/{checkoutAttemptId}',
  params: accountCheckoutAttemptPathSchema,
  success: { status: 200, body: { kind: 'json', schema: checkoutAttemptResponseSchema } },
  refusals: { 400: controlValidationErrorSchema, 404: checkoutAttemptNotFoundSchema },
});

/**
 * Completes an approved checkout attempt of the account, as the payment of its invoice does: marks
 * the invoice paid for good and sends the bot the payer's `successful_payment` service message in
 * an ordinary `message` update. As emulator policies, the invoice message must still exist and the
 * account must not block the bot; an attempt refused for either stays approved.
 */
export const completeCheckoutAttemptContract = defineControlOperation({
  operationId: 'completeCheckoutAttempt',
  method: 'POST',
  path:
    '/sessions/{sessionId}/accounts/{accountId}/checkout-attempts/{checkoutAttemptId}/completion',
  params: accountCheckoutAttemptPathSchema,
  success: {
    status: 200,
    body: { kind: 'json', schema: checkoutAttemptResponseSchema },
    actionReceipt: 'before_action',
  },
  refusals: {
    400: controlValidationErrorSchema,
    404: checkoutAttemptNotFoundSchema,
    409: controlRefusalSchema([
      'checkout_attempt_not_approved',
      'invoice_message_deleted',
      'bot_blocked',
    ]),
  },
});

/**
 * Abandons a pending or approved checkout attempt of the account, as closing the payment form
 * does. The bot receives no update; its later answer to the query fails.
 */
export const abandonCheckoutAttemptContract = defineControlOperation({
  operationId: 'abandonCheckoutAttempt',
  method: 'POST',
  path:
    '/sessions/{sessionId}/accounts/{accountId}/checkout-attempts/{checkoutAttemptId}/abandonment',
  params: accountCheckoutAttemptPathSchema,
  success: {
    status: 200,
    body: { kind: 'json', schema: checkoutAttemptResponseSchema },
    actionReceipt: 'before_action',
  },
  refusals: {
    400: controlValidationErrorSchema,
    404: checkoutAttemptNotFoundSchema,
    409: controlRefusalSchema(['checkout_attempt_ended']),
  },
});

/**
 * Expires a pending checkout attempt of the account, as the passing of the bot's time to answer
 * would; the emulator expires nothing by time. The bot receives no update; its later answer to the
 * query fails.
 */
export const expireCheckoutAttemptContract = defineControlOperation({
  operationId: 'expireCheckoutAttempt',
  method: 'POST',
  path: '/sessions/{sessionId}/accounts/{accountId}/checkout-attempts/{checkoutAttemptId}/expiry',
  params: accountCheckoutAttemptPathSchema,
  success: {
    status: 200,
    body: { kind: 'json', schema: checkoutAttemptResponseSchema },
    actionReceipt: 'before_action',
  },
  refusals: {
    400: controlValidationErrorSchema,
    404: checkoutAttemptNotFoundSchema,
    409: controlRefusalSchema(['checkout_attempt_not_pending']),
  },
});
