import { Bot } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/bot.ts';
import { run } from '@grammyjs/runner/runner.ts';
import { parse as parseYaml } from '@std/yaml';
import { z } from 'zod';
import reactionTypeEmojiYaml from '../openapi/components/schemas/ReactionTypeEmoji.yaml' with {
  type: 'text',
};

import { createEmulationApi } from '../src/api/mod.ts';
import { createSessionLifecycleService } from '../src/composition/session_lifecycle.ts';
import { REACTION_EMOJIS } from '../src/types/message_reaction.ts';
import {
  EmulationClientError,
  type EmulationSessionClient,
  type SupergroupMessageTarget,
  TelegramEmulationClient,
  type VirtualAccountClient,
} from '../clients/typescript/mod.ts';

const PUBLIC_ORIGIN = 'http://emulator.example:9000';
/** A 2 by 1 GIF image, whose header is all the emulator reads. */
const IMAGE = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 2, 0, 1, 0, 0, 0, 0]);

Deno.test('a grammY bot answers an account reaction with a reaction of its own', async () => {
  const fixture = await createReactionFixture();
  const { session, fetch, owner, ada, adminBot, team } = fixture;
  const allowedUpdates = ['message', 'message_reaction'] as const;
  // The subscription applies when updates are created, so it is chosen before the bot starts.
  await readUpdates(fixture, adminBot, allowedUpdates);
  const grammyBot = new Bot(adminBot.token, { client: { apiRoot: session.botApiRoot, fetch } });
  grammyBot.reaction('👍', (context) => context.react('👌'));
  const activity = session.botActivity({ bot_id: adminBot.id });
  const start = await activity.position();
  const runner = run(grammyBot, { runner: { fetch: { allowed_updates: allowedUpdates } } });

  try {
    const proposal = await owner.sendMessage({ to: team, text: 'Ship the release?' });
    const reacted = await ada.setMessageReaction({
      chat: team,
      message_id: proposal.message_id,
      reaction: [{ type: 'emoji', emoji: '👍' }],
    });
    expectEqual(
      reacted.reactions,
      [{ user_id: ada.id, reaction: [{ type: 'emoji', emoji: '👍' }] }],
      'Expected the account reaction to be recorded',
    );

    await activity.waitFor({
      method: 'setMessageReaction',
      chat_id: team.chatId,
      parameters: { message_id: String(proposal.message_id) },
    }, { after: start });
    const reactions = await owner.getMessageReactions({
      chat: team,
      message_id: proposal.message_id,
    });
    expectEqual(
      [reactions.message.message_id, reactions.reactions],
      [proposal.message_id, [
        { user_id: ada.id, reaction: [{ type: 'emoji', emoji: '👍' }] },
        { user_id: adminBot.id, reaction: [{ type: 'emoji', emoji: '👌' }] },
      ]],
      "Expected the bot's answering reaction to be inspectable beside the account's",
    );
  } finally {
    await runner.stop();
    await session.end();
  }
});

