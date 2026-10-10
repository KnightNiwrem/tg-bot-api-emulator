import type { BotApiCallContext } from '../src/api/sessions/bot_api/method_call.ts';
import { findBotApiMethod } from '../src/api/sessions/bot_api/method_catalogue.ts';
import { callBotApiMethod } from '../src/api/sessions/bot_api/method_invocation.ts';
import { runWebhookReply } from '../src/api/sessions/bot_api/webhook_reply.ts';
import { createEmulationSession } from '../src/composition/emulation_session.ts';
import { createSystemSessionTiming } from '../src/timing/system_timing.ts';

const WEBHOOK_URL = 'http://127.0.0.1:9/webhook';

Deno.test('a webhook reply naming a get method runs nothing and is not recorded', async () => {
  await withWebhookBot(async ({ runReplies }) => {
    const recordedCalls = await runReplies([
      // Implemented methods, in any letter case and by an older name.
      Response.json({ method: 'getMe' }),
      Response.json({ method: 'GETME' }),
      Response.json({ method: 'GetWebhookInfo' }),
      Response.json({ method: 'getUpdates' }),
      Response.json({ method: 'getChatMembersCount', chat_id: 1 }),
      // Methods the emulator does not implement, and the bare prefix.
      Response.json({ method: 'getNoSuchMethod' }),
      Response.json({ method: 'GETBUSINESSCONNECTION', business_connection_id: 'b' }),
      Response.json({ method: 'get' }),
    ]);
    assertJson(recordedCalls, [], 'Expected no get method to run from a webhook reply');
  });
});

Deno.test('a webhook reply cannot change the webhook or end the bot session', async () => {
  await withWebhookBot(async ({ runReplies, readWebhookUrl }) => {
    const recordedCalls = await runReplies([
      Response.json({ method: 'setWebhook', url: '' }),
      Response.json({ method: 'SETWEBHOOK', url: 'http://127.0.0.1:9/other' }),
      Response.json({ method: 'deleteWebhook' }),
      Response.json({ method: 'DeleteWebhook', drop_pending_updates: true }),
      // Not implemented, but ignored all the same rather than answered as unknown methods.
      Response.json({ method: 'close' }),
      Response.json({ method: 'CLOSE' }),
      Response.json({ method: 'logOut' }),
      Response.json({ method: 'logout' }),
    ]);
    assertJson(
      [recordedCalls, await readWebhookUrl()],
      [[], WEBHOOK_URL],
      'Expected the webhook to stay set and no reply to be recorded',
    );
  });
});

Deno.test('a webhook reply runs other methods and records unknown ones', async () => {
  await withWebhookBot(async ({ runReplies }) => {
    const recordedCalls = await runReplies([
      Response.json({ method: 'DELETEMYCOMMANDS' }),
      Response.json({ method: 'kickChatMember' }),
      // Names that only start like an excluded one are not excluded.
      Response.json({ method: 'closeForumTopic', chat_id: 1, message_thread_id: 2 }),
      Response.json({ method: 'logOutEverywhere' }),
      Response.json({ method: 'setWebhooks' }),
      Response.json({ method: 'notAMethod' }),
    ]);
    assertJson(
      recordedCalls,
      [
        ['deleteMyCommands', 'DELETEMYCOMMANDS', 200],
        ['banChatMember', 'kickChatMember', 400],
        ['closeForumTopic', 'closeForumTopic', 404],
        ['logOutEverywhere', 'logOutEverywhere', 404],
        ['setWebhooks', 'setWebhooks', 404],
        ['notAMethod', 'notAMethod', 404],
      ],
      'Expected every reply to run, or be answered as unknown, and be recorded',
    );
  });
});

Deno.test('a webhook reply that names no method or cannot be decoded is not recorded', async () => {
  await withWebhookBot(async ({ runReplies }) => {
    const recordedCalls = await runReplies([
      Response.json({ chat_id: 1, text: 'No method' }),
      Response.json({ method: '' }),
      new Response('{', { headers: { 'Content-Type': 'application/json' } }),
    ]);
    assertJson(recordedCalls, [], 'Expected no reply to be recorded');
  });
});

interface WebhookBotFixture {
  /**
   * Runs each reply as a webhook's response to an update, in order, and answers with the calls
   * they recorded: each one's current and requested method names and answer status.
   */
  readonly runReplies: (replies: readonly Response[]) => Promise<unknown[]>;
  /** Reads the bot's webhook URL through an HTTP `getWebhookInfo` call. */
  readonly readWebhookUrl: () => Promise<unknown>;
}

/** Runs `test` against a fresh session holding a bot with a webhook, and ends the session. */
async function withWebhookBot(test: (fixture: WebhookBotFixture) => Promise<void>): Promise<void> {
  const session = createEmulationSession(
    'webhook-reply-eligibility',
    { uploadProfile: 'cloud' },
    createSystemSessionTiming(),
  );
  try {
    const creation = session.virtualUsers.createBot({
      first_name: 'Test Bot',
      username: 'test_bot',
    });
    if (!creation.created) {
      throw new Error(`Expected the bot to be created: ${creation.reason}`);
    }
    const replyContext: BotApiCallContext = {
      session,
      bot: creation.bot.profile,
      signal: new AbortController().signal,
      via: 'webhook_reply',
    };
    const callOverHttp = async (methodName: string, parameters: Record<string, string>) => {
      const method = findBotApiMethod(methodName);
      if (method === undefined) {
        throw new Error(`Expected ${methodName} to be implemented`);
      }
      const { body } = await callBotApiMethod({ ...replyContext, via: 'http' }, {
        method,
        requestedMethodName: methodName,
        parameters,
        uploadedFiles: new Map(),
      });
      if (!body.ok) {
        throw new Error(`Expected ${methodName} to succeed: ${body.description}`);
      }
      return body.result;
    };
    await callOverHttp('setWebhook', { url: WEBHOOK_URL });

    await test({
      runReplies: async (replies) => {
        const start = session.botActivity.getHeadPosition();
        for (const reply of replies) {
          await runWebhookReply(replyContext, reply);
        }
        const read = await session.botActivity.readEntries({
          after: start,
          filter: {},
          limit: 100,
          waitMilliseconds: 0,
        });
        if (!read.read) {
          throw new Error(`Expected the bot activity to be read: ${read.reason}`);
        }
        return read.entries.map((entry) => {
          if (entry.kind !== 'bot_api_call' || entry.via !== 'webhook_reply') {
            throw new Error(`Expected only webhook reply calls, found ${JSON.stringify(entry)}`);
          }
          const { method, requestedMethod, answer } = entry;
          return [method, requestedMethod, answer.ok ? 200 : answer.error_code];
        });
      },
      readWebhookUrl: async () => {
        const webhookInfo = await callOverHttp('getWebhookInfo', {});
        return typeof webhookInfo === 'object' && webhookInfo !== null && 'url' in webhookInfo
          ? webhookInfo.url
          : webhookInfo;
      },
    });
  } finally {
    session.end();
  }
}

function assertJson(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: received ${JSON.stringify(actual)}`);
  }
}
