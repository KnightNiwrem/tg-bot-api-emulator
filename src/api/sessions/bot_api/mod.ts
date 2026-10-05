import { type Context, Hono } from 'hono';
import { z } from 'zod';

import { toCurrentBotApiMethodName } from '../../../types/bot_api_method_name.ts';
import {
  MAX_BOT_COMMAND_DESCRIPTION_LENGTH,
  MAX_BOT_COMMAND_LENGTH,
} from '../../../types/bot_command.ts';
import { MAX_CALLBACK_QUERY_ANSWER_TEXT_LENGTH } from '../../../types/callback_query.ts';
import {
  grantSupergroupAdministratorRights,
  SUPERGROUP_ADMINISTRATOR_RIGHTS,
  type SupergroupAdministratorRights,
  type SupergroupBotAccessFailureReason,
} from '../../../types/chat_membership.ts';
import type { EmulationSession } from '../../../types/emulation_session.ts';
import {
  createGeoLocation,
  isPointOnEarth,
  MAX_HORIZONTAL_ACCURACY_METERS,
} from '../../../types/geo_location.ts';
import type { InlineKeyboard } from '../../../types/inline_keyboard.ts';
import {
  MAX_POLL_OPEN_PERIOD_SECONDS,
  MAX_POLL_OPTION_COUNT,
  MAX_POLL_OPTION_TEXT_LENGTH,
  MAX_POLL_QUESTION_LENGTH,
  MAX_QUIZ_EXPLANATION_LENGTH,
  MAX_QUIZ_EXPLANATION_LINE_FEEDS,
  MIN_POLL_OPEN_PERIOD_SECONDS,
} from '../../../types/poll.ts';
import type { BotMessageReplyMarkup } from '../../../types/reply_interface.ts';
import type { RichMessage } from '../../../types/rich_message.ts';
import {
  MAX_MEDIA_DURATION_SECONDS,
  MAX_PHOTO_UPLOAD_BYTES,
  MAX_VIDEO_SIDE_LENGTH,
  type StoredFile,
} from '../../../types/stored_file.ts';
import type { BotUploadTooBigFailure } from '../../../types/upload_profile.ts';
import { isUserId } from '../../../types/telegram_identity.ts';
import type { VirtualBotProfile } from '../../../types/virtual_bot.ts';
import type { ChatAction } from '../../../types/virtual_chat.ts';
import { fileDownloadResponse } from '../file_download.ts';
import type { SessionRouteContextTypes } from '../session_route_context_types.ts';
import {
  botCommandScopeParameter,
  botCommandsParameter,
  readBotCommandScopeParameter,
} from './bot_command_parameters.ts';
import { readChatAdministratorRightsParameter } from './chat_administrator_rights_parameter.ts';
import { readChatPermissionsParameter } from './chat_permissions_parameter.ts';
import { contactNameSchema, contactVcardSchema } from './contact_parameter.ts';
import { readMenuButtonParameter } from './menu_button_parameter.ts';
import {
  messageEntitiesParameter,
  readMessageEntitiesParameter,
} from './message_entities_parameter.ts';
import {
  type InlineQueryResultParameter,
  inlineQueryResultsButtonParameter,
  readInlineQueryResultsParameter,
  readUnreadLocation,
  type UnreadFormattedText,
  type UnreadInputMessageContent,
} from './inline_query_answer_parameters.ts';
import { readInputFileParameter, readThumbnailParameter } from './input_file_parameter.ts';
import {
  getRequestedMediaFile,
  readInputMediaGroupParameter,
  readInputMediaParameter,
  toMediaReplacementRequest,
} from './input_media_parameter.ts';
import {
  describeInputPollOptionTextError,
  readInputPollOptionsParameter,
} from './input_poll_option_parameter.ts';
import { readCorrectOptionIdsParameter } from './quiz_parameters.ts';
import { linkPreviewOptionsParameter } from './link_preview_options_parameter.ts';
import {
  replyParametersParameter,
  selectSpecifiedReplyTarget,
} from './reply_parameters_parameter.ts';
import {
  LOCATION_INVALID_DESCRIPTION,
  readRichMessageParameter,
} from './rich_message_parameter.ts';
import {
  excludeRichMessageWebFiles,
  type RequestedRichMessageFileTypes,
  resolveRequestedInputFile,
  resolveRichMessageWebFiles,
  type WebFileResolution,
} from './web_file_parameter.ts';
import {
  inlineKeyboardMarkupParameter,
  messageReplyMarkupParameter,
} from './reply_markup_parameter.ts';
import { recordBotApiCall } from './call_recording.ts';
import {
  albumMessageNotSentError,
  botApiError,
  type BotApiMethodAnswer,
  type BotApiMethodContext,
  botApiResult,
} from './method_call.ts';
import { takeQueuedAnswer } from './queued_answer.ts';
import {
  booleanParameter,
  type BotApiRequestParameters,
  type BotApiUploadedFiles,
  CHAT_USERNAME_PREFIX,
  type ChatIdentifier,
  decodeBotApiRequestParameters,
  integerParameter,
  jsonParameter,
  numberParameter,
  optionalInt64Identifier,
} from './request_parameters.ts';

const BOT_TOKEN_PATH_PARAMETER = 'botTokenPathSegment';
const BOT_TOKEN_PATH_PREFIX = 'bot';
const BOT_TOKEN_PATH = `/:${BOT_TOKEN_PATH_PARAMETER}{${BOT_TOKEN_PATH_PREFIX}[^/]+}` as const;
const BOT_API_SUBRESOURCE_PATH = `${BOT_TOKEN_PATH}/*` as const;
const BOT_API_METHOD_NAME_PARAMETER = 'methodName';
/** Everything after the token is the method name, as in the official Bot API server. */
const BOT_API_METHOD_PATH = `${BOT_TOKEN_PATH}/:${BOT_API_METHOD_NAME_PARAMETER}{.*}` as const;
const FILE_PATH_PARAMETER = 'filePath';
/** Where bots download files, as Telegram serves them: `/file/bot<token>/<file_path>`. */
const BOT_FILE_DOWNLOAD_PATH =
  `/file/:${BOT_TOKEN_PATH_PARAMETER}{${BOT_TOKEN_PATH_PREFIX}[^/]+}/:${FILE_PATH_PARAMETER}{.+}` as const;

/** Telegram's wording, from `abort_long_poll` in the official Bot API server. */
const TERMINATED_BY_OTHER_LONG_POLL_DESCRIPTION =
  'Conflict: terminated by other getUpdates request; make sure that only one bot instance is running';
const TERMINATED_BY_WEBHOOK_DESCRIPTION = 'Conflict: terminated by setWebhook request';
const WEBHOOK_ACTIVE_DESCRIPTION =
  "Conflict: can't use getUpdates method while webhook is active; use deleteWebhook to delete the webhook first";

/** Telegram's answers to setWebhook and deleteWebhook, by what the request did. */
const SET_WEBHOOK_OUTCOME_DESCRIPTIONS = {
  webhook_set: 'Webhook was set',
  webhook_already_set: 'Webhook is already set',
  webhook_deleted: 'Webhook was deleted',
  webhook_already_deleted: 'Webhook is already deleted',
} as const;

/** Telegram's descriptions for rejected setWebhook requests. */
const SET_WEBHOOK_REJECTION_DESCRIPTIONS = {
  url_invalid: 'Bad Request: invalid webhook URL specified',
  secret_token_too_long: 'Bad Request: secret token is too long',
  secret_token_invalid: 'Bad Request: secret token contains illegal characters',
} as const;

/**
 * The emulator's descriptions for webhook options it does not support: Telegram connects to a
 * webhook at a given IP address, or trusts its self-signed certificate.
 */
const WEBHOOK_IP_ADDRESS_UNSUPPORTED_DESCRIPTION =
  'Bad Request: webhook IP addresses are not supported';
const WEBHOOK_CERTIFICATE_UNSUPPORTED_DESCRIPTION =
  'Bad Request: custom webhook certificates are not supported';

/** Telegram's default and range for `max_connections`, to which it clamps other values. */
const DEFAULT_WEBHOOK_MAX_CONNECTIONS = 40;
const MIN_WEBHOOK_MAX_CONNECTIONS = 1;
const MAX_WEBHOOK_MAX_CONNECTIONS = 100;

/** Telegram's descriptions for rejected sendMessage requests. */
const MESSAGE_TEXT_EMPTY_DESCRIPTION = 'Bad Request: message text is empty';
const CHAT_ID_EMPTY_DESCRIPTION = 'Bad Request: chat_id is empty';
const CHAT_NOT_FOUND_DESCRIPTION = 'Bad Request: chat not found';
const REPLY_MESSAGE_NOT_FOUND_DESCRIPTION = 'Bad Request: message to be replied not found';
const MESSAGE_TEXT_TOO_LONG_DESCRIPTION = 'Bad Request: message is too long';
const BUTTON_DATA_INVALID_DESCRIPTION = 'Bad Request: BUTTON_DATA_INVALID';
/** Telegram's description for a button its servers do not allow in the chat, such as a Web App. */
const BUTTON_TYPE_INVALID_DESCRIPTION = 'Bad Request: BUTTON_TYPE_INVALID';
const QUOTE_TEXT_INVALID_DESCRIPTION = 'Bad Request: QUOTE_TEXT_INVALID';
const URL_INVALID_DESCRIPTION = 'Bad Request: URL_INVALID';

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

/** TDLib's descriptions for message effects in chats or requests that cannot use them. */
const MESSAGE_EFFECT_NOT_ALLOWED_IN_CHAT_DESCRIPTION =
  "Bad Request: can't use message effects in the chat";
const MESSAGE_EFFECT_NOT_ALLOWED_IN_METHOD_DESCRIPTION =
  "Bad Request: can't use message effects in the method";

/** Telegram's description for a message or chat action to a user who blocked the bot. */
const BOT_BLOCKED_DESCRIPTION = 'Forbidden: bot was blocked by the user';

/** Telegram's descriptions for a request to a supergroup that the bot left or was removed from. */
const BOT_NOT_SUPERGROUP_MEMBER_DESCRIPTION =
  'Forbidden: bot is not a member of the supergroup chat';
const BOT_KICKED_FROM_SUPERGROUP_DESCRIPTION = 'Forbidden: bot was kicked from the supergroup chat';

/** Telegram's descriptions for files a message cannot send. */
const FILE_EMPTY_DESCRIPTION = 'Bad Request: file must be non-empty';
const IMAGE_INVALID_DESCRIPTION = 'Bad Request: IMAGE_PROCESS_FAILED';
const PHOTO_DIMENSIONS_INVALID_DESCRIPTION = 'Bad Request: PHOTO_INVALID_DIMENSIONS';
const FILE_ID_INVALID_DESCRIPTION = 'Bad Request: wrong file identifier/HTTP URL specified';
const REQUEST_ENTITY_TOO_LARGE_DESCRIPTION = 'Request Entity Too Large';
const CAPTION_TOO_LONG_DESCRIPTION = 'Bad Request: message caption is too long';

/** TDLib's names of file types in its errors about a file of the wrong type. */
const TDLIB_FILE_TYPE_NAMES = {
  photo: 'Photo',
  document: 'Document',
  video: 'Video',
  voice: 'VoiceNote',
  thumbnail: 'Thumbnail',
} as const;

/** Telegram's descriptions for rejected getFile requests. */
const FILE_ID_NOT_SPECIFIED_DESCRIPTION = 'Bad Request: file_id not specified';
const GET_FILE_ID_INVALID_DESCRIPTION = 'Bad Request: invalid file_id';
const FILE_TOO_BIG_DESCRIPTION = 'Bad Request: file is too big';

/** Telegram's descriptions for message text or formatting it cannot read. */
const FORMATTED_TEXT_TOO_LONG_DESCRIPTION = 'Bad Request: text is too long';
const PARSE_MODE_UNSUPPORTED_DESCRIPTION = 'Bad Request: unsupported parse_mode';
const TEXT_ENCODING_INVALID_DESCRIPTION = 'Bad Request: text must be encoded in UTF-8';

/** TDLib's description for a rich message edit of an inline message that uploads a file. */
const INLINE_MESSAGE_CONTENT_INVALID_DESCRIPTION = 'Bad Request: invalid message content specified';

/** Telegram's descriptions for rejected message edits. */
const MESSAGE_IDENTIFIER_NOT_SPECIFIED_DESCRIPTION =
  'Bad Request: message identifier is not specified';
const MESSAGE_TO_EDIT_NOT_FOUND_DESCRIPTION = 'Bad Request: message to edit not found';
const MESSAGE_HAS_NO_TEXT_DESCRIPTION = 'Bad Request: there is no text in the message to edit';
const MESSAGE_HAS_NO_CAPTION_DESCRIPTION =
  'Bad Request: there is no caption in the message to edit';
const MESSAGE_NOT_EDITABLE_DESCRIPTION = "Bad Request: message can't be edited";
/** TDLib's `can_edit_message_media` refuses to edit the media of a voice note or a poll. */
const MESSAGE_MEDIA_NOT_EDITABLE_DESCRIPTION = "Bad Request: message media can't be edited";

/** The descriptions of the Bot API server's `check_message` and TDLib's `stop_poll`. */
const MESSAGE_WITH_POLL_TO_STOP_NOT_FOUND_DESCRIPTION =
  'Bad Request: message with poll to stop not found';
const MESSAGE_HAS_NO_POLL_DESCRIPTION = 'Bad Request: message is not a poll';
const POLL_NOT_STOPPABLE_DESCRIPTION = "Bad Request: poll can't be stopped";
const POLL_ALREADY_CLOSED_DESCRIPTION = 'Bad Request: poll has already been closed';
/** TDLib's `edit_message_media` keeps a message of an album to its kind of media. */
const ALBUM_MEDIA_TYPE_UNCHANGEABLE_DESCRIPTION =
  "Bad Request: can't change media type in the album";
const MESSAGE_NOT_MODIFIED_DESCRIPTION =
  'Bad Request: message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message';

/**
 * Telegram's descriptions for rejected pins: the official server's `check_message` and
 * `getChatPinnedMessage` failure, TDLib's `can_pin_message` errors, and Telegram's refusal of a pin
 * that changes nothing, which the server passes on.
 */
const MESSAGE_TO_PIN_NOT_FOUND_DESCRIPTION = 'Bad Request: message to pin not found';
const MESSAGE_TO_UNPIN_NOT_FOUND_DESCRIPTION = 'Bad Request: message to unpin not found';
const NOT_ENOUGH_RIGHTS_TO_PIN_DESCRIPTION =
  'Bad Request: not enough rights to manage pinned messages in the chat';
const SERVICE_MESSAGE_NOT_PINNABLE_DESCRIPTION = "Bad Request: service messages can't be pinned";
const PINNED_MESSAGE_NOT_MODIFIED_DESCRIPTION = 'Bad Request: CHAT_NOT_MODIFIED';

/** Telegram's descriptions for rejected message deletions. */
const MESSAGE_TO_DELETE_NOT_FOUND_DESCRIPTION = 'Bad Request: message to delete not found';
const MESSAGE_NOT_DELETABLE_DESCRIPTION = "Bad Request: message can't be deleted";
const MESSAGE_IDENTIFIERS_NOT_SPECIFIED_DESCRIPTION =
  'Bad Request: message identifiers are not specified';
const TOO_MANY_MESSAGE_IDENTIFIERS_DESCRIPTION =
  'Bad Request: too many message identifiers specified';
const INVALID_MESSAGE_IDENTIFIER_DESCRIPTION = 'Bad Request: invalid message identifier specified';

/** Telegram's descriptions for rejected forwards and copies of messages. */
const FROM_CHAT_ID_REQUIRED_DESCRIPTION = 'Bad Request: parameter "from_chat_id" is required';
const MESSAGE_TO_FORWARD_NOT_FOUND_DESCRIPTION = 'Bad Request: message to forward not found';
const MESSAGE_TO_COPY_NOT_FOUND_DESCRIPTION = 'Bad Request: message to copy not found';
const MESSAGE_NOT_FORWARDABLE_DESCRIPTION = "Bad Request: the message can't be forwarded";
const MESSAGE_NOT_COPYABLE_DESCRIPTION = "Bad Request: the message can't be copied";
/** TDLib words these alike for forwardMessages and copyMessages, which both forward in TDLib. */
const NO_MESSAGES_TO_FORWARD_DESCRIPTION = 'Bad Request: there are no messages to forward';
const MESSAGE_IDS_NOT_INCREASING_DESCRIPTION =
  'Bad Request: message identifiers must be in a strictly increasing order';
const MESSAGES_NOT_FORWARDABLE_DESCRIPTION = "Bad Request: messages can't be forwarded";

/** Telegram forwards or copies at most 100 messages in one request. */
const MAX_REPEATED_MESSAGES_COUNT = 100;

/** Telegram deletes at most 100 messages in one deleteMessages request. */
const MAX_DELETE_MESSAGES_COUNT = 100;

/** Telegram reads a missing or non-positive `message_id` as 0, which identifies no message. */
const NO_MESSAGE_ID = 0;

/** Telegram's description for an unknown, expired, or already answered callback query. */
const QUERY_ID_INVALID_DESCRIPTION =
  'Bad Request: query is too old and response timeout expired or query ID is invalid';

/** Telegram's descriptions for rejected answerInlineQuery requests, by the failure's reason. */
const ANSWER_INLINE_QUERY_FAILURE_DESCRIPTIONS = {
  start_parameter_empty: "Bad Request: can't use empty start_parameter",
  start_parameter_too_long: 'Bad Request: too long start_parameter specified',
  start_parameter_invalid: 'Bad Request: unallowed characters in start_parameter are used',
  too_many_results: 'Bad Request: too many inline query results specified',
  query_id_invalid: QUERY_ID_INVALID_DESCRIPTION,
  next_offset_invalid: 'Bad Request: NEXT_OFFSET_INVALID',
  result_id_empty: 'Bad Request: RESULT_ID_EMPTY',
  result_id_invalid: 'Bad Request: RESULT_ID_INVALID',
  result_id_duplicate: 'Bad Request: RESULT_ID_DUPLICATE',
  article_title_empty: 'Bad Request: ARTICLE_TITLE_EMPTY',
  document_title_empty: 'Bad Request: FILE_TITLE_EMPTY',
  video_title_empty: 'Bad Request: VIDEO_TITLE_EMPTY',
  web_document_url_invalid: 'Bad Request: WEBDOCUMENT_URL_INVALID',
  photo_thumbnail_url_empty: 'Bad Request: PHOTO_THUMB_URL_EMPTY',
  callback_data_invalid: BUTTON_DATA_INVALID_DESCRIPTION,
  message_text_too_long: 'Bad Request: MESSAGE_TOO_LONG',
  caption_too_long: 'Bad Request: MEDIA_CAPTION_TOO_LONG',
  file_id_invalid: "Bad Request: wrong remote file identifier specified: can't unserialize it",
  inline_message_content_invalid: 'Bad Request: invalid inline message content specified',
  contact_phone_number_empty: 'Bad Request: field "phone_number" must contain a valid phone number',
  contact_first_name_empty: 'Bad Request: field "first_name" must be non-empty',
} as const;

/** How the Bot API server reports that it cannot read an inline query result. */
const INLINE_QUERY_RESULT_ERROR_PREFIX = "can't parse InlineQueryResult: ";

/** How the Bot API server reports that it cannot read the `InputMedia` of `editMessageMedia`. */
const INPUT_MEDIA_ERROR_PREFIX = "can't parse InputMedia: ";

/** Telegram's default and range for how long clients may cache an inline query's answer. */
const DEFAULT_INLINE_QUERY_CACHE_TIME_SECONDS = 300;
const MAX_INLINE_QUERY_CACHE_TIME_SECONDS = 24 * 60 * 60;

/** Telegram's description for an edit of an unknown, deleted, or other bot's inline message. */
const INLINE_MESSAGE_ID_INVALID_DESCRIPTION = 'Bad Request: MESSAGE_ID_INVALID';

/** The prefix of Telegram's descriptions of bad requests. */
const BAD_REQUEST_PREFIX = 'Bad Request: ';

/** Telegram's description for a missing or unknown chat action. */
const CHAT_ACTION_INVALID_DESCRIPTION = 'Bad Request: wrong parameter action in request';

/** Chat actions by the lowercase names Telegram reads, including its older aliases. */
const CHAT_ACTIONS_BY_NAME: ReadonlyMap<string, ChatAction> = new Map([
  ['cancel', 'cancel'],
  ['typing', 'typing'],
  ['record_video', 'record_video'],
  ['upload_video', 'upload_video'],
  ['record_voice', 'record_voice'],
  ['record_audio', 'record_voice'],
  ['upload_voice', 'upload_voice'],
  ['upload_audio', 'upload_voice'],
  ['upload_photo', 'upload_photo'],
  ['upload_document', 'upload_document'],
  ['choose_sticker', 'choose_sticker'],
  ['find_location', 'find_location'],
  ['pick_up_location', 'find_location'],
  ['record_video_note', 'record_video_note'],
  ['upload_video_note', 'upload_video_note'],
]);

/** Telegram's descriptions for rejected command list changes. */
const SCOPE_NOT_ALLOWED_IN_PRIVATE_CHATS_DESCRIPTION =
  "Bad Request: can't use specified scope in private chats";
