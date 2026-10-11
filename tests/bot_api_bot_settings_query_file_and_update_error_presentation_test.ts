import { presentBotProfileFailure } from '../src/api/sessions/bot_api/errors/bot_profile_failure_presenter.ts';
import { presentFilePreparationFailure } from '../src/api/sessions/bot_api/errors/file_failure_presenter.ts';
import { presentQueryAnswerFailure } from '../src/api/sessions/bot_api/errors/query_answer_failure_presenter.ts';
import { presentUpdateDeliveryFailure } from '../src/api/sessions/bot_api/errors/update_delivery_failure_presenter.ts';
import type { EmulationSession } from '../src/session/emulation_session.ts';
import {
  type CasesByReason,
  expectPresentations,
  SUPERGROUP_ACCESS_CASES,
} from './support/bot_api_error_presentation.ts';

// The families of the bot's own settings, its answers to queries, the files it downloads, and how
// it receives updates. Each case is Telegram's literal answer.

type BotApi = EmulationSession['botApi'];

type CommandListChangeFailure = Extract<
  ReturnType<BotApi['setMyCommands']>,
  { readonly set: false }
>;
type CommandListReadFailure = Extract<
  ReturnType<BotApi['getMyCommands']>,
  { readonly found: false }
>;
type CommandListDeletionFailure = Extract<
  ReturnType<BotApi['deleteMyCommands']>,
  { readonly deleted: false }
>;
type DescriptionChangeFailure = Extract<
  ReturnType<BotApi['setMyDescription']>,
  { readonly set: false }
>;
type DescriptionReadFailure = Extract<
  ReturnType<BotApi['getMyDescription']>,
  { readonly found: false }
>;
type MenuButtonChangeFailure = Extract<
  ReturnType<BotApi['setChatMenuButton']>,
  { readonly set: false }
>;
type MenuButtonReadFailure = Extract<
  ReturnType<BotApi['getChatMenuButton']>,
  { readonly found: false }
>;
type CallbackQueryAnswerFailure = Extract<
  ReturnType<BotApi['answerCallbackQuery']>,
  { readonly answered: false }
>;
type InlineQueryAnswerFailure = Extract<
  ReturnType<BotApi['answerInlineQuery']>,
  { readonly answered: false }
>;
/** A poll that its session ended is refused without an answer, so the presenter never sees it. */
type FilePreparationFailure = Extract<ReturnType<BotApi['getFile']>, { readonly found: false }>;
type UpdatesPollFailure = Extract<
  Parameters<typeof presentUpdateDeliveryFailure>[0],
  { readonly retrieved: false }
>;
type WebhookSettingFailure = Extract<
  ReturnType<BotApi['setWebhook']>,
  { readonly accepted: false }
>;

const LANGUAGE_CODE_INVALID = [400, 'Bad Request: invalid language code specified'] as const;
const USER_NOT_FOUND = [400, 'Bad Request: user not found'] as const;

/** The failures of the scope and language that address a command list. */
const COMMAND_LIST_TARGET_CASES = {
  ...SUPERGROUP_ACCESS_CASES,
  scope_not_allowed_in_private_chats: [
    [
      { reason: 'scope_not_allowed_in_private_chats' },
      400,
      "Bad Request: can't use specified scope in private chats",
    ],
  ],
  language_code_invalid: [[{ reason: 'language_code_invalid' }, ...LANGUAGE_CODE_INVALID]],
} as const;

const COMMAND_LIST_CHANGE_CASES: CasesByReason<CommandListChangeFailure, 'set'> = {
  ...COMMAND_LIST_TARGET_CASES,
  command_not_utf8: [
    [{ reason: 'command_not_utf8' }, 400, 'Bad Request: command must be encoded in UTF-8'],
  ],
  command_description_not_utf8: [
    [
      { reason: 'command_description_not_utf8' },
      400,
      'Bad Request: command description must be encoded in UTF-8',
    ],
  ],
  command_empty: [[{ reason: 'command_empty' }, 400, 'Bad Request: command must be non-empty']],
  command_too_long: [
    [{ reason: 'command_too_long' }, 400, 'Bad Request: command length must not exceed 32'],
  ],
  command_description_empty: [
    [
      { reason: 'command_description_empty' },
      400,
      'Bad Request: command description must be non-empty',
    ],
  ],
  command_description_too_long: [
    [
      { reason: 'command_description_too_long' },
      400,
      'Bad Request: command description length must not exceed 256',
    ],
  ],
  too_many_commands: [[{ reason: 'too_many_commands' }, 400, 'Bad Request: BOT_COMMANDS_TOO_MUCH']],
  command_invalid: [[{ reason: 'command_invalid' }, 400, 'Bad Request: BOT_COMMAND_INVALID']],
};

const COMMAND_LIST_READ_CASES: CasesByReason<CommandListReadFailure, 'found'> =
  COMMAND_LIST_TARGET_CASES;
const COMMAND_LIST_DELETION_CASES: CasesByReason<CommandListDeletionFailure, 'deleted'> =
  COMMAND_LIST_TARGET_CASES;