Deno.test('message_reaction updates reach only subscribed administrator bots, once per change', async () => {
  const fixture = await createReactionFixture();
  const { session, owner, ada, adminBot, team } = fixture;
  try {
    const memberBot = await addBot(fixture, 'member_bot', { promote: false });
    const unsubscribedBot = await addBot(fixture, 'unsubscribed_bot', { promote: true });
    const otherAdminBot = await addBot(fixture, 'other_admin_bot', { promote: true });
    for (const bot of [adminBot, memberBot, otherAdminBot]) {
      await readUpdates(fixture, bot, ['message_reaction']);
    }
    await readUpdates(fixture, unsubscribedBot, []);
    const message = await owner.sendMessage({ to: team, text: 'Standup at ten' });
    const key = { chat: team, message_id: message.message_id };

    await ada.setMessageReaction({ ...key, reaction: [{ type: 'emoji', emoji: '👍' }] });
    await ada.setMessageReaction({ ...key, reaction: [{ type: 'emoji', emoji: '👍' }] });
    await ada.setMessageReaction({ ...key, reaction: [{ type: 'emoji', emoji: '❤' }] });
    await ada.removeMessageReaction(key);
    await ada.removeMessageReaction(key);
    expectEqual(
      await callBotApi(fixture, adminBot, 'setMessageReaction', {
        chat_id: team.chatId,
        message_id: message.message_id,
        reaction: [{ type: 'emoji', emoji: '🔥' }],
      }),
      { ok: true, result: true },
      'Expected the bot reaction to succeed',
    );

    const adminUpdates = await readUpdates(fixture, adminBot);
    const chat = { id: team.chatId, title: 'Team', type: 'supergroup' };
    // Accounts are shown as messages show them.
    const user = { first_name: 'Ada', id: ada.id, is_bot: false };
    const expected = [
      [[], [{ type: 'emoji', emoji: '👍' }]],
      [[{ type: 'emoji', emoji: '👍' }], [{ type: 'emoji', emoji: '❤' }]],
      [[{ type: 'emoji', emoji: '❤' }], []],
    ].map(([oldReaction, newReaction]) => ({
      chat,
      message_id: message.message_id,
      user,
      date: 'any',
      old_reaction: oldReaction,
      new_reaction: newReaction,
    }));
    expectEqual(
      adminUpdates.map((update) => ({ ...update.message_reaction, date: 'any' })),
      expected,
      'Expected one update per change, with the fields in the official order',
    );
    if (adminUpdates.some((update) => typeof update.message_reaction?.date !== 'number')) {
      throw new Error('Expected every update to carry a date');
    }
    expectEqual(
      (await readUpdates(fixture, otherAdminBot)).map((update) => update.message_reaction),
      adminUpdates.map((update) => update.message_reaction),
      'Expected every subscribed administrator bot to receive the same updates',
    );
    expectEqual(
      [
        (await readUpdates(fixture, memberBot)).length,
        (await readUpdates(fixture, unsubscribedBot)).length,
      ],
      [0, 0],
      'Expected a non-administrator bot and an unsubscribed one to receive nothing',
    );
  } finally {
    await session.end();
  }
});

