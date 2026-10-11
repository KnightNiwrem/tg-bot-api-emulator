import { presentMessageDeletionFailure } from '../src/api/sessions/bot_api/errors/message_deletion_failure_presenter.ts';
import { presentMessagePinningFailure } from '../src/api/sessions/bot_api/errors/message_pinning_failure_presenter.ts';
import { presentMessageReactionFailure } from '../src/api/sessions/bot_api/errors/message_reaction_failure_presenter.ts';
import { presentMessageRepetitionFailure } from '../src/api/sessions/bot_api/errors/message_repetition_failure_presenter.ts';
import type { EmulationSession } from '../src/types/emulation_session.ts';
import {
  BOT_BLOCKED,
  type CasesByReason,
  CHAT_ACCESS_CASES,
  CHAT_NOT_FOUND,
  expectAnswer,
  expectPresentations,
  SUPERGROUP_ACCESS_CASES,
} from './support/bot_api_error_presentation.ts';

// The families that act on messages already sent: forwards and copies, deletions, pins and
// reactions. Each case is Telegram's literal answer.

type BotApi = EmulationSession['botApi'];

type SendFailure = Extract<ReturnType<BotApi['sendMessage']>, { readonly sent: false }>;
/** The failures of a forward that a send cannot have. */
type ForwardOnlyFailure = Exclude<
  Extract<ReturnType<BotApi['forwardMessage']>, { readonly sent: false }>,
  SendFailure
>;
/** The failures of a copy that a send cannot have. */
type CopyOnlyFailure = Exclude<
  Extract<ReturnType<BotApi['copyMessage']>, { readonly sent: false }>,
  SendFailure
>;
/** The failures of a forward or copy of several messages that a send cannot have. */
type SeveralRepetitionOnlyFailure = Exclude<
  Extract<ReturnType<BotApi['forwardMessages']>, { readonly sent: false }>,
  SendFailure
>;
type DeletionFailure = Extract<
  ReturnType<BotApi['deleteMessage'] | BotApi['deleteMessages']>,
  { readonly deleted: false }
>;
type PinFailure = Extract<ReturnType<BotApi['pinChatMessage']>, { readonly pinned: false }>;
type UnpinFailure = Extract<
  ReturnType<BotApi['unpinChatMessage'] | BotApi['unpinAllChatMessages']>,
  { readonly unpinned: false }
>;
type ReactionFailure = Extract<
  ReturnType<BotApi['setMessageReaction']>,
  { readonly set: false }
>;

const FORWARD_CASES: CasesByReason<ForwardOnlyFailure, 'sent'> = {
  message_not_found: [
    [{ reason: 'message_not_found' }, 400, 'Bad Request: message to forward not found'],
  ],
  message_not_forwardable: [
    [{ reason: 'message_not_forwardable' }, 400, "Bad Request: the message can't be forwarded"],
  ],
};

const COPY_CASES: CasesByReason<CopyOnlyFailure, 'sent'> = {
  message_not_found: [
    [{ reason: 'message_not_found' }, 400, 'Bad Request: message to copy not found'],
  ],
  message_not_copyable: [
    [{ reason: 'message_not_copyable' }, 400, "Bad Request: the message can't be copied"],
  ],
};

/** TDLib forwards for copies too, so these read alike for both operations. */
const SEVERAL_REPETITION_CASES: CasesByReason<SeveralRepetitionOnlyFailure, 'sent'> = {
  repeated_messages_not_found: [
    [
      { reason: 'repeated_messages_not_found' },
      400,
      'Bad Request: there are no messages to forward',
    ],
  ],
  repeated_message_ids_not_increasing: [
    [
      { reason: 'repeated_message_ids_not_increasing' },
      400,
      'Bad Request: message identifiers must be in a strictly increasing order',
    ],
  ],
  messages_not_repeatable: [
    [{ reason: 'messages_not_repeatable' }, 400, "Bad Request: messages can't be forwarded"],
  ],
  message_effect_not_allowed_for_several_messages: [
    [
      { reason: 'message_effect_not_allowed_for_several_messages' },
      400,
      "Bad Request: can't use message effects in the method",
    ],
  ],
};

const DELETION_CASES: CasesByReason<DeletionFailure, 'deleted'> = {
  ...CHAT_ACCESS_CASES,
  message_not_found: [
    [{ reason: 'message_not_found' }, 400, 'Bad Request: message to delete not found'],
  ],
  message_not_deletable: [
    [{ reason: 'message_not_deletable' }, 400, "Bad Request: message can't be deleted"],
  ],
};

const NOT_ENOUGH_RIGHTS_TO_PIN = [
  400,
  'Bad Request: not enough rights to manage pinned messages in the chat',
] as const;
const PINS_NOT_MODIFIED = [400, 'Bad Request: CHAT_NOT_MODIFIED'] as const;

