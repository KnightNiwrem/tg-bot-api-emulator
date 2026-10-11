import { assertEquals } from '@std/assert';
import { assertEqualsInFieldOrder } from './support/field_order_assertion.ts';
import type { BotApiCallContext } from '../src/api/sessions/bot_api/method_call.ts';
import { findBotApiMethod } from '../src/api/sessions/bot_api/method_catalogue.ts';
import {
  callBotApiMethod,
  rejectUndecodableBotApiCall,
} from '../src/api/sessions/bot_api/method_invocation.ts';
import { runWebhookReply } from '../src/api/sessions/bot_api/webhook_reply.ts';
import { FileRepository } from '../src/repositories/file.ts';
import {
  MediaFileService,
  type WebFileDownloadRequest,
  type WebFileDownloadResult,
} from '../src/services/domain/media_file.ts';
import type { EmulationSession } from '../src/session/emulation_session.ts';
import { createTestSession } from './support/emulation_api.ts';
import { createBot } from './support/http_fixtures.ts';
import { buildSessionServices } from './support/session_services.ts';
import { createVirtualAccount, createVirtualBot } from './support/virtual_users.ts';

const DOCUMENT_URL = 'https://files.example/report.pdf';
const OTHER_DOCUMENT_URL = 'https://files.example/appendix.pdf';
const VOICE_NOTE_URL = 'https://files.example/memo.ogg';
const OTHER_VOICE_NOTE_URL = 'https://files.example/reply.ogg';

Deno.test('a webhook reply held in preparation commits nothing once its session ends', async () => {
  using fixture = createGateFixture();
  const reply = () =>
    Response.json({ method: 'sendDocument', chat_id: fixture.adaId, document: DOCUMENT_URL });

  // While the session is live, the same reply sends the document once its download is released.
  const liveReply = runWebhookReply(fixture.replyContext, reply());
  await fixture.downloads.waitForHeldDownload();
  fixture.downloads.releaseHeldDownload();
  await liveReply;
  const liveState = fixture.readState();

  const endedReply = runWebhookReply(fixture.replyContext, reply());
  const heldDownloadSignal = await fixture.downloads.waitForHeldDownload();
  fixture.session.end();
  const signalAbortedAtEnd = heldDownloadSignal?.aborted;
  // The download ignores its signal, as an uncooperative one would, and completes after the end.
  fixture.downloads.releaseHeldDownload();
  await endedReply;

  assertEquals(
    [liveState, signalAbortedAtEnd, fixture.readState()],
    [
      { messageCount: 2, activityHead: 1 },
      true,
      { messageCount: 2, activityHead: 1 },
    ],
    "Expected the download's signal to abort at the end, and the late reply to change nothing",
  );
});

/** A Bot API call that waits for downloads, and the download during which its session ends. */
interface DownloadingCall {
  readonly method: string;
  readonly parameters: (fixture: GateFixture) => Promise<Record<string, string>>;
  /** Which of the call's downloads, counted from 1, is running when the session ends. */
  readonly endingDownload: 1 | 2;
  /** Whether that download stops when the session ends, rather than ignoring the end. */
  readonly downloadHonorsSignal: boolean;
}

const VOICE_NOTE_BLOCKS = JSON.stringify({
  blocks: [VOICE_NOTE_URL, OTHER_VOICE_NOTE_URL].map((media) => ({
    type: 'voice_note',
    voice_note: { type: 'voice_note', media },
  })),
});