Deno.test('rejected reactions leave reactions and updates unchanged', async () => {
  const fixture = await createReactionFixture();
  const { session, owner, ada, adminBot, team } = fixture;
  try {
    const { account: outsider } = await session.createAccount({ first_name: 'Outsider' });
    const message = await owner.sendMessage({ to: team, text: 'Keep it civil' });
    const serviceMessage = (await owner.getMessages({ chat: team })).find((candidate) =>
      candidate.new_chat_members !== undefined
    );
    if (serviceMessage === undefined) {
      throw new Error('Expected a service message recording a member joining');
    }
    await readUpdates(fixture, adminBot, ['message_reaction']);
    const key = { chat: team, message_id: message.message_id };
    const thumbsUp = [{ type: 'emoji', emoji: '👍' }] as const;

    const accountRefusals: readonly [() => Promise<unknown>, number, string][] = [
      [
        () => ada.setMessageReaction({ ...key, reaction: [{ type: 'emoji', emoji: '❤️' }] }),
        400,
        'a heart with a variation selector',
      ],
      [
        () => ada.setMessageReaction({ ...key, reaction: [{ type: 'emoji', emoji: '🦆' }] }),
        400,
        'an emoji Telegram does not list',
      ],
      [
        () =>
          ada.setMessageReaction({
            ...key,
            reaction: [...thumbsUp, { type: 'emoji', emoji: '🔥' }],
          }),
        400,
        'two reactions',
      ],
      [() => ada.setMessageReaction({ ...key, reaction: [] }), 400, 'an empty reaction'],
      [
        () =>
          ada.setMessageReaction({
            chat: team,
            message_id: serviceMessage.message_id,
            reaction: thumbsUp,
          }),
        400,
        'a reaction to a service message',
      ],
      [
        () => ada.setMessageReaction({ chat: team, message_id: 999, reaction: thumbsUp }),
        404,
        'a missing message',
      ],
      [
        () =>
          ada.setMessageReaction({
            chat: { type: 'supergroup', chatId: -1_000_000_009_999 },
            message_id: 1,
            reaction: thumbsUp,
          }),
        404,
        'a missing supergroup',
      ],
      [
        () => outsider.setMessageReaction({ ...key, reaction: thumbsUp }),
        403,
        'a reaction from a non-member',
      ],
      [() => outsider.getMessageReactions(key), 403, 'an inspection by a non-member'],
      [() => outsider.removeMessageReaction(key), 403, 'a removal by a non-member'],
    ];
    for (const [request, status, description] of accountRefusals) {
      await expectRefused(request(), status, description);
    }
    const invalidBody = await fixture.fetch(
      `${PUBLIC_ORIGIN}/sessions/${session.id}/accounts/${ada.id}/conversations/supergroup/${team.chatId}/messages/${message.message_id}/reactions`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reaction: [{ type: 'emoji', emoji: '👍', is_big: true }] }),
      },
    );
    expectEqual(invalidBody.status, 400, 'Expected an unknown reaction field to be rejected');
    await invalidBody.body?.cancel();

    await owner.setChatPermissions({ chat: team, permissions: { can_send_messages: true } });
    await expectRefused(
      ada.setMessageReaction({ ...key, reaction: thumbsUp }),
      403,
      'a reaction without can_react_to_messages',
    );
    await owner.setChatPermissions({
      chat: team,
      permissions: { can_send_messages: true, can_react_to_messages: true },
    });

    const botCalls: readonly [Record<string, unknown>, string][] = [
      [
        { chat_id: team.chatId, message_id: message.message_id, reaction: '[' },
        "Bad Request: can't parse reaction types JSON object",
      ],
      [
        { chat_id: team.chatId, message_id: message.message_id, reaction: '{}' },
        'Bad Request: expected an Array of ReactionType',
      ],
      [
        { chat_id: team.chatId, message_id: message.message_id, reaction: ['👍'] },
        "Bad Request: can't parse ReactionType: expected an Object",
      ],
      [
        { chat_id: team.chatId, message_id: message.message_id, reaction: [{ emoji: '👍' }] },
        'Bad Request: can\'t parse ReactionType: Can\'t find field "type"',
      ],
      [
        { chat_id: team.chatId, message_id: message.message_id, reaction: [{ type: 'emoji' }] },
        'Bad Request: can\'t parse ReactionType: Can\'t find field "emoji"',
      ],
      [
        { chat_id: team.chatId, message_id: message.message_id, reaction: [{ type: 'paid' }] },
        "Bad Request: can't parse ReactionType: invalid reaction type specified",
      ],
      [{
        chat_id: team.chatId,
        message_id: message.message_id,
        reaction: [{ type: 'emoji', emoji: '' }],
      }, 'Bad Request: invalid reaction type specified'],
      [{
        chat_id: team.chatId,
        message_id: message.message_id,
        reaction: [{ type: 'emoji', emoji: 7 }],
      }, 'Bad Request: invalid setMessageReaction parameters'],
      [{
        chat_id: team.chatId,
        message_id: message.message_id,
        reaction: [{ type: 'custom_emoji', custom_emoji_id: '5368324170671202286' }],
      }, 'Bad Request: REACTION_INVALID'],
      [{ message_id: message.message_id, reaction: thumbsUp }, 'Bad Request: chat_id is empty'],
      [
        { chat_id: ada.id, message_id: 1, reaction: thumbsUp },
        'Bad Request: reactions in private chats are not supported',
      ],
      [
        { chat_id: -1_000_000_009_999, message_id: 1, reaction: thumbsUp },
        'Bad Request: chat not found',
      ],
      [{ chat_id: team.chatId, reaction: thumbsUp }, 'Bad Request: message to react not found'],
      [
        { chat_id: team.chatId, message_id: 999, reaction: thumbsUp },
        'Bad Request: message to react not found',
      ],
      [
        { chat_id: team.chatId, message_id: serviceMessage.message_id, reaction: thumbsUp },
        'Bad Request: REACTION_INVALID',
      ],
      [{
        chat_id: team.chatId,
        message_id: message.message_id,
        reaction: [{ type: 'emoji', emoji: '🦆' }],
      }, 'Bad Request: REACTION_INVALID'],
      [{
        chat_id: team.chatId,
        message_id: message.message_id,
        reaction: [...thumbsUp, { type: 'emoji', emoji: '🔥' }],
      }, 'Bad Request: REACTIONS_TOO_MANY'],
    ];
    for (const [parameters, description] of botCalls) {
      expectEqual(
        await callBotApi(fixture, adminBot, 'setMessageReaction', parameters),
        { ok: false, error_code: 400, description },
        `Expected setMessageReaction ${JSON.stringify(parameters)} to be refused`,
      );
    }
    const memberBot = await addBot(fixture, 'restricted_bot', { promote: false });
    await owner.setChatPermissions({ chat: team, permissions: { can_send_messages: true } });
    expectEqual(
      await callBotApi(fixture, memberBot, 'setMessageReaction', {
        chat_id: team.chatId,
        message_id: message.message_id,
        reaction: thumbsUp,
      }),
      { ok: false, error_code: 403, description: 'Forbidden: CHAT_WRITE_FORBIDDEN' },
      'Expected a bot without can_react_to_messages to be refused',
    );
    await owner.removeChatMember({ chat: team, userId: memberBot.id });
    expectEqual(
      await callBotApi(fixture, memberBot, 'setMessageReaction', {
        chat_id: team.chatId,
        message_id: message.message_id,
        reaction: thumbsUp,
      }),
      {
        ok: false,
        error_code: 403,
        description: 'Forbidden: bot was kicked from the supergroup chat',
      },
      'Expected a removed bot to be refused',
    );

    expectEqual(
      (await owner.getMessageReactions(key)).reactions,
      [],
      'Expected no refused reaction to be recorded',
    );
    expectEqual(await readUpdates(fixture, adminBot), [], 'Expected no update for refusals');
  } finally {
    await session.end();
  }
});

