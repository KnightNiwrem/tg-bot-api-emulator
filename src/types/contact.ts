/**
 * The most characters of a contact's first or last name, as TDLib's `contact` object documents
 * them: a first name of 1–64 characters and a last name of 0–64.
 */
export const MAX_CONTACT_NAME_LENGTH = 64;

/** The most bytes of a contact's vCard, encoded in UTF-8, as the Bot API documents for `sendContact`. */
const MAX_CONTACT_VCARD_BYTES = 2_048;

/**
 * A phone contact that a message shows, as TDLib's `Contact` holds it. Telegram reads none of its
 * text: the phone number is whatever its sender wrote, and the vCard is never parsed.
 */
export interface Contact {
  readonly phoneNumber: string;
  readonly firstName: string;
  /** Empty for a contact without a last name. */
  readonly lastName: string;
  /** Empty for a contact without a vCard. */
  readonly vcard: string;
  /**
   * The Telegram user the contact is, which Telegram's servers attach; omitted when unknown. The
   * emulator never looks a user up by phone number, so it knows the user only of an account's own
   * contact, which the account shares.
   */
  readonly userId?: number;
}

/** A contact as its sender writes it, which names no Telegram user. */
export type WrittenContact = Omit<Contact, 'userId'>;

/**
 * The contact a sender writes, with only the texts it gives: whatever else the value carries, such
 * as a user, is dropped, since Telegram's servers, not the sender, attach a contact's user.
 */
export function createWrittenContact(
  { phoneNumber, firstName, lastName, vcard }: WrittenContact,
): Contact {
  return { phoneNumber, firstName, lastName, vcard };
}

const utf8Encoder = new TextEncoder();

/** Whether a vCard fits in the bytes the Bot API documents for it. */
export function isContactVcardWithinLimit(vcard: string): boolean {
  return utf8Encoder.encode(vcard).length <= MAX_CONTACT_VCARD_BYTES;
}
