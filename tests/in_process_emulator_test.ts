import { Bot } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/bot.ts';
import { InputFile } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/types.ts';

import { createInProcessEmulator } from '../in_process/mod.ts';
import { createInProcessEmulatorWithHandler } from '../in_process/in_process_emulator.ts';
import {
  EmulationClientError,
  EmulationControlError,
  TelegramEmulationClient,
} from '../clients/typescript/mod.ts';
import { createEmulationApi } from '../src/api/mod.ts';
import type { SessionLifecycle } from '../src/api/sessions/mod.ts';
import { createSessionLifecycleService } from '../src/composition/session_lifecycle.ts';
import { type HttpRequestHandler, TelegramEmulationServer } from '../src/server.ts';
import { SYSTEM_MONOTONIC_CLOCK, TimerScheduler } from '../src/timing/system_timing.ts';

/** An emulator a test reaches through `client`, and whose bot reaches it through `fetch`. */
interface RunningEmulator extends AsyncDisposable {
  readonly client: TelegramEmulationClient;
  readonly fetch: typeof globalThis.fetch;
}

/** The ways of running the emulator that the shared behavior below must not tell apart. */
const EMULATOR_ADAPTERS: readonly { name: string; start: () => RunningEmulator }[] = [
  { name: 'in process', start: () => createInProcessEmulator() },
  { name: 'behind a real listener', start: startListeningEmulator },
];

for (const { name, start } of EMULATOR_ADAPTERS) {
  Deno.test(`An emulator ${name} answers a grammY bot that greets an account`, async () => {
    await using emulator = start();
    const { result: session, receipt: sessionReceipt } = await emulator.client.createSession();
    assertEqual(
      JSON.stringify(sessionReceipt),
      JSON.stringify({ sessionId: session.id, activityPosition: 0 }),
      'Expected the new session at position 0',
    );
    const { result: { token, bot: botProfile } } = await session.createBot({
      first_name: 'Greeter',
      username: 'greeter_bot',
    });
    const { result: { account } } = await session.createAccount({ first_name: 'Ada' });
    const bot = new Bot(token, { client: { apiRoot: session.botApiRoot, fetch: emulator.fetch } });
    bot.command('start', (ctx) =>
      ctx.reply(`Welcome, ${ctx.from?.first_name}!`, {
        reply_parameters: { message_id: ctx.msg.message_id },
      }));
    const polling = bot.start();
    polling.catch(() => {});

    try {
      const activity = session.botActivity({ bot_id: botProfile.id });
      const chat = { type: 'private', botId: botProfile.id } as const;
      const { result: command, receipt } = await account.sendMessage({ to: chat, text: '/start' });

      await activity.waitFor(
        {
          method: 'sendMessage',
          ok: true,
          parameters: { reply_parameters: JSON.stringify({ message_id: command.message_id }) },
        },
        { after: receipt },
      );
      const greeting = (await account.getMessages({ chat })).find(({ reply_to_message }) =>
        reply_to_message?.message_id === command.message_id
      );
      assertEqual(greeting?.text, 'Welcome, Ada!', 'Expected the bot to greet Ada');
    } finally {
      await bot.stop();
      await polling;
    }
  });

  Deno.test(`An emulator ${name} receives the files a grammY bot uploads`, async () => {
    await using emulator = start();
    const { result: session } = await emulator.client.createSession();
    const { result: { token, bot: botProfile } } = await session.createBot({
      first_name: 'Notes',
      username: 'notes_bot',
    });
    const { result: { account } } = await session.createAccount({ first_name: 'Ada' });
    const bot = new Bot(token, { client: { apiRoot: session.botApiRoot, fetch: emulator.fetch } });
    const chat = { type: 'private', botId: botProfile.id } as const;
    await account.sendMessage({ to: chat, text: '/start' });
    const notes = new TextEncoder().encode('Buy milk');

    const sent = await bot.api.sendDocument(account.id, new InputFile(notes, 'notes.txt'));

    assertEqual(sent.document.file_name, 'notes.txt', 'Expected the upload to keep its name');
    const downloaded = await session.downloadFile(sent.document.file_unique_id);
    assertEqual(
      new TextDecoder().decode(downloaded),
      'Buy milk',
      'Expected the uploaded content to be stored',
    );
    const received = (await account.getMessages({ chat })).at(-1);
    assertEqual(received?.document?.file_name, 'notes.txt', 'Expected Ada to receive the file');
  });

  Deno.test(`An emulator ${name} refuses control requests with their reasons`, async () => {
    await using emulator = start();
    const { result: session } = await emulator.client.createSession();
    await session.createBot({ first_name: 'Shop', username: 'shop_bot' });

    const refusal = await rejectionOf(
      session.createBot({ first_name: 'Other shop', username: 'Shop_Bot' }),
    );

    if (!(refusal instanceof EmulationControlError)) {
      throw new Error(`Expected a control error, received ${refusal}`);
    }
    assertEqual(
      JSON.stringify({ status: refusal.status, body: refusal.body }),
      JSON.stringify({ status: 409, body: { reason: 'username_taken' } }),
      'Expected the refusal with its status and reason',
    );
  });
}

