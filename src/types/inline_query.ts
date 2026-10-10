import type { GeoLocation } from './geo_location.ts';
import type { InlineKeyboard } from './inline_keyboard.ts';
import type { AudioAttributes, StoredFileId, VideoAttributes } from './stored_file.ts';
import type { AccountChatAddress } from './virtual_chat.ts';
import type { FormattedText, MessageContent } from './virtual_message.ts';

/** Telegram's decimal text form of a 64-bit inline query identifier. */
export type InlineQueryId = string;

/** The most characters of query text that Telegram's clients send. */
export const MAX_INLINE_QUERY_LENGTH = 256;

/** The most results TDLib accepts in one answer to an inline query. */
export const MAX_INLINE_QUERY_RESULT_COUNT = 50;

/** The most UTF-8 bytes of a result identifier or `next_offset` that Telegram accepts. */
export const MAX_INLINE_QUERY_RESULT_ID_BYTES = 64;
export const MAX_INLINE_QUERY_NEXT_OFFSET_BYTES = 64;

/** The most characters of a `start_parameter` that TDLib accepts. */
export const MAX_START_PARAMETER_LENGTH = 64;

/**
 * Media of a result that the bot names by URL, with the caption it is sent with. Telegram
 * downloads the file each time an account sends the result, so the answer holds only its URL.
 */
export type InlineResultWebMedia =
  | {
    readonly kind: 'web_photo';
    readonly url: string;
    /** Empty for no caption. */
    readonly caption: FormattedText;
    readonly showsCaptionAboveMedia: boolean;
  }
  | {
    readonly kind: 'web_document';
    readonly url: string;
    /** Empty for no caption. */
    readonly caption: FormattedText;
  }
  | {
    readonly kind: 'web_video';
    readonly url: string;
    /** Empty for no caption. */
    readonly caption: FormattedText;
    readonly showsCaptionAboveMedia: boolean;
    /**
     * As the bot specified them, clamped as for `sendVideo`, which the downloaded video keeps.
     */
    readonly attributes: VideoAttributes;
  }
  | {
    readonly kind: 'web_voice';
    readonly url: string;
    /** Empty for no caption. */
    readonly caption: FormattedText;
    /** As the bot specified it, clamped as for `sendVoice`, which the downloaded voice note keeps. */
    readonly durationSeconds: number;
  }
  | {
    readonly kind: 'web_audio';
    readonly url: string;
    /** Empty for no caption. */
    readonly caption: FormattedText;
    /**
     * The result's duration, clamped as for `sendAudio`, and its title and performer, which the
     * downloaded audio file keeps.
     */
    readonly attributes: AudioAttributes;
  };

/**
 * What sending a result writes: content as a message holds it, or media given by URL, which is
 * downloaded when the result is sent.
 */
export type InlineResultMessageContent = MessageContent | InlineResultWebMedia;

/** The file a media result lists: one the bot knows by `file_id`, or one it names by URL. */
export type InlineResultListedFile =
  | { readonly source: 'stored'; readonly fileId: StoredFileId }
  | { readonly source: 'web'; readonly url: string };

/**
 * What a video result lists: a video file, or a web page with an embedded video player, which the
 * result cannot send itself.
 */
export type InlineResultListedVideo =
  | InlineResultListedFile
  | { readonly source: 'embedded_player'; readonly url: string };

interface InlineQueryResultBase {
  /** The bot's identifier of the result, unique within its answer. */
  readonly id: string;
  /**
   * What choosing the result sends to the chat: the result's own media, or the content of its
   * `input_message_content`, which the listing does not show.
   */
  readonly messageContent: InlineResultMessageContent;
  /** Omitted when the sent message has no inline keyboard. */
  readonly inlineKeyboard?: InlineKeyboard;
}

/** A result that the account's client lists by its title, with a text or rich message to send. */
export interface ArticleInlineQueryResult extends InlineQueryResultBase {
  readonly kind: 'article';
  /** Never empty. */
  readonly title: string;
  /** Omitted when empty. */
  readonly description?: string;
  /** The URL the client shows with the result; omitted for none. */
  readonly url?: string;
}

/** A phone contact, which the client lists by its names and phone number. */
export interface ContactInlineQueryResult extends InlineQueryResultBase {
  readonly kind: 'contact';
  /** The contact's first name, and its last name after a space; never empty. */
  readonly title: string;
  /** The contact's phone number; never empty. */
  readonly description: string;
}

/** A static location, which the client lists by its title and coordinates. */
export interface LocationInlineQueryResult extends InlineQueryResultBase {
  readonly kind: 'location';
  /** Omitted when empty. */
  readonly title?: string;
  /** The latitude and longitude to six decimal places, separated by a space. */
  readonly description: string;
}

/** A photo, which the client lists as the photo. */
export interface PhotoInlineQueryResult extends InlineQueryResultBase {
  readonly kind: 'photo';
  readonly file: InlineResultListedFile;
  /** Omitted when empty. */
  readonly title?: string;
  /** Omitted when empty. */
  readonly description?: string;
}

/** A document, which the client lists by its title. */
export interface DocumentInlineQueryResult extends InlineQueryResultBase {
  readonly kind: 'document';
  readonly file: InlineResultListedFile;
  /** Never empty. */
  readonly title: string;
  /** Omitted when empty. */
  readonly description?: string;
}

/** A video, or a web page with an embedded video player, which the client lists by its title. */
export interface VideoInlineQueryResult extends InlineQueryResultBase {
  readonly kind: 'video';
  readonly file: InlineResultListedVideo;
  /** Never empty. */
  readonly title: string;
  /** Omitted when empty. */
  readonly description?: string;
}