const LANGUAGE_CODE_INVALID_DESCRIPTION = 'Bad Request: invalid language code specified';
const BOT_COMMAND_FAILURE_DESCRIPTIONS = {
  command_not_utf8: 'Bad Request: command must be encoded in UTF-8',
  command_description_not_utf8: 'Bad Request: command description must be encoded in UTF-8',
  command_empty: 'Bad Request: command must be non-empty',
  command_too_long: `Bad Request: command length must not exceed ${MAX_BOT_COMMAND_LENGTH}`,
  command_description_empty: 'Bad Request: command description must be non-empty',
  command_description_too_long:
    `Bad Request: command description length must not exceed ${MAX_BOT_COMMAND_DESCRIPTION_LENGTH}`,
  too_many_commands: 'Bad Request: BOT_COMMANDS_TOO_MUCH',
  command_invalid: 'Bad Request: BOT_COMMAND_INVALID',
} as const;

/** TDLib's description of text that is not well-formed Unicode, which it rejects first. */
const STRINGS_NOT_UTF8_DESCRIPTION = 'Bad Request: strings must be encoded in UTF-8';

/** Telegram's descriptions for rejected menu buttons and the users they are for. */
const CHAT_ID_INVALID_DESCRIPTION = 'Bad Request: invalid chat_id specified';
const USER_NOT_FOUND_DESCRIPTION = 'Bad Request: user not found';
const MENU_BUTTON_FAILURE_DESCRIPTIONS = {
  user_not_found: USER_NOT_FOUND_DESCRIPTION,
  menu_button_text_empty: 'Bad Request: menu button text must be non-empty',
  menu_button_text_not_utf8: 'Bad Request: menu button text must be encoded in UTF-8',
  menu_button_url_not_utf8: 'Bad Request: menu button URL must be encoded in UTF-8',
} as const;

/**
 * TDLib's `can_send_message_content` errors, as the official Bot API server reports them, for each
 * kind of content a member lacks the permission to send.
 */
const SEND_PERMISSION_MISSING_DESCRIPTIONS = {
  text: 'Bad Request: not enough rights to send text messages to the chat',
  photo: 'Bad Request: not enough rights to send photos to the chat',
  document: 'Bad Request: not enough rights to send documents to the chat',
  video: 'Bad Request: not enough rights to send videos to the chat',
  voice: 'Bad Request: not enough rights to send voice notes to the chat',
  poll: 'Bad Request: not enough rights to send polls to the chat',
  rich_message: 'Bad Request: not enough rights to send the rich message to the chat',
  contact: 'Bad Request: not enough rights to send contacts to the chat',
  location: 'Bad Request: not enough rights to send locations to the chat',
} as const satisfies Record<
  Extract<SendFailure, { readonly reason: 'send_permission_missing' }>['contentKind'],
  string
>;

/** Telegram's descriptions for rejected requests about chat members. */
const USER_ID_INVALID_DESCRIPTION = 'Bad Request: invalid user_id specified';
const MEMBER_NOT_FOUND_DESCRIPTION = 'Bad Request: member not found';
const PRIVATE_CHAT_HAS_NO_ADMINISTRATORS_DESCRIPTION =
  'Bad Request: there are no administrators in the private chat';
const PRIVATE_CHAT_MEMBERS_NOT_BANNABLE_DESCRIPTION =
  "Bad Request: can't ban members in private chats";
const METHOD_UNAVAILABLE_IN_PRIVATE_CHATS_DESCRIPTION =
  'Bad Request: method is available only in supergroup and channel chats';
const CANNOT_RESTRICT_SELF_DESCRIPTION = "Bad Request: can't restrict self";
const CANNOT_UNRESTRICT_SELF_DESCRIPTION = "Bad Request: can't unrestrict self";
const METHOD_UNAVAILABLE_OUTSIDE_SUPERGROUPS_DESCRIPTION =
  'Bad Request: method is available only in supergroups';
const NOT_ENOUGH_RIGHTS_DESCRIPTION = 'Bad Request: not enough rights';
const METHOD_UNAVAILABLE_OUTSIDE_GROUPS_DESCRIPTION =
  'Bad Request: method is available only in groups and supergroups';
const OWNER_CUSTOM_TITLE_DESCRIPTION = 'Bad Request: only the owner can edit their custom title';
const MEMBER_IS_NOT_ADMINISTRATOR_DESCRIPTION = 'Bad Request: user is not an administrator';
const CUSTOM_TITLE_NOT_EDITABLE_DESCRIPTION =
  'Bad Request: not enough rights to change custom title of the user';
/**
 * Telegram's servers refuse titles as `RANK_INVALID` and `RANK_EMOJI_NOT_ALLOWED`, which the
 * official server reports under these names.
 */
const CUSTOM_TITLE_INVALID_DESCRIPTION = 'Bad Request: CUSTOM_TITLE_INVALID';
const CUSTOM_TITLE_EMOJI_NOT_ALLOWED_DESCRIPTION = 'Bad Request: CUSTOM_TITLE_EMOJI_NOT_ALLOWED';
const MEMBER_IS_OWNER_DESCRIPTION = "Bad Request: can't remove chat owner";
const NOT_ENOUGH_RIGHTS_TO_RESTRICT_DESCRIPTION =
  'Bad Request: not enough rights to restrict/unrestrict chat member';
const MEMBER_IS_ADMINISTRATOR_DESCRIPTION = 'Bad Request: user is an administrator of the chat';
const CANNOT_PROMOTE_SELF_DESCRIPTION = "Bad Request: can't promote self";
/** Telegram's servers' errors for promotions, which the official server passes on. */
const MEMBER_NOT_IN_CHAT_DESCRIPTION = 'Bad Request: USER_NOT_MUTUAL_CONTACT';
const MEMBER_KICKED_DESCRIPTION = 'Bad Request: USER_KICKED';
const RIGHTS_NOT_HELD_DESCRIPTION = 'Bad Request: RIGHT_FORBIDDEN';
const BOTS_CANNOT_ADD_MEMBERS_DESCRIPTION = "Bad Request: bots can't add new chat members";
const ANONYMOUS_ADMINISTRATORS_UNSUPPORTED_DESCRIPTION =
  'Bad Request: anonymous administrators are not supported';

const PRIVATE_CHAT_HAS_NO_INVITE_LINKS_DESCRIPTION =
  "Bad Request: can't invite members to a private chat";
const MEMBER_LIMIT_WITH_JOIN_REQUEST_DESCRIPTION =
  "Bad Request: member limit can't be specified for links requiring administrator approval";
const NOT_ENOUGH_RIGHTS_TO_MANAGE_INVITE_LINKS_DESCRIPTION =
  'Bad Request: not enough rights to manage chat invite link';
const PRIVATE_CHAT_HAS_NO_JOIN_REQUESTS_DESCRIPTION =
  "Bad Request: the chat can't have join requests";
const NOT_ENOUGH_RIGHTS_TO_MANAGE_JOIN_REQUESTS_DESCRIPTION =
  'Bad Request: not enough rights to manage chat join requests';
/** Telegram's servers' errors for join requests, which the official server passes on. */
const USER_ALREADY_PARTICIPANT_DESCRIPTION = 'Bad Request: USER_ALREADY_PARTICIPANT';
const JOIN_REQUEST_MISSING_DESCRIPTION = 'Bad Request: HIDE_REQUESTER_MISSING';
/** Telegram's servers' errors for invite links, which the official server passes on. */
const INVITE_LINK_EXPIRY_DATE_INVALID_DESCRIPTION = 'Bad Request: EXPIRE_DATE_INVALID';
const INVITE_LINK_MEMBER_LIMIT_INVALID_DESCRIPTION = 'Bad Request: USAGE_LIMIT_INVALID';

/** Telegram caps how long a client may cache a callback query answer at 30 days. */
const MAX_CALLBACK_QUERY_ANSWER_CACHE_TIME_SECONDS = 30 * 24 * 60 * 60;

/**
 * An integer parameter that the official Bot API server clamps to a range, as its
 * `get_integer_arg` does.
 */
function clampedIntegerParameter(min: number, max: number) {
  return integerParameter(z.int().transform((value) => Math.min(Math.max(value, min), max)));
}

const getMeParametersSchema = z.strictObject({});

const deleteWebhookParametersSchema = z.strictObject({
  drop_pending_updates: booleanParameter().default(false),
});

const setWebhookParametersSchema = z.strictObject({
  url: z.string().default(''),
  certificate: z.string().optional(),
  ip_address: z.string().default(''),
  max_connections: clampedIntegerParameter(
    MIN_WEBHOOK_MAX_CONNECTIONS,
    MAX_WEBHOOK_MAX_CONNECTIONS,
  ).default(DEFAULT_WEBHOOK_MAX_CONNECTIONS),
  // As for getUpdates, a malformed value is rejected rather than ignored.
  allowed_updates: jsonParameter(z.array(z.string())).optional(),
  drop_pending_updates: booleanParameter().default(false),
  secret_token: z.string().default(''),
});

const getWebhookInfoParametersSchema = z.strictObject({});

/**
 * Link preview parameters, which the emulator validates and ignores because it generates no link
 * previews. `disable_web_page_preview` is the older form that Telegram still accepts.
 */
const linkPreviewParametersShape = {
  link_preview_options: linkPreviewOptionsParameter().optional(),
  disable_web_page_preview: booleanParameter().optional(),
};

// An `@username` chat_id reaches here already resolved by `resolveChatUsernameParameters`.
// `reply_to_message_id` and `allow_sending_without_reply` are the older form of
// `reply_parameters`, which Telegram still accepts.
const sendOptionsParametersShape = {
  chat_id: integerParameter(z.int()).optional(),
  disable_notification: booleanParameter().default(false),
  protect_content: booleanParameter().default(false),
  message_effect_id: optionalInt64Identifier().optional(),
  reply_parameters: replyParametersParameter().optional(),
  reply_to_message_id: integerParameter(z.int()).optional(),
  allow_sending_without_reply: booleanParameter().default(false),
};

/** The reply markup that every send method but `sendMediaGroup` attaches to its message. */
const replyMarkupParametersShape = {
  reply_markup: messageReplyMarkupParameter().default({}),
};

/** A caption and its formatting; Telegram treats a missing caption as none. */
const captionParametersShape = {
  caption: z.string().default(''),
  parse_mode: z.string().optional(),
  caption_entities: messageEntitiesParameter().optional(),
};

// Telegram treats a missing parameter as empty text.
const sendMessageParametersSchema = z.strictObject({
  ...sendOptionsParametersShape,
  ...replyMarkupParametersShape,
  text: z.string().default(''),
  parse_mode: z.string().optional(),
  entities: messageEntitiesParameter().optional(),
  ...linkPreviewParametersShape,
});

// As for sendMessage, topics, business connections, paid broadcasts, suggested posts, and
// ephemeral messages are not supported.
const sendRichMessageParametersSchema = z.strictObject({
  ...sendOptionsParametersShape,
  ...replyMarkupParametersShape,
  rich_message: z.string().optional(),
});

// As for sendMessage, topics, business connections, paid broadcasts, and suggested posts are not
// supported; nor are options added after creation, restrictions on who may vote, shuffled options,
// hidden results, descriptions, and media.
const sendPollParametersSchema = z.strictObject({
  ...sendOptionsParametersShape,
  ...replyMarkupParametersShape,
  question: z.string().default(''),
  question_parse_mode: z.string().optional(),
  question_entities: messageEntitiesParameter().optional(),
  options: z.string().optional(),
  is_anonymous: booleanParameter().default(true),
  type: z.string().default(''),
  allows_multiple_answers: booleanParameter().default(false),
  allows_revoting: booleanParameter().optional(),
  correct_option_ids: z.string().optional(),
  correct_option_id: integerParameter(z.int()).optional(),
  explanation: z.string().optional(),
  explanation_parse_mode: z.string().optional(),
  explanation_entities: messageEntitiesParameter().optional(),
  open_period: integerParameter(z.int()).optional(),
  close_date: integerParameter(z.int()).optional(),
  is_closed: booleanParameter().default(false),
});

// As for sendMessage, topics, business connections, paid broadcasts, suggested posts, and
// ephemeral messages are not supported.
const sendContactParametersSchema = z.strictObject({
  ...sendOptionsParametersShape,
  ...replyMarkupParametersShape,
  phone_number: z.string().default(''),
  first_name: contactNameSchema.default(''),
  last_name: contactNameSchema.default(''),
  vcard: contactVcardSchema,
});

/**
 * A decimal number parameter, which the official server trims and reads as `undefined` when empty
 * or missing.
 */
const optionalTrimmedNumberParameter = () =>
  z.string().trim().pipe(z.union([
    z.literal('').transform(() => undefined),
    numberParameter(),
  ])).optional();

// As for sendMessage, topics, business connections, paid broadcasts, suggested posts, and
// ephemeral messages are not supported. Live locations are not supported either: `live_period`,
// `heading` and `proximity_alert_radius` are rejected, even with values that send a static
// location on Telegram, as is an accuracy outside the 0–1500 meters the Bot API documents, which
// Telegram clamps.
const sendLocationParametersSchema = z.strictObject({
  ...sendOptionsParametersShape,
  ...replyMarkupParametersShape,
  latitude: optionalTrimmedNumberParameter(),
  longitude: optionalTrimmedNumberParameter(),
  horizontal_accuracy: optionalTrimmedNumberParameter().refine((accuracy) =>
    accuracy === undefined || (accuracy >= 0 && accuracy <= MAX_HORIZONTAL_ACCURACY_METERS)
  ),
});

const sendPhotoParametersSchema = z.strictObject({
  ...sendOptionsParametersShape,
  ...replyMarkupParametersShape,
  photo: z.string().optional(),
  ...captionParametersShape,
  show_caption_above_media: booleanParameter().default(false),
  has_spoiler: booleanParameter().default(false),
});

// The emulator never detects other media types in documents, so `disable_content_type_detection`
// is validated and ignored.
const sendDocumentParametersSchema = z.strictObject({
  ...sendOptionsParametersShape,
  ...replyMarkupParametersShape,
  document: z.string().optional(),
  thumbnail: z.string().optional(),
  thumb: z.string().optional(),
  ...captionParametersShape,
  disable_content_type_detection: booleanParameter().optional(),
});

// The emulator never inspects or transcodes a video, so `supports_streaming`, which TDLib passes to
// Telegram's servers but the Bot API never shows, is validated and ignored. A cover is not
// supported.
const sendVideoParametersSchema = z.strictObject({
  ...sendOptionsParametersShape,
  ...replyMarkupParametersShape,
  video: z.string().optional(),
  duration: clampedIntegerParameter(0, MAX_MEDIA_DURATION_SECONDS).default(0),
  width: clampedIntegerParameter(0, MAX_VIDEO_SIDE_LENGTH).default(0),
  height: clampedIntegerParameter(0, MAX_VIDEO_SIDE_LENGTH).default(0),
  thumbnail: z.string().optional(),
  thumb: z.string().optional(),
  start_timestamp: clampedIntegerParameter(0, MAX_MEDIA_DURATION_SECONDS).default(0),
  ...captionParametersShape,
  show_caption_above_media: booleanParameter().default(false),
  has_spoiler: booleanParameter().default(false),
  supports_streaming: booleanParameter().optional(),
});

const sendVoiceParametersSchema = z.strictObject({
  ...sendOptionsParametersShape,
  ...replyMarkupParametersShape,
  voice: z.string().optional(),
  ...captionParametersShape,
  duration: clampedIntegerParameter(0, MAX_MEDIA_DURATION_SECONDS).default(0),
});

/**
 * The second from which a forwarded or copied video plays, which other content ignores. As TDLib's
 * `send_message` reads it, a negative second plays the video from its beginning.
 */
const videoStartTimestampParametersShape = {
  video_start_timestamp: integerParameter(z.int().transform((seconds) => Math.max(seconds, 0)))
    .optional(),
};

// As for sending, Telegram accepts only numeric chat IDs of the emulator's chats. Topics, paid
// broadcasts, and suggested posts are not supported.
const forwardMessageParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
  from_chat_id: integerParameter(z.int()).optional(),
  message_id: integerParameter(z.int()).optional(),
  ...videoStartTimestampParametersShape,
  disable_notification: booleanParameter().default(false),
  protect_content: booleanParameter().default(false),
  message_effect_id: optionalInt64Identifier().optional(),
});

// A caption, even an empty one, replaces the caption of copied media; without one, its parse mode
// and entities are ignored, as on Telegram.
const copyMessageParametersSchema = z.strictObject({
  ...sendOptionsParametersShape,
  ...replyMarkupParametersShape,
  from_chat_id: integerParameter(z.int()).optional(),
  message_id: integerParameter(z.int()).optional(),
  ...videoStartTimestampParametersShape,
  caption: z.string().optional(),
  parse_mode: z.string().optional(),
  caption_entities: messageEntitiesParameter().optional(),
  show_caption_above_media: booleanParameter().default(false),
});

// As for sendMessage, topics, business connections, paid broadcasts, and suggested posts are not
// supported. The official server reads no reply markup for albums, so the emulator rejects one.
const sendMediaGroupParametersSchema = z.strictObject({
  ...sendOptionsParametersShape,
  media: z.string().optional(),
});

// As for forwardMessage, topics, paid broadcasts, and suggested posts are not supported. Telegram
// also accepts message identifiers written as strings, as for deleteMessages.
const repeatMessagesParametersShape = {
  chat_id: integerParameter(z.int()).optional(),
  from_chat_id: integerParameter(z.int()).optional(),
  message_ids: jsonParameter(z.array(z.int())).optional(),
  disable_notification: booleanParameter().default(false),
  protect_content: booleanParameter().default(false),
  message_effect_id: optionalInt64Identifier().optional(),
};

const forwardMessagesParametersSchema = z.strictObject(repeatMessagesParametersShape);

const copyMessagesParametersSchema = z.strictObject({
  ...repeatMessagesParametersShape,
  remove_caption: booleanParameter().default(false),
});

/** Where an edit method finds the message: in a chat, or sent through the bot's inline mode. */
const editedMessageParametersShape = {
  chat_id: integerParameter(z.int()).optional(),
  message_id: integerParameter(z.int()).optional(),
  inline_message_id: z.string().default(''),
};

// A `rich_message`, even an empty one, replaces the text and its formatting, as on Telegram.
const editMessageTextParametersSchema = z.strictObject({
  ...editedMessageParametersShape,
  text: z.string().default(''),
  parse_mode: z.string().optional(),
  entities: messageEntitiesParameter().optional(),
  ...linkPreviewParametersShape,
  rich_message: z.string().optional(),
  reply_markup: inlineKeyboardMarkupParameter().optional(),
});

const editMessageCaptionParametersSchema = z.strictObject({
  ...editedMessageParametersShape,
  ...captionParametersShape,
  show_caption_above_media: booleanParameter().default(false),
  reply_markup: inlineKeyboardMarkupParameter().optional(),
});

const editMessageMediaParametersSchema = z.strictObject({
  ...editedMessageParametersShape,
  media: z.string().optional(),
  reply_markup: inlineKeyboardMarkupParameter().optional(),
});

const editMessageReplyMarkupParametersSchema = z.strictObject({
  ...editedMessageParametersShape,
  reply_markup: inlineKeyboardMarkupParameter().optional(),
});

// Business connections are not supported.
const stopPollParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
  message_id: integerParameter(z.int()).optional(),
  reply_markup: inlineKeyboardMarkupParameter().optional(),
});

const deleteMessageParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
  message_id: integerParameter(z.int()).optional(),
});

// Telegram also accepts message identifiers written as strings; rejecting them instead surfaces
// the bot's mistake in tests.
const deleteMessagesParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
  message_ids: jsonParameter(z.array(z.int())).optional(),
});

// Telegram answers with a URL only for game buttons and bot links, neither of which the emulator
// supports, so `url` is rejected as unsupported.
const answerCallbackQueryParametersSchema = z.strictObject({
  callback_query_id: z.string().default(''),
  text: z.string().max(MAX_CALLBACK_QUERY_ANSWER_TEXT_LENGTH).optional(),
  show_alert: booleanParameter().default(false),
  url: z.string().optional(),
  cache_time: integerParameter(z.int().min(0).max(MAX_CALLBACK_QUERY_ANSWER_CACHE_TIME_SECONDS))
    .default(0),
});

// `switch_pm_text` and `switch_pm_parameter` are the older form of a `button` that opens the bot's
// private chat, which Telegram still accepts.
const answerInlineQueryParametersSchema = z.strictObject({
  inline_query_id: z.string().default(''),
  results: jsonParameter(z.array(z.unknown())).optional(),
  cache_time: integerParameter(
    z.int().transform((cacheTimeSeconds) =>
      Math.min(Math.max(cacheTimeSeconds, 0), MAX_INLINE_QUERY_CACHE_TIME_SECONDS)
    ),
  ).default(DEFAULT_INLINE_QUERY_CACHE_TIME_SECONDS),
  is_personal: booleanParameter().default(false),
  next_offset: z.string().default(''),
  button: inlineQueryResultsButtonParameter().optional(),
  switch_pm_text: z.string().default(''),
  switch_pm_parameter: z.string().default(''),
});

// Business connections are not supported.
const pinChatMessageParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
  message_id: integerParameter(z.int()).optional(),
  disable_notification: booleanParameter().default(false),
});

// Telegram reads a missing or zero `message_id` as no target, which unpins the newest pinned
// message; it reads a negative one so too, which the emulator rejects to surface the bot's mistake.
const unpinChatMessageParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
  message_id: integerParameter(z.int().nonnegative()).optional(),
});

const leaveChatParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
});

// Telegram reads a missing title or description as empty text.
const setChatTitleParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
  title: z.string().default(''),
});

const setChatDescriptionParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
  description: z.string().default(''),
});

