import { BOT_CHAT_ACCESS_ERRORS } from '../chat_access.ts';
import type {
  SendChatActionResult,
  SendInvoiceResult,
  SendMediaGroupResult,
  SendMessageDraftResult,
} from '../message_sends.ts';
import type { BotApiMethodAnswer } from '../method_call.ts';
import { BOT_API_ERRORS } from './error_catalogue.ts';
import {
  type FixedBotApiError,
  presentBotApiError,
  presentFixedBotApiError,
} from './error_template.ts';
import {
  FIXED_MESSAGE_CONTENT_ERRORS,
  presentDetailedMessageContentFailure,
} from './message_content_failure_presenter.ts';

/**
 * Why a message, an album, or an invoice was not sent. An album and an invoice fail for any reason
 * a single message does, and for their own.
 */
type MessageSendFailure =
  | Extract<SendMediaGroupResult, { readonly sent: false }>
  | Extract<SendInvoiceResult, { readonly sent: false }>;

/** Why a chat action was not shown. */
type ChatActionFailure = Extract<SendChatActionResult, { readonly sent: false }>;

/** Why a message draft was not shown. */
type MessageDraftFailure = Extract<SendMessageDraftResult, { readonly sent: false }>;

/**
 * The operation of the message sending family that failed: sending a message or an album, which
 * forwards and copies share, or showing a chat action or a message draft before one.
 */
type MessageSendingOperation = 'message_send' | 'chat_action' | 'message_draft';

/** Telegram's errors for the failures of the family that carry no details, by reason. */
const FIXED_MESSAGE_SENDING_ERRORS = {
  ...FIXED_MESSAGE_CONTENT_ERRORS,
  ...BOT_CHAT_ACCESS_ERRORS,
  bot_blocked: BOT_API_ERRORS.botBlocked,
  reply_message_not_found: BOT_API_ERRORS.replyMessageNotFound,
  quote_invalid: BOT_API_ERRORS.quoteTextInvalid,
  message_effect_not_allowed_in_chat: BOT_API_ERRORS.messageEffectNotAllowedInChat,
  poll_question_too_long: BOT_API_ERRORS.pollQuestionTooLong,
  poll_options_missing: BOT_API_ERRORS.pollOptionsMissing,
  poll_has_too_many_options: BOT_API_ERRORS.pollHasTooManyOptions,
  poll_option_too_long: BOT_API_ERRORS.pollOptionTooLong,
  quiz_correct_options_missing: BOT_API_ERRORS.quizCorrectOptionsMissing,
  quiz_correct_options_not_increasing: BOT_API_ERRORS.quizCorrectOptionsNotIncreasing,
  quiz_correct_option_not_found: BOT_API_ERRORS.quizCorrectOptionNotFound,
  quiz_explanation_too_long: BOT_API_ERRORS.quizExplanationTooLong,
  quiz_explanation_has_too_many_line_feeds: BOT_API_ERRORS.quizExplanationHasTooManyLineFeeds,
  poll_open_period_invalid: BOT_API_ERRORS.pollOpenPeriodInvalid,
  poll_close_date_invalid: BOT_API_ERRORS.pollCloseDateInvalid,
  album_empty: BOT_API_ERRORS.albumEmpty,
  album_too_large: BOT_API_ERRORS.albumTooLarge,
  album_caption_placement_mixed: BOT_API_ERRORS.albumCaptionPlacementMixed,
  album_documents_mixed: BOT_API_ERRORS.albumDocumentsMixed,
  album_audio_mixed: BOT_API_ERRORS.albumAudioMixed,
  draft_chat_not_private: BOT_API_ERRORS.draftChatNotPrivate,
  draft_id_missing: BOT_API_ERRORS.draftIdInvalid,
  invoice_chat_not_private: BOT_API_ERRORS.invoiceChatNotPrivate,
  invoice_prices_empty: BOT_API_ERRORS.invoicePricesEmpty,
  invoice_price_amount_too_big: BOT_API_ERRORS.invoicePriceAmountTooBig,
  invoice_total_not_positive: BOT_API_ERRORS.invoiceTotalNotPositive,
  invoice_total_too_big: BOT_API_ERRORS.invoiceTotalTooBig,
  stars_invoice_price_count_invalid: BOT_API_ERRORS.starsInvoicePriceCountInvalid,
  invoice_title_length_invalid: BOT_API_ERRORS.invoiceTitleLengthInvalid,
  invoice_description_length_invalid: BOT_API_ERRORS.invoiceDescriptionLengthInvalid,
  invoice_payload_length_invalid: BOT_API_ERRORS.invoicePayloadLengthInvalid,
} as const satisfies Readonly<Record<string, FixedBotApiError>>;

/**
 * Telegram's error for a failure of the message sending family, in the context of the operation
 * that failed: text too long for a draft is refused by Telegram's servers rather than by TDLib,
 * with an answer bots observe.
 */
export function presentMessageSendingFailure(
  operation: 'message_send',
  failure: MessageSendFailure,
): BotApiMethodAnswer;
export function presentMessageSendingFailure(
  operation: 'chat_action',
  failure: ChatActionFailure,
): BotApiMethodAnswer;
export function presentMessageSendingFailure(
  operation: 'message_draft',
  failure: MessageDraftFailure,
): BotApiMethodAnswer;
export function presentMessageSendingFailure(
  operation: MessageSendingOperation,
  failure: MessageSendFailure | ChatActionFailure | MessageDraftFailure,
): BotApiMethodAnswer {
  switch (failure.reason) {
    case 'text_invalid':
    case 'send_permission_missing':
    case 'photo_too_big':
    case 'bot_upload_too_big':
    case 'file_type_mismatch':
      return presentDetailedMessageContentFailure(failure);
    case 'invoice_text_invalid':
      return presentBotApiError(BOT_API_ERRORS.invoiceTextEncodingInvalid, { text: failure.text });
    case 'media_group_member_not_sent':
      return presentBotApiError(BOT_API_ERRORS.albumMemberUploadRefused, {
        memberPosition: failure.memberPosition,
        refusal: failure.failure,
      });
    case 'message_text_too_long':
      return presentFixedBotApiError(
        operation === 'message_draft'
          ? BOT_API_ERRORS.draftTextTooLong
          : BOT_API_ERRORS.messageTextTooLong,
      );
    default:
      return presentFixedBotApiError(FIXED_MESSAGE_SENDING_ERRORS[failure.reason]);
  }
}
