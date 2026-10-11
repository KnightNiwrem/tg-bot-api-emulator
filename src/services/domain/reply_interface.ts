/**
 * Reply interfaces as an account's client shows them, written once for every chat type: the
 * account reads the reply keyboard or forced reply its client shows in a chat, and presses the
 * keyboard's buttons. Reading and pressing are shared; what differs per chat type is how the
 * account reaches the chat, which its chat type's policy decides, where the chat records the
 * interface the account's client shows, and what a press sends.
 *
 * Which interface a new message makes a client show is decided where the message is committed,
 * since each chat type orders that change against the message's publication differently.
 *
 * @module
 */
import type {
  PrivateChatIdentityPolicy,
  SupergroupAccessPredicates,
  SupergroupIdentityPolicy,
} from '../../types/chat_policy.ts';
import {
  isRequestedPollType,
  type ReplyInterface,
  type ReplyKeyboardButton,
  type ReplyKeyboardButtonSelectionFailureReason,
  type ReplyKeyboardRequestAnswer,
  selectReplyKeyboardButton,
} from '../../types/reply_interface.ts';
import type { VirtualAccount } from '../../types/virtual_account.ts';
import type {
  ChatAddress,
  ChatKey,
  ChatKeyOfType,
  ChatType,
  PrivateChatAddress,
  PrivateChatKey,
  PrivateConversationKey,
  SupergroupChatAddress,
  SupergroupChatKey,
} from '../../types/virtual_chat.ts';
import type {
  CanonicalMessageId,
  ChatMessage,
  ChatMessageOfType,
  PrivateMessage,
  SupergroupMessage,
} from '../../types/virtual_message.ts';
import type {
  AccountMessageSendResult,
  AccountPrivateChatSendingTypes,
  AccountPrivateChatServiceMessageSendResult,
  AccountSupergroupSendingTypes,
  MessageSendingService,
} from './message_sending.ts';
import {
  resolveSharedChat,
  resolveSharedUsers,
  type SharedChatFailureReason,
  type SharedPeerLookups,
  type SharedUsersFailureReason,
} from './requested_peer_sharing.ts';

/** The message whose reply interface an account's client shows, with that interface. */
export interface ShownReplyInterface<Message extends ChatMessage = ChatMessage> {
  readonly message: Message;
  readonly replyInterface: ReplyInterface;
}

/** An account's read of the reply interface its client shows in one of its chats. */
export interface AccountReplyInterfaceReading<Address extends ChatAddress> {
  readonly accountId: number;
  /** The chat as the account addresses it: its private chat with a bot, or a supergroup. */
  readonly chat: Address;
}

/** An account's press of a button of the reply keyboard its client shows in a private chat. */
export interface PrivateChatReplyKeyboardPress {
  readonly fromAccountId: number;
  /** The account's private chat, by the bot it is with. */
  readonly chat: PrivateChatAddress;
  /**
   * The text of the button to press. Buttons may share it, so the answer's kind also selects the
   * button, as `selectReplyKeyboardButton` describes.
   */
  readonly text: string;
  /**
   * What the account's client answers the button's request with, which only a button with a
   * request of the same kind takes and requires; omitted for any other button.
   */
  readonly answer?: ReplyKeyboardRequestAnswer;
}

/**
 * An account's press of a button of the reply keyboard its client shows in a supergroup, which
 * answers no request, as only private chats show buttons with one.
 */
export interface SupergroupReplyKeyboardPress {
  readonly fromAccountId: number;
  readonly chat: SupergroupChatAddress;
  /** The text of the button to press. */
  readonly text: string;
}

/**
 * The types by which an account's reply interface in a chat of one type differs from the other's,
 * which reads and presses report precisely: how the chat is addressed, what reaching it finds, its
 * messages, why the chat is not reached, what a press answers, and what a press's message results
 * in.
 */
interface ReplyInterfaceTargetingTypes {
  readonly address: ChatAddress;
  readonly reached: { readonly key: ChatKey };
  readonly message: ChatMessage;
  /** Why the account does not reach the chat. */
  readonly accessFailureReason: string;
  /** What the account's client answers a button's request with; `never` where none is shown. */
  readonly answer: ReplyKeyboardRequestAnswer;
  /** What sending the press's message results in. */
  readonly pressResult: { readonly sent: boolean };
}

/**
 * How an account reaches a chat of one type, which interface its client shows there, and what a
 * press sends. Every read and press reaches the chat first; a press then needs a shown reply
 * keyboard with a button that the press selects.
 */