/** A voice note, which the client lists by its title. */
export interface VoiceInlineQueryResult extends InlineQueryResultBase {
  readonly kind: 'voice';
  readonly file: InlineResultListedFile;
  /** Omitted when empty. */
  readonly title?: string;
}

/** An audio file, which the client lists by its title and performer. */
export interface AudioInlineQueryResult extends InlineQueryResultBase {
  readonly kind: 'audio';
  readonly file: InlineResultListedFile;
  /** Omitted when empty. */
  readonly title?: string;
  /** The performer, as TDLib describes an audio result; omitted when empty. */
  readonly description?: string;
}

/** A result of an answer to an inline query. The Bot API's other result types are not supported. */
export type InlineQueryResult =
  | ArticleInlineQueryResult
  | ContactInlineQueryResult
  | LocationInlineQueryResult
  | PhotoInlineQueryResult
  | DocumentInlineQueryResult
  | VideoInlineQueryResult
  | VoiceInlineQueryResult
  | AudioInlineQueryResult;

/**
 * The button the account's client shows above the results: it opens the bot's private chat with a
 * `/start` parameter, or a Web App.
 */
export type InlineQueryResultsButton =
  | { readonly kind: 'start_bot'; readonly text: string; readonly startParameter: string }
  | { readonly kind: 'web_app'; readonly text: string; readonly url: string };

/** How the bot answered an inline query, as the querying account's client shows it. */
export interface InlineQueryAnswer {
  readonly results: readonly InlineQueryResult[];
  /**
   * How long Telegram reuses the answer for the same query instead of asking the bot again. The
   * emulator reuses an answer with a positive cache time until a test expires it.
   */
  readonly cacheTimeSeconds: number;
  /** Whether the answer is reused only for the account that sent the query. */
  readonly isPersonal: boolean;
  /** The offset the client sends to request more results; empty when there are no more. */
  readonly nextOffset: string;
  /** Omitted when the client shows no button. */
  readonly button?: InlineQueryResultsButton;
}

/**
 * Where an inline query is in its life. The bot answers a query once, unless it was answered from
 * the cache; the emulator does not expire queries by time.
 */
export type InlineQueryState =
  | { readonly status: 'awaiting_answer' }
  | { readonly status: 'answered'; readonly answer: InlineQueryAnswer };

/** Text an account typed after a bot's username, which asks the bot for results to send. */
export interface InlineQuery {
  readonly id: InlineQueryId;
  /** The account that sent the query. */
  readonly accountId: number;
  /** The inline bot, which receives and answers the query. */
  readonly botId: number;
  /**
   * The chat where the account typed the query, which is where the result it chooses is sent:
   * its private chat with a bot, the inline bot or another, or a supergroup it is a member of.
   */
  readonly chat: AccountChatAddress;
  /** Up to 256 characters; empty when the account typed only the bot's username. */
  readonly query: string;
  /** The `next_offset` of an earlier answer, requesting more results; empty for the first. */
  readonly offset: string;
  /**
   * Where the account is, which it shares only with a bot that requests it; omitted when not
   * shared.
   */
  readonly userLocation?: GeoLocation;
  readonly state: InlineQueryState;
}

/**
 * The Bot API `chat_type` of an inline query's chat: `sender` for the account's private chat with
 * the inline bot itself.
 */
export function getInlineQueryChatType(
  { botId, chat }: Pick<InlineQuery, 'botId' | 'chat'>,
): 'sender' | 'private' | 'supergroup' {
  if (chat.type === 'supergroup') {
    return 'supergroup';
  }
  return chat.botId === botId ? 'sender' : 'private';
}

type InlineQueryRequest = Pick<InlineQuery, 'botId' | 'chat' | 'query' | 'offset' | 'userLocation'>;

/**
 * Whether two queries ask a bot the same, so that an answer to one can be reused for the other.
 * As TDLib's `InlineQueriesManager::send_inline_query` identifies a query, they must be sent to
 * the same bot from the same kind of chat, with the same offset and the same text apart from
 * surrounding ASCII whitespace, and from the same place when they share the user's location.
 */
export function isSameInlineQueryRequest(
  first: InlineQueryRequest,
  second: InlineQueryRequest,
): boolean {
  return first.botId === second.botId &&
    getInlineQueryChatType(first) === getInlineQueryChatType(second) &&
    trimTdlibWhitespace(first.query) === trimTdlibWhitespace(second.query) &&
    first.offset === second.offset &&
    isSameInlineQueryPlace(first.userLocation, second.userLocation);
}

/**
 * Whether two shared locations identify the same query place: TDLib keys a location by its
 * coordinates in whole ten-thousandths of a degree, ignoring the accuracy.
 */
function isSameInlineQueryPlace(
  first: GeoLocation | undefined,
  second: GeoLocation | undefined,
): boolean {
  if (first === undefined || second === undefined) {
    return first === second;
  }
  return Math.trunc(first.latitude * 1e4) === Math.trunc(second.latitude * 1e4) &&
    Math.trunc(first.longitude * 1e4) === Math.trunc(second.longitude * 1e4);
}

/** Removes the characters that TDLib's `trim` treats as whitespace from both ends. */
function trimTdlibWhitespace(text: string): string {
  return text.replace(/^[ \t\r\n\0\v]+|[ \t\r\n\0\v]+$/g, '');
}

/** Finds the result the account chose in an answer by its identifier. */
export function findInlineQueryResult(
  answer: InlineQueryAnswer,
  resultId: string,
): InlineQueryResult | undefined {
  return answer.results.find((result) => result.id === resultId);
}
