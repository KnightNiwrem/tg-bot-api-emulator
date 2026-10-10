import {
  createMessageForward,
  isForwardable,
  type MessageForward,
  type PrivateForwardNameLookup,
} from '../types/message_forward.ts';
import type { AccountChatAddress, AccountPrivateChatAddress } from '../types/virtual_chat.ts';
import type { ChatMessage, PrivateMessage, SupergroupMessage } from '../types/virtual_message.ts';
import type {
  AccountChatMessageLookupFailureReason,
  AccountChatMessageReader,
} from './account_chat_message.ts';

export interface ForwardAccountMessageInput {
  readonly fromAccountId: number;
  /**
   * The chat of the forwarded message: the account's private chat with a bot, or a supergroup it
   * is a member of.
   */
  readonly fromChat: AccountChatAddress;
  /** The forwarded message's ID as the bots of its chat see it. */
  readonly messageId: number;
  readonly toChat: AccountChatAddress;
}

export type ForwardAccountMessageFailureReason =
  | AccountChatMessageLookupFailureReason
  | 'message_not_forwardable'
  | 'bot_blocked'
  /** The account may not send the forwarded message's kind of content to the supergroup. */
  | 'send_permission_missing';

export type ForwardAccountMessageResult =
  | { readonly forwarded: true; readonly message: ChatMessage }
  | { readonly forwarded: false; readonly reason: ForwardAccountMessageFailureReason };

type AccountForwardSendingResult<Message extends ChatMessage, FailureReason extends string> =
  | { readonly sent: true; readonly message: Message }
  | { readonly sent: false; readonly reason: FailureReason };

interface PrivateForwardMessaging {
  sendAccountForward(input: {
    readonly fromAccountId: number;
    readonly to: AccountPrivateChatAddress;
    readonly forward: MessageForward;
  }): AccountForwardSendingResult<
    PrivateMessage,
    'account_not_found' | 'bot_not_found' | 'bot_blocked'
  >;
}

interface SupergroupForwardMessaging {
  sendAccountForward(input: {
    readonly fromAccountId: number;
    readonly chatId: number;
    readonly forward: MessageForward;
  }): AccountForwardSendingResult<
    SupergroupMessage,
    'account_not_found' | 'chat_not_found' | 'not_a_member' | 'send_permission_missing'
  >;
}

interface MessageForwardingServiceDependencies {
  readonly accountChatMessages: AccountChatMessageReader;
  readonly privateMessages: PrivateForwardMessaging;
  readonly supergroupMessages: SupergroupForwardMessaging;
  /** Hides the accounts whose privacy settings keep forwards from linking to them. */
  readonly getPrivateForwardName: PrivateForwardNameLookup;
}

/**
 * Forwards messages between the chats of an account, as a Telegram client does: the account
 * forwards a message of its private chat with a bot, or of a supergroup it is a member of, to any
 * such chat, where it becomes the account's own message that shows where it first appeared. The
 * chat's bots receive it like any message of the account. The forward shows only the name of an
 * original sender whose privacy settings keep forwards from linking to it.
 */
export class MessageForwardingService {
  readonly #accountChatMessages: AccountChatMessageReader;
  readonly #privateMessages: PrivateForwardMessaging;
  readonly #supergroupMessages: SupergroupForwardMessaging;
  readonly #getPrivateForwardName: PrivateForwardNameLookup;

  constructor(
    { accountChatMessages, privateMessages, supergroupMessages, getPrivateForwardName }:
      MessageForwardingServiceDependencies,
  ) {
    this.#accountChatMessages = accountChatMessages;
    this.#privateMessages = privateMessages;
    this.#supergroupMessages = supergroupMessages;
    this.#getPrivateForwardName = getPrivateForwardName;
  }

  /**
   * Forwards a message an account can read to a chat it can write to. The forwarded message is
   * resolved first; protected content, and service messages, cannot be forwarded.
   */
  forwardAccountMessage(input: ForwardAccountMessageInput): ForwardAccountMessageResult {
    const lookup = this.#accountChatMessages.findMessage({
      accountId: input.fromAccountId,
      chat: input.fromChat,
      messageId: input.messageId,
    });
    if (!lookup.found) {
      return { forwarded: false, reason: lookup.reason };
    }
    // Only a supergroup can protect all of its content.
    const chatProtectsContent = lookup.chat.kind === 'supergroup' &&
      lookup.chat.hasProtectedContent;
    if (!isForwardable(lookup.message, chatProtectsContent)) {
      return { forwarded: false, reason: 'message_not_forwardable' };
    }

    const forward = createMessageForward(lookup.message, this.#getPrivateForwardName);
    const { fromAccountId, toChat } = input;
    const sending = toChat.type === 'private'
      ? this.#privateMessages.sendAccountForward({ fromAccountId, to: toChat, forward })
      : this.#supergroupMessages.sendAccountForward({
        fromAccountId,
        chatId: toChat.chatId,
        forward,
      });
    return sending.sent
      ? { forwarded: true, message: sending.message }
      : { forwarded: false, reason: sending.reason };
  }
}