/** Every kind of wait a downloading method has: a single download, and each of a loop's. */
const DOWNLOADING_CALLS: readonly DownloadingCall[] = [
  {
    method: 'sendDocument',
    parameters: (fixture) => Promise.resolve(fixture.documentParameters()),
    endingDownload: 1,
    downloadHonorsSignal: false,
  },
  {
    method: 'sendDocument',
    parameters: (fixture) => Promise.resolve(fixture.documentParameters()),
    endingDownload: 1,
    downloadHonorsSignal: true,
  },
  ...([1, 2] as const).map((endingDownload) => ({
    method: 'sendMediaGroup',
    parameters: (fixture: GateFixture) =>
      Promise.resolve({
        chat_id: String(fixture.adaId),
        media: JSON.stringify([DOCUMENT_URL, OTHER_DOCUMENT_URL].map((media) => ({
          type: 'document',
          media,
        }))),
      }),
    endingDownload,
    downloadHonorsSignal: false,
  })),
  ...([1, 2] as const).map((endingDownload) => ({
    method: 'sendRichMessage',
    parameters: (fixture: GateFixture) =>
      Promise.resolve({ chat_id: String(fixture.adaId), rich_message: VOICE_NOTE_BLOCKS }),
    endingDownload,
    downloadHonorsSignal: false,
  })),
  {
    method: 'editMessageText',
    parameters: async (fixture) => ({
      chat_id: String(fixture.adaId),
      message_id: String(await fixture.sendLiveText()),
      rich_message: VOICE_NOTE_BLOCKS,
    }),
    endingDownload: 2,
    downloadHonorsSignal: true,
  },
  {
    method: 'editMessageMedia',
    parameters: async (fixture) => ({
      chat_id: String(fixture.adaId),
      message_id: String(await fixture.sendLiveDocument()),
      media: JSON.stringify({ type: 'document', media: OTHER_DOCUMENT_URL }),
    }),
    endingDownload: 1,
    downloadHonorsSignal: false,
  },
];

for (const call of DOWNLOADING_CALLS) {
  const { method, endingDownload, downloadHonorsSignal } = call;
  const downloadBehavior = downloadHonorsSignal ? 'stops' : 'ignores the end';
  Deno.test(`${method} is refused when its session ends during download ${endingDownload}, which ${downloadBehavior}`, async () => {
    using fixture = createGateFixture();
    const parameters = await call.parameters(fixture);
    const stateBefore = fixture.readState();
    fixture.downloads.honorsSignal = downloadHonorsSignal;

    const outcome = fixture.call(method, parameters);
    for (let download = 1; download < endingDownload; download++) {
      await fixture.downloads.waitForHeldDownload();
      fixture.downloads.releaseHeldDownload();
    }
    await fixture.downloads.waitForHeldDownload();
    const startedBeforeEnd = fixture.downloads.startedDownloadCount;
    fixture.session.end();
    fixture.downloads.releaseHeldDownload();

    assertEquals(
      [
        await outcome,
        fixture.downloads.startedDownloadCount - startedBeforeEnd,
        fixture.readState(),
      ],
      [{ answered: false, reason: 'session_ended' }, 0, stateBefore],
      'Expected the call to start no download after the end, and to change and record nothing',
    );
  });
}

Deno.test('getUpdates is answered with no updates at each of its waits the session end interrupts', async () => {
  using held = createGateFixture();
  // The offset confirms Ada's greeting as the poll arrives; the poll is then held.
  const heldPoll = held.call('getUpdates', { offset: '2', timeout: '50' });
  const stateWhileHeld = held.readState();
  held.session.end();

  using undecodable = createGateFixture();
  undecodable.session.end();
  const getUpdates = findBotApiMethod('getUpdates');
  if (getUpdates === undefined) {
    throw new Error('Expected getUpdates to be implemented');
  }
  const undecodableOutcome = rejectUndecodableBotApiCall(
    { ...undecodable.replyContext, via: 'http' },
    getUpdates,
    'getUpdates',
    'Bad Request: invalid JSON',
  );

  const noUpdates = { answered: true, answer: { status: 200, body: { ok: true, result: [] } } };
  assertEqualsInFieldOrder(
    [await heldPoll, undecodableOutcome, held.readState(), undecodable.readState()],
    [noUpdates, noUpdates, stateWhileHeld, { messageCount: 1, activityHead: 0 }],
    'Expected each poll to be answered with no updates and to record nothing',
  );
});

Deno.test('a Bot API call that starts after its session ended changes nothing', async () => {
  using fixture = createGateFixture();
  const method = findBotApiMethod('setMyDescription');
  if (method === undefined) {
    throw new Error('Expected setMyDescription to be implemented');
  }
  fixture.session.end();

  const outcome = await callBotApiMethod({ ...fixture.replyContext, via: 'http' }, {
    method,
    requestedMethodName: 'setMyDescription',
    parameters: { description: 'Changed after the end' },
    uploadedFiles: new Map(),
  });
  assertEquals(
    [
      outcome,
      fixture.session.botApi.getMyDescription(fixture.bot, {
        kind: 'description',
        languageCode: '',
      }),
      fixture.readState().activityHead,
    ],
    [{ answered: false, reason: 'session_ended' }, { found: true, text: '' }, 0],
    'Expected the call to be refused before it changed or recorded anything',
  );
});

