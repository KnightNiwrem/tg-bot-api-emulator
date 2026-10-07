import type { PermissionGovernedContent } from '../../../types/chat_permissions.ts';
import { MAX_PHOTO_UPLOAD_BYTES, type StoredFile } from '../../../types/stored_file.ts';
import type { BotUploadTooBigFailure } from '../../../types/upload_profile.ts';
import { botApiError, type BotApiMethodAnswer } from './method_call.ts';

/** Telegram's descriptions for message text and buttons it refuses to send. */
export const MESSAGE_TEXT_EMPTY_DESCRIPTION = 'Bad Request: message text is empty';
export const MESSAGE_TEXT_TOO_LONG_DESCRIPTION = 'Bad Request: message is too long';
export const BUTTON_DATA_INVALID_DESCRIPTION = 'Bad Request: BUTTON_DATA_INVALID';
/** Telegram's description for a button its servers do not allow in the chat, such as a Web App. */
export const BUTTON_TYPE_INVALID_DESCRIPTION = 'Bad Request: BUTTON_TYPE_INVALID';

/** Telegram's descriptions for files a message cannot send. */
const FILE_EMPTY_DESCRIPTION = 'Bad Request: file must be non-empty';
const IMAGE_INVALID_DESCRIPTION = 'Bad Request: IMAGE_PROCESS_FAILED';
const PHOTO_DIMENSIONS_INVALID_DESCRIPTION = 'Bad Request: PHOTO_INVALID_DIMENSIONS';
const FILE_ID_INVALID_DESCRIPTION = 'Bad Request: wrong file identifier/HTTP URL specified';
const REQUEST_ENTITY_TOO_LARGE_DESCRIPTION = 'Request Entity Too Large';

/** Telegram's description for a caption longer than it allows. */
export const CAPTION_TOO_LONG_DESCRIPTION = 'Bad Request: message caption is too long';

/** TDLib's names of file types in its errors about a file of the wrong type. */
export const TDLIB_FILE_TYPE_NAMES = {
  photo: 'Photo',
  document: 'Document',
  video: 'Video',
  voice: 'VoiceNote',
  audio: 'Audio',
  thumbnail: 'Thumbnail',
} as const;

/**
 * TDLib's `can_send_message_content` errors, as the official Bot API server reports them, for each
 * kind of content a member lacks the permission to send.
 */
export const SEND_PERMISSION_MISSING_DESCRIPTIONS = {
  text: 'Bad Request: not enough rights to send text messages to the chat',
  photo: 'Bad Request: not enough rights to send photos to the chat',
  document: 'Bad Request: not enough rights to send documents to the chat',
  video: 'Bad Request: not enough rights to send videos to the chat',
  voice: 'Bad Request: not enough rights to send voice notes to the chat',
  audio: 'Bad Request: not enough rights to send music to the chat',
  poll: 'Bad Request: not enough rights to send polls to the chat',
  rich_message: 'Bad Request: not enough rights to send the rich message to the chat',
  contact: 'Bad Request: not enough rights to send contacts to the chat',
  location: 'Bad Request: not enough rights to send locations to the chat',
} as const satisfies Record<PermissionGovernedContent['kind'], string>;

/** Why a file a request sends cannot be used: an upload Telegram refuses, or its `file_id`. */
type FileResolutionFailure =
  | {
    readonly reason:
      | 'file_empty'
      | 'image_invalid'
      | 'photo_dimensions_invalid'
      | 'file_id_invalid';
  }
  | { readonly reason: 'photo_too_big'; readonly fileSizeBytes: number }
  | BotUploadTooBigFailure
  | {
    readonly reason: 'file_type_mismatch';
    readonly expectedFileType: StoredFile['type'];
    readonly actualFileType: StoredFile['type'];
  };

/**
 * Telegram's error for a file larger than the session's Bot API server lets a bot upload. Telegram's
 * own server answers `413 Request Entity Too Large` without reading the request; this limit is not
 * in the server's source, so the answer is the one bots observe. A local server's limit is enforced
 * by Telegram after the upload, with an error that is not in the source either; the emulator words
 * it as TDLib's `check_full_local_location` words its own size checks.
 */
function botUploadTooBigAnswer(failure: BotUploadTooBigFailure): BotApiMethodAnswer {
  return failure.uploadProfile === 'cloud'
    ? botApiError(413, REQUEST_ENTITY_TOO_LARGE_DESCRIPTION)
    : botApiError(
      400,
      `Bad Request: file of size ${failure.fileSizeBytes} bytes is too big; ` +
        `the maximum size is ${failure.maxFileSizeBytes} bytes`,
    );
}

/** Telegram's error for a file it cannot send: an upload it refuses, or an unusable `file_id`. */
export function fileResolutionFailureAnswer(failure: FileResolutionFailure): BotApiMethodAnswer {
  switch (failure.reason) {
    case 'file_empty':
      return botApiError(400, FILE_EMPTY_DESCRIPTION);
    case 'image_invalid':
      return botApiError(400, IMAGE_INVALID_DESCRIPTION);
    case 'photo_dimensions_invalid':
      return botApiError(400, PHOTO_DIMENSIONS_INVALID_DESCRIPTION);
    case 'photo_too_big':
      return botApiError(
        400,
        `Bad Request: file of size ${failure.fileSizeBytes} bytes is too big for a photo; ` +
          `the maximum size is ${MAX_PHOTO_UPLOAD_BYTES} bytes`,
      );
    case 'bot_upload_too_big':
      return botUploadTooBigAnswer(failure);
    case 'file_id_invalid':
      return botApiError(400, FILE_ID_INVALID_DESCRIPTION);
    case 'file_type_mismatch':
      return botApiError(
        400,
        `Bad Request: can't use file of type ${TDLIB_FILE_TYPE_NAMES[failure.actualFileType]} as ${
          TDLIB_FILE_TYPE_NAMES[failure.expectedFileType]
        }`,
      );
    default: {
      const unhandledFailure: never = failure;
      throw new Error(`Unhandled file failure: ${JSON.stringify(unhandledFailure)}`);
    }
  }
}
