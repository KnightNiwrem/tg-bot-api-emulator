import { assertEquals } from '@std/assert';
import { BOT_API_ERRORS } from '../src/api/sessions/bot_api/errors/error_catalogue.ts';
import type { BotApiErrorProvenance } from '../src/api/sessions/bot_api/errors/error_template.ts';
import { presentMessageEditingFailure } from '../src/api/sessions/bot_api/errors/message_editing_failure_presenter.ts';
import { presentMessageSendingFailure } from '../src/api/sessions/bot_api/errors/message_sending_failure_presenter.ts';
import type { BotApiMethodAnswer } from '../src/api/sessions/bot_api/method_call.ts';
import type { EmulationSession } from '../src/types/emulation_session.ts';

// The expected answers are Telegram's literal statuses and descriptions, written out rather than
// read from the catalogue, so that an edit of a catalogue entry fails these tests.

type BotApi = EmulationSession['botApi'];

type SendFailure = Extract<ReturnType<BotApi['sendMediaGroup']>, { readonly sent: false }>;
type ChatActionFailure = Extract<ReturnType<BotApi['sendChatAction']>, { readonly sent: false }>;
type DraftFailure = Extract<ReturnType<BotApi['sendMessageDraft']>, { readonly sent: false }>;
type ChatMessageEditFailure =
  | Extract<ReturnType<BotApi['editMessageText']>, { readonly edited: false }>
  | Extract<ReturnType<BotApi['editMessageCaption']>, { readonly edited: false }>
  | Extract<ReturnType<BotApi['editMessageMedia']>, { readonly edited: false }>
  | Extract<ReturnType<BotApi['editMessageReplyMarkup']>, { readonly edited: false }>;
type InlineMessageEditFailure =
  | Extract<ReturnType<BotApi['editInlineMessageText']>, { readonly edited: false }>
  | Extract<ReturnType<BotApi['editInlineMessageCaption']>, { readonly edited: false }>
  | Extract<ReturnType<BotApi['editInlineMessageMedia']>, { readonly edited: false }>
  | Extract<ReturnType<BotApi['editInlineMessageReplyMarkup']>, { readonly edited: false }>;
type PollStopFailure = Extract<ReturnType<BotApi['stopPoll']>, { readonly stopped: false }>;

/** A failure without the flag that tells its operation's outcome, which each test adds back. */
type FailureDetails<Failure> = Failure extends unknown
  ? Omit<Failure, 'sent' | 'edited' | 'stopped'>
  : never;

/** A failure with the status and description Telegram answers it with. */
type PresentationCase<Failure> = readonly [failure: Failure, status: number, description: string];

/**
 * Cases for every reason an operation fails for, so the compiler asks for a case when a reason is
 * added to the operation.
 */
type CasesByReason<Failure extends { readonly reason: string }> = {
  readonly [Reason in Failure['reason']]: readonly PresentationCase<
    FailureDetails<Failure & { readonly reason: Reason }>
  >[];
};

const CHAT_NOT_FOUND = [400, 'Bad Request: chat not found'] as const;
const BOT_NOT_A_MEMBER = [403, 'Forbidden: bot is not a member of the supergroup chat'] as const;
const BOT_KICKED = [403, 'Forbidden: bot was kicked from the supergroup chat'] as const;
const BOT_BLOCKED = [403, 'Forbidden: bot was blocked by the user'] as const;

/** The chat access failures shared by every operation of both families. */
const CHAT_ACCESS_CASES = {
  chat_not_found: [[{ reason: 'chat_not_found' }, ...CHAT_NOT_FOUND]],
  account_not_found: [[{ reason: 'account_not_found' }, ...CHAT_NOT_FOUND]],
  conversation_not_started: [[{ reason: 'conversation_not_started' }, ...CHAT_NOT_FOUND]],
  bot_not_a_member: [[{ reason: 'bot_not_a_member' }, ...BOT_NOT_A_MEMBER]],
  bot_kicked: [[{ reason: 'bot_kicked' }, ...BOT_KICKED]],
} as const;

