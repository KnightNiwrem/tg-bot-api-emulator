/** Telegram's descriptions for a list of message identifiers it rejects. */
export const MESSAGE_IDENTIFIERS_NOT_SPECIFIED_DESCRIPTION =
  'Bad Request: message identifiers are not specified';
export const TOO_MANY_MESSAGE_IDENTIFIERS_DESCRIPTION =
  'Bad Request: too many message identifiers specified';
export const INVALID_MESSAGE_IDENTIFIER_DESCRIPTION =
  'Bad Request: invalid message identifier specified';

/** Telegram reads a missing or non-positive `message_id` as 0, which identifies no message. */
export const NO_MESSAGE_ID = 0;

/** The message a `message_id` parameter identifies, as Telegram reads a missing or non-positive one. */
export function messageIdOrNone(messageId: number | undefined): number {
  return messageId === undefined || messageId <= 0 ? NO_MESSAGE_ID : messageId;
}
