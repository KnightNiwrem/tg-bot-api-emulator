import { type ChangeStaging, UNSTAGED_CHANGES } from '../../transactions/staging/change_staging.ts';
import {
  TransactionalMap,
  TransactionalSet,
} from '../../transactions/staging/transactional_collections.ts';
import type { InlineKeyboard } from '../../types/inline_keyboard.ts';
import type { UserReaction } from '../../types/message_reaction.ts';
import type { ReplyInterfaceMarkup } from '../../types/reply_interface.ts';
import type {
  ChatKey,
  ChatKeyOfType,
  ChatType,
  SupergroupChatKey,
} from '../../types/virtual_chat.ts';
import {
  type CanonicalMessageId,
  type ChatMessage,
  type ChatMessageContent,
  type ChatMessageOfType,
  type ExternalReply,
  type InlineMessageId,
  isMessageOfChatType,
  type MediaGroupId,
  type MessageContent,
  type MessageEdit,
  type NewChatMessageOfType,
  type NewMessageCore,
  type SupergroupMessage,
  type TextQuote,
  type ViaBot,
} from '../../types/virtual_message.ts';

/** Telegram's inline message identifiers encode 24 bytes of TL data as base64url. */
const INLINE_MESSAGE_ID_BYTE_COUNT = 24;

/** Media group identifiers are positive signed 64-bit integers. */
const MAX_MEDIA_GROUP_ID = (1n << 63n) - 1n;

/** The fields the repository gives a message it stores, which its sender does not choose. */
interface AssignedMessageFields {
  readonly id: CanonicalMessageId;
  readonly viaBot?: ViaBot;
  readonly isPinned: false;
}

/**
 * Builds each chat type's stored message from a copy of the message to store: the parts every
 * chat type shares, the chat type's discriminant, and the fields only its messages have.
 */
const storedMessageBuilders: {
  readonly [Type in ChatType]: (
    message: NewChatMessageOfType<Type>,
    assigned: AssignedMessageFields,
  ) => ChatMessageOfType<Type>;
} = {
  private: (message, assigned) => ({
    kind: 'private_message',
    ...copySentMessage(message),
    ...assigned,
    ...(message.messageEffectId === undefined ? {} : { messageEffectId: message.messageEffectId }),
  }),
  supergroup: (message, assigned) => ({
    kind: 'supergroup_message',
    ...copySentMessage(message),
    ...assigned,
  }),
};

/**
 * Applies an edit to each chat type's stored message: it replaces the editable parts, leaving out
 * the inline keyboard and edit time the edit omits, and keeps everything else, the chat type's own
 * fields included. TypeScript leaves out a field only of a known message type, so each chat type
 * names its own.
 */
const messageEditors: {
  readonly [Type in ChatType]: (
    message: ChatMessageOfType<Type>,
    edit: MessageEdit,
  ) => ChatMessageOfType<Type>;
} = {
  private: (
    {
      content: _replacedContent,
      inlineKeyboard: _replacedInlineKeyboard,
      contentEditedAtUnixSeconds: _replacedContentEditedAtUnixSeconds,
      ...preservedFields
    },
    edit,
  ) => ({ ...preservedFields, ...copyMessageEdit(edit) }),
  supergroup: (
    {
      content: _replacedContent,
      inlineKeyboard: _replacedInlineKeyboard,
      contentEditedAtUnixSeconds: _replacedContentEditedAtUnixSeconds,
      ...preservedFields
    },
    edit,
  ) => ({ ...preservedFields, ...copyMessageEdit(edit) }),
};

/**
 * Stores canonical messages under opaque identities, independent of Telegram message IDs, in one
 * log per chat, which its `ChatKey` names and which lists the chat's messages in the order they
 * were stored. It finds messages sent through a bot's inline mode by their inline message
 * identifiers, and issues the identifiers of albums.
 *
 * A chat's messages are found through the chat's key, as its chat type's messages: a canonical ID
 * of another chat's message finds nothing.
 */
export class MessageRepository {
  readonly #staging: ChangeStaging;
  readonly #messagesById: TransactionalMap<CanonicalMessageId, ChatMessage>;
  /** Each chat's log: the IDs of the chat's messages, in the order they were stored. */
  readonly #messageIdsByChatLogKey: TransactionalMap<string, TransactionalSet<CanonicalMessageId>>;
  readonly #messageIdsByInlineMessageId: TransactionalMap<InlineMessageId, CanonicalMessageId>;
  readonly #issuedMediaGroupIds: TransactionalSet<MediaGroupId>;

