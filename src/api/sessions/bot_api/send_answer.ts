import type { EmulationSession } from '../../../types/emulation_session.ts';
import {
  MAX_POLL_OPEN_PERIOD_SECONDS,
  MAX_POLL_OPTION_COUNT,
  MAX_POLL_OPTION_TEXT_LENGTH,
  MAX_POLL_QUESTION_LENGTH,
  MAX_QUIZ_EXPLANATION_LENGTH,
  MAX_QUIZ_EXPLANATION_LINE_FEEDS,
  MIN_POLL_OPEN_PERIOD_SECONDS,
} from '../../../types/poll.ts';
import { BOT_BLOCKED_DESCRIPTION, supergroupBotAccessFailureAnswer } from './chat_access.ts';
import {
  BUTTON_DATA_INVALID_DESCRIPTION,
  BUTTON_TYPE_INVALID_DESCRIPTION,
  CAPTION_TOO_LONG_DESCRIPTION,
  fileResolutionFailureAnswer,
  MESSAGE_TEXT_EMPTY_DESCRIPTION,
  MESSAGE_TEXT_TOO_LONG_DESCRIPTION,
  SEND_PERMISSION_MISSING_DESCRIPTIONS,
} from './message_content_answers.ts';
import {
  badRequestDescription,
  botApiError,
  type BotApiMethodAnswer,
  botApiResult,
} from './method_call.ts';

/** Telegram's description for a reply to a message it cannot find. */
const REPLY_MESSAGE_NOT_FOUND_DESCRIPTION = 'Bad Request: message to be replied not found';

/** Telegram's description for a reply quote that the replied message does not contain. */
const QUOTE_TEXT_INVALID_DESCRIPTION = 'Bad Request: QUOTE_TEXT_INVALID';

/** TDLib's descriptions for polls it refuses to create. */
const POLL_QUESTION_TOO_LONG_DESCRIPTION =
  `Bad Request: poll question length must not exceed ${MAX_POLL_QUESTION_LENGTH}`;
const POLL_OPTIONS_MISSING_DESCRIPTION = 'Bad Request: poll must have at least one answer option';
const POLL_HAS_TOO_MANY_OPTIONS_DESCRIPTION =
  `Bad Request: poll can't have more than ${MAX_POLL_OPTION_COUNT} options`;
const POLL_OPTION_TOO_LONG_DESCRIPTION =
  `Bad Request: poll options length must not exceed ${MAX_POLL_OPTION_TEXT_LENGTH}`;
const QUIZ_CORRECT_OPTIONS_MISSING_DESCRIPTION =
  'Bad Request: correct quiz option list must be non-empty';
const QUIZ_CORRECT_OPTIONS_NOT_INCREASING_DESCRIPTION =
  'Bad Request: correct quiz option list must be increasing';
const QUIZ_CORRECT_OPTION_NOT_FOUND_DESCRIPTION = 'Bad Request: wrong quiz correct_option_id';

/**
 * The emulator's descriptions for limits the Bot API documents and Telegram's servers enforce, whose
 * own descriptions are not in the open-source code.
 */
const QUIZ_EXPLANATION_TOO_LONG_DESCRIPTION =
  `Bad Request: quiz explanation must have at most ${MAX_QUIZ_EXPLANATION_LENGTH} characters`;
const QUIZ_EXPLANATION_HAS_TOO_MANY_LINE_FEEDS_DESCRIPTION =
  `Bad Request: quiz explanation must have at most ${MAX_QUIZ_EXPLANATION_LINE_FEEDS} line feeds`;
const POLL_OPEN_PERIOD_INVALID_DESCRIPTION =
  `Bad Request: open_period must be from ${MIN_POLL_OPEN_PERIOD_SECONDS} to ${MAX_POLL_OPEN_PERIOD_SECONDS} seconds`;
const POLL_CLOSE_DATE_INVALID_DESCRIPTION =
  `Bad Request: close_date must be from ${MIN_POLL_OPEN_PERIOD_SECONDS} to ${MAX_POLL_OPEN_PERIOD_SECONDS} seconds in the future`;

/** TDLib's description for a message effect in a chat that cannot use one. */
const MESSAGE_EFFECT_NOT_ALLOWED_IN_CHAT_DESCRIPTION =
  "Bad Request: can't use message effects in the chat";

