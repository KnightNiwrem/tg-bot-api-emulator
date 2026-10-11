/**
 * How a webhook's complete 2xx response accepts its update, as the official Bot API server's
 * `WebhookActor` acknowledges it on receipt, while the method the response names runs apart from
 * the delivery; and how replacing or deleting the webhook, or expiring the attempt, ends an
 * attempt at each stage of the webhook's answer.
 */
import { assertEquals } from '@std/assert';
import { AccountRepository } from '../src/repositories/account.ts';
import { BotRepository } from '../src/repositories/bot.ts';
import { BotActivityLogRepository } from '../src/repositories/bot_activity_log.ts';
import { BotUpdateRepository } from '../src/repositories/bot_update.ts';
import { TelegramIdentityRepository } from '../src/repositories/telegram_identity.ts';
import { BotActivityService } from '../src/services/bot_activity.ts';
import { VirtualUserService } from '../src/services/virtual_user.ts';
import {
  WEBHOOK_ATTEMPT_TIMEOUT_MILLISECONDS,
  WebhookAttemptScheduler,
} from '../src/services/webhook_attempt_scheduler.ts';
import type { BotApiUpdate } from '../src/types/bot_api.ts';
import type { BotActivityEntry, BotActivityFilter } from '../src/types/bot_activity.ts';
import type { WebhookAttempt } from '../src/types/bot_webhook.ts';
import { createRealTimeScheduler } from './support/scheduler.ts';
import { createVirtualBot } from './support/virtual_users.ts';
import {
  createPrivateMessage,
  createUpdateConsumers,
  ReceivedRequestCounter,
  respondOnlyByAborting,
  waitUntil,
  WEBHOOK_URL,
  webhookRequest,
} from './support/webhook_delivery.ts';

const REPLACEMENT_WEBHOOK_URL = `${WEBHOOK_URL}/replacement`;
const REPLY_BODY = JSON.stringify({ method: 'sendMessage', chat_id: 1, text: 'Hi' });

Deno.test('the next update of a queue is delivered while the previous reply is still being prepared', async () => {
  // Both updates are Ada's messages, so they share one queue.
  const fixture = createAcceptanceFixture((request) =>
    new Response(request.url === REPLACEMENT_WEBHOOK_URL ? null : REPLY_BODY)
  );
  const { botId, botUpdates, updateConsumers, webhookAttempts, heldReplies, endSession } = fixture;

  try {
    webhookAttempts.setScheduling(botId, 'manual');
    botUpdates.enqueueMessageUpdate(botId, createPrivateMessage(1));
    botUpdates.enqueueMessageUpdate(botId, createPrivateMessage(2));
    updateConsumers.setWebhook(botId, webhookRequest());
    await fixture.waitForEntry({ kind: 'update_confirmed', updateId: 2 });
    const deliveredBeforeRelease = fixture.receivedRequests.map(({ updateId }) => updateId);

    // Neither expiry nor a replacement webhook sends the accepted update again.
    const expiry = await webhookAttempts.expireAttempt(botId, 1);
    updateConsumers.setWebhook(botId, { ...webhookRequest(), url: REPLACEMENT_WEBHOOK_URL });
    heldReplies.releaseAll();
    await heldReplies.waitForFinishedCount(2);

    assertEquals(
      [
        deliveredBeforeRelease,
        heldReplies.finishedReplyBodies,
        expiry,
        listAttempts(webhookAttempts, botId).map(({ updateId, status }) => [updateId, status]),
        fixture.receivedRequests.map(({ url }) => url === REPLACEMENT_WEBHOOK_URL),
        updateConsumers.getWebhookInfo(botId).pending_update_count,
      ],
      [
        [1, 2],
        [REPLY_BODY, REPLY_BODY],
        { expired: false, reason: 'attempt_not_in_flight' },
        [[1, 'accepted'], [2, 'accepted']],
        [false, false],
        0,
      ],
      'Expected the queue to move on while the replies were held, and nothing to be sent again',
    );
  } finally {
    endSession();
  }
});

Deno.test("an accepted update's reply is started before its confirmation is recorded", async () => {
  const fixture = createAcceptanceFixture(() => new Response(REPLY_BODY));
  const { botId, botUpdates, updateConsumers, publications, endSession } = fixture;

  try {
    botUpdates.enqueueMessageUpdate(botId, createPrivateMessage(1));
    updateConsumers.setWebhook(botId, webhookRequest());
    await fixture.waitForEntry({ kind: 'update_confirmed' });
    assertEquals(
      publications,
      ['reply_started', 'update_confirmed'],
      'Expected the reply to be under way before anyone could read the confirmation',
    );
  } finally {
    endSession();
  }
});

