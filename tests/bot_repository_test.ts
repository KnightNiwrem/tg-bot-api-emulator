import { BotRepository } from '../src/repositories/bot.ts';
import type { VirtualBot } from '../src/types/virtual_bot.ts';

Deno.test('BotRepository adds and retrieves a virtual bot without overwriting keys', () => {
  const bots = new BotRepository();
  const bot = createBot();

  if (!bots.add(bot)) {
    throw new Error('Expected the bot to be added');
  }
  if (bots.getById(bot.profile.id) !== bot || bots.getByToken(bot.token) !== bot) {
    throw new Error('Expected ID and token lookups to return the added bot');
  }
  if (bots.add(bot)) {
    throw new Error('Expected duplicate bot keys not to overwrite the stored bot');
  }
});

function createBot(): VirtualBot {
  return {
    token: '1:test-token',
    profile: {
      id: 1,
      is_bot: true,
      first_name: 'Test Bot',
      username: 'test_bot',
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      has_topics_enabled: false,
      allows_users_to_create_topics: false,
      can_manage_bots: false,
      supports_join_request_queries: false,
    },
    receivesChosenInlineResults: false,
    requestsInlineLocation: false,
    enablesBotToBotCommunication: false,
  };
}
