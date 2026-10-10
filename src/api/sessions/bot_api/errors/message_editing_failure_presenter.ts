import type { EmulationSession } from '../../../../types/emulation_session.ts';
import { BOT_CHAT_ACCESS_ERRORS } from '../chat_access.ts';
import type { BotApiMethodAnswer } from '../method_call.ts';
import { BOT_API_ERRORS } from './error_catalogue.ts';
import { type FixedBotApiError, presentFixedBotApiError } from './error_template.ts';
import {
  FIXED_MESSAGE_CONTENT_ERRORS,
  presentDetailedMessageContentFailure,
} from './message_content_failure_presenter.ts';

type BotApi = EmulationSession['botApi'];

type Failure<Result> = Extract<Result, { readonly edited: false }>;

/** Why an edit of a message addressed by its chat failed; each edit method fails for a subset. */
type ChatMessageEditFailure =
  | Failure<ReturnType<BotApi['editMessageText']>>
  | Failure<ReturnType<BotApi['editMessageCaption']>>
  | Failure<ReturnType<BotApi['editMessageMedia']>>
  | Failure<ReturnType<BotApi['editMessageReplyMarkup']>>;

/** Why an edit of a message addressed by its inline message identifier failed. */
type InlineMessageEditFailure =
  | Failure<ReturnType<BotApi['editInlineMessageText']>>
  | Failure<ReturnType<BotApi['editInlineMessageCaption']>>
  | Failure<ReturnType<BotApi['editInlineMessageMedia']>>
  | Failure<ReturnType<BotApi['editInlineMessageReplyMarkup']>>;

/** Why `stopPoll` stopped no poll. */
type PollStopFailure = Extract<ReturnType<BotApi['stopPoll']>, { readonly stopped: false }>;

/**
 * The operation of the message editing family that failed: an edit of a message addressed by its
 * chat or by its inline message identifier, or the stop of a poll, which edits its message.
 */
type MessageEditingOperation = 'chat_message_edit' | 'inline_message_edit' | 'poll_stop';

/**
 * Telegram's errors for a message the operation does not find. The official server's
 * `check_message` names the message by its role; Telegram's servers know an inline message only by
 * its identifier.
 */
const MESSAGE_NOT_FOUND_ERRORS = {
  chat_message_edit: BOT_API_ERRORS.messageToEditNotFound,
  inline_message_edit: BOT_API_ERRORS.inlineMessageIdInvalid,
  poll_stop: BOT_API_ERRORS.messageWithPollToStopNotFound,
} as const satisfies Readonly<Record<MessageEditingOperation, FixedBotApiError>>;

/** Telegram's errors for the other failures of the family that carry no details, by reason. */
const FIXED_MESSAGE_EDITING_ERRORS = {
  ...FIXED_MESSAGE_CONTENT_ERRORS,
  ...BOT_CHAT_ACCESS_ERRORS,
  message_not_editable: BOT_API_ERRORS.messageNotEditable,
  message_has_no_text: BOT_API_ERRORS.messageHasNoText,
  message_has_no_caption: BOT_API_ERRORS.messageHasNoCaption,
  message_media_not_editable: BOT_API_ERRORS.messageMediaNotEditable,
  album_media_kind_changed: BOT_API_ERRORS.albumMediaTypeUnchangeable,
  message_not_modified: BOT_API_ERRORS.messageNotModified,
  inline_message_upload_unsupported: BOT_API_ERRORS.inlineMessageContentInvalid,
  message_has_no_poll: BOT_API_ERRORS.messageHasNoPoll,
  poll_not_stoppable: BOT_API_ERRORS.pollNotStoppable,
  poll_already_closed: BOT_API_ERRORS.pollAlreadyClosed,
} as const satisfies Readonly<Record<string, FixedBotApiError>>;

/** Telegram's error for a failure of the message editing family, in the context of its operation. */
export function presentMessageEditingFailure(
  operation: 'chat_message_edit',
  failure: ChatMessageEditFailure,
): BotApiMethodAnswer;
export function presentMessageEditingFailure(
  operation: 'inline_message_edit',
  failure: InlineMessageEditFailure,
): BotApiMethodAnswer;
export function presentMessageEditingFailure(
  operation: 'poll_stop',
  failure: PollStopFailure,
): BotApiMethodAnswer;
export function presentMessageEditingFailure(
  operation: MessageEditingOperation,
  failure: ChatMessageEditFailure | InlineMessageEditFailure | PollStopFailure,
): BotApiMethodAnswer {
  switch (failure.reason) {
    case 'text_invalid':
    case 'send_permission_missing':
    case 'photo_too_big':
    case 'bot_upload_too_big':
    case 'file_type_mismatch':
      return presentDetailedMessageContentFailure(failure);
    case 'message_not_found':
      return presentFixedBotApiError(MESSAGE_NOT_FOUND_ERRORS[operation]);
    default:
      return presentFixedBotApiError(FIXED_MESSAGE_EDITING_ERRORS[failure.reason]);
  }
}
