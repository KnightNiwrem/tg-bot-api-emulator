# Reactions

[Guide index](README.md) · [Feature reference: Reactions](../../features/reactions.md)

This page shows how an account reacts to a supergroup message, how a bot that administers the
supergroup observes the reaction and answers with one of its own, and how a test reads the message's
reactions. The examples use the [shared fixture](sessions-and-fixtures.md) and the
[waiting pattern](observing-bot-behavior.md).

## Answering a reaction with a reaction

Bots receive `message_reaction` updates only as administrators of the supergroup, and only when they
ask for them in `allowed_updates`, which the default subscription leaves out. The fixture's
`allowedUpdates` option asks for them, and the test promotes the bot after adding it.

`account.setMessageReaction` reacts with one ordinary emoji, as the Bot API's `ReactionTypeEmoji`
writes it, and returns the message's reactions. The bot below answers a 👍 with a 👌 through
grammY's `ctx.react`, which calls `setMessageReaction`. The test waits for that call, then reads the
message's reactions with `account.getMessageReactions`, which lists every member's reactions, the
bot's included, in the order they last changed them.

```ts
import { withBotFixture } from './bot_fixture.ts';
import { assertEquals } from 'jsr:@std/assert@1.0.19';

Deno.test('the bot acknowledges a thumbs-up with an OK hand', () =>
  withBotFixture({
    allowedUpdates: ['message', 'message_reaction'],
    handlers: (bot) => {
      bot.reaction('👍', (ctx) => ctx.react('👌'));
    },
  }, async ({ botProfile, account, activity }) => {
    const supergroup = await account.createSupergroup({ title: 'Team' });
    const groupChat = { type: 'supergroup', chatId: supergroup.id } as const;
    await account.addChatMember({ chat: groupChat, userId: botProfile.id });
    await account.promoteChatMember({
      chat: groupChat,
      userId: botProfile.id,
      rights: { can_delete_messages: true },
    });
    const proposal = await account.sendMessage({ to: groupChat, text: 'Ship it?' });

    const beforeReaction = await activity.position();
    await account.setMessageReaction({
      chat: groupChat,
      message_id: proposal.message_id,
      reaction: [{ type: 'emoji', emoji: '👍' }],
    });
    await activity.waitFor({
      method: 'setMessageReaction',
      chat_id: supergroup.id,
      ok: true,
      parameters: { message_id: String(proposal.message_id) },
    }, { after: beforeReaction });

    const { reactions } = await account.getMessageReactions({
      chat: groupChat,
      message_id: proposal.message_id,
    });
    assertEquals(reactions, [
      { user_id: account.id, reaction: [{ type: 'emoji', emoji: '👍' }] },
      { user_id: botProfile.id, reaction: [{ type: 'emoji', emoji: '👌' }] },
    ]);
  }));
```

## Observing reaction updates

Each change of an account's reaction sends the subscribed administrator bots one `message_reaction`
update with the account's `old_reaction` and `new_reaction`. Choosing the reaction already chosen
sends nothing, and `account.removeMessageReaction` sends an update whose `new_reaction` is empty.
The bot's own reactions send no update to any bot. The test below finds the updates in the activity
log as `update_delivered` entries of the supergroup.
[Reaction updates](../../features/reactions.md#reaction-updates) describes which bots receive them.

```ts
import { withBotFixture } from './bot_fixture.ts';
import { assertEquals } from 'jsr:@std/assert@1.0.19';
import type { MessageReactionUpdated, ReactionType } from 'npm:grammy@1.46.0/types';

Deno.test('the bot observes a reaction being changed and removed', () =>
  withBotFixture({
    allowedUpdates: ['message', 'message_reaction'],
    handlers: () => {},
  }, async ({ botProfile, account, activity }) => {
    const supergroup = await account.createSupergroup({ title: 'Team' });
    const groupChat = { type: 'supergroup', chatId: supergroup.id } as const;
    await account.addChatMember({ chat: groupChat, userId: botProfile.id });
    await account.promoteChatMember({
      chat: groupChat,
      userId: botProfile.id,
      rights: { can_delete_messages: true },
    });
    const message = await account.sendMessage({ to: groupChat, text: 'Lunch at noon' });
    const target = { chat: groupChat, message_id: message.message_id };

    const beforeReactions = await activity.position();
    await account.setMessageReaction({ ...target, reaction: [{ type: 'emoji', emoji: '👍' }] });
    await account.setMessageReaction({ ...target, reaction: [{ type: 'emoji', emoji: '❤' }] });
    await account.removeMessageReaction(target);

    const updates = activity.cursor({ after: beforeReactions });
    const emojiOf = (reaction: ReactionType) =>
      reaction.type === 'emoji' ? reaction.emoji : reaction.type;
    const changes = [];
    for (let change = 0; change < 3; change++) {
      const entry = await updates.next({
        kind: 'update_delivered',
        chat_id: supergroup.id,
        where: (candidate) => 'message_reaction' in candidate.update,
      });
      const { old_reaction, new_reaction } = entry.update
        .message_reaction as MessageReactionUpdated;
      changes.push({ old: old_reaction.map(emojiOf), new: new_reaction.map(emojiOf) });
    }
    assertEquals(changes, [
      { old: [], new: ['👍'] },
      { old: ['👍'], new: ['❤'] },
      { old: ['❤'], new: [] },
    ]);
  }));
```
