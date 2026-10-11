import type { FormerSupergroupMemberFailureReason } from '../../../../types/chat_membership.ts';
import { BOT_CHAT_ACCESS_ERRORS } from '../chat_access.ts';
import type { BotApiMethodAnswer } from '../method_call.ts';
import { BOT_API_ERRORS } from './error_catalogue.ts';
import { type FixedBotApiError, presentFixedBotApiError } from './error_template.ts';

/** Why a bot cannot pin or unpin a message, in the order the official server and TDLib check. */
type BotPinChangeFailureReason =
  | 'chat_not_found'
  /** The account of the bot's private chat does not exist, or never started the chat. */
  | 'account_not_found'
  | 'conversation_not_started'
  | FormerSupergroupMemberFailureReason
  /** The account of the bot's private chat blocks the bot. */
  | 'bot_blocked'
  /** No such message is in the chat; for an unpin without a target, no message is pinned. */
  | 'message_not_found'
  /** The bot lacks the `can_pin_messages` administrator right in a supergroup. */
  | 'not_enough_rights'
  | 'service_message_not_pinnable';

/** Why `pinChatMessage` pinned nothing. */
export interface MessagePinFailure {
  readonly pinned: false;
  /** `message_already_pinned`: Telegram's servers refuse a pin that changes nothing. */
  readonly reason: BotPinChangeFailureReason | 'message_already_pinned';
}

/** Why `unpinChatMessage` unpinned nothing. */
export interface SingleMessageUnpinFailure {
  readonly unpinned: false;
  /** `message_not_pinned`: Telegram's servers refuse an unpin that changes nothing. */
  readonly reason: BotPinChangeFailureReason | 'message_not_pinned';
}

/**
 * Why `unpinAllChatMessages` unpinned nothing: as for a single unpin, except that no message is
 * looked up. A chat that pinned nothing before is unpinned, not refused.
 */
export interface AllMessagesUnpinFailure {
  readonly unpinned: false;
  readonly reason: Exclude<
    BotPinChangeFailureReason,
    'message_not_found' | 'service_message_not_pinnable'
  >;
}

/** Why `unpinChatMessage` or `unpinAllChatMessages` unpinned nothing. */
type MessageUnpinFailure = SingleMessageUnpinFailure | AllMessagesUnpinFailure;

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