Deno.test('album reactions go to the first message that is not deleted', async () => {
  const fixture = await createReactionFixture();
  const { session, owner, ada, adminBot, team } = fixture;
  try {
    await readUpdates(fixture, adminBot, ['message_reaction']);
    const album = await ada.sendMediaGroup({
      to: team,
      media: [{ photo: IMAGE, caption: 'Front' }, { photo: IMAGE }, { photo: IMAGE }],
    });
    const [first, second, third] = album.map((message) => message.message_id);

    const throughThird = await owner.setMessageReaction({
      chat: team,
      message_id: third,
      reaction: [{ type: 'emoji', emoji: '😍' }],
    });
    expectEqual(
      await callBotApi(fixture, adminBot, 'setMessageReaction', {
        chat_id: team.chatId,
        message_id: second,
        reaction: [{ type: 'emoji', emoji: '👀' }],
      }),
      { ok: true, result: true },
      'Expected the bot reaction to an album member to succeed',
    );
    const throughSecond = await ada.getMessageReactions({ chat: team, message_id: second });
    expectEqual(
      [throughThird.message.message_id, throughSecond.message.message_id, throughSecond.reactions],
      [first, first, [
        { user_id: owner.id, reaction: [{ type: 'emoji', emoji: '😍' }] },
        { user_id: adminBot.id, reaction: [{ type: 'emoji', emoji: '👀' }] },
      ]],
      "Expected the album's first message to hold every reaction",
    );
    expectEqual(
      (await readUpdates(fixture, adminBot)).map((update) => update.message_reaction?.message_id),
      [first],
      'Expected the update to name the message that holds the reaction',
    );

    await ada.deleteMessage({ chat: team, message_id: first });
    const afterDeletion = await ada.getMessageReactions({ chat: team, message_id: third });
    expectEqual(
      [afterDeletion.message.message_id, afterDeletion.reactions],
      [second, []],
      "Expected the deleted message's reactions to go with it, and the next one to hold reactions",
    );
    await ada.setMessageReaction({
      chat: team,
      message_id: third,
      reaction: [{ type: 'emoji', emoji: '🎉' }],
    });
    expectEqual(
      (await readUpdates(fixture, adminBot)).map((update) => update.message_reaction?.message_id),
      [second],
      'Expected the next reaction to go to the first remaining message',
    );
    await expectRefused(
      ada.getMessageReactions({ chat: team, message_id: first }),
      404,
      'an inspection of a deleted message',
    );
  } finally {
    await session.end();
  }
});