interface ReplyInterfaceTargeting<Types extends ReplyInterfaceTargetingTypes> {
  /** Reaches the chat as the account, in the chat type's order. */
  reachChat(
    accountId: number,
    chat: Types['address'],
  ):
    | ({ readonly reached: true } & Types['reached'])
    | { readonly reached: false; readonly reason: Types['accessFailureReason'] };
  /** The interface the account's client shows in the reached chat; `undefined` for none. */
  findShownReplyInterface(
    reached: Types['reached'],
    accountId: number,
  ): ShownReplyInterface<Types['message']> | undefined;
  /** Sends what pressing the selected button sends, answering its request with `answer`. */
  sendPress(
    reached: Types['reached'],
    press: {
      readonly fromAccountId: number;
      readonly text: string;
      readonly button: ReplyKeyboardButton;
      readonly keyboardMessage: Types['message'];
      readonly answer?: Types['answer'];
    },
  ): Types['pressResult'];
}

/** An account reaches its private chat with an existing bot, whether or not it blocks the bot. */
export interface PrivateChatReplyInterfaceTypes {
  readonly address: PrivateChatAddress;
  readonly reached: { readonly key: PrivateChatKey };
  readonly message: PrivateMessage;
  readonly accessFailureReason: 'bot_not_found';
  readonly answer: ReplyKeyboardRequestAnswer;
  readonly pressResult: PrivateChatReplyKeyboardPressResult;
}

/** An account reaches a supergroup as a member, whose press answers no request. */
export interface SupergroupReplyInterfaceTypes {
  readonly address: SupergroupChatAddress;
  readonly reached: { readonly key: SupergroupChatKey };
  readonly message: SupergroupMessage;
  readonly accessFailureReason: 'chat_not_found' | 'not_a_member';
  readonly answer: never;
  readonly pressResult: AccountMessageSendResult<AccountSupergroupSendingTypes>;
}

export type GetReplyInterfaceResult<Types extends ReplyInterfaceTargetingTypes> =
  | {
    readonly found: true;
    /** Omitted when the client shows its usual input. */
    readonly shownReplyInterface?: ShownReplyInterface<Types['message']>;
  }
  | {
    readonly found: false;
    readonly reason: 'account_not_found' | Types['accessFailureReason'];
  };

/**
 * What a press of a private chat's button results in: the message it sends, as
 * `MessageSendingService` sends an account's message or service message, or why the press's
 * button or answer is refused.
 */
export type PrivateChatReplyKeyboardPressResult =
  | AccountMessageSendResult<AccountPrivateChatSendingTypes>
  | AccountPrivateChatServiceMessageSendResult
  | {
    readonly sent: false;
    readonly reason:
      | 'reply_keyboard_button_answer_missing'
      | 'requested_poll_type_mismatch'
      | SharedUsersFailureReason
      | SharedChatFailureReason;
  };

export type ReplyKeyboardPressResult<Types extends ReplyInterfaceTargetingTypes> =
  | Types['pressResult']
  | {
    readonly sent: false;
    readonly reason:
      | 'account_not_found'
      | Types['accessFailureReason']
      | ReplyKeyboardButtonSelectionFailureReason;
  };

interface AccountLookup {
  getById(accountId: number): VirtualAccount | undefined;
}

interface ChatMessageStore {
  findChatMessage<Type extends ChatType>(
    chat: ChatKeyOfType<Type>,
    messageId: CanonicalMessageId,
  ): ChatMessageOfType<Type> | undefined;
}

interface MessageBoxLookup {
  getMessageId(ownerId: number, canonicalMessageId: CanonicalMessageId): number | undefined;
}

/** The message whose reply interface an account's client shows in its private chat with a bot. */
interface PrivateReplyInterfaceLookup {
  getReplyInterfaceMessageId(key: PrivateConversationKey): CanonicalMessageId | undefined;
}

/** The message whose reply interface each account member's client shows in a supergroup. */
interface SupergroupReplyInterfaceLookup {
  getReplyInterfaceMessageId(chatId: number, accountId: number): CanonicalMessageId | undefined;
}

/** How a press sends what it sends, by the type of its chat. */
type PressSending = Pick<
  MessageSendingService,
  | 'sendAccountPrivateChatMessage'
  | 'sendAccountPrivateChatServiceMessage'
  | 'sendAccountSupergroupMessage'
>;

/** The private chat policy's rules that reply interfaces ask for. */
type PrivateChatReplyInterfacePolicy = Pick<PrivateChatIdentityPolicy, 'identifyChatForAccount'>;

