import type { InlineKeyboard } from '../types/inline_keyboard.ts';
import type { UserReaction } from '../types/message_reaction.ts';
import type { ReplyInterfaceMarkup } from '../types/reply_interface.ts';
import type { PrivateConversationKey, PrivateConversationRole } from '../types/virtual_chat.ts';
import type {
  CanonicalMessageId,
  ChatMessage,
  ChatMessageContent,
  ExternalReply,
  InlineMessageId,
  MediaGroupId,
  MessageContent,
  MessageForwardInfo,
  PrivateMessage,
  PrivateMessageContent,
  SupergroupMessage,
  SupergroupMessageAuthor,
  SupergroupMessageContent,
  TextQuote,
  ViaBot,
} from '../types/virtual_message.ts';

/** Telegram's inline message identifiers encode 24 bytes of TL data as base64url. */
const INLINE_MESSAGE_ID_BYTE_COUNT = 24;

/** Media group identifiers are positive signed 64-bit integers. */
const MAX_MEDIA_GROUP_ID = (1n << 63n) - 1n;

export interface AddPrivateMessageInput {
  readonly conversation: PrivateConversationKey;
  readonly authorRole: PrivateConversationRole;
  readonly sentAtUnixSeconds: number;
  readonly content: PrivateMessageContent;
  /** The message of the same conversation this one replies to; omitted when it is no reply. */
  readonly replyToMessageId?: CanonicalMessageId;
  /** The message of another chat this one replies to; omitted when it replies to none. */
  readonly externalReply?: ExternalReply;
  /** Omitted for a reply without a quote, or no reply. */
  readonly quote?: TextQuote;
  /** The album the message belongs to, from `createMediaGroupId`; omitted outside albums. */
  readonly mediaGroupId?: MediaGroupId;
  readonly inlineKeyboard?: InlineKeyboard;
  readonly replyInterfaceMarkup?: ReplyInterfaceMarkup;
  /**
   * The bot through whose inline mode the account sent the message, which gives the message an
   * inline message identifier; omitted for other messages.
   */
  readonly viaBotId?: number;
  /** Omitted for a message that is no forward. */
  readonly forwardInfo?: MessageForwardInfo;
  /** Omitted for a message its sender did not protect. */
  readonly isContentProtected?: boolean;
  /** Omitted for a message its sender did not send silently. */
  readonly isSilent?: boolean;
  /** Omitted for a message without a message effect. */
  readonly messageEffectId?: string;
}

export interface AddSupergroupMessageInput {
  readonly chatId: number;
  readonly author: SupergroupMessageAuthor;
  readonly sentAtUnixSeconds: number;
  readonly content: SupergroupMessageContent;
  /** The message of the same supergroup this one replies to; omitted when it is no reply. */
  readonly replyToMessageId?: CanonicalMessageId;
  /** As `AddPrivateMessageInput` describes it. */
  readonly externalReply?: ExternalReply;
  /** As `AddPrivateMessageInput` describes it. */
  readonly quote?: TextQuote;
  /** As `AddPrivateMessageInput` describes it. */
  readonly mediaGroupId?: MediaGroupId;
  readonly inlineKeyboard?: InlineKeyboard;
  readonly replyInterfaceMarkup?: ReplyInterfaceMarkup;
  /** As `AddPrivateMessageInput` describes it. */
  readonly viaBotId?: number;
  /** Omitted for a message that is no forward. */
  readonly forwardInfo?: MessageForwardInfo;
  /** Omitted for a message its sender did not protect. */
  readonly isContentProtected?: boolean;
  /** Omitted for a message its sender did not send silently. */
  readonly isSilent?: boolean;
}

/** The editable parts of a message, replaced as a whole by an edit. */
export interface MessageEdit {
  readonly content: MessageContent;
  readonly inlineKeyboard: InlineKeyboard | undefined;
  readonly contentEditedAtUnixSeconds: number | undefined;
}

/**
 * Stores canonical messages under opaque identities, independent of Telegram message IDs, finds
 * messages sent through a bot's inline mode by their inline message identifiers, and issues the
 * identifiers of albums.
 */
export class MessageRepository {
  readonly #privateMessagesById = new Map<CanonicalMessageId, PrivateMessage>();
  readonly #privateMessageIdsByAccountId = new Map<number, Map<number, CanonicalMessageId[]>>();
  readonly #supergroupMessagesById = new Map<CanonicalMessageId, SupergroupMessage>();
  readonly #supergroupMessageIdsByChatId = new Map<number, CanonicalMessageId[]>();
  readonly #messageIdsByInlineMessageId = new Map<InlineMessageId, CanonicalMessageId>();
  readonly #issuedMediaGroupIds = new Set<MediaGroupId>();

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

