/**
 * Invoices a bot sends for payment in Telegram Stars. The emulator supports one-off invoices from a
 * bot to its private chat with an account; shipping, tips, product photos, subscriptions, paid
 * media and real payment providers are not supported.
 *
 * @module
 */

/** The currency code of Telegram Stars, the only currency of the invoices the emulator supports. */
export const TELEGRAM_STARS_CURRENCY = 'XTR';

/** The most characters of an invoice's title, which the Bot API documents for `sendInvoice`. */
export const MAX_INVOICE_TITLE_LENGTH = 32;

/** The most characters of an invoice's description, which the Bot API documents for `sendInvoice`. */
export const MAX_INVOICE_DESCRIPTION_LENGTH = 255;

/** The most UTF-8 bytes of an invoice's payload, which the Bot API documents for `sendInvoice`. */
export const MAX_INVOICE_PAYLOAD_BYTES = 128;

/**
 * The largest magnitude of an amount of any currency that TDLib's `check_currency_amount` accepts,
 * for a single price and for an invoice's total. Telegram may limit amounts in Stars further.
 */
const MAX_CURRENCY_AMOUNT = 999_999_999_999;

/** A part of an invoice's price, as the Bot API's `LabeledPrice` names it. */
export interface LabeledPrice {
  readonly label: string;
  /** The amount in the smallest units of the invoice's currency, which for Stars is one Star. */
  readonly amount: number;
}

/**
 * A one-off invoice payable in Telegram Stars, which a bot's private invoice message holds as the
 * bot sent it, once Telegram's checks normalized it.
 *
 * Its payload is the bot's own: Telegram never shows it to the payer or in the Bot API's `Invoice`,
 * and gives it back to the bot unchanged with the checkout of the invoice and its payment.
 */
export interface StarsInvoice {
  /** The product's name, of 1 to `MAX_INVOICE_TITLE_LENGTH` characters. */
  readonly title: string;
  /** The product's description, of 1 to `MAX_INVOICE_DESCRIPTION_LENGTH` characters. */
  readonly description: string;
  /**
   * The deep-linking start parameter that forwarded copies of the invoice would use, cleaned as
   * TDLib cleans input strings; empty for none. It is unrelated to the payload.
   */
  readonly startParameter: string;
  readonly currency: typeof TELEGRAM_STARS_CURRENCY;
  /** The invoice's one price, whose positive amount is the invoice's total. */
  readonly price: LabeledPrice;
  /** The bot's payload, of 1 to `MAX_INVOICE_PAYLOAD_BYTES` UTF-8 bytes, kept exactly as sent. */
  readonly payload: string;
}

/** What the payer pays for an invoice, in the smallest units of its currency. */
export function getInvoiceTotalAmount(invoice: StarsInvoice): number {
  return invoice.price.amount;
}

/** Whether an amount is within TDLib's `check_currency_amount` range. */
export function isCurrencyAmountInRange(amount: number): boolean {
  return Math.abs(amount) <= MAX_CURRENCY_AMOUNT;
}

/** The texts of an invoice that TDLib cleans as it cleans every input string. */
export type InvoiceText = 'title' | 'description' | 'start_parameter' | 'price_label';

/**
 * Why Telegram refuses an invoice: as TDLib checks it, a text is not well-formed Unicode, the
 * invoice has no price, or a price or the total is out of TDLib's range; then, as the Bot API
 * documents, the invoice has other than one price, or its title, description, or payload is
 * outside its limits.
 */
export type InvoiceRefusal =
  | { readonly reason: 'invoice_text_invalid'; readonly text: InvoiceText }
  | { readonly reason: InvoiceLimitRefusalReason };

/** Why Telegram refuses an invoice whose texts it accepts, which the refusal names alone. */
const INVOICE_LIMIT_REFUSAL_REASONS = [
  'invoice_prices_empty',
  'invoice_price_amount_too_big',
  'invoice_total_not_positive',
  'invoice_total_too_big',
  'stars_invoice_price_count_invalid',
  'invoice_title_length_invalid',
  'invoice_description_length_invalid',
  'invoice_payload_length_invalid',
] as const;

export type InvoiceLimitRefusalReason = typeof INVOICE_LIMIT_REFUSAL_REASONS[number];

const INVOICE_REFUSAL_REASONS: ReadonlySet<string> = new Set([
  'invoice_text_invalid',
  ...INVOICE_LIMIT_REFUSAL_REASONS,
]);

/** Whether a failure of a send is Telegram's refusal of the invoice itself. */
export function isInvoiceRefusal(
  failure: { readonly reason: string },
): failure is InvoiceRefusal {
  return INVOICE_REFUSAL_REASONS.has(failure.reason);
}