  /** `staging` decides how the repository's writes take part in its session's transactions. */
  constructor(staging: ChangeStaging = UNSTAGED_CHANGES) {
    this.#staging = staging;
    this.#messagesById = new TransactionalMap(staging);
    this.#messageIdsByChatLogKey = new TransactionalMap(staging);
    this.#messageIdsByInlineMessageId = new TransactionalMap(staging);
    this.#issuedMediaGroupIds = new TransactionalSet(staging);
  }

  /**
   * Issues a new album identifier, which no album of the session had before, for the messages of
   * an album to be stored with.
   */
  createMediaGroupId(): MediaGroupId {
    let mediaGroupId: MediaGroupId;
    do {
      const [randomBits] = crypto.getRandomValues(new BigUint64Array(1));
      mediaGroupId = String(randomBits & MAX_MEDIA_GROUP_ID);
    } while (mediaGroupId === '0' || this.#issuedMediaGroupIds.has(mediaGroupId));
    this.#issuedMediaGroupIds.add(mediaGroupId);
    return mediaGroupId;
  }

  /**
   * Stores a copy of a message, under a new identity, at the end of its chat's log, and returns
   * the stored message.
   */
  addMessage<Type extends ChatType>(
    message: NewChatMessageOfType<Type> & { readonly chat: { readonly type: Type } },
  ): ChatMessageOfType<Type> {
    const chatType: Type = message.chat.type;
    const storedMessage = storedMessageBuilders[chatType](message, {
      id: crypto.randomUUID(),
      ...this.#createViaBot(message.viaBotId),
      isPinned: false,
    });
    this.#messagesById.set(storedMessage.id, storedMessage);
    this.#indexInlineMessage(storedMessage);

    const chatLogKey = getChatLogKey(storedMessage.chat);
    const chatMessageIds = this.#messageIdsByChatLogKey.get(chatLogKey) ??
      new TransactionalSet(this.#staging);
    chatMessageIds.add(storedMessage.id);
    this.#messageIdsByChatLogKey.set(chatLogKey, chatMessageIds);
    return storedMessage;
  }

  /**
   * Finds a message of a chat by its canonical ID, until it is deleted; a message of another chat
   * is not found.
   */
  findChatMessage<Type extends ChatType>(
    chat: ChatKeyOfType<Type>,
    messageId: CanonicalMessageId,
  ): ChatMessageOfType<Type> | undefined {
    if (this.#messageIdsByChatLogKey.get(getChatLogKey(chat))?.has(messageId) !== true) {
      return undefined;
    }
    return this.#getLoggedMessage<Type>(chat.type, messageId);
  }

  /** A chat's messages that are not deleted, in the order they were stored, as a new array. */
  getChatMessages<Type extends ChatType>(
    chat: ChatKeyOfType<Type>,
  ): readonly ChatMessageOfType<Type>[] {
    const chatMessageIds = this.#messageIdsByChatLogKey.get(getChatLogKey(chat)) ?? [];
    return [...chatMessageIds].map((messageId) =>
      this.#getLoggedMessage<Type>(chat.type, messageId)
    );
  }

  /**
   * Replaces the editable parts of a stored message of a chat, as `MessageEdit` describes them,
   * and returns the edited message, which keeps its identity and its place in the chat's log.
   */
  editMessage<Type extends ChatType>(
    chat: ChatKeyOfType<Type>,
    messageId: CanonicalMessageId,
    edit: MessageEdit,
  ): ChatMessageOfType<Type> {
    const storedMessage = this.findChatMessage<Type>(chat, messageId);
    if (storedMessage === undefined) {
      throw new Error(`Message ${messageId} of chat ${getChatLogKey(chat)} does not exist`);
    }
    const chatType: Type = chat.type;
    const editedMessage = messageEditors[chatType](storedMessage, edit);
    this.#messagesById.set(messageId, editedMessage);
    return editedMessage;
  }

  /** Removes a stored message from the store and from its chat's log. */
  deleteMessage(messageId: CanonicalMessageId): void {
    const storedMessage = this.#messagesById.get(messageId);
    if (storedMessage === undefined) {
      throw new Error(`Message ${messageId} does not exist`);
    }
    const chatMessageIds = this.#messageIdsByChatLogKey.get(getChatLogKey(storedMessage.chat));
    if (chatMessageIds?.delete(messageId) !== true) {
      throw new Error(`Message ${messageId} is stored but not logged`);
    }
    this.#messagesById.delete(messageId);
    this.#unindexInlineMessage(storedMessage);
  }

  /** Finds a message of any chat that was sent through a bot's inline mode, until it is deleted. */
  getMessageByInlineMessageId(inlineMessageId: InlineMessageId): ChatMessage | undefined {
    const messageId = this.#messageIdsByInlineMessageId.get(inlineMessageId);
    if (messageId === undefined) {
      return undefined;
    }
    const message = this.#messagesById.get(messageId);
    if (message === undefined) {
      throw new Error(`Inline message ${inlineMessageId} is indexed but not stored`);
    }
    return message;
  }

  /**
   * Pins or unpins a stored message of any chat and returns the message as the change left it.
   * Pinning changes nothing else about the message.
   */
  setMessagePinned(messageId: CanonicalMessageId, isPinned: boolean): ChatMessage {
    const storedMessage = this.#messagesById.get(messageId);
    if (storedMessage === undefined) {
      throw new Error(`Message ${messageId} does not exist`);
    }
    const changedMessage: ChatMessage = { ...storedMessage, isPinned };
    this.#messagesById.set(messageId, changedMessage);
    return changedMessage;
  }

  /**
   * Replaces the reactions of a stored message of a supergroup, the chat type whose messages take
   * reactions, and returns the message as the change left it; no reactions leave it without any.
   * Reacting changes nothing else about the message.
   */
  setMessageReactions(
    chat: SupergroupChatKey,
    messageId: CanonicalMessageId,
    reactions: readonly UserReaction[],
  ): SupergroupMessage {
    const storedMessage = this.findChatMessage(chat, messageId);
    if (storedMessage === undefined) {
      throw new Error(`Message ${messageId} of chat ${getChatLogKey(chat)} does not exist`);
    }
    const { reactions: _replacedReactions, ...preservedFields } = storedMessage;
    const changedMessage: SupergroupMessage = {
      ...preservedFields,
      ...(reactions.length === 0 ? {} : {
        reactions: reactions.map(({ userId, emojis }) => ({ userId, emojis: [...emojis] })),
      }),
    };
    this.#messagesById.set(messageId, changedMessage);
    return changedMessage;
  }

  /**
   * A message that a chat's log lists, as its chat type's message. A log lists only its chat's
   * messages, which stay stored until they leave the log.
   */
  #getLoggedMessage<Type extends ChatType>(
    chatType: Type,
    messageId: CanonicalMessageId,
  ): ChatMessageOfType<Type> {
    const message = this.#messagesById.get(messageId);
    if (message === undefined || !isMessageOfChatType<Type>(message, chatType)) {
      throw new Error(`Message ${messageId} is logged but not stored as a ${chatType} message`);
    }
    return message;
  }

  #createViaBot(viaBotId: number | undefined): { readonly viaBot?: ViaBot } {
    if (viaBotId === undefined) {
      return {};
    }
    const inlineMessageId = crypto.getRandomValues(new Uint8Array(INLINE_MESSAGE_ID_BYTE_COUNT))
      .toBase64({ alphabet: 'base64url', omitPadding: true });
    return { viaBot: { botId: viaBotId, inlineMessageId } };
  }

