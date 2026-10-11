/**
 * How a send method reads `reply_parameters`, as the official Bot API server's
 * `get_reply_parameters` does: once it is given, even as empty text, it alone decides the reply, and
 * text it cannot read as JSON is refused with the server's description.
 */
import { assertEquals } from '@std/assert';

import { callBotApi } from '../support/bot_api_requests.ts';
import { createPrivateConversationFixture } from '../support/http_fixtures.ts';

interface SentMessage {
  readonly message_id: number;
  readonly reply_to_message?: { readonly message_id: number };
}

Deno.test('Empty reply_parameters text replies to nothing, overriding reply_to_message_id', async () => {
  await using fixture = await createPrivateConversationFixture();
  await fixture.sendText('/start');
  const chatId = fixture.createdAccount.account.id;
  const sendMessage = async (parameters: Record<string, unknown>) => {
    const { status, body } = await callBotApi(fixture.api, `${fixture.botApiPath}/sendMessage`, {
      chat_id: chatId,
      ...parameters,
    });
    return {
      status,
      body: body as { readonly result?: SentMessage; readonly description?: string },
    };
  };
  const first = await sendMessage({ text: 'First' });
  const firstMessageId = first.body.result?.message_id;

  const legacyReply = await sendMessage({ text: 'Reply', reply_to_message_id: firstMessageId });
  const overriddenReply = await sendMessage({
    text: 'No reply',
    reply_parameters: '',
    reply_to_message_id: firstMessageId,
  });
  const unparsable = await sendMessage({ text: 'Hi', reply_parameters: 'not JSON' });

  assertEquals(
    {
      legacyReply: [legacyReply.status, legacyReply.body.result?.reply_to_message?.message_id],
      overriddenReply: [
        overriddenReply.status,
        overriddenReply.body.result?.reply_to_message?.message_id,
      ],
      unparsable: [unparsable.status, unparsable.body.description],
    },
    {
      legacyReply: [200, firstMessageId],
      overriddenReply: [200, undefined],
      unparsable: [400, "Bad Request: can't parse reply parameters JSON object"],
    },
    'Expected empty reply_parameters to specify no reply, and unparsable text refused',
  );
});