Deno.test('reactions stay inside their session', async () => {
  const api = createEmulationApi({
    sessionLifecycle: createSessionLifecycleService(),
    publicOrigin: PUBLIC_ORIGIN,
  });
  const first = await createReactionFixture(api);
  const second = await createReactionFixture(api);
  try {
    // Sessions number their chats and messages alike, so both have the same IDs.
    const firstMessage = await first.owner.sendMessage({ to: first.team, text: 'First session' });
    const secondMessage = await second.owner.sendMessage({
      to: second.team,
      text: 'Second session',
    });
    expectEqual(
      [second.team.chatId, secondMessage.message_id],
      [first.team.chatId, firstMessage.message_id],
      'Expected both sessions to number the supergroup and message alike',
    );
    const onlyFirst = await first.owner.createSupergroup({ title: 'Only in the first session' });
    const onlyFirstChat = { type: 'supergroup', chatId: onlyFirst.id } as const;
    await first.owner.addChatMember({ chat: onlyFirstChat, userId: first.adminBot.id });
    const onlyFirstMessage = await first.owner.sendMessage({ to: onlyFirstChat, text: 'Hidden' });
    await readUpdates(second, second.adminBot, ['message_reaction']);

    for (
      const [chat, messageId] of [[first.team, firstMessage.message_id], [
        onlyFirstChat,
        onlyFirstMessage.message_id,
      ]] as const
    ) {
      await first.owner.setMessageReaction({
        chat,
        message_id: messageId,
        reaction: [{ type: 'emoji', emoji: '👍' }],
      });
    }

    expectEqual(
      (await second.ada.getMessageReactions({
        chat: second.team,
        message_id: secondMessage.message_id,
      })).reactions,
      [],
      'Expected a reaction in one session not to show under the same IDs in another',
    );
    expectEqual(
      await readUpdates(second, second.adminBot),
      [],
      "Expected another session's bots to receive nothing",
    );
    await expectRefused(
      second.owner.getMessageReactions({
        chat: onlyFirstChat,
        message_id: onlyFirstMessage.message_id,
      }),
      404,
      'a supergroup of another session',
    );
    expectEqual(
      await callBotApi(second, second.adminBot, 'setMessageReaction', {
        chat_id: onlyFirst.id,
        message_id: onlyFirstMessage.message_id,
        reaction: [{ type: 'emoji', emoji: '👍' }],
      }),
      { ok: false, error_code: 400, description: 'Bad Request: chat not found' },
      "Expected a bot not to reach another session's supergroup",
    );
  } finally {
    await first.session.end();
    await second.session.end();
  }
});

Deno.test('the OpenAPI reaction emoji list is the list the server accepts', () => {
  const schema = z.object({
    properties: z.object({ emoji: z.object({ enum: z.array(z.string()) }) }),
  })
    .parse(parseYaml(reactionTypeEmojiYaml));
  expectEqual(
    schema.properties.emoji.enum,
    REACTION_EMOJIS,
    'Expected ReactionTypeEmoji.yaml to list REACTION_EMOJIS',
  );
});

interface FixtureBot {
  readonly id: number;
  readonly token: string;
}

interface ReactionFixture {
  readonly session: EmulationSessionClient;
  readonly fetch: typeof globalThis.fetch;
  readonly owner: VirtualAccountClient;
  readonly ada: VirtualAccountClient;
  readonly adminBot: FixtureBot;
  readonly team: SupergroupMessageTarget;
}