  #indexInlineMessage(message: ChatMessage): void {
    if (message.viaBot !== undefined) {
      this.#messageIdsByInlineMessageId.set(message.viaBot.inlineMessageId, message.id);
    }
  }

  #unindexInlineMessage(message: ChatMessage): void {
    if (message.viaBot !== undefined) {
      this.#messageIdsByInlineMessageId.delete(message.viaBot.inlineMessageId);
    }
  }
}

/** The key of a chat's log, which names the chat as its `ChatKey` does. */
function getChatLogKey(chat: ChatKey): string {
  switch (chat.type) {
    case 'private':
      return `private:${chat.conversation.accountId}:${chat.conversation.botId}`;
    case 'supergroup':
      return `supergroup:${chat.chatId}`;
    default: {
      const unhandledChat: never = chat;
      throw new Error(`Unhandled chat: ${JSON.stringify(unhandledChat)}`);
    }
  }
}

/**
 * Copies the parts of a message to store that every chat type's message has, with the defaults of
 * what its sender did not choose, leaving out the optional parts the message lacks.
 */
function copySentMessage<Chat extends ChatKey, Sender, Content extends ChatMessageContent>(
  message: NewMessageCore<Chat, Sender, Content>,
) {
  return {
    chat: structuredClone(message.chat),
    sender: structuredClone(message.sender),
    sentAtUnixSeconds: message.sentAtUnixSeconds,
    content: copyContent(message.content),
    ...(message.replyToMessageId === undefined
      ? {}
      : { replyToMessageId: message.replyToMessageId }),
    ...copyReply(message),
    ...(message.mediaGroupId === undefined ? {} : { mediaGroupId: message.mediaGroupId }),
    ...(message.inlineKeyboard === undefined
      ? {}
      : { inlineKeyboard: copyInlineKeyboard(message.inlineKeyboard) }),
    ...(message.forwardInfo === undefined ? {} : { forwardInfo: { ...message.forwardInfo } }),
    ...(message.replyInterfaceMarkup === undefined
      ? {}
      : { replyInterfaceMarkup: copyReplyInterfaceMarkup(message.replyInterfaceMarkup) }),
    isContentProtected: message.isContentProtected ?? false,
    isSilent: message.isSilent ?? false,
  };
}

