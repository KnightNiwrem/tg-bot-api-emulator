import { type ChangeStaging, UNSTAGED_CHANGES } from '../../transactions/staging/change_staging.ts';
import {
  TransactionalMap,
  TransactionalSet,
} from '../../transactions/staging/transactional_collections.ts';
import type { GeoLocation } from '../../types/geo_location.ts';
import type { InlineQuery, InlineQueryAnswer, InlineQueryId } from '../../types/inline_query.ts';
import type { AccountChatAddress } from '../../types/virtual_chat.ts';

export interface AddInlineQueryInput {
  readonly accountId: number;
  readonly botId: number;
  readonly chat: AccountChatAddress;
  readonly query: string;
  readonly offset: string;
  readonly userLocation?: GeoLocation;
}

/**
 * Stores inline queries and their answers under session-unique identifiers, and which answers the
 * answer cache holds for later queries to reuse.
 */
export class InlineQueryRepository {
  readonly #staging: ChangeStaging;
  readonly #inlineQueriesById: TransactionalMap<InlineQueryId, InlineQuery>;
  /** The queries whose answers the cache holds, in the order they were answered. */
  readonly #cachedAnswerQueryIds: TransactionalSet<InlineQueryId>;
  #nextInlineQueryNumber = 1;

  /** `staging` decides how the repository's writes take part in its session's transactions. */
  constructor(staging: ChangeStaging = UNSTAGED_CHANGES) {
    this.#staging = staging;
    this.#inlineQueriesById = new TransactionalMap(staging);
    this.#cachedAnswerQueryIds = new TransactionalSet(staging);
  }

  addInlineQuery(input: AddInlineQueryInput): InlineQuery {
    const inlineQueryNumber = this.#nextInlineQueryNumber++;
    this.#staging.recordRevert(() => {
      this.#nextInlineQueryNumber = inlineQueryNumber;
    });
    const inlineQuery: InlineQuery = {
      id: String(inlineQueryNumber),
      accountId: input.accountId,
      botId: input.botId,
      chat: { ...input.chat },
      query: input.query,
      offset: input.offset,
      ...(input.userLocation === undefined ? {} : { userLocation: input.userLocation }),
      state: { status: 'awaiting_answer' },
    };
    this.#inlineQueriesById.set(inlineQuery.id, inlineQuery);
    return inlineQuery;
  }

  getInlineQuery(inlineQueryId: InlineQueryId): InlineQuery | undefined {
    return this.#inlineQueriesById.get(inlineQueryId);
  }

  /** Returns the bot's queries whose answers the cache holds, the latest answered first. */
  listQueriesWithCachedAnswers(botId: number): readonly InlineQuery[] {
    return [...this.#cachedAnswerQueryIds]
      .map((inlineQueryId) => this.#getExistingInlineQuery(inlineQueryId))
      .filter((inlineQuery) => inlineQuery.botId === botId)
      .reverse();
  }

  /**
   * Records the answer to a query awaiting one and returns the answered query. An answer that
   * `addsToCache` is held in the cache until it is removed from it.
   */
  recordAnswer(
    inlineQueryId: InlineQueryId,
    answer: InlineQueryAnswer,
    { addsToCache }: { readonly addsToCache: boolean },
  ): InlineQuery {
    const inlineQuery = this.#getExistingInlineQuery(inlineQueryId);
    if (inlineQuery.state.status !== 'awaiting_answer') {
      throw new Error(`Inline query ${inlineQueryId} is already ${inlineQuery.state.status}`);
    }

    const answeredInlineQuery: InlineQuery = {
      ...inlineQuery,
      state: { status: 'answered', answer: structuredClone(answer) },
    };
    this.#inlineQueriesById.set(inlineQueryId, answeredInlineQuery);
    if (addsToCache) {
      this.#cachedAnswerQueryIds.add(inlineQueryId);
    }
    return answeredInlineQuery;
  }

  /** Removes the queries' answers from the cache; the queries keep their answers. */
  removeCachedAnswers(inlineQueryIds: readonly InlineQueryId[]): void {
    for (const inlineQueryId of inlineQueryIds) {
      this.#cachedAnswerQueryIds.delete(inlineQueryId);
    }
  }

  #getExistingInlineQuery(inlineQueryId: InlineQueryId): InlineQuery {
    const inlineQuery = this.#inlineQueriesById.get(inlineQueryId);
    if (inlineQuery === undefined) {
      throw new Error(`Inline query ${inlineQueryId} does not exist`);
    }
    return inlineQuery;
  }
}
