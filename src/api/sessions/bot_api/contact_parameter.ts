import { z } from 'zod';

import { isContactVcardWithinLimit, MAX_CONTACT_NAME_LENGTH } from '../../../types/contact.ts';
import { countTextCharacters } from '../../../types/virtual_message.ts';

/**
 * A contact's first or last name, which may be at most as long as TDLib documents for a contact.
 * The emulator refuses a longer one, as it cannot tell how Telegram's servers refuse it.
 */
export const contactNameSchema = z.string().refine((name) =>
  countTextCharacters(name) <= MAX_CONTACT_NAME_LENGTH
);

/**
 * A contact's vCard, which may be at most as long as the Bot API documents; missing reads as empty.
 * The emulator refuses a longer one, as it cannot tell how Telegram's servers refuse it.
 */
export const contactVcardSchema = z.string().default('').refine(isContactVcardWithinLimit);