/** A point in the webhook's answer at which a test stops the attempt. */
type AnswerStage = 'headers' | 'partial_body' | 'complete_body' | 'reply_execution';

/** How a test stops an attempt. */
type AttemptControl = 'replacement' | 'deletion' | 'expiry';

/**
 * What one stage and control lead to: the first attempt's state, whether the update was sent to
 * the replacement webhook, the pending count, and the expiry's refusal when it is refused.
 */
const EXPECTED_OUTCOMES: Readonly<
  Record<AnswerStage, Readonly<Record<AttemptControl, readonly unknown[]>>>
> = {
  headers: {
    replacement: ['cancelled', true, 0, undefined],
    deletion: ['cancelled', false, 1, undefined],
    expiry: ['failed: waiting', false, 1, undefined],
  },
  partial_body: {
    replacement: ['cancelled', true, 0, undefined],
    deletion: ['cancelled', false, 1, undefined],
    expiry: ['failed: waiting', false, 1, undefined],
  },
  complete_body: {
    replacement: ['accepted', false, 0, undefined],
    deletion: ['accepted', false, 0, undefined],
    expiry: ['accepted', false, 0, 'attempt_not_in_flight'],
  },
  reply_execution: {
    replacement: ['accepted', false, 0, undefined],
    deletion: ['accepted', false, 0, undefined],
    expiry: ['accepted', false, 0, 'attempt_not_in_flight'],
  },
};

for (const stage of Object.keys(EXPECTED_OUTCOMES) as AnswerStage[]) {
  for (const control of ['replacement', 'deletion', 'expiry'] as const) {
    Deno.test(`${control} at ${stage} gives the attempt one terminal outcome`, async () => {
      const bodyBeingRead = Promise.withResolvers<void>();
      const fixture = createAcceptanceFixture((request) => {
        if (request.url === REPLACEMENT_WEBHOOK_URL) {
          return new Response(null);
        }
        switch (stage) {
          case 'headers':
            return respondOnlyByAborting(request);
          case 'partial_body':
            return new Response(
              new ReadableStream<Uint8Array>({
                start(controller) {
                  controller.enqueue(new TextEncoder().encode(REPLY_BODY.slice(0, 10)));
                },
                // Asked for more once the emulator has read the first chunk; nothing more comes.
                pull() {
                  bodyBeingRead.resolve();
                  return new Promise(() => {});
                },
              }),
            );
          case 'complete_body':
            return new Response(null);
          case 'reply_execution':
            return new Response(REPLY_BODY);
        }
      });
      const { botId, botUpdates, updateConsumers, webhookAttempts, heldReplies, endSession } =
        fixture;

      try {
        webhookAttempts.setScheduling(botId, 'manual');
        botUpdates.enqueueMessageUpdate(botId, createPrivateMessage(1));
        updateConsumers.setWebhook(botId, webhookRequest());
        await reachStage(stage, fixture, bodyBeingRead.promise);

        const expiry = await applyControl(control, fixture);
        await waitUntil(() => listAttempts(webhookAttempts, botId)[0].status !== 'in_flight');
        if (control === 'replacement' && EXPECTED_OUTCOMES[stage][control][1] === true) {
          await fixture.waitForEntry({ kind: 'update_confirmed' });
        }
        heldReplies.releaseAll();
        if (stage === 'reply_execution') {
          await heldReplies.waitForFinishedCount(1);
        }

        const [firstAttempt] = listAttempts(webhookAttempts, botId);
        assertEquals(
          [
            describeAttemptState(firstAttempt),
            fixture.receivedRequests.some(({ url }) => url === REPLACEMENT_WEBHOOK_URL),
            updateConsumers.getWebhookInfo(botId).pending_update_count,
            expiry?.expired === false ? expiry.reason : undefined,
          ],
          EXPECTED_OUTCOMES[stage][control],
          `Expected ${control} at ${stage} to end the first attempt once`,
        );
        if (stage === 'reply_execution') {
          assertEquals(
            heldReplies.finishedReplyBodies,
            [REPLY_BODY],
            "Expected the accepted reply's method to run to its end",
          );
        }
      } finally {
        endSession();
      }
    });
  }
}

