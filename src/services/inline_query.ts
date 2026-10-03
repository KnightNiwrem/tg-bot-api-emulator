import type { ChatDomainEvent } from '../types/chat_domain_event.ts';
import type { ChatMembership } from '../types/chat_membership.ts';
import type { GeoLocation } from '../types/geo_location.ts';
import { parseHttpUrl } from '../types/http_url.ts';
import {
  findInlineQueryResult,
  type InlineQuery,
  type InlineQueryAnswer,
  type InlineQueryChat,
  type InlineQueryId,
  type InlineQueryResult,
  type InlineQueryResultsButton,
  type InlineResultListedFile,
  type InlineResultListedVideo,
  type InlineResultMessageContent,
  type InlineResultWebMedia,
  isSameInlineQueryRequest,
  MAX_INLINE_QUERY_NEXT_OFFSET_BYTES,
  MAX_INLINE_QUERY_RESULT_COUNT,
  MAX_INLINE_QUERY_RESULT_ID_BYTES,
  MAX_START_PARAMETER_LENGTH,
} from '../types/inline_query.ts';
import type { InlineKeyboard } from '../types/inline_keyboard.ts';
import type {
  InlineResultWebFileKind,
  StoredDocumentFile,
  StoredFile,
  StoredPhotoFile,
  StoredVideoFile,
  StoredVoiceFile,
  VideoAttributes,
  WebFile,
} from '../types/stored_file.ts';
import type { VirtualAccount } from '../types/virtual_account.ts';
import type { VirtualBot } from '../types/virtual_bot.ts';
import type { SharedChat } from '../types/virtual_chat.ts';
import type {
  ChatMessage,
  FormattedText,
  PrivateMessage,
  SupergroupMessage,
} from '../types/virtual_message.ts';
import type {
  DocumentUploadPreparation,
  InlineResultWebFileDownloadRequest,
  PhotoUploadPreparation,
  VideoUploadPreparation,
  VoiceUploadPreparation,
  WebFileDownloadResult,
} from './media_file.ts';
import {
  type ContentTextNormalizationFailure,
  hasOnlyValidButtonCallbackData,
  hasOnlyValidCallbackData,
  normalizeCaption,
  type NormalizedOutgoingContent,
  normalizeOutgoingContent,
  type OutgoingContentOtherThanPoll,
  type SpecifiedCaption,
  toContentOfStoredFile,
} from './message_content.ts';

export interface SendInlineQueryInput {
  readonly fromAccountId: number;
  /** The inline bot, whose username the account typed. */
  readonly botId: number;
  readonly chat: InlineQueryChat;
  readonly query: string;
  /** The `next_offset` of an earlier answer, or empty for the first results. */
  readonly offset: string;
  /** Where the account is, for a bot that requests it; omitted to share no location. */
  readonly userLocation?: GeoLocation;
}

export type SendInlineQueryFailureReason =
  | 'account_not_found'
  | 'bot_not_found'
  | 'inline_mode_disabled'
  | 'inline_location_not_requested'
  | 'chat_not_found'
  | 'not_a_member';

export type SendInlineQueryResult =
  | { readonly sent: true; readonly inlineQuery: InlineQuery }
  | { readonly sent: false; readonly reason: SendInlineQueryFailureReason };

/** The file a media result lists: one the bot knows by `file_id`, or one it names by URL. */
export type SpecifiedInlineResultFile<Stored extends StoredFile> =
  | { readonly source: 'stored'; readonly file: Stored }
  | { readonly source: 'web'; readonly url: string };

/**
 * What a video result lists: a video file, or a web page with an embedded video player, which only
 * the listing shows.
 */
type SpecifiedInlineResultVideo =
  | SpecifiedInlineResultFile<StoredVideoFile>
  | { readonly source: 'embedded_player'; readonly url: string };

/** What each kind of result lists, as the bot specified it, before Telegram's checks. */
type SpecifiedInlineQueryResultListing =
  | {
    readonly kind: 'article';
    readonly title: string;
    /** Empty for none. */
    readonly description: string;
    /** Empty for none. */
    readonly url: string;
  }
  | {
    readonly kind: 'contact';
    /** The contact's names. */
    readonly title: string;
    /** The contact's phone number. */
    readonly description: string;
  }
  | {
    readonly kind: 'location';
    /** Empty for none. */
    readonly title: string;
    /** The location's coordinates. */
    readonly description: string;
  }
  | {
    readonly kind: 'photo';
    readonly photo: SpecifiedInlineResultFile<StoredPhotoFile>;
    /** The URL of the thumbnail the client lists; empty for none. */
    readonly thumbnailUrl: string;
    /** Empty for none. */
    readonly title: string;
    /** Empty for none. */
    readonly description: string;
  }
  | {
    readonly kind: 'document';
    readonly document: SpecifiedInlineResultFile<StoredDocumentFile>;
    /** The URL of the thumbnail the client lists; empty for none. */
    readonly thumbnailUrl: string;
    readonly title: string;
    /** Empty for none. */
    readonly description: string;
  }
  | {
    readonly kind: 'video';
    readonly video: SpecifiedInlineResultVideo;
    /** The URL of the thumbnail the client lists; empty for none. */
    readonly thumbnailUrl: string;
    readonly title: string;
    /** Empty for none. */
    readonly description: string;
  }
  | {
    readonly kind: 'voice';
    readonly voice: SpecifiedInlineResultFile<StoredVoiceFile>;
    /** Empty for none. */
    readonly title: string;
  };

