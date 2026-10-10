import { Bot } from 'grammy';

import { EmulationClientError, TelegramEmulationClient } from '../clients/typescript/mod.ts';
import { createTestApi } from './support/emulation_api.ts';

Deno.test('a grammY bot publishes, rotates and revokes its primary invite link', async () => {
  const publicOrigin = 'http://emulator.example:9000';
  const api = createTestApi(publicOrigin);
  const fetch = createInProcessFetch(api.fetch);
  const session = await new TelegramEmulationClient(publicOrigin, { fetch }).createSession();
  try {
    const gatekeeper = await session.createBot({
      first_name: 'Gatekeeper',
      username: 'gatekeeper_bot',
    });
    const { account: ada } = await session.createAccount({ first_name: 'Ada' });
    const { account: grace } = await session.createAccount({ first_name: 'Grace' });
    const { account: hopper } = await session.createAccount({ first_name: 'Hopper' });
    const { account: linus } = await session.createAccount({ first_name: 'Linus' });
    const supergroup = await ada.createSupergroup({ title: 'Team' });
    const chat = { type: 'supergroup', chatId: supergroup.id } as const;
    await ada.addChatMember({ chat, userId: gatekeeper.bot.id });
    await ada.promoteChatMember({
      chat,
      userId: gatekeeper.bot.id,
      rights: { can_invite_users: true },
    });

    const bot = new Bot(gatekeeper.token, { client: { apiRoot: session.botApiRoot, fetch } });
    // `/link` publishes a new primary link; `/revoke` revokes the current one and publishes the
    // replacement that `getChat` then shows.
    bot.command('link', async (ctx) => await ctx.reply(await ctx.exportChatInviteLink()));
    bot.command('revoke', async (ctx) => {
      const { invite_link: currentLink } = await ctx.getChat();
      if (currentLink !== undefined) {
        await ctx.revokeChatInviteLink(currentLink);
      }
      await ctx.reply((await ctx.getChat()).invite_link ?? 'no link');
    });
    const polling = bot.start();
    // `await polling` below reports an error the bot stops with.
    polling.catch(() => {});

    try {
      const activity = session.botActivity({ bot_id: gatekeeper.bot.id });
      /** Sends a command to the bot and returns the text of the bot's reply. */
      const askBot = async (command: string) => {
        const beforeAsking = await activity.position();
        await ada.sendMessage({ to: chat, text: `/${command}@gatekeeper_bot` });
        const reply = await activity.waitFor(
          { method: 'sendMessage', chat_id: supergroup.id, ok: true },
          { after: beforeAsking },
        );
        return reply.parameters.text;
      };
      const join = async (account: typeof grace, inviteLink: string) => {
        try {
          return (await account.joinChatByInviteLink({ inviteLink })).outcome;
        } catch (error) {
          return error instanceof EmulationClientError ? error.status : error;
        }
      };

      const firstLink = await askBot('link');
      const graceJoin = await join(grace, firstLink);
      const secondLink = await askBot('link');
      const hopperJoins = [await join(hopper, firstLink), await join(hopper, secondLink)];
      const thirdLink = await askBot('revoke');
      const linusJoins = [await join(linus, secondLink), await join(linus, thirdLink)];

      assertJson(
        [
          graceJoin,
          hopperJoins,
          linusJoins,
          new Set([firstLink, secondLink, thirdLink]).size,
          (await ada.getChatInviteLinks({ chat })).map((link) => [
            link.invite_link,
            link.is_primary,
            link.is_revoked,
            link.member_count,
          ]),
        ],
        [
          'joined',
          [410, 'joined'],
          [410, 'joined'],
          3,
          [
            [firstLink, true, true, 1],
            [secondLink, true, true, 1],
            [thirdLink, true, false, 1],
          ],
        ],
        'Expected each replaced primary link to stop admitting accounts while its members stay',
      );
    } finally {
      await bot.stop();
      await polling;
    }
  } finally {
    await session.end();
  }
});

function createInProcessFetch(
  handler: (request: Request) => Response | Promise<Response>,
): typeof globalThis.fetch {
  return async (input, init) => await handler(new Request(input, init));
}

function assertJson(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}
