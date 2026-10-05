import { Bot } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/bot.ts';
import { GrammyError } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/core/error.ts';
import { InputFile } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/types.ts';
import { run } from '@grammyjs/runner/runner.ts';

import { createEmulationApi } from '../src/api/mod.ts';
import { createSessionLifecycleService } from '../src/composition/session_lifecycle.ts';
import { TelegramEmulationClient } from '../clients/typescript/mod.ts';

/** A 2×1 GIF, small enough to spell out and an image the emulator reads dimensions from. */
const RECEIPT_IMAGE = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 2, 0, 1, 0, 0, 0, 0]);
const PROCESSED_RECEIPT = new TextEncoder().encode('Receipt total: 12.50');

// Follows "Replying to a photo with a document" in docs/clients/typescript/media-and-files.md,
// whose snippet `deno task check` type-checks.
Deno.test('the walkthrough photo step reads the delayed bot reply, not the upload or other activity', async () => {
  const { session, fetch, createdBot, ada, grace } = await createFixture();
  const botId = createdBot.bot.id;
  const chat = { type: 'private', botId } as const;
  const photoHandling = Promise.withResolvers<void>();
  const grammyBot = new Bot(createdBot.token, {
    client: { apiRoot: session.botApiRoot, fetch },
  });
  grammyBot.on('message:photo', async (context) => {
    // Held until the test has read the chat, so the reply cannot exist when it reads.
    await photoHandling.promise;
    // Activity the wait must skip: another method, another chat, a failed call, and a document
    // that replies to nothing, all in the account's chat and after the photo where they can. The
    // text acknowledgement also replies to the photo, so the selection must skip it too.
    await context.reply('Processing your receipt', {
      reply_parameters: { message_id: context.message.message_id },
    });
    await context.replyWithChatAction('upload_document');
    await context.api.sendDocument(grace.id, new InputFile(PROCESSED_RECEIPT, 'audit.txt'));
    await context.replyWithDocument('unknown-file-id').catch((error: unknown) => {
      if (!(error instanceof GrammyError)) throw error;
    });
    await context.replyWithDocument(new InputFile(new TextEncoder().encode('Terms'), 'terms.txt'));
    await context.replyWithDocument(new InputFile(PROCESSED_RECEIPT, 'receipt.txt'), {
      reply_parameters: { message_id: context.message.message_id },
    });
  });
  const activity = session.botActivity({ bot_id: botId });
  // A bot may send a document only to an account that has started a chat with it.
  await grace.sendMessage({ to: chat, text: 'Hello!' });
  const runner = run(grammyBot);

  try {
    const beforePhoto = await activity.position();
    const photo = await ada.sendPhoto({ to: chat, photo: RECEIPT_IMAGE, caption: 'My receipt' });
    const latestBeforeHandling = (await ada.getMessages({ chat })).at(-1);
    photoHandling.resolve();

    const replyCall = await activity.waitFor(
      {
        method: 'sendDocument',
        chat_id: ada.id,
        ok: true,
        parameters: { reply_parameters: JSON.stringify({ message_id: photo.message_id }) },
      },
      { after: beforePhoto },
    );
    const photoReply = (await ada.getMessages({ chat })).find(
      ({ from, reply_to_message, document }) =>
        from.id === botId && reply_to_message?.message_id === photo.message_id &&
        document !== undefined,
    );
    if (photoReply?.document === undefined) {
      throw new Error('Expected the bot to reply to the photo with a document');
    }
    const replyContent = await session.downloadFile(photoReply.document.file_unique_id);

    if (latestBeforeHandling?.message_id !== photo.message_id) {
      throw new Error('Expected the latest message to be the upload while the bot is held');
    }
    const [chatAction, otherChatDocument, failedDocument, unrepliedDocument] = await Promise.all([
      activity.waitFor({ method: 'sendChatAction', chat_id: ada.id }, { after: beforePhoto }),
      activity.waitFor({ method: 'sendDocument', chat_id: grace.id }, { after: beforePhoto }),
      activity.waitFor(
        { method: 'sendDocument', chat_id: ada.id, ok: false },
        { after: beforePhoto },
      ),
      activity.waitFor(
        { method: 'sendDocument', chat_id: ada.id, ok: true },
        { after: beforePhoto },
      ),
    ]);
    const unrelatedCalls = [chatAction, otherChatDocument, failedDocument, unrepliedDocument];
    if (
      unrelatedCalls.some(({ position }) => position > replyCall.position) ||
      unrepliedDocument.uploaded_files[0]?.file_name !== 'terms.txt'
    ) {
      throw new Error('Expected unrelated calls, including another document, before the reply');
    }
    if (
      replyCall.uploaded_files[0]?.file_name !== 'receipt.txt' ||
      photoReply.document.file_name !== 'receipt.txt' ||
      replyContent.toBase64() !== PROCESSED_RECEIPT.toBase64()
    ) {
      throw new Error('Expected the wait and the selection to find the bot reply to the photo');
    }
  } finally {
    photoHandling.resolve();
    await runner.stop();
    await session.end();
  }
});

async function createFixture() {
  const publicOrigin = 'http://emulator.example:9000';
  const api = createEmulationApi({
    sessionLifecycle: createSessionLifecycleService(),
    publicOrigin,
  });
  const fetch = createInProcessFetch(api.fetch);
  const session = await new TelegramEmulationClient(publicOrigin, { fetch }).createSession();
  const createdBot = await session.createBot({
    first_name: 'Receipt Bot',
    username: 'receipt_bot',
  });
  const { account: ada } = await session.createAccount({ first_name: 'Ada' });
  const { account: grace } = await session.createAccount({ first_name: 'Grace' });
  return { session, fetch, createdBot, ada, grace };
}

function createInProcessFetch(
  handler: (request: Request) => Response | Promise<Response>,
): typeof globalThis.fetch {
  return async (input, init) => await handler(new Request(input, init));
}