/** The supergroup policy's rules that reply interfaces ask for. */
type SupergroupReplyInterfacePolicy =
  & Pick<SupergroupIdentityPolicy, 'identifyChatForAccount'>
  & Pick<SupergroupAccessPredicates, 'resolveAccountMembership'>;

interface ReplyInterfaceServiceDependencies {
  readonly accounts: AccountLookup;
  readonly privateChats: PrivateChatReplyInterfacePolicy;
  readonly supergroups: SupergroupReplyInterfacePolicy;
  readonly messages: ChatMessageStore;
  readonly messageBoxes: MessageBoxLookup;
  readonly privateReplyInterfaces: PrivateReplyInterfaceLookup;
  readonly supergroupReplyInterfaces: SupergroupReplyInterfaceLookup;
  readonly messageSending: PressSending;
  /** The users and supergroups an account's answer to a `request_users` or `request_chat` names. */
  readonly sharedPeers: SharedPeerLookups;
}

/**
 * Shows accounts the reply interface their clients show, and presses its buttons, in private
 * chats and supergroups. The interface a client shows is the one the latest message that set it
 * asked for, unless a later message removed it or that message was deleted. A press of a reply
 * keyboard's button sends what the button sends, as the account's message; the keyboard stays
 * shown, even a one-time keyboard, which Telegram clients only hide until the user shows it
 * again. A press that fails changes nothing.
 *
 * Each chat type has its own entry points, which report exactly the failures it can produce, in
 * Telegram's order.
 */
export class ReplyInterfaceService {
  readonly #accounts: AccountLookup;
  readonly #privateChatTargeting: ReplyInterfaceTargeting<PrivateChatReplyInterfaceTypes>;
  readonly #supergroupTargeting: ReplyInterfaceTargeting<SupergroupReplyInterfaceTypes>;