Deno.test('a long poll that starts after its session ended finds no updates and confirms none', async () => {
  using fixture = createGateFixture();
  const method = findBotApiMethod('getUpdates');
  if (method === undefined) {
    throw new Error('Expected getUpdates to be implemented');
  }
  fixture.session.end();

  const outcome = await callBotApiMethod({ ...fixture.replyContext, via: 'http' }, {
    method,
    requestedMethodName: 'getUpdates',
    // The offset would confirm Ada's message, which is pending, and a live poll would return it.
    parameters: { offset: '2', timeout: '50' },
    uploadedFiles: new Map(),
  });
  const webhookInfo = fixture.session.botApi.getWebhookInfo(fixture.bot);
  assertEqualsInFieldOrder(
    [outcome, webhookInfo.pending_update_count],
    [{ answered: true, answer: { status: 200, body: { ok: true, result: [] } } }, 1],
    'Expected the poll to be answered at once without reading or confirming its update',
  );
});

Deno.test('an HTTP Bot API request whose body arrives after its session ended is answered as for an unknown session', async () => {
  await using testSession = await createTestSession();
  const { api, sessionPath } = testSession;
  const createdBot = await createBot(api, sessionPath, 'test_bot');
  const body = new TransformStream<Uint8Array, Uint8Array>();
  const bodyWriter = body.writable.getWriter();
  const pendingResponse = api.request(
    `${sessionPath}/bot-api/bot${createdBot.token}/setMyDescription`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body.readable,
    },
  );
  await bodyWriter.write(new TextEncoder().encode('{"description":'));

  const deletion = await api.request(sessionPath, { method: 'DELETE' });
  await bodyWriter.write(new TextEncoder().encode('"Too late"}'));
  await bodyWriter.close();
  const response = await pendingResponse;

  assertEquals(
    [deletion.status, response.status, await response.text()],
    [204, 404, ''],
    'Expected the call to be refused with a bodyless 404',
  );
});

Deno.test('ending a session answers its held long poll with no updates, and a later poll as an unknown session', async () => {
  await using testSession = await createTestSession();
  const { api, sessionPath } = testSession;
  const { botApiPath } = await createBot(api, sessionPath, 'test_bot');
  const heldPoll = api.request(`${botApiPath}/getUpdates?timeout=50`);
  // The poll is decoded and held well within this wait, which its 50-second timeout outlasts.
  await new Promise((resolve) => setTimeout(resolve, 50));

  const deletion = await api.request(sessionPath, { method: 'DELETE' });
  const heldPollResponse = await heldPoll;
  const laterPollResponse = await api.request(`${botApiPath}/getUpdates`);
  assertEqualsInFieldOrder(
    [
      deletion.status,
      heldPollResponse.status,
      await heldPollResponse.json(),
      laterPollResponse.status,
      await laterPollResponse.text(),
    ],
    [204, 200, { ok: true, result: [] }, 404, ''],
    'Expected the held poll to find nothing, and the later poll to find no session',
  );
});

/**
 * Web file downloads that each wait for the test to release them. They ignore their signal, as an
 * uncooperative download would, unless `honorsSignal` is set: then an aborted download fails as
 * `WebFileDownloader` fails one, with its content unavailable.
 */
class HeldWebFileDownloads extends MediaFileService {
  readonly #source: MediaFileService;
  #heldDownload = Promise.withResolvers<AbortSignal | undefined>();
  #release = Promise.withResolvers<void>();
  honorsSignal = false;
  startedDownloadCount = 0;

  constructor(source: MediaFileService) {
    super({
      files: new FileRepository(),
      uploadProfile: 'cloud',
      webFiles: { download: () => Promise.reject(new Error('Downloads go to the source')) },
    });
    this.#source = source;
  }

  override async downloadWebFile(request: WebFileDownloadRequest): Promise<WebFileDownloadResult> {
    this.startedDownloadCount++;
    this.#heldDownload.resolve(request.signal);
    const abort = Promise.withResolvers<void>();
    if (this.honorsSignal) {
      request.signal?.addEventListener('abort', () => abort.resolve(), { once: true });
    }
    const isReleased = await Promise.race([
      this.#release.promise.then(() => true),
      abort.promise.then(() => false),
    ]);
    return isReleased
      ? await this.#source.downloadWebFile({ ...request, signal: undefined })
      : { downloaded: false, reason: 'web_content_unavailable' };
  }