// As for restrictChatMember, the deprecated permissions given as separate parameters are refused.
const setChatPermissionsParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
  permissions: z.string().optional(),
  use_independent_chat_permissions: booleanParameter().default(false),
});

// Topics and business connections are not supported.
const sendChatActionParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
  action: z.string().default(''),
});

// Telegram treats a missing commands parameter as an empty list, which deletes the list.
const setMyCommandsParametersSchema = z.strictObject({
  commands: botCommandsParameter().default([]),
  scope: botCommandScopeParameter().optional(),
  language_code: z.string().default(''),
});

/** Parameters of getMyCommands and deleteMyCommands, which address one command list. */
const myCommandsTargetParametersSchema = z.strictObject({
  scope: botCommandScopeParameter().optional(),
  language_code: z.string().default(''),
});

const setMyDescriptionParametersSchema = z.strictObject({
  description: z.string().default(''),
  language_code: z.string().default(''),
});

const setMyShortDescriptionParametersSchema = z.strictObject({
  short_description: z.string().default(''),
  language_code: z.string().default(''),
});

/** Parameters of getMyDescription and getMyShortDescription, which address one language. */
const myDescriptionTargetParametersSchema = z.strictObject({
  language_code: z.string().default(''),
});

const setMyDefaultAdministratorRightsParametersSchema = z.strictObject({
  rights: z.string().optional(),
  for_channels: booleanParameter().default(false),
});

const getMyDefaultAdministratorRightsParametersSchema = z.strictObject({
  for_channels: booleanParameter().default(false),
});

// `chat_id` names a private chat by its user's ID. Telegram answers `@username` there as an invalid
// chat_id; the emulator resolves every method's usernames first, so such a request fails as for the
// chat the username names instead.
const setChatMenuButtonParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
  menu_button: z.string().optional(),
});

const getChatMenuButtonParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
});

const getChatMemberParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
  user_id: integerParameter(z.int()).optional(),
});

const getChatAdministratorsParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
  return_bots: booleanParameter().default(false),
});

const getChatMemberCountParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
});

const getChatParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
});

// Telegram always revokes a removed member's access to a supergroup's messages, and the emulator
// shows no member a history it cannot read, so `revoke_messages` is validated and ignored.
const banChatMemberParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
  user_id: integerParameter(z.int()).optional(),
  until_date: integerParameter(z.int()).optional(),
  revoke_messages: booleanParameter().optional(),
});

const setChatAdministratorCustomTitleParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
  user_id: integerParameter(z.int()).optional(),
  custom_title: z.string().optional(),
});

// The official server also reads `can_manage_voice_chats`, the deprecated name of
// `can_manage_video_chats`. It reads the rights that apply only to channels, which TDLib's
// `AdministratorRights` drops in supergroups, and `is_anonymous`, whose administrators the emulator
// does not support.
const promoteChatMemberParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
  user_id: integerParameter(z.int()).optional(),
  is_anonymous: booleanParameter().optional(),
  can_manage_chat: booleanParameter().optional(),
  can_delete_messages: booleanParameter().optional(),
  can_manage_video_chats: booleanParameter().optional(),
  can_manage_voice_chats: booleanParameter().optional(),
  can_restrict_members: booleanParameter().optional(),
  can_promote_members: booleanParameter().optional(),
  can_change_info: booleanParameter().optional(),
  can_invite_users: booleanParameter().optional(),
  can_post_stories: booleanParameter().optional(),
  can_edit_stories: booleanParameter().optional(),
  can_delete_stories: booleanParameter().optional(),
  can_post_messages: booleanParameter().optional(),
  can_edit_messages: booleanParameter().optional(),
  can_pin_messages: booleanParameter().optional(),
  can_manage_topics: booleanParameter().optional(),
  can_manage_direct_messages: booleanParameter().optional(),
  can_manage_tags: booleanParameter().optional(),
  can_send_welcome_messages: booleanParameter().optional(),
});

// Telegram reads a missing name as empty, and a missing or zero `expire_date` or `member_limit` as
// none; it clamps a negative one to zero, which the emulator rejects to surface the bot's mistake.
const createChatInviteLinkParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
  name: z.string().default(''),
  expire_date: integerParameter(z.int().nonnegative()).optional(),
  member_limit: integerParameter(z.int().nonnegative()).optional(),
  creates_join_request: booleanParameter().default(false),
});

/** Parameters of approveChatJoinRequest and declineChatJoinRequest, which name one request. */
const chatJoinRequestDecisionParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
  user_id: integerParameter(z.int()).optional(),
});

// Telegram also reads the deprecated permissions given as separate parameters, such as
// `can_send_messages`; rejecting them instead surfaces the bot's mistake in tests.
const restrictChatMemberParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
  user_id: integerParameter(z.int()).optional(),
  permissions: z.string().optional(),
  use_independent_chat_permissions: booleanParameter().default(false),
  until_date: integerParameter(z.int()).optional(),
});

const unbanChatMemberParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
  user_id: integerParameter(z.int()).optional(),
  only_if_banned: booleanParameter().default(false),
});

const getFileParametersSchema = z.strictObject({
  file_id: z.string().default(''),
});

const getUpdatesParametersSchema = z.strictObject({
  offset: integerParameter(z.int()).optional(),
  limit: integerParameter(z.int().min(1).max(100)).default(100),
  timeout: integerParameter(z.int().min(0).max(50)).default(0),
  // Telegram ignores a malformed value and keeps the current subscription; rejecting it instead
  // surfaces the bot's mistake in tests.
  allowed_updates: jsonParameter(z.array(z.string())).optional(),
});

type BotApiRouteVariables = SessionRouteContextTypes['Variables'] & {
  /** The bot whose token authenticated the request; set before any Bot API method runs. */
  readonly authenticatedBot: VirtualBotProfile;
};

interface BotApiRouteContextTypes {
  readonly Variables: BotApiRouteVariables;
}

/** The outcome of any edit method; each fails for a subset of the reasons. */
type MessageEditResult =
  | ReturnType<EmulationSession['botApi']['editMessageText']>
  | ReturnType<EmulationSession['botApi']['editMessageCaption']>
  | ReturnType<EmulationSession['botApi']['editMessageMedia']>;

type SendResult = ReturnType<EmulationSession['botApi']['sendMessage']>;

type SendMediaGroupResult = ReturnType<EmulationSession['botApi']['sendMediaGroup']>;

/** An album's photo, video, or document as the service sends it, with its file resolved. */
type MediaReplacementRequest = Parameters<
  EmulationSession['botApi']['sendMediaGroup']
>[1]['media'][number];

/** An upload of an album's message that Telegram's servers refused once the album was sent. */
type ServerRefusedUploadFailure = Extract<
  SendMediaGroupResult,
  { readonly reason: 'media_group_member_not_sent' }
>['failure'];

type SendFailure = Extract<SendResult, { readonly sent: false }>;

/** The messages that `forwardMessages` or `copyMessages` repeats, and the chat they go to. */
type RepeatMessagesRequest = Parameters<EmulationSession['botApi']['forwardMessages']>[1];

type RepeatMessagesResult =
  | ReturnType<EmulationSession['botApi']['forwardMessages']>
  | ReturnType<EmulationSession['botApi']['copyMessages']>;

/** The outcome of any edit method for an inline message; each fails for a subset of the reasons. */
type InlineMessageEditResult =
  | ReturnType<EmulationSession['botApi']['editInlineMessageText']>
  | ReturnType<EmulationSession['botApi']['editInlineMessageCaption']>
  | ReturnType<EmulationSession['botApi']['editInlineMessageMedia']>;

type InlineQueryResultRequest = Parameters<
  EmulationSession['botApi']['answerInlineQuery']
>[1]['results'][number];

/** What an inline query result's `input_message_content` sends, as the service reads it. */
type InlineResultMessageContentRequest = NonNullable<InlineQueryResultRequest['messageContent']>;

/** A rich message as the service sends it, with every file it names resolved. */
type SendableRichMessage = Pick<
  Parameters<EmulationSession['botApi']['sendRichMessage']>[1],
  'richMessage' | 'detectsEntities'
>;

/** A rich message as a bot specified it, with the files it names by URL not yet downloaded. */
type SpecifiedRichMessage = Omit<SendableRichMessage, 'richMessage'> & {
  readonly richMessage: RichMessage<RequestedRichMessageFileTypes>;
};

/** New content of a text or rich message, as the service edits a message with it. */
type SendableTextMessageReplacement = Parameters<
  EmulationSession['botApi']['editMessageText']
>[1]['content'];

/** New content of a text or rich message, as `editMessageText` specifies it. */
type TextMessageReplacementRequest =
  | Extract<SendableTextMessageReplacement, { readonly kind: 'text' }>
  | ({ readonly kind: 'rich_message' } & SpecifiedRichMessage);

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

/** Formatted text as a bot specified it, the result of reading its parse mode or entities. */
type SpecifiedFormattedText = Extract<
  FormattedTextReadingResult,
  { readonly read: true }
>['formattedText'];

/** A poll's type as `sendPoll` takes it. */
type PollTypeRequest = Parameters<EmulationSession['botApi']['sendPoll']>[1]['type'];

/** Removes properties from each member of a union, which keeps the union's alternatives apart. */
type OmitFromEach<Type, Key extends PropertyKey> = Type extends unknown ? Omit<Type, Key> : never;

/** Where and how a send method sends its message, which every send method takes alike. */
type SendRequestOptions = OmitFromEach<
  Parameters<EmulationSession['botApi']['sendMessage']>[1],
  'text' | 'entities'
>;

/** The send options of a request, with the reply markup of a method that reads one. */
type SendOptionsParameters =
  & z.infer<z.ZodObject<typeof sendOptionsParametersShape>>
  & Partial<z.infer<z.ZodObject<typeof replyMarkupParametersShape>>>;

type MyCommandsTarget = Parameters<EmulationSession['botApi']['getMyCommands']>[1];

/** Why a request about a chat's members, or a moderation of them, can fail. */
type ChatMemberFailureReason =
  | Extract<
    ReturnType<EmulationSession['botApi']['getChatMember']>,
    { readonly found: false }
  >['reason']
  | Extract<
    ReturnType<EmulationSession['botApi']['getChatAdministrators']>,
    { readonly found: false }
  >['reason']
  | Extract<
    ReturnType<EmulationSession['botApi']['banChatMember']>,
    { readonly banned: false }
  >['reason']
  | Extract<
    ReturnType<EmulationSession['botApi']['unbanChatMember']>,
    { readonly unbanned: false }
  >['reason']
  | Extract<
    ReturnType<EmulationSession['botApi']['restrictChatMember']>,
    { readonly restricted: false }
  >['reason']
  | Exclude<
    Extract<
      ReturnType<EmulationSession['botApi']['promoteChatMember']>,
      { readonly promoted: false }
    >['reason'],
    | 'cannot_promote_self'
    | 'member_not_in_chat'
    | 'member_kicked'
    | 'rights_not_held'
    | 'bots_cannot_add_members'
  >;

type MyCommandsTargetFailureReason = Extract<
  ReturnType<EmulationSession['botApi']['getMyCommands']>,
  { readonly found: false }
>['reason'];

type FormattedTextReadingResult = ReturnType<EmulationSession['botApi']['readFormattedText']>;

/** Message text with the entities its bot specified, or the error answer for reading it. */
type SpecifiedFormattedTextReading =
  | Extract<FormattedTextReadingResult, { readonly read: true }>
  | { readonly read: false; readonly errorAnswer: BotApiMethodAnswer };

/** Text with the entities its bot specified, or Telegram's description of why it is unreadable. */
type FormattedTextParametersReading =
  | Extract<FormattedTextReadingResult, { readonly read: true }>
  | { readonly read: false; readonly description: string };

/** Where an edit method finds the message it edits, or the error answer for its parameters. */
type EditedMessageTargetReading =
  | {
    readonly read: true;
    readonly target:
      | { readonly kind: 'chat_message'; readonly chatId: number; readonly messageId: number }
      | { readonly kind: 'inline_message'; readonly inlineMessageId: string };
  }
  | { readonly read: false; readonly errorAnswer: BotApiMethodAnswer };

export type BotApiMethodHandler = (
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
  uploadedFiles: BotApiUploadedFiles,
) => BotApiMethodAnswer | Promise<BotApiMethodAnswer>;

/** A Bot API method the emulator implements, under its current name. */
export interface BotApiMethod {
  readonly name: string;
  readonly handler: BotApiMethodHandler;
}

const BOT_API_METHODS: readonly BotApiMethod[] = [
  { name: 'answerCallbackQuery', handler: handleAnswerCallbackQuery },
  { name: 'answerInlineQuery', handler: handleAnswerInlineQuery },
  { name: 'approveChatJoinRequest', handler: handleApproveChatJoinRequest },
  { name: 'banChatMember', handler: handleBanChatMember },
  { name: 'copyMessage', handler: handleCopyMessage },
  { name: 'createChatInviteLink', handler: handleCreateChatInviteLink },
  { name: 'declineChatJoinRequest', handler: handleDeclineChatJoinRequest },
  { name: 'copyMessages', handler: handleCopyMessages },
  { name: 'deleteMessage', handler: handleDeleteMessage },
  { name: 'deleteMessages', handler: handleDeleteMessages },
  { name: 'deleteMyCommands', handler: handleDeleteMyCommands },
  { name: 'deleteWebhook', handler: handleDeleteWebhook },
  { name: 'editMessageCaption', handler: handleEditMessageCaption },
  { name: 'editMessageMedia', handler: handleEditMessageMedia },
  { name: 'editMessageReplyMarkup', handler: handleEditMessageReplyMarkup },
  { name: 'editMessageText', handler: handleEditMessageText },
  { name: 'forwardMessage', handler: handleForwardMessage },
  { name: 'forwardMessages', handler: handleForwardMessages },
  { name: 'getChat', handler: handleGetChat },
  { name: 'getChatAdministrators', handler: handleGetChatAdministrators },
  { name: 'getChatMember', handler: handleGetChatMember },
  { name: 'getChatMemberCount', handler: handleGetChatMemberCount },
  { name: 'getChatMenuButton', handler: handleGetChatMenuButton },
  { name: 'getFile', handler: handleGetFile },
  { name: 'getMe', handler: handleGetMe },
  { name: 'getMyCommands', handler: handleGetMyCommands },
  { name: 'getMyDefaultAdministratorRights', handler: handleGetMyDefaultAdministratorRights },
  { name: 'getMyDescription', handler: handleGetMyDescription },
  { name: 'getMyShortDescription', handler: handleGetMyShortDescription },
  { name: 'getUpdates', handler: handleGetUpdates },
  { name: 'getWebhookInfo', handler: handleGetWebhookInfo },
  { name: 'leaveChat', handler: handleLeaveChat },
  { name: 'pinChatMessage', handler: handlePinChatMessage },
  { name: 'promoteChatMember', handler: handlePromoteChatMember },
  { name: 'restrictChatMember', handler: handleRestrictChatMember },
  { name: 'sendChatAction', handler: handleSendChatAction },
  { name: 'sendContact', handler: handleSendContact },
  { name: 'sendDocument', handler: handleSendDocument },
  { name: 'sendLocation', handler: handleSendLocation },
  { name: 'sendMediaGroup', handler: handleSendMediaGroup },
  { name: 'sendMessage', handler: handleSendMessage },
  { name: 'sendPhoto', handler: handleSendPhoto },
  { name: 'sendPoll', handler: handleSendPoll },
  { name: 'sendRichMessage', handler: handleSendRichMessage },
  { name: 'sendVideo', handler: handleSendVideo },
  { name: 'sendVoice', handler: handleSendVoice },
  {
    name: 'setChatAdministratorCustomTitle',
    handler: handleSetChatAdministratorCustomTitle,
  },
  { name: 'setChatDescription', handler: handleSetChatDescription },
  { name: 'setChatMenuButton', handler: handleSetChatMenuButton },
  { name: 'setChatPermissions', handler: handleSetChatPermissions },
  { name: 'setChatTitle', handler: handleSetChatTitle },
  { name: 'setMyCommands', handler: handleSetMyCommands },
  { name: 'setMyDefaultAdministratorRights', handler: handleSetMyDefaultAdministratorRights },
  { name: 'setMyDescription', handler: handleSetMyDescription },
  { name: 'setMyShortDescription', handler: handleSetMyShortDescription },
  { name: 'setWebhook', handler: handleSetWebhook },
  { name: 'stopPoll', handler: handleStopPoll },
  { name: 'unbanChatMember', handler: handleUnbanChatMember },
  { name: 'unpinChatMessage', handler: handleUnpinChatMessage },
];

/** Keyed by lowercase name, because Telegram matches method names case-insensitively. */
const BOT_API_METHODS_BY_LOWERCASE_NAME: ReadonlyMap<string, BotApiMethod> = new Map(
  BOT_API_METHODS.map((method) => [method.name.toLowerCase(), method] as const),
);

/**
 * Finds a Bot API method by its current or older name, which Telegram matches
 * case-insensitively.
 */
export function findBotApiMethod(methodName: string): BotApiMethod | undefined {
  return BOT_API_METHODS_BY_LOWERCASE_NAME.get(toCurrentBotApiMethodName(methodName).toLowerCase());
}

/** A bot's call of a method the emulator implements, as it arrived. */
export interface BotApiMethodCall {
  readonly method: BotApiMethod;
  /** The method name as the bot called it, which may be an older name or differ in case. */
  readonly requestedMethodName: string;
  readonly parameters: BotApiRequestParameters;
  readonly uploadedFiles: BotApiUploadedFiles;
}

/**
 * Runs a bot's call of a method, however the call arrived, unless a test queued a rate limit or
 * server error answer for it, which the call receives instead, before the method reads its
 * parameters or changes anything. The call and its answer are recorded as bot activity.
 */
export async function callBotApiMethod(
  context: BotApiMethodContext,
  { method, requestedMethodName, parameters, uploadedFiles }: BotApiMethodCall,
): Promise<BotApiMethodAnswer> {
  const answer = await answerBotApiMethodCall(context, method, parameters, uploadedFiles);
  recordBotApiCall(context, {
    methodName: method.name,
    requestedMethodName,
    parameters,
    uploadedFiles,
    chatId: findNamedChatId(context, parameters),
  }, answer);
  return answer;
}

/**
 * Answers a call that names no method the emulator implements, however the call arrived, and
 * records it as bot activity.
 */
export function rejectUnknownBotApiMethod(
  context: BotApiMethodContext,
  requestedMethodName: string,
  parameters: BotApiRequestParameters,
  uploadedFiles: BotApiUploadedFiles,
): BotApiMethodAnswer {
  const answer = botApiError(404, 'Not Found: method not found');
  recordBotApiCall(context, {
    methodName: requestedMethodName,
    requestedMethodName,
    parameters,
    uploadedFiles,
    chatId: findNamedChatId(context, parameters),
  }, answer);
  return answer;
}

/**
 * Answers a call of an implemented method whose request could not be decoded, and records it as
 * bot activity without parameters.
 */
function rejectUndecodableBotApiCall(
  context: BotApiMethodContext,
  { name }: BotApiMethod,
  requestedMethodName: string,
  description: string,
): BotApiMethodAnswer {
  const answer = botApiError(400, description);
  recordBotApiCall(context, {
    methodName: name,
    requestedMethodName,
    parameters: {},
    uploadedFiles: new Map(),
    chatId: undefined,
  }, answer);
  return answer;
}

async function answerBotApiMethodCall(
  context: BotApiMethodContext,
  { name, handler }: BotApiMethod,
  parameters: BotApiRequestParameters,
  uploadedFiles: BotApiUploadedFiles,
): Promise<BotApiMethodAnswer> {
  const queuedAnswer = takeQueuedAnswer(context, name);
  if (queuedAnswer !== undefined) {
    return queuedAnswer;
  }
  const chatResolution = resolveChatUsernameParameters(context, parameters);
  return chatResolution.resolved
    ? await handler(context, chatResolution.parameters, uploadedFiles)
    : chatResolution.errorAnswer;
}

const namedChatIdSchema = integerParameter(z.int());

/**
 * Finds the chat a call's `chat_id` names, by its ID or by a public username, for the call's bot
 * activity record; `undefined` when it names no chat.
 */
function findNamedChatId(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): number | undefined {
  const chatIdentifier = parameters.chat_id;
  if (chatIdentifier === undefined) {
    return undefined;
  }
  if (chatIdentifier.startsWith(CHAT_USERNAME_PREFIX)) {
    return resolveChatIdentifier(context, chatIdentifier);
  }
  const chatId = namedChatIdSchema.safeParse(chatIdentifier);
  return chatId.success ? chatId.data : undefined;
}

/** The parameters that name a chat, which the official Bot API server reads with `check_chat`. */
const CHAT_PARAMETER_NAMES = ['chat_id', 'from_chat_id'] as const;

/**
 * Replaces a public username after `@` in the parameters that name a chat with the ID of the chat
 * it names, as the official Bot API server's `check_chat` resolves it before using the chat; a
 * username that names no chat a bot may address fails with `Bad Request: chat not found`.
 *
 * Telegram resolves the username when it checks the chat, after reading most other parameters;
 * the emulator resolves it first, so a request that has another fault too may fail for the
 * username instead.
 */
