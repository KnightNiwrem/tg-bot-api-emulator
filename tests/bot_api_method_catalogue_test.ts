import { findBotApiMethod } from '../src/api/sessions/bot_api/method_catalogue.ts';

Deno.test('findBotApiMethod finds a method by its current name in any letter case', () => {
  for (const requestedName of ['sendMessage', 'SENDMESSAGE', 'sendmessage', 'SeNdMeSsAgE']) {
    const method = findBotApiMethod(requestedName);
    if (method?.name !== 'sendMessage') {
      throw new Error(`Expected ${requestedName} to find sendMessage, found ${method?.name}`);
    }
  }
});

Deno.test("findBotApiMethod finds a method by Telegram's older name of it, in any letter case", () => {
  const cases: [requestedName: string, currentName: string][] = [
    ['kickChatMember', 'banChatMember'],
    ['KICKCHATMEMBER', 'banChatMember'],
    ['getChatMembersCount', 'getChatMemberCount'],
    ['getchatmemberscount', 'getChatMemberCount'],
  ];
  for (const [requestedName, currentName] of cases) {
    const method = findBotApiMethod(requestedName);
    if (method === undefined || method !== findBotApiMethod(currentName)) {
      throw new Error(`Expected ${requestedName} to find the record of ${currentName}`);
    }
    if (method.name !== currentName) {
      throw new Error(`Expected ${requestedName} to find ${currentName}, found ${method.name}`);
    }
  }
});

Deno.test('findBotApiMethod finds no method for a name the emulator does not implement', () => {
  for (const requestedName of ['', 'notAMethod', 'close', 'logOut', 'sendMessages', 'banChat']) {
    const method = findBotApiMethod(requestedName);
    if (method !== undefined) {
      throw new Error(`Expected ${JSON.stringify(requestedName)} to find nothing: ${method.name}`);
    }
  }
});

Deno.test('a method record declares whether calls of the method are recorded', () => {
  const cases: [requestedName: string, recordsActivity: boolean][] = [
    ['getUpdates', false],
    ['GETUPDATES', false],
    ['getMe', true],
    ['getWebhookInfo', true],
    ['setWebhook', true],
    ['deleteWebhook', true],
    ['sendMessage', true],
    ['kickChatMember', true],
  ];
  for (const [requestedName, recordsActivity] of cases) {
    const recorded = findBotApiMethod(requestedName)?.recordsActivity;
    if (recorded !== recordsActivity) {
      throw new Error(`Expected ${requestedName} to have recordsActivity ${recordsActivity}`);
    }
  }
});
