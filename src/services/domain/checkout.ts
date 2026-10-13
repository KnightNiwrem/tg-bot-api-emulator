import type { ChatDomainEvent } from '../../types/chat_domain_event.ts';
import type {
  CheckoutAttempt,
  CheckoutAttemptState,
  PreCheckoutQueryAnswer,
  PreCheckoutQueryId,
} from '../../types/checkout.ts';
import type { StarsInvoice } from '../../types/invoice.ts';
import type { PrivateChatKey } from '../../types/virtual_chat.ts';
import type { CanonicalMessageId } from '../../types/virtual_message.ts';
import type {
  AccountChatMessageLookupFailureReason,
  AccountChatMessageReader,
} from './account_chat_message.ts';

export interface SubmitCheckoutInput {
  readonly payerAccountId: number;
  /** The bot of the payer's private chat, which sent the invoice. */
  readonly botId: number;
  /** The ID of the invoice message, as the private chat numbers it. */
  readonly invoiceChatMessageId: number;
}

/**
 * Why an account cannot check out an invoice: the account, the bot or the message does not exist
 * for it, the message is no invoice, the account blocks the bot, or the invoice's earlier attempt
 * is still pending or approved.
 */
export type SubmitCheckoutFailureReason =
  | Exclude<AccountChatMessageLookupFailureReason, 'chat_not_found' | 'not_a_member'>
  | 'message_not_invoice'
  | 'bot_blocked'
  | 'checkout_attempt_active';

export type SubmitCheckoutResult =
  | { readonly submitted: true; readonly attempt: CheckoutAttempt }
  | { readonly submitted: false; readonly reason: SubmitCheckoutFailureReason };

export interface PreCheckoutQueryAnswerInput {
  readonly fromBotId: number;
  readonly preCheckoutQueryId: PreCheckoutQueryId;
  readonly answer: PreCheckoutQueryAnswer;
}

export type PreCheckoutQueryAnswerResult =
  | { readonly answered: true; readonly attempt: CheckoutAttempt }
  | { readonly answered: false; readonly reason: 'pre_checkout_query_not_answerable' };

/** Identifies a checkout attempt by the account that pays. */
export interface AccountCheckoutAttemptKey {
  readonly accountId: number;
  readonly attemptId: PreCheckoutQueryId;
}

export type AbandonCheckoutAttemptResult =
  | { readonly abandoned: true; readonly attempt: CheckoutAttempt }
  | {
    readonly abandoned: false;
    readonly reason: 'checkout_attempt_not_found' | 'checkout_attempt_ended';
  };

export type ExpireCheckoutAttemptResult =
  | { readonly expired: true; readonly attempt: CheckoutAttempt }
  | {
    readonly expired: false;
    readonly reason: 'checkout_attempt_not_found' | 'checkout_attempt_not_pending';
  };

interface PrivateChatBlocking {
  isBotBlocked(chat: PrivateChatKey): boolean;
}

interface CheckoutStore {
  addPendingAttempt(input: {
    readonly payerAccountId: number;
    readonly merchantBotId: number;
    readonly invoiceMessageId: CanonicalMessageId;
    readonly invoiceChatMessageId: number;
    readonly invoice: StarsInvoice;
  }): CheckoutAttempt;
  getAttempt(attemptId: PreCheckoutQueryId): CheckoutAttempt | undefined;
  findActiveAttempt(invoiceMessageId: CanonicalMessageId): CheckoutAttempt | undefined;
  changeActiveAttemptState(
    attemptId: PreCheckoutQueryId,
    state: CheckoutAttemptState,
  ): CheckoutAttempt;
}

/** The session's transactions: each command of the service runs in one, and emits its event into it. */
interface CheckoutTransactions {
  /** Runs a command in the transaction of the command executing, or in one of its own. */
  withinTransaction<Result>(command: () => Result): Result;
  emit(event: ChatDomainEvent): void;
}

interface CheckoutServiceDependencies {
  readonly accountChatMessages: AccountChatMessageReader;
  readonly privateChats: PrivateChatBlocking;
  readonly checkouts: CheckoutStore;
  /** Runs each command that changes the session as one transaction, which receives its event. */
  readonly transactions: CheckoutTransactions;
}

/**
 * Carries out the checkout of invoices bots send to their private chats: an account confirms the
 * payment of an invoice, which starts an attempt that the bot receives as a pre-checkout query, and
 * the bot approves or refuses the attempt once. The payer abandons an attempt, or a test expires a
 * pending one, by explicit commands; nothing expires by time. Answering the query creates no
 * payment.
 *
 * An attempt keeps its invoice as the payer confirmed it, and the bot's answer reads only the
 * attempt, so neither a later deletion of the invoice nor a block of the bot changes what the bot
 * can answer. Each command runs as one transaction, published with the update it creates, or, should
 * any step fail, not at all.
 */
export class CheckoutService {
  readonly #accountChatMessages: AccountChatMessageReader;
  readonly #privateChats: PrivateChatBlocking;
  readonly #checkouts: CheckoutStore;
  readonly #transactions: CheckoutTransactions;

  constructor(
    { accountChatMessages, privateChats, checkouts, transactions }: CheckoutServiceDependencies,
  ) {
    this.#accountChatMessages = accountChatMessages;
    this.#privateChats = privateChats;
    this.#checkouts = checkouts;
    this.#transactions = transactions;
  }