const DESCRIPTION_CHANGE_CASES: CasesByReason<DescriptionChangeFailure, 'set'> = {
  text_not_utf8: [
    [{ reason: 'text_not_utf8' }, 400, 'Bad Request: strings must be encoded in UTF-8'],
  ],
  language_code_invalid: [[{ reason: 'language_code_invalid' }, ...LANGUAGE_CODE_INVALID]],
};

const DESCRIPTION_READ_CASES: CasesByReason<DescriptionReadFailure, 'found'> = {
  language_code_invalid: [[{ reason: 'language_code_invalid' }, ...LANGUAGE_CODE_INVALID]],
};

const MENU_BUTTON_CHANGE_CASES: CasesByReason<MenuButtonChangeFailure, 'set'> = {
  user_not_found: [[{ reason: 'user_not_found' }, ...USER_NOT_FOUND]],
  menu_button_text_empty: [
    [{ reason: 'menu_button_text_empty' }, 400, 'Bad Request: menu button text must be non-empty'],
  ],
  menu_button_text_not_utf8: [
    [
      { reason: 'menu_button_text_not_utf8' },
      400,
      'Bad Request: menu button text must be encoded in UTF-8',
    ],
  ],
  menu_button_url_not_utf8: [
    [
      { reason: 'menu_button_url_not_utf8' },
      400,
      'Bad Request: menu button URL must be encoded in UTF-8',
    ],
  ],
  web_app_url_invalid: [
    [
      { reason: 'web_app_url_invalid', urlError: 'URL must use HTTPS' },
      400,
      'Bad Request: menu button Web App URL must use HTTPS',
    ],
  ],
};

const MENU_BUTTON_READ_CASES: CasesByReason<MenuButtonReadFailure, 'found'> = {
  user_not_found: [[{ reason: 'user_not_found' }, ...USER_NOT_FOUND]],
};

const QUERY_ID_INVALID = [
  400,
  'Bad Request: query is too old and response timeout expired or query ID is invalid',
] as const;

const CALLBACK_QUERY_ANSWER_CASES: CasesByReason<CallbackQueryAnswerFailure, 'answered'> = {
  callback_query_not_answerable: [
    [{ reason: 'callback_query_not_answerable' }, ...QUERY_ID_INVALID],
  ],
  url_invalid: [[{ reason: 'url_invalid' }, 400, 'Bad Request: URL_INVALID']],
};

const INLINE_QUERY_ANSWER_CASES: CasesByReason<InlineQueryAnswerFailure, 'answered'> = {
  start_parameter_empty: [
    [{ reason: 'start_parameter_empty' }, 400, "Bad Request: can't use empty start_parameter"],
  ],
  start_parameter_too_long: [
    [
      { reason: 'start_parameter_too_long' },
      400,
      'Bad Request: too long start_parameter specified',
    ],
  ],
  start_parameter_invalid: [
    [
      { reason: 'start_parameter_invalid' },
      400,
      'Bad Request: unallowed characters in start_parameter are used',
    ],
  ],
  too_many_results: [
    [{ reason: 'too_many_results' }, 400, 'Bad Request: too many inline query results specified'],
  ],
  query_id_invalid: [[{ reason: 'query_id_invalid' }, ...QUERY_ID_INVALID]],
  next_offset_invalid: [[
    { reason: 'next_offset_invalid' },
    400,
    'Bad Request: NEXT_OFFSET_INVALID',
  ]],
  result_id_empty: [[{ reason: 'result_id_empty' }, 400, 'Bad Request: RESULT_ID_EMPTY']],
  result_id_invalid: [[{ reason: 'result_id_invalid' }, 400, 'Bad Request: RESULT_ID_INVALID']],
  result_id_duplicate: [[
    { reason: 'result_id_duplicate' },
    400,
    'Bad Request: RESULT_ID_DUPLICATE',
  ]],
  article_title_empty: [[
    { reason: 'article_title_empty' },
    400,
    'Bad Request: ARTICLE_TITLE_EMPTY',
  ]],
  document_title_empty: [[
    { reason: 'document_title_empty' },
    400,
    'Bad Request: FILE_TITLE_EMPTY',
  ]],
  video_title_empty: [[{ reason: 'video_title_empty' }, 400, 'Bad Request: VIDEO_TITLE_EMPTY']],
  web_document_url_invalid: [
    [{ reason: 'web_document_url_invalid' }, 400, 'Bad Request: WEBDOCUMENT_URL_INVALID'],
  ],
  photo_thumbnail_url_empty: [
    [{ reason: 'photo_thumbnail_url_empty' }, 400, 'Bad Request: PHOTO_THUMB_URL_EMPTY'],
  ],
  callback_data_invalid: [
    [{ reason: 'callback_data_invalid' }, 400, 'Bad Request: BUTTON_DATA_INVALID'],
  ],
  text_invalid: [
    [
      {
        reason: 'text_invalid',
        textError: "Can't find end of the entity starting at byte offset 0",
      },
      400,
      "Bad Request: can't find end of the entity starting at byte offset 0",
    ],
  ],
  message_text_too_long: [[
    { reason: 'message_text_too_long' },
    400,
    'Bad Request: MESSAGE_TOO_LONG',
  ]],
  caption_too_long: [[{ reason: 'caption_too_long' }, 400, 'Bad Request: MEDIA_CAPTION_TOO_LONG']],
  file_id_invalid: [
    [
      { reason: 'file_id_invalid' },
      400,
      "Bad Request: wrong remote file identifier specified: can't unserialize it",
    ],
  ],
  file_type_mismatch: [
    [
      { reason: 'file_type_mismatch', expectedFileType: 'photo', actualFileType: 'document' },
      400,
      "Bad Request: can't use file of type Document as Photo",
    ],
  ],
  inline_message_content_invalid: [
    [
      { reason: 'inline_message_content_invalid' },
      400,
      'Bad Request: invalid inline message content specified',
    ],
  ],
  contact_phone_number_empty: [
    [
      { reason: 'contact_phone_number_empty' },
      400,
      'Bad Request: field "phone_number" must contain a valid phone number',
    ],
  ],
  contact_first_name_empty: [
    [
      { reason: 'contact_first_name_empty' },
      400,
      'Bad Request: field "first_name" must be non-empty',
    ],
  ],
};

