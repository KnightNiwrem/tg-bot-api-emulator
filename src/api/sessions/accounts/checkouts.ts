import { Hono } from 'hono';
import { basePath } from 'hono/route';

import {
  abandonCheckoutAttemptContract,
  expireCheckoutAttemptContract,
  getCheckoutAttemptContract,
  submitCheckoutContract,
} from '../../contracts/checkouts.ts';
import type { ControlOperationRefusal } from '../../contracts/operation_contract.ts';
import { toBotApiInvoice } from '../../../types/bot_api.ts';
import type { CheckoutAttempt } from '../../../types/checkout.ts';
import type { EmulationSession } from '../../../session/emulation_session.ts';
import { registerControlOperation } from '../../control_operation_route.ts';
import type { SessionRouteContextTypes } from '../session_route_context_types.ts';

/** Where the account routes are mounted within the server, as a contract path template. */
const ACCOUNT_COLLECTION_MOUNT_PATH = '/sessions/{sessionId}/accounts';

/**
 * Routes through which an account checks out the invoices bots send to its private chats, reads
 * each checkout attempt with the bot's answer, and abandons it, and through which a test expires a
 * pending attempt.
 */
export function createCheckoutRoutes(): Hono<SessionRouteContextTypes> {
  const accountRoutes = new Hono<SessionRouteContextTypes>();

  registerControlOperation(
    accountRoutes,
    ACCOUNT_COLLECTION_MOUNT_PATH,
    submitCheckoutContract,
    ({ params: { accountId }, body }, context) => {
      const result = context.get('emulationSession').checkouts.submitCheckout({
        payerAccountId: accountId,
        botId: body.chat.botId,
        invoiceChatMessageId: body.message_id,
      });
      if (!result.submitted) {
        return refuseCheckoutSubmission(result.reason);
      }
      return {
        status: 201,
        headers: {
          Location: `${basePath(context)}/${accountId}/checkout-attempts/${result.attempt.id}`,
        },
        body: { checkout_attempt: presentCheckoutAttemptForPayer(result.attempt) },
      };
    },
  );

  registerControlOperation(
    accountRoutes,
    ACCOUNT_COLLECTION_MOUNT_PATH,
    getCheckoutAttemptContract,
    ({ params: { accountId, checkoutAttemptId } }, context) => {
      const attempt = context.get('emulationSession').checkouts.getAccountCheckoutAttempt({
        accountId,
        attemptId: checkoutAttemptId,
      });
      return attempt === undefined
        ? { status: 404, body: { reason: 'checkout_attempt_not_found' } }
        : { status: 200, body: { checkout_attempt: presentCheckoutAttemptForPayer(attempt) } };
    },
  );

  registerControlOperation(
    accountRoutes,
    ACCOUNT_COLLECTION_MOUNT_PATH,
    abandonCheckoutAttemptContract,
    ({ params: { accountId, checkoutAttemptId } }, context) => {
      const result = context.get('emulationSession').checkouts.abandonCheckoutAttempt({
        accountId,
        attemptId: checkoutAttemptId,
      });
      if (result.abandoned) {
        return {
          status: 200,
          body: { checkout_attempt: presentCheckoutAttemptForPayer(result.attempt) },
        };
      }
      return result.reason === 'checkout_attempt_not_found'
        ? { status: 404, body: { reason: result.reason } }
        : { status: 409, body: { reason: result.reason } };
    },
  );

  registerControlOperation(
    accountRoutes,
    ACCOUNT_COLLECTION_MOUNT_PATH,
    expireCheckoutAttemptContract,
    ({ params: { accountId, checkoutAttemptId } }, context) => {
      const result = context.get('emulationSession').checkouts.expireCheckoutAttempt({
        accountId,
        attemptId: checkoutAttemptId,
      });
      if (result.expired) {
        return {
          status: 200,
          body: { checkout_attempt: presentCheckoutAttemptForPayer(result.attempt) },
        };
      }
      return result.reason === 'checkout_attempt_not_found'
        ? { status: 404, body: { reason: result.reason } }
        : { status: 409, body: { reason: result.reason } };
    },
  );

  return accountRoutes;
}

/**
 * A message that is no invoice rejects the request; a blocked bot or an invoice whose earlier
 * attempt is still active conflicts; a missing account, bot or message is not found.
 */
function refuseCheckoutSubmission(
  reason: Extract<
    ReturnType<EmulationSession['checkouts']['submitCheckout']>,
    { readonly submitted: false }
  >['reason'],
): ControlOperationRefusal<typeof submitCheckoutContract> {
  switch (reason) {
    case 'message_not_invoice':
      return { status: 400, body: { reason } };
    case 'account_not_found':
    case 'bot_not_found':
    case 'message_not_found':
      return { status: 404, body: { reason } };
    case 'bot_blocked':
    case 'checkout_attempt_active':
      return { status: 409, body: { reason } };
    default: {
      const unhandledReason: never = reason;
      throw new Error(`Unhandled checkout submission failure: ${unhandledReason}`);
    }
  }
}

/**
 * Shows a checkout attempt to the account that pays: the invoice as the account confirmed it,
 * without the bot's payload, and the bot's explanation of a refusal.
 */
function presentCheckoutAttemptForPayer(attempt: CheckoutAttempt) {
  const identity = {
    id: attempt.id,
    chat: { type: 'private' as const, botId: attempt.merchantBotId },
    message_id: attempt.invoiceChatMessageId,
    invoice: toBotApiInvoice(attempt.invoice),
  };
  const { state } = attempt;
  return state.status === 'refused'
    ? { ...identity, status: state.status, error_message: state.errorMessage }
    : { ...identity, status: state.status };
}
