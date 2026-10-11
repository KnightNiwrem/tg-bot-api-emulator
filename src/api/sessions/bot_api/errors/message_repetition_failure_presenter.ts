import type { EmulationSession } from '../../../../session/emulation_session.ts';
import type { BotApiMethodAnswer } from '../method_call.ts';
import { BOT_API_ERRORS } from './error_catalogue.ts';
import { type FixedBotApiError, presentFixedBotApiError } from './error_template.ts';
import { presentMessageSendingFailure } from './message_sending_failure_presenter.ts';

type BotApi = EmulationSession['botApi'];

/** Why `forwardMessage` or `copyMessage` sent no message. */
type SingleRepetitionFailure =
  | Extract<ReturnType<BotApi['forwardMessage']>, { readonly sent: false }>
  | Extract<ReturnType<BotApi['copyMessage']>, { readonly sent: false }>;

/** Why `forwardMessages` or `copyMessages` sent no message. */
type SeveralRepetitionFailure = Extract<
  ReturnType<BotApi['forwardMessages'] | BotApi['copyMessages']>,
  { readonly sent: false }
>;

/**
 * The operation of the message repetition family that failed: a forward or a copy, of one message
 * or of several. TDLib forwards for both, so most of their errors read alike.
 */
type MessageRepetitionOperation = 'message_forward' | 'message_copy';

/**
 * Telegram's errors for a repeated message the operation does not find, which the official
 * server's `check_message` names by its role.
 */
const MESSAGE_NOT_FOUND_ERRORS = {
  message_forward: BOT_API_ERRORS.messageToForwardNotFound,
  message_copy: BOT_API_ERRORS.messageToCopyNotFound,
} as const satisfies Readonly<Record<MessageRepetitionOperation, FixedBotApiError>>;

/** Telegram's errors for the failures only forwards and copies have, by reason. */
const FIXED_MESSAGE_REPETITION_ERRORS = {
  message_not_forwardable: BOT_API_ERRORS.messageNotForwardable,
  message_not_copyable: BOT_API_ERRORS.messageNotCopyable,
  repeated_messages_not_found: BOT_API_ERRORS.noMessagesToForward,
  repeated_message_ids_not_increasing: BOT_API_ERRORS.repeatedMessageIdsNotIncreasing,
  messages_not_repeatable: BOT_API_ERRORS.messagesNotForwardable,
  message_effect_not_allowed_for_several_messages: BOT_API_ERRORS.messageEffectNotAllowedInMethod,
} as const satisfies Readonly<Record<string, FixedBotApiError>>;

/**
 * Telegram's error for a failed forward or copy, in the context of its operation. A repetition that
 * fails as a send does, such as for the chat it goes to, is answered as a send.
 */
export function presentMessageRepetitionFailure(
  operation: MessageRepetitionOperation,
  failure: SingleRepetitionFailure | SeveralRepetitionFailure,
): BotApiMethodAnswer {
  switch (failure.reason) {
    case 'message_not_found':
      return presentFixedBotApiError(MESSAGE_NOT_FOUND_ERRORS[operation]);
    case 'message_not_forwardable':
    case 'message_not_copyable':
    case 'repeated_messages_not_found':
    case 'repeated_message_ids_not_increasing':
    case 'messages_not_repeatable':
    case 'message_effect_not_allowed_for_several_messages':
      return presentFixedBotApiError(FIXED_MESSAGE_REPETITION_ERRORS[failure.reason]);
    default:
      return presentMessageSendingFailure('message_send', failure);
  }
}
