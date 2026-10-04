# Polls

[Guide index](README.md) · [Feature reference: Polls](../../features/polls.md)

This page shows how an account votes in a bot's poll, how a test observes the updates the bot
receives for it, and how a poll closes, by the bot's `stopPoll` or by a closing time the test makes
arrive. The examples use the [shared fixture](sessions-and-fixtures.md) and the
[waiting pattern](observing-bot-behavior.md).

## Voting in a bot's poll

Accounts cannot send polls; they vote in the polls bots send. The bot below answers `/poll` by
replying with a poll, so the test waits for the `sendPoll` call that replies to its command and then
selects the poll's message by its sender and the message it replies to.

`account.answerPoll` chooses options by their position, counted from 0, and returns the account's
`poll_answer` together with the poll's message as it is now, whose options show their voter counts.
`account.getPollAnswer` reads the same answer later. `account.retractPollAnswer` takes the answer
back, after which both lists of the answer are empty. Only a poll that allows revoting accepts a
retraction, which a regular poll does by default; a quiz, or a poll sent with
`allows_revoting: false`, refuses it with status 409. [Voting](../../features/polls.md#voting)
describes the checks a vote passes.

```ts
import { withBotFixture } from './bot_fixture.ts';
import { assertEquals, assertExists } from 'jsr:@std/assert@^1';

Deno.test('the account votes in the poll the bot sends and retracts its vote', () =>
  withBotFixture({
    handlers: (bot) => {
      bot.command('poll', (ctx) =>
        ctx.replyWithPoll('Tea or coffee?', ['Tea', 'Coffee'], {
          reply_parameters: { message_id: ctx.msg.message_id },
        }));
    },
  }, async ({ account, activity, botProfile, privateChat }) => {
    const beforeCommand = await activity.position();
    const command = await account.sendMessage({ to: privateChat, text: '/poll' });
    await activity.waitFor(
      {
        method: 'sendPoll',
        chat_id: account.id,
        ok: true,
        parameters: { reply_parameters: JSON.stringify({ message_id: command.message_id }) },
      },
      { after: beforeCommand },
    );
    const pollMessage = (await account.getMessages({ chat: privateChat })).find((message) =>
      message.from.id === botProfile.id &&
      message.reply_to_message?.message_id === command.message_id
    );
    assertExists(pollMessage?.poll);

    const { poll_answer, message } = await account.answerPoll({
      chat: privateChat,
      message_id: pollMessage.message_id,
      option_ids: [1],
    });
    assertEquals(poll_answer.option_ids, [1]);
    assertEquals(message.poll?.options.map(({ voter_count }) => voter_count), [0, 1]);
    assertEquals(message.poll?.total_voter_count, 1);

    const stored = await account.getPollAnswer({
      chat: privateChat,
      message_id: pollMessage.message_id,
    });
    assertEquals(stored.poll_answer, poll_answer);

    await account.retractPollAnswer({ chat: privateChat, message_id: pollMessage.message_id });
    const retracted = await account.getPollAnswer({
      chat: privateChat,
      message_id: pollMessage.message_id,
    });
    assertEquals(retracted.poll_answer.option_ids, []);
    assertEquals(retracted.message.poll?.total_voter_count, 0);
  }));
```

## Observing poll updates

A vote sends the bot that owns the poll a `poll_answer` update naming the voter, unless the poll is
anonymous, and a `poll` update with the poll's new counts. Neither update has a chat, so the test
finds them in the activity log as `update_delivered` entries: the `poll_answer` by the voter's
`user_id`, and the `poll` by the poll's ID, since that update names no user. The bot below thanks
the voter in their private chat, which the test waits for by its exact text.
[Poll updates](../../features/polls.md#poll-updates) describes which bots receive them.

```ts
import { withBotFixture } from './bot_fixture.ts';
import { assertExists, assertObjectMatch } from 'jsr:@std/assert@^1';

Deno.test('the bot receives the vote and the poll counts', () =>
  withBotFixture({
    handlers: (bot) => {
      bot.command('poll', (ctx) =>
        ctx.replyWithPoll('Tea or coffee?', ['Tea', 'Coffee'], {
          is_anonymous: false,
          reply_parameters: { message_id: ctx.msg.message_id },
        }));
      bot.on('poll_answer', async (ctx) => {
        const voter = ctx.pollAnswer.user;
        if (voter !== undefined) {
          await ctx.api.sendMessage(voter.id, `Noted: ${ctx.pollAnswer.option_ids.join(', ')}`);
        }
      });
    },
  }, async ({ account, activity, botProfile, privateChat }) => {
    const beforeCommand = await activity.position();
    const command = await account.sendMessage({ to: privateChat, text: '/poll' });
    await activity.waitFor(
      {
        method: 'sendPoll',
        chat_id: account.id,
        ok: true,
        parameters: { reply_parameters: JSON.stringify({ message_id: command.message_id }) },
      },
      { after: beforeCommand },
    );
    const pollMessage = (await account.getMessages({ chat: privateChat })).find((message) =>
      message.from.id === botProfile.id &&
      message.reply_to_message?.message_id === command.message_id
    );
    assertExists(pollMessage?.poll);
    const pollId = pollMessage.poll.id;

    const beforeVote = await activity.position();
    await account.answerPoll({
      chat: privateChat,
      message_id: pollMessage.message_id,
      option_ids: [0],
    });

    const answerUpdate = await activity.waitFor(
      {
        kind: 'update_delivered',
        user_id: account.id,
        where: ({ update }) => update.poll_answer !== undefined,
      },
      { after: beforeVote },
    );
    assertObjectMatch(answerUpdate.update, {
      poll_answer: { poll_id: pollId, user: { id: account.id }, option_ids: [0] },
    });

    const pollUpdate = await activity.waitFor(
      {
        kind: 'update_delivered',
        where: ({ update }) => (update.poll as { id?: string } | undefined)?.id === pollId,
      },
      { after: beforeVote },
    );
    assertObjectMatch(pollUpdate.update, { poll: { total_voter_count: 1, is_closed: false } });

    await activity.waitFor(
      { method: 'sendMessage', chat_id: account.id, ok: true, parameters: { text: 'Noted: 0' } },
      { after: beforeVote },
    );
  }));
```

## Stopping a poll

The bot that sent a poll closes it with `stopPoll`. Here the bot closes the poll an account's
`/close` command replies to; the test waits for that `stopPoll` call by the poll's chat and message
ID. A closed poll keeps its votes, shows `is_closed`, and refuses further votes with status 409.
[Stopping polls](../../features/polls.md#stopping-polls) describes the call's checks and what
happens to the message's keyboard.

```ts
import { withBotFixture } from './bot_fixture.ts';
import { EmulationClientError } from '../../../clients/typescript/mod.ts';
import { assertEquals, assertExists, assertRejects } from 'jsr:@std/assert@^1';

Deno.test('the bot stops its poll, which then refuses votes', () =>
  withBotFixture({
    handlers: (bot) => {
      bot.command('poll', (ctx) =>
        ctx.replyWithPoll('Tea or coffee?', ['Tea', 'Coffee'], {
          reply_parameters: { message_id: ctx.msg.message_id },
        }));
      bot.command('close', async (ctx) => {
        const target = ctx.msg.reply_to_message;
        if (target?.poll !== undefined) {
          await ctx.api.stopPoll(ctx.chat.id, target.message_id);
        }
      });
    },
  }, async ({ account, activity, botProfile, privateChat }) => {
    const beforeCommand = await activity.position();
    const command = await account.sendMessage({ to: privateChat, text: '/poll' });
    await activity.waitFor(
      {
        method: 'sendPoll',
        chat_id: account.id,
        ok: true,
        parameters: { reply_parameters: JSON.stringify({ message_id: command.message_id }) },
      },
      { after: beforeCommand },
    );
    const pollMessage = (await account.getMessages({ chat: privateChat })).find((message) =>
      message.from.id === botProfile.id &&
      message.reply_to_message?.message_id === command.message_id
    );
    assertExists(pollMessage?.poll);
    await account.answerPoll({
      chat: privateChat,
      message_id: pollMessage.message_id,
      option_ids: [0],
    });

    const beforeClose = await activity.position();
    await account.sendMessage({
      to: privateChat,
      text: '/close',
      reply_to_message_id: pollMessage.message_id,
    });
    await activity.waitFor(
      {
        method: 'stopPoll',
        chat_id: account.id,
        ok: true,
        parameters: { message_id: String(pollMessage.message_id) },
      },
      { after: beforeClose },
    );

    const { message } = await account.getPollAnswer({
      chat: privateChat,
      message_id: pollMessage.message_id,
    });
    assertEquals(message.poll?.is_closed, true);
    assertEquals(message.poll?.total_voter_count, 1);

    const refusal = await assertRejects(
      () =>
        account.answerPoll({
          chat: privateChat,
          message_id: pollMessage.message_id,
          option_ids: [1],
        }),
      EmulationClientError,
    );
    assertEquals(refusal.status, 409);
  }));
```

## Closing a poll at its closing time

A poll sent with `open_period` or `close_date` shows both while it is open. The emulator does not
close polls as time passes: the test decides when the closing time arrives by calling
`session.expirePoll(pollId)`, which closes the poll as if stopped and returns it as its bot sees it.
The bot receives a `poll` update with the closed poll, as Telegram reports a poll that closed by
itself. [Test controls](test-controls.md) covers this and the session's other controls that stand in
for elapsed time, and [Closing times](../../features/polls.md#closing-times) describes the
semantics.

```ts
import { withBotFixture } from './bot_fixture.ts';
import { assertEquals, assertExists, assertObjectMatch } from 'jsr:@std/assert@^1';

Deno.test('the poll closes when the test makes its closing time arrive', () =>
  withBotFixture({
    handlers: (bot) => {
      bot.command('poll', (ctx) =>
        ctx.replyWithPoll('Tea or coffee?', ['Tea', 'Coffee'], {
          open_period: 600,
          reply_parameters: { message_id: ctx.msg.message_id },
        }));
    },
  }, async ({ session, account, activity, botProfile, privateChat }) => {
    const beforeCommand = await activity.position();
    const command = await account.sendMessage({ to: privateChat, text: '/poll' });
    await activity.waitFor(
      {
        method: 'sendPoll',
        chat_id: account.id,
        ok: true,
        parameters: { reply_parameters: JSON.stringify({ message_id: command.message_id }) },
      },
      { after: beforeCommand },
    );
    const pollMessage = (await account.getMessages({ chat: privateChat })).find((message) =>
      message.from.id === botProfile.id &&
      message.reply_to_message?.message_id === command.message_id
    );
    assertExists(pollMessage?.poll);
    assertEquals(pollMessage.poll.open_period, 600);
    assertExists(pollMessage.poll.close_date);
    const pollId = pollMessage.poll.id;

    const beforeExpiry = await activity.position();
    const closedPoll = await session.expirePoll(pollId);
    assertEquals(closedPoll.is_closed, true);
    assertEquals(closedPoll.open_period, undefined);

    const pollUpdate = await activity.waitFor(
      {
        kind: 'update_delivered',
        where: ({ update }) => (update.poll as { id?: string } | undefined)?.id === pollId,
      },
      { after: beforeExpiry },
    );
    assertObjectMatch(pollUpdate.update, { poll: { is_closed: true } });
  }));
```
