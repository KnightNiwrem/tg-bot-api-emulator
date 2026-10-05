import { getMessageOrigin, type PrivateForwardNameLookup } from './message_forward.ts';
import {
  type ContentMessage,
  type ExternalReply,
  type FormattedText,
  getContentText,
  type MessageContent,
  type TextEntity,
  type TextQuote,
} from './virtual_message.ts';

/**
 * The most characters of a replied text or caption that a quote holds: Telegram's documented limit
 * on a chosen quote, and the length TDLib's `message_reply_quote_length_max` option gives an
 * automatic one.
 */
export const MAX_QUOTE_LENGTH = 1_024;

/** The entity types Telegram keeps in a quote, as TDLib's `is_allowed_quote_entity_type` lists them. */
const QUOTE_ENTITY_TYPES: ReadonlySet<TextEntity['type']> = new Set([
  'bold',
  'italic',
  'underline',
  'strikethrough',
  'spoiler',
  'custom_emoji',
  'date_time',
]);

/** Whether Telegram keeps an entity in a quote. */
export function isQuoteEntity(entity: TextEntity): boolean {
  return QUOTE_ENTITY_TYPES.has(entity.type);
}

/** A message of another chat that a message being sent replies to, with the text it can quote. */
export interface ExternalReplyTarget {
  readonly externalReply: ExternalReply;
  /** The replied message's text or caption, which is empty for media without a caption. */
  readonly repliedText: FormattedText;
}

/**
 * Creates what a reply to a message of another chat shows of it, as TDLib's `RepliedMessageInfo`
 * does for a reply being sent: the replied message's origin, its supergroup message ID, and its
 * media, poll, contact, or location, as `getExternalReplyMedia` keeps them. As the Bot API's `ExternalReplyInfo` has no
 * field for one, a replied rich message shows no content, like replied text. `messageIdInChat` is
 * the replied message's ID in its chat, which Telegram shows only for a supergroup message.
 */
export function createExternalReply(
  repliedMessage: ContentMessage,
  messageIdInChat: number,
  getPrivateForwardName: PrivateForwardNameLookup,
): ExternalReplyTarget {
  const { content } = repliedMessage;
  const { text, entities } = getContentText(content);
  return {
    externalReply: {
      origin: getMessageOrigin(repliedMessage, getPrivateForwardName),
      ...(repliedMessage.kind === 'supergroup_message'
        ? { supergroupMessage: { chatId: repliedMessage.chatId, messageId: messageIdInChat } }
        : {}),
      ...getExternalReplyMedia(content),
    },
    repliedText: { text, entities },
  };
}

/**
 * What a reply shows of replied content: media without its caption, which the reply's quote shows
 * instead, or a poll, a contact, or a location as it is, as TDLib's `RepliedMessageInfo` keeps
 * them; nothing for text or a rich message.
 */
function getExternalReplyMedia(content: MessageContent): Pick<ExternalReply, 'media'> {
  switch (content.kind) {
    case 'photo':
    case 'document':
    case 'video':
    case 'voice':
    case 'audio':
      return { media: { ...content, caption: { text: '', entities: [] } } };
    case 'poll':
    case 'contact':
    case 'location':
      return { media: content };
    case 'text':
    case 'rich_message':
      return {};
    default: {
      const unhandledContent: never = content;
      throw new Error(`Unhandled message content: ${JSON.stringify(unhandledContent)}`);
    }
  }
}

/**
 * Quotes a replied text or caption as Telegram does for a reply to a message of another chat whose
 * sender chose no quote: from its start, truncated to Telegram's length as TDLib's
 * `truncate_formatted_text` does, and with only the entities Telegram allows in quotes. Returns
 * `undefined` for empty text.
 */
export function createAutomaticQuote({ text, entities }: FormattedText): TextQuote | undefined {
  if (text.length === 0) {
    return undefined;
  }
  const quotedText = [...text].slice(0, MAX_QUOTE_LENGTH).join('');
  const quotedLength = quotedText.length;
  const quotedEntities = entities.flatMap((entity): TextEntity[] => {
    if (!isQuoteEntity(entity) || entity.offset >= quotedLength) {
      return [];
    }
    if (entity.offset + entity.length <= quotedLength) {
      return [entity];
    }
    // A custom emoji cannot be cut; other entities end with the quote.
    return entity.type === 'custom_emoji'
      ? []
      : [{ ...entity, length: quotedLength - entity.offset }];
  });
  return { text: { text: quotedText, entities: quotedEntities }, position: 0, isManual: false };
}