/** The failures of pins and unpins alike. */
const PIN_CHANGE_CASES = {
  ...SUPERGROUP_ACCESS_CASES,
  bot_blocked: [[{ reason: 'bot_blocked' }, ...BOT_BLOCKED]],
  not_enough_rights: [[{ reason: 'not_enough_rights' }, ...NOT_ENOUGH_RIGHTS_TO_PIN]],
  service_message_not_pinnable: [
    [
      { reason: 'service_message_not_pinnable' },
      400,
      "Bad Request: service messages can't be pinned",
    ],
  ],
} as const;

const PIN_CASES: CasesByReason<PinFailure, 'pinned'> = {
  ...PIN_CHANGE_CASES,
  message_not_found: [
    [{ reason: 'message_not_found' }, 400, 'Bad Request: message to pin not found'],
  ],
  message_already_pinned: [[{ reason: 'message_already_pinned' }, ...PINS_NOT_MODIFIED]],
};

const UNPIN_CASES: CasesByReason<UnpinFailure, 'unpinned'> = {
  ...PIN_CHANGE_CASES,
  message_not_found: [
    [{ reason: 'message_not_found' }, 400, 'Bad Request: message to unpin not found'],
  ],
  message_not_pinned: [[{ reason: 'message_not_pinned' }, ...PINS_NOT_MODIFIED]],
};

const REACTION_INVALID = [400, 'Bad Request: REACTION_INVALID'] as const;
const REACTIONS_TOO_MANY = [400, 'Bad Request: REACTIONS_TOO_MANY'] as const;

const REACTION_CASES: CasesByReason<ReactionFailure, 'set'> = {
  ...SUPERGROUP_ACCESS_CASES,
  private_chat_reactions_unsupported: [
    [
      { reason: 'private_chat_reactions_unsupported' },
      400,
      'Bad Request: reactions in private chats are not supported',
    ],
  ],
  message_not_found: [
    [{ reason: 'message_not_found' }, 400, 'Bad Request: message to react not found'],
  ],
  message_not_reactable: [[{ reason: 'message_not_reactable' }, ...REACTION_INVALID]],
  reaction_emoji_unsupported: [[{ reason: 'reaction_emoji_unsupported' }, ...REACTION_INVALID]],
  reaction_not_permitted: [
    [{ reason: 'reaction_not_permitted' }, 403, 'Forbidden: CHAT_WRITE_FORBIDDEN'],
  ],
  too_many_reactions: [[{ reason: 'too_many_reactions' }, ...REACTIONS_TOO_MANY]],
  too_many_distinct_reactions: [[{ reason: 'too_many_distinct_reactions' }, ...REACTIONS_TOO_MANY]],
};

Deno.test('the message repetition family answers every failure as Telegram does', () => {
  expectPresentations(
    FORWARD_CASES,
    (failure) => presentMessageRepetitionFailure('message_forward', { sent: false, ...failure }),
    'message_forward',
  );
  expectPresentations(
    COPY_CASES,
    (failure) => presentMessageRepetitionFailure('message_copy', { sent: false, ...failure }),
    'message_copy',
  );
  for (const operation of ['message_forward', 'message_copy'] as const) {
    expectPresentations(
      SEVERAL_REPETITION_CASES,
      (failure) => presentMessageRepetitionFailure(operation, { sent: false, ...failure }),
      `${operation} of several messages`,
    );
  }
});

Deno.test('a forward or copy that fails as a send is answered as the send', () => {
  const sendFailures = [
    [{ sent: false, reason: 'account_not_found' }, CHAT_NOT_FOUND],
    [{ sent: false, reason: 'bot_blocked' }, BOT_BLOCKED],
    [
      { sent: false, reason: 'send_permission_missing', contentKind: 'photo' },
      [400, 'Bad Request: not enough rights to send photos to the chat'],
    ],
  ] as const;
  for (const operation of ['message_forward', 'message_copy'] as const) {
    for (const [failure, answer] of sendFailures) {
      expectAnswer(
        presentMessageRepetitionFailure(operation, failure),
        answer,
        `${operation} ${failure.reason}`,
      );
    }
  }
});

Deno.test('the message deletion family answers every failure as Telegram does', () => {
  expectPresentations(
    DELETION_CASES,
    (failure) => presentMessageDeletionFailure({ deleted: false, ...failure }),
    'message_delete',
  );
});

Deno.test('the message pinning family answers every failure as Telegram does', () => {
  expectPresentations(
    PIN_CASES,
    (failure) => presentMessagePinningFailure('message_pin', { pinned: false, ...failure }),
    'message_pin',
  );
  expectPresentations(
    UNPIN_CASES,
    (failure) => presentMessagePinningFailure('message_unpin', { unpinned: false, ...failure }),
    'message_unpin',
  );
});

Deno.test('the message reaction family answers every failure as Telegram does', () => {
  expectPresentations(
    REACTION_CASES,
    (failure) => presentMessageReactionFailure({ set: false, ...failure }),
    'message_reaction',
  );
});