/** Copies a message's reply to another chat and its quote, leaving out those it lacks. */
function copyReply(
  { externalReply, quote }: {
    readonly externalReply?: ExternalReply;
    readonly quote?: TextQuote;
  },
): { readonly externalReply?: ExternalReply; readonly quote?: TextQuote } {
  return {
    ...(externalReply === undefined ? {} : {
      externalReply: {
        origin: { ...externalReply.origin },
        ...(externalReply.supergroupMessage === undefined
          ? {}
          : { supergroupMessage: { ...externalReply.supergroupMessage } }),
        ...(externalReply.media === undefined ? {} : { media: copyContent(externalReply.media) }),
      },
    }),
    ...(quote === undefined ? {} : {
      quote: {
        ...quote,
        text: {
          text: quote.text.text,
          entities: quote.text.entities.map((entity) => ({ ...entity })),
        },
      },
    }),
  };
}

/**
 * Copies the fields an edit writes to a message, leaving out the inline keyboard and edit time it
 * omits, so the edited message drops them too.
 */
function copyMessageEdit(edit: MessageEdit): {
  readonly content: MessageContent;
  readonly inlineKeyboard?: InlineKeyboard;
  readonly contentEditedAtUnixSeconds?: number;
} {
  return {
    content: copyContent(edit.content),
    ...(edit.inlineKeyboard === undefined
      ? {}
      : { inlineKeyboard: copyInlineKeyboard(edit.inlineKeyboard) }),
    ...(edit.contentEditedAtUnixSeconds === undefined
      ? {}
      : { contentEditedAtUnixSeconds: edit.contentEditedAtUnixSeconds }),
  };
}

function copyContent<Content extends ChatMessageContent>(content: Content): Content;
function copyContent(content: ChatMessageContent): ChatMessageContent {
  switch (content.kind) {
    case 'text':
      return { ...content, entities: content.entities.map((entity) => ({ ...entity })) };
    case 'photo':
    case 'document':
    case 'video':
    case 'voice':
    case 'audio':
      return {
        ...content,
        caption: {
          text: content.caption.text,
          entities: content.caption.entities.map((entity) => ({ ...entity })),
        },
      };
    case 'rich_message':
      return structuredClone(content);
    case 'poll':
      return { ...content };
    case 'contact':
      return { ...content, contact: { ...content.contact } };
    case 'location':
      return { ...content, location: { ...content.location } };
    case 'invoice':
      return {
        ...content,
        invoice: { ...content.invoice, price: { ...content.invoice.price } },
      };
    case 'members_joined':
      return { ...content, memberIds: [...content.memberIds] };
    case 'users_shared':
      return { ...content, users: content.users.map((user) => ({ ...user })) };
    case 'successful_payment':
      return {
        ...content,
        payment: { ...content.payment, charge: { ...content.payment.charge } },
      };
    case 'member_left':
    case 'title_changed':
    case 'message_pinned':
    case 'chat_shared':
    case 'web_app_data':
      return { ...content };
    default: {
      const unhandledContent: never = content;
      throw new Error(`Unhandled message content: ${JSON.stringify(unhandledContent)}`);
    }
  }
}

function copyInlineKeyboard(inlineKeyboard: InlineKeyboard): InlineKeyboard {
  return inlineKeyboard.map((row) => row.map((button) => ({ ...button })));
}

function copyReplyInterfaceMarkup(markup: ReplyInterfaceMarkup): ReplyInterfaceMarkup {
  return markup.kind === 'reply_keyboard'
    ? { ...markup, rows: markup.rows.map((row) => row.map((button) => ({ ...button }))) }
    : { ...markup };
}