Deno.test('Disposing of an in-process emulator ends its sessions and answers held requests', async () => {
  const emulator = createInProcessEmulator();
  const { result: session } = await emulator.client.createSession();
  const { result: { token } } = await session.createBot({
    first_name: 'Shop',
    username: 'shop_bot',
  });
  const heldPoll = emulator.fetch(`${session.botApiRoot}/bot${token}/getUpdates?timeout=30`);

  await emulator[Symbol.asyncDispose]();

  const heldPollResponse = await heldPoll;
  assertEqual(
    JSON.stringify({ status: heldPollResponse.status, body: await heldPollResponse.json() }),
    JSON.stringify({ status: 200, body: { ok: true, result: [] } }),
    'Expected the held long poll to be answered when its session ended',
  );
  const refusal = await rejectionOf(session.createAccount({ first_name: 'Ada' }));
  if (!(refusal instanceof EmulationClientError) || !(refusal.cause instanceof TypeError)) {
    throw new Error(`Expected the disposed emulator to refuse the request, received ${refusal}`);
  }
  await emulator[Symbol.asyncDispose]();
});

Deno.test('Disposing of an in-process emulator ends a session created while it was disposing', async () => {
  let sessionLifecycle: SessionLifecycle | undefined;
  const { promise: answeringAllowed, resolve: allowAnswering } = Promise.withResolvers<void>();
  const emulator = createInProcessEmulatorWithHandler((dependencies) => {
    sessionLifecycle = dependencies.sessionLifecycle;
    const api = createEmulationApi(dependencies);
    return async (request) => {
      await answeringAllowed;
      return await api.fetch(request);
    };
  });
  const creating = emulator.client.createSession();

  const disposing = emulator[Symbol.asyncDispose]();
  allowAnswering();
  await disposing;

  const { result: session } = await creating;
  if (sessionLifecycle?.getSessionById(session.id) !== undefined) {
    throw new Error('Expected the session created while disposing to have ended');
  }
});

Deno.test('An in-process emulator composed with session timing dates messages by it', async () => {
  const wallClock = { currentUnixTimeSeconds: () => 1_234_567_890 };
  await using emulator = createInProcessEmulatorWithHandler(
    (dependencies) => createEmulationApi(dependencies).fetch,
    {
      createSessionTiming: () => ({
        wallClock,
        scheduler: new TimerScheduler(SYSTEM_MONOTONIC_CLOCK),
      }),
    },
  );
  const { result: session } = await emulator.client.createSession();
  const { result: { bot } } = await session.createBot({
    first_name: 'Clock',
    username: 'clock_bot',
  });
  const { result: { account } } = await session.createAccount({ first_name: 'Ada' });
  const chat = { type: 'private', botId: bot.id } as const;
  await account.sendMessage({ to: chat, text: '/start' });

  const received = (await account.getMessages({ chat })).at(-1);
  assertEqual(received?.date, 1_234_567_890, "Expected the message dated by the session's clock");
});

Deno.test('An in-process request rejects with its signal reason once it aborts', async () => {
  await using emulator = createInProcessEmulator();
  const { result: session } = await emulator.client.createSession();
  const { result: { token } } = await session.createBot({
    first_name: 'Shop',
    username: 'shop_bot',
  });
  const abortController = new AbortController();
  const abortReason = new Error('The bot stopped');

  const poll = emulator.fetch(`${session.botApiRoot}/bot${token}/getUpdates?timeout=30`, {
    signal: abortController.signal,
  });
  abortController.abort(abortReason);

  assertEqual(await rejectionOf(poll), abortReason, 'Expected the abort reason');
  assertEqual(
    await rejectionOf(emulator.fetch(`${session.botApiRoot}/bot${token}/getMe`, {
      signal: abortController.signal,
    })),
    abortReason,
    'Expected an already aborted request to be refused unsent',
  );
});