/** The failures about a message's text, buttons and files, shared by sending and editing. */
const MESSAGE_CONTENT_CASES = {
  message_text_empty: [[
    { reason: 'message_text_empty' },
    400,
    'Bad Request: message text is empty',
  ]],
  text_invalid: [
    [
      {
        reason: 'text_invalid',
        textError: "Can't find end of the entity starting at byte offset 0",
      },
      400,
      "Bad Request: can't find end of the entity starting at byte offset 0",
    ],
    [
      { reason: 'text_invalid', textError: 'ENTITY_BOUNDS_INVALID' },
      400,
      'Bad Request: ENTITY_BOUNDS_INVALID',
    ],
  ],
  message_text_too_long: [
    [{ reason: 'message_text_too_long' }, 400, 'Bad Request: message is too long'],
  ],
  caption_too_long: [
    [{ reason: 'caption_too_long' }, 400, 'Bad Request: message caption is too long'],
  ],
  callback_data_invalid: [
    [{ reason: 'callback_data_invalid' }, 400, 'Bad Request: BUTTON_DATA_INVALID'],
  ],
  button_type_invalid: [
    [{ reason: 'button_type_invalid' }, 400, 'Bad Request: BUTTON_TYPE_INVALID'],
  ],
  send_permission_missing: [
    [
      { reason: 'send_permission_missing', contentKind: 'text' },
      400,
      'Bad Request: not enough rights to send text messages to the chat',
    ],
    [
      { reason: 'send_permission_missing', contentKind: 'photo' },
      400,
      'Bad Request: not enough rights to send photos to the chat',
    ],
    [
      { reason: 'send_permission_missing', contentKind: 'document' },
      400,
      'Bad Request: not enough rights to send documents to the chat',
    ],
    [
      { reason: 'send_permission_missing', contentKind: 'video' },
      400,
      'Bad Request: not enough rights to send videos to the chat',
    ],
    [
      { reason: 'send_permission_missing', contentKind: 'voice' },
      400,
      'Bad Request: not enough rights to send voice notes to the chat',
    ],
    [
      { reason: 'send_permission_missing', contentKind: 'audio' },
      400,
      'Bad Request: not enough rights to send music to the chat',
    ],
    [
      { reason: 'send_permission_missing', contentKind: 'poll' },
      400,
      'Bad Request: not enough rights to send polls to the chat',
    ],
    [
      { reason: 'send_permission_missing', contentKind: 'rich_message' },
      400,
      'Bad Request: not enough rights to send the rich message to the chat',
    ],
    [
      { reason: 'send_permission_missing', contentKind: 'contact' },
      400,
      'Bad Request: not enough rights to send contacts to the chat',
    ],
    [
      { reason: 'send_permission_missing', contentKind: 'location' },
      400,
      'Bad Request: not enough rights to send locations to the chat',
    ],
  ],
  file_empty: [[{ reason: 'file_empty' }, 400, 'Bad Request: file must be non-empty']],
  image_invalid: [[{ reason: 'image_invalid' }, 400, 'Bad Request: IMAGE_PROCESS_FAILED']],
  photo_dimensions_invalid: [
    [{ reason: 'photo_dimensions_invalid' }, 400, 'Bad Request: PHOTO_INVALID_DIMENSIONS'],
  ],
  file_id_invalid: [
    [{ reason: 'file_id_invalid' }, 400, 'Bad Request: wrong file identifier/HTTP URL specified'],
  ],
  photo_too_big: [
    [
      { reason: 'photo_too_big', fileSizeBytes: 10485761 },
      400,
      'Bad Request: file of size 10485761 bytes is too big for a photo; ' +
      'the maximum size is 10485760 bytes',
    ],
  ],
  bot_upload_too_big: [
    [
      {
        reason: 'bot_upload_too_big',
        uploadProfile: 'cloud',
        fileSizeBytes: 52428801,
        maxFileSizeBytes: 52428800,
      },
      413,
      'Request Entity Too Large',
    ],
    [
      {
        reason: 'bot_upload_too_big',
        uploadProfile: 'local',
        fileSizeBytes: 2097152001,
        maxFileSizeBytes: 2097152000,
      },
      400,
      'Bad Request: file of size 2097152001 bytes is too big; the maximum size is 2097152000 bytes',
    ],
  ],
  file_type_mismatch: [
    [
      { reason: 'file_type_mismatch', expectedFileType: 'photo', actualFileType: 'document' },
      400,
      "Bad Request: can't use file of type Document as Photo",
    ],
    [
      { reason: 'file_type_mismatch', expectedFileType: 'voice', actualFileType: 'audio' },
      400,
      "Bad Request: can't use file of type Audio as VoiceNote",
    ],
  ],
} as const;

