/**
 * The TypeScript client's account actions send every field their input gives, so that a field the
 * operation does not take, from a JavaScript caller or a widened object, reaches the emulator and
 * is refused as `invalid_request`, rather than dropped and the action done without it. Each shape
 * of façade is covered: an input sent as it is, one whose value the façade converts, one whose
 * fields it renames, and one part of which names the path.
 */
import { assertEquals, assertRejects } from '@std/assert';

import {
  type AccountPollInput,
  EmulationClientError,
  EmulationControlError,
  type PrivateMessageTarget,
} from '../clients/typescript/mod.ts';
import { createTestInProcessEmulator } from './support/emulation_api.ts';
import { gifImage } from './support/media_samples.ts';

/** A field no account action takes. */
const UNKNOWN_FIELD = { nickname: 'Ada' };

/** The input of an action, widened with a field the action does not take. */
function withUnknownField<Input extends object>(input: Input): Input {
  return { ...input, ...UNKNOWN_FIELD };
}

async function assertRefusedAsInvalid(action: () => Promise<unknown>, label: string) {
  const error = await assertRejects(action, EmulationControlError, undefined, label);
  assertEquals(
    { status: error.status, reason: error.body.reason },
    { status: 400, reason: 'invalid_request' },
    `Expected ${label} refused as invalid`,
  );
}

async function createAccountFixture() {
  await using disposalOnFailure = new AsyncDisposableStack();
  const api = disposalOnFailure.use(createTestInProcessEmulator());
  const { result: session } = await api.client.createSession();
  const { result: { account } } = await session.createAccount({
    first_name: 'Ada',
    phone_number: '15550100',
  });
  const { result: created } = await session.createBot({
    first_name: 'Test Bot',
    username: 'test_bot',
  });
  const chat: PrivateMessageTarget = { type: 'private', botId: created.bot.id };
  const emulatorDisposal = disposalOnFailure.move();
  return {
    account,
    chat,
    [Symbol.asyncDispose]: () => emulatorDisposal.disposeAsync(),
  };
}

Deno.test('An account action refuses a field it does not take, whatever its façade does', async () => {
  await using fixture = await createAccountFixture();
  const { account, chat } = fixture;
  const { result: sent } = await account.sendMessage({ to: chat, text: 'Hello' });
  const { result: poll } = await account.sendPoll({
    to: chat,
    poll: { question: 'Lunch?', options: [{ text: 'Pizza' }, { text: 'Pasta' }] },
  });
  const historyBefore = await account.getMessages({ chat });

  await assertRefusedAsInvalid(
    () =>
      account.sendPoll(withUnknownField({
        to: chat,
        poll: { question: 'Dinner?', options: [{ text: 'Soup' }, { text: 'Salad' }] },
      })),
    'a poll with an unknown field',
  );
  await assertRefusedAsInvalid(
    () => account.sendMessage(withUnknownField({ to: chat, text: 'Hello again' })),
    'a message sent as given with an unknown field',
  );
  await assertRefusedAsInvalid(
    () => account.sendPhoto(withUnknownField({ to: chat, photo: gifImage(1, 1) })),
    'a photo, whose content the façade converts, with an unknown field',
  );
  await assertRefusedAsInvalid(
    () =>
      account.sendMediaGroup(withUnknownField({
        to: chat,
        media: [{ photo: gifImage(1, 1) }, { photo: gifImage(2, 2) }],
      })),
    'an album with an unknown field',
  );
  await assertRefusedAsInvalid(
    () => account.shareOwnContact(withUnknownField({ to: chat })),
    'an own contact with an unknown field',
  );
  await assertRefusedAsInvalid(
    () =>
      account.forwardMessage(withUnknownField({
        from: chat,
        message_id: sent.message_id,
        to: chat,
      })),
    'a forward, whose fields the façade renames, with an unknown field',
  );
  await assertRefusedAsInvalid(
    () =>
      account.editMessage(withUnknownField({
        chat,
        message_id: sent.message_id,
        text: 'Edited',
      })),
    'an edit, part of which names the path, with an unknown field',
  );
  await assertRefusedAsInvalid(
    () =>
      account.sendMediaGroup({
        to: chat,
        media: [withUnknownField({ photo: gifImage(1, 1) }), { photo: gifImage(2, 2) }],
      }),
    'an album item with an unknown field',
  );
  await assertRefusedAsInvalid(
    () =>
      account.answerPoll(withUnknownField({
        chat,
        message_id: poll.message_id,
        option_ids: [0],
      })),
    'a poll answer with an unknown field',
  );

  assertEquals(
    await account.getMessages({ chat }),
    historyBefore,
    'Expected no refused action to change the chat',
  );
});

Deno.test('An account action sends a value its input leaves out as left out', async () => {
  await using fixture = await createAccountFixture();
  const { account, chat } = fixture;
  const quizWithoutCorrectOptions = {
    question: 'Capital of France?',
    options: [{ text: 'Paris' }, { text: 'Lyon' }],
    type: 'quiz',
  } as unknown as AccountPollInput;

  const quizRefusal = await assertRejects(
    () => account.sendPoll({ to: chat, poll: quizWithoutCorrectOptions }),
    EmulationControlError,
  );
  const pressRefusal = await assertRejects(
    () => account.pressReplyKeyboardButton({ chat, text: 'Quiz', poll: quizWithoutCorrectOptions }),
    EmulationControlError,
  );
  const { result: album } = await account.sendMediaGroup({
    to: chat,
    media: [{ photo: gifImage(1, 1), caption: 'One' }, { photo: gifImage(2, 2) }],
  });

  assertEquals(
    quizRefusal.body.reason,
    'quiz_correct_options_missing',
    'Expected a quiz without correct options refused by the emulator',
  );
  assertEquals(
    pressRefusal.status,
    400,
    'Expected a press with such a quiz answered by the emulator, not refused by the client',
  );
  assertEquals(
    album.map(({ caption, caption_entities }) => ({ caption, caption_entities })),
    [{ caption: 'One', caption_entities: undefined }, {
      caption: undefined,
      caption_entities: undefined,
    }],
    'Expected an album whose media leave out their entities sent without them',
  );
});

Deno.test('An upload that is no bytes is refused by the client, which converts it', async () => {
  await using fixture = await createAccountFixture();
  const { account, chat } = fixture;
  await account.sendMessage({ to: chat, text: 'Hello' });
  const historyBefore = await account.getMessages({ chat });
  // Text that is itself valid base64, which the emulator would read as a file.
  const base64Text = 'YQ==' as unknown as Uint8Array;

  const refusals = [
    await assertRejects(
      () => account.sendDocument({ to: chat, document: base64Text, file_name: 'a.txt' }),
      EmulationClientError,
    ),
    await assertRejects(
      () =>
        account.sendMediaGroup({
          to: chat,
          media: [{ photo: gifImage(1, 1) }, { photo: base64Text }],
        }),
      EmulationClientError,
    ),
  ];

  assertEquals(
    refusals.map((error) => ({
      sent: error instanceof EmulationControlError,
      namesField: ['document', 'media[1].photo'].some((field) =>
        error.message.includes(`${field} must be the file's bytes`)
      ),
    })),
    [{ sent: false, namesField: true }, { sent: false, namesField: true }],
    'Expected each upload refused before sending, naming its field',
  );
  assertEquals(
    await account.getMessages({ chat }),
    historyBefore,
    'Expected no refused upload to change the chat',
  );
});