const UPDATES_POLL_CASES: CasesByReason<UpdatesPollFailure, 'retrieved'> = {
  terminated_by_other_long_poll: [
    [
      { reason: 'terminated_by_other_long_poll' },
      409,
      'Conflict: terminated by other getUpdates request; make sure that only one bot instance is running',
    ],
  ],
  terminated_by_webhook: [
    [{ reason: 'terminated_by_webhook' }, 409, 'Conflict: terminated by setWebhook request'],
  ],
  webhook_active: [
    [
      { reason: 'webhook_active' },
      409,
      "Conflict: can't use getUpdates method while webhook is active; use deleteWebhook to delete the webhook first",
    ],
  ],
};

const FILE_PREPARATION_CASES: CasesByReason<FilePreparationFailure, 'found'> = {
  file_id_invalid: [[{ reason: 'file_id_invalid' }, 400, 'Bad Request: invalid file_id']],
  file_too_big: [[{ reason: 'file_too_big' }, 400, 'Bad Request: file is too big']],
};

const WEBHOOK_SETTING_CASES: CasesByReason<WebhookSettingFailure, 'accepted'> = {
  url_invalid: [[{ reason: 'url_invalid' }, 400, 'Bad Request: invalid webhook URL specified']],
  secret_token_too_long: [
    [{ reason: 'secret_token_too_long' }, 400, 'Bad Request: secret token is too long'],
  ],
  secret_token_invalid: [
    [
      { reason: 'secret_token_invalid' },
      400,
      'Bad Request: secret token contains illegal characters',
    ],
  ],
};

Deno.test('the bot profile family answers every failure as Telegram does', () => {
  expectPresentations(
    COMMAND_LIST_CHANGE_CASES,
    (failure) => presentBotProfileFailure({ set: false, ...failure }),
    'command_list_change',
  );
  expectPresentations(
    COMMAND_LIST_READ_CASES,
    (failure) => presentBotProfileFailure({ found: false, ...failure }),
    'command_list_read',
  );
  expectPresentations(
    COMMAND_LIST_DELETION_CASES,
    (failure) => presentBotProfileFailure({ deleted: false, ...failure }),
    'command_list_deletion',
  );
  expectPresentations(
    DESCRIPTION_CHANGE_CASES,
    (failure) => presentBotProfileFailure({ set: false, ...failure }),
    'description_change',
  );
  expectPresentations(
    DESCRIPTION_READ_CASES,
    (failure) => presentBotProfileFailure({ found: false, ...failure }),
    'description_read',
  );
  expectPresentations(
    MENU_BUTTON_CHANGE_CASES,
    (failure) => presentBotProfileFailure({ set: false, ...failure }),
    'menu_button_change',
  );
  expectPresentations(
    MENU_BUTTON_READ_CASES,
    (failure) => presentBotProfileFailure({ found: false, ...failure }),
    'menu_button_read',
  );
});

Deno.test('the query answer family answers every failure as Telegram does', () => {
  expectPresentations(
    CALLBACK_QUERY_ANSWER_CASES,
    (failure) => presentQueryAnswerFailure({ answered: false, ...failure }),
    'callback_query_answer',
  );
  expectPresentations(
    INLINE_QUERY_ANSWER_CASES,
    (failure) => presentQueryAnswerFailure({ answered: false, ...failure }),
    'inline_query_answer',
  );
});

Deno.test('the file family answers every failure as Telegram does', () => {
  expectPresentations(
    FILE_PREPARATION_CASES,
    (failure) => presentFilePreparationFailure({ found: false, ...failure }),
    'file_preparation',
  );
});

Deno.test('the update delivery family answers every failure as Telegram does', () => {
  expectPresentations(
    UPDATES_POLL_CASES,
    (failure) => presentUpdateDeliveryFailure({ retrieved: false, ...failure }),
    'updates_poll',
  );
  expectPresentations(
    WEBHOOK_SETTING_CASES,
    (failure) => presentUpdateDeliveryFailure({ accepted: false, ...failure }),
    'webhook_setting',
  );
});