Deno.test('a replacement right after the complete response arrives does not send the update again', async () => {
  const completeBody = Promise.withResolvers<ArrayBuffer>();
  /** A response whose body the test completes. */
  class ControlledBodyResponse extends Response {
    override arrayBuffer(): Promise<ArrayBuffer> {
      return completeBody.promise;
    }
  }
  const fixture = createAcceptanceFixture((request) =>
    request.url === REPLACEMENT_WEBHOOK_URL ? new Response(null) : new ControlledBodyResponse(null)
  );
  const { botId, botUpdates, updateConsumers, webhookAttempts, endSession } = fixture;

  try {
    botUpdates.enqueueMessageUpdate(botId, createPrivateMessage(1));
    updateConsumers.setWebhook(botId, webhookRequest());
    await fixture.waitForRequestCount(1);
    await new Promise((resolve) => setTimeout(resolve, 0));

    completeBody.resolve(new ArrayBuffer(0));
    // The emulator sees the complete body in the first microtask; the replacement comes next,
    // before the delivery has done anything else.
    await Promise.resolve();
    updateConsumers.setWebhook(botId, { ...webhookRequest(), url: REPLACEMENT_WEBHOOK_URL });
    await waitUntil(() => listAttempts(webhookAttempts, botId)[0].status !== 'in_flight');
    await new Promise((resolve) => setTimeout(resolve, 0));

    assertEquals(
      [
        listAttempts(webhookAttempts, botId).map(describeAttemptState),
        fixture.receivedRequests.map(({ url }) => url === REPLACEMENT_WEBHOOK_URL),
        updateConsumers.getWebhookInfo(botId).pending_update_count,
      ],
      [['accepted'], [false], 0],
      'Expected the complete response to accept the update before the replacement could cancel it',
    );
  } finally {
    endSession();
  }
});

Deno.test("a failure decided just before a replacement is not the replacement webhook's error", async () => {
  const completeBody = Promise.withResolvers<ArrayBuffer>();
  /** A failed response whose body the test completes. */
  class ControlledBodyResponse extends Response {
    override arrayBuffer(): Promise<ArrayBuffer> {
      return completeBody.promise;
    }
  }
  const fixture = createAcceptanceFixture((request) =>
    request.url === REPLACEMENT_WEBHOOK_URL
      ? new Response(null)
      : new ControlledBodyResponse(null, { status: 500, statusText: 'Internal Server Error' })
  );
  const { botId, botUpdates, updateConsumers, webhookAttempts, endSession } = fixture;

  try {
    webhookAttempts.setScheduling(botId, 'manual');
    botUpdates.enqueueMessageUpdate(botId, createPrivateMessage(1));
    updateConsumers.setWebhook(botId, webhookRequest());
    await fixture.waitForRequestCount(1);
    await new Promise((resolve) => setTimeout(resolve, 0));

    completeBody.resolve(new ArrayBuffer(0));
    // The failed response wins the attempt in the first microtask; the replacement comes next,
    // before the old delivery has handled the failure.
    await Promise.resolve();
    updateConsumers.setWebhook(botId, { ...webhookRequest(), url: REPLACEMENT_WEBHOOK_URL });
    await fixture.waitForEntry({ kind: 'update_confirmed' });
    await waitUntil(() => listAttempts(webhookAttempts, botId)[0].status !== 'in_flight');
    await new Promise((resolve) => setTimeout(resolve, 0));

    const webhookInfo = updateConsumers.getWebhookInfo(botId);
    assertEquals(
      [
        listAttempts(webhookAttempts, botId).map(describeAttemptState),
        webhookInfo.url,
        webhookInfo.last_error_message,
        webhookInfo.pending_update_count,
      ],
      [['failed: cancelled', 'accepted'], REPLACEMENT_WEBHOOK_URL, undefined, 0],
      "Expected the old webhook's failure to leave the replacement without a delivery error",
    );
  } finally {
    endSession();
  }
});

