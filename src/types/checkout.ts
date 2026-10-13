/**
 * Checkouts of the invoices bots send for payment in Telegram Stars: an account confirms the
 * payment of an invoice, which starts an attempt that the bot receives as a pre-checkout query and
 * approves or refuses.
 *
 * The emulator's checkout rules are its own policies, which Telegram does not document: an invoice
 * has at most one active attempt, an attempt is answered once, and the account abandons an
 * attempt, or a test expires a pending one, by explicit controls rather than by time.
 *
 * @module
 */
import type { StarsInvoice } from './invoice.ts';
import type { CanonicalMessageId } from './virtual_message.ts';

/**
 * Telegram's decimal text form of a 64-bit pre-checkout query identifier, which identifies the
 * checkout attempt the query belongs to.
 */
export type PreCheckoutQueryId = string;

/**
 * Where a checkout attempt is in its life. An attempt starts `pending`, awaiting the bot's answer
 * to its pre-checkout query. The bot's answer approves it or refuses it with the reason it gives the
 * payer. The payer abandons a pending or approved attempt, and a pending attempt expires when a
 * test expires it. A refused, abandoned or expired attempt has ended for good.
 */
export type CheckoutAttemptState =
  | { readonly status: 'pending' }
  | { readonly status: 'approved' }
  | {
    readonly status: 'refused';
    /** The bot's explanation for the payer of why the checkout cannot proceed; never empty. */
    readonly errorMessage: string;
  }
  | { readonly status: 'abandoned' }
  | { readonly status: 'expired' };

/** The bot's answer to a pre-checkout query: an approval, or a refusal with its explanation. */
export type PreCheckoutQueryAnswer = Extract<
  CheckoutAttemptState,
  { readonly status: 'approved' | 'refused' }
>;

/**
 * Whether an attempt is still active: pending or approved. An invoice has at most one active
 * attempt, so another checkout of the invoice waits until this one ends.
 */
export function isCheckoutAttemptActive(state: CheckoutAttemptState): boolean {
  return state.status === 'pending' || state.status === 'approved';
}

/**
 * An account's attempt to pay an invoice a bot sent to their private chat, which the bot receives
 * as a pre-checkout query.
 */
export interface CheckoutAttempt {
  /** The ID of the pre-checkout query the bot receives, fresh for every attempt. */
  readonly id: PreCheckoutQueryId;
  /** The account that confirmed the checkout, which pays. */
  readonly payerAccountId: number;
  /** The bot that sent the invoice, which receives the query and the payment. */
  readonly merchantBotId: number;
  /**
   * The invoice message, which identifies the invoice for as long as the session lasts, even once
   * the message is deleted.
   */
  readonly invoiceMessageId: CanonicalMessageId;
  /** The ID of the invoice message as the private chat numbers it, which the payer addressed. */
  readonly invoiceChatMessageId: number;
  /**
   * The invoice as it was when the payer confirmed the checkout, which the attempt keeps unchanged
   * whatever later happens to the message: its price, currency and the bot's payload.
   */
  readonly invoice: StarsInvoice;
  readonly state: CheckoutAttemptState;
}