/**
 * Media of a result that the bot names by URL, with the caption it specified, before Telegram's
 * checks; Telegram downloads the file only when an account sends the result.
 */
export type SpecifiedInlineResultWebMedia =
  | (SpecifiedCaption & {
    readonly kind: 'web_photo';
    readonly url: string;
    readonly showsCaptionAboveMedia: boolean;
  })
  | (SpecifiedCaption & { readonly kind: 'web_document'; readonly url: string })
  | (SpecifiedCaption & {
    readonly kind: 'web_video';
    readonly url: string;
    readonly showsCaptionAboveMedia: boolean;
    readonly attributes: VideoAttributes;
  })
  | (SpecifiedCaption & {
    readonly kind: 'web_voice';
    readonly url: string;
    readonly durationSeconds: number;
  });

/**
 * A result of an answer as the bot specified it, before Telegram's checks. Its message content is
 * the content its `input_message_content` specified, or else the result's own media with a
 * caption: a stored file, or one named by URL.
 */
export type SpecifiedInlineQueryResult = SpecifiedInlineQueryResultListing & {
  readonly id: string;
  /** As the Bot API's `InputMessageContent`, which has no poll, or the result's media. */
  readonly messageContent: OutgoingContentOtherThanPoll | SpecifiedInlineResultWebMedia;
  /** Omitted when the sent message has no inline keyboard. */
  readonly inlineKeyboard?: InlineKeyboard;
};

export interface AnswerInlineQueryInput {
  readonly fromBotId: number;
  readonly inlineQueryId: InlineQueryId;
  readonly results: readonly SpecifiedInlineQueryResult[];
  readonly cacheTimeSeconds: number;
  readonly isPersonal: boolean;
  /** Empty when there are no more results. */
  readonly nextOffset: string;
  /** Omitted when the client shows no button above the results. */
  readonly button?: InlineQueryResultsButton;
}

export type AnswerInlineQueryFailureReason =
  | 'start_parameter_empty'
  | 'start_parameter_too_long'
  | 'start_parameter_invalid'
  | 'too_many_results'
  | 'query_id_invalid'
  | 'next_offset_invalid'
  | 'result_id_empty'
  | 'result_id_invalid'
  | 'result_id_duplicate'
  | 'article_title_empty'
  | 'document_title_empty'
  | 'video_title_empty'
  | 'web_document_url_invalid'
  | 'photo_thumbnail_url_empty'
  | 'callback_data_invalid';

export type AnswerInlineQueryResult =
  | { readonly answered: true; readonly inlineQuery: InlineQuery }
  | (
    & { readonly answered: false }
    & (
      | { readonly reason: AnswerInlineQueryFailureReason }
      | ContentTextNormalizationFailure
    )
  );

/** Identifies an inline query by the account that sent it. */
export interface AccountInlineQueryKey {
  readonly accountId: number;
  readonly inlineQueryId: InlineQueryId;
}

export interface ChooseInlineQueryResultInput extends AccountInlineQueryKey {
  readonly resultId: string;
  /** Aborts downloading the result's media when the account stops waiting for it. */
  readonly signal?: AbortSignal;
}

export type ChooseInlineQueryResultFailureReason =
  | 'inline_query_not_found'
  | 'inline_query_not_answered'
  | 'result_not_found'
  | 'not_a_member'
  | 'bot_blocked'
  | InlineResultPermissionFailureReason
  | InlineResultWebMediaFailureReason;

/**
 * Why the media a result names by URL cannot be sent: it cannot be downloaded, as Telegram's
 * `WEBPAGE_CURL_FAILED`, or what was downloaded is not media of the result's kind, as its
 * `WEBPAGE_MEDIA_EMPTY` or, for a photo, an image Telegram cannot process.
 */
type InlineResultWebMediaFailureReason = 'web_media_unavailable' | 'web_media_invalid';

/**
 * Why a supergroup member may not send an inline result: it may not use inline bots there, or may
 * not send the result's kind of content.
 */
type InlineResultPermissionFailureReason = 'inline_bots_not_permitted' | 'send_permission_missing';

export type ChooseInlineQueryResultResult =
  | { readonly chosen: true; readonly message: ChatMessage }
  | { readonly chosen: false; readonly reason: ChooseInlineQueryResultFailureReason };

interface AccountLookup {
  getById(accountId: number): VirtualAccount | undefined;
}

interface BotLookup {
  getById(botId: number): VirtualBot | undefined;
}