  addPrivateMessage(input: AddPrivateMessageInput): PrivateMessage {
    const message: PrivateMessage = {
      kind: 'private_message',
      id: crypto.randomUUID(),
      conversation: { ...input.conversation },
      authorRole: input.authorRole,
      sentAtUnixSeconds: input.sentAtUnixSeconds,
      content: copyContent(input.content),
      ...(input.replyToMessageId === undefined ? {} : { replyToMessageId: input.replyToMessageId }),
      ...copyReply(input),
      ...(input.mediaGroupId === undefined ? {} : { mediaGroupId: input.mediaGroupId }),
      ...(input.inlineKeyboard === undefined
        ? {}
        : { inlineKeyboard: copyInlineKeyboard(input.inlineKeyboard) }),
      ...this.#createViaBot(input.viaBotId),
      ...(input.forwardInfo === undefined ? {} : { forwardInfo: { ...input.forwardInfo } }),
      ...(input.replyInterfaceMarkup === undefined
        ? {}
        : { replyInterfaceMarkup: copyReplyInterfaceMarkup(input.replyInterfaceMarkup) }),
      isContentProtected: input.isContentProtected ?? false,
      isSilent: input.isSilent ?? false,
      isPinned: false,
      ...(input.messageEffectId === undefined ? {} : { messageEffectId: input.messageEffectId }),
    };
    this.#privateMessagesById.set(message.id, message);
    this.#indexInlineMessage(message);

    const messageIdsByBotId = this.#privateMessageIdsByAccountId.get(
      input.conversation.accountId,
    ) ?? new Map<number, CanonicalMessageId[]>();
    const messageIds = messageIdsByBotId.get(input.conversation.botId) ?? [];
    messageIds.push(message.id);
    messageIdsByBotId.set(input.conversation.botId, messageIds);
    this.#privateMessageIdsByAccountId.set(input.conversation.accountId, messageIdsByBotId);