type SendResult = ReturnType<EmulationSession['botApi']['sendMessage']>;

/** Why a send method sent no message. */
type SendFailure = Extract<SendResult, { readonly sent: false }>;

/** Telegram's answer to a send method: the message it sent, or its error for why none was sent. */
export function sendMethodAnswer(result: SendResult | SendFailure): BotApiMethodAnswer {
  if (result.sent) {
    return botApiResult(result.message);
  }
  switch (result.reason) {
    case 'message_text_empty':
      return botApiError(400, MESSAGE_TEXT_EMPTY_DESCRIPTION);
    case 'text_invalid':
      return botApiError(400, badRequestDescription(result.textError));
    case 'chat_not_found':
    case 'bot_not_a_member':
    case 'bot_kicked':
      return supergroupBotAccessFailureAnswer(result.reason);
    case 'reply_message_not_found':
      return botApiError(400, REPLY_MESSAGE_NOT_FOUND_DESCRIPTION);
    case 'message_effect_not_allowed_in_chat':
      return botApiError(400, MESSAGE_EFFECT_NOT_ALLOWED_IN_CHAT_DESCRIPTION);
    case 'message_text_too_long':
      return botApiError(400, MESSAGE_TEXT_TOO_LONG_DESCRIPTION);
    case 'caption_too_long':
      return botApiError(400, CAPTION_TOO_LONG_DESCRIPTION);
    case 'callback_data_invalid':
      return botApiError(400, BUTTON_DATA_INVALID_DESCRIPTION);
    case 'button_type_invalid':
      return botApiError(400, BUTTON_TYPE_INVALID_DESCRIPTION);
    case 'quote_invalid':
      return botApiError(400, QUOTE_TEXT_INVALID_DESCRIPTION);
    case 'send_permission_missing':
      return botApiError(400, SEND_PERMISSION_MISSING_DESCRIPTIONS[result.contentKind]);
    case 'poll_question_too_long':
      return botApiError(400, POLL_QUESTION_TOO_LONG_DESCRIPTION);
    case 'poll_options_missing':
      return botApiError(400, POLL_OPTIONS_MISSING_DESCRIPTION);
    case 'poll_has_too_many_options':
      return botApiError(400, POLL_HAS_TOO_MANY_OPTIONS_DESCRIPTION);
    case 'poll_option_too_long':
      return botApiError(400, POLL_OPTION_TOO_LONG_DESCRIPTION);
    case 'quiz_correct_options_missing':
      return botApiError(400, QUIZ_CORRECT_OPTIONS_MISSING_DESCRIPTION);
    case 'quiz_correct_options_not_increasing':
      return botApiError(400, QUIZ_CORRECT_OPTIONS_NOT_INCREASING_DESCRIPTION);
    case 'quiz_correct_option_not_found':
      return botApiError(400, QUIZ_CORRECT_OPTION_NOT_FOUND_DESCRIPTION);
    case 'quiz_explanation_too_long':
      return botApiError(400, QUIZ_EXPLANATION_TOO_LONG_DESCRIPTION);
    case 'quiz_explanation_has_too_many_line_feeds':
      return botApiError(400, QUIZ_EXPLANATION_HAS_TOO_MANY_LINE_FEEDS_DESCRIPTION);
    case 'poll_open_period_invalid':
      return botApiError(400, POLL_OPEN_PERIOD_INVALID_DESCRIPTION);
    case 'poll_close_date_invalid':
      return botApiError(400, POLL_CLOSE_DATE_INVALID_DESCRIPTION);
    case 'bot_blocked':
      return botApiError(403, BOT_BLOCKED_DESCRIPTION);
    case 'file_empty':
    case 'image_invalid':
    case 'photo_dimensions_invalid':
    case 'file_id_invalid':
      return fileResolutionFailureAnswer({ reason: result.reason });
    case 'photo_too_big':
    case 'bot_upload_too_big':
    case 'file_type_mismatch':
      return fileResolutionFailureAnswer(result);
    default: {
      const unhandledFailure: never = result;
      throw new Error(`Unhandled send failure: ${JSON.stringify(unhandledFailure)}`);
    }
  }
}