interface SupergroupLookup {
  getSharedChat(chatId: number): SharedChat | undefined;
  getChatMembership(chatId: number, identityId: number): ChatMembership | undefined;
}

/**
 * What an account's chosen result sends: content the answer holds, as `existing` content, or media
 * downloaded from a URL, whose upload is stored with the message.
 */
type InlineResultSendingContent = Exclude<NormalizedOutgoingContent, { readonly kind: 'poll' }>;

/** Sends an account's chosen result as its message sent through the inline bot. */
interface InlineResultSending {
  readonly content: InlineResultSendingContent;
  readonly inlineKeyboard?: InlineKeyboard;
  readonly viaBotId: number;
  readonly fromAccountId: number;
}

interface PrivateInlineResultMessaging {
  sendAccountInlineResult(
    input: InlineResultSending & {
      readonly to: { readonly type: 'private'; readonly botId: number };
    },
  ):
    | { readonly sent: true; readonly message: PrivateMessage }
    | {
      readonly sent: false;
      readonly reason: 'account_not_found' | 'bot_not_found' | 'bot_blocked';
    };
}

interface SupergroupInlineResultMessaging {
  sendAccountInlineResult(input: InlineResultSending & { readonly chatId: number }):
    | { readonly sent: true; readonly message: SupergroupMessage }
    | {
      readonly sent: false;
      readonly reason:
        | 'account_not_found'
        | 'chat_not_found'
        | 'not_a_member'
        | InlineResultPermissionFailureReason;
    };
}

interface InlineQueryStore {
  addInlineQuery(input: {
    readonly accountId: number;
    readonly botId: number;
    readonly chat: InlineQueryChat;
    readonly query: string;
    readonly offset: string;
  }): InlineQuery;
  getInlineQuery(inlineQueryId: InlineQueryId): InlineQuery | undefined;
  listAnsweredInlineQueries(botId: number): readonly InlineQuery[];
  recordAnswer(
    inlineQueryId: InlineQueryId,
    answer: InlineQueryAnswer,
    answeredAtMilliseconds: number,
  ): InlineQuery;
}

interface ChatDomainEventSink {
  publish(event: ChatDomainEvent): void;
}

/** Downloads the media that results name by URL, and prepares it as media of the result's kind. */
interface InlineResultWebMediaFiles {
  downloadInlineResultWebFile(
    request: InlineResultWebFileDownloadRequest,
  ): Promise<WebFileDownloadResult>;
  prepareInlineResultWebPhotoUpload(webFile: WebFile): PhotoUploadPreparation;
  prepareWebDocumentUpload(webFile: WebFile): DocumentUploadPreparation;
  prepareWebVideoUpload(webFile: WebFile, attributes: VideoAttributes): VideoUploadPreparation;
  prepareWebVoiceUpload(webFile: WebFile, durationSeconds: number): VoiceUploadPreparation;
}

interface InlineQueryServiceDependencies {
  readonly accounts: AccountLookup;
  readonly bots: BotLookup;
  readonly sharedChats: SupergroupLookup;
  readonly privateMessages: PrivateInlineResultMessaging;
  readonly supergroupMessages: SupergroupInlineResultMessaging;
  readonly inlineQueries: InlineQueryStore;
  readonly webMediaFiles: InlineResultWebMediaFiles;
  readonly events: ChatDomainEventSink;
  readonly currentTimeMilliseconds: () => number;
}

/** TDLib's `is_base64url_characters`, which a `start_parameter` must satisfy. */
const START_PARAMETER_PATTERN = /^[A-Za-z0-9_-]*$/;

const utf8Encoder = new TextEncoder();

/**
 * Carries out inline mode: an account types a query for an inline bot in one of its chats, the bot
 * answers once with results, and the account sends a result to that chat as its own message sent
 * through the bot. A bot that receives inline feedback learns which result was sent.
 *
 * Checks of an answer follow Telegram's order: TDLib checks the button, the number of results, and
 * each result's message content before Telegram's servers check the query and the rest.
 */
export class InlineQueryService {
  readonly #accounts: AccountLookup;
  readonly #bots: BotLookup;
  readonly #sharedChats: SupergroupLookup;
  readonly #privateMessages: PrivateInlineResultMessaging;
  readonly #supergroupMessages: SupergroupInlineResultMessaging;
  readonly #inlineQueries: InlineQueryStore;
  readonly #webMediaFiles: InlineResultWebMediaFiles;
  readonly #events: ChatDomainEventSink;
  readonly #currentTimeMilliseconds: () => number;

  constructor(
    {
      accounts,
      bots,
      sharedChats,
      privateMessages,
      supergroupMessages,
      inlineQueries,
      webMediaFiles,
      events,
      currentTimeMilliseconds,
    }: InlineQueryServiceDependencies,
  ) {
    this.#accounts = accounts;
    this.#bots = bots;
    this.#sharedChats = sharedChats;
    this.#privateMessages = privateMessages;
    this.#supergroupMessages = supergroupMessages;
    this.#inlineQueries = inlineQueries;
    this.#webMediaFiles = webMediaFiles;
    this.#events = events;
    this.#currentTimeMilliseconds = currentTimeMilliseconds;
  }

