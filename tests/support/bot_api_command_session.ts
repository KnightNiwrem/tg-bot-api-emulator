/**
 * A session composed as the server composes it, through `buildSessionServices()`, with the seams
 * that tests of Bot API commands need: calling a method as a bot does, a webhook reply whose body
 * arrives only when released, a recorder that fails after a command has staged its changes, and
 * reads that record nothing.
 */
import type { BotApiCallContext } from '../../src/api/sessions/bot_api/method_call.ts';
import { findBotApiMethod } from '../../src/api/sessions/bot_api/method_catalogue.ts';
import { callBotApiMethod } from '../../src/api/sessions/bot_api/method_invocation.ts';
import { runWebhookReply } from '../../src/api/sessions/bot_api/webhook_reply.ts';
import type { BotApiCallAnswer } from '../../src/types/bot_activity.ts';
import type { VirtualBotProfile } from '../../src/types/virtual_bot.ts';
import { buildSessionServices } from './session_services.ts';
import { createVirtualAccount, createVirtualBot } from './virtual_users.ts';

/** The error a failing recorder throws. */
export const FAILED_RECORDING_MESSAGE = 'The recording failed';

/** A webhook's response naming a method, whose body arrives only once the test releases it. */
export class HeldWebhookReply {
  readonly response: Response;
  readonly #body: Uint8Array;
  #controller: ReadableStreamDefaultController<Uint8Array> | undefined;

  constructor(parameters: Readonly<Record<string, string>>) {
    this.#body = new TextEncoder().encode(JSON.stringify(parameters));
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.#controller = controller;
      },
    });
    this.response = new Response(stream, { headers: { 'Content-Type': 'application/json' } });
  }

  release(): void {
    this.#controller?.enqueue(this.#body);
    this.#controller?.close();
  }
}

/**
 * A fresh session, named for the test that uses it, with helpers to drive and read it. Disposing
 * of it, as `using` does, ends the session.
 */
export function createBotApiCommandSession(id: string) {
  const session = buildSessionServices({ id });
  const callContext = (bot: VirtualBotProfile): BotApiCallContext => ({
    session,
    bot,
    signal: session.lifetime.endSignal,
    via: 'http',
  });

  /** Calls a method as the bot does over HTTP, and returns its outcome, whatever it is. */
  const callMethod = async (
    bot: VirtualBotProfile,
    methodName: string,
    parameters: Readonly<Record<string, string>>,
  ) => {
    const method = findBotApiMethod(methodName);
    if (method === undefined) {
      throw new Error(`Expected ${methodName} to be implemented`);
    }
    return await callBotApiMethod(callContext(bot), {
      method,
      requestedMethodName: methodName,
      parameters,
      uploadedFiles: new Map(),
    });
  };

  return {
    session,
    createAccount: (firstName: string) =>
      createVirtualAccount(session.virtualUsers, { first_name: firstName }).profile.id,
    /** Creates a bot that reads every message of its supergroups. */
    createBot: (username: string) =>
      createVirtualBot(session.virtualUsers, {
        first_name: username,
        username,
        can_read_all_group_messages: true,
      }).profile,
    callMethod,
    /** Calls a method that must succeed, and returns its result. */
    callMethodExpectingResult: async (
      bot: VirtualBotProfile,
      methodName: string,
      parameters: Readonly<Record<string, string>>,
    ): Promise<unknown> => {
      const outcome = await callMethod(bot, methodName, parameters);
      if (!outcome.answered || !outcome.answer.body.ok) {
        throw new Error(`Expected ${methodName} to succeed: ${JSON.stringify(outcome)}`);
      }
      return outcome.answer.body.result;
    },
    /**
     * Runs the bot's webhook reply once the test releases its body, which names `method` and its
     * parameters; until then the call is still being prepared.
     */
    holdWebhookReply: (bot: VirtualBotProfile, parameters: Readonly<Record<string, string>>) => {
      const reply = new HeldWebhookReply(parameters);
      const replying = runWebhookReply(
        { ...callContext(bot), via: 'webhook_reply' },
        reply.response,
      );
      return {
        release: async () => {
          reply.release();
          await replying;
        },
      };
    },
    /**
     * Makes recording each Bot API call fail until the returned function is called. A call's record
     * is the last write of its transaction, so a call then fails after its command staged every
     * change it makes.
     */
    failCallRecording: (): () => void => {
      const { botActivity } = session;
      const recordBotApiCall = botActivity.recordBotApiCall.bind(botActivity);
      botActivity.recordBotApiCall = () => {
        throw new Error(FAILED_RECORDING_MESSAGE);
      };
      return () => {
        botActivity.recordBotApiCall = recordBotApiCall;
      };
    },
    /** The answer of the last call the session recorded, or `null` when it recorded none. */
    lastRecordedAnswer: async (): Promise<BotApiCallAnswer | null> => {
      const reading = await session.botActivity.readEntries({
        after: session.botActivity.getHeadPosition() - 1,
        filter: { kind: 'bot_api_call' },
        limit: 1,
        waitMilliseconds: 0,
      });
      const [entry] = reading.read ? reading.entries : [];
      return entry?.kind === 'bot_api_call' ? entry.answer : null;
    },
    /** How many updates wait for each bot, as `getWebhookInfo` reports them. */
    countPendingUpdates: (bots: readonly VirtualBotProfile[]) =>
      bots.map((bot) => session.botApi.getWebhookInfo(bot).pending_update_count),
    [Symbol.dispose]: () => session[Symbol.dispose](),
  };
}

/** The session of `createBotApiCommandSession`. */
export type BotApiCommandSession = ReturnType<typeof createBotApiCommandSession>;
