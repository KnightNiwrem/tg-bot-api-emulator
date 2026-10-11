import { AccountRepository } from '../src/repositories/account.ts';
import { BotRepository } from '../src/repositories/bot.ts';
import { BotDescriptionRepository } from '../src/repositories/bot_description.ts';
import { TelegramIdentityRepository } from '../src/repositories/telegram_identity.ts';
import {
  BotDescriptionService,
  type BotDescriptionTarget,
  type GetBotDescriptionResult,
} from '../src/services/bot_description.ts';
import { VirtualUserService } from '../src/services/virtual_user.ts';
import { createVirtualBot } from './support/virtual_users.ts';

Deno.test('BotDescriptionService keeps each kind and language apart, without fallback', () => {
  const { botDescriptions, botId } = createBotDescriptionFixture();
  const defaultDescription = { botId, kind: 'description', languageCode: '' } as const;

  assertSet(botDescriptions.setBotDescription({ ...defaultDescription, text: 'Orders pizza' }));
  assertSet(
    botDescriptions.setBotDescription({
      botId,
      kind: 'short_description',
      languageCode: 'de',
      text: 'Bestellt Pizza',
    }),
  );

  assertText(botDescriptions.getBotDescription(defaultDescription), 'Orders pizza');
  assertText(
    botDescriptions.getBotDescription({ botId, kind: 'short_description', languageCode: 'de' }),
    'Bestellt Pizza',
  );
  assertText(
    botDescriptions.getBotDescription({ botId, kind: 'short_description', languageCode: '' }),
    '',
  );
  assertText(
    botDescriptions.getBotDescription({ ...defaultDescription, languageCode: 'de' }),
    '',
  );

  assertSet(botDescriptions.setBotDescription({ ...defaultDescription, text: '' }));
  assertText(botDescriptions.getBotDescription(defaultDescription), '');
});

Deno.test('BotDescriptionService cleans control characters without trimming', () => {
  const { botDescriptions, botId } = createBotDescriptionFixture();
  const target: BotDescriptionTarget = { botId, kind: 'description', languageCode: '' };

  assertSet(
    botDescriptions.setBotDescription({ ...target, text: ' Line\tone\r\nLine two ' }),
  );

  assertText(botDescriptions.getBotDescription(target), ' Line one\nLinetwo ');
});

Deno.test('BotDescriptionService checks the text before the language, as TDLib does', () => {
  const { botDescriptions, botId } = createBotDescriptionFixture();
  const target: BotDescriptionTarget = { botId, kind: 'description', languageCode: 'de' };
  assertSet(botDescriptions.setBotDescription({ ...target, text: 'Kept' }));

  const cases = [
    [{ ...target, languageCode: 'EN', text: '\ud800' }, 'text_not_utf8'],
    [{ ...target, languageCode: 'en-US', text: 'Hello' }, 'language_code_invalid'],
    [{ ...target, languageCode: 'eng', text: 'Hello' }, 'language_code_invalid'],
    [{ ...target, botId: botId + 100, text: 'Hello' }, 'bot_not_found'],
  ] as const;
  for (const [input, expectedReason] of cases) {
    const result = botDescriptions.setBotDescription(input);
    if (result.set || result.reason !== expectedReason) {
      throw new Error(`Expected ${expectedReason}, received ${JSON.stringify(result)}`);
    }
  }
  const unreadable = botDescriptions.getBotDescription({ ...target, languageCode: 'EN' });
  if (unreadable.found || unreadable.reason !== 'language_code_invalid') {
    throw new Error(`Expected language_code_invalid, received ${JSON.stringify(unreadable)}`);
  }
  assertText(botDescriptions.getBotDescription(target), 'Kept');
});

function createBotDescriptionFixture() {
  const bots = new BotRepository();
  const virtualUsers = new VirtualUserService({
    identities: new TelegramIdentityRepository(),
    accounts: new AccountRepository(),
    bots,
  });
  const botId =
    createVirtualBot(virtualUsers, { first_name: 'Pizza Bot', username: 'pizza_bot' }).profile.id;
  const botDescriptions = new BotDescriptionService({
    bots,
    botDescriptions: new BotDescriptionRepository(),
  });
  return { botDescriptions, botId };
}

function assertSet(result: ReturnType<BotDescriptionService['setBotDescription']>): void {
  if (!result.set) {
    throw new Error(`Expected the text to be set, received ${result.reason}`);
  }
}

function assertText(result: GetBotDescriptionResult, expectedText: string): void {
  if (!result.found || result.text !== expectedText) {
    throw new Error(
      `Expected ${JSON.stringify(expectedText)}, received ${JSON.stringify(result)}`,
    );
  }
}