  /**
   * Sends an inline query from an account, typed in its private chat with a bot or in a supergroup
   * it is a member of, to a bot with inline mode turned on, and publishes it for that bot. The
   * account may share its location only with a bot that requests it.
   *
   * A query answered within its cache time is not sent again: the new query receives the same
   * answer at once, and the bot learns nothing of it. TDLib's
   * `InlineQueriesManager::send_inline_query` reuses an answer for the account that received it,
   * whatever `is_personal` says; Telegram's servers, as the Bot API describes `is_personal`, reuse
   * an answer that is not personal for any account.
   */
  sendInlineQuery(input: SendInlineQueryInput): SendInlineQueryResult {
    if (this.#accounts.getById(input.fromAccountId) === undefined) {
      return { sent: false, reason: 'account_not_found' };
    }
    const bot = this.#bots.getById(input.botId);
    if (bot === undefined) {
      return { sent: false, reason: 'bot_not_found' };
    }
    if (!bot.profile.supports_inline_queries) {
      return { sent: false, reason: 'inline_mode_disabled' };
    }
    // Telegram's apps share a location only with bots that request it.
    if (input.userLocation !== undefined && !bot.requestsInlineLocation) {
      return { sent: false, reason: 'inline_location_not_requested' };
    }
    const chatFailure = this.#checkChatAccess(input.fromAccountId, input.chat);
    if (chatFailure !== undefined) {
      return { sent: false, reason: chatFailure };
    }

    const inlineQuery = this.#inlineQueries.addInlineQuery({
      accountId: input.fromAccountId,
      botId: input.botId,
      chat: input.chat,
      query: input.query,
      offset: input.offset,
      ...(input.userLocation === undefined ? {} : { userLocation: input.userLocation }),
    });
    const cachedState = this.#findCachedAnswer(inlineQuery);
    if (cachedState !== undefined) {
      return {
        sent: true,
        inlineQuery: this.#inlineQueries.recordAnswer(
          inlineQuery.id,
          cachedState.answer,
          cachedState.answeredAtMilliseconds,
        ),
      };
    }
    this.#events.publish({ type: 'inline_query_created', inlineQuery });
    return { sent: true, inlineQuery };
  }

  /**
   * Records the bot's answer to an inline query it received, after Telegram's checks. As on
   * Telegram, a query that does not exist, belongs to another bot, or is already answered cannot
   * be answered.
   */
  answerInlineQuery(input: AnswerInlineQueryInput): AnswerInlineQueryResult {
    const buttonFailure = input.button === undefined ? undefined : checkResultsButton(input.button);
    if (buttonFailure !== undefined) {
      return { answered: false, reason: buttonFailure };
    }
    if (input.results.length > MAX_INLINE_QUERY_RESULT_COUNT) {
      return { answered: false, reason: 'too_many_results' };
    }
    const messageContents: NormalizedInlineResultContent[] = [];
    for (const result of input.results) {
      const normalization = this.#normalizeResultContent(result.messageContent);
      if (!normalization.normalized) {
        return { answered: false, ...normalization.failure };
      }
      messageContents.push(normalization.content);
    }

    const inlineQuery = this.#inlineQueries.getInlineQuery(input.inlineQueryId);
    if (
      inlineQuery === undefined || inlineQuery.botId !== input.fromBotId ||
      inlineQuery.state.status !== 'awaiting_answer'
    ) {
      return { answered: false, reason: 'query_id_invalid' };
    }
    if (utf8Encoder.encode(input.nextOffset).length > MAX_INLINE_QUERY_NEXT_OFFSET_BYTES) {
      return { answered: false, reason: 'next_offset_invalid' };
    }
    const resultFailure = checkSpecifiedResults(input.results, messageContents);
    if (resultFailure !== undefined) {
      return { answered: false, reason: resultFailure };
    }

    return {
      answered: true,
      inlineQuery: this.#inlineQueries.recordAnswer(
        inlineQuery.id,
        {
          results: input.results.map((result, resultIndex) =>
            toInlineQueryResult(result, toAnsweredResultContent(messageContents[resultIndex]))
          ),
          cacheTimeSeconds: input.cacheTimeSeconds,
          isPersonal: input.isPersonal,
          nextOffset: input.nextOffset,
          ...(input.button === undefined ? {} : { button: input.button }),
        },
        this.#currentTimeMilliseconds(),
      ),
    };
  }

  /** Returns an inline query the account sent, or `undefined` for any other query. */
  getAccountInlineQuery(
    { accountId, inlineQueryId }: AccountInlineQueryKey,
  ): InlineQuery | undefined {
    const inlineQuery = this.#inlineQueries.getInlineQuery(inlineQueryId);
    return inlineQuery?.accountId === accountId ? inlineQuery : undefined;
  }

  /**
   * Sends a result of the bot's answer to the chat where the account typed the query, as the
   * account's message sent through the inline bot, and publishes the choice for the bot. As on
   * Telegram, the account can send a result again, and must still be able to write to the chat.
   *
   * Media that a result names by URL is downloaded each time the result is sent, as
   * `messages.sendInlineBotResult` fails with Telegram's download errors, and is then stored as a
   * new file, like a file a bot sends by URL. It is downloaded before the account's access to the
   * chat is checked, so a result that can be neither downloaded nor sent fails for its media.
   */
  async chooseInlineQueryResult(
    input: ChooseInlineQueryResultInput,
  ): Promise<ChooseInlineQueryResultResult> {
    const inlineQuery = this.getAccountInlineQuery(input);
    if (inlineQuery === undefined) {
      return { chosen: false, reason: 'inline_query_not_found' };
    }
    if (inlineQuery.state.status !== 'answered') {
      return { chosen: false, reason: 'inline_query_not_answered' };
    }
    const result = findInlineQueryResult(inlineQuery.state.answer, input.resultId);
    if (result === undefined) {
      return { chosen: false, reason: 'result_not_found' };
    }

    const contentPreparation = await this.#prepareSendingContent(
      result.messageContent,
      input.signal,
    );
    if (!contentPreparation.prepared) {
      return { chosen: false, reason: contentPreparation.reason };
    }
    const sending = this.#sendResult(inlineQuery, result, contentPreparation.content);
    if (!sending.sent) {
      return { chosen: false, reason: sending.reason };
    }
    this.#events.publish({
      type: 'inline_query_result_chosen',
      inlineQuery,
      resultId: result.id,
      message: sending.message,
    });
    return { chosen: true, message: sending.message };
  }

  /**
   * Finds the latest answer that can be reused for a query: one to the same request, still within
   * its cache time, and given to the query's account unless it is not personal.
   */
  #findCachedAnswer(
    inlineQuery: InlineQuery,
  ): Extract<InlineQuery['state'], { readonly status: 'answered' }> | undefined {
    const now = this.#currentTimeMilliseconds();
    for (const answeredQuery of this.#inlineQueries.listAnsweredInlineQueries(inlineQuery.botId)) {
      const { state } = answeredQuery;
      if (
        state.status === 'answered' && isSameInlineQueryRequest(answeredQuery, inlineQuery) &&
        (!state.answer.isPersonal || answeredQuery.accountId === inlineQuery.accountId) &&
        now < state.answeredAtMilliseconds + state.answer.cacheTimeSeconds * 1_000
      ) {
        return state;
      }
    }
    return undefined;
  }

  /** Checks that the account can type in the query's chat, as it can write there. */
  #checkChatAccess(
    accountId: number,
    chat: InlineQueryChat,
  ): 'chat_not_found' | 'not_a_member' | undefined {
    if (chat.type === 'private') {
      return this.#bots.getById(chat.botId) === undefined ? 'chat_not_found' : undefined;
    }
    if (this.#sharedChats.getSharedChat(chat.chatId)?.kind !== 'supergroup') {
      return 'chat_not_found';
    }
    return this.#sharedChats.getChatMembership(chat.chatId, accountId) === undefined
      ? 'not_a_member'
      : undefined;
  }

  /**
   * Prepares what a chosen result sends: content the answer holds, as it is, or media named by
   * URL, downloaded and prepared as the result's kind of media.
   */
  async #prepareSendingContent(
    content: InlineResultMessageContent,
    signal: AbortSignal | undefined,
  ): Promise<
    | { readonly prepared: true; readonly content: InlineResultSendingContent }
    | { readonly prepared: false; readonly reason: InlineResultWebMediaFailureReason }
  > {
    if (!isInlineResultWebMedia(content)) {
      return { prepared: true, content: { kind: 'existing', content } };
    }
    const download = await this.#downloadWebMedia(
      content.url,
      WEB_MEDIA_FILE_KINDS[content.kind],
      signal,
    );
    if (!download.downloaded) {
      return { prepared: false, reason: download.reason };
    }
    const sendingContent = this.#toWebMediaSendingContent(content, download.webFile);
    return sendingContent === undefined
      ? { prepared: false, reason: 'web_media_invalid' }
      : { prepared: true, content: sendingContent };
  }

  /**
   * Prepares downloaded media as the result's kind of media, with the caption and presentation the
   * answer holds; returns `undefined` for a file that is not media of that kind.
   */
  #toWebMediaSendingContent(
    content: InlineResultWebMedia,
    webFile: WebFile,
  ): InlineResultSendingContent | undefined {
    const { caption } = content;
    switch (content.kind) {
      case 'web_photo': {
        const preparation = this.#webMediaFiles.prepareInlineResultWebPhotoUpload(webFile);
        return preparation.prepared
          ? {
            kind: 'photo',
            photo: { kind: 'upload', upload: preparation.upload },
            caption,
            hasSpoiler: false,
            showsCaptionAboveMedia: content.showsCaptionAboveMedia,
          }
          : undefined;
      }
      case 'web_document': {
        const preparation = this.#webMediaFiles.prepareWebDocumentUpload(webFile);
        return preparation.prepared
          ? { kind: 'document', document: { kind: 'upload', upload: preparation.upload }, caption }
          : undefined;
      }
      case 'web_video': {
        const preparation = this.#webMediaFiles.prepareWebVideoUpload(webFile, content.attributes);
        return preparation.prepared
          ? {
            kind: 'video',
            video: { kind: 'upload', upload: preparation.upload },
            caption,
            hasSpoiler: false,
            showsCaptionAboveMedia: content.showsCaptionAboveMedia,
            startTimestampSeconds: 0,
          }
          : undefined;
      }
      case 'web_voice': {
        const preparation = this.#webMediaFiles.prepareWebVoiceUpload(
          webFile,
          content.durationSeconds,
        );
        return preparation.prepared
          ? { kind: 'voice', voice: { kind: 'upload', upload: preparation.upload }, caption }
          : undefined;
      }
      default: {
        const unhandledContent: never = content;
        throw new Error(`Unhandled web media: ${JSON.stringify(unhandledContent)}`);
      }
    }
  }

  /**
   * Downloads media a result names by URL, whose URL Telegram's checks of the answer read
   * successfully.
   */
  async #downloadWebMedia(
    url: string,
    fileKind: InlineResultWebFileKind,
    signal: AbortSignal | undefined,
  ): Promise<
    | { readonly downloaded: true; readonly webFile: WebFile }
    | { readonly downloaded: false; readonly reason: InlineResultWebMediaFailureReason }
  > {
    const download = await this.#webMediaFiles.downloadInlineResultWebFile({
      url,
      fileKind,
      signal,
    });
    if (download.downloaded) {
      return download;
    }
    switch (download.reason) {
      case 'web_content_unavailable':
        return { downloaded: false, reason: 'web_media_unavailable' };
      case 'web_content_type_invalid':
        return { downloaded: false, reason: 'web_media_invalid' };
      case 'file_url_invalid':
        throw new Error(`The URL of an answered inline query result is invalid: ${url}`);
      default: {
        const unhandledFailure: never = download;
        throw new Error(`Unhandled web file failure: ${JSON.stringify(unhandledFailure)}`);
      }
    }
  }

  #sendResult(
    inlineQuery: InlineQuery,
    result: InlineQueryResult,
    content: InlineResultSendingContent,
  ):
    | { readonly sent: true; readonly message: ChatMessage }
    | {
      readonly sent: false;
      readonly reason: 'not_a_member' | 'bot_blocked' | InlineResultPermissionFailureReason;
    } {
    const sending: InlineResultSending = {
      fromAccountId: inlineQuery.accountId,
      viaBotId: inlineQuery.botId,
      content,
      ...(result.inlineKeyboard === undefined ? {} : { inlineKeyboard: result.inlineKeyboard }),
    };
    const { chat } = inlineQuery;
    const sendingResult = chat.type === 'private'
      ? this.#privateMessages.sendAccountInlineResult({ ...sending, to: chat })
      : this.#supergroupMessages.sendAccountInlineResult({ ...sending, chatId: chat.chatId });
    if (sendingResult.sent) {
      return sendingResult;
    }
    const { reason } = sendingResult;
    switch (reason) {
      case 'not_a_member':
      case 'bot_blocked':
      case 'inline_bots_not_permitted':
      case 'send_permission_missing':
        return { sent: false, reason };
      // The emulator never removes accounts, bots, or supergroups, which the query found.
      case 'account_not_found':
      case 'bot_not_found':
      case 'chat_not_found':
        throw new Error(`Chat of inline query ${inlineQuery.id} no longer exists`);
      default: {
        const unhandledReason: never = reason;
        throw new Error(`Unhandled inline result sending failure: ${unhandledReason}`);
      }
    }
  }

  /**
   * Normalizes what a result sends as `normalizeOutgoingContent` normalizes new content, and the
   * caption of media named by URL as `normalizeCaption` normalizes a bot's caption.
   */
  #normalizeResultContent(
    content: SpecifiedInlineQueryResult['messageContent'],
  ):
    | { readonly normalized: true; readonly content: NormalizedInlineResultContent }
    | { readonly normalized: false; readonly failure: ContentTextNormalizationFailure } {
    if (!isSpecifiedInlineResultWebMedia(content)) {
      return normalizeOutgoingContent(content, 'bot', this.#textFixingContext);
    }
    const captionNormalization = normalizeCaption(content, 'bot', this.#textFixingContext);
    if (!captionNormalization.normalized) {
      return captionNormalization;
    }
    return {
      normalized: true,
      content: withWebMediaCaption(content, captionNormalization.caption),
    };
  }

  /** A text mention may name any user of the session. */
  get #textFixingContext() {
    return {
      isMentionableUser: (userId: number) =>
        this.#accounts.getById(userId) !== undefined || this.#bots.getById(userId) !== undefined,
    };
  }
}