const MESSAGE_SEND_CASES: CasesByReason<SendFailure> = {
  ...CHAT_ACCESS_CASES,
  ...MESSAGE_CONTENT_CASES,
  bot_blocked: [[{ reason: 'bot_blocked' }, ...BOT_BLOCKED]],
  reply_message_not_found: [
    [{ reason: 'reply_message_not_found' }, 400, 'Bad Request: message to be replied not found'],
  ],
  quote_invalid: [[{ reason: 'quote_invalid' }, 400, 'Bad Request: QUOTE_TEXT_INVALID']],
  message_effect_not_allowed_in_chat: [
    [
      { reason: 'message_effect_not_allowed_in_chat' },
      400,
      "Bad Request: can't use message effects in the chat",
    ],
  ],
  poll_question_too_long: [
    [
      { reason: 'poll_question_too_long' },
      400,
      'Bad Request: poll question length must not exceed 300',
    ],
  ],
  poll_options_missing: [
    [
      { reason: 'poll_options_missing' },
      400,
      'Bad Request: poll must have at least one answer option',
    ],
  ],
  poll_has_too_many_options: [
    [
      { reason: 'poll_has_too_many_options' },
      400,
      "Bad Request: poll can't have more than 12 options",
    ],
  ],
  poll_option_too_long: [
    [
      { reason: 'poll_option_too_long' },
      400,
      'Bad Request: poll options length must not exceed 100',
    ],
  ],
  quiz_correct_options_missing: [
    [
      { reason: 'quiz_correct_options_missing' },
      400,
      'Bad Request: correct quiz option list must be non-empty',
    ],
  ],
  quiz_correct_options_not_increasing: [
    [
      { reason: 'quiz_correct_options_not_increasing' },
      400,
      'Bad Request: correct quiz option list must be increasing',
    ],
  ],
  quiz_correct_option_not_found: [
    [{ reason: 'quiz_correct_option_not_found' }, 400, 'Bad Request: wrong quiz correct_option_id'],
  ],
  quiz_explanation_too_long: [
    [
      { reason: 'quiz_explanation_too_long' },
      400,
      'Bad Request: quiz explanation must have at most 200 characters',
    ],
  ],
  quiz_explanation_has_too_many_line_feeds: [
    [
      { reason: 'quiz_explanation_has_too_many_line_feeds' },
      400,
      'Bad Request: quiz explanation must have at most 2 line feeds',
    ],
  ],
  poll_open_period_invalid: [
    [
      { reason: 'poll_open_period_invalid' },
      400,
      'Bad Request: open_period must be from 5 to 2628000 seconds',
    ],
  ],
  poll_close_date_invalid: [
    [
      { reason: 'poll_close_date_invalid' },
      400,
      'Bad Request: close_date must be from 5 to 2628000 seconds in the future',
    ],
  ],
  album_empty: [[{ reason: 'album_empty' }, 400, 'Bad Request: there are no messages to send']],
  album_too_large: [
    [{ reason: 'album_too_large' }, 400, 'Bad Request: too many messages to send as an album'],
  ],
  album_caption_placement_mixed: [
    [
      { reason: 'album_caption_placement_mixed' },
      400,
      'Bad Request: parameter show_caption_above_media must be the same for all messages',
    ],
  ],
  album_documents_mixed: [
    [
      { reason: 'album_documents_mixed' },
      400,
      "Bad Request: document can't be mixed with other media types",
    ],
  ],
  album_audio_mixed: [
    [
      { reason: 'album_audio_mixed' },
      400,
      "Bad Request: audio can't be mixed with other media types",
    ],
  ],
  media_group_member_not_sent: [
    [
      {
        reason: 'media_group_member_not_sent',
        memberPosition: 2,
        failure: { reason: 'image_invalid' },
      },
      400,
      'Bad Request: failed to send message #2 with the error message "IMAGE_PROCESS_FAILED"',
    ],
    [
      {
        reason: 'media_group_member_not_sent',
        memberPosition: 1,
        failure: { reason: 'photo_dimensions_invalid' },
      },
      400,
      'Bad Request: failed to send message #1 with the error message "PHOTO_INVALID_DIMENSIONS"',
    ],
    [
      {
        reason: 'media_group_member_not_sent',
        memberPosition: 3,
        failure: {
          reason: 'bot_upload_too_big',
          uploadProfile: 'local',
          fileSizeBytes: 2097152001,
          maxFileSizeBytes: 2097152000,
        },
      },
      400,
      'Bad Request: failed to send message #3 with the error message ' +
      '"File of size 2097152001 bytes is too big; the maximum size is 2097152000 bytes"',
    ],
  ],
};

const CHAT_ACTION_CASES: CasesByReason<ChatActionFailure> = {
  ...CHAT_ACCESS_CASES,
  bot_blocked: [[{ reason: 'bot_blocked' }, ...BOT_BLOCKED]],
};