function resolveChatUsernameParameters(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
):
  | { readonly resolved: true; readonly parameters: BotApiRequestParameters }
  | { readonly resolved: false; readonly errorAnswer: BotApiMethodAnswer } {
  let resolvedParameters = parameters;
  for (const parameterName of CHAT_PARAMETER_NAMES) {
    const chatIdentifier = parameters[parameterName];
    if (!chatIdentifier?.startsWith(CHAT_USERNAME_PREFIX)) {
      continue;
    }
    const chatId = resolveChatIdentifier(context, chatIdentifier);
    if (chatId === undefined) {
      return { resolved: false, errorAnswer: botApiError(400, CHAT_NOT_FOUND_DESCRIPTION) };
    }
    resolvedParameters = { ...resolvedParameters, [parameterName]: String(chatId) };
  }
  return { resolved: true, parameters: resolvedParameters };
}

/**
 * Finds the ID of the chat a JSON field names by its ID or by a public username after `@`, as
 * `check_chat` does; `undefined` for a username that names no chat a bot may address.
 */
function resolveChatIdentifier(
  context: BotApiMethodContext,
  chatIdentifier: ChatIdentifier,
): number | undefined {
  return typeof chatIdentifier === 'number'
    ? chatIdentifier
    : context.session.botApi.findPublicChatId(chatIdentifier.slice(CHAT_USERNAME_PREFIX.length));
}

export function createBotApiRoutes(): Hono<BotApiRouteContextTypes> {
  const botApiRoutes = new Hono<BotApiRouteContextTypes>();

  // Telegram answers a download with an unknown token or path as not found.
  botApiRoutes.get(BOT_FILE_DOWNLOAD_PATH, (context) => {
    const botTokenPathSegment = context.req.param(BOT_TOKEN_PATH_PARAMETER);
    const { botApi } = context.get('emulationSession');
    const authenticatedBot = botApi.authenticate(
      botTokenPathSegment.slice(BOT_TOKEN_PATH_PREFIX.length),
    );
    const file = authenticatedBot === undefined
      ? undefined
      : botApi.downloadFile(authenticatedBot, context.req.param(FILE_PATH_PARAMETER));
    return file === undefined
      ? botApiResponse(context, botApiError(404, 'Not Found'))
      : fileDownloadResponse(context, file);
  });

  // Telegram rejects a path without a method segment before it checks the token.
  botApiRoutes.all(
    BOT_TOKEN_PATH,
    (context) => botApiResponse(context, botApiError(404, 'Not Found')),
  );

  // Telegram rejects an invalid token before it resolves the method or validates parameters.
  botApiRoutes.use(BOT_API_SUBRESOURCE_PATH, async (context, next) => {
    const botTokenPathSegment = context.req.param(BOT_TOKEN_PATH_PARAMETER);
    const token = botTokenPathSegment.slice(BOT_TOKEN_PATH_PREFIX.length);
    const authenticatedBot = context.get('emulationSession').botApi.authenticate(token);
    if (authenticatedBot === undefined) {
      return botApiResponse(context, botApiError(401, 'Unauthorized'));
    }

    context.set('authenticatedBot', authenticatedBot);
    await next();
  });

  // Telegram accepts both HTTP methods for every Bot API method. It rejects an unknown method
  // before it reads the parameters; the emulator reads them anyway to record the call.
  botApiRoutes.on(['GET', 'POST'], BOT_API_METHOD_PATH, async (context) => {
    const requestedMethodName = context.req.param(BOT_API_METHOD_NAME_PARAMETER);
    const method = findBotApiMethod(requestedMethodName);
    const parametersDecoding = await decodeBotApiRequestParameters(context.req.raw);
    const methodContext: BotApiMethodContext = {
      session: context.get('emulationSession'),
      bot: context.get('authenticatedBot'),
      signal: context.req.raw.signal,
      via: 'http',
    };
    if (method === undefined) {
      const { parameters, uploadedFiles } = parametersDecoding.decoded
        ? parametersDecoding
        : { parameters: {}, uploadedFiles: new Map() };
      return botApiResponse(
        context,
        rejectUnknownBotApiMethod(methodContext, requestedMethodName, parameters, uploadedFiles),
      );
    }
    if (!parametersDecoding.decoded) {
      return botApiResponse(
        context,
        rejectUndecodableBotApiCall(
          methodContext,
          method,
          requestedMethodName,
          parametersDecoding.description,
        ),
      );
    }
    return botApiResponse(
      context,
      await callBotApiMethod(methodContext, {
        method,
        requestedMethodName,
        parameters: parametersDecoding.parameters,
        uploadedFiles: parametersDecoding.uploadedFiles,
      }),
    );
  });

  // Telegram answers every other path in its Bot API namespace with a Bot API error.
  botApiRoutes.all('*', (context) => botApiResponse(context, botApiError(404, 'Not Found')));

  return botApiRoutes;
}

function handleGetMe(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  if (!getMeParametersSchema.safeParse(parameters).success) {
    return botApiError(400, 'Bad Request: invalid getMe parameters');
  }
  return botApiResult(context.bot);
}

async function handleGetUpdates(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): Promise<BotApiMethodAnswer> {
  const parsedParameters = getUpdatesParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid getUpdates parameters');
  }

  const result = await context.session.botApi.getUpdates(
    context.bot,
    {
      offset: parsedParameters.data.offset,
      limit: parsedParameters.data.limit,
      timeoutSeconds: parsedParameters.data.timeout,
      allowedUpdates: parsedParameters.data.allowed_updates,
      signal: context.signal,
    },
  );
  if (!result.retrieved) {
    // Telegram delays a conflict by 3 seconds when another occurred within the previous 3
    // seconds; the emulator answers immediately to keep tests fast.
    const { reason } = result;
    switch (reason) {
      case 'terminated_by_other_long_poll':
        return botApiError(409, TERMINATED_BY_OTHER_LONG_POLL_DESCRIPTION);
      case 'terminated_by_webhook':
        return botApiError(409, TERMINATED_BY_WEBHOOK_DESCRIPTION);
      case 'webhook_active':
        return botApiError(409, WEBHOOK_ACTIVE_DESCRIPTION);
      default: {
        const unhandledReason: never = reason;
        throw new Error(`Unhandled getUpdates failure: ${unhandledReason}`);
      }
    }
  }
  return botApiResult(result.updates);
}

function handleSetWebhook(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
  uploadedFiles: BotApiUploadedFiles,
): BotApiMethodAnswer {
  const parsedParameters = setWebhookParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid setWebhook parameters');
  }
  const { data } = parsedParameters;
  if (data.ip_address.length > 0) {
    return botApiError(400, WEBHOOK_IP_ADDRESS_UNSUPPORTED_DESCRIPTION);
  }
  // Telegram reads the certificate from a part of that name or through `attach://`.
  const specifiesCertificate = (data.certificate !== undefined && data.certificate.length > 0) ||
    uploadedFiles.has('certificate');
  if (specifiesCertificate) {
    return botApiError(400, WEBHOOK_CERTIFICATE_UNSUPPORTED_DESCRIPTION);
  }

  const result = context.session.botApi.setWebhook(
    context.bot,
    {
      url: data.url,
      secretToken: data.secret_token,
      maxConnections: data.max_connections,
      allowedUpdates: data.allowed_updates,
      dropPendingUpdates: data.drop_pending_updates,
    },
  );
  if (!result.accepted) {
    return botApiError(400, SET_WEBHOOK_REJECTION_DESCRIPTIONS[result.reason]);
  }
  return botApiResult(true, SET_WEBHOOK_OUTCOME_DESCRIPTIONS[result.outcome]);
}

function handleGetWebhookInfo(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  if (!getWebhookInfoParametersSchema.safeParse(parameters).success) {
    return botApiError(400, 'Bad Request: invalid getWebhookInfo parameters');
  }
  return botApiResult(context.session.botApi.getWebhookInfo(context.bot));
}

function handleDeleteWebhook(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = deleteWebhookParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid deleteWebhook parameters');
  }

  const outcome = context.session.botApi.deleteWebhook(
    context.bot,
    { dropPendingUpdates: parsedParameters.data.drop_pending_updates },
  );
  return botApiResult(true, SET_WEBHOOK_OUTCOME_DESCRIPTIONS[outcome]);
}

function handleSendMessage(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const invalidParametersDescription = 'Bad Request: invalid sendMessage parameters';
  const parsedParameters = sendMessageParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, invalidParametersDescription);
  }
  const { text, parse_mode: parseMode, entities } = parsedParameters.data;
  // Telegram reads the text and its formatting before it looks at the chat.
  const formattedTextReading = readSpecifiedFormattedText(
    context,
    { text, parseMode, entities },
    invalidParametersDescription,
  );
  if (!formattedTextReading.read) {
    return formattedTextReading.errorAnswer;
  }
  const optionsReading = readSendOptions(
    context,
    parsedParameters.data,
    invalidParametersDescription,
  );
  if (!optionsReading.read) {
    return optionsReading.errorAnswer;
  }

  return sendMethodAnswer(context.session.botApi.sendMessage(context.bot, {
    ...optionsReading.options,
    ...formattedTextReading.formattedText,
  }));
}

/**
 * Sends a contact as the official Bot API server's `process_send_contact_query` reads it, before
 * the chat: a phone number and a first name, each required, and an optional last name and vCard.
 * As that method does, a bot names no Telegram user for the contact.
 */
function handleSendContact(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const invalidParametersDescription = 'Bad Request: invalid sendContact parameters';
  const parsedParameters = sendContactParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, invalidParametersDescription);
  }
  const { data } = parsedParameters;
  if (data.phone_number.length === 0) {
    return botApiError(400, 'Bad Request: parameter "phone_number" is required');
  }
  if (data.first_name.length === 0) {
    return botApiError(400, 'Bad Request: parameter "first_name" is required');
  }
  const optionsReading = readSendOptions(context, data, invalidParametersDescription);
  if (!optionsReading.read) {
    return optionsReading.errorAnswer;
  }

  return sendMethodAnswer(context.session.botApi.sendContact(context.bot, {
    ...optionsReading.options,
    contact: {
      phoneNumber: data.phone_number,
      firstName: data.first_name,
      lastName: data.last_name,
      vcard: data.vcard,
    },
  }));
}

/**
 * Sends a static location as the official Bot API server's `process_send_location_query` reads
 * it: the latitude and longitude, each required, and an optional accuracy, which TDLib's
 * `get_input_geo_point` sends as whole meters, rounded up. As TDLib's `Location::init` decides,
 * coordinates that name no point on Earth are refused. The emulator checks them once it has read
 * `chat_id` and the reply markup, but before it looks the chat up, while TDLib checks them once
 * the chat is found.
 */
function handleSendLocation(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const invalidParametersDescription = 'Bad Request: invalid sendLocation parameters';
  const parsedParameters = sendLocationParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, invalidParametersDescription);
  }
  const { data } = parsedParameters;
  if (data.latitude === undefined) {
    return botApiError(400, 'Bad Request: latitude is empty');
  }
  if (data.longitude === undefined) {
    return botApiError(400, 'Bad Request: longitude is empty');
  }
  const optionsReading = readSendOptions(context, data, invalidParametersDescription);
  if (!optionsReading.read) {
    return optionsReading.errorAnswer;
  }
  if (!isPointOnEarth(data.latitude, data.longitude)) {
    return botApiError(400, LOCATION_INVALID_DESCRIPTION);
  }

  return sendMethodAnswer(context.session.botApi.sendLocation(context.bot, {
    ...optionsReading.options,
    location: createGeoLocation(data.latitude, data.longitude, data.horizontal_accuracy ?? 0),
  }));
}

async function handleSendRichMessage(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
  uploadedFiles: BotApiUploadedFiles,
): Promise<BotApiMethodAnswer> {
  const invalidParametersDescription = 'Bad Request: invalid sendRichMessage parameters';
  const parsedParameters = sendRichMessageParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, invalidParametersDescription);
  }
  const { data } = parsedParameters;
  // Telegram reads the rich message before it looks at the chat.
  const richMessageReading = readSpecifiedRichMessage(
    context,
    data.rich_message,
    uploadedFiles,
    invalidParametersDescription,
  );
  if (!richMessageReading.read) {
    return richMessageReading.errorAnswer;
  }
  const optionsReading = readSendOptions(context, data, invalidParametersDescription);
  if (!optionsReading.read) {
    return optionsReading.errorAnswer;
  }

  const richMessageResolution = await resolveSpecifiedRichMessage(
    context,
    richMessageReading.richMessage,
  );
  if (!richMessageResolution.resolved) {
    return richMessageResolution.errorAnswer;
  }

  return sendMethodAnswer(context.session.botApi.sendRichMessage(context.bot, {
    ...optionsReading.options,
    ...richMessageResolution.value,
  }));
}

/** Downloads the files a rich message names by URL, as `resolveRichMessageWebFiles` does. */
async function resolveSpecifiedRichMessage(
  context: BotApiMethodContext,
  { richMessage, detectsEntities }: SpecifiedRichMessage,
): Promise<WebFileResolution<SendableRichMessage>> {
  const resolution = await resolveRichMessageWebFiles(context, richMessage);
  return resolution.resolved
    ? { resolved: true, value: { richMessage: resolution.value, detectsEntities } }
    : resolution;
}

/**
 * Reads a `rich_message` parameter as `readRichMessageParameter` does, with its buttons as
 * `BotApiService.readRichMessageButtons` reads them, answering Telegram's error for a message it
 * cannot read.
 */
function readSpecifiedRichMessage(
  context: BotApiMethodContext,
  richMessageParameter: string | undefined,
  uploadedFiles: BotApiUploadedFiles,
  invalidParametersDescription: string,
):
  | { readonly read: true; readonly richMessage: SpecifiedRichMessage }
  | { readonly read: false; readonly errorAnswer: BotApiMethodAnswer } {
  const parameterReading = readRichMessageParameter(
    richMessageParameter,
    uploadedFiles,
    invalidParametersDescription,
  );
  if (!parameterReading.read) {
    return { read: false, errorAnswer: botApiError(400, parameterReading.description) };
  }
  const buttonReading = context.session.botApi.readRichMessageButtons(
    parameterReading.richMessage,
  );
  if (!buttonReading.read) {
    return {
      read: false,
      errorAnswer: botApiError(400, badRequestDescription(buttonReading.keyboardError)),
    };
  }
  return {
    read: true,
    richMessage: {
      richMessage: buttonReading.richMessage,
      detectsEntities: parameterReading.detectsEntities,
    },
  };
}

/**
 * Sends a poll as the official Bot API server's `process_send_poll_query` reads it, before the
 * chat: the question and the options, each with its formatting, then the poll's type with a quiz's
 * explanation and correct options, then its closing time. `allows_revoting` defaults to true for a
 * regular poll and to false for a quiz. Quiz parameters of a regular poll, which the server
 * ignores, and both `open_period` and `close_date`, of which the server ignores `close_date`, are
 * rejected to surface the bot's mistake.
 */
function handleSendPoll(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const invalidParametersDescription = 'Bad Request: invalid sendPoll parameters';
  const parsedParameters = sendPollParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, invalidParametersDescription);
  }
  const { data } = parsedParameters;
  const questionReading = readFormattedTextParameters(
    context,
    { text: data.question, parseMode: data.question_parse_mode, entities: data.question_entities },
    invalidParametersDescription,
  );
  if (!questionReading.read) {
    return botApiError(400, questionReading.description);
  }
  const optionsReading = readInputPollOptionsParameter(data.options, invalidParametersDescription);
  if (!optionsReading.read) {
    return botApiError(400, optionsReading.description);
  }
  const pollOptions: SpecifiedFormattedText[] = [];
  for (const option of optionsReading.options) {
    const optionReading = readFormattedTextParameters(
      context,
      { text: option.text, parseMode: option.parseMode, entities: option.entities },
      invalidParametersDescription,
    );
    if (!optionReading.read) {
      return botApiError(
        400,
        optionReading.description === invalidParametersDescription
          ? invalidParametersDescription
          : describeInputPollOptionTextError(optionReading.description),
      );
    }
    pollOptions.push(optionReading.formattedText);
  }
  const typeReading = readPollTypeParameters(context, data, invalidParametersDescription);
  if (!typeReading.read) {
    return typeReading.errorAnswer;
  }
  if (data.open_period !== undefined && data.close_date !== undefined) {
    return botApiError(400, "Bad Request: open_period and close_date can't be used together");
  }
  const sendOptionsReading = readSendOptions(context, data, invalidParametersDescription);
  if (!sendOptionsReading.read) {
    return sendOptionsReading.errorAnswer;
  }

  return sendMethodAnswer(context.session.botApi.sendPoll(context.bot, {
    ...sendOptionsReading.options,
    question: questionReading.formattedText,
    pollOptions,
    isAnonymous: data.is_anonymous,
    allowsMultipleAnswers: data.allows_multiple_answers,
    allowsRevoting: data.allows_revoting ?? typeReading.type.kind === 'regular',
    type: typeReading.type,
    isClosed: data.is_closed,
    ...(data.open_period === undefined
      ? {}
      : { closingTime: { kind: 'open_period', openPeriodSeconds: data.open_period } }),
    ...(data.close_date === undefined
      ? {}
      : { closingTime: { kind: 'close_date', closeDateUnixSeconds: data.close_date } }),
  }));
}

/**
 * Reads a poll's type as `process_send_poll_query` reads it: a regular poll, or a quiz, whose
 * explanation is read with its formatting, then its correct options, as
 * `readCorrectOptionIdsParameter` reads them. A regular poll with any quiz parameter answers
 * `invalidParametersDescription`.
 */
function readPollTypeParameters(
  context: BotApiMethodContext,
  parameters: Pick<
    z.infer<typeof sendPollParametersSchema>,
    | 'type'
    | 'correct_option_ids'
    | 'correct_option_id'
    | 'explanation'
    | 'explanation_parse_mode'
    | 'explanation_entities'
  >,
  invalidParametersDescription: string,
):
  | { readonly read: true; readonly type: PollTypeRequest }
  | { readonly read: false; readonly errorAnswer: BotApiMethodAnswer } {
  const {
    type,
    correct_option_ids: correctOptionIds,
    correct_option_id: correctOptionId,
    explanation,
    explanation_parse_mode: explanationParseMode,
    explanation_entities: explanationEntities,
  } = parameters;
  const specifiedQuizParameters = [
    correctOptionIds,
    correctOptionId,
    explanation,
    explanationParseMode,
    explanationEntities,
  ];
  if (type === '' || type === 'regular') {
    return specifiedQuizParameters.some((value) => value !== undefined)
      ? { read: false, errorAnswer: botApiError(400, invalidParametersDescription) }
      : { read: true, type: { kind: 'regular' } };
  }
  if (type !== 'quiz') {
    return {
      read: false,
      errorAnswer: botApiError(400, 'Bad Request: unsupported poll type specified'),
    };
  }
  const explanationReading = readFormattedTextParameters(
    context,
    { text: explanation ?? '', parseMode: explanationParseMode, entities: explanationEntities },
    invalidParametersDescription,
  );
  if (!explanationReading.read) {
    return { read: false, errorAnswer: botApiError(400, explanationReading.description) };
  }
  const correctOptionsReading = readCorrectOptionIdsParameter(correctOptionIds, correctOptionId);
  if (!correctOptionsReading.read) {
    return { read: false, errorAnswer: botApiError(400, correctOptionsReading.description) };
  }
  return {
    read: true,
    type: {
      kind: 'quiz',
      correctOptionPositions: correctOptionsReading.correctOptionPositions,
      explanation: explanationReading.formattedText,
    },
  };
}

async function handleSendPhoto(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
  uploadedFiles: BotApiUploadedFiles,
): Promise<BotApiMethodAnswer> {
  const invalidParametersDescription = 'Bad Request: invalid sendPhoto parameters';
  const parsedParameters = sendPhotoParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, invalidParametersDescription);
  }
  const { data } = parsedParameters;
  // Telegram reads the file, then the caption and its formatting, before it looks at the chat.
  const photoReading = readInputFileParameter('photo', data.photo, uploadedFiles);
  if (!photoReading.read) {
    return missingInputFileError('photo');
  }
  const captionReading = readSpecifiedCaption(context, data, invalidParametersDescription);
  if (!captionReading.read) {
    return captionReading.errorAnswer;
  }
  const optionsReading = readSendOptions(context, data, invalidParametersDescription);
  if (!optionsReading.read) {
    return optionsReading.errorAnswer;
  }

  const photoResolution = await resolveRequestedInputFile(context, photoReading.inputFile, 'photo');
  if (!photoResolution.resolved) {
    return photoResolution.errorAnswer;
  }

  return sendMethodAnswer(context.session.botApi.sendPhoto(context.bot, {
    ...optionsReading.options,
    photo: photoResolution.value,
    caption: captionReading.formattedText,
    hasSpoiler: data.has_spoiler,
    showsCaptionAboveMedia: data.show_caption_above_media,
  }));
}

async function handleSendDocument(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
  uploadedFiles: BotApiUploadedFiles,
): Promise<BotApiMethodAnswer> {
  const invalidParametersDescription = 'Bad Request: invalid sendDocument parameters';
  const parsedParameters = sendDocumentParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, invalidParametersDescription);
  }
  const { data } = parsedParameters;
  // Telegram reads the file, then the caption and its formatting, before it looks at the chat.
  const documentReading = readInputFileParameter('document', data.document, uploadedFiles);
  if (!documentReading.read) {
    return missingInputFileError('document');
  }
  const captionReading = readSpecifiedCaption(context, data, invalidParametersDescription);
  if (!captionReading.read) {
    return captionReading.errorAnswer;
  }
  const optionsReading = readSendOptions(context, data, invalidParametersDescription);
  if (!optionsReading.read) {
    return optionsReading.errorAnswer;
  }

  const documentResolution = await resolveRequestedInputFile(
    context,
    documentReading.inputFile,
    'document',
  );
  if (!documentResolution.resolved) {
    return documentResolution.errorAnswer;
  }

  const thumbnail = readThumbnailParameter(data, uploadedFiles);
  return sendMethodAnswer(context.session.botApi.sendDocument(context.bot, {
    ...optionsReading.options,
    document: documentResolution.value,
    ...(thumbnail === undefined ? {} : { thumbnail }),
    caption: captionReading.formattedText,
  }));
}

