import {
  BotMenuButtonService,
  type GetBotMenuButtonResult,
  type SetBotMenuButtonResult,
} from '../src/services/domain/bot_menu_button.ts';
import type { BotMenuButton } from '../src/types/bot_menu_button.ts';
import { buildSessionServices } from './support/session_services.ts';
import { createVirtualAccount, createVirtualBot } from './support/virtual_users.ts';
import { assertEqualsInFieldOrder } from './support/field_order_assertion.ts';

Deno.test('BotMenuButtonService prefers a chat button over the button for all chats', () => {
  using fixture = createMenuButtonFixture();
  const { menuButtons, botId, accountId, otherAccountId } = fixture;
  const webApp: BotMenuButton = { kind: 'web_app', text: 'Shop', url: 'https://shop.example/' };

  assertMenuButton(menuButtons.getBotMenuButton({ botId }), { kind: 'default' });
  assertSet(menuButtons.setBotMenuButton({ botId, menuButton: { kind: 'commands' } }));
  assertSet(menuButtons.setBotMenuButton({ botId, userId: accountId, menuButton: webApp }));

  assertMenuButton(menuButtons.getBotMenuButton({ botId }), { kind: 'commands' });
  assertMenuButton(menuButtons.getBotMenuButton({ botId, userId: accountId }), webApp);
  assertMenuButton(
    menuButtons.getBotMenuButton({ botId, userId: otherAccountId }),
    { kind: 'commands' },
  );
  assertMenuButton(menuButtons.getPrivateChatMenuButton({ accountId, botId }), webApp);

  // The default button removes the chat's own choice, so the button for all chats applies again.
  assertSet(
    menuButtons.setBotMenuButton({ botId, userId: accountId, menuButton: { kind: 'default' } }),
  );
  assertMenuButton(
    menuButtons.getPrivateChatMenuButton({ accountId, botId }),
    { kind: 'commands' },
  );
});

Deno.test('BotMenuButtonService cleans a Web App button and normalizes its URL', () => {
  using fixture = createMenuButtonFixture();
  const { menuButtons, botId } = fixture;

  assertSet(
    menuButtons.setBotMenuButton({
      botId,
      menuButton: { kind: 'web_app', text: 'Open\tshop\r', url: 'HTTPS://Shop.Example' },
    }),
  );

  assertMenuButton(menuButtons.getBotMenuButton({ botId }), {
    kind: 'web_app',
    text: 'Open shop',
    url: 'https://shop.example/',
  });
});

Deno.test('BotMenuButtonService rejects buttons and users as TDLib does', () => {
  using fixture = createMenuButtonFixture();
  const { menuButtons, botId, accountId } = fixture;
  const webApp = (text: string, url: string): BotMenuButton => ({ kind: 'web_app', text, url });
  assertSet(menuButtons.setBotMenuButton({ botId, menuButton: { kind: 'commands' } }));

  const cases = [
    [{ botId, userId: botId, menuButton: webApp('', 'x') }, 'user_not_found'],
    [{ botId, menuButton: webApp('', 'https://shop.example') }, 'menu_button_text_empty'],
    [{ botId, menuButton: webApp('\ud800', 'x') }, 'menu_button_text_not_utf8'],
    [{ botId, menuButton: webApp('Shop', '\ud800') }, 'menu_button_url_not_utf8'],
  ] as const;
  for (const [input, expectedReason] of cases) {
    const result = menuButtons.setBotMenuButton(input);
    if (result.set || result.reason !== expectedReason) {
      throw new Error(`Expected ${expectedReason}, received ${JSON.stringify(result)}`);
    }
  }
  const urlCases = [
    ['http://shop.example', "URL 'http://shop.example' is invalid: Only HTTPS links are allowed"],
    [
      'tg://resolve?domain=shop',
      "URL 'tg://resolve?domain=shop' is invalid: Only HTTPS links are allowed",
    ],
    ['https://localhost', "URL 'https://localhost' is invalid: Wrong HTTP URL"],
  ] as const;
  for (const [url, expectedError] of urlCases) {
    const result = menuButtons.setBotMenuButton({ botId, menuButton: webApp('Shop', url) });
    if (
      result.set || result.reason !== 'web_app_url_invalid' || result.urlError !== expectedError
    ) {
      throw new Error(`Expected ${expectedError}, received ${JSON.stringify(result)}`);
    }
  }

  // TDLib reads a Web App button without text whose URL is "default" as the default button.
  assertSet(menuButtons.setBotMenuButton({ botId, menuButton: webApp('', 'default') }));
  assertMenuButton(menuButtons.getBotMenuButton({ botId }), { kind: 'default' });
  const unknownUser = menuButtons.getBotMenuButton({ botId, userId: accountId + 100 });
  if (unknownUser.found || unknownUser.reason !== 'user_not_found') {
    throw new Error(`Expected user_not_found, received ${JSON.stringify(unknownUser)}`);
  }
});

/** A session with a bot and two accounts, Ada and Grace, that can open its menu. */
function createMenuButtonFixture() {
  const session = buildSessionServices();
  const botId =
    createVirtualBot(session.virtualUsers, { first_name: 'Shop Bot', username: 'shop_bot' })
      .profile.id;
  const [accountId, otherAccountId] = ['Ada', 'Grace'].map((firstName) =>
    createVirtualAccount(session.virtualUsers, { first_name: firstName }).profile.id
  );
  return {
    menuButtons: session.botMenuButtons,
    botId,
    accountId,
    otherAccountId,
    [Symbol.dispose]: () => session[Symbol.dispose](),
  };
}

function assertSet(result: SetBotMenuButtonResult): void {
  if (!result.set) {
    throw new Error(`Expected the menu button to be set, received ${JSON.stringify(result)}`);
  }
}

function assertMenuButton(
  result: GetBotMenuButtonResult | ReturnType<BotMenuButtonService['getPrivateChatMenuButton']>,
  expectedMenuButton: BotMenuButton,
): void {
  assertEqualsInFieldOrder(
    result.found ? result.menuButton : result,
    expectedMenuButton,
    "Expected the bot's menu button",
  );
}