/** TDLib's checks of the button that opens the bot's private chat with a start parameter. */
function checkResultsButton(
  button: InlineQueryResultsButton,
): 'start_parameter_empty' | 'start_parameter_too_long' | 'start_parameter_invalid' | undefined {
  if (button.kind !== 'start_bot') {
    return undefined;
  }
  if (button.startParameter.length === 0) {
    return 'start_parameter_empty';
  }
  if (button.startParameter.length > MAX_START_PARAMETER_LENGTH) {
    return 'start_parameter_too_long';
  }
  return START_PARAMETER_PATTERN.test(button.startParameter)
    ? undefined
    : 'start_parameter_invalid';
}

/**
 * Telegram's checks of the results' identifiers, titles, and buttons, in their keyboards and in
 * the rich messages they send, whose normalized content `messageContents` holds in order.
 */
function checkSpecifiedResults(
  results: readonly SpecifiedInlineQueryResult[],
  messageContents: readonly NormalizedInlineResultContent[],
): AnswerInlineQueryFailureReason | undefined {
  const resultIds = new Set<string>();
  for (const [resultIndex, result] of results.entries()) {
    if (result.id.length === 0) {
      return 'result_id_empty';
    }
    if (utf8Encoder.encode(result.id).length > MAX_INLINE_QUERY_RESULT_ID_BYTES) {
      return 'result_id_invalid';
    }
    if (resultIds.has(result.id)) {
      return 'result_id_duplicate';
    }
    resultIds.add(result.id);
    const listingFailure = checkTitle(result) ?? checkWebMediaListing(result);
    if (listingFailure !== undefined) {
      return listingFailure;
    }
    if (!hasOnlyValidResultCallbackData(result, messageContents[resultIndex])) {
      return 'callback_data_invalid';
    }
  }
  return undefined;
}