async function handleSendVideo(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
  uploadedFiles: BotApiUploadedFiles,
): Promise<BotApiMethodAnswer> {
  const invalidParametersDescription = 'Bad Request: invalid sendVideo parameters';
  const parsedParameters = sendVideoParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, invalidParametersDescription);
  }
  const { data } = parsedParameters;
  // Telegram reads the file, then the caption and its formatting, before it looks at the chat.
  const videoReading = readInputFileParameter('video', data.video, uploadedFiles);
  if (!videoReading.read) {
    return missingInputFileError('video');
  }
  const captionReading = readSpecifiedCaption(context, data, invalidParametersDescription);
  if (!captionReading.read) {
    return captionReading.errorAnswer;
  }
  const optionsReading = readSendOptions(context, data, invalidParametersDescription);
  if (!optionsReading.read) {
    return optionsReading.errorAnswer;
  }

  const videoResolution = await resolveRequestedInputFile(
    context,
    videoReading.inputFile,
    'video',
  );
  if (!videoResolution.resolved) {
    return videoResolution.errorAnswer;
  }

  const thumbnail = readThumbnailParameter(data, uploadedFiles);
  return sendMethodAnswer(context.session.botApi.sendVideo(context.bot, {
    ...optionsReading.options,
    video: videoResolution.value,
    attributes: { durationSeconds: data.duration, width: data.width, height: data.height },
    ...(thumbnail === undefined ? {} : { thumbnail }),
    startTimestampSeconds: data.start_timestamp,
    caption: captionReading.formattedText,
    hasSpoiler: data.has_spoiler,
    showsCaptionAboveMedia: data.show_caption_above_media,
  }));
}

async function handleSendVoice(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
  uploadedFiles: BotApiUploadedFiles,
): Promise<BotApiMethodAnswer> {
  const invalidParametersDescription = 'Bad Request: invalid sendVoice parameters';
  const parsedParameters = sendVoiceParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, invalidParametersDescription);
  }
  const { data } = parsedParameters;
  // Telegram reads the file, then the caption and its formatting, before it looks at the chat.
  const voiceReading = readInputFileParameter('voice', data.voice, uploadedFiles);
  if (!voiceReading.read) {
    return missingInputFileError('voice');
  }
  const captionReading = readSpecifiedCaption(context, data, invalidParametersDescription);
  if (!captionReading.read) {
    return captionReading.errorAnswer;
  }
  const optionsReading = readSendOptions(context, data, invalidParametersDescription);
  if (!optionsReading.read) {
    return optionsReading.errorAnswer;
  }

  const voiceResolution = await resolveRequestedInputFile(
    context,
    voiceReading.inputFile,
    'voice',
  );
  if (!voiceResolution.resolved) {
    return voiceResolution.errorAnswer;
  }

  return sendMethodAnswer(context.session.botApi.sendVoice(context.bot, {
    ...optionsReading.options,
    voice: voiceResolution.value,
    durationSeconds: data.duration,
    caption: captionReading.formattedText,
  }));
}

/**
 * Sends an album, as `BotApiService.sendMediaGroup` does. As the official Bot API server reads
 * them, the media and their captions are read before the chat; the files the media name by URL are
 * then downloaded in order, as for `sendPhoto`.
 */
async function handleSendMediaGroup(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
  uploadedFiles: BotApiUploadedFiles,
): Promise<BotApiMethodAnswer> {
  const invalidParametersDescription = 'Bad Request: invalid sendMediaGroup parameters';
  const parsedParameters = sendMediaGroupParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, invalidParametersDescription);
  }
  const { data } = parsedParameters;
  const mediaReading = readInputMediaGroupParameter(
    data.media,
    uploadedFiles,
    invalidParametersDescription,
  );
  if (!mediaReading.read) {
    return botApiError(400, mediaReading.description);
  }
  const captions: SpecifiedFormattedText[] = [];
  for (const { caption } of mediaReading.media) {
    const captionReading = readEmbeddedFormattedText(
      context,
      caption,
      invalidParametersDescription,
      INPUT_MEDIA_ERROR_PREFIX,
    );
    if (!captionReading.read) {
      return botApiError(400, captionReading.description);
    }
    captions.push(captionReading.formattedText);
  }
  const optionsReading = readSendOptions(context, data, invalidParametersDescription);
  if (!optionsReading.read) {
    return optionsReading.errorAnswer;
  }

  const media: MediaReplacementRequest[] = [];
  for (const [memberIndex, member] of mediaReading.media.entries()) {
    const fileResolution = await resolveRequestedInputFile(
      context,
      getRequestedMediaFile(member),
      member.kind,
      memberIndex + 1,
    );
    if (!fileResolution.resolved) {
      return fileResolution.errorAnswer;
    }
    media.push(toMediaReplacementRequest(member, fileResolution.value, captions[memberIndex]));
  }

  const { chatId, replyTo, isContentProtected, isSilent, messageEffectId } = optionsReading.options;
  return sendMediaGroupAnswer(context.session.botApi.sendMediaGroup(context.bot, {
    chatId,
    replyTo,
    isContentProtected,
    isSilent,
    messageEffectId,
    media,
  }));
}

/**
 * Telegram's answer to `sendMediaGroup`: the album's messages, or, for an album TDLib refuses, the
 * description `fail_query_with_error` gives TDLib's error.
 */
function sendMediaGroupAnswer(result: SendMediaGroupResult): BotApiMethodAnswer {
  if (result.sent) {
    return botApiResult(result.messages);
  }
  switch (result.reason) {
    case 'album_empty':
      return botApiError(400, 'Bad Request: there are no messages to send');
    case 'album_too_large':
      return botApiError(400, 'Bad Request: too many messages to send as an album');
    case 'album_caption_placement_mixed':
      return botApiError(
        400,
        'Bad Request: parameter show_caption_above_media must be the same for all messages',
      );
    case 'album_documents_mixed':
      return botApiError(400, "Bad Request: document can't be mixed with other media types");
    case 'media_group_member_not_sent':
      return albumMessageNotSentError(
        result.memberPosition,
        serverRefusedUploadError(result.failure),
      );
    default:
      return sendMethodAnswer(result);
  }
}

/**
 * The error Telegram's servers give for an upload they refuse, as `albumMessageNotSentError`
 * reports it. A local server's upload limit is enforced with an error that is not in the source;
 * the emulator words it as TDLib's `check_full_local_location` words its own size checks.
 */
function serverRefusedUploadError(failure: ServerRefusedUploadFailure): string {
  switch (failure.reason) {
    case 'image_invalid':
      return 'IMAGE_PROCESS_FAILED';
    case 'photo_dimensions_invalid':
      return 'PHOTO_INVALID_DIMENSIONS';
    case 'bot_upload_too_big':
      return `File of size ${failure.fileSizeBytes} bytes is too big; ` +
        `the maximum size is ${failure.maxFileSizeBytes} bytes`;
    default: {
      const unhandledFailure: never = failure;
      throw new Error(`Unhandled refused upload: ${JSON.stringify(unhandledFailure)}`);
    }
  }
}

function handleForwardMessage(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = forwardMessageParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid forwardMessage parameters');
  }
  const {
    chat_id: chatId,
    from_chat_id: fromChatId,
    message_id: messageId,
    video_start_timestamp: videoStartTimestampSeconds,
    disable_notification: isSilent,
    protect_content: isContentProtected,
    message_effect_id: messageEffectId,
  } = parsedParameters.data;
  if (fromChatId === undefined) {
    return botApiError(400, FROM_CHAT_ID_REQUIRED_DESCRIPTION);
  }
  // Telegram looks for the forwarded message before it looks at chat_id; the emulator reports a
  // missing chat_id first.
  if (chatId === undefined) {
    return botApiError(400, CHAT_ID_EMPTY_DESCRIPTION);
  }

  const result = context.session.botApi.forwardMessage(
    context.bot,
    {
      chatId,
      forwardedMessage: { chatId: fromChatId, messageId: messageIdOrNone(messageId) },
      ...(videoStartTimestampSeconds === undefined ? {} : { videoStartTimestampSeconds }),
      isContentProtected,
      isSilent,
      messageEffectId,
    },
  );
  if (result.sent) {
    return sendMethodAnswer(result);
  }
  switch (result.reason) {
    case 'repeated_message_not_found':
      return botApiError(400, MESSAGE_TO_FORWARD_NOT_FOUND_DESCRIPTION);
    case 'message_not_forwardable':
      return botApiError(400, MESSAGE_NOT_FORWARDABLE_DESCRIPTION);
    default:
      return sendMethodAnswer(result);
  }
}

function handleCopyMessage(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const invalidParametersDescription = 'Bad Request: invalid copyMessage parameters';
  const parsedParameters = copyMessageParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, invalidParametersDescription);
  }
  const { data } = parsedParameters;
  if (data.from_chat_id === undefined) {
    return botApiError(400, FROM_CHAT_ID_REQUIRED_DESCRIPTION);
  }
  // Telegram reads a new caption and its formatting before it looks at either chat.
  const { caption } = data;
  const captionReading = caption === undefined
    ? undefined
    : readSpecifiedCaption(context, { ...data, caption }, invalidParametersDescription);
  if (captionReading?.read === false) {
    return captionReading.errorAnswer;
  }
  // As for forwardMessage, the emulator reports a missing chat_id before the copied message.
  const optionsReading = readSendOptions(context, data, invalidParametersDescription);
  if (!optionsReading.read) {
    return optionsReading.errorAnswer;
  }

  const result = context.session.botApi.copyMessage(
    context.bot,
    {
      ...optionsReading.options,
      copiedMessage: { chatId: data.from_chat_id, messageId: messageIdOrNone(data.message_id) },
      ...(data.video_start_timestamp === undefined
        ? {}
        : { videoStartTimestampSeconds: data.video_start_timestamp }),
      caption: captionReading?.formattedText,
      showsCaptionAboveMedia: data.show_caption_above_media,
    },
  );
  if (result.sent) {
    return botApiResult({ message_id: result.messageId });
  }
  switch (result.reason) {
    case 'repeated_message_not_found':
      return botApiError(400, MESSAGE_TO_COPY_NOT_FOUND_DESCRIPTION);
    case 'message_not_copyable':
      return botApiError(400, MESSAGE_NOT_COPYABLE_DESCRIPTION);
    default:
      return sendMethodAnswer(result);
  }
}

function handleForwardMessages(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = forwardMessagesParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid forwardMessages parameters');
  }
  const reading = readRepeatMessagesRequest(parsedParameters.data);
  if (!reading.read) {
    return reading.errorAnswer;
  }
  return repeatMessagesAnswer(context.session.botApi.forwardMessages(context.bot, reading.request));
}

function handleCopyMessages(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = copyMessagesParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid copyMessages parameters');
  }
  const reading = readRepeatMessagesRequest(parsedParameters.data);
  if (!reading.read) {
    return reading.errorAnswer;
  }
  return repeatMessagesAnswer(
    context.session.botApi.copyMessages(context.bot, {
      ...reading.request,
      removesCaptions: parsedParameters.data.remove_caption,
    }),
  );
}

/**
 * Reads the messages that `forwardMessages` or `copyMessages` repeats and where to, checking them
 * in the order the official Bot API server does.
 */
function readRepeatMessagesRequest(
  parameters: z.output<z.ZodObject<typeof repeatMessagesParametersShape>>,
):
  | { readonly read: true; readonly request: RepeatMessagesRequest }
  | { readonly read: false; readonly errorAnswer: BotApiMethodAnswer } {
  const {
    chat_id: chatId,
    from_chat_id: fromChatId,
    message_ids: messageIds,
    disable_notification: isSilent,
    protect_content: isContentProtected,
    message_effect_id: messageEffectId,
  } = parameters;
  if (fromChatId === undefined) {
    return { read: false, errorAnswer: botApiError(400, FROM_CHAT_ID_REQUIRED_DESCRIPTION) };
  }
  if (messageIds === undefined || messageIds.length === 0) {
    return {
      read: false,
      errorAnswer: botApiError(400, MESSAGE_IDENTIFIERS_NOT_SPECIFIED_DESCRIPTION),
    };
  }
  if (messageIds.length > MAX_REPEATED_MESSAGES_COUNT) {
    return { read: false, errorAnswer: botApiError(400, TOO_MANY_MESSAGE_IDENTIFIERS_DESCRIPTION) };
  }
  if (messageIds.some((messageId) => messageId <= 0)) {
    return { read: false, errorAnswer: botApiError(400, INVALID_MESSAGE_IDENTIFIER_DESCRIPTION) };
  }
  if (chatId === undefined) {
    return { read: false, errorAnswer: botApiError(400, CHAT_ID_EMPTY_DESCRIPTION) };
  }
  return {
    read: true,
    request: { chatId, fromChatId, messageIds, isContentProtected, isSilent, messageEffectId },
  };
}

function repeatMessagesAnswer(result: RepeatMessagesResult): BotApiMethodAnswer {
  if (result.sent) {
    return botApiResult(result.messageIds.map((messageId) => ({ message_id: messageId })));
  }
  switch (result.reason) {
    case 'repeated_messages_not_found':
      return botApiError(400, NO_MESSAGES_TO_FORWARD_DESCRIPTION);
    case 'message_effect_not_allowed_for_several_messages':
      return botApiError(400, MESSAGE_EFFECT_NOT_ALLOWED_IN_METHOD_DESCRIPTION);
    case 'repeated_message_ids_not_increasing':
      return botApiError(400, MESSAGE_IDS_NOT_INCREASING_DESCRIPTION);
    case 'messages_not_repeatable':
      return botApiError(400, MESSAGES_NOT_FORWARDABLE_DESCRIPTION);
    default:
      return sendMethodAnswer(result);
  }
}

/**
 * Reads where and how a send method sends its message, with its reply markup, if the method reads
 * one. As the official Bot API server's `get_reply_parameters` does, the formatting of a quote is
 * read before the chat; as its `check_reply_parameters` does, a reply naming the chat the message
 * is sent to replies in that chat.
 */
function readSendOptions(
  context: BotApiMethodContext,
  parameters: SendOptionsParameters,
  invalidParametersDescription: string,
):
  | { readonly read: true; readonly options: SendRequestOptions }
  | { readonly read: false; readonly errorAnswer: BotApiMethodAnswer } {
  const {
    chat_id: chatId,
    disable_notification: isSilent,
    protect_content: isContentProtected,
    message_effect_id: messageEffectId,
    reply_markup: replyMarkup,
  } = parameters;
  const replyTarget = selectSpecifiedReplyTarget(parameters);
  const quote = replyTarget?.quote;
  const quoteReading = quote === undefined ? undefined : readFormattedTextParameters(
    context,
    { text: quote.text, parseMode: quote.parseMode, entities: quote.entities },
    invalidParametersDescription,
  );
  if (quoteReading?.read === false) {
    return { read: false, errorAnswer: botApiError(400, quoteReading.description) };
  }
  if (chatId === undefined) {
    return { read: false, errorAnswer: botApiError(400, CHAT_ID_EMPTY_DESCRIPTION) };
  }
  const markupReading = readMessageReplyMarkupParameter(context, replyMarkup ?? {}, chatId);
  if (!markupReading.read) {
    return markupReading;
  }
  const replyChatId = replyTarget?.chatId === undefined
    ? undefined
    : resolveChatIdentifier(context, replyTarget.chatId);
  if (replyTarget?.chatId !== undefined && replyChatId === undefined) {
    return { read: false, errorAnswer: botApiError(400, CHAT_NOT_FOUND_DESCRIPTION) };
  }
  return {
    read: true,
    options: {
      ...markupReading.replyMarkup,
      chatId,
      replyTo: replyTarget === undefined ? undefined : {
        messageId: replyTarget.messageId,
        ...(replyChatId === undefined || replyChatId === chatId ? {} : { chatId: replyChatId }),
        allowSendingWithoutReply: replyTarget.allowSendingWithoutReply,
        ...(replyTarget.quote === undefined || quoteReading === undefined ? {} : {
          quote: { ...quoteReading.formattedText, position: replyTarget.quote.position },
        }),
      },
      isContentProtected,
      isSilent,
      messageEffectId,
    },
  };
}

/**
 * Reads the reply markup of a message being sent to a chat: an inline keyboard, as
 * `readInlineKeyboardParameter` reads it, or reply interface markup, as
 * `BotApiService.readReplyInterfaceMarkup` reads it, which allows buttons with a request only in a
 * private chat. Answers Telegram's error for a button it cannot read.
 */
function readMessageReplyMarkupParameter(
  context: BotApiMethodContext,
  replyMarkup: BotMessageReplyMarkup,
  chatId: number,
):
  | { readonly read: true; readonly replyMarkup: BotMessageReplyMarkup }
  | { readonly read: false; readonly errorAnswer: BotApiMethodAnswer } {
  if (replyMarkup.replyInterfaceMarkup !== undefined) {
    const reading = context.session.botApi.readReplyInterfaceMarkup(
      replyMarkup.replyInterfaceMarkup,
      { allowsRequestButtons: isUserId(chatId) },
    );
    return reading.read
      ? { read: true, replyMarkup: { replyInterfaceMarkup: reading.replyInterfaceMarkup } }
      : {
        read: false,
        errorAnswer: botApiError(400, badRequestDescription(reading.keyboardError)),
      };
  }
  const keyboardReading = readInlineKeyboardParameter(context, replyMarkup.inlineKeyboard);
  if (!keyboardReading.read) {
    return keyboardReading;
  }
  return {
    read: true,
    replyMarkup: keyboardReading.inlineKeyboard === undefined
      ? {}
      : { inlineKeyboard: keyboardReading.inlineKeyboard },
  };
}

/**
 * Reads the inline keyboard a request attaches, as `BotApiService.readInlineKeyboard` does,
 * answering Telegram's error for a button it cannot read; a request without one reads none.
 */
function readInlineKeyboardParameter(
  context: BotApiMethodContext,
  inlineKeyboard: InlineKeyboard | undefined,
):
  | { readonly read: true; readonly inlineKeyboard: InlineKeyboard | undefined }
  | { readonly read: false; readonly errorAnswer: BotApiMethodAnswer } {
  if (inlineKeyboard === undefined) {
    return { read: true, inlineKeyboard };
  }
  const reading = context.session.botApi.readInlineKeyboard(inlineKeyboard);
  return reading.read ? reading : {
    read: false,
    errorAnswer: botApiError(400, badRequestDescription(reading.keyboardError)),
  };
}

/** The error for a file parameter that names no uploaded file. */
function missingInputFileError(
  parameterName: 'photo' | 'document' | 'video' | 'voice',
): BotApiMethodAnswer {
  return botApiError(400, `Bad Request: there is no ${parameterName} in the request`);
}

function sendMethodAnswer(result: SendResult | SendFailure): BotApiMethodAnswer {
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
function fileResolutionFailureAnswer(failure: FileResolutionFailure): BotApiMethodAnswer {
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

async function handleEditMessageText(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
  uploadedFiles: BotApiUploadedFiles,
): Promise<BotApiMethodAnswer> {
  const invalidParametersDescription = 'Bad Request: invalid editMessageText parameters';
  const parsedParameters = editMessageTextParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, invalidParametersDescription);
  }
  // Telegram reads the new content before it looks for the message.
  const contentReading = readTextMessageReplacement(
    context,
    parsedParameters.data,
    uploadedFiles,
    invalidParametersDescription,
  );
  if (!contentReading.read) {
    return contentReading.errorAnswer;
  }
  const targetReading = readEditedMessageTarget(parsedParameters.data);
  if (!targetReading.read) {
    return targetReading.errorAnswer;
  }

  const keyboardReading = readInlineKeyboardParameter(context, parsedParameters.data.reply_markup);
  if (!keyboardReading.read) {
    return keyboardReading.errorAnswer;
  }

  const contentResolution = await resolveTextMessageReplacement(context, contentReading.content);
  if (!contentResolution.resolved) {
    return contentResolution.errorAnswer;
  }

  const { target } = targetReading;
  const { botApi } = context.session;
  const edit = { content: contentResolution.value, inlineKeyboard: keyboardReading.inlineKeyboard };
  return target.kind === 'inline_message'
    ? inlineMessageEditAnswer(botApi.editInlineMessageText(context.bot, { ...target, ...edit }))
    : editMessageAnswer(botApi.editMessageText(context.bot, { ...target, ...edit }));
}

/** Downloads the files that new rich message content names by URL; text has none. */
async function resolveTextMessageReplacement(
  context: BotApiMethodContext,
  content: TextMessageReplacementRequest,
): Promise<WebFileResolution<SendableTextMessageReplacement>> {
  if (content.kind === 'text') {
    return { resolved: true, value: content };
  }
  const resolution = await resolveSpecifiedRichMessage(context, content);
  return resolution.resolved
    ? { resolved: true, value: { kind: 'rich_message', ...resolution.value } }
    : resolution;
}

/**
 * Reads the new content of `editMessageText`, as the official Bot API server's
 * `process_edit_message_text_query` does: a `rich_message`, when the request has one, and
 * otherwise the text with its `parse_mode` or `entities`.
 */
