import { type ChangeStaging, UNSTAGED_CHANGES } from '../transactions/staging/change_staging.ts';
import { TransactionalMap } from '../transactions/staging/transactional_collections.ts';
import type {
  CallbackQuery,
  CallbackQueryAnswer,
  CallbackQueryId,
} from '../types/callback_query.ts';
import type { CanonicalMessageId, InlineMessageId } from '../types/virtual_message.ts';

export interface AddCallbackQueryInput {
  readonly accountId: number;
  readonly botId: number;
  readonly messageId: CanonicalMessageId;
  /** Omitted for a press on a bot's own message rather than an inline message. */
  readonly inlineMessageId?: InlineMessageId;
  readonly chatInstance: string;
  readonly callbackData: string;
  /** Stores the query already expired instead of awaiting an answer. */
  readonly expired: boolean;
}

/** Stores callback queries and how each one ended under session-unique identifiers. */
export class CallbackQueryRepository {
  readonly #staging: ChangeStaging;
  readonly #callbackQueriesById: TransactionalMap<CallbackQueryId, CallbackQuery>;
  #nextCallbackQueryNumber = 1;

  /** `staging` decides how the repository's writes take part in its session's transactions. */
  constructor(staging: ChangeStaging = UNSTAGED_CHANGES) {
    this.#staging = staging;
    this.#callbackQueriesById = new TransactionalMap(staging);
  }

  addCallbackQuery(input: AddCallbackQueryInput): CallbackQuery {
    const callbackQueryNumber = this.#nextCallbackQueryNumber++;
    this.#staging.recordRevert(() => {
      this.#nextCallbackQueryNumber = callbackQueryNumber;
    });
    const callbackQuery: CallbackQuery = {
      id: String(callbackQueryNumber),
      accountId: input.accountId,
      botId: input.botId,
      messageId: input.messageId,
      ...(input.inlineMessageId === undefined ? {} : { inlineMessageId: input.inlineMessageId }),
      chatInstance: input.chatInstance,
      callbackData: input.callbackData,
      state: input.expired ? { status: 'expired' } : { status: 'awaiting_answer' },
    };
    this.#callbackQueriesById.set(callbackQuery.id, callbackQuery);
    return callbackQuery;
  }

  getCallbackQuery(callbackQueryId: CallbackQueryId): CallbackQuery | undefined {
    return this.#callbackQueriesById.get(callbackQueryId);
  }

  /** Records the answer to a query awaiting one and returns the answered query. */
  recordAnswer(callbackQueryId: CallbackQueryId, answer: CallbackQueryAnswer): CallbackQuery {
    const callbackQuery = this.#callbackQueriesById.get(callbackQueryId);
    if (callbackQuery === undefined) {
      throw new Error(`Callback query ${callbackQueryId} does not exist`);
    }
    if (callbackQuery.state.status !== 'awaiting_answer') {
      throw new Error(`Callback query ${callbackQueryId} is already ${callbackQuery.state.status}`);
    }

    const answeredCallbackQuery: CallbackQuery = {
      ...callbackQuery,
      state: { status: 'answered', answer: { ...answer } },
    };
    this.#callbackQueriesById.set(callbackQueryId, answeredCallbackQuery);
    return answeredCallbackQuery;
  }
}