Deno.test('a response that arrives after its attempt was cancelled is disposed of', async () => {
  const lateResponse = Promise.withResolvers<Response>();
  const bodyCancellation = Promise.withResolvers<void>();
  // The first webhook's sender ignores the request's signal and answers after the replacement.
  const fixture = createAcceptanceFixture((request) =>
    request.url === REPLACEMENT_WEBHOOK_URL ? new Response(null) : lateResponse.promise
  );
  const { botId, botUpdates, updateConsumers, webhookAttempts, endSession } = fixture;

  try {
    botUpdates.enqueueMessageUpdate(botId, createPrivateMessage(1));
    updateConsumers.setWebhook(botId, webhookRequest());
    await fixture.waitForRequestCount(1);
    updateConsumers.setWebhook(botId, { ...webhookRequest(), url: REPLACEMENT_WEBHOOK_URL });
    await fixture.waitForEntry({ kind: 'update_confirmed' });

    lateResponse.resolve(
      new Response(new ReadableStream({ cancel: () => bodyCancellation.resolve() })),
    );
    await bodyCancellation.promise;
    assertEquals(
      listAttempts(webhookAttempts, botId).map(describeAttemptState),
      ['cancelled', 'accepted'],
      'Expected the late response to change nothing and to have its body cancelled',
    );
  } finally {
    endSession();
  }
});

Deno.test('a sender that fails after its attempt was cancelled changes nothing', async () => {
  const lateFailure = Promise.withResolvers<Response>();
  const fixture = createAcceptanceFixture((request) =>
    request.url === REPLACEMENT_WEBHOOK_URL ? new Response(null) : lateFailure.promise
  );
  const { botId, botUpdates, updateConsumers, webhookAttempts, endSession } = fixture;

  try {
    botUpdates.enqueueMessageUpdate(botId, createPrivateMessage(1));
    updateConsumers.setWebhook(botId, webhookRequest());
    await fixture.waitForRequestCount(1);
    updateConsumers.deleteWebhook(botId, { dropPendingUpdates: false });
    // An unobserved rejection would fail the test.
    lateFailure.reject(new Error('The connection broke after the attempt ended'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    assertEquals(
      [
        listAttempts(webhookAttempts, botId).map(describeAttemptState),
        updateConsumers.getWebhookInfo(botId).last_error_message,
        updateConsumers.getWebhookInfo(botId).pending_update_count,
      ],
      [['cancelled'], undefined, 1],
      'Expected the late failure to be observed and ignored',
    );
  } finally {
    endSession();
  }
});

type AcceptanceFixture = ReturnType<typeof createAcceptanceFixture>;

/** Waits until the first attempt has reached `stage` of the webhook's answer. */
async function reachStage(
  stage: AnswerStage,
  fixture: AcceptanceFixture,
  bodyBeingRead: Promise<void>,
): Promise<void> {
  switch (stage) {
    case 'headers':
      await fixture.waitForRequestCount(1);
      return;
    case 'partial_body':
      await bodyBeingRead;
      return;
    case 'complete_body':
      await fixture.waitForEntry({ kind: 'update_confirmed' });
      return;
    case 'reply_execution':
      await fixture.waitForEntry({ kind: 'update_confirmed' });
      await fixture.heldReplies.waitForStartedCount(1);
      return;
  }
}

/** Stops the first attempt as `control` does, answering with the expiry's result for an expiry. */
async function applyControl(control: AttemptControl, fixture: AcceptanceFixture) {
  const { botId, updateConsumers, webhookAttempts } = fixture;
  switch (control) {
    case 'replacement':
      updateConsumers.setWebhook(botId, { ...webhookRequest(), url: REPLACEMENT_WEBHOOK_URL });
      return undefined;
    case 'deletion':
      updateConsumers.deleteWebhook(botId, { dropPendingUpdates: false });
      return undefined;
    case 'expiry':
      return await webhookAttempts.expireAttempt(botId, 1);
  }
}

/**
 * Replies whose methods are held in preparation until the test releases them, each then
 * recording its body as run.
 */
class HeldReplies {
  readonly finishedReplyBodies: string[] = [];
  #startedCount = 0;
  readonly #release = Promise.withResolvers<void>();
  readonly #countChanges = new Set<() => void>();

  start(reply: Response): void {
    this.#startedCount++;
    this.#notify();
    void (async () => {
      const body = await reply.text();
      await this.#release.promise;
      this.finishedReplyBodies.push(body);
      this.#notify();
    })();
  }

  releaseAll(): void {
    this.#release.resolve();
  }

  waitForStartedCount(count: number): Promise<void> {
    return this.#waitFor(() => this.#startedCount >= count);
  }

  waitForFinishedCount(count: number): Promise<void> {
    return this.#waitFor(() => this.finishedReplyBodies.length >= count);
  }

  #notify(): void {
    for (const notify of [...this.#countChanges]) {
      notify();
    }
  }

  #waitFor(condition: () => boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      const check = () => {
        if (condition()) {
          this.#countChanges.delete(check);
          clearTimeout(timeoutId);
          resolve();
        }
      };
      const timeoutId = setTimeout(() => {
        this.#countChanges.delete(check);
        reject(new Error('Expected the replies to get there within a second'));
      }, 1_000);
      this.#countChanges.add(check);
      check();
    });
  }
}

