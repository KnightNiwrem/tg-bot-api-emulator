/**
 * Wire facts of the invoices a bot sends to its private chats, as the Bot API's `Invoice` shows
 * them: payable in Telegram Stars, without the bot's payload or the invoice's receipt. Their
 * payments, as the Bot API's `SuccessfulPayment` shows them to the bot, are apart.
 */
import { z } from 'zod';

import type { ReadonlySnapshot } from './readonly_snapshot.ts';

/** The currency code of Telegram Stars, the only currency of the emulator's invoices. */
const TELEGRAM_STARS_CURRENCY = 'XTR';

/** The most characters of an invoice's title, counted by code point, as `sendInvoice` limits it. */
const MAX_INVOICE_TITLE_LENGTH = 32;

/** The most characters of an invoice's description, counted by code point. */
const MAX_INVOICE_DESCRIPTION_LENGTH = 255;

/** The largest total TDLib's `check_currency_amount` accepts, in the currency's smallest units. */
const MAX_INVOICE_TOTAL_AMOUNT = 999_999_999_999;

/** An invoice, in the field order of the official Bot API server's `JsonInvoice`. */
export const invoiceSchema = z.strictObject({
  title: z.string().min(1).max(MAX_INVOICE_TITLE_LENGTH),
  description: z.string().min(1).max(MAX_INVOICE_DESCRIPTION_LENGTH),
  /** Empty for an invoice without a deep-linking start parameter; never absent. */
  start_parameter: z.string(),
  currency: z.literal(TELEGRAM_STARS_CURRENCY),
  /** The total price in Telegram Stars. */
  total_amount: z.int().min(1).max(MAX_INVOICE_TOTAL_AMOUNT),
});

/** An invoice a bot sent to its private chat with an account, payable in Telegram Stars. */
export type Invoice = ReadonlySnapshot<z.output<typeof invoiceSchema>>;

/**
 * An account's payment of a bot's invoice, in the field order of the official Bot API server's
 * `JsonSuccessfulPaymentBot`: the invoice's currency, total and the bot's payload, unchanged, and
 * the charge's identifiers, which the emulator makes up in a format of its own.
 */
export const successfulPaymentSchema = z.strictObject({
  currency: z.literal(TELEGRAM_STARS_CURRENCY),
  /** The total paid in Telegram Stars. */
  total_amount: z.int().min(1).max(MAX_INVOICE_TOTAL_AMOUNT),
  /** The payload the bot sent with the invoice, unchanged. */
  invoice_payload: z.string().min(1),
  telegram_payment_charge_id: z.string().min(1),
  provider_payment_charge_id: z.string().min(1),
});

/** An account's payment of an invoice a bot sent, as the bot receives it. */
export type SuccessfulPayment = ReadonlySnapshot<z.output<typeof successfulPaymentSchema>>;