  constructor(
    {
      accounts,
      privateChats,
      supergroups,
      messages,
      messageBoxes,
      privateReplyInterfaces,
      supergroupReplyInterfaces,
      messageSending,
      sharedPeers,
    }: ReplyInterfaceServiceDependencies,
  ) {
    this.#accounts = accounts;
    this.#privateChatTargeting = {
      reachChat: (accountId, chat) => {
        const identification = privateChats.identifyChatForAccount(accountId, chat);
        return identification.identified
          ? { reached: true, key: identification.key }
          : { reached: false, reason: identification.reason };
      },
      findShownReplyInterface: ({ key }) => {
        const messageId = privateReplyInterfaces.getReplyInterfaceMessageId(key.conversation);
        if (messageId === undefined) {
          return undefined;
        }
        // Deleting a private message clears the interface it set, so the message is still there.
        const message = messages.findChatMessage(key, messageId);
        const replyInterface = message?.replyInterfaceMarkup;
        if (
          message === undefined || replyInterface === undefined ||
          replyInterface.kind === 'reply_keyboard_removal'
        ) {
          throw new Error(`Reply interface message ${messageId} has no stored reply interface`);
        }
        return { message, replyInterface };
      },
      sendPress: ({ key }, press) =>
        sendPrivateChatPress(key.conversation, press, {
          messageSending,
          sharedPeers,
          getBotMessageId: (message) => {
            const botMessageId = messageBoxes.getMessageId(key.conversation.botId, message.id);
            if (botMessageId === undefined) {
              throw new Error(
                `Message ${message.id} is missing from the message box of bot ${key.conversation.botId}`,
              );
            }
            return botMessageId;
          },
        }),
    };
    this.#supergroupTargeting = {
      reachChat: (accountId, chat) => {
        const identification = supergroups.identifyChatForAccount(accountId, chat);
        if (!identification.identified) {
          return { reached: false, reason: identification.reason };
        }
        const membership = supergroups.resolveAccountMembership(
          accountId,
          identification.supergroup,
        );
        return membership.member
          ? { reached: true, key: identification.key }
          : { reached: false, reason: membership.reason };
      },
      findShownReplyInterface: ({ key }, accountId) => {
        // A deleted message leaves its ID behind, which then names no message.
        const messageId = supergroupReplyInterfaces.getReplyInterfaceMessageId(
          key.chatId,
          accountId,
        );
        const message = messageId === undefined
          ? undefined
          : messages.findChatMessage(key, messageId);
        const replyInterface = message?.replyInterfaceMarkup;
        if (
          message === undefined || replyInterface === undefined ||
          replyInterface.kind === 'reply_keyboard_removal'
        ) {
          return undefined;
        }
        return { message, replyInterface };
      },
      // As Telegram Desktop's `HistoryWidget::sendBotCommand` does outside private chats, the
      // message replies to the keyboard's message, so that the bot that sent it receives it even
      // in privacy mode.
      sendPress: ({ key }, { fromAccountId, text, keyboardMessage }) =>
        messageSending.sendAccountSupergroupMessage({
          fromAccountId,
          chat: { type: 'supergroup', chatId: key.chatId },
          content: { kind: 'text', text },
          replyToMessageId: messageBoxes.getMessageId(key.chatId, keyboardMessage.id),
        }),
    };
  }

  /** Returns the reply interface the account's client shows in its private chat with a bot. */
  getPrivateChatReplyInterface(
    input: AccountReplyInterfaceReading<PrivateChatAddress>,
  ): GetReplyInterfaceResult<PrivateChatReplyInterfaceTypes> {
    return this.#getReplyInterface(this.#privateChatTargeting, input);
  }

  /** Returns the reply interface a member's client shows in a supergroup. */
  getSupergroupReplyInterface(
    input: AccountReplyInterfaceReading<SupergroupChatAddress>,
  ): GetReplyInterfaceResult<SupergroupReplyInterfaceTypes> {
    return this.#getReplyInterface(this.#supergroupTargeting, input);
  }

  /**
   * Presses a button of the reply keyboard the account's client shows in its private chat, which,
   * as on Telegram, sends the button's text to the bot as the account's message.
   *
   * A button that requests the user's contact instead shares the account's own contact, as
   * an account's message sends it, in reply to the keyboard's message, as Telegram Desktop's
   * `ActivateBotCommand` and Telegram for Android's `shareMyContact` do once the user confirms.
   * A button that requests the user's location likewise shares the location the press answers
   * with, as Telegram for Android's `sendLocation` replies with the device's location. The bot
   * receives an ordinary contact or location message, which only its reply ties to the keyboard.
   *
   * A button that requests users or a chat shares those the press answers with, as
   * `resolveSharedUsers` and `resolveSharedChat` accept them, in a service message of the account
   * that carries the request's ID and replies to nothing, as TDLib shows it. A button that requests
   * a poll sends the poll the press answers with, as an account's message sends one, if it is of
   * the requested type; it replies to nothing, as Telegram Desktop's `ActivateBotCommand` opens
   * poll creation without a reply.
   *
   * A button that opens a Web App sends the data the press answers with, as the Web App's
   * `Telegram.WebApp.sendData` does, in a service message of the account that carries the button's
   * text and replies to nothing, as Telegram's `messages.sendWebViewData` takes no reply. The press
   * stands for opening the Web App and the Web App sending its data at once, so the button must be
   * shown when the data is sent; the emulator keeps no Web App open across later keyboards.
   */
  pressPrivateChatReplyKeyboardButton(
    input: PrivateChatReplyKeyboardPress,
  ): ReplyKeyboardPressResult<PrivateChatReplyInterfaceTypes> {
    return this.#pressReplyKeyboardButton(this.#privateChatTargeting, input);
  }

  /**
   * Presses a button of the reply keyboard a member's client shows in a supergroup, which sends
   * the button's text as the member's message, in reply to the keyboard's message. The press
   * selects its button as a private chat's press does.
   */
  pressSupergroupReplyKeyboardButton(
    input: SupergroupReplyKeyboardPress,
  ): ReplyKeyboardPressResult<SupergroupReplyInterfaceTypes> {
    return this.#pressReplyKeyboardButton(this.#supergroupTargeting, input);
  }

  #getReplyInterface<Types extends ReplyInterfaceTargetingTypes>(
    targeting: ReplyInterfaceTargeting<Types>,
    { accountId, chat }: AccountReplyInterfaceReading<Types['address']>,
  ): GetReplyInterfaceResult<Types> {
    if (this.#accounts.getById(accountId) === undefined) {
      return { found: false, reason: 'account_not_found' };
    }
    const reach = targeting.reachChat(accountId, chat);
    if (!reach.reached) {
      return { found: false, reason: reach.reason };
    }
    const shownReplyInterface = targeting.findShownReplyInterface(reach, accountId);
    return shownReplyInterface === undefined
      ? { found: true }
      : { found: true, shownReplyInterface };
  }

  #pressReplyKeyboardButton<Types extends ReplyInterfaceTargetingTypes>(
    targeting: ReplyInterfaceTargeting<Types>,
    { fromAccountId, chat, text, answer }: {
      readonly fromAccountId: number;
      readonly chat: Types['address'];
      readonly text: string;
      readonly answer?: Types['answer'];
    },
  ): ReplyKeyboardPressResult<Types> {
    if (this.#accounts.getById(fromAccountId) === undefined) {
      return { sent: false, reason: 'account_not_found' };
    }
    const reach = targeting.reachChat(fromAccountId, chat);
    if (!reach.reached) {
      return { sent: false, reason: reach.reason };
    }
    const shownReplyInterface = targeting.findShownReplyInterface(reach, fromAccountId);
    if (shownReplyInterface?.replyInterface.kind !== 'reply_keyboard') {
      return { sent: false, reason: 'reply_keyboard_button_not_found' };
    }
    const selection = selectReplyKeyboardButton(
      shownReplyInterface.replyInterface,
      text,
      answer?.kind,
    );
    if (!selection.selected) {
      return { sent: false, reason: selection.reason };
    }
    return targeting.sendPress(reach, {
      fromAccountId,
      text,
      button: selection.button,
      keyboardMessage: shownReplyInterface.message,
      answer,
    });
  }
}

