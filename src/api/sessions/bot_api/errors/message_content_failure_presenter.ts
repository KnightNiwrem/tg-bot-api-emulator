import type { PermissionGovernedContent } from '../../../../types/chat_permissions.ts';
import type { StoredFile } from '../../../../types/stored_file.ts';
import type { BotUploadTooBigFailure } from '../../../../types/upload_profile.ts';
import type { BotApiMethodAnswer } from '../method_call.ts';
import { BOT_API_ERRORS } from './error_catalogue.ts';
import { type FixedBotApiError, presentBotApiError } from './error_template.ts';

/**
 * Telegram's errors for the content of a message that a send or an edit refuses without further
 * details: its text, its buttons, and the files it names. Sending and editing present these alike.
 */
export const FIXED_MESSAGE_CONTENT_ERRORS = {
  message_text_empty: BOT_API_ERRORS.messageTextEmpty,
  message_text_too_long: BOT_API_ERRORS.messageTextTooLong,
  caption_too_long: BOT_API_ERRORS.captionTooLong,
  callback_data_invalid: BOT_API_ERRORS.buttonDataInvalid,
  button_type_invalid: BOT_API_ERRORS.buttonTypeInvalid,
  file_empty: BOT_API_ERRORS.fileEmpty,
  image_invalid: BOT_API_ERRORS.imageInvalid,
  photo_dimensions_invalid: BOT_API_ERRORS.photoDimensionsInvalid,
  file_id_invalid: BOT_API_ERRORS.fileIdInvalid,
} as const satisfies Readonly<Record<string, FixedBotApiError>>;

/** Why a message's content cannot be sent, with the details its error describes. */
export type DetailedMessageContentFailure =
  | { readonly reason: 'text_invalid'; readonly textError: string }
  | {
    readonly reason: 'send_permission_missing';
    readonly contentKind: PermissionGovernedContent['kind'];
  }
  | { readonly reason: 'photo_too_big'; readonly fileSizeBytes: number }
  | BotUploadTooBigFailure
  | {
    readonly reason: 'file_type_mismatch';
    readonly expectedFileType: StoredFile['type'];
    readonly actualFileType: StoredFile['type'];
  };

/** Telegram's error for message content it refuses, described with the failure's details. */
export function presentDetailedMessageContentFailure(
  failure: DetailedMessageContentFailure,
): BotApiMethodAnswer {
  switch (failure.reason) {
    case 'text_invalid':
      return presentBotApiError(BOT_API_ERRORS.textInvalid, failure);
    case 'send_permission_missing':
      return presentBotApiError(BOT_API_ERRORS.sendPermissionMissing, failure);
    case 'photo_too_big':
      return presentBotApiError(BOT_API_ERRORS.photoTooBig, failure);
    case 'bot_upload_too_big':
      return presentBotApiError(BOT_API_ERRORS.botUploadTooBig, failure);
    case 'file_type_mismatch':
      return presentBotApiError(BOT_API_ERRORS.fileTypeMismatch, failure);
    default: {
      const unhandledFailure: never = failure;
      throw new Error(`Unhandled message content failure: ${JSON.stringify(unhandledFailure)}`);
    }
  }
}
