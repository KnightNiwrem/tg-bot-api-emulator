import type {
  BotApiCallbackQuery,
  BotApiChatJoinRequest,
  BotApiChatMemberUpdated,
  BotApiChosenInlineResult,
  BotApiInlineQuery,
  BotApiMessage,
  BotApiMessageGenerationStopped,
  BotApiMessageReactionUpdated,
  BotApiMyChatMemberUpdated,
  BotApiUpdate,
} from '../types/bot_api.ts';
import type { BotApiPoll, BotApiPollAnswer } from '../types/bot_api_poll.ts';

/**
 * How far beyond the ID of the next update an offset can be before Telegram ignores it. From the
 * "from_id is in the future" check in TDLib's `TQueue::get`, which the official Bot API server
 * answers by reading from the queue head instead.
 */
const MAX_OFFSET_BEYOND_NEXT_UPDATE_ID = 10;

interface ConfirmAndReadPendingUpdatesInput {
  /**
   * Updates with a lower ID are confirmed and forgotten; `undefined` confirms none. As on Telegram,
   * an ID more than 10 beyond the ID the next update will receive also confirms none.
   */
  readonly firstUnconfirmedUpdateId?: number;
  readonly limit: number;
}

interface WaitForUpdateInput {
  /** Omitted to wait without a time limit. */
  readonly timeoutSeconds?: number;
  readonly signal?: AbortSignal;
}

interface BotUpdateMailbox {
  nextUpdateId: number;
  readonly updates: BotApiUpdate[];
}

/** Owns each bot's independently sequenced pending Bot API updates. */
export class BotUpdateRepository {
  readonly #mailboxesByBotId = new Map<number, BotUpdateMailbox>();
  readonly #waitersByBotId = new Map<number, Set<() => void>>();

  enqueueMessageUpdate(botId: number, message: BotApiMessage): BotApiUpdate {
    return this.#enqueueUpdate(botId, (update_id) => ({ update_id, message }));
  }

