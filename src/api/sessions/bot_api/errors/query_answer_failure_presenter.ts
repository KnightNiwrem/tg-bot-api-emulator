import type { EmulationSession } from '../../../../session/emulation_session.ts';
import type { BotApiMethodAnswer } from '../method_call.ts';
import { BOT_API_ERRORS } from './error_catalogue.ts';
import {
  type FixedBotApiError,
  presentBotApiError,
  presentFixedBotApiError,
} from './error_template.ts';

type BotApi = EmulationSession['botApi'];

/** Why a callback query was not answered. */
type CallbackQueryAnswerFailure = Extract<
  ReturnType<BotApi['answerCallbackQuery']>,
  { readonly answered: false }
>;

/** Why an inline query was not answered. */
type InlineQueryAnswerFailure = Extract<
  ReturnType<BotApi['answerInlineQuery']>,
  { readonly answered: false }
>;

/**
 * Telegram's errors for the failures of the query answer family that carry no details, by reason.
 * An inline query's answer goes to Telegram's servers as a whole, so content they refuse is
 * reported with their own error names rather than TDLib's wording for a sent message.
 */
const FIXED_QUERY_ANSWER_ERRORS = {
  callback_query_not_answerable: BOT_API_ERRORS.queryIdInvalid,
  url_invalid: BOT_API_ERRORS.callbackQueryAnswerUrlInvalid,
  start_parameter_empty: BOT_API_ERRORS.inlineQueryStartParameterEmpty,
  start_parameter_too_long: BOT_API_ERRORS.inlineQueryStartParameterTooLong,
  start_parameter_invalid: BOT_API_ERRORS.inlineQueryStartParameterInvalid,
  too_many_results: BOT_API_ERRORS.tooManyInlineQueryResults,
  query_id_invalid: BOT_API_ERRORS.queryIdInvalid,
  next_offset_invalid: BOT_API_ERRORS.inlineQueryNextOffsetInvalid,
  result_id_empty: BOT_API_ERRORS.inlineQueryResultIdEmpty,
  result_id_invalid: BOT_API_ERRORS.inlineQueryResultIdInvalid,
  result_id_duplicate: BOT_API_ERRORS.inlineQueryResultIdDuplicate,
  article_title_empty: BOT_API_ERRORS.inlineQueryArticleTitleEmpty,
  document_title_empty: BOT_API_ERRORS.inlineQueryDocumentTitleEmpty,
  video_title_empty: BOT_API_ERRORS.inlineQueryVideoTitleEmpty,
  web_document_url_invalid: BOT_API_ERRORS.inlineQueryWebDocumentUrlInvalid,
  photo_thumbnail_url_empty: BOT_API_ERRORS.inlineQueryPhotoThumbnailUrlEmpty,
  callback_data_invalid: BOT_API_ERRORS.buttonDataInvalid,
  message_text_too_long: BOT_API_ERRORS.inlineQueryMessageTooLong,
  caption_too_long: BOT_API_ERRORS.inlineQueryCaptionTooLong,
  file_id_invalid: BOT_API_ERRORS.inlineQueryFileIdInvalid,
  inline_message_content_invalid: BOT_API_ERRORS.inlineQueryResultContentInvalid,
  contact_phone_number_empty: BOT_API_ERRORS.inlineQueryContactPhoneNumberEmpty,
  contact_first_name_empty: BOT_API_ERRORS.inlineQueryContactFirstNameEmpty,
} as const satisfies Readonly<Record<string, FixedBotApiError>>;

/** Telegram's error for a callback query or an inline query the bot failed to answer. */
export function presentQueryAnswerFailure(
  failure: CallbackQueryAnswerFailure | InlineQueryAnswerFailure,
): BotApiMethodAnswer {
  switch (failure.reason) {
    case 'text_invalid':
      return presentBotApiError(BOT_API_ERRORS.textInvalid, failure);
    case 'file_type_mismatch':
      return presentBotApiError(BOT_API_ERRORS.fileTypeMismatch, failure);
    default:
      return presentFixedBotApiError(FIXED_QUERY_ANSWER_ERRORS[failure.reason]);
  }
}