const MESSAGE_DRAFT_CASES: CasesByReason<DraftFailure> = {
  ...CHAT_ACCESS_CASES,
  bot_blocked: [[{ reason: 'bot_blocked' }, ...BOT_BLOCKED]],
  text_invalid: MESSAGE_CONTENT_CASES.text_invalid,
  message_text_too_long: [
    [{ reason: 'message_text_too_long' }, 400, 'Bad Request: message is too long'],
  ],
  draft_chat_not_private: [
    [{ reason: 'draft_chat_not_private' }, 400, 'Bad Request: TEXTDRAFT_PEER_INVALID'],
  ],
  draft_id_missing: [[{ reason: 'draft_id_missing' }, 400, 'Bad Request: RANDOM_ID_INVALID']],
};

/** The failures about the edited message, shared by edits addressed either way. */
const EDITED_MESSAGE_CASES = {
  message_has_no_text: [
    [
      { reason: 'message_has_no_text' },
      400,
      'Bad Request: there is no text in the message to edit',
    ],
  ],
  message_has_no_caption: [
    [
      { reason: 'message_has_no_caption' },
      400,
      'Bad Request: there is no caption in the message to edit',
    ],
  ],
  message_media_not_editable: [
    [{ reason: 'message_media_not_editable' }, 400, "Bad Request: message media can't be edited"],
  ],
  message_not_modified: [
    [
      { reason: 'message_not_modified' },
      400,
      'Bad Request: message is not modified: specified new message content and reply markup are ' +
      'exactly the same as a current content and reply markup of the message',
    ],
  ],
} as const;

const CHAT_MESSAGE_EDIT_CASES: CasesByReason<ChatMessageEditFailure> = {
  ...CHAT_ACCESS_CASES,
  ...MESSAGE_CONTENT_CASES,
  ...EDITED_MESSAGE_CASES,
  message_not_found: [[
    { reason: 'message_not_found' },
    400,
    'Bad Request: message to edit not found',
  ]],
  message_not_editable: [
    [{ reason: 'message_not_editable' }, 400, "Bad Request: message can't be edited"],
  ],
  album_media_kind_changed: [
    [
      { reason: 'album_media_kind_changed' },
      400,
      "Bad Request: can't change media type in the album",
    ],
  ],
};

const INLINE_MESSAGE_EDIT_CASES: CasesByReason<InlineMessageEditFailure> = {
  ...MESSAGE_CONTENT_CASES,
  ...EDITED_MESSAGE_CASES,
  message_not_found: [[{ reason: 'message_not_found' }, 400, 'Bad Request: MESSAGE_ID_INVALID']],
  inline_message_upload_unsupported: [
    [
      { reason: 'inline_message_upload_unsupported' },
      400,
      'Bad Request: invalid message content specified',
    ],
  ],
};

const POLL_STOP_CASES: CasesByReason<PollStopFailure> = {
  ...CHAT_ACCESS_CASES,
  callback_data_invalid: MESSAGE_CONTENT_CASES.callback_data_invalid,
  button_type_invalid: MESSAGE_CONTENT_CASES.button_type_invalid,
  message_not_found: [
    [{ reason: 'message_not_found' }, 400, 'Bad Request: message with poll to stop not found'],
  ],
  message_has_no_poll: [[
    { reason: 'message_has_no_poll' },
    400,
    'Bad Request: message is not a poll',
  ]],
  poll_not_stoppable: [[
    { reason: 'poll_not_stoppable' },
    400,
    "Bad Request: poll can't be stopped",
  ]],
  poll_already_closed: [
    [{ reason: 'poll_already_closed' }, 400, 'Bad Request: poll has already been closed'],
  ],
};

Deno.test('the message sending family answers every failure as Telegram does', () => {
  expectPresentations(
    MESSAGE_SEND_CASES,
    (failure) => presentMessageSendingFailure('message_send', { sent: false, ...failure }),
    'message_send',
  );
  expectPresentations(
    CHAT_ACTION_CASES,
    (failure) => presentMessageSendingFailure('chat_action', { sent: false, ...failure }),
    'chat_action',
  );
  expectPresentations(
    MESSAGE_DRAFT_CASES,
    (failure) => presentMessageSendingFailure('message_draft', { sent: false, ...failure }),
    'message_draft',
  );
});

Deno.test('the message editing family answers every failure as Telegram does', () => {
  expectPresentations(
    CHAT_MESSAGE_EDIT_CASES,
    (failure) => presentMessageEditingFailure('chat_message_edit', { edited: false, ...failure }),
    'chat_message_edit',
  );
  expectPresentations(
    INLINE_MESSAGE_EDIT_CASES,
    (failure) => presentMessageEditingFailure('inline_message_edit', { edited: false, ...failure }),
    'inline_message_edit',
  );
  expectPresentations(
    POLL_STOP_CASES,
    (failure) => presentMessageEditingFailure('poll_stop', { stopped: false, ...failure }),
    'poll_stop',
  );
});

