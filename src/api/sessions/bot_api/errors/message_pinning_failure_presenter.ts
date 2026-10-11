import type { EmulationSession } from '../../../../types/emulation_session.ts';
import { BOT_CHAT_ACCESS_ERRORS } from '../chat_access.ts';
import type { BotApiMethodAnswer } from '../method_call.ts';
import { BOT_API_ERRORS } from './error_catalogue.ts';
import { type FixedBotApiError, presentFixedBotApiError } from './error_template.ts';

type BotApi = EmulationSession['botApi'];

/** Why `pinChatMessage` pinned nothing. */
type MessagePinFailure = Extract<
  ReturnType<BotApi['pinChatMessage']>,
  { readonly pinned: false }
>;

/** Why `unpinChatMessage` or `unpinAllChatMessages` unpinned nothing. */
type MessageUnpinFailure = Extract<
  ReturnType<BotApi['unpinChatMessage'] | BotApi['unpinAllChatMessages']>,
  { readonly unpinned: false }
>;

/** The operation of the message pinning family that failed: a pin, or an unpin of any messages. */
type MessagePinningOperation = 'message_pin' | 'message_unpin';

/**
 * Telegram's errors for a message the operation does not find, which the official server's
 * `check_message` names by its role.
 */
const MESSAGE_NOT_FOUND_ERRORS = {
  message_pin: BOT_API_ERRORS.messageToPinNotFound,
  message_unpin: BOT_API_ERRORS.messageToUnpinNotFound,
} as const satisfies Readonly<Record<MessagePinningOperation, FixedBotApiError>>;

/** Telegram's errors for the other failures of the family, by reason. */
const FIXED_MESSAGE_PINNING_ERRORS = {
  ...BOT_CHAT_ACCESS_ERRORS,
  bot_blocked: BOT_API_ERRORS.botBlocked,
  not_enough_rights: BOT_API_ERRORS.notEnoughRightsToManagePinnedMessages,
  service_message_not_pinnable: BOT_API_ERRORS.serviceMessageNotPinnable,
  message_already_pinned: BOT_API_ERRORS.pinnedMessagesNotModified,
  message_not_pinned: BOT_API_ERRORS.pinnedMessagesNotModified,
} as const satisfies Readonly<Record<string, FixedBotApiError>>;

/** Telegram's error for a failed pin or unpin, in the context of its operation. */
export function presentMessagePinningFailure(
  operation: 'message_pin',
  failure: MessagePinFailure,
): BotApiMethodAnswer;
export function presentMessagePinningFailure(
  operation: 'message_unpin',
  failure: MessageUnpinFailure,
): BotApiMethodAnswer;
export function presentMessagePinningFailure(
  operation: MessagePinningOperation,
  failure: MessagePinFailure | MessageUnpinFailure,
): BotApiMethodAnswer {
  return presentFixedBotApiError(
    failure.reason === 'message_not_found'
      ? MESSAGE_NOT_FOUND_ERRORS[operation]
      : FIXED_MESSAGE_PINNING_ERRORS[failure.reason],
  );
}