/** A supergroup owned by an account, with a second account and an administrator bot. */
async function createReactionFixture(
  api = createEmulationApi({
    sessionLifecycle: createSessionLifecycleService(),
    publicOrigin: PUBLIC_ORIGIN,
  }),
): Promise<ReactionFixture> {
  const fetch: typeof globalThis.fetch = async (input, init) =>
    await api.fetch(new Request(input, init));
  const session = await new TelegramEmulationClient(PUBLIC_ORIGIN, { fetch }).createSession();
  const { account: owner } = await session.createAccount({ first_name: 'Owner' });
  const { account: ada } = await session.createAccount({ first_name: 'Ada' });
  const supergroup = await owner.createSupergroup({ title: 'Team' });
  const team: SupergroupMessageTarget = { type: 'supergroup', chatId: supergroup.id };
  await owner.addChatMember({ chat: team, userId: ada.id });
  const fixture = { session, fetch, owner, ada, team };
  const adminBot = await addBot(fixture, 'reaction_bot', { promote: true });
  return { ...fixture, adminBot };
}

/** Creates a bot and adds it to the fixture's supergroup, as an administrator if asked. */
async function addBot(
  { session, owner, team }: Pick<ReactionFixture, 'session' | 'owner' | 'team'>,
  username: string,
  { promote }: { readonly promote: boolean },
): Promise<FixtureBot> {
  const created = await session.createBot({ first_name: 'Reaction Bot', username });
  await owner.addChatMember({ chat: team, userId: created.bot.id });
  if (promote) {
    await owner.promoteChatMember({
      chat: team,
      userId: created.bot.id,
      rights: { can_delete_messages: true },
    });
  }
  return { id: created.bot.id, token: created.token };
}

async function callBotApi(
  { session, fetch }: Pick<ReactionFixture, 'session' | 'fetch'>,
  bot: FixtureBot,
  method: string,
  parameters: Record<string, unknown>,
): Promise<unknown> {
  const response = await fetch(`${session.botApiRoot}/bot${bot.token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(parameters),
  });
  return await response.json();
}

const pendingUpdatesSchema = z.object({
  ok: z.literal(true),
  result: z.array(z.looseObject({
    update_id: z.int(),
    message_reaction: z.looseObject({ message_id: z.int(), date: z.int() }).optional(),
  })),
});

/**
 * Reads and confirms a bot's pending updates and returns its `message_reaction` updates, changing
 * its subscription when `allowedUpdates` is given; an empty list restores the default one.
 */
async function readUpdates(
  fixture: Pick<ReactionFixture, 'session' | 'fetch'>,
  bot: FixtureBot,
  allowedUpdates?: readonly string[],
) {
  const answer = await callBotApi(fixture, bot, 'getUpdates', {
    timeout: 0,
    ...(allowedUpdates === undefined ? {} : { allowed_updates: allowedUpdates }),
  });
  // The schema checks the answer's shape; the answer itself keeps the server's field order.
  pendingUpdatesSchema.parse(answer);
  const pending = (answer as z.infer<typeof pendingUpdatesSchema>).result;
  const lastUpdate = pending.at(-1);
  if (lastUpdate !== undefined) {
    await callBotApi(fixture, bot, 'getUpdates', { offset: lastUpdate.update_id + 1, timeout: 0 });
  }
  return pending.filter((update) => update.message_reaction !== undefined);
}

async function expectRefused(
  request: Promise<unknown>,
  expectedStatus: number,
  description: string,
): Promise<void> {
  try {
    await request;
  } catch (error) {
    if (error instanceof EmulationClientError && error.status === expectedStatus) {
      return;
    }
    throw new Error(`Expected ${description} to be refused with ${expectedStatus}`, {
      cause: error,
    });
  }
  throw new Error(`Expected ${description} to be refused with ${expectedStatus}`);
}

function expectEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}