  /** Resolves with the signal of the next held download once it starts. */
  waitForHeldDownload(): Promise<AbortSignal | undefined> {
    return this.#heldDownload.promise;
  }

  releaseHeldDownload(): void {
    this.#release.resolve();
    this.#heldDownload = Promise.withResolvers();
    this.#release = Promise.withResolvers();
  }
}

/**
 * Creates a session in which Ada has written to a bot, with a call context for the bot whose web
 * file downloads wait for the test, and a PDF document the bot can send by URL.
 */
function createGateFixture() {
  const session = buildSessionServices({ id: 'commit-gate' });
  const adaId = createVirtualAccount(session.virtualUsers, { first_name: 'Ada' }).profile.id;
  const bot = createVirtualBot(session.virtualUsers, {
    first_name: 'Test Bot',
    username: 'test_bot',
  });
  const botId = bot.profile.id;
  const greeting = session.messageSending.sendAccountPrivateChatMessage({
    fromAccountId: adaId,
    chat: { type: 'private', peerId: botId },
    content: { kind: 'text', text: 'Hello' },
  });
  const registrations = [
    ...[DOCUMENT_URL, OTHER_DOCUMENT_URL].map((url) => ({ url, contentType: 'application/pdf' })),
    ...[VOICE_NOTE_URL, OTHER_VOICE_NOTE_URL].map((url) => ({ url, contentType: 'audio/ogg' })),
  ].map(({ url, contentType }) =>
    session.webResources.registerWebResource({
      url,
      status: 200,
      contentType,
      content: new TextEncoder().encode('%PDF-1.7'),
    })
  );
  if (!greeting.sent || !registrations.every(({ registered }) => registered)) {
    throw new Error('Expected the greeting to be sent and the files to be served');
  }
  const downloads = new HeldWebFileDownloads(session.mediaFiles);
  const replyContext: BotApiCallContext = {
    session: { ...session, mediaFiles: downloads },
    bot: bot.profile,
    signal: session.lifetime.endSignal,
    via: 'webhook_reply',
  };
  /** Calls a method over HTTP, as far as the call's context goes, while downloads are held. */
  const call = (methodName: string, parameters: Record<string, string>) => {
    const method = findBotApiMethod(methodName);
    if (method === undefined) {
      throw new Error(`Expected ${methodName} to be implemented`);
    }
    return callBotApiMethod({ ...replyContext, via: 'http' }, {
      method,
      requestedMethodName: methodName,
      parameters,
      uploadedFiles: new Map(),
    });
  };
  /** Sends a message while the session is live, releasing its download, and returns its ID. */
  const sendLive = async (methodName: string, parameters: Record<string, string>) => {
    const outcome = call(methodName, parameters);
    if (methodName === 'sendDocument') {
      await downloads.waitForHeldDownload();
      downloads.releaseHeldDownload();
    }
    const result = await outcome;
    if (!result.answered || !result.answer.body.ok) {
      throw new Error(`Expected ${methodName} to succeed: ${JSON.stringify(result)}`);
    }
    const message = result.answer.body.result;
    if (typeof message !== 'object' || message === null || !('message_id' in message)) {
      throw new Error(`Expected ${methodName} to answer with a message`);
    }
    return Number(message.message_id);
  };
  const documentParameters = () => ({ chat_id: String(adaId), document: DOCUMENT_URL });
  return {
    session,
    adaId,
    bot: bot.profile,
    downloads,
    replyContext,
    call,
    documentParameters,
    sendLiveDocument: () => sendLive('sendDocument', documentParameters()),
    sendLiveText: () => sendLive('sendMessage', { chat_id: String(adaId), text: 'Draft' }),
    readState: () => readSessionState(session, adaId, botId),
    [Symbol.dispose]: () => session[Symbol.dispose](),
  };
}

type GateFixture = ReturnType<typeof createGateFixture>;

/** How many messages Ada's chat with the bot has, and the bot activity log's head position. */
function readSessionState(session: EmulationSession, accountId: number, botId: number) {
  const history = session.privateMessaging.getPrivateMessageHistory({ accountId, botId });
  return {
    messageCount: history.found ? history.messages.length : undefined,
    activityHead: session.botActivity.getHeadPosition(),
  };
}
