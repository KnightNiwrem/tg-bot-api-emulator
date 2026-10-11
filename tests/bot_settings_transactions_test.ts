import { assertEquals, assertNotEquals, assertRejects } from '@std/assert';

import {
  createBotApiCommandSession,
  FAILED_RECORDING_MESSAGE,
} from './support/bot_api_command_session.ts';

const COMMANDS = JSON.stringify([{ command: 'start', description: 'Start' }]);

Deno.test("a change of the bot's settings whose record fails commits nothing", async () => {
  const fixture = createSettingsFixture();
  const changes = [
    ['setMyCommands', { commands: COMMANDS }],
    ['deleteMyCommands', {}],
    ['setMyDescription', { description: 'A helpful bot' }],
    ['setMyShortDescription', { short_description: 'Helpful' }],
    ['setMyDefaultAdministratorRights', { rights: JSON.stringify({ can_pin_messages: true }) }],
    ['setChatMenuButton', { menu_button: JSON.stringify({ type: 'commands' }) }],
  ] as const;

  for (const [methodName, parameters] of changes) {
    const stateBefore = fixture.readState();
    const restoreRecording = fixture.failCallRecording();
    await assertRejects(
      () => fixture.callMethod(fixture.alpha, methodName, parameters),
      Error,
      FAILED_RECORDING_MESSAGE,
    );
    restoreRecording();
    assertEquals(fixture.readState(), stateBefore, `${methodName} left a change behind`);

    // The same call changes the settings once its record succeeds.
    await fixture.callMethodExpectingResult(fixture.alpha, methodName, parameters);
    assertNotEquals(
      fixture.readState().settings,
      stateBefore.settings,
      `${methodName} changed nothing`,
    );
  }
});

Deno.test("a change of the bot's settings prepared before its session ended commits nothing", async () => {
  const fixture = createSettingsFixture();
  const replies = [
    fixture.holdWebhookReply(fixture.alpha, { method: 'setMyCommands', commands: COMMANDS }),
    fixture.holdWebhookReply(fixture.alpha, {
      method: 'setMyDescription',
      description: 'A helpful bot',
    }),
  ];
  const stateBefore = fixture.readState();

  fixture.session.end();
  for (const reply of replies) {
    await reply.release();
  }

  assertEquals(fixture.readState(), stateBefore);
});

/** Alpha, a bot with no settings yet, read through reads that record nothing. */
function createSettingsFixture() {
  const harness = createBotApiCommandSession('bot-settings-transactions');
  const { session } = harness;
  const alpha = harness.createBot('alpha_bot');
  return {
    ...harness,
    alpha,
    readState: () => ({
      settings: {
        commands: session.botCommands.getBotCommands({
          botId: alpha.id,
          scope: { type: 'default' },
          languageCode: '',
        }),
        description: session.botDescriptions.getBotDescription({
          botId: alpha.id,
          kind: 'description',
          languageCode: '',
        }),
        shortDescription: session.botDescriptions.getBotDescription({
          botId: alpha.id,
          kind: 'short_description',
          languageCode: '',
        }),
        defaultAdministratorRights: session.botDefaultAdministratorRights
          .getDefaultAdministratorRights({ botId: alpha.id, kind: 'group' }),
        menuButton: session.botMenuButtons.getBotMenuButton({ botId: alpha.id }),
      },
      activityHead: session.botActivity.getHeadPosition(),
    }),
  };
}