/**
 * Creates a webhook service for one bot, whose webhook requests `respond` answers in place of the
 * network, whose replies are held, and which records whether each accepted update's reply started
 * before its confirmation was recorded.
 */
function createAcceptanceFixture(
  respond: (request: Request) => Response | Promise<Response>,
) {
  const bots = new BotRepository();
  const virtualUsers = new VirtualUserService({
    identities: new TelegramIdentityRepository(),
    accounts: new AccountRepository(),
    bots,
  });
  const botId =
    createVirtualBot(virtualUsers, { first_name: 'Webhook Bot', username: 'webhook_bot' })
      .profile.id;
  const botUpdates = new BotUpdateRepository();
  const botActivity = new BotActivityService({
    log: new BotActivityLogRepository(),
    scheduler: createRealTimeScheduler(),
  });
  const webhookAttempts = new WebhookAttemptScheduler({
    bots,
    attemptTimeoutMilliseconds: WEBHOOK_ATTEMPT_TIMEOUT_MILLISECONDS,
    scheduler: createRealTimeScheduler(),
  });
  const heldReplies = new HeldReplies();
  const publications: Array<'reply_started' | 'update_confirmed'> = [];
  const receivedRequests: Array<{ readonly url: string; readonly updateId: number }> = [];
  const requestCounter = new ReceivedRequestCounter();
  const { updateConsumers, endSession } = createUpdateConsumers({
    botUpdates,
    updateActivity: {
      recordWebhookUpdateDelivery: (deliveryBotId, update, webhookAttemptId) =>
        botActivity.recordWebhookUpdateDelivery(deliveryBotId, update, webhookAttemptId),
      recordWebhookUpdateConfirmation: (
        deliveryBotId: number,
        update: BotApiUpdate,
        webhookAttemptId: number,
      ) => {
        publications.push('update_confirmed');
        botActivity.recordWebhookUpdateConfirmation(deliveryBotId, update, webhookAttemptId);
      },
      recordWebhookAttemptFailure: (failure) => botActivity.recordWebhookAttemptFailure(failure),
      recordUpdateDeliveries: (deliveryBotId, updates, via) =>
        botActivity.recordUpdateDeliveries(deliveryBotId, updates, via),
      recordUpdateConfirmations: (deliveryBotId, updates, via) =>
        botActivity.recordUpdateConfirmations(deliveryBotId, updates, via),
    },
    sendWebhookRequest: async (request) => {
      const { update_id: updateId } = await request.json();
      receivedRequests.push({ url: request.url, updateId });
      requestCounter.countRequest();
      return await respond(request);
    },
    startWebhookReply: (_botId, reply) => {
      publications.push('reply_started');
      heldReplies.start(reply);
    },
    attempts: webhookAttempts,
  });

  /** Resolves with the first matching entry, waiting up to a second for one to be recorded. */
  const waitForEntry = async (filter: BotActivityFilter): Promise<BotActivityEntry> => {
    const result = await botActivity.readEntries({
      after: 0,
      filter: { ...filter, botId },
      limit: 1,
      waitMilliseconds: 1_000,
    });
    const [entry] = result.read ? result.entries : [];
    if (entry === undefined) {
      throw new Error(`Expected an entry matching ${JSON.stringify(filter)} within a second`);
    }
    return entry;
  };

  return {
    botId,
    botUpdates,
    updateConsumers,
    endSession,
    webhookAttempts,
    heldReplies,
    publications,
    receivedRequests,
    waitForEntry,
    /** Resolves once the webhook has received `count` requests, failing after a second. */
    waitForRequestCount: (count: number) => requestCounter.waitForCount(count),
  };
}

function listAttempts(
  webhookAttempts: WebhookAttemptScheduler,
  botId: number,
): readonly WebhookAttempt[] {
  const result = webhookAttempts.listAttempts(botId);
  if (!result.found) {
    throw new Error(`Expected the bot's attempts to be listed, received ${result.reason}`);
  }
  return result.attempts;
}

/** The attempt's status, followed by its retry's for a failed attempt. */
function describeAttemptState(attempt: WebhookAttempt): string {
  return attempt.status === 'failed' ? `failed: ${attempt.retry.status}` : attempt.status;
}
