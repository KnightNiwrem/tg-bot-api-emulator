import type {
  ChatMessageLookup,
  PrivateChatAccessPredicates,
  PrivateChatIdentityPolicy,
  SupergroupAccessPredicates,
  SupergroupIdentityPolicy,
} from '../types/chat_policy.ts';
import type { VirtualAccount } from '../types/virtual_account.ts';
import type {
  AccountChatAddress,
  PrivateChatKey,
  PrivateConversation,
  Supergroup,
  SupergroupChatKey,
} from '../types/virtual_chat.ts';
import type { ChatMessage, PrivateMessage, SupergroupMessage } from '../types/virtual_message.ts';

/** A message as an account addresses it. */
export interface AccountChatMessageKey {
  readonly accountId: number;
  /**
   * The account's private chat with a bot, where the bot's message box numbers messages, or a
   * supergroup, which numbers its own messages.
   */
  readonly chat: AccountChatAddress;
  /** The ID of the message, as the chat numbers it for its bots. */
  readonly messageId: number;
}

/**
 * Why an account cannot reach a message: the account or the bot of a private chat does not exist,
 * the supergroup does not exist or the account is no member of it, or the chat has no such message
 * for the account, as a private chat with a bot that never wrote to the account has none.
 */
export type AccountChatMessageLookupFailureReason =
  | 'account_not_found'
  | 'bot_not_found'
  | 'chat_not_found'
  | 'not_a_member'
  | 'message_not_found';

/** A message an account reached, with the private conversation or supergroup that holds it. */
export type AccountChatMessageLookupResult =
  | {
    readonly found: true;
    readonly message: ChatMessage;
    readonly chat: PrivateConversation | Supergroup;
  }
  | { readonly found: false; readonly reason: AccountChatMessageLookupFailureReason };

/**
 * Reads messages as an account reads them: a message of its private chat with a bot, or of a
 * supergroup it is a member of. The features that act on a message, such as pressing its buttons,
 * voting in its poll or forwarding it, apply their own rules to what the reader finds.
 */
export interface AccountChatMessageReader {
  findMessage(key: AccountChatMessageKey): AccountChatMessageLookupResult;
}

interface AccountLookup {
  getById(accountId: number): VirtualAccount | undefined;
}

type PrivateChatReading =
  & Pick<PrivateChatIdentityPolicy, 'identifyChatForAccount'>
  & Pick<PrivateChatAccessPredicates, 'findConversation'>
  & ChatMessageLookup<PrivateChatKey, PrivateMessage>;

type SupergroupReading =
  & Pick<SupergroupIdentityPolicy, 'identifyChatForAccount'>
  & Pick<SupergroupAccessPredicates, 'resolveAccountMembership'>
  & ChatMessageLookup<SupergroupChatKey, SupergroupMessage>;

/** What an account's message lookup asks: whether the account exists, and each chat type. */
export interface AccountChatMessageReaderDependencies {
  readonly accounts: AccountLookup;
  readonly privateChats: PrivateChatReading;
  readonly supergroups: SupergroupReading;
}

/**
 * Creates the reader of a session's messages for its accounts. The account must exist. In a
 * private chat, the bot must exist, and the account finds messages once the conversation exists:
 * once the account started it, or once the bot wrote to it under a join request's contact grant,
 * which opens the conversation without starting it. In a supergroup, the account must be a current
 * member.
 */
export function createAccountChatMessageReader(
  dependencies: AccountChatMessageReaderDependencies,
): AccountChatMessageReader {
  return {
    findMessage: ({ accountId, chat, messageId }) => {
      if (dependencies.accounts.getById(accountId) === undefined) {
        return { found: false, reason: 'account_not_found' };
      }
      return chat.type === 'private'
        ? findPrivateChatMessage(dependencies.privateChats, accountId, chat.botId, messageId)
        : findSupergroupMessage(dependencies.supergroups, accountId, chat.chatId, messageId);
    },
  };
}

function findPrivateChatMessage(
  privateChats: PrivateChatReading,
  accountId: number,
  botId: number,
  botMessageId: number,
): AccountChatMessageLookupResult {
  const identification = privateChats.identifyChatForAccount(accountId, {
    type: 'private',
    peerId: botId,
  });
  if (!identification.identified) {
    return { found: false, reason: identification.reason };
  }
  const conversation = privateChats.findConversation(identification.key);
  const message = conversation === undefined
    ? undefined
    : privateChats.findMessageByChatMessageId(identification.key, botMessageId);
  if (conversation === undefined || message === undefined) {
    return { found: false, reason: 'message_not_found' };
  }
  return { found: true, message, chat: conversation };
}

function findSupergroupMessage(
  supergroups: SupergroupReading,
  accountId: number,
  chatId: number,
  messageId: number,
): AccountChatMessageLookupResult {
  const identification = supergroups.identifyChatForAccount(accountId, {
    type: 'supergroup',
    chatId,
  });
  if (!identification.identified) {
    return { found: false, reason: identification.reason };
  }
  const membership = supergroups.resolveAccountMembership(accountId, identification.supergroup);
  if (!membership.member) {
    return { found: false, reason: membership.reason };
  }
  const message = supergroups.findMessageByChatMessageId(identification.key, messageId);
  if (message === undefined) {
    return { found: false, reason: 'message_not_found' };
  }
  return { found: true, message, chat: identification.supergroup };
}