  enqueueEditedMessageUpdate(botId: number, editedMessage: BotApiMessage): BotApiUpdate {
    return this.#enqueueUpdate(
      botId,
      (update_id) => ({ update_id, edited_message: editedMessage }),
    );
  }

  enqueueInlineQueryUpdate(botId: number, inlineQuery: BotApiInlineQuery): BotApiUpdate {
    return this.#enqueueUpdate(botId, (update_id) => ({ update_id, inline_query: inlineQuery }));
  }

  enqueueChosenInlineResultUpdate(
    botId: number,
    chosenInlineResult: BotApiChosenInlineResult,
  ): BotApiUpdate {
    return this.#enqueueUpdate(
      botId,
      (update_id) => ({ update_id, chosen_inline_result: chosenInlineResult }),
    );
  }

  enqueueCallbackQueryUpdate(botId: number, callbackQuery: BotApiCallbackQuery): BotApiUpdate {
    return this.#enqueueUpdate(
      botId,
      (update_id) => ({ update_id, callback_query: callbackQuery }),
    );
  }

  enqueuePollUpdate(botId: number, poll: BotApiPoll): BotApiUpdate {
    return this.#enqueueUpdate(botId, (update_id) => ({ update_id, poll }));
  }

  enqueuePollAnswerUpdate(botId: number, pollAnswer: BotApiPollAnswer): BotApiUpdate {
    return this.#enqueueUpdate(botId, (update_id) => ({ update_id, poll_answer: pollAnswer }));
  }

  enqueueMyChatMemberUpdate(botId: number, myChatMember: BotApiMyChatMemberUpdated): BotApiUpdate {
    return this.#enqueueUpdate(
      botId,
      (update_id) => ({ update_id, my_chat_member: myChatMember }),
    );
  }

  enqueueChatMemberUpdate(botId: number, chatMember: BotApiChatMemberUpdated): BotApiUpdate {
    return this.#enqueueUpdate(botId, (update_id) => ({ update_id, chat_member: chatMember }));
  }

  enqueueChatJoinRequestUpdate(
    botId: number,
    chatJoinRequest: BotApiChatJoinRequest,
  ): BotApiUpdate {
    return this.#enqueueUpdate(
      botId,
      (update_id) => ({ update_id, chat_join_request: chatJoinRequest }),
    );
  }

  enqueueMessageReactionUpdate(
    botId: number,
    messageReaction: BotApiMessageReactionUpdated,
  ): BotApiUpdate {
    return this.#enqueueUpdate(
      botId,
      (update_id) => ({ update_id, message_reaction: messageReaction }),
    );
  }

  enqueueStoppedMessageGenerationUpdate(
    botId: number,
    stoppedMessageGeneration: BotApiMessageGenerationStopped,
  ): BotApiUpdate {
    return this.#enqueueUpdate(
      botId,
      (update_id) => ({ update_id, stopped_message_generation: stoppedMessageGeneration }),
    );
  }

  /**
   * Converts a Bot API offset, which may count back from the queue tail, into the ID of the first
   * update to keep. The result depends on the current queue, so resolve it once per request.
   */
  resolveFirstUnconfirmedUpdateId(botId: number, offset: number | undefined): number | undefined {
    if (offset === undefined || offset >= 0) {
      return offset;
    }

    const mailbox = this.#getOrCreateMailbox(botId);
    const retainedUpdateCount = Math.min(-offset, mailbox.updates.length);
    const firstRetainedUpdate = mailbox.updates[mailbox.updates.length - retainedUpdateCount];
    return firstRetainedUpdate?.update_id ?? mailbox.nextUpdateId;
  }

  /** Confirms updates preceding `firstUnconfirmedUpdateId`, then reads pending updates. */
  confirmAndReadPendingUpdates(
    botId: number,
    { firstUnconfirmedUpdateId, limit }: ConfirmAndReadPendingUpdatesInput,
  ): readonly BotApiUpdate[] {
    this.confirmUpdatesBefore(botId, firstUnconfirmedUpdateId);
    return this.#getOrCreateMailbox(botId).updates.slice(0, limit);
  }

  /**
   * Confirms and forgets the pending updates with a lower ID than `firstUnconfirmedUpdateId`, and
   * returns them, oldest first. `undefined` confirms none; as on Telegram, so does an ID more than
   * 10 beyond the ID the next update will receive.
   */
  confirmUpdatesBefore(
    botId: number,
    firstUnconfirmedUpdateId: number | undefined,
  ): readonly BotApiUpdate[] {
    const mailbox = this.#getOrCreateMailbox(botId);
    if (
      firstUnconfirmedUpdateId === undefined ||
      firstUnconfirmedUpdateId > mailbox.nextUpdateId + MAX_OFFSET_BEYOND_NEXT_UPDATE_ID
    ) {
      return [];
    }
    const firstUnconfirmedUpdateIndex = mailbox.updates.findIndex((update) =>
      update.update_id >= firstUnconfirmedUpdateId
    );
    return mailbox.updates.splice(
      0,
      firstUnconfirmedUpdateIndex === -1 ? mailbox.updates.length : firstUnconfirmedUpdateIndex,
    );
  }

  /** Returns the bot's pending updates, oldest first, without confirming any. */
  readPendingUpdates(botId: number): readonly BotApiUpdate[] {
    return [...this.#getOrCreateMailbox(botId).updates];
  }

  /**
   * Confirms and forgets one pending update, whatever updates precede it, as TDLib's
   * `TQueue::forget` does for an update a webhook accepted.
   */
  confirmPendingUpdate(botId: number, updateId: number): void {
    const { updates } = this.#getOrCreateMailbox(botId);
    const updateIndex = updates.findIndex((update) => update.update_id === updateId);
    if (updateIndex !== -1) {
      updates.splice(updateIndex, 1);
    }
  }

  countPendingUpdates(botId: number): number {
    return this.#getOrCreateMailbox(botId).updates.length;
  }

  /** Forgets every pending update; later updates continue the bot's update ID sequence. */
  discardPendingUpdates(botId: number): void {
    this.#getOrCreateMailbox(botId).updates.splice(0);
  }

  /** Resolves when an update is enqueued for the bot, the timeout elapses, or `signal` aborts. */
  waitForUpdate(botId: number, { timeoutSeconds, signal }: WaitForUpdateInput): Promise<void> {
    return new Promise((resolve) => {
      if (signal?.aborted === true) {
        resolve();
        return;
      }

      const waiters = this.#waitersByBotId.get(botId) ?? new Set<() => void>();

      const finish = () => {
        clearTimeout(timeoutId);
        signal?.removeEventListener('abort', finish);
        waiters.delete(finish);
        if (waiters.size === 0) {
          this.#waitersByBotId.delete(botId);
        }
        resolve();
      };

      waiters.add(finish);
      this.#waitersByBotId.set(botId, waiters);
      const timeoutId = timeoutSeconds === undefined
        ? undefined
        : setTimeout(finish, timeoutSeconds * 1_000);
      signal?.addEventListener('abort', finish, { once: true });
    });
  }

  #enqueueUpdate(botId: number, createUpdate: (updateId: number) => BotApiUpdate): BotApiUpdate {
    const mailbox = this.#getOrCreateMailbox(botId);
    const update = createUpdate(mailbox.nextUpdateId++);
    mailbox.updates.push(update);
    this.#notifyWaiters(botId);
    return update;
  }

  #getOrCreateMailbox(botId: number): BotUpdateMailbox {
    const existingMailbox = this.#mailboxesByBotId.get(botId);
    if (existingMailbox !== undefined) {
      return existingMailbox;
    }

    const mailbox: BotUpdateMailbox = { nextUpdateId: 1, updates: [] };
    this.#mailboxesByBotId.set(botId, mailbox);
    return mailbox;
  }

  #notifyWaiters(botId: number): void {
    for (const finish of [...(this.#waitersByBotId.get(botId) ?? [])]) {
      finish();
    }
  }
}
