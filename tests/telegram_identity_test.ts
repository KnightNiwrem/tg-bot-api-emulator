import { isTelegramUsername } from '../src/types/telegram_identity.ts';

Deno.test('isTelegramUsername admits the usernames TDLib is_valid_username admits', () => {
  const validUsernames = [
    'a',
    'Z',
    'gif',
    'ada',
    'Test_Bot',
    'team_chat2',
    'a1_b2_c3',
    'A0',
    'x'.repeat(32),
    `a${'_b'.repeat(15)}a`,
  ];
  for (const username of validUsernames) {
    if (!isTelegramUsername(username)) {
      throw new Error(`Expected ${JSON.stringify(username)} to be a valid username`);
    }
  }
});

Deno.test('isTelegramUsername refuses usernames TDLib is_valid_username refuses', () => {
  const invalidUsernames = [
    '',
    'x'.repeat(33),
    '1team',
    '_team',
    'team_',
    'team__chat',
    'not a username',
    ' team',
    'team!',
    'team.chat',
    'team-chat',
    '@team',
    'équipe',
    'İstanbul',
    'tеam', // Cyrillic е
    'team\n',
    'ｔｅａｍ',
  ];
  for (const username of invalidUsernames) {
    if (isTelegramUsername(username)) {
      throw new Error(`Expected ${JSON.stringify(username)} to be an invalid username`);
    }
  }
});
