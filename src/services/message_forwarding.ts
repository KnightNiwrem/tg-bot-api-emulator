import {
  createMessageForward,
  isForwardable,
  type MessageForward,
  type PrivateForwardNameLookup,
} from '../types/message_forward.ts';
import type { Supergroup } from '../types/virtual_chat.ts';
import type { ChatMessage, PrivateMessage, SupergroupMessage } from '../types/virtual_message.ts';

/** A chat of an account: its private chat with a bot, or a supergroup it is a member of. */
export type AccountChat =
  | { readonly type: 'private'; readonly botId: number }
  | { readonly type: 'supergroup'; readonly chatId: number };

export interface ForwardAccountMessageInput {
  readonly fromAccountId: number;
  /** The chat of the forwarded message. */
  readonly fromChat: AccountChat;
  /** The forwarded message's ID as the bots of its chat see it. */
  readonly messageId: number;
  readonly toChat: AccountChat;
}

export type ForwardAccountMessageFailureReason =
  | 'account_not_found'
  | 'bot_not_found'
  | 'chat_not_found'
  | 'not_a_member'
  | 'message_not_found'
  | 'message_not_forwardable'
  | 'bot_blocked'
  /** The account may not send the forwarded message's kind of content to the supergroup. */
  | 'send_permission_missing';

export type ForwardAccountMessageResult =
  | { readonly forwarded: true; readonly message: ChatMessage }
  | { readonly forwarded: false; readonly reason: ForwardAccountMessageFailureReason };

type AccountMessageLookupResult<Message extends ChatMessage, FailureReason extends string> =
  | { readonly found: true; readonly message: Message }
  | { readonly found: false; readonly reason: FailureReason };

type AccountForwardSendingResult<Message extends ChatMessage, FailureReason extends string> =
  | { readonly sent: true; readonly message: Message }
  | { readonly sent: false; readonly reason: FailureReason };

interface PrivateForwardMessaging {
  getMessageForAccount(input: {
    readonly accountId: number;
    readonly botId: number;
    readonly botMessageId: number;
  }): AccountMessageLookupResult<
    PrivateMessage,
    'account_not_found' | 'bot_not_found' | 'message_not_found'
  >;
  sendAccountForward(input: {
    readonly fromAccountId: number;
    readonly to: { readonly type: 'private'; readonly botId: number };
    readonly forward: MessageForward;
  }): AccountForwardSendingResult<
    PrivateMessage,
    'account_not_found' | 'bot_not_found' | 'bot_blocked'
  >;
}

interface SupergroupForwardMessaging {
  getMessageForAccount(input: {
    readonly accountId: number;
    readonly chatId: number;
    readonly messageId: number;
  }):
    | {
      readonly found: true;
      readonly message: SupergroupMessage;
      readonly supergroup: Supergroup;
    }
    | {
      readonly found: false;
      readonly reason:
        | 'account_not_found'
        | 'chat_not_found'
        | 'not_a_member'
        | 'message_not_found';
    };
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
  readonly #privateMessages: PrivateForwardMessaging;
  readonly #supergroupMessages: SupergroupForwardMessaging;
  readonly #getPrivateForwardName: PrivateForwardNameLookup;

  constructor(
    { privateMessages, supergroupMessages, getPrivateForwardName }:
      MessageForwardingServiceDependencies,
  ) {
    this.#privateMessages = privateMessages;
    this.#supergroupMessages = supergroupMessages;
    this.#getPrivateForwardName = getPrivateForwardName;
  }

  /**
   * Forwards a message an account can read to a chat it can write to. The forwarded message is
   * resolved first; protected content, and service messages, cannot be forwarded.
   */
  forwardAccountMessage(input: ForwardAccountMessageInput): ForwardAccountMessageResult {
    const lookup = this.#findAccountMessage(input);
    if (!lookup.found) {
      return { forwarded: false, reason: lookup.reason };
    }
    if (!isForwardable(lookup.message, lookup.chatProtectsContent)) {
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

  /** Finds the forwarded message, with whether its chat protects all content: only a supergroup can. */
  #findAccountMessage(
    { fromAccountId, fromChat, messageId }: ForwardAccountMessageInput,
  ):
    | {
      readonly found: true;
      readonly message: ChatMessage;
      readonly chatProtectsContent: boolean;
    }
    | { readonly found: false; readonly reason: ForwardAccountMessageFailureReason } {
    if (fromChat.type === 'private') {
      const lookup = this.#privateMessages.getMessageForAccount({
        accountId: fromAccountId,
        botId: fromChat.botId,
        botMessageId: messageId,
      });
      return lookup.found ? { ...lookup, chatProtectsContent: false } : lookup;
    }
    const lookup = this.#supergroupMessages.getMessageForAccount({
      accountId: fromAccountId,
      chatId: fromChat.chatId,
      messageId,
    });
    return lookup.found
      ? {
        found: true,
        message: lookup.message,
        chatProtectsContent: lookup.supergroup.hasProtectedContent,
      }
      : lookup;
  }
}