  /**
   * Confirms the checkout of an invoice in the account's private chat with a bot, as the payer's
   * final confirmation of the payment form does, and publishes the pre-checkout query of the new
   * pending attempt for the bot. The payer, the bot, the currency, the amount and the payload all
   * come from the stored invoice. As emulator policies, the invoice must have no active attempt and
   * the account must not block the bot.
   */
  submitCheckout(input: SubmitCheckoutInput): SubmitCheckoutResult {
    return this.#transactions.withinTransaction(() => {
      const lookup = this.#accountChatMessages.findMessage({
        accountId: input.payerAccountId,
        chat: { type: 'private', botId: input.botId },
        messageId: input.invoiceChatMessageId,
      });
      if (!lookup.found) {
        return { submitted: false, reason: toPrivateLookupFailureReason(lookup.reason) };
      }
      const { message } = lookup;
      if (message.kind !== 'private_message' || message.content.kind !== 'invoice') {
        return { submitted: false, reason: 'message_not_invoice' };
      }
      if (this.#privateChats.isBotBlocked(message.chat)) {
        return { submitted: false, reason: 'bot_blocked' };
      }
      if (this.#checkouts.findActiveAttempt(message.id) !== undefined) {
        return { submitted: false, reason: 'checkout_attempt_active' };
      }

      const attempt = this.#checkouts.addPendingAttempt({
        payerAccountId: input.payerAccountId,
        merchantBotId: input.botId,
        invoiceMessageId: message.id,
        invoiceChatMessageId: input.invoiceChatMessageId,
        invoice: message.content.invoice,
      });
      this.#transactions.emit({ type: 'pre_checkout_query_created', attempt });
      return { submitted: true, attempt };
    });
  }

  /**
   * Records the bot's answer to a pre-checkout query it received: an approval, or a refusal with
   * its explanation for the payer. As emulator policies, a query that does not exist, belongs to
   * another bot, or is no longer pending cannot be answered, and an approval creates no payment.
   */
  answerPreCheckoutQuery(input: PreCheckoutQueryAnswerInput): PreCheckoutQueryAnswerResult {
    return this.#transactions.withinTransaction(() => {
      const attempt = this.#checkouts.getAttempt(input.preCheckoutQueryId);
      if (
        attempt === undefined || attempt.merchantBotId !== input.fromBotId ||
        attempt.state.status !== 'pending'
      ) {
        return { answered: false, reason: 'pre_checkout_query_not_answerable' };
      }
      return {
        answered: true,
        attempt: this.#checkouts.changeActiveAttemptState(attempt.id, input.answer),
      };
    });
  }

  /**
   * Abandons a pending or approved attempt of the account, as closing the payment form does. The
   * bot learns nothing of it; a later answer to its query fails.
   */
  abandonCheckoutAttempt(key: AccountCheckoutAttemptKey): AbandonCheckoutAttemptResult {
    return this.#transactions.withinTransaction(() => {
      const attempt = this.getAccountCheckoutAttempt(key);
      if (attempt === undefined) {
        return { abandoned: false, reason: 'checkout_attempt_not_found' };
      }
      if (attempt.state.status !== 'pending' && attempt.state.status !== 'approved') {
        return { abandoned: false, reason: 'checkout_attempt_ended' };
      }
      return {
        abandoned: true,
        attempt: this.#checkouts.changeActiveAttemptState(attempt.id, { status: 'abandoned' }),
      };
    });
  }

  /**
   * Expires a pending attempt of the account, as the passing of the bot's time to answer would.
   * The bot learns nothing of it; a later answer to its query fails.
   */
  expireCheckoutAttempt(key: AccountCheckoutAttemptKey): ExpireCheckoutAttemptResult {
    return this.#transactions.withinTransaction(() => {
      const attempt = this.getAccountCheckoutAttempt(key);
      if (attempt === undefined) {
        return { expired: false, reason: 'checkout_attempt_not_found' };
      }
      if (attempt.state.status !== 'pending') {
        return { expired: false, reason: 'checkout_attempt_not_pending' };
      }
      return {
        expired: true,
        attempt: this.#checkouts.changeActiveAttemptState(attempt.id, { status: 'expired' }),
      };
    });
  }

  /** Returns an attempt the account started, or `undefined` for any other attempt. */
  getAccountCheckoutAttempt(
    { accountId, attemptId }: AccountCheckoutAttemptKey,
  ): CheckoutAttempt | undefined {
    const attempt = this.#checkouts.getAttempt(attemptId);
    return attempt?.payerAccountId === accountId ? attempt : undefined;
  }
}

/**
 * Narrows the failure of a lookup in a private chat, which reports neither a missing supergroup
 * nor a missing membership.
 *
 * @throws {Error} for a supergroup's failure, which a private chat's lookup never reports.
 */
function toPrivateLookupFailureReason(
  reason: AccountChatMessageLookupFailureReason,
): Exclude<AccountChatMessageLookupFailureReason, 'chat_not_found' | 'not_a_member'> {
  if (reason === 'chat_not_found' || reason === 'not_a_member') {
    throw new Error(`A private chat's message lookup failed as a supergroup's: ${reason}`);
  }
  return reason;
}