function readTextMessageReplacement(
  context: BotApiMethodContext,
  { text, parse_mode: parseMode, entities, rich_message: richMessageParameter }: z.output<
    typeof editMessageTextParametersSchema
  >,
  uploadedFiles: BotApiUploadedFiles,
  invalidParametersDescription: string,
):
  | { readonly read: true; readonly content: TextMessageReplacementRequest }
  | { readonly read: false; readonly errorAnswer: BotApiMethodAnswer } {
  if (richMessageParameter !== undefined) {
    const richMessageReading = readSpecifiedRichMessage(
      context,
      richMessageParameter,
      uploadedFiles,
      invalidParametersDescription,
    );
    return richMessageReading.read
      ? { read: true, content: { kind: 'rich_message', ...richMessageReading.richMessage } }
      : richMessageReading;
  }
  const formattedTextReading = readSpecifiedFormattedText(
    context,
    { text, parseMode, entities },
    invalidParametersDescription,
  );
  return formattedTextReading.read
    ? { read: true, content: { kind: 'text', ...formattedTextReading.formattedText } }
    : formattedTextReading;
}

function handleEditMessageCaption(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const invalidParametersDescription = 'Bad Request: invalid editMessageCaption parameters';
  const parsedParameters = editMessageCaptionParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, invalidParametersDescription);
  }
  const { data } = parsedParameters;
  // Telegram reads the caption and its formatting before it looks for the message.
  const captionReading = readSpecifiedCaption(context, data, invalidParametersDescription);
  if (!captionReading.read) {
    return captionReading.errorAnswer;
  }
  const targetReading = readEditedMessageTarget(data);
  if (!targetReading.read) {
    return targetReading.errorAnswer;
  }
  const keyboardReading = readInlineKeyboardParameter(context, data.reply_markup);
  if (!keyboardReading.read) {
    return keyboardReading.errorAnswer;
  }

  const { target } = targetReading;
  const { botApi } = context.session;
  const edit = {
    caption: captionReading.formattedText,
    showsCaptionAboveMedia: data.show_caption_above_media,
    inlineKeyboard: keyboardReading.inlineKeyboard,
  };
  return target.kind === 'inline_message'
    ? inlineMessageEditAnswer(
      botApi.editInlineMessageCaption(context.bot, { ...target, ...edit }),
    )
    : editMessageAnswer(botApi.editMessageCaption(context.bot, { ...target, ...edit }));
}

/**
 * Replaces a message's media, as the official Bot API server's `process_edit_message_media_query`
 * does: the `media` parameter is read as `readInputMediaParameter` reads it, with its caption
 * reported as media Telegram cannot read, before the message is looked for.
 */
async function handleEditMessageMedia(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
  uploadedFiles: BotApiUploadedFiles,
): Promise<BotApiMethodAnswer> {
  const invalidParametersDescription = 'Bad Request: invalid editMessageMedia parameters';
  const parsedParameters = editMessageMediaParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, invalidParametersDescription);
  }
  const { data } = parsedParameters;
  const mediaReading = readInputMediaParameter(
    data.media,
    uploadedFiles,
    invalidParametersDescription,
  );
  if (!mediaReading.read) {
    return botApiError(400, mediaReading.description);
  }
  const captionReading = readEmbeddedFormattedText(
    context,
    mediaReading.media.caption,
    invalidParametersDescription,
    INPUT_MEDIA_ERROR_PREFIX,
  );
  if (!captionReading.read) {
    return botApiError(400, captionReading.description);
  }
  const targetReading = readEditedMessageTarget(data);
  if (!targetReading.read) {
    return targetReading.errorAnswer;
  }
  const keyboardReading = readInlineKeyboardParameter(context, data.reply_markup);
  if (!keyboardReading.read) {
    return keyboardReading.errorAnswer;
  }

  const { media } = mediaReading;
  const fileResolution = await resolveRequestedInputFile(
    context,
    getRequestedMediaFile(media),
    media.kind,
  );
  if (!fileResolution.resolved) {
    return fileResolution.errorAnswer;
  }

  const { target } = targetReading;
  const { botApi } = context.session;
  const edit = {
    media: toMediaReplacementRequest(media, fileResolution.value, captionReading.formattedText),
    inlineKeyboard: keyboardReading.inlineKeyboard,
  };
  return target.kind === 'inline_message'
    ? inlineMessageEditAnswer(botApi.editInlineMessageMedia(context.bot, { ...target, ...edit }))
    : editMessageAnswer(botApi.editMessageMedia(context.bot, { ...target, ...edit }));
}

function handleEditMessageReplyMarkup(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = editMessageReplyMarkupParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid editMessageReplyMarkup parameters');
  }
  const targetReading = readEditedMessageTarget(parsedParameters.data);
  if (!targetReading.read) {
    return targetReading.errorAnswer;
  }

  const keyboardReading = readInlineKeyboardParameter(context, parsedParameters.data.reply_markup);
  if (!keyboardReading.read) {
    return keyboardReading.errorAnswer;
  }

  const { target } = targetReading;
  const { botApi } = context.session;
  const { inlineKeyboard } = keyboardReading;
  return target.kind === 'inline_message'
    ? inlineMessageEditAnswer(botApi.editInlineMessageReplyMarkup(context.bot, {
      ...target,
      inlineKeyboard,
    }))
    : editMessageAnswer(
      botApi.editMessageReplyMarkup(context.bot, { ...target, inlineKeyboard }),
    );
}

/**
 * Stops a poll as the official Bot API server's `process_stop_poll_query` reads it: the new
 * keyboard, then the chat and the message, which must be positive to be found.
 */
function handleStopPoll(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = stopPollParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid stopPoll parameters');
  }
  const { chat_id: chatId, message_id: messageId, reply_markup: replyMarkup } =
    parsedParameters.data;
  const keyboardReading = readInlineKeyboardParameter(context, replyMarkup);
  if (!keyboardReading.read) {
    return keyboardReading.errorAnswer;
  }
  if (chatId === undefined) {
    return botApiError(400, CHAT_ID_EMPTY_DESCRIPTION);
  }

  const result = context.session.botApi.stopPoll(context.bot, {
    chatId,
    messageId: messageIdOrNone(messageId),
    inlineKeyboard: keyboardReading.inlineKeyboard,
  });
  if (result.stopped) {
    return botApiResult(result.poll);
  }
  switch (result.reason) {
    case 'chat_not_found':
    case 'bot_not_a_member':
    case 'bot_kicked':
      return supergroupBotAccessFailureAnswer(result.reason);
    case 'message_not_found':
      return botApiError(400, MESSAGE_WITH_POLL_TO_STOP_NOT_FOUND_DESCRIPTION);
    case 'message_has_no_poll':
      return botApiError(400, MESSAGE_HAS_NO_POLL_DESCRIPTION);
    case 'poll_not_stoppable':
      return botApiError(400, POLL_NOT_STOPPABLE_DESCRIPTION);
    case 'poll_already_closed':
      return botApiError(400, POLL_ALREADY_CLOSED_DESCRIPTION);
    case 'callback_data_invalid':
      return botApiError(400, BUTTON_DATA_INVALID_DESCRIPTION);
    case 'button_type_invalid':
      return botApiError(400, BUTTON_TYPE_INVALID_DESCRIPTION);
    default: {
      const unhandledReason: never = result.reason;
      throw new Error(`Unhandled poll stop failure: ${unhandledReason}`);
    }
  }
}

/**
 * Reads nonempty message text with its `parse_mode` or `entities`, answering Telegram's error for
 * text or formatting it cannot read.
 */
function readSpecifiedFormattedText(
  context: BotApiMethodContext,
  specifiedText: {
    readonly text: string;
    readonly parseMode: string | undefined;
    readonly entities: readonly unknown[] | undefined;
  },
  invalidParametersDescription: string,
): SpecifiedFormattedTextReading {
  if (specifiedText.text.length === 0) {
    return { read: false, errorAnswer: botApiError(400, MESSAGE_TEXT_EMPTY_DESCRIPTION) };
  }
  return withErrorAnswer(
    readFormattedTextParameters(context, specifiedText, invalidParametersDescription),
  );
}

/**
 * Reads a caption with its `parse_mode` or `caption_entities`, as message text is read; an empty
 * caption is none.
 */
function readSpecifiedCaption(
  context: BotApiMethodContext,
  { caption, parse_mode: parseMode, caption_entities: captionEntities }: {
    readonly caption: string;
    readonly parse_mode?: string;
    readonly caption_entities?: readonly unknown[];
  },
  invalidParametersDescription: string,
): SpecifiedFormattedTextReading {
  return withErrorAnswer(readFormattedTextParameters(
    context,
    { text: caption, parseMode, entities: captionEntities },
    invalidParametersDescription,
  ));
}

function withErrorAnswer(reading: FormattedTextParametersReading): SpecifiedFormattedTextReading {
  return reading.read
    ? reading
    : { read: false, errorAnswer: botApiError(400, reading.description) };
}

/**
 * Reads text with the parse mode or entities that format it, answering Telegram's error for text
 * or formatting it cannot read.
 *
 * Entities are decoded even alongside a parse mode, which makes Telegram ignore them, so malformed
 * entities are rejected in either case to surface the bot's mistake in tests.
 */
function readFormattedTextParameters(
  context: BotApiMethodContext,
  { text, parseMode, entities }: {
    readonly text: string;
    readonly parseMode: string | undefined;
    readonly entities: readonly unknown[] | undefined;
  },
  invalidParametersDescription: string,
): FormattedTextParametersReading {
  const failure = (description: string): FormattedTextParametersReading => ({
    read: false,
    description,
  });
  const entitiesReading = readMessageEntitiesParameter(
    entities ?? [],
    invalidParametersDescription,
  );
  if (!entitiesReading.read) {
    return failure(entitiesReading.description);
  }

  const result = context.session.botApi.readFormattedText({
    text,
    parseMode,
    entities: entitiesReading.entities,
  });
  if (result.read) {
    return result;
  }
  switch (result.reason) {
    case 'text_too_long':
      return failure(FORMATTED_TEXT_TOO_LONG_DESCRIPTION);
    case 'parse_mode_unsupported':
      return failure(PARSE_MODE_UNSUPPORTED_DESCRIPTION);
    case 'text_encoding_invalid':
      return failure(TEXT_ENCODING_INVALID_DESCRIPTION);
    case 'markup_invalid':
      return failure(`Bad Request: can't parse entities: ${result.markupError}`);
    default: {
      const unhandledFailure: never = result;
      throw new Error(`Unhandled text reading failure: ${JSON.stringify(unhandledFailure)}`);
    }
  }
}

/**
 * Reads where an edit method finds the message, as the official Bot API server does: an edit
 * without `chat_id` and without a positive `message_id` addresses an inline message by its
 * `inline_message_id`, which it reports missing as an unspecified message identifier.
 */
function readEditedMessageTarget(
  { chat_id: chatId, message_id: messageId, inline_message_id: inlineMessageId }: {
    readonly chat_id?: number;
    readonly message_id?: number;
    readonly inline_message_id: string;
  },
): EditedMessageTargetReading {
  if (chatId === undefined && messageIdOrNone(messageId) === NO_MESSAGE_ID) {
    return inlineMessageId.length === 0
      ? {
        read: false,
        errorAnswer: botApiError(400, MESSAGE_IDENTIFIER_NOT_SPECIFIED_DESCRIPTION),
      }
      : { read: true, target: { kind: 'inline_message', inlineMessageId } };
  }
  if (chatId === undefined) {
    return { read: false, errorAnswer: botApiError(400, CHAT_ID_EMPTY_DESCRIPTION) };
  }
  return {
    read: true,
    target: { kind: 'chat_message', chatId, messageId: messageIdOrNone(messageId) },
  };
}

function messageIdOrNone(messageId: number | undefined): number {
  return messageId === undefined || messageId <= 0 ? NO_MESSAGE_ID : messageId;
}

function editMessageAnswer(result: MessageEditResult): BotApiMethodAnswer {
  if (result.edited) {
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
    case 'message_not_found':
      return botApiError(400, MESSAGE_TO_EDIT_NOT_FOUND_DESCRIPTION);
    case 'message_not_editable':
      return botApiError(400, MESSAGE_NOT_EDITABLE_DESCRIPTION);
    case 'message_has_no_text':
      return botApiError(400, MESSAGE_HAS_NO_TEXT_DESCRIPTION);
    case 'message_has_no_caption':
      return botApiError(400, MESSAGE_HAS_NO_CAPTION_DESCRIPTION);
    case 'message_text_too_long':
      return botApiError(400, MESSAGE_TEXT_TOO_LONG_DESCRIPTION);
    case 'caption_too_long':
      return botApiError(400, CAPTION_TOO_LONG_DESCRIPTION);
    case 'message_media_not_editable':
      return botApiError(400, MESSAGE_MEDIA_NOT_EDITABLE_DESCRIPTION);
    case 'album_media_kind_changed':
      return botApiError(400, ALBUM_MEDIA_TYPE_UNCHANGEABLE_DESCRIPTION);
    case 'callback_data_invalid':
      return botApiError(400, BUTTON_DATA_INVALID_DESCRIPTION);
    case 'button_type_invalid':
      return botApiError(400, BUTTON_TYPE_INVALID_DESCRIPTION);
    case 'message_not_modified':
      return botApiError(400, MESSAGE_NOT_MODIFIED_DESCRIPTION);
    case 'send_permission_missing':
      return botApiError(400, SEND_PERMISSION_MISSING_DESCRIPTIONS[result.contentKind]);
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
      throw new Error(`Unhandled message edit failure: ${JSON.stringify(unhandledFailure)}`);
    }
  }
}

/** Answers a successful edit of an inline message with `true`, as Telegram does. */
function inlineMessageEditAnswer(result: InlineMessageEditResult): BotApiMethodAnswer {
  if (result.edited) {
    return botApiResult(true);
  }
  switch (result.reason) {
    case 'inline_message_not_found':
      return botApiError(400, INLINE_MESSAGE_ID_INVALID_DESCRIPTION);
    case 'message_text_empty':
      return botApiError(400, MESSAGE_TEXT_EMPTY_DESCRIPTION);
    case 'text_invalid':
      return botApiError(400, badRequestDescription(result.textError));
    case 'message_has_no_text':
      return botApiError(400, MESSAGE_HAS_NO_TEXT_DESCRIPTION);
    case 'message_has_no_caption':
      return botApiError(400, MESSAGE_HAS_NO_CAPTION_DESCRIPTION);
    case 'message_text_too_long':
      return botApiError(400, MESSAGE_TEXT_TOO_LONG_DESCRIPTION);
    case 'caption_too_long':
      return botApiError(400, CAPTION_TOO_LONG_DESCRIPTION);
    case 'callback_data_invalid':
      return botApiError(400, BUTTON_DATA_INVALID_DESCRIPTION);
    case 'button_type_invalid':
      return botApiError(400, BUTTON_TYPE_INVALID_DESCRIPTION);
    case 'message_not_modified':
      return botApiError(400, MESSAGE_NOT_MODIFIED_DESCRIPTION);
    case 'inline_message_upload_unsupported':
      return botApiError(400, INLINE_MESSAGE_CONTENT_INVALID_DESCRIPTION);
    case 'message_media_not_editable':
      return botApiError(400, MESSAGE_MEDIA_NOT_EDITABLE_DESCRIPTION);
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
      throw new Error(`Unhandled inline message edit failure: ${JSON.stringify(unhandledFailure)}`);
    }
  }
}

function handleDeleteMessage(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = deleteMessageParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid deleteMessage parameters');
  }
  const { chat_id: chatId, message_id: messageId } = parsedParameters.data;
  // Telegram looks at the chat before the message.
  if (chatId === undefined) {
    return botApiError(400, CHAT_ID_EMPTY_DESCRIPTION);
  }

  const result = context.session.botApi.deleteMessage(
    context.bot,
    { chatId, messageId: messageIdOrNone(messageId) },
  );
  if (result.deleted) {
    return botApiResult(true);
  }
  switch (result.reason) {
    case 'chat_not_found':
    case 'bot_not_a_member':
    case 'bot_kicked':
      return supergroupBotAccessFailureAnswer(result.reason);
    case 'message_not_found':
      return botApiError(400, MESSAGE_TO_DELETE_NOT_FOUND_DESCRIPTION);
    case 'message_not_deletable':
      return botApiError(400, MESSAGE_NOT_DELETABLE_DESCRIPTION);
    default: {
      const unhandledReason: never = result.reason;
      throw new Error(`Unhandled deleteMessage failure: ${unhandledReason}`);
    }
  }
}

function handlePinChatMessage(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = pinChatMessageParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid pinChatMessage parameters');
  }
  const { chat_id: chatId, message_id: messageId, disable_notification: isSilent } =
    parsedParameters.data;
  // Telegram looks at the chat before the message.
  if (chatId === undefined) {
    return botApiError(400, CHAT_ID_EMPTY_DESCRIPTION);
  }

  const result = context.session.botApi.pinChatMessage(context.bot, {
    chatId,
    messageId: messageIdOrNone(messageId),
    isSilent,
  });
  if (result.pinned) {
    return botApiResult(true);
  }
  switch (result.reason) {
    case 'message_not_found':
      return botApiError(400, MESSAGE_TO_PIN_NOT_FOUND_DESCRIPTION);
    case 'message_already_pinned':
      return botApiError(400, PINNED_MESSAGE_NOT_MODIFIED_DESCRIPTION);
    default:
      return pinChangeFailureAnswer(result.reason);
  }
}

function handleUnpinChatMessage(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = unpinChatMessageParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid unpinChatMessage parameters');
  }
  const { chat_id: chatId, message_id: messageId } = parsedParameters.data;
  if (chatId === undefined) {
    return botApiError(400, CHAT_ID_EMPTY_DESCRIPTION);
  }

  const result = context.session.botApi.unpinChatMessage(context.bot, {
    chatId,
    ...(messageId === undefined || messageId === NO_MESSAGE_ID ? {} : { messageId }),
  });
  if (result.unpinned) {
    return botApiResult(true);
  }
  switch (result.reason) {
    case 'message_not_found':
      return botApiError(400, MESSAGE_TO_UNPIN_NOT_FOUND_DESCRIPTION);
    case 'message_not_pinned':
      return botApiError(400, PINNED_MESSAGE_NOT_MODIFIED_DESCRIPTION);
    default:
      return pinChangeFailureAnswer(result.reason);
  }
}

/** Telegram's error for a pin or unpin refused for the chat, the bot's rights, or the message. */
function pinChangeFailureAnswer(
  reason:
    | SupergroupBotAccessFailureReason
    | 'bot_blocked'
    | 'not_enough_rights'
    | 'service_message_not_pinnable',
): BotApiMethodAnswer {
  switch (reason) {
    case 'chat_not_found':
    case 'bot_not_a_member':
    case 'bot_kicked':
      return supergroupBotAccessFailureAnswer(reason);
    case 'bot_blocked':
      return botApiError(403, BOT_BLOCKED_DESCRIPTION);
    case 'not_enough_rights':
      return botApiError(400, NOT_ENOUGH_RIGHTS_TO_PIN_DESCRIPTION);
    case 'service_message_not_pinnable':
      return botApiError(400, SERVICE_MESSAGE_NOT_PINNABLE_DESCRIPTION);
    default: {
      const unhandledReason: never = reason;
      throw new Error(`Unhandled pin failure: ${unhandledReason}`);
    }
  }
}

/**
 * Telegram's error for a request to a chat the bot cannot reach as a supergroup member, whichever
 * method made it.
 */
function supergroupBotAccessFailureAnswer(
  reason: SupergroupBotAccessFailureReason,
): BotApiMethodAnswer {
  switch (reason) {
    case 'chat_not_found':
      return botApiError(400, CHAT_NOT_FOUND_DESCRIPTION);
    case 'bot_not_a_member':
      return botApiError(403, BOT_NOT_SUPERGROUP_MEMBER_DESCRIPTION);
    case 'bot_kicked':
      return botApiError(403, BOT_KICKED_FROM_SUPERGROUP_DESCRIPTION);
    default: {
      const unhandledReason: never = reason;
      throw new Error(`Unhandled supergroup bot access failure: ${unhandledReason}`);
    }
  }
}

function handleDeleteMessages(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = deleteMessagesParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid deleteMessages parameters');
  }
  const { chat_id: chatId, message_ids: messageIds } = parsedParameters.data;
  // Telegram checks the message identifiers before it looks at the chat.
  if (messageIds === undefined) {
    return botApiError(400, MESSAGE_IDENTIFIERS_NOT_SPECIFIED_DESCRIPTION);
  }
  if (messageIds.length > MAX_DELETE_MESSAGES_COUNT) {
    return botApiError(400, TOO_MANY_MESSAGE_IDENTIFIERS_DESCRIPTION);
  }
  if (messageIds.some((messageId) => messageId <= 0)) {
    return botApiError(400, INVALID_MESSAGE_IDENTIFIER_DESCRIPTION);
  }
  if (chatId === undefined) {
    return botApiError(400, CHAT_ID_EMPTY_DESCRIPTION);
  }

  const result = context.session.botApi.deleteMessages(
    context.bot,
    { chatId, messageIds },
  );
  if (result.deleted) {
    return botApiResult(true);
  }
  switch (result.reason) {
    case 'chat_not_found':
    case 'bot_not_a_member':
    case 'bot_kicked':
      return supergroupBotAccessFailureAnswer(result.reason);
    case 'message_not_deletable':
      return botApiError(400, MESSAGE_NOT_DELETABLE_DESCRIPTION);
    default: {
      const unhandledReason: never = result.reason;
      throw new Error(`Unhandled deleteMessages failure: ${unhandledReason}`);
    }
  }
}

