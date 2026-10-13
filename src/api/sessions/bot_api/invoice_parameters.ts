import type { LabeledPrice } from '../../../types/invoice.ts';
import { BOT_API_ERRORS } from './errors/error_catalogue.ts';
import { parseBotApiJsonParameter } from './request_parameters.ts';

/**
 * What the emulator does not support of `sendInvoice`, which Telegram does: invoices in other
 * currencies than Telegram Stars, payment providers and the data they take, product photos, tips,
 * keyboards, and invoices to chats other than a private chat with an account.
 */
export type UnsupportedInvoiceOption =
  | 'currency'
  | 'payment_provider'
  | 'provider_data'
  | 'product_photo'
  | 'tips'
  | 'reply_markup';

/**
 * Why the official Bot API server's `get_labeled_price_part` cannot read a price: it is not an
 * object, its `label` is missing or empty, or its `amount` is missing or not an integer.
 */
export type LabeledPriceError =
  | { readonly reason: 'price_not_object' }
  | { readonly reason: 'field_missing'; readonly fieldName: 'label' | 'amount' }
  | { readonly reason: 'label_empty' }
  | { readonly reason: 'amount_not_integer' };

export type PricesParameterReading =
  | { readonly read: true; readonly prices: readonly LabeledPrice[] }
  | { readonly read: false; readonly description: string };

/** The largest magnitude of a 64-bit integer, which the official server reads amounts as. */
const MAX_INT64_MAGNITUDE = 2 ** 63;

/**
 * Reads the `prices` parameter of `sendInvoice`, a JSON array of `LabeledPrice`, as the official
 * Bot API server's `get_labeled_price_parts` reads it: `null` holds no prices, and each price is an
 * object with a nonempty `label` and an integer `amount`, which TDLib then checks. Telegram also
 * reads a label written as a number and an amount written as a string; the emulator answers those
 * with `invalidParametersDescription`, to surface the bot's mistake in tests.
 */
export function readPricesParameter(
  text: string,
  invalidParametersDescription: string,
): PricesParameterReading {
  const failure = (description: string): PricesParameterReading => ({ read: false, description });
  const parsedParameter = parseBotApiJsonParameter(text);
  if (parsedParameter === undefined) {
    return failure(BOT_API_ERRORS.pricesJsonInvalid.description());
  }
  const { value } = parsedParameter;
  if (value === null) {
    return { read: true, prices: [] };
  }
  if (!Array.isArray(value)) {
    return failure(BOT_API_ERRORS.pricesNotArray.description());
  }
  const prices: LabeledPrice[] = [];
  for (const priceValue of value) {
    if (typeof priceValue !== 'object' || priceValue === null || Array.isArray(priceValue)) {
      return failure(
        BOT_API_ERRORS.labeledPriceInvalid.description({ reason: 'price_not_object' }),
      );
    }
    const label = 'label' in priceValue ? priceValue.label : undefined;
    const amount = 'amount' in priceValue ? priceValue.amount : undefined;
    if (label === undefined) {
      return failure(
        BOT_API_ERRORS.labeledPriceInvalid.description({
          reason: 'field_missing',
          fieldName: 'label',
        }),
      );
    }
    if (typeof label !== 'string') {
      return failure(invalidParametersDescription);
    }
    if (label.length === 0) {
      return failure(BOT_API_ERRORS.labeledPriceInvalid.description({ reason: 'label_empty' }));
    }
    if (amount === undefined) {
      return failure(
        BOT_API_ERRORS.labeledPriceInvalid.description({
          reason: 'field_missing',
          fieldName: 'amount',
        }),
      );
    }
    if (typeof amount !== 'number') {
      return failure(invalidParametersDescription);
    }
    if (!Number.isInteger(amount) || Math.abs(amount) >= MAX_INT64_MAGNITUDE) {
      return failure(
        BOT_API_ERRORS.labeledPriceInvalid.description({ reason: 'amount_not_integer' }),
      );
    }
    prices.push({ label, amount });
  }
  return { read: true, prices };
}

export type MaxTipAmountReading =
  | { readonly read: true; readonly maxTipAmount: number }
  | { readonly read: false; readonly description: string };

const DECIMAL_INTEGER_PATTERN = /^[+-]?\d+$/;

/**
 * Reads the `max_tip_amount` parameter of `sendInvoice` as the official server does: empty text or
 * none is 0, and other text must be a 64-bit integer, which TDLib then checks.
 */
export function readMaxTipAmountParameter(text: string | undefined): MaxTipAmountReading {
  if (text === undefined || text.length === 0) {
    return { read: true, maxTipAmount: 0 };
  }
  const amount = DECIMAL_INTEGER_PATTERN.test(text) ? Number(text) : Number.NaN;
  return Number.isInteger(amount) && Math.abs(amount) < MAX_INT64_MAGNITUDE
    ? { read: true, maxTipAmount: amount }
    : { read: false, description: BOT_API_ERRORS.maxTipAmountNotNumber.description() };
}

export type SuggestedTipAmountsReading =
  | { readonly read: true; readonly suggestsTips: boolean }
  | { readonly read: false; readonly description: string };

/**
 * Reads the `suggested_tip_amounts` parameter of `sendInvoice`, a JSON array, as far as the
 * emulator needs it: whether it suggests any tip, which the emulator does not support. As the
 * official server reads it, empty text or `null` suggests none; the amounts themselves are not
 * read, since any of them is refused.
 */
export function readSuggestedTipAmountsParameter(
  text: string | undefined,
): SuggestedTipAmountsReading {
  if (text === undefined || text.length === 0) {
    return { read: true, suggestsTips: false };
  }
  const parsedParameter = parseBotApiJsonParameter(text);
  if (parsedParameter === undefined) {
    return {
      read: false,
      description: BOT_API_ERRORS.suggestedTipAmountsJsonInvalid.description(),
    };
  }
  const { value } = parsedParameter;
  if (value === null) {
    return { read: true, suggestsTips: false };
  }
  return Array.isArray(value)
    ? { read: true, suggestsTips: value.length > 0 }
    : { read: false, description: BOT_API_ERRORS.suggestedTipAmountsNotArray.description() };
}
