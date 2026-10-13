/**
 * Telegram's rules for the invoices bots send for payment in Telegram Stars: TDLib's checks of an
 * invoice, then the limits the Bot API documents, which Telegram's servers enforce.
 *
 * @module
 */
import { cleanInputString } from '../../text_entities/input_string.ts';
import {
  type InvoiceLimitRefusalReason,
  type InvoiceRefusal,
  type InvoiceText,
  isCurrencyAmountInRange,
  type LabeledPrice,
  MAX_INVOICE_DESCRIPTION_LENGTH,
  MAX_INVOICE_PAYLOAD_BYTES,
  MAX_INVOICE_TITLE_LENGTH,
  type StarsInvoice,
  TELEGRAM_STARS_CURRENCY,
} from '../../types/invoice.ts';
import { countTextCharacters } from '../../types/virtual_message.ts';

/** An invoice in Telegram Stars as a bot specified it, before Telegram's checks. */
export interface SpecifiedStarsInvoice {
  readonly title: string;
  readonly description: string;
  /** Empty for none. */
  readonly startParameter: string;
  /** The price's parts in order, of which an invoice in Telegram Stars has exactly one. */
  readonly prices: readonly LabeledPrice[];
  readonly payload: string;
}

export type InvoiceNormalization =
  | { readonly normalized: true; readonly invoice: StarsInvoice }
  | { readonly normalized: false; readonly failure: InvoiceRefusal };

const utf8Encoder = new TextEncoder();

/**
 * Checks an invoice a bot sends for payment in Telegram Stars, in Telegram's order. As TDLib's
 * `InputInvoice::process_input_message_invoice` does, the title, the description, and the start
 * parameter are cleaned as `cleanInputString` cleans them; then each price as
 * `LabeledPricePart::get_labeled_price_parts` checks it, and their total. As the Bot API documents
 * for Stars, the invoice must then have exactly one price, a title of 1–32 characters, a
 * description of 1–255 characters, and a payload of 1–128 bytes; the emulator checks these in
 * that order, which Telegram does not document. The payload is kept exactly as sent, as the
 * official server checks only its encoding and TDLib does not clean it.
 */
export function normalizeStarsInvoice(specified: SpecifiedStarsInvoice): InvoiceNormalization {
  const title = cleanInputString(specified.title);
  if (title === undefined) {
    return refuseText('title');
  }
  const description = cleanInputString(specified.description);
  if (description === undefined) {
    return refuseText('description');
  }
  const startParameter = cleanInputString(specified.startParameter);
  if (startParameter === undefined) {
    return refuseText('start_parameter');
  }
  const priceCheck = checkPrices(specified.prices);
  if (!priceCheck.checked) {
    return { normalized: false, failure: priceCheck.failure };
  }
  const [price] = priceCheck.prices;
  if (priceCheck.prices.length !== 1) {
    return refuse('stars_invoice_price_count_invalid');
  }
  if (!hasLengthWithin(title, MAX_INVOICE_TITLE_LENGTH)) {
    return refuse('invoice_title_length_invalid');
  }
  if (!hasLengthWithin(description, MAX_INVOICE_DESCRIPTION_LENGTH)) {
    return refuse('invoice_description_length_invalid');
  }
  const payloadBytes = utf8Encoder.encode(specified.payload).length;
  if (payloadBytes === 0 || payloadBytes > MAX_INVOICE_PAYLOAD_BYTES) {
    return refuse('invoice_payload_length_invalid');
  }
  return {
    normalized: true,
    invoice: {
      title,
      description,
      startParameter,
      currency: TELEGRAM_STARS_CURRENCY,
      price,
      payload: specified.payload,
    },
  };
}

/**
 * Checks the parts of a price in order, as TDLib's `get_labeled_price_parts` does: there is at
 * least one, each label is cleaned as an input string, each amount is within the range
 * `isCurrencyAmountInRange` accepts, and the total is positive and within it too.
 */
function checkPrices(
  prices: readonly LabeledPrice[],
):
  | { readonly checked: true; readonly prices: readonly LabeledPrice[] }
  | { readonly checked: false; readonly failure: InvoiceRefusal } {
  if (prices.length === 0) {
    return { checked: false, failure: { reason: 'invoice_prices_empty' } };
  }
  const cleanedPrices: LabeledPrice[] = [];
  let totalAmount = 0;
  for (const { label, amount } of prices) {
    const cleanedLabel = cleanInputString(label);
    if (cleanedLabel === undefined) {
      return {
        checked: false,
        failure: { reason: 'invoice_text_invalid', text: 'price_label' },
      };
    }
    if (!isCurrencyAmountInRange(amount)) {
      return { checked: false, failure: { reason: 'invoice_price_amount_too_big' } };
    }
    cleanedPrices.push({ label: cleanedLabel, amount });
    totalAmount += amount;
  }
  if (totalAmount <= 0) {
    return { checked: false, failure: { reason: 'invoice_total_not_positive' } };
  }
  if (!isCurrencyAmountInRange(totalAmount)) {
    return { checked: false, failure: { reason: 'invoice_total_too_big' } };
  }
  return { checked: true, prices: cleanedPrices };
}

/** Whether text has at least one character and at most `maxLength`. */
function hasLengthWithin(text: string, maxLength: number): boolean {
  const length = countTextCharacters(text);
  return length > 0 && length <= maxLength;
}

function refuseText(text: InvoiceText): InvoiceNormalization {
  return { normalized: false, failure: { reason: 'invoice_text_invalid', text } };
}

function refuse(reason: InvoiceLimitRefusalReason): InvoiceNormalization {
  return { normalized: false, failure: { reason } };
}
