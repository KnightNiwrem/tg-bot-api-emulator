import type { SupergroupBotAccessFailureReason } from '../../../types/chat_membership.ts';
import { getBotApiChatAddress, type PrivateChatAddress } from '../../../types/virtual_chat.ts';
import { BOT_API_ERRORS } from './errors/error_catalogue.ts';
import { type FixedBotApiError, presentFixedBotApiError } from './errors/error_template.ts';
import type {
  BotApiFamilyContext,
  BotApiMethodAnswer,
  BotApiMethodContext,
} from './method_call.ts';
import { answerWith, type BotApiStepResult, proceedWith } from './method_steps.ts';
import { CHAT_USERNAME_PREFIX, type ChatIdentifier } from './request_parameters.ts';

/** Telegram's error for a call that names no chat at all. */
export const CHAT_ID_EMPTY_DESCRIPTION = BOT_API_ERRORS.chatIdEmpty.description();

/** A call's parameters once a step has found the chat they name by `chat_id`. */
export type WithSpecifiedChatId<Parameters extends { readonly chat_id?: number }> =
  & Omit<Parameters, 'chat_id'>
  & { readonly chat_id: number };

/**
 * The step that finds the chat a call names by `chat_id`, refusing a call that names none, as the
 * official server's `check_chat` does before it looks the chat up.
 */
export function requireSpecifiedChatId<Parameters extends { readonly chat_id?: number }>(
  parameters: Parameters,
): BotApiStepResult<WithSpecifiedChatId<Parameters>> {
  const { chat_id: chatId } = parameters;
  return chatId === undefined
    ? answerWith(presentFixedBotApiError(BOT_API_ERRORS.chatIdEmpty))
    : proceedWith({ ...parameters, chat_id: chatId });
}

/**
 * Why a bot cannot address a chat: a supergroup it cannot reach as a member, or, in a private
 * chat, an account that does not exist or never started the bot.
 */
export type BotChatAccessFailureReason =
  | SupergroupBotAccessFailureReason
  | 'account_not_found'
  | 'conversation_not_started';

/**
 * Telegram's errors for a chat the bot cannot address, whichever method addresses it. A bot can
 * reach a user only after the user has written to it, so the official server's `check_chat`
 * reports any other user, like an unknown chat, as not found.
 */
export const BOT_CHAT_ACCESS_ERRORS = {
  chat_not_found: BOT_API_ERRORS.chatNotFound,
  account_not_found: BOT_API_ERRORS.chatNotFound,
  conversation_not_started: BOT_API_ERRORS.chatNotFound,
  bot_not_a_member: BOT_API_ERRORS.botNotSupergroupMember,
  bot_kicked: BOT_API_ERRORS.botKickedFromSupergroup,
} as const satisfies Readonly<Record<BotChatAccessFailureReason, FixedBotApiError>>;

/**
 * Finds the ID of the chat a JSON field names by its ID or by a public username after `@`, as
 * `check_chat` does; `undefined` for a username that names no chat a bot may address.
 */
export function resolveChatIdentifier(
  context: BotApiMethodContext,
  chatIdentifier: ChatIdentifier,
): number | undefined {
  return typeof chatIdentifier === 'number'
    ? chatIdentifier
    : context.session.botApi.findPublicChatId(chatIdentifier.slice(CHAT_USERNAME_PREFIX.length));
}

/** Telegram's error for a request to a chat the bot cannot address, whichever method made it. */
export function botChatAccessFailureAnswer(
  reason: BotChatAccessFailureReason,
): BotApiMethodAnswer {
  return presentFixedBotApiError(BOT_CHAT_ACCESS_ERRORS[reason]);
}

/** What telling the private chats a bot knows uses: the session's private messaging. */
type PrivateChatKnowledgeContext = BotApiFamilyContext<'privateMessaging'>;

/** Whether the bot knows a private chat, which it does once the chat's account has written to it. */
export function isPrivateChatKnown(
  context: PrivateChatKnowledgeContext,
  chat: PrivateChatAddress,
): boolean {
  return context.session.privateMessaging.isPrivateConversationStarted({
    accountId: chat.peerId,
    botId: context.bot.id,
  });
}

/**
 * Why a method that only supergroups support refuses the chat a bot's `chat_id` addresses: a
 * private chat the bot knows refuses it for the method's own reason, and one it does not know is
 * not found, as for any method; `undefined` for a supergroup, which the method reaches itself.
 */
export function findPrivateChatRefusal<PrivateChatRefusalReason extends string>(
  context: PrivateChatKnowledgeContext,
  chatId: number,
  privateChatRefusalReason: PrivateChatRefusalReason,
): PrivateChatRefusalReason | 'chat_not_found' | undefined {
  const chat = getBotApiChatAddress(chatId);
  if (chat.type === 'supergroup') {
    return undefined;
  }
  return isPrivateChatKnown(context, chat) ? privateChatRefusalReason : 'chat_not_found';
}