function handleGetFile(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = getFileParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid getFile parameters');
  }
  const { file_id: fileId } = parsedParameters.data;
  if (fileId.length === 0) {
    return botApiError(400, FILE_ID_NOT_SPECIFIED_DESCRIPTION);
  }

  const result = context.session.botApi.getFile(
    context.bot,
    fileId,
  );
  if (result.found) {
    return botApiResult(result.file);
  }
  switch (result.reason) {
    case 'file_id_invalid':
      return botApiError(400, GET_FILE_ID_INVALID_DESCRIPTION);
    case 'file_too_big':
      return botApiError(400, FILE_TOO_BIG_DESCRIPTION);
    default: {
      const unhandledReason: never = result.reason;
      throw new Error(`Unhandled getFile failure: ${unhandledReason}`);
    }
  }
}

function handleAnswerCallbackQuery(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = answerCallbackQueryParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid answerCallbackQuery parameters');
  }

  const result = context.session.botApi.answerCallbackQuery(
    context.bot,
    {
      callbackQueryId: parsedParameters.data.callback_query_id,
      text: parsedParameters.data.text,
      showAlert: parsedParameters.data.show_alert,
      cacheTimeSeconds: parsedParameters.data.cache_time,
      url: parsedParameters.data.url,
    },
  );
  if (result.answered) {
    return botApiResult(true);
  }
  switch (result.reason) {
    case 'query_id_invalid':
      return botApiError(400, QUERY_ID_INVALID_DESCRIPTION);
    case 'url_invalid':
      return botApiError(400, URL_INVALID_DESCRIPTION);
    default: {
      const unhandledReason: never = result.reason;
      throw new Error(`Unhandled answerCallbackQuery failure: ${unhandledReason}`);
    }
  }
}

function handleSendChatAction(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = sendChatActionParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid sendChatAction parameters');
  }
  const { chat_id: chatId, action: actionName } = parsedParameters.data;
  // Telegram reads the action before it looks at the chat.
  const action = CHAT_ACTIONS_BY_NAME.get(actionName.toLowerCase());
  if (action === undefined) {
    return botApiError(400, CHAT_ACTION_INVALID_DESCRIPTION);
  }
  if (chatId === undefined) {
    return botApiError(400, CHAT_ID_EMPTY_DESCRIPTION);
  }

  const result = context.session.botApi.sendChatAction(
    context.bot,
    { chatId, action },
  );
  if (result.sent) {
    return botApiResult(true);
  }
  switch (result.reason) {
    case 'chat_not_found':
    case 'bot_not_a_member':
    case 'bot_kicked':
      return supergroupBotAccessFailureAnswer(result.reason);
    case 'bot_blocked':
      return botApiError(403, BOT_BLOCKED_DESCRIPTION);
    default: {
      const unhandledReason: never = result.reason;
      throw new Error(`Unhandled sendChatAction failure: ${unhandledReason}`);
    }
  }
}

/** TDLib's descriptions for a chat whose title or description a bot cannot change. */
const CHAT_TITLE_EMPTY_DESCRIPTION = 'Bad Request: title must be non-empty';
const NOT_ENOUGH_RIGHTS_TO_CHANGE_TITLE_DESCRIPTION =
  'Bad Request: not enough rights to change chat title';
const NOT_ENOUGH_RIGHTS_TO_SET_DESCRIPTION_DESCRIPTION =
  'Bad Request: not enough rights to set chat description';
const PRIVATE_CHAT_TITLE_UNCHANGEABLE_DESCRIPTION = "Bad Request: can't change private chat title";
const PRIVATE_CHAT_DESCRIPTION_UNCHANGEABLE_DESCRIPTION =
  "Bad Request: can't change private chat description";
const NOT_ENOUGH_RIGHTS_TO_CHANGE_PERMISSIONS_DESCRIPTION =
  'Bad Request: not enough rights to change chat permissions';
const PRIVATE_CHAT_PERMISSIONS_UNCHANGEABLE_DESCRIPTION =
  "Bad Request: can't change private chat permissions";
/** The official server's description of Telegram's refusal of an unchanged description. */
const CHAT_DESCRIPTION_NOT_MODIFIED_DESCRIPTION = 'Bad Request: chat description is not modified';

function handleSetChatTitle(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = setChatTitleParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid setChatTitle parameters');
  }
  const { chat_id: chatId, title } = parsedParameters.data;
  if (chatId === undefined) {
    return botApiError(400, CHAT_ID_EMPTY_DESCRIPTION);
  }
  const result = context.session.botApi.setChatTitle(context.bot, { chatId, title });
  if (result.set) {
    return botApiResult(true);
  }
  switch (result.reason) {
    case 'title_empty':
      return botApiError(400, CHAT_TITLE_EMPTY_DESCRIPTION);
    case 'not_enough_rights':
      return botApiError(400, NOT_ENOUGH_RIGHTS_TO_CHANGE_TITLE_DESCRIPTION);
    case 'private_chat_info_unchangeable':
      return botApiError(400, PRIVATE_CHAT_TITLE_UNCHANGEABLE_DESCRIPTION);
    default:
      return chatInfoChangeFailureAnswer(result.reason);
  }
}

function handleSetChatDescription(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = setChatDescriptionParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid setChatDescription parameters');
  }
  const { chat_id: chatId, description } = parsedParameters.data;
  if (chatId === undefined) {
    return botApiError(400, CHAT_ID_EMPTY_DESCRIPTION);
  }
  const result = context.session.botApi.setChatDescription(context.bot, { chatId, description });
  if (result.set) {
    return botApiResult(true);
  }
  switch (result.reason) {
    case 'description_not_modified':
      return botApiError(400, CHAT_DESCRIPTION_NOT_MODIFIED_DESCRIPTION);
    case 'not_enough_rights':
      return botApiError(400, NOT_ENOUGH_RIGHTS_TO_SET_DESCRIPTION_DESCRIPTION);
    case 'private_chat_info_unchangeable':
      return botApiError(400, PRIVATE_CHAT_DESCRIPTION_UNCHANGEABLE_DESCRIPTION);
    default:
      return chatInfoChangeFailureAnswer(result.reason);
  }
}

function handleSetChatPermissions(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const invalidParametersDescription = 'Bad Request: invalid setChatPermissions parameters';
  const parsedParameters = setChatPermissionsParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, invalidParametersDescription);
  }
  const { data } = parsedParameters;
  // Telegram reads the permissions before it looks at the chat.
  const permissionsReading = readChatPermissionsParameter(data.permissions, {
    usesIndependentChatPermissions: data.use_independent_chat_permissions,
    invalidParametersDescription,
  });
  if (!permissionsReading.read) {
    return botApiError(400, permissionsReading.description);
  }
  if (data.chat_id === undefined) {
    return botApiError(400, CHAT_ID_EMPTY_DESCRIPTION);
  }
  const result = context.session.botApi.setChatPermissions(context.bot, {
    chatId: data.chat_id,
    permissions: permissionsReading.permissions,
  });
  if (result.set) {
    return botApiResult(true);
  }
  switch (result.reason) {
    case 'not_enough_rights':
      return botApiError(400, NOT_ENOUGH_RIGHTS_TO_CHANGE_PERMISSIONS_DESCRIPTION);
    case 'private_chat_permissions_unchangeable':
      return botApiError(400, PRIVATE_CHAT_PERMISSIONS_UNCHANGEABLE_DESCRIPTION);
    default:
      return chatInfoChangeFailureAnswer(result.reason);
  }
}

/** Telegram's error for a chat whose information a bot cannot reach, or text it cannot read. */
function chatInfoChangeFailureAnswer(
  reason: SupergroupBotAccessFailureReason | 'text_encoding_invalid',
): BotApiMethodAnswer {
  switch (reason) {
    case 'chat_not_found':
    case 'bot_not_a_member':
    case 'bot_kicked':
      return supergroupBotAccessFailureAnswer(reason);
    case 'text_encoding_invalid':
      return botApiError(400, STRINGS_NOT_UTF8_DESCRIPTION);
    default: {
      const unhandledReason: never = reason;
      throw new Error(`Unhandled chat information failure: ${unhandledReason}`);
    }
  }
}

function handleLeaveChat(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = leaveChatParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid leaveChat parameters');
  }
  const { chat_id: chatId } = parsedParameters.data;
  if (chatId === undefined) {
    return botApiError(400, CHAT_ID_EMPTY_DESCRIPTION);
  }

  const result = context.session.botApi.leaveChat(
    context.bot,
    { chatId },
  );
  if (result.left) {
    return botApiResult(true);
  }
  switch (result.reason) {
    case 'chat_not_found':
    case 'bot_not_a_member':
    case 'bot_kicked':
      return supergroupBotAccessFailureAnswer(result.reason);
    case 'private_chat_not_leavable':
      return botApiError(400, badRequestDescription("Can't leave private chats"));
    default: {
      const unhandledReason: never = result.reason;
      throw new Error(`Unhandled leaveChat failure: ${unhandledReason}`);
    }
  }
}

function handleGetChatMember(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = getChatMemberParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid getChatMember parameters');
  }
  const targetReading = readChatMemberTarget(parsedParameters.data);
  if (!targetReading.read) {
    return targetReading.errorAnswer;
  }

  const result = context.session.botApi.getChatMember(
    context.bot,
    targetReading.target,
  );
  return result.found ? botApiResult(result.member) : chatMemberFailureAnswer(result.reason);
}

function handleGetChatAdministrators(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = getChatAdministratorsParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid getChatAdministrators parameters');
  }
  const { chat_id: chatId, return_bots: includesOtherBots } = parsedParameters.data;
  if (chatId === undefined) {
    return botApiError(400, CHAT_ID_EMPTY_DESCRIPTION);
  }

  const result = context.session.botApi.getChatAdministrators(
    context.bot,
    { chatId, includesOtherBots },
  );
  return result.found
    ? botApiResult(result.administrators)
    : chatMemberFailureAnswer(result.reason);
}

function handleGetChat(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = getChatParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid getChat parameters');
  }
  const { chat_id: chatId } = parsedParameters.data;
  if (chatId === undefined) {
    return botApiError(400, CHAT_ID_EMPTY_DESCRIPTION);
  }

  const result = context.session.botApi.getChat(context.bot, { chatId });
  return result.found ? botApiResult(result.chat) : chatMemberFailureAnswer(result.reason);
}

function handleGetChatMemberCount(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = getChatMemberCountParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid getChatMemberCount parameters');
  }
  const { chat_id: chatId } = parsedParameters.data;
  if (chatId === undefined) {
    return botApiError(400, CHAT_ID_EMPTY_DESCRIPTION);
  }

  const result = context.session.botApi.getChatMemberCount(
    context.bot,
    { chatId },
  );
  return result.found ? botApiResult(result.memberCount) : chatMemberFailureAnswer(result.reason);
}

function handleBanChatMember(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = banChatMemberParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid banChatMember parameters');
  }
  const targetReading = readChatMemberTarget(parsedParameters.data);
  if (!targetReading.read) {
    return targetReading.errorAnswer;
  }

  const result = context.session.botApi.banChatMember(
    context.bot,
    { ...targetReading.target, untilUnixSeconds: parsedParameters.data.until_date },
  );
  return result.banned ? botApiResult(true) : chatMemberFailureAnswer(result.reason);
}

function handleRestrictChatMember(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const invalidParametersDescription = 'Bad Request: invalid restrictChatMember parameters';
  const parsedParameters = restrictChatMemberParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, invalidParametersDescription);
  }
  const { data } = parsedParameters;
  // Telegram reads the user, then the permissions, before it looks at the chat.
  if (data.user_id === undefined || data.user_id <= 0) {
    return botApiError(400, USER_ID_INVALID_DESCRIPTION);
  }
  const permissionsReading = readChatPermissionsParameter(data.permissions, {
    usesIndependentChatPermissions: data.use_independent_chat_permissions,
    invalidParametersDescription,
  });
  if (!permissionsReading.read) {
    return botApiError(400, permissionsReading.description);
  }
  const targetReading = readChatMemberTarget(data);
  if (!targetReading.read) {
    return targetReading.errorAnswer;
  }

  const result = context.session.botApi.restrictChatMember(context.bot, {
    ...targetReading.target,
    permissions: permissionsReading.permissions,
    untilUnixSeconds: data.until_date,
  });
  return result.restricted ? botApiResult(true) : chatMemberFailureAnswer(result.reason);
}

/**
 * Answers `promoteChatMember`. As the official server's `process_promote_chat_member_query` reads
 * them, each right is a separate parameter, a missing one is false, and passing none demotes an
 * administrator.
 */
function handlePromoteChatMember(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = promoteChatMemberParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid promoteChatMember parameters');
  }
  const { data } = parsedParameters;
  const targetReading = readChatMemberTarget(data);
  if (!targetReading.read) {
    return targetReading.errorAnswer;
  }
  // Anonymous administrators are not supported; granting the right alone would misrepresent them.
  if (data.is_anonymous === true) {
    return botApiError(400, ANONYMOUS_ADMINISTRATORS_UNSUPPORTED_DESCRIPTION);
  }

  const result = context.session.botApi.promoteChatMember(context.bot, {
    ...targetReading.target,
    rights: readPromotedSupergroupRights(data),
  });
  if (result.promoted) {
    return botApiResult(true);
  }
  switch (result.reason) {
    case 'cannot_promote_self':
      return botApiError(400, CANNOT_PROMOTE_SELF_DESCRIPTION);
    case 'member_not_in_chat':
      return botApiError(400, MEMBER_NOT_IN_CHAT_DESCRIPTION);
    case 'member_kicked':
      return botApiError(400, MEMBER_KICKED_DESCRIPTION);
    case 'rights_not_held':
      return botApiError(400, RIGHTS_NOT_HELD_DESCRIPTION);
    case 'bots_cannot_add_members':
      return botApiError(400, BOTS_CANNOT_ADD_MEMBERS_DESCRIPTION);
    default:
      return chatMemberFailureAnswer(result.reason);
  }
}

/**
 * The supergroup rights a `promoteChatMember` request grants: those it passes as true, with
 * `can_manage_voice_chats` naming `can_manage_video_chats`, and with `can_manage_chat` once any is
 * granted, as TDLib's `AdministratorRights` makes them for a supergroup.
 */
function readPromotedSupergroupRights(
  requestedRights: z.infer<typeof promoteChatMemberParametersSchema>,
): SupergroupAdministratorRights {
  return grantSupergroupAdministratorRights(
    SUPERGROUP_ADMINISTRATOR_RIGHTS.filter((right) =>
      requestedRights[right] === true ||
      (right === 'can_manage_video_chats' && requestedRights.can_manage_voice_chats === true)
    ),
  );
}

/**
 * Answers `createChatInviteLink` with the new link as its creator sees it. As the official server's
 * `process_create_chat_invite_link_query` reads them, a zero `expire_date` or `member_limit` means
 * none.
 */
function handleCreateChatInviteLink(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = createChatInviteLinkParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid createChatInviteLink parameters');
  }
  const { data } = parsedParameters;
  if (data.chat_id === undefined) {
    return botApiError(400, CHAT_ID_EMPTY_DESCRIPTION);
  }

  const result = context.session.botApi.createChatInviteLink(context.bot, {
    chatId: data.chat_id,
    name: data.name,
    ...(data.expire_date === undefined || data.expire_date === 0
      ? {}
      : { expiresAtUnixSeconds: data.expire_date }),
    ...(data.member_limit === undefined || data.member_limit === 0
      ? {}
      : { memberLimit: data.member_limit }),
    createsJoinRequest: data.creates_join_request,
  });
  if (result.created) {
    return botApiResult(result.inviteLink);
  }
  switch (result.reason) {
    case 'chat_not_found':
    case 'bot_not_a_member':
    case 'bot_kicked':
      return supergroupBotAccessFailureAnswer(result.reason);
    case 'private_chat_has_no_invite_links':
      return botApiError(400, PRIVATE_CHAT_HAS_NO_INVITE_LINKS_DESCRIPTION);
    case 'text_encoding_invalid':
      return botApiError(400, STRINGS_NOT_UTF8_DESCRIPTION);
    case 'member_limit_with_join_request':
      return botApiError(400, MEMBER_LIMIT_WITH_JOIN_REQUEST_DESCRIPTION);
    case 'not_enough_rights':
      return botApiError(400, NOT_ENOUGH_RIGHTS_TO_MANAGE_INVITE_LINKS_DESCRIPTION);
    case 'expiry_date_invalid':
      return botApiError(400, INVITE_LINK_EXPIRY_DATE_INVALID_DESCRIPTION);
    case 'member_limit_invalid':
      return botApiError(400, INVITE_LINK_MEMBER_LIMIT_INVALID_DESCRIPTION);
    default: {
      const unhandledReason: never = result.reason;
      throw new Error(`Unhandled createChatInviteLink failure: ${unhandledReason}`);
    }
  }
}

function handleApproveChatJoinRequest(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  return answerChatJoinRequestDecision(
    'approveChatJoinRequest',
    parameters,
    (request) => context.session.botApi.approveChatJoinRequest(context.bot, request),
  );
}

function handleDeclineChatJoinRequest(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  return answerChatJoinRequestDecision(
    'declineChatJoinRequest',
    parameters,
    (request) => context.session.botApi.declineChatJoinRequest(context.bot, request),
  );
}

/**
 * Answers `approveChatJoinRequest` or `declineChatJoinRequest`, which the official server's
 * `process_approve_chat_join_request_query` and `process_decline_chat_join_request_query` read
 * alike: the user, then the chat.
 */
function answerChatJoinRequestDecision(
  methodName: 'approveChatJoinRequest' | 'declineChatJoinRequest',
  parameters: BotApiRequestParameters,
  decide: (
    request: { readonly chatId: number; readonly userId: number },
  ) => ReturnType<EmulationSession['botApi']['approveChatJoinRequest']>,
): BotApiMethodAnswer {
  const parsedParameters = chatJoinRequestDecisionParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, `Bad Request: invalid ${methodName} parameters`);
  }
  const targetReading = readChatMemberTarget(parsedParameters.data);
  if (!targetReading.read) {
    return targetReading.errorAnswer;
  }

  const result = decide(targetReading.target);
  if (result.decided) {
    return botApiResult(true);
  }
  switch (result.reason) {
    case 'chat_not_found':
    case 'bot_not_a_member':
    case 'bot_kicked':
      return supergroupBotAccessFailureAnswer(result.reason);
    case 'private_chat_has_no_join_requests':
      return botApiError(400, PRIVATE_CHAT_HAS_NO_JOIN_REQUESTS_DESCRIPTION);
    case 'not_enough_rights':
      return botApiError(400, NOT_ENOUGH_RIGHTS_TO_MANAGE_JOIN_REQUESTS_DESCRIPTION);
    case 'already_a_member':
      return botApiError(400, USER_ALREADY_PARTICIPANT_DESCRIPTION);
    case 'join_request_missing':
      return botApiError(400, JOIN_REQUEST_MISSING_DESCRIPTION);
    default: {
      const unhandledReason: never = result.reason;
      throw new Error(`Unhandled ${methodName} failure: ${unhandledReason}`);
    }
  }
}

function handleUnbanChatMember(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = unbanChatMemberParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid unbanChatMember parameters');
  }
  const targetReading = readChatMemberTarget(parsedParameters.data);
  if (!targetReading.read) {
    return targetReading.errorAnswer;
  }

  const result = context.session.botApi.unbanChatMember(
    context.bot,
    { ...targetReading.target, onlyIfBanned: parsedParameters.data.only_if_banned },
  );
  return result.unbanned ? botApiResult(true) : chatMemberFailureAnswer(result.reason);
}

/**
 * Reads the chat and the user a member method addresses. Telegram reads the user first, and reads
 * a missing or non-positive `user_id` as 0, which identifies no user.
 */
/**
 * Answers `setChatAdministratorCustomTitle`. As the official server reads it, a missing
 * `custom_title` is empty, which removes the title.
 */
function handleSetChatAdministratorCustomTitle(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = setChatAdministratorCustomTitleParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid setChatAdministratorCustomTitle parameters');
  }
  const targetReading = readChatMemberTarget(parsedParameters.data);
  if (!targetReading.read) {
    return targetReading.errorAnswer;
  }

  const result = context.session.botApi.setChatAdministratorCustomTitle(context.bot, {
    ...targetReading.target,
    customTitle: parsedParameters.data.custom_title ?? '',
  });
  if (result.set) {
    return botApiResult(true);
  }
  switch (result.reason) {
    case 'method_unavailable_outside_groups':
      return botApiError(400, METHOD_UNAVAILABLE_OUTSIDE_GROUPS_DESCRIPTION);
    case 'member_is_owner':
      return botApiError(400, OWNER_CUSTOM_TITLE_DESCRIPTION);
    case 'member_is_not_administrator':
      return botApiError(400, MEMBER_IS_NOT_ADMINISTRATOR_DESCRIPTION);
    case 'custom_title_not_editable':
      return botApiError(400, CUSTOM_TITLE_NOT_EDITABLE_DESCRIPTION);
    case 'text_encoding_invalid':
      return botApiError(400, STRINGS_NOT_UTF8_DESCRIPTION);
    case 'custom_title_too_long':
      return botApiError(400, CUSTOM_TITLE_INVALID_DESCRIPTION);
    case 'custom_title_contains_emoji':
      return botApiError(400, CUSTOM_TITLE_EMOJI_NOT_ALLOWED_DESCRIPTION);
    default:
      return chatMemberFailureAnswer(result.reason);
  }
}

