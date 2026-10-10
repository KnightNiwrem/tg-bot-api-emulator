import type { BotApiCallContext } from '../src/api/sessions/bot_api/method_call.ts';
import { findBotApiMethod } from '../src/api/sessions/bot_api/method_catalogue.ts';
import { callBotApiMethod } from '../src/api/sessions/bot_api/method_invocation.ts';
import { runWebhookReply } from '../src/api/sessions/bot_api/webhook_reply.ts';
import { createEmulationSession } from '../src/composition/emulation_session.ts';
import { FileRepository } from '../src/repositories/file.ts';
import {
  MediaFileService,
  type WebFileDownloadRequest,
  type WebFileDownloadResult,
} from '../src/services/media_file.ts';
import { createSystemSessionTiming } from '../src/timing/system_timing.ts';
import type { EmulationSession } from '../src/types/emulation_session.ts';
import { createTestSession, requestJson } from './support/emulation_api.ts';

const DOCUMENT_URL = 'https://files.example/report.pdf';

Deno.test('a webhook reply held in preparation commits nothing once its session ends', async () => {
  const fixture = createGateFixture();
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

  assertJson(
    [liveState, signalAbortedAtEnd, fixture.readState()],
    [
      { messageCount: 2, activityHead: 1 },
      true,
      { messageCount: 2, activityHead: 1 },
    ],
    "Expected the download's signal to abort at the end, and the late reply to change nothing",
  );
});

Deno.test('a Bot API call held in preparation is refused once its session ends', async () => {
  const fixture = createGateFixture();
  const method = findBotApiMethod('sendDocument');
  if (method === undefined) {
    throw new Error('Expected sendDocument to be implemented');
  }

  const call = callBotApiMethod({ ...fixture.replyContext, via: 'http' }, {
    method,
    requestedMethodName: 'sendDocument',
    parameters: { chat_id: String(fixture.adaId), document: DOCUMENT_URL },
    uploadedFiles: new Map(),
  });
  await fixture.downloads.waitForHeldDownload();
  fixture.session.end();
  fixture.downloads.releaseHeldDownload();

  assertJson(
    [await call, fixture.readState()],
    [{ answered: false, reason: 'session_ended' }, { messageCount: 1, activityHead: 0 }],
    'Expected the call to be refused without sending the document or being recorded',
  );
});

Deno.test('a Bot API call that starts after its session ended changes nothing', async () => {
  const fixture = createGateFixture();
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
  assertJson(
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

Deno.test('an HTTP Bot API request whose body arrives after its session ended is answered as for an unknown session', async () => {
  const { api, sessionPath } = await createTestSession();
  const { body: createdBot } = await requestJson<{ token: string }>(
    api,
    'POST',
    `${sessionPath}/bots`,
    { first_name: 'Test Bot', username: 'test_bot' },
  );
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

  assertJson(
    [deletion.status, response.status, await response.text()],
    [204, 404, ''],
    'Expected the call to be refused with a bodyless 404',
  );
});

Deno.test('ending a session answers its held long poll with no updates, and a later poll as an unknown session', async () => {
  const { api, sessionPath } = await createTestSession();
  const { body: createdBot } = await requestJson<{ token: string }>(
    api,
    'POST',
    `${sessionPath}/bots`,
    { first_name: 'Test Bot', username: 'test_bot' },
  );
  const botApiPath = `${sessionPath}/bot-api/bot${createdBot.token}`;
  const heldPoll = api.request(`${botApiPath}/getUpdates?timeout=50`);
  // The poll is decoded and held well within this wait, which its 50-second timeout outlasts.
  await new Promise((resolve) => setTimeout(resolve, 50));

  const deletion = await api.request(sessionPath, { method: 'DELETE' });
  const heldPollResponse = await heldPoll;
  const laterPollResponse = await api.request(`${botApiPath}/getUpdates`);
  assertJson(
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

/** Web file downloads that each wait for the test to release them, ignoring their signal. */
class HeldWebFileDownloads extends MediaFileService {
  readonly #source: MediaFileService;
  #heldDownload = Promise.withResolvers<AbortSignal | undefined>();
  #release = Promise.withResolvers<void>();

  constructor(source: MediaFileService) {
    super({
      files: new FileRepository(),
      uploadProfile: 'cloud',
      webFiles: { download: () => Promise.reject(new Error('Downloads go to the source')) },
    });
    this.#source = source;
  }

  override async downloadWebFile(request: WebFileDownloadRequest): Promise<WebFileDownloadResult> {
    this.#heldDownload.resolve(request.signal);
    await this.#release.promise;
    return await this.#source.downloadWebFile({ ...request, signal: undefined });
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
  const session = createEmulationSession(
    'commit-gate',
    { uploadProfile: 'cloud' },
    createSystemSessionTiming(),
  );
  const account = session.virtualUsers.createAccount({ first_name: 'Ada' });
  const bot = session.virtualUsers.createBot({ first_name: 'Test Bot', username: 'test_bot' });
  if (!account.created || !bot.created) {
    throw new Error('Expected the account and the bot to be created');
  }
  const adaId = account.account.profile.id;
  const botId = bot.bot.profile.id;
  const greeting = session.privateMessaging.sendAccountMessage({
    fromAccountId: adaId,
    to: { type: 'private', botId },
    content: { kind: 'text', text: 'Hello' },
  });
  const registration = session.webResources.registerWebResource({
    url: DOCUMENT_URL,
    status: 200,
    contentType: 'application/pdf',
    content: new TextEncoder().encode('%PDF-1.7'),
  });
  if (!greeting.sent || !registration.registered) {
    throw new Error('Expected the greeting to be sent and the document to be served');
  }
  const downloads = new HeldWebFileDownloads(session.mediaFiles);
  const replyContext: BotApiCallContext = {
    session: { ...session, mediaFiles: downloads },
    bot: bot.bot.profile,
    signal: session.lifetime.endSignal,
    via: 'webhook_reply',
  };
  return {
    session,
    adaId,
    bot: bot.bot.profile,
    downloads,
    replyContext,
    readState: () => readSessionState(session, adaId, botId),
  };
}

/** How many messages Ada's chat with the bot has, and the bot activity log's head position. */
function readSessionState(session: EmulationSession, accountId: number, botId: number) {
  const history = session.privateMessaging.getPrivateMessageHistory({ accountId, botId });
  return {
    messageCount: history.found ? history.messages.length : undefined,
    activityHead: session.botActivity.getHeadPosition(),
  };
}

function assertJson(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: received ${JSON.stringify(actual)}`);
  }
}