Deno.test('every catalogue entry names where its description comes from', () => {
  const variedProvenances: Readonly<Record<string, readonly BotApiErrorProvenance[]>> = {
    botUploadTooBig: [
      BOT_API_ERRORS.botUploadTooBig.provenance(uploadTooBig('cloud')),
      BOT_API_ERRORS.botUploadTooBig.provenance(uploadTooBig('local')),
    ],
    albumMemberUploadRefused: [
      BOT_API_ERRORS.albumMemberUploadRefused.provenance({ refusal: { reason: 'image_invalid' } }),
      BOT_API_ERRORS.albumMemberUploadRefused.provenance({ refusal: uploadTooBig('local') }),
    ],
    inputFileMissing: (['photo', 'document', 'video', 'voice', 'audio'] as const).map((fileKind) =>
      BOT_API_ERRORS.inputFileMissing.provenance({ fileKind })
    ),
  };
  const problems = Object.entries(BOT_API_ERRORS).flatMap(([name, entry]) => {
    const provenances = hasFixedProvenance(entry)
      ? [entry.provenance()]
      : variedProvenances[name] ?? [];
    if (provenances.length === 0) {
      return [`${name} varies its provenance but has no sample here`];
    }
    return provenances.filter((provenance) => !isPinnedOrExplained(provenance)).map(() => name);
  });
  if (problems.length > 0) {
    throw new Error(`Expected pinned or explained provenance, received ${problems.join('; ')}`);
  }
});

Deno.test('an upload limit is answered as Telegram answers it under each server', () => {
  expectAnswer(
    presentMessageSendingFailure('message_send', { sent: false, ...uploadTooBig('cloud') }),
    [413, 'Request Entity Too Large'],
    'cloud upload',
  );
  const provenances = [
    BOT_API_ERRORS.botUploadTooBig.provenance(uploadTooBig('cloud')).basis,
    BOT_API_ERRORS.botUploadTooBig.provenance(uploadTooBig('local')).basis,
  ];
  assertEquals(
    provenances,
    ['observed_behavior', 'emulator_inference'],
    'Expected the provenance to vary with the server',
  );
});

function uploadTooBig<UploadProfile extends 'cloud' | 'local'>(uploadProfile: UploadProfile) {
  return {
    reason: 'bot_upload_too_big',
    uploadProfile,
    fileSizeBytes: 3_000_000_000,
    maxFileSizeBytes: 2_097_152_000,
  } as const;
}

/** Whether a provenance links to a pinned source or Telegram's documentation, or explains itself. */
function isPinnedOrExplained(provenance: BotApiErrorProvenance): boolean {
  switch (provenance.basis) {
    case 'tdlib_source':
      return provenance.reference.startsWith(
        'https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td',
      );
    case 'bot_api_server_source':
      return provenance.reference.startsWith(
        'https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/',
      );
    case 'documented_remote_behavior':
      return provenance.reference.startsWith('https://core.telegram.org/method/');
    case 'observed_behavior':
      return provenance.observation.length > 0;
    case 'emulator_inference':
      return provenance.rationale.length > 0;
    default: {
      const unhandledProvenance: never = provenance;
      throw new Error(`Unhandled provenance: ${JSON.stringify(unhandledProvenance)}`);
    }
  }
}

/** Whether an entry's provenance takes no details, which a function without parameters shows. */
function hasFixedProvenance(
  entry: { readonly provenance: (details: never) => BotApiErrorProvenance },
): entry is { readonly provenance: () => BotApiErrorProvenance } {
  return entry.provenance.length === 0;
}

function expectPresentations<Failure extends { readonly reason: string }>(
  casesByReason: CasesByReason<Failure>,
  present: (failure: FailureDetails<Failure>) => BotApiMethodAnswer,
  operation: string,
): void {
  const casesOfReasons: readonly (readonly PresentationCase<FailureDetails<Failure>>[])[] = Object
    .values(
      casesByReason,
    );
  for (const [failure, status, description] of casesOfReasons.flat()) {
    expectAnswer(present(failure), [status, description], `${operation} ${failure.reason}`);
  }
}

function expectAnswer(
  answer: BotApiMethodAnswer,
  [status, description]: readonly [number, string],
  label: string,
): void {
  assertEquals(
    [answer.status, answer.body.ok, answer.body.description],
    [status, false, description],
    `Expected ${label} to be answered with its status and description`,
  );
}