/** The kinds of result whose empty title Telegram refuses, with the reason it gives. */
const REQUIRED_TITLE_FAILURES: Readonly<
  Partial<Record<SpecifiedInlineQueryResult['kind'], AnswerInlineQueryFailureReason>>
> = {
  article: 'article_title_empty',
  document: 'document_title_empty',
  video: 'video_title_empty',
};

/** Telegram's check that a result of a kind that is listed by its title has one. */
function checkTitle(
  result: SpecifiedInlineQueryResult,
): AnswerInlineQueryFailureReason | undefined {
  return result.title.length === 0 ? REQUIRED_TITLE_FAILURES[result.kind] : undefined;
}

/**
 * Whether the buttons of what a result sends carry valid callback data: those of its inline
 * keyboard, and of a rich message it sends; media named by URL has no buttons of its own.
 */
function hasOnlyValidResultCallbackData(
  result: SpecifiedInlineQueryResult,
  messageContent: NormalizedInlineResultContent,
): boolean {
  return isInlineResultWebMedia(messageContent)
    ? result.inlineKeyboard === undefined || hasOnlyValidCallbackData(result.inlineKeyboard)
    : hasOnlyValidButtonCallbackData(result.inlineKeyboard, messageContent);
}

/**
 * Telegram's checks of a media result whose file, or embedded video player, the bot names by URL:
 * the URL must be one Telegram can download, and so must its thumbnail's, which a photo, as the Bot
 * API requires, must have. TDLib passes both URLs on as web documents, so Telegram's servers check
 * them; the emulator reads them as TDLib's `parse_url` reads the URL of a file sent by URL. TDLib
 * sends no thumbnail for a file the bot knows by `file_id`.
 */