Deno.test('An in-process request aborts with a signal that only resembles an AbortSignal', async () => {
  await using emulator = createInProcessEmulator();
  const { result: session } = await emulator.client.createSession();
  const { result: { token } } = await session.createBot({
    first_name: 'Shop',
    username: 'shop_bot',
  });
  // As the AbortController polyfill of Bot API clients built for Node.js gives.
  const polyfilledSignal = Object.assign(new EventTarget(), { aborted: false });

  const poll = emulator.fetch(`${session.botApiRoot}/bot${token}/getUpdates?timeout=30`, {
    signal: polyfilledSignal as unknown as AbortSignal,
  });
  polyfilledSignal.aborted = true;
  polyfilledSignal.dispatchEvent(new Event('abort'));

  const rejection = await rejectionOf(poll);
  if (!(rejection instanceof DOMException) || rejection.name !== 'AbortError') {
    throw new Error(`Expected the request to abort, received ${rejection}`);
  }
});

Deno.test('In-process requests let go of a reused polyfilled signal once they settle', async () => {
  await using emulator = createInProcessEmulator();
  const { result: session } = await emulator.client.createSession();
  const { result: { token } } = await session.createBot({
    first_name: 'Shop',
    username: 'shop_bot',
  });
  const reusedSignal = new ListenerTrackingSignal();

  const responses = await Promise.all(
    Array.from({ length: 20 }, () =>
      emulator.fetch(`${session.botApiRoot}/bot${token}/getMe`, {
        signal: reusedSignal as unknown as AbortSignal,
      })),
  );

  assertEqual(
    responses.every(({ status }) => status === 200),
    true,
    'Expected every request to be answered',
  );
  await Promise.all(responses.map((response) => response.body?.cancel()));
  assertEqual(reusedSignal.abortListenerCount, 0, 'Expected no abort listener to be left behind');
});

Deno.test('An in-process emulator names its public origin in the URLs it returns', async () => {
  await using defaultEmulator = createInProcessEmulator();
  await using namedEmulator = createInProcessEmulator({ publicOrigin: 'https://bots.example/' });

  const { result: defaultSession } = await defaultEmulator.client.createSession();
  const { result: namedSession } = await namedEmulator.client.createSession();

  assertEqual(
    new URL(defaultSession.botApiRoot).origin,
    'http://emulator.invalid',
    'Expected the default origin, which no network resolves',
  );
  assertEqual(
    new URL(namedSession.botApiRoot).origin,
    'https://bots.example',
    'Expected the given origin',
  );
});

Deno.test('An in-process emulator refuses a public origin that is not an origin', () => {
  for (
    const publicOrigin of ['emulator', 'ftp://emulator.example', 'http://emulator.example/api']
  ) {
    try {
      createInProcessEmulator({ publicOrigin });
    } catch (error) {
      if (error instanceof TypeError) continue;
      throw error;
    }
    throw new Error(`Expected ${publicOrigin} to be refused`);
  }
});

/** A signal like an `AbortController` polyfill's, which counts the abort listeners it holds. */
class ListenerTrackingSignal extends EventTarget {
  readonly aborted = false;
  readonly #abortListeners = new Set<EventListenerOrEventListenerObject>();

  get abortListenerCount(): number {
    return this.#abortListeners.size;
  }

  override addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: AddEventListenerOptions | boolean,
  ): void {
    if (type === 'abort' && listener !== null) this.#abortListeners.add(listener);
    super.addEventListener(type, listener, options);
  }

  override removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: EventListenerOptions | boolean,
  ): void {
    if (type === 'abort' && listener !== null) this.#abortListeners.delete(listener);
    super.removeEventListener(type, listener, options);
  }
}

/**
 * Serves the emulation API on a loopback port, as the standalone server does, for a client and a
 * bot that reach it over the network.
 */
function startListeningEmulator(): RunningEmulator {
  const sessionLifecycle = createSessionLifecycleService();
  let handleRequest: HttpRequestHandler = () => new Response(null, { status: 503 });
  const server = new TelegramEmulationServer({ hostname: '127.0.0.1', port: 0 }).start(
    (request) => handleRequest(request),
  );
  const publicOrigin = `http://${server.addr.hostname}:${server.addr.port}`;
  handleRequest = createEmulationApi({ sessionLifecycle, publicOrigin }).fetch;
  return {
    client: new TelegramEmulationClient(publicOrigin),
    fetch: globalThis.fetch,
    [Symbol.asyncDispose]: async () => {
      sessionLifecycle.endAllSessions();
      await server.shutdown();
    },
  };
}

async function rejectionOf(pending: Promise<unknown>): Promise<unknown> {
  try {
    await pending;
  } catch (error) {
    return error;
  }
  return undefined;
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
  }
}