function readChatMemberTarget(
  { chat_id: chatId, user_id: userId }: { readonly chat_id?: number; readonly user_id?: number },
):
  | { readonly read: true; readonly target: { readonly chatId: number; readonly userId: number } }
  | { readonly read: false; readonly errorAnswer: BotApiMethodAnswer } {
  if (userId === undefined || userId <= 0) {
    return { read: false, errorAnswer: botApiError(400, USER_ID_INVALID_DESCRIPTION) };
  }
  if (chatId === undefined) {
    return { read: false, errorAnswer: botApiError(400, CHAT_ID_EMPTY_DESCRIPTION) };
  }
  return { read: true, target: { chatId, userId } };
}

function chatMemberFailureAnswer(reason: ChatMemberFailureReason): BotApiMethodAnswer {
  switch (reason) {
    case 'chat_not_found':
    case 'bot_not_a_member':
    case 'bot_kicked':
      return supergroupBotAccessFailureAnswer(reason);
    case 'member_not_found':
      return botApiError(400, MEMBER_NOT_FOUND_DESCRIPTION);
    case 'private_chat_has_no_administrators':
      return botApiError(400, PRIVATE_CHAT_HAS_NO_ADMINISTRATORS_DESCRIPTION);
    case 'private_chat_members_not_bannable':
      return botApiError(400, PRIVATE_CHAT_MEMBERS_NOT_BANNABLE_DESCRIPTION);
    case 'method_unavailable_in_private_chats':
      return botApiError(400, METHOD_UNAVAILABLE_IN_PRIVATE_CHATS_DESCRIPTION);
    case 'cannot_restrict_self':
      return botApiError(400, CANNOT_RESTRICT_SELF_DESCRIPTION);
    case 'cannot_unrestrict_self':
      return botApiError(400, CANNOT_UNRESTRICT_SELF_DESCRIPTION);
    case 'method_unavailable_outside_supergroups':
      return botApiError(400, METHOD_UNAVAILABLE_OUTSIDE_SUPERGROUPS_DESCRIPTION);
    case 'not_enough_rights_to_promote':
      return botApiError(400, NOT_ENOUGH_RIGHTS_DESCRIPTION);
    case 'member_is_owner':
      return botApiError(400, MEMBER_IS_OWNER_DESCRIPTION);
    case 'not_enough_rights':
      return botApiError(400, NOT_ENOUGH_RIGHTS_TO_RESTRICT_DESCRIPTION);
    case 'member_is_administrator':
      return botApiError(400, MEMBER_IS_ADMINISTRATOR_DESCRIPTION);
    default: {
      const unhandledReason: never = reason;
      throw new Error(`Unhandled chat member failure: ${unhandledReason}`);
    }
  }
}

function handleSetMyCommands(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const invalidParametersDescription = 'Bad Request: invalid setMyCommands parameters';
  const parsedParameters = setMyCommandsParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, invalidParametersDescription);
  }
  const { commands, scope, language_code: languageCode } = parsedParameters.data;
  const targetReading = readMyCommandsTarget(
    context,
    { scope, languageCode },
    invalidParametersDescription,
  );
  if (!targetReading.read) {
    return targetReading.errorAnswer;
  }

  const result = context.session.botApi.setMyCommands(
    context.bot,
    { commands, ...targetReading.target },
  );
  if (result.set) {
    return botApiResult(true);
  }
  switch (result.reason) {
    case 'chat_not_found':
    case 'bot_not_a_member':
    case 'bot_kicked':
    case 'scope_not_allowed_in_private_chats':
    case 'language_code_invalid':
      return myCommandsTargetError(result.reason);
    default:
      return botApiError(400, BOT_COMMAND_FAILURE_DESCRIPTIONS[result.reason]);
  }
}

function handleGetMyCommands(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const invalidParametersDescription = 'Bad Request: invalid getMyCommands parameters';
  const parsedParameters = myCommandsTargetParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, invalidParametersDescription);
  }
  const targetReading = readMyCommandsTarget(context, {
    scope: parsedParameters.data.scope,
    languageCode: parsedParameters.data.language_code,
  }, invalidParametersDescription);
  if (!targetReading.read) {
    return targetReading.errorAnswer;
  }

  const result = context.session.botApi.getMyCommands(
    context.bot,
    targetReading.target,
  );
  return result.found ? botApiResult(result.commands) : myCommandsTargetError(result.reason);
}

function handleDeleteMyCommands(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const invalidParametersDescription = 'Bad Request: invalid deleteMyCommands parameters';
  const parsedParameters = myCommandsTargetParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, invalidParametersDescription);
  }
  const targetReading = readMyCommandsTarget(context, {
    scope: parsedParameters.data.scope,
    languageCode: parsedParameters.data.language_code,
  }, invalidParametersDescription);
  if (!targetReading.read) {
    return targetReading.errorAnswer;
  }

  const result = context.session.botApi.deleteMyCommands(
    context.bot,
    targetReading.target,
  );
  return result.deleted ? botApiResult(true) : myCommandsTargetError(result.reason);
}

/** Reads the scope and language that address one of the bot's command lists. */
function readMyCommandsTarget(
  context: BotApiMethodContext,
  { scope, languageCode }: { readonly scope: unknown; readonly languageCode: string },
  invalidParametersDescription: string,
):
  | { readonly read: true; readonly target: MyCommandsTarget }
  | { readonly read: false; readonly errorAnswer: BotApiMethodAnswer } {
  const scopeReading = readBotCommandScopeParameter(
    scope,
    invalidParametersDescription,
    (chatIdentifier) => resolveChatIdentifier(context, chatIdentifier),
  );
  if (!scopeReading.read) {
    return { read: false, errorAnswer: botApiError(400, scopeReading.description) };
  }
  return { read: true, target: { scope: scopeReading.scope, languageCode } };
}

function myCommandsTargetError(reason: MyCommandsTargetFailureReason): BotApiMethodAnswer {
  switch (reason) {
    case 'chat_not_found':
    case 'bot_not_a_member':
    case 'bot_kicked':
      return supergroupBotAccessFailureAnswer(reason);
    case 'scope_not_allowed_in_private_chats':
      return botApiError(400, SCOPE_NOT_ALLOWED_IN_PRIVATE_CHATS_DESCRIPTION);
    case 'language_code_invalid':
      return botApiError(400, LANGUAGE_CODE_INVALID_DESCRIPTION);
    default: {
      const unhandledReason: never = reason;
      throw new Error(`Unhandled command list failure: ${unhandledReason}`);
    }
  }
}

function handleSetMyDefaultAdministratorRights(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const invalidParametersDescription =
    'Bad Request: invalid setMyDefaultAdministratorRights parameters';
  const parsedParameters = setMyDefaultAdministratorRightsParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, invalidParametersDescription);
  }
  const rightsReading = readChatAdministratorRightsParameter(
    parsedParameters.data.rights,
    invalidParametersDescription,
  );
  if (!rightsReading.read) {
    return botApiError(400, rightsReading.description);
  }
  context.session.botApi.setMyDefaultAdministratorRights(context.bot, {
    kind: parsedParameters.data.for_channels ? 'channel' : 'group',
    requestedRights: rightsReading.requestedRights,
  });
  return botApiResult(true);
}

function handleGetMyDefaultAdministratorRights(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = getMyDefaultAdministratorRightsParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid getMyDefaultAdministratorRights parameters');
  }
  return botApiResult(
    context.session.botApi.getMyDefaultAdministratorRights(
      context.bot,
      parsedParameters.data.for_channels ? 'channel' : 'group',
    ),
  );
}

/**
 * Sets the bot's menu button for all its private chats, or with `chat_id` for its chat with that
 * user. The button is read before the chat, as the official server's
 * `process_set_chat_menu_button_query` does.
 */
function handleSetChatMenuButton(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const invalidParametersDescription = 'Bad Request: invalid setChatMenuButton parameters';
  const parsedParameters = setChatMenuButtonParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, invalidParametersDescription);
  }
  const menuButtonReading = readMenuButtonParameter(
    parsedParameters.data.menu_button,
    invalidParametersDescription,
  );
  if (!menuButtonReading.read) {
    return botApiError(400, menuButtonReading.description);
  }
  const { chat_id: userId } = parsedParameters.data;
  if (userId !== undefined && userId <= 0) {
    return botApiError(400, CHAT_ID_INVALID_DESCRIPTION);
  }

  const result = context.session.botApi.setChatMenuButton(context.bot, {
    userId,
    menuButton: menuButtonReading.menuButton,
  });
  if (result.set) {
    return botApiResult(true);
  }
  return result.reason === 'web_app_url_invalid'
    ? botApiError(400, `${BAD_REQUEST_PREFIX}menu button Web App ${result.urlError}`)
    : botApiError(400, MENU_BUTTON_FAILURE_DESCRIPTIONS[result.reason]);
}

function handleGetChatMenuButton(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = getChatMenuButtonParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid getChatMenuButton parameters');
  }
  const { chat_id: userId } = parsedParameters.data;
  if (userId !== undefined && userId <= 0) {
    return botApiError(400, CHAT_ID_INVALID_DESCRIPTION);
  }
  const result = context.session.botApi.getChatMenuButton(context.bot, userId);
  return result.found
    ? botApiResult(result.menuButton)
    : botApiError(400, USER_NOT_FOUND_DESCRIPTION);
}

function handleSetMyDescription(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = setMyDescriptionParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid setMyDescription parameters');
  }
  return setMyDescription(context, {
    kind: 'description',
    text: parsedParameters.data.description,
    languageCode: parsedParameters.data.language_code,
  });
}

function handleSetMyShortDescription(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = setMyShortDescriptionParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid setMyShortDescription parameters');
  }
  return setMyDescription(context, {
    kind: 'short_description',
    text: parsedParameters.data.short_description,
    languageCode: parsedParameters.data.language_code,
  });
}

function setMyDescription(
  context: BotApiMethodContext,
  request: Parameters<EmulationSession['botApi']['setMyDescription']>[1],
): BotApiMethodAnswer {
  const result = context.session.botApi.setMyDescription(context.bot, request);
  if (result.set) {
    return botApiResult(true);
  }
  switch (result.reason) {
    case 'text_not_utf8':
      return botApiError(400, STRINGS_NOT_UTF8_DESCRIPTION);
    case 'language_code_invalid':
      return botApiError(400, LANGUAGE_CODE_INVALID_DESCRIPTION);
    default: {
      const unhandledReason: never = result.reason;
      throw new Error(`Unhandled description failure: ${unhandledReason}`);
    }
  }
}

function handleGetMyDescription(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = myDescriptionTargetParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid getMyDescription parameters');
  }
  const result = context.session.botApi.getMyDescription(context.bot, {
    kind: 'description',
    languageCode: parsedParameters.data.language_code,
  });
  return result.found
    ? botApiResult({ description: result.text })
    : botApiError(400, LANGUAGE_CODE_INVALID_DESCRIPTION);
}

function handleGetMyShortDescription(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = myDescriptionTargetParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid getMyShortDescription parameters');
  }
  const result = context.session.botApi.getMyDescription(context.bot, {
    kind: 'short_description',
    languageCode: parsedParameters.data.language_code,
  });
  return result.found
    ? botApiResult({ short_description: result.text })
    : botApiError(400, LANGUAGE_CODE_INVALID_DESCRIPTION);
}

function handleAnswerInlineQuery(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
  uploadedFiles: BotApiUploadedFiles,
): BotApiMethodAnswer {
  const invalidParametersDescription = 'Bad Request: invalid answerInlineQuery parameters';
  const parsedParameters = answerInlineQueryParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, invalidParametersDescription);
  }
  const { data } = parsedParameters;
  const resultsReading = readInlineQueryResultsParameter(
    data.results ?? [],
    invalidParametersDescription,
  );
  if (!resultsReading.read) {
    return botApiError(400, resultsReading.description);
  }
  const results: InlineQueryResultRequest[] = [];
  for (const result of resultsReading.results) {
    const keyboardReading = readInlineKeyboardParameter(context, result.inlineKeyboard);
    if (!keyboardReading.read) {
      return keyboardReading.errorAnswer;
    }
    const resultReading = readInlineQueryResultContent(
      context,
      { ...result, inlineKeyboard: keyboardReading.inlineKeyboard },
      uploadedFiles,
      invalidParametersDescription,
    );
    if (!resultReading.read) {
      return botApiError(400, resultReading.description);
    }
    results.push(resultReading.result);
  }
  const button = data.button ?? (data.switch_pm_text.length === 0 ? undefined : {
    kind: 'start_bot' as const,
    text: data.switch_pm_text,
    startParameter: data.switch_pm_parameter,
  });

  const result = context.session.botApi.answerInlineQuery(
    context.bot,
    {
      inlineQueryId: data.inline_query_id,
      results,
      cacheTimeSeconds: data.cache_time,
      isPersonal: data.is_personal,
      nextOffset: data.next_offset,
      button,
    },
  );
  if (result.answered) {
    return botApiResult(true);
  }
  switch (result.reason) {
    case 'text_invalid':
      return botApiError(400, badRequestDescription(result.textError));
    case 'file_type_mismatch':
      return botApiError(
        400,
        `Bad Request: can't use file of type ${TDLIB_FILE_TYPE_NAMES[result.actualFileType]} as ${
          TDLIB_FILE_TYPE_NAMES[result.expectedFileType]
        }`,
      );
    default:
      return botApiError(400, ANSWER_INLINE_QUERY_FAILURE_DESCRIPTIONS[result.reason]);
  }
}

/**
 * Reads what an inline query result sends and shows: its `input_message_content`, whose text is
 * read with its parse mode or entities and whose rich message is read as `sendRichMessage` reads
 * one, and its caption.
 */
function readInlineQueryResultContent(
  context: BotApiMethodContext,
  result: InlineQueryResultParameter,
  uploadedFiles: BotApiUploadedFiles,
  invalidParametersDescription: string,
):
  | { readonly read: true; readonly result: InlineQueryResultRequest }
  | { readonly read: false; readonly description: string } {
  const readText = (text: UnreadFormattedText) =>
    readEmbeddedFormattedText(
      context,
      text,
      invalidParametersDescription,
      INLINE_QUERY_RESULT_ERROR_PREFIX,
    );
  const shared = {
    id: result.id,
    ...(result.inlineKeyboard === undefined ? {} : { inlineKeyboard: result.inlineKeyboard }),
  };
  const messageContentReading = result.messageContent === undefined
    ? undefined
    : readInlineResultMessageContent(
      context,
      result.messageContent,
      uploadedFiles,
      invalidParametersDescription,
    );
  if (messageContentReading?.read === false) {
    return messageContentReading;
  }
  const messageContent = messageContentReading?.content;
  if (result.kind === 'article') {
    if (messageContent === undefined) {
      throw new Error('Expected an article result to send its input message content');
    }
    return {
      read: true,
      result: {
        ...shared,
        kind: 'article',
        description: result.description,
        title: result.title,
        url: result.url,
        messageContent,
      },
    };
  }
  const optionalMessageContent = messageContent === undefined ? {} : { messageContent };
  if (result.kind === 'contact') {
    return {
      read: true,
      result: { ...shared, ...optionalMessageContent, kind: 'contact', contact: result.contact },
    };
  }
  if (result.kind === 'location') {
    const location = readUnreadLocation(result.location);
    return location === undefined ? { read: false, description: LOCATION_INVALID_DESCRIPTION } : {
      read: true,
      result: {
        ...shared,
        ...optionalMessageContent,
        kind: 'location',
        title: result.title,
        location,
      },
    };
  }

  const captionReading = readText(result.caption);
  if (!captionReading.read) {
    return captionReading;
  }
  const media = {
    ...shared,
    ...optionalMessageContent,
    title: result.title,
    caption: captionReading.formattedText,
  };
  switch (result.kind) {
    case 'photo':
      return {
        read: true,
        result: {
          ...media,
          kind: 'photo',
          description: result.description,
          photo: result.photo,
          thumbnailUrl: result.thumbnailUrl,
          showsCaptionAboveMedia: result.showsCaptionAboveMedia,
        },
      };
    case 'document':
      return {
        read: true,
        result: {
          ...media,
          kind: 'document',
          description: result.description,
          document: result.document,
          thumbnailUrl: result.thumbnailUrl,
        },
      };
    case 'video':
      return {
        read: true,
        result: {
          ...media,
          kind: 'video',
          description: result.description,
          video: result.video,
          thumbnailUrl: result.thumbnailUrl,
          showsCaptionAboveMedia: result.showsCaptionAboveMedia,
          attributes: result.attributes,
        },
      };
    case 'voice':
      return {
        read: true,
        result: {
          ...media,
          kind: 'voice',
          voice: result.voice,
          durationSeconds: result.durationSeconds,
        },
      };
    default: {
      const unhandledResult: never = result;
      throw new Error(`Unhandled inline query result: ${JSON.stringify(unhandledResult)}`);
    }
  }
}

/**
 * Reads what a result's `input_message_content` sends: text with its parse mode or entities; a
 * rich message, read as `readSpecifiedRichMessage` reads the `rich_message` of `sendRichMessage`;
 * a contact, which the service cleans as `sendContact` does; or a static location, whose
 * coordinates must name a point on Earth, as TDLib's `process_input_message_location` requires.
 * A rich message's uploads are read so that answering can refuse them, as TDLib refuses an inline
 * message's uploads. The official server prefixes its own descriptions of a rich message it cannot
 * read with `can't parse InlineQueryResult: `, which the emulator words as for `sendRichMessage`.
 */
function readInlineResultMessageContent(
  context: BotApiMethodContext,
  content: UnreadInputMessageContent,
  uploadedFiles: BotApiUploadedFiles,
  invalidParametersDescription: string,
):
  | { readonly read: true; readonly content: InlineResultMessageContentRequest }
  | { readonly read: false; readonly description: string } {
  if (content.kind === 'text') {
    const textReading = readEmbeddedFormattedText(
      context,
      content.text,
      invalidParametersDescription,
      INLINE_QUERY_RESULT_ERROR_PREFIX,
    );
    return textReading.read
      ? { read: true, content: { kind: 'text', text: textReading.formattedText } }
      : textReading;
  }
  if (content.kind === 'contact') {
    return { read: true, content };
  }
  if (content.kind === 'location') {
    const location = readUnreadLocation(content.location);
    return location === undefined
      ? { read: false, description: LOCATION_INVALID_DESCRIPTION }
      : { read: true, content: { kind: 'location', location } };
  }
  const richMessageReading = readRichMessageParameter(
    JSON.stringify(content.richMessage),
    uploadedFiles,
    invalidParametersDescription,
  );
  if (!richMessageReading.read) {
    return richMessageReading;
  }
  const buttonReading = context.session.botApi.readRichMessageButtons(
    richMessageReading.richMessage,
  );
  if (!buttonReading.read) {
    return { read: false, description: badRequestDescription(buttonReading.keyboardError) };
  }
  // An inline query result's rich message must reuse files by `file_id`, as for uploads.
  const richMessage = excludeRichMessageWebFiles(buttonReading.richMessage);
  return richMessage === undefined
    ? {
      read: false,
      description: ANSWER_INLINE_QUERY_FAILURE_DESCRIPTIONS.inline_message_content_invalid,
    }
    : {
      read: true,
      content: {
        kind: 'rich_message',
        richMessage,
        detectsEntities: richMessageReading.detectsEntities,
      },
    };
}

/**
 * Reads text of an object that a parameter holds as JSON, such as an inline query result, as
 * `readFormattedTextParameters` does. The Bot API server reports text it cannot read as an object
 * it cannot read, prefixing Telegram's own description with `objectErrorPrefix`.
 */
function readEmbeddedFormattedText(
  context: BotApiMethodContext,
  { text, parseMode, entities }: UnreadFormattedText,
  invalidParametersDescription: string,
  objectErrorPrefix: string,
): { readonly read: true; readonly formattedText: SpecifiedFormattedText } | {
  readonly read: false;
  readonly description: string;
} {
  const reading = readFormattedTextParameters(
    context,
    { text, parseMode, entities },
    invalidParametersDescription,
  );
  if (reading.read || reading.description === invalidParametersDescription) {
    return reading;
  }
  // Telegram's descriptions begin with a capital letter, which `badRequestDescription` lowered.
  const telegramError = reading.description.slice(BAD_REQUEST_PREFIX.length);
  return {
    read: false,
    description: `${BAD_REQUEST_PREFIX}${objectErrorPrefix}${
      telegramError.charAt(0).toUpperCase()
    }${telegramError.slice(1)}`,
  };
}

/**
 * Words a TDLib error message as the Bot API server's `fail_query_with_error` does for a bad
 * request: prefixed, with its first letter lowercased unless it begins an error code or acronym.
 */
function badRequestDescription(tdlibErrorMessage: string): string {
  const secondCharacter = tdlibErrorMessage[1] ?? '';
  const keepsCase = secondCharacter === '_' || /[A-Z]/.test(secondCharacter);
  const message = keepsCase
    ? tdlibErrorMessage
    : tdlibErrorMessage.charAt(0).toLowerCase() + tdlibErrorMessage.slice(1);
  return `${BAD_REQUEST_PREFIX}${message}`;
}

/** Telegram's error body, whose `error_code` repeats the HTTP status. */

/** Sends a Bot API method's answer as the JSON body of an HTTP response. */
function botApiResponse(context: Context, { status, body }: BotApiMethodAnswer): Response {
  const retryAfterSeconds = body.ok ? undefined : body.parameters?.retry_after;
  return retryAfterSeconds === undefined
    ? context.json(body, status)
    : context.json(body, status, { 'Retry-After': String(retryAfterSeconds) });
}