function checkWebMediaListing(
  result: SpecifiedInlineQueryResult,
): 'web_document_url_invalid' | 'photo_thumbnail_url_empty' | undefined {
  const file = getSpecifiedListedFile(result);
  if (file === undefined || file.source === 'stored') {
    return undefined;
  }
  if (!parseHttpUrl(file.url).parsed) {
    return 'web_document_url_invalid';
  }
  // A video named by URL always has a thumbnail, which the emulator requires as it reads the
  // result's parameters, since Telegram documents no error for a missing one.
  const thumbnailUrl =
    result.kind === 'photo' || result.kind === 'document' || result.kind === 'video'
      ? result.thumbnailUrl
      : '';
  if (thumbnailUrl.length === 0) {
    return result.kind === 'photo' ? 'photo_thumbnail_url_empty' : undefined;
  }
  return parseHttpUrl(thumbnailUrl).parsed ? undefined : 'web_document_url_invalid';
}

/** The file a specified result lists, or `undefined` for a result that lists none. */
function getSpecifiedListedFile(
  result: SpecifiedInlineQueryResult,
): SpecifiedInlineResultFile<StoredFile> | SpecifiedInlineResultVideo | undefined {
  switch (result.kind) {
    case 'article':
    case 'contact':
    case 'location':
      return undefined;
    case 'photo':
      return result.photo;
    case 'document':
      return result.document;
    case 'video':
      return result.video;
    case 'voice':
      return result.voice;
    default: {
      const unhandledResult: never = result;
      throw new Error(`Unhandled inline query result: ${JSON.stringify(unhandledResult)}`);
    }
  }
}