    return message;
  }

  getPrivateMessage(messageId: CanonicalMessageId): PrivateMessage | undefined {
    return this.#privateMessagesById.get(messageId);
  }

  /** Replaces a stored message's editable content and returns the edited message. */
  editPrivateMessage(
    messageId: CanonicalMessageId,
    edit: MessageEdit,
  ): PrivateMessage {
    const storedMessage = this.#privateMessagesById.get(messageId);
    if (storedMessage === undefined) {
      throw new Error(`Private message ${messageId} does not exist`);
    }

    const {
      content: _replacedContent,
      inlineKeyboard: _replacedInlineKeyboard,
      contentEditedAtUnixSeconds: _replacedContentEditedAtUnixSeconds,
      ...preservedFields
    } = storedMessage;
    const editedMessage: PrivateMessage = { ...preservedFields, ...copyMessageEdit(edit) };
    this.#privateMessagesById.set(messageId, editedMessage);
    return editedMessage;
  }

  /** Removes a stored message from the store and from its conversation's history. */
  deletePrivateMessage(messageId: CanonicalMessageId): void {
    const storedMessage = this.#privateMessagesById.get(messageId);
    if (storedMessage === undefined) {
      throw new Error(`Private message ${messageId} does not exist`);
    }

    const { accountId, botId } = storedMessage.conversation;
    const conversationMessageIds = this.#privateMessageIdsByAccountId.get(accountId)?.get(botId);
    const historyIndex = conversationMessageIds?.indexOf(messageId) ?? -1;
    if (conversationMessageIds === undefined || historyIndex === -1) {
      throw new Error(`Private message ${messageId} is stored but not listed`);
    }
    conversationMessageIds.splice(historyIndex, 1);
    this.#privateMessagesById.delete(messageId);
    this.#unindexInlineMessage(storedMessage);
  }

  getPrivateConversationMessages(
    conversation: PrivateConversationKey,
  ): readonly PrivateMessage[] {
    const messageIds =
      this.#privateMessageIdsByAccountId.get(conversation.accountId)?.get(conversation.botId) ??
        [];
    return messageIds.map((messageId) => {
      const message = this.#privateMessagesById.get(messageId);
      if (message === undefined) {
        throw new Error(`Private message ${messageId} is listed but not stored`);
      }
      return message;
    });
  }

  addSupergroupMessage(input: AddSupergroupMessageInput): SupergroupMessage {
    const message: SupergroupMessage = {
      kind: 'supergroup_message',
      id: crypto.randomUUID(),
      chatId: input.chatId,
      author: { ...input.author },
      sentAtUnixSeconds: input.sentAtUnixSeconds,
      content: copyContent(input.content),
      ...(input.replyToMessageId === undefined ? {} : { replyToMessageId: input.replyToMessageId }),
      ...copyReply(input),
      ...(input.mediaGroupId === undefined ? {} : { mediaGroupId: input.mediaGroupId }),
      ...(input.inlineKeyboard === undefined
        ? {}
        : { inlineKeyboard: copyInlineKeyboard(input.inlineKeyboard) }),
      ...this.#createViaBot(input.viaBotId),
      ...(input.forwardInfo === undefined ? {} : { forwardInfo: { ...input.forwardInfo } }),
      ...(input.replyInterfaceMarkup === undefined
        ? {}
        : { replyInterfaceMarkup: copyReplyInterfaceMarkup(input.replyInterfaceMarkup) }),
      isContentProtected: input.isContentProtected ?? false,
      isSilent: input.isSilent ?? false,
      isPinned: false,
    };
    this.#supergroupMessagesById.set(message.id, message);
    this.#indexInlineMessage(message);

    const messageIds = this.#supergroupMessageIdsByChatId.get(input.chatId) ?? [];
    messageIds.push(message.id);
    this.#supergroupMessageIdsByChatId.set(input.chatId, messageIds);

    return message;
  }

  getSupergroupMessage(messageId: CanonicalMessageId): SupergroupMessage | undefined {
    return this.#supergroupMessagesById.get(messageId);
  }

  /** Replaces a stored supergroup message's editable content and returns the edited message. */
  editSupergroupMessage(
    messageId: CanonicalMessageId,
    edit: MessageEdit,
  ): SupergroupMessage {
    const storedMessage = this.#supergroupMessagesById.get(messageId);
    if (storedMessage === undefined) {
      throw new Error(`Supergroup message ${messageId} does not exist`);
    }

    const {
      content: _replacedContent,
      inlineKeyboard: _replacedInlineKeyboard,
      contentEditedAtUnixSeconds: _replacedContentEditedAtUnixSeconds,
      ...preservedFields
    } = storedMessage;
    const editedMessage: SupergroupMessage = { ...preservedFields, ...copyMessageEdit(edit) };
    this.#supergroupMessagesById.set(messageId, editedMessage);
    return editedMessage;
  }

  /** Removes a stored message from the store and from its supergroup's history. */
  deleteSupergroupMessage(messageId: CanonicalMessageId): void {
    const storedMessage = this.#supergroupMessagesById.get(messageId);
    if (storedMessage === undefined) {
      throw new Error(`Supergroup message ${messageId} does not exist`);
    }

    const chatMessageIds = this.#supergroupMessageIdsByChatId.get(storedMessage.chatId);
    const historyIndex = chatMessageIds?.indexOf(messageId) ?? -1;
    if (chatMessageIds === undefined || historyIndex === -1) {
      throw new Error(`Supergroup message ${messageId} is stored but not listed`);
    }
    chatMessageIds.splice(historyIndex, 1);
    this.#supergroupMessagesById.delete(messageId);
    this.#unindexInlineMessage(storedMessage);
  }

  /** Finds a message of any chat that was sent through a bot's inline mode, until it is deleted. */
  getMessageByInlineMessageId(inlineMessageId: InlineMessageId): ChatMessage | undefined {
    const messageId = this.#messageIdsByInlineMessageId.get(inlineMessageId);
    if (messageId === undefined) {
      return undefined;
    }
    const message = this.#privateMessagesById.get(messageId) ??
      this.#supergroupMessagesById.get(messageId);
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
    const privateMessage = this.#privateMessagesById.get(messageId);
    if (privateMessage !== undefined) {
      const changedMessage: PrivateMessage = { ...privateMessage, isPinned };
      this.#privateMessagesById.set(messageId, changedMessage);
      return changedMessage;
    }
    const supergroupMessage = this.#supergroupMessagesById.get(messageId);
    if (supergroupMessage !== undefined) {
      const changedMessage: SupergroupMessage = { ...supergroupMessage, isPinned };
      this.#supergroupMessagesById.set(messageId, changedMessage);
      return changedMessage;
    }
    throw new Error(`Message ${messageId} does not exist`);
  }

  /**
   * Replaces the reactions of a stored supergroup message and returns the message as the change
   * left it; no reactions leave it without any. Reacting changes nothing else about the message.
   */
  setSupergroupMessageReactions(
    messageId: CanonicalMessageId,
    reactions: readonly UserReaction[],
  ): SupergroupMessage {
    const storedMessage = this.#supergroupMessagesById.get(messageId);
    if (storedMessage === undefined) {
      throw new Error(`Supergroup message ${messageId} does not exist`);
    }
    const { reactions: _replacedReactions, ...preservedFields } = storedMessage;
    const changedMessage: SupergroupMessage = {
      ...preservedFields,
      ...(reactions.length === 0 ? {} : {
        reactions: reactions.map(({ userId, emojis }) => ({ userId, emojis: [...emojis] })),
      }),
    };
    this.#supergroupMessagesById.set(messageId, changedMessage);
    return changedMessage;
  }

  getSupergroupMessages(chatId: number): readonly SupergroupMessage[] {
    const messageIds = this.#supergroupMessageIdsByChatId.get(chatId) ?? [];
    return messageIds.map((messageId) => {
      const message = this.#supergroupMessagesById.get(messageId);
      if (message === undefined) {
        throw new Error(`Supergroup message ${messageId} is listed but not stored`);
      }
      return message;
    });
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
    case 'members_joined':
      return { ...content, memberIds: [...content.memberIds] };
    case 'users_shared':
      return { ...content, users: content.users.map((user) => ({ ...user })) };
    case 'member_left':
    case 'title_changed':
    case 'message_pinned':
    case 'chat_shared':
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
