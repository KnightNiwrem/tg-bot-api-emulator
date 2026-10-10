import { LastMessageSendingBotRepository } from '../src/repositories/last_message_sending_bot.ts';

Deno.test('LastMessageSendingBotRepository keeps the latest sending bot of each supergroup', () => {
  const lastMessageSendingBots = new LastMessageSendingBotRepository();
  const team = -1_000_000_000_001;
  const otherTeam = -1_000_000_000_002;

  if (lastMessageSendingBots.getLastMessageSendingBotId(team) !== undefined) {
    throw new Error('Expected no last message-sending bot before any bot wrote to the group');
  }

  lastMessageSendingBots.recordMessageSendingBot(team, 10);
  lastMessageSendingBots.recordMessageSendingBot(otherTeam, 20);
  lastMessageSendingBots.recordMessageSendingBot(team, 30);

  if (
    lastMessageSendingBots.getLastMessageSendingBotId(team) !== 30 ||
    lastMessageSendingBots.getLastMessageSendingBotId(otherTeam) !== 20
  ) {
    throw new Error('Expected each supergroup to keep only the bot that wrote to it last');
  }
});