/**
 * Sends what pressing a private chat's button sends: its text, the account's own contact, or its
 * answer to the button's request. The selection leaves only a button that takes the answer's kind,
 * or no answer; each case narrows the answer to its request's kind.
 */
function sendPrivateChatPress(
  conversation: PrivateConversationKey,
  { fromAccountId, text, button, keyboardMessage, answer }: {
    readonly fromAccountId: number;
    readonly text: string;
    readonly button: ReplyKeyboardButton;
    readonly keyboardMessage: PrivateMessage;
    readonly answer?: ReplyKeyboardRequestAnswer;
  },
  { messageSending, sharedPeers, getBotMessageId }: {
    readonly messageSending: PressSending;
    readonly sharedPeers: SharedPeerLookups;
    readonly getBotMessageId: (message: PrivateMessage) => number;
  },
): PrivateChatReplyKeyboardPressResult {
  const chat = { type: 'private', peerId: conversation.botId } as const;
  const { request } = button;
  switch (request?.kind) {
    case undefined:
      return messageSending.sendAccountPrivateChatMessage({
        fromAccountId,
        chat,
        content: { kind: 'text', text },
      });
    case 'contact':
      return messageSending.sendAccountPrivateChatMessage({
        fromAccountId,
        chat,
        content: { kind: 'own_contact' },
        replyToMessageId: getBotMessageId(keyboardMessage),
      });
    case 'location':
      if (answer?.kind !== 'location') {
        return { sent: false, reason: 'reply_keyboard_button_answer_missing' };
      }
      return messageSending.sendAccountPrivateChatMessage({
        fromAccountId,
        chat,
        content: { kind: 'location', location: answer.location },
        replyToMessageId: getBotMessageId(keyboardMessage),
      });
    case 'users':
      if (answer?.kind !== 'users') {
        return { sent: false, reason: 'reply_keyboard_button_answer_missing' };
      }
      return messageSending.sendAccountPrivateChatServiceMessage({
        fromAccountId,
        chat,
        resolveContent: () => resolveSharedUsers(request, answer.userIds, sharedPeers),
      });
    case 'chat':
      if (answer?.kind !== 'chat') {
        return { sent: false, reason: 'reply_keyboard_button_answer_missing' };
      }
      return messageSending.sendAccountPrivateChatServiceMessage({
        fromAccountId,
        chat,
        resolveContent: (sharingConversation) =>
          resolveSharedChat(request, answer.chatId, sharingConversation, sharedPeers),
      });
    case 'poll':
      if (answer?.kind !== 'poll') {
        return { sent: false, reason: 'reply_keyboard_button_answer_missing' };
      }
      if (!isRequestedPollType(request, answer.poll)) {
        return { sent: false, reason: 'requested_poll_type_mismatch' };
      }
      return messageSending.sendAccountPrivateChatMessage({
        fromAccountId,
        chat,
        content: { kind: 'poll', poll: answer.poll },
      });
    case 'web_app':
      if (answer?.kind !== 'web_app') {
        return { sent: false, reason: 'reply_keyboard_button_answer_missing' };
      }
      return messageSending.sendAccountPrivateChatServiceMessage({
        fromAccountId,
        chat,
        resolveContent: () => ({
          resolved: true,
          content: { kind: 'web_app_data', buttonText: button.text, data: answer.data },
        }),
      });
    default: {
      const unhandledRequest: never = request;
      throw new Error(`Unhandled reply keyboard request: ${JSON.stringify(unhandledRequest)}`);
    }
  }
}
