import type { ChatDomainEvent } from '../types/chat_domain_event.ts';
import type { ChatMembership } from '../types/chat_membership.ts';
import type { GeoLocation } from '../types/geo_location.ts';
import {
  findInlineQueryResult,
  type InlineQuery,
  type InlineQueryAnswer,
  type InlineQueryChat,
  type InlineQueryId,
  type InlineQueryResult,
  type InlineQueryResultsButton,
  isSameInlineQueryRequest,
  MAX_INLINE_QUERY_NEXT_OFFSET_BYTES,
  MAX_INLINE_QUERY_RESULT_COUNT,
  MAX_INLINE_QUERY_RESULT_ID_BYTES,
  MAX_START_PARAMETER_LENGTH,
} from '../types/inline_query.ts';
import type { InlineKeyboard } from '../types/inline_keyboard.ts';
import type { StoredDocumentFile, StoredPhotoFile } from '../types/stored_file.ts';
import type { VirtualAccount } from '../types/virtual_account.ts';
import type { VirtualBot } from '../types/virtual_bot.ts';
import type { SharedChat } from '../types/virtual_chat.ts';
import type {
  ChatMessage,
  MessageContent,
  PrivateMessage,
  SupergroupMessage,
} from '../types/virtual_message.ts';
import {
  type ContentTextNormalizationFailure,
  hasOnlyValidButtonCallbackData,
  type NormalizedOutgoingContent,
  normalizeOutgoingContent,
  type OutgoingContentOtherThanPoll,
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
    readonly kind: 'photo';
    readonly photo: StoredPhotoFile;
    /** Empty for none. */
    readonly title: string;
    /** Empty for none. */
    readonly description: string;
  }
  | {
    readonly kind: 'document';
    readonly document: StoredDocumentFile;
    readonly title: string;
    /** Empty for none. */
    readonly description: string;
  };

/**
 * A result of an answer as the bot specified it, before Telegram's checks. Its message content is
 * the text or rich message the bot specified, or else the result's own photo or document with a
 * caption.
 */
export type SpecifiedInlineQueryResult = SpecifiedInlineQueryResultListing & {
  readonly id: string;
  /** As the Bot API's `InputMessageContent`, which has no poll. */
  readonly messageContent: OutgoingContentOtherThanPoll;
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
}

export type ChooseInlineQueryResultFailureReason =
  | 'inline_query_not_found'
  | 'inline_query_not_answered'
  | 'result_not_found'
  | 'not_a_member'
  | 'bot_blocked';

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

/** Sends an account's chosen result as its message sent through the inline bot. */
interface InlineResultSending {
  readonly content: MessageContent;
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
      readonly reason: 'account_not_found' | 'chat_not_found' | 'not_a_member';
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

interface InlineQueryServiceDependencies {
  readonly accounts: AccountLookup;
  readonly bots: BotLookup;
  readonly sharedChats: SupergroupLookup;
  readonly privateMessages: PrivateInlineResultMessaging;
  readonly supergroupMessages: SupergroupInlineResultMessaging;
  readonly inlineQueries: InlineQueryStore;
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
    const messageContents: NormalizedOutgoingContent[] = [];
    for (const result of input.results) {
      const normalization = normalizeOutgoingContent(
        result.messageContent,
        'bot',
        this.#textFixingContext,
      );
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
            toInlineQueryResult(result, toContentOfStoredFile(messageContents[resultIndex]))
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
   */
  chooseInlineQueryResult(input: ChooseInlineQueryResultInput): ChooseInlineQueryResultResult {
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

    const sending = this.#sendResult(inlineQuery, result);
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

  #sendResult(
    inlineQuery: InlineQuery,
    result: InlineQueryResult,
  ):
    | { readonly sent: true; readonly message: ChatMessage }
    | { readonly sent: false; readonly reason: 'not_a_member' | 'bot_blocked' } {
    const sending: InlineResultSending = {
      fromAccountId: inlineQuery.accountId,
      viaBotId: inlineQuery.botId,
      content: result.messageContent,
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
  messageContents: readonly NormalizedOutgoingContent[],
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
    if (result.kind === 'article' && result.title.length === 0) {
      return 'article_title_empty';
    }
    if (result.kind === 'document' && result.title.length === 0) {
      return 'document_title_empty';
    }
    if (!hasOnlyValidButtonCallbackData(result.inlineKeyboard, messageContents[resultIndex])) {
      return 'callback_data_invalid';
    }
  }
  return undefined;
}

/** Keeps a checked result with its normalized message content; empty text is none. */
function toInlineQueryResult(
  result: SpecifiedInlineQueryResult,
  messageContent: MessageContent,
): InlineQueryResult {
  const shared = {
    id: result.id,
    messageContent,
    ...(result.inlineKeyboard === undefined ? {} : { inlineKeyboard: result.inlineKeyboard }),
    ...(result.description.length === 0 ? {} : { description: result.description }),
  };
  switch (result.kind) {
    case 'article':
      return {
        ...shared,
        kind: 'article',
        title: result.title,
        ...(result.url.length === 0 ? {} : { url: result.url }),
      };
    case 'photo':
      return {
        ...shared,
        kind: 'photo',
        fileId: result.photo.id,
        ...(result.title.length === 0 ? {} : { title: result.title }),
      };
    case 'document':
      return { ...shared, kind: 'document', fileId: result.document.id, title: result.title };
    default: {
      const unhandledResult: never = result;
      throw new Error(`Unhandled inline query result: ${JSON.stringify(unhandledResult)}`);
    }
  }
}
