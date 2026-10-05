# Invite links

[Guide index](README.md) ·
[Feature reference: Invite links and join requests](../../features/invite-links.md) ·
[Feature reference: Supergroups](../../features/supergroups.md)

This page shows how a test lets an administrator bot create invite links, has other accounts use
them, and checks the join requests the bot decides. Examples use the
[shared fixture](sessions-and-fixtures.md) and the [waiting pattern](observing-bot-behavior.md).

## Creating a link and joining through it

Only bots create invite links, and only in a supergroup where they hold the `can_invite_users`
administrator right. In these examples the bot creates its link when the owner promotes it, which it
learns from its `my_chat_member` update. The test waits for the successful `createChatInviteLink`
call and reads the new link from the call's `answer.result`, a Bot API `ChatInviteLink`.

The owner also sees the supergroup's links with `account.getChatInviteLinks`, in the order bots
created them, each with its `creator_user_id`, `member_count` and `pending_join_request_count`. A
test that selects a link there selects it by its creator. Another account then uses the whole link
with `joinChatByInviteLink`, which answers the supergroup's `chat_id` and the `outcome` `joined`.
Every bot of the supergroup receives the join as a message with `new_chat_members` from the joining
account, and [joining through a link](../../features/invite-links.md#joining-through-a-link) lists
the refusals and the `chat_member` updates administrator bots receive.

```ts
import { assert, assertEquals, assertExists } from 'jsr:@std/assert@^1';
import type { ChatInviteLink } from 'npm:grammy@^1.46.0/types';
import { withBotFixture } from './bot_fixture.ts';

Deno.test('the bot creates an invite link that another account joins through', async () => {
  await withBotFixture({
    handlers: (bot) => {
      // Once promoted with can_invite_users, the bot creates a link for the supergroup.
      bot.on('my_chat_member', async (ctx) => {
        const member = ctx.myChatMember.new_chat_member;
        if (member.status === 'administrator' && member.can_invite_users) {
          await ctx.createChatInviteLink({ name: 'Friends' });
        }
      });
    },
  }, async ({ session, botProfile, account, activity }) => {
    const supergroup = await account.createSupergroup({ title: 'Book club' });
    const groupChat = { type: 'supergroup', chatId: supergroup.id } as const;
    await account.addChatMember({ chat: groupChat, userId: botProfile.id });

    const beforePromotion = await activity.position();
    await account.promoteChatMember({
      chat: groupChat,
      userId: botProfile.id,
      rights: { can_invite_users: true },
    });
    const created = await activity.waitFor(
      {
        method: 'createChatInviteLink',
        chat_id: supergroup.id,
        ok: true,
        parameters: { name: 'Friends' },
      },
      { after: beforePromotion },
    );
    assert(created.answer.ok);
    const createdLink = created.answer.result as ChatInviteLink;

    // The owner sees each link with the bot that created it.
    const ownerView = (await account.getChatInviteLinks({ chat: groupChat }))
      .find(({ creator_user_id }) => creator_user_id === botProfile.id);
    assertExists(ownerView);
    assertEquals(ownerView.invite_link, createdLink.invite_link);
    assertEquals(ownerView.name, 'Friends');

    const { account: friend } = await session.createAccount({ first_name: 'Grace' });
    const beforeJoin = await activity.position();
    const join = await friend.joinChatByInviteLink({ inviteLink: createdLink.invite_link });
    assertEquals(join, { chat_id: supergroup.id, outcome: 'joined' });

    // The bot receives Grace's join as her own message with new_chat_members.
    const delivered = await activity.waitFor(
      { kind: 'update_delivered', chat_id: supergroup.id, user_id: friend.id },
      { after: beforeJoin },
    );
    const joinMessage = delivered.update.message as { new_chat_members?: { id: number }[] };
    assertEquals(joinMessage.new_chat_members?.map(({ id }) => id), [friend.id]);

    const linkAfterJoin = (await account.getChatInviteLinks({ chat: groupChat }))
      .find(({ invite_link }) => invite_link === createdLink.invite_link);
    assertEquals(linkAfterJoin?.member_count, 1);
  });
});
```

## Join requests

A link the bot creates with `creates_join_request: true` lets nobody in by itself. An account that
uses it stays outside with a pending request, and `joinChatByInviteLink` answers the `outcome`
`join_request_sent`. Administrator bots holding `can_invite_users` receive the request as a
`chat_join_request` update, and the owner inspects pending requests with
`account.getChatJoinRequests`. A bot that does not handle the update leaves the request pending:

```ts
import { assert, assertEquals } from 'jsr:@std/assert@^1';
import type { ChatInviteLink, ChatJoinRequest } from 'npm:grammy@^1.46.0/types';
import { withBotFixture } from './bot_fixture.ts';

Deno.test('an account that uses a request link waits outside the supergroup', async () => {
  await withBotFixture({
    handlers: (bot) => {
      bot.on('my_chat_member', async (ctx) => {
        const member = ctx.myChatMember.new_chat_member;
        if (member.status === 'administrator' && member.can_invite_users) {
          await ctx.createChatInviteLink({ name: 'Apply', creates_join_request: true });
        }
      });
    },
  }, async ({ session, botProfile, account, activity }) => {
    const supergroup = await account.createSupergroup({ title: 'Book club' });
    const groupChat = { type: 'supergroup', chatId: supergroup.id } as const;
    await account.addChatMember({ chat: groupChat, userId: botProfile.id });
    const beforePromotion = await activity.position();
    await account.promoteChatMember({
      chat: groupChat,
      userId: botProfile.id,
      rights: { can_invite_users: true },
    });
    const created = await activity.waitFor(
      { method: 'createChatInviteLink', chat_id: supergroup.id, ok: true },
      { after: beforePromotion },
    );
    assert(created.answer.ok);
    const { invite_link: inviteLink } = created.answer.result as ChatInviteLink;

    const { account: friend } = await session.createAccount({ first_name: 'Grace' });
    const beforeRequest = await activity.position();
    const { outcome } = await friend.joinChatByInviteLink({ inviteLink });
    assertEquals(outcome, 'join_request_sent');

    const delivered = await activity.waitFor(
      { kind: 'update_delivered', chat_id: supergroup.id, user_id: friend.id },
      { after: beforeRequest },
    );
    const request = delivered.update.chat_join_request as ChatJoinRequest;
    assertEquals(request.invite_link?.invite_link, inviteLink);

    const pending = await account.getChatJoinRequests({ chat: groupChat });
    assertEquals(pending.map(({ user_id, invite_link }) => ({ user_id, invite_link })), [
      { user_id: friend.id, invite_link: inviteLink },
    ]);
  });
});
```

### Approving and declining requests

The bot decides a request with `approveChatJoinRequest` or `declineChatJoinRequest`, naming the
requester by `user_id`. The test waits for each decision by its method and the requester's ID, which
the activity log records as text. Approval lets the account in as if it had joined through the link;
declining leaves it outside without an update.
[Approving and declining requests](../../features/invite-links.md#approving-and-declining-requests)
lists the errors a decision can fail with.

```ts
import { assert, assertEquals } from 'jsr:@std/assert@^1';
import type { ChatInviteLink } from 'npm:grammy@^1.46.0/types';
import { withBotFixture } from './bot_fixture.ts';

Deno.test('the bot approves requesters with a username and declines the others', async () => {
  await withBotFixture({
    handlers: (bot) => {
      bot.on('my_chat_member', async (ctx) => {
        const member = ctx.myChatMember.new_chat_member;
        if (member.status === 'administrator' && member.can_invite_users) {
          await ctx.createChatInviteLink({ name: 'Apply', creates_join_request: true });
        }
      });
      bot.on('chat_join_request', async (ctx) => {
        if (ctx.from.username === undefined) {
          await ctx.declineChatJoinRequest(ctx.from.id);
        } else {
          await ctx.approveChatJoinRequest(ctx.from.id);
        }
      });
    },
  }, async ({ session, botProfile, account, activity }) => {
    const supergroup = await account.createSupergroup({ title: 'Book club' });
    const groupChat = { type: 'supergroup', chatId: supergroup.id } as const;
    await account.addChatMember({ chat: groupChat, userId: botProfile.id });
    const beforePromotion = await activity.position();
    await account.promoteChatMember({
      chat: groupChat,
      userId: botProfile.id,
      rights: { can_invite_users: true },
    });
    const created = await activity.waitFor(
      { method: 'createChatInviteLink', chat_id: supergroup.id, ok: true },
      { after: beforePromotion },
    );
    assert(created.answer.ok);
    const { invite_link: inviteLink } = created.answer.result as ChatInviteLink;

    const { account: grace } = await session.createAccount({
      first_name: 'Grace',
      username: 'grace',
    });
    const { account: mallory } = await session.createAccount({ first_name: 'Mallory' });

    const beforeRequests = await activity.position();
    await grace.joinChatByInviteLink({ inviteLink });
    await mallory.joinChatByInviteLink({ inviteLink });
    const decision = (method: string, userId: number) =>
      activity.waitFor(
        {
          method,
          chat_id: supergroup.id,
          ok: true,
          parameters: { user_id: String(userId) },
        },
        { after: beforeRequests },
      );
    await Promise.all([
      decision('approveChatJoinRequest', grace.id),
      decision('declineChatJoinRequest', mallory.id),
    ]);

    // No request is left pending; Grace joined through the link, and Mallory stays outside.
    assertEquals(await account.getChatJoinRequests({ chat: groupChat }), []);
    const link = (await account.getChatInviteLinks({ chat: groupChat }))
      .find(({ invite_link }) => invite_link === inviteLink);
    assertEquals(link?.member_count, 1);
    const graceJoin = (await account.getMessages({ chat: groupChat }))
      .find((message) => message.from.id === grace.id && message.new_chat_members !== undefined);
    assertEquals(graceJoin?.new_chat_members?.map(({ id }) => id), [grace.id]);
  });
});
```

### Prompting requesters before a decision

Until a request is decided, the bots that received it may send messages to the requester's
`user_chat_id` although the account never started them, as the Bot API documents. The first bot to
write claims the contact, and only it may write further. The account reads the prompt in its private
chat with the bot, presses its buttons, and answers. Its own message starts the conversation, so the
bot may keep writing after the decision; the prompt alone gives the bot no lasting access.
[Contacting requesters](../../features/invite-links.md#contacting-requesters) lists what the grant
covers. The owner sees each request's `requester_contact` with `getChatJoinRequests`.

```ts
import { assert, assertEquals } from 'jsr:@std/assert@^1';
import type { ChatInviteLink } from 'npm:grammy@^1.46.0/types';
import { withBotFixture } from './bot_fixture.ts';

Deno.test('the bot asks a requester to prove it is human before approving it', async () => {
  const requestChatIds = new Map<number, number>();
  await withBotFixture({
    handlers: (bot) => {
      bot.on('my_chat_member', async (ctx) => {
        const member = ctx.myChatMember.new_chat_member;
        if (member.status === 'administrator' && member.can_invite_users) {
          await ctx.createChatInviteLink({ name: 'Apply', creates_join_request: true });
        }
      });
      bot.on('chat_join_request', async (ctx) => {
        requestChatIds.set(ctx.from.id, ctx.chat.id);
        await ctx.api.sendMessage(ctx.chatJoinRequest.user_chat_id, 'Are you human?', {
          reply_markup: { inline_keyboard: [[{ text: 'I am', callback_data: 'human' }]] },
        });
      });
      bot.callbackQuery('human', async (ctx) => {
        const chatId = requestChatIds.get(ctx.from.id);
        if (chatId !== undefined) {
          await ctx.api.approveChatJoinRequest(chatId, ctx.from.id);
        }
        await ctx.answerCallbackQuery();
      });
    },
  }, async ({ session, botProfile, account, activity }) => {
    const supergroup = await account.createSupergroup({ title: 'Book club' });
    const groupChat = { type: 'supergroup', chatId: supergroup.id } as const;
    await account.addChatMember({ chat: groupChat, userId: botProfile.id });
    const beforePromotion = await activity.position();
    await account.promoteChatMember({
      chat: groupChat,
      userId: botProfile.id,
      rights: { can_invite_users: true },
    });
    const created = await activity.waitFor(
      { method: 'createChatInviteLink', chat_id: supergroup.id, ok: true },
      { after: beforePromotion },
    );
    assert(created.answer.ok);
    const { invite_link: inviteLink } = created.answer.result as ChatInviteLink;

    const { account: grace } = await session.createAccount({ first_name: 'Grace' });
    const beforeRequest = await activity.position();
    await grace.joinChatByInviteLink({ inviteLink });
    await activity.waitFor(
      { method: 'sendMessage', chat_id: grace.id, ok: true },
      { after: beforeRequest },
    );
    const [request] = await account.getChatJoinRequests({ chat: groupChat });
    assertEquals(request?.requester_contact, { status: 'claimed', bot_ids: [botProfile.id] });

    // Grace answers the prompt in her private chat with the bot, which approves her.
    const botChat = { type: 'private', botId: botProfile.id } as const;
    const [prompt] = await grace.getMessages({ chat: botChat });
    assert(prompt !== undefined);
    await grace.pressCallbackButton({
      chat: botChat,
      message_id: prompt.message_id,
      callback_data: 'human',
    });
    await activity.waitFor(
      { method: 'approveChatJoinRequest', chat_id: supergroup.id, ok: true },
      { after: beforeRequest },
    );
    assertEquals(await account.getChatJoinRequests({ chat: groupChat }), []);
  });
});
```

The emulator never ends the contact window by itself. A test ends it as five minutes passing does
with `session.expireJoinRequesterContact`, naming the supergroup's chat ID and the requester's
`userId`, which answers the still pending request with its contact `expired`; the bots that never
were started then fail with `chat not found` again.

## Member limits

A link created with `member_limit` admits that many users who joined through it and are still
members. Once its places are taken, `joinChatByInviteLink` rejects with an `EmulationClientError`
whose `status` is `410`; a member that leaves frees its place.
[Member limits](../../features/invite-links.md#member-limits) explains what counts.

```ts
import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@^1';
import type { ChatInviteLink } from 'npm:grammy@^1.46.0/types';
import { EmulationClientError } from '../../../clients/typescript/mod.ts';
import { withBotFixture } from './bot_fixture.ts';

Deno.test('a link with a member limit admits one member at a time', async () => {
  await withBotFixture({
    handlers: (bot) => {
      bot.on('my_chat_member', async (ctx) => {
        const member = ctx.myChatMember.new_chat_member;
        if (member.status === 'administrator' && member.can_invite_users) {
          await ctx.createChatInviteLink({ name: 'One seat', member_limit: 1 });
        }
      });
    },
  }, async ({ session, botProfile, account, activity }) => {
    const supergroup = await account.createSupergroup({ title: 'Book club' });
    const groupChat = { type: 'supergroup', chatId: supergroup.id } as const;
    await account.addChatMember({ chat: groupChat, userId: botProfile.id });
    const beforePromotion = await activity.position();
    await account.promoteChatMember({
      chat: groupChat,
      userId: botProfile.id,
      rights: { can_invite_users: true },
    });
    const created = await activity.waitFor(
      { method: 'createChatInviteLink', chat_id: supergroup.id, ok: true },
      { after: beforePromotion },
    );
    assert(created.answer.ok);
    const { invite_link: inviteLink } = created.answer.result as ChatInviteLink;

    const { account: grace } = await session.createAccount({ first_name: 'Grace' });
    const { account: heidi } = await session.createAccount({ first_name: 'Heidi' });
    await grace.joinChatByInviteLink({ inviteLink });

    // Grace holds the link's only place, so it refuses Heidi.
    const refusal = await assertRejects(
      () => heidi.joinChatByInviteLink({ inviteLink }),
      EmulationClientError,
    );
    assertEquals(refusal.status, 410);

    await grace.leaveChat({ chat: groupChat });
    const { outcome } = await heidi.joinChatByInviteLink({ inviteLink });
    assertEquals(outcome, 'joined');
  });
});
```

## Expiry dates

The emulator never lets a link's `expire_date` arrive by itself. A test makes it arrive with
`session.expireChatInviteLink`, naming the supergroup's chat ID and the whole link, which answers
the link as the owner sees it, with `is_expired` set. The link then refuses every user with `410`
until the bot [edits](#editing-and-revoking-links) it, which gives it a new expiry date or none;
members who joined through it stay, and no bot receives an update. [Test controls](test-controls.md)
lists the other moments a test controls this way.

```ts
import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@^1';
import type { ChatInviteLink } from 'npm:grammy@^1.46.0/types';
import { EmulationClientError } from '../../../clients/typescript/mod.ts';
import { withBotFixture } from './bot_fixture.ts';

Deno.test('a link stops admitting users once the test makes its expiry date arrive', async () => {
  await withBotFixture({
    handlers: (bot) => {
      bot.on('my_chat_member', async (ctx) => {
        const member = ctx.myChatMember.new_chat_member;
        if (member.status === 'administrator' && member.can_invite_users) {
          const inOneDay = Math.floor(Date.now() / 1_000) + 24 * 60 * 60;
          await ctx.createChatInviteLink({ name: 'Today only', expire_date: inOneDay });
        }
      });
    },
  }, async ({ session, botProfile, account, activity }) => {
    const supergroup = await account.createSupergroup({ title: 'Book club' });
    const groupChat = { type: 'supergroup', chatId: supergroup.id } as const;
    await account.addChatMember({ chat: groupChat, userId: botProfile.id });
    const beforePromotion = await activity.position();
    await account.promoteChatMember({
      chat: groupChat,
      userId: botProfile.id,
      rights: { can_invite_users: true },
    });
    const created = await activity.waitFor(
      { method: 'createChatInviteLink', chat_id: supergroup.id, ok: true },
      { after: beforePromotion },
    );
    assert(created.answer.ok);
    const { invite_link: inviteLink } = created.answer.result as ChatInviteLink;

    const { account: grace } = await session.createAccount({ first_name: 'Grace' });
    await grace.joinChatByInviteLink({ inviteLink });

    const expired = await session.expireChatInviteLink({ chatId: supergroup.id, inviteLink });
    assertEquals(expired.is_expired, true);
    assertEquals(expired.member_count, 1);

    const { account: heidi } = await session.createAccount({ first_name: 'Heidi' });
    const refusal = await assertRejects(
      () => heidi.joinChatByInviteLink({ inviteLink }),
      EmulationClientError,
    );
    assertEquals(refusal.status, 410);
  });
});
```

## Editing and revoking links

The bot that created a link changes it with `editChatInviteLink` and ends it with
`revokeChatInviteLink`; both answer the link as a `ChatInviteLink`. An edit replaces every setting,
so a bot that changes one setting passes the others again. The new settings apply to later uses of
the link only. A revoked link refuses every user with `410` and has `is_revoked` set in the owner's
`getChatInviteLinks`. Members who joined through a link stay after either, and pending join requests
stay pending for the bot to decide.
[Editing and revoking links](../../features/invite-links.md#editing-and-revoking-links) lists the
errors and what happens to requests sent through a changed link.

In this example, the owner switches the bot's open link to approval and later closes it with
commands in the supergroup:

```ts
import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@^1';
import type { ChatInviteLink } from 'npm:grammy@^1.46.0/types';
import { EmulationClientError } from '../../../clients/typescript/mod.ts';
import { withBotFixture } from './bot_fixture.ts';

Deno.test('the bot switches its link to approval, then revokes it', async () => {
  let inviteLink: string | undefined;
  await withBotFixture({
    handlers: (bot) => {
      bot.on('my_chat_member', async (ctx) => {
        const member = ctx.myChatMember.new_chat_member;
        if (member.status === 'administrator' && member.can_invite_users) {
          inviteLink = (await ctx.createChatInviteLink({ name: 'Open door' })).invite_link;
        }
      });
      bot.command('approval', async (ctx) => {
        if (inviteLink !== undefined) {
          await ctx.editChatInviteLink(inviteLink, { name: 'Apply', creates_join_request: true });
        }
      });
      bot.command('close', async (ctx) => {
        if (inviteLink !== undefined) {
          await ctx.revokeChatInviteLink(inviteLink);
        }
      });
    },
  }, async ({ session, botProfile, account, activity }) => {
    const supergroup = await account.createSupergroup({ title: 'Book club' });
    const groupChat = { type: 'supergroup', chatId: supergroup.id } as const;
    await account.addChatMember({ chat: groupChat, userId: botProfile.id });
    const beforePromotion = await activity.position();
    await account.promoteChatMember({
      chat: groupChat,
      userId: botProfile.id,
      rights: { can_invite_users: true },
    });
    const created = await activity.waitFor(
      { method: 'createChatInviteLink', chat_id: supergroup.id, ok: true },
      { after: beforePromotion },
    );
    assert(created.answer.ok);
    const link = (created.answer.result as ChatInviteLink).invite_link;

    const { account: grace } = await session.createAccount({ first_name: 'Grace' });
    assertEquals((await grace.joinChatByInviteLink({ inviteLink: link })).outcome, 'joined');

    const beforeEdit = await activity.position();
    await account.sendMessage({ to: groupChat, text: '/approval@test_bot' });
    await activity.waitFor(
      { method: 'editChatInviteLink', chat_id: supergroup.id, ok: true },
      { after: beforeEdit },
    );
    const { account: heidi } = await session.createAccount({ first_name: 'Heidi' });
    const request = await heidi.joinChatByInviteLink({ inviteLink: link });
    assertEquals(request.outcome, 'join_request_sent');

    const beforeRevocation = await activity.position();
    await account.sendMessage({ to: groupChat, text: '/close@test_bot' });
    const revocation = await activity.waitFor(
      { method: 'revokeChatInviteLink', chat_id: supergroup.id, ok: true },
      { after: beforeRevocation },
    );
    assert(revocation.answer.ok);
    assertEquals((revocation.answer.result as ChatInviteLink).is_revoked, true);

    const { account: ivan } = await session.createAccount({ first_name: 'Ivan' });
    const refusal = await assertRejects(
      () => ivan.joinChatByInviteLink({ inviteLink: link }),
      EmulationClientError,
    );
    assertEquals(refusal.status, 410);

    // Grace stays a member, and Heidi's request waits for the bot's decision.
    const [ownerView] = await account.getChatInviteLinks({ chat: groupChat });
    assertEquals(
      [ownerView?.name, ownerView?.member_count, ownerView?.pending_join_request_count],
      ['Apply', 1, 1],
    );
    assertEquals(ownerView?.is_revoked, true);
    const pending = await account.getChatJoinRequests({ chat: groupChat });
    assertEquals(pending.map(({ user_id }) => user_id), [heidi.id]);
  });
});
```