/**
 * What a result sends once its text or caption is normalized: new content, or media named by URL,
 * which is downloaded when the result is sent.
 */
type NormalizedInlineResultContent = NormalizedOutgoingContent | InlineResultWebMedia;

/**
 * The kinds of media a result names by URL, which only sending it downloads, with the kind of file
 * each downloads.
 */
const WEB_MEDIA_FILE_KINDS: Readonly<
  Record<InlineResultWebMedia['kind'], InlineResultWebFileKind>
> = {
  web_photo: 'photo',
  web_document: 'document',
  web_video: 'video',
  web_voice: 'voice',
};

const WEB_MEDIA_KINDS: ReadonlySet<string> = new Set(Object.keys(WEB_MEDIA_FILE_KINDS));

function isInlineResultWebMedia(
  content: NormalizedInlineResultContent | InlineResultMessageContent,
): content is InlineResultWebMedia {
  return WEB_MEDIA_KINDS.has(content.kind);
}

function isSpecifiedInlineResultWebMedia(
  content: SpecifiedInlineQueryResult['messageContent'],
): content is SpecifiedInlineResultWebMedia {
  return WEB_MEDIA_KINDS.has(content.kind);
}

/** Media named by URL with its caption normalized, in place of the caption the bot specified. */
function withWebMediaCaption(
  content: SpecifiedInlineResultWebMedia,
  caption: FormattedText,
): InlineResultWebMedia {
  switch (content.kind) {
    case 'web_photo':
      return {
        kind: 'web_photo',
        url: content.url,
        caption,
        showsCaptionAboveMedia: content.showsCaptionAboveMedia,
      };
    case 'web_document':
      return { kind: 'web_document', url: content.url, caption };
    case 'web_video':
      return {
        kind: 'web_video',
        url: content.url,
        caption,
        showsCaptionAboveMedia: content.showsCaptionAboveMedia,
        attributes: content.attributes,
      };
    case 'web_voice':
      return {
        kind: 'web_voice',
        url: content.url,
        caption,
        durationSeconds: content.durationSeconds,
      };
    default: {
      const unhandledContent: never = content;
      throw new Error(`Unhandled web media: ${JSON.stringify(unhandledContent)}`);
    }
  }
}

/**
 * Returns what an answered result sends, as the answer holds it: content whose file, if any, the
 * bot reused by `file_id`, or media named by URL.
 */
function toAnsweredResultContent(
  content: NormalizedInlineResultContent,
): InlineResultMessageContent {
  return isInlineResultWebMedia(content) ? content : toContentOfStoredFile(content);
}

/** Keeps a checked result with its normalized message content; empty text is none. */
function toInlineQueryResult(
  result: SpecifiedInlineQueryResult,
  messageContent: InlineResultMessageContent,
): InlineQueryResult {
  const shared = {
    id: result.id,
    messageContent,
    ...(result.inlineKeyboard === undefined ? {} : { inlineKeyboard: result.inlineKeyboard }),
  };
  switch (result.kind) {
    case 'article':
      return {
        ...shared,
        ...optionalDescription(result.description),
        kind: 'article',
        title: result.title,
        ...(result.url.length === 0 ? {} : { url: result.url }),
      };
    case 'contact':
      return { ...shared, kind: 'contact', title: result.title, description: result.description };
    case 'location':
      return {
        ...shared,
        kind: 'location',
        ...(result.title.length === 0 ? {} : { title: result.title }),
        description: result.description,
      };
    case 'photo':
      return {
        ...shared,
        ...optionalDescription(result.description),
        kind: 'photo',
        file: toListedFile(result.photo),
        ...(result.title.length === 0 ? {} : { title: result.title }),
      };
    case 'document':
      return {
        ...shared,
        ...optionalDescription(result.description),
        kind: 'document',
        file: toListedFile(result.document),
        title: result.title,
      };
    case 'video':
      return {
        ...shared,
        ...optionalDescription(result.description),
        kind: 'video',
        file: toListedVideo(result.video),
        title: result.title,
      };
    case 'voice':
      return {
        ...shared,
        kind: 'voice',
        file: toListedFile(result.voice),
        ...(result.title.length === 0 ? {} : { title: result.title }),
      };
    default: {
      const unhandledResult: never = result;
      throw new Error(`Unhandled inline query result: ${JSON.stringify(unhandledResult)}`);
    }
  }
}

/** A result's description as the answer keeps it, omitted when empty. */
function optionalDescription(description: string): { readonly description?: string } {
  return description.length === 0 ? {} : { description };
}

function toListedFile(file: SpecifiedInlineResultFile<StoredFile>): InlineResultListedFile {
  return file.source === 'stored' ? { source: 'stored', fileId: file.file.id } : file;
}

function toListedVideo(video: SpecifiedInlineResultVideo): InlineResultListedVideo {
  return video.source === 'embedded_player' ? video : toListedFile(video);
}
