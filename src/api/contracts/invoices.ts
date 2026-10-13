/**
 * Wire facts of the invoices a bot sends to its private chats, as the Bot API's `Invoice` shows
 * them: payable in Telegram Stars, without the bot's payload or the invoice's receipt.
 */
import { z } from 'zod';

import type { ReadonlySnapshot } from './readonly_snapshot.ts';

/** The currency code of Telegram Stars, the only currency of the emulator's invoices. */
const TELEGRAM_STARS_CURRENCY = 'XTR';

/** An invoice, in the field order of the official Bot API server's `JsonInvoice`. */
export const invoiceSchema = z.strictObject({
  title: z.string().min(1),
  description: z.string().min(1),
  /** Empty for an invoice without a deep-linking start parameter; never absent. */
  start_parameter: z.string(),
  currency: z.literal(TELEGRAM_STARS_CURRENCY),
  /** The total price in Telegram Stars. */
  total_amount: z.int().positive(),
});

/** An invoice a bot sent to its private chat with an account, payable in Telegram Stars. */
export type Invoice = ReadonlySnapshot<z.output<typeof invoiceSchema>>;
