# TypeScript client walkthrough

[Project README](../README.md) · [Feature coverage](features/README.md)

The client drives virtual accounts and inspects session state. Your bot uses the ordinary Bot API
with its virtual token and `session.botApiRoot` configured as the API root.

This walkthrough shows the available client operations. Run your bot alongside it. An account's
action returns once the bot can receive it, not once the bot has handled it. The session's
[bot activity log](features/bot-activity.md) records the bot's calls, so a test can wait for the bot
to act before inspecting a reply, callback answer, or inline result. A wait settles within its
`timeoutMs` plus one second even when the emulator stalls, and takes a `signal` that cancels it, as
the log's [TypeScript client section](features/bot-activity.md#typescript-client) describes. Each
step that reads the bot's response states the bot behavior it relies on, takes the log's position
before acting, waits for the bot's successful call, and then selects the response by what identifies
it. The photo and album examples also need a local `receipt.png` file, and the video example a local
`clip.mp4` file. The import below assumes the example is saved directly in `docs/`.

Tests can use the TypeScript client instead of constructing emulation server URLs directly:

```ts
import { richMessageToPlainText, TelegramEmulationClient } from '../clients/typescript/mod.ts';

const emulator = new TelegramEmulationClient('http://localhost:8081');
const session = await emulator.createSession();

try {
  const { token, bot } = await session.createBot({
    first_name: 'Test Bot',
    username: 'test_bot',
    supports_inline_queries: true,
  });
  const { account } = await session.createAccount({ first_name: 'Ada' });
  const activity = session.botActivity({ bot_id: bot.id });
  const start = await activity.position();

  const incomingMessage = await account.sendMessage({
    to: { type: 'private', botId: bot.id },
    text: 'Hello!',
  });

  // Run a grammY bot with token and session.botApiRoot as its apiRoot. Its polling receives the
  // message above. Wait for its successful reply before reading the stored history; the entry also
  // holds the parameters the bot sent and the answer it received.
  const greeting = await activity.waitFor(
    { method: 'sendMessage', chat_id: account.id, ok: true },
    { after: start },
  );
  const history = await account.getMessages({
    chat: { type: 'private', botId: bot.id },
  });

  // Press a callback button on the bot's latest message by its label, then read the bot's answer.
  // This step needs a bot whose latest message has a Details button in a row that mentions Potion.
  // `within` narrows a repeated label to the innermost row, list item, or block that mentions the
  // text; a selector that matches no button or several fails and lists the candidates.
  // A selector can also be a predicate over the buttons `listButtons` returns, each with its path
  // and the parts of the message around it. `pressCallbackButton` presses a button by its exact
  // callback data instead.
  const menu = history.findLast(({ from }) => from.id === bot.id);
  if (menu !== undefined) {
    // Read what a rich message shows as plain text, including collapsed content.
    if (menu.rich_message !== undefined) console.log(richMessageToPlainText(menu.rich_message));
    const callbackQuery = await account.pressButton({
      chat: { type: 'private', botId: bot.id },
      message_id: menu.message_id,
      button: { label: 'Details', within: 'Potion' },
    });
    await activity.waitFor(
      {
        method: 'answerCallbackQuery',
        ok: true,
        parameters: { callback_query_id: callbackQuery.id },
      },
      { after: greeting },
    );
    const { answer } = await account.getCallbackQuery(callbackQuery.id);
    console.log(answer?.text);
  }

  // Press a button of the reply keyboard the account's client shows, which sends its text.
  const replyInterface = await account.getReplyInterface({
    chat: { type: 'private', botId: bot.id },
  });
  if (replyInterface?.type === 'keyboard') {
    await account.pressReplyKeyboardButton({
      chat: { type: 'private', botId: bot.id },
      text: replyInterface.keyboard[0][0].text,
    });
  }

  // Send the bot a photo, then read the bytes of the document the bot replies to it with. This step
  // needs a bot that answers a photo by calling sendDocument with only the photo's message_id as
  // reply_parameters, as grammY's
  // `ctx.replyWithDocument(file, { reply_parameters: { message_id: ctx.msg.message_id } })` does.
  // Until the bot has replied, the latest message may still be the account's own upload, so the
  // reply is selected by the message it replies to, after its call has succeeded.
  const beforePhoto = await activity.position();
  const photo = await account.sendPhoto({
    to: { type: 'private', botId: bot.id },
    photo: await Deno.readFile('receipt.png'),
    caption: 'My receipt',
  });
  await activity.waitFor(
    {
      method: 'sendDocument',
      chat_id: account.id,
      ok: true,
      parameters: { reply_parameters: JSON.stringify({ message_id: photo.message_id }) },
    },
    { after: beforePhoto },
  );
  const photoReply = (await account.getMessages({ chat: { type: 'private', botId: bot.id } }))
    .find(({ from, reply_to_message, document }) =>
      from.id === bot.id && reply_to_message?.message_id === photo.message_id &&
      document !== undefined
    );
  if (photoReply?.document === undefined) {
    throw new Error('Expected the bot to reply to the photo with a document');
  }
  const replyContent = await session.downloadFile(photoReply.document.file_unique_id);
  console.log(replyContent.length, photo.photo?.[0].width);

  // Send the bot a video, whose duration and dimensions the account's client defines; the
  // emulator keeps them as given and never reads the content.
  const clip = await account.sendVideo({
    to: { type: 'private', botId: bot.id },
    video: await Deno.readFile('clip.mp4'),
    file_name: 'clip.mp4',
    duration: 12,
    width: 1280,
    height: 720,
  });
  console.log(clip.video?.duration);

  // Send the receipt twice as an album. The bot receives each photo as a message, and both
  // messages share a media_group_id.
  const receipt = await Deno.readFile('receipt.png');
  const album = await account.sendMediaGroup({
    to: { type: 'private', botId: bot.id },
    media: [{ photo: receipt, caption: 'Both copies' }, { photo: receipt }],
  });
  console.log(album.map(({ media_group_id }) => media_group_id));

  // Share a contact the account writes, which shows no Telegram user. An account created with a
  // phone_number also shares its own contact, which shows the account as its user, with
  // shareOwnContact or by pressing a request_contact button.
  await account.sendContact({
    to: { type: 'private', botId: bot.id },
    contact: { phone_number: '+1 555 0199', first_name: 'Grace', last_name: 'Hopper' },
  });

  // Share a static location; pressing a request_location button takes the location to report.
  await account.sendLocation({
    to: { type: 'private', botId: bot.id },
    location: { latitude: 51.5007, longitude: -0.1246, horizontal_accuracy: 10 },
  });

  // Vote in the poll the bot sends. This step needs a bot that answers /poll by calling sendPoll
  // with only the command's message_id as reply_parameters. The answer comes back with the poll's
  // message as it is now, whose options show their voter counts.
  const beforePollCommand = await activity.position();
  const pollCommand = await account.sendMessage({
    to: { type: 'private', botId: bot.id },
    text: '/poll',
  });
  await activity.waitFor(
    {
      method: 'sendPoll',
      chat_id: account.id,
      ok: true,
      parameters: { reply_parameters: JSON.stringify({ message_id: pollCommand.message_id }) },
    },
    { after: beforePollCommand },
  );
  const pollMessage = (await account.getMessages({ chat: { type: 'private', botId: bot.id } }))
    .find(({ from, reply_to_message, poll }) =>
      from.id === bot.id && reply_to_message?.message_id === pollCommand.message_id &&
      poll !== undefined
    );
  if (pollMessage?.poll === undefined) {
    throw new Error('Expected the bot to reply to /poll with a poll');
  }
  const { poll_answer, message } = await account.answerPoll({
    chat: { type: 'private', botId: bot.id },
    message_id: pollMessage.message_id,
    option_ids: [0],
  });
  console.log(poll_answer.option_persistent_ids, message.poll?.total_voter_count);

  // Edit the account's first message, which sends the bot an edited_message update. Accounts
  // format text and captions with entities, as bots specify them.
  await account.editMessage({
    chat: { type: 'private', botId: bot.id },
    message_id: incomingMessage.message_id,
    text: 'Hello again!',
    entities: [{ type: 'bold', offset: 0, length: 5 }],
  });

  // Block the bot. It receives a my_chat_member update, and its messages to the account fail
  // with 403 until the account unblocks it.
  await account.blockBot({ botId: bot.id });
  await account.unblockBot({ botId: bot.id });

  // Read the command menu and the menu button the account sees in its chat with the bot.
  const commands = await account.getBotCommands({ chat: { type: 'private', botId: bot.id } });
  console.log(commands.map(({ command }) => `/${command}`));
  const menuButton = await account.getMenuButton({ chat: { type: 'private', botId: bot.id } });
  console.log(menuButton.type);

  // Create a supergroup, add the bot, and send it a command there. The bot receives a
  // my_chat_member update and a new_chat_members service message when it is added, and, in privacy
  // mode, only messages addressed to it.
  const supergroup = await account.createSupergroup({ title: 'Team' });
  const groupChat = { type: 'supergroup', chatId: supergroup.id } as const;
  await account.addChatMember({ chat: groupChat, userId: bot.id });
  const groupCommand = await account.sendMessage({ to: groupChat, text: '/start@test_bot' });
  const groupHistory = await account.getMessages({ chat: groupChat });
  console.log(groupHistory.map(({ from, text }) => `${from.first_name}: ${text ?? '(service)'}`));

  // Pin the command. The bot receives the pin's service message with pinned_message; a chat pins
  // any number of messages, and getChat shows bots the newest.
  await account.pinMessage({ chat: groupChat, message_id: groupCommand.message_id });
  console.log((await account.getPinnedMessages({ chat: groupChat })).length);

  // Forward the command to the bot's private chat. The bot receives it with its forward_origin,
  // which names the original sender, or gives only their name when they have private forwards.
  const forwardedCommand = await account.forwardMessage({
    from: groupChat,
    message_id: groupCommand.message_id,
    to: { type: 'private', botId: bot.id },
  });
  const origin = forwardedCommand.forward_origin;
  if (origin?.type === 'user') {
    console.log(origin.sender_user.first_name);
  } else if (origin?.type === 'hidden_user') {
    console.log(origin.sender_user_name);
  }

  // Type an inline query for the bot in the supergroup, read the bot's answer once it has
  // answered, and send a result, which appears in the supergroup with via_bot.
  const inlineQuery = await account.sendInlineQuery({
    bot_id: bot.id,
    chat: groupChat,
    query: 'cats',
  });
  await activity.waitFor(
    { method: 'answerInlineQuery', ok: true, parameters: { inline_query_id: inlineQuery.id } },
    { after: start },
  );
  const answeredQuery = await account.getInlineQuery(inlineQuery.id);
  const firstResult = answeredQuery.answer?.results[0];
  if (firstResult !== undefined) {
    await account.chooseInlineQueryResult({
      inline_query_id: inlineQuery.id,
      result_id: firstResult.id,
    });
  }

  // Promote the bot to administrator. It then receives every message of the supergroup, deletes
  // any, and bans spammers with banChatMember; demoting it takes its rights away again.
  await account.promoteChatMember({
    chat: groupChat,
    userId: bot.id,
    rights: { can_delete_messages: true, can_restrict_members: true },
  });
  // Inspect the administrators, who promoted each, and whom this account may edit.
  const administrators = await account.getChatAdministrators({ chat: groupChat });
  console.log(administrators);
  await account.demoteChatMember({ chat: groupChat, userId: bot.id });

  // Restrict the bot to text for an hour: its photos, polls and other content fail with Telegram's
  // errors until the restriction ends, which the test makes arrive.
  await account.restrictChatMember({
    chat: groupChat,
    userId: bot.id,
    permissions: { can_send_messages: true },
    untilDate: Math.floor(Date.now() / 1_000) + 3_600,
  });
  await session.expireChatMemberRestriction({ chatId: groupChat.chatId, userId: bot.id });

  // A restriction without an end lasts until the owner lifts it.
  await account.restrictChatMember({ chat: groupChat, userId: bot.id, permissions: {} });
  await account.liftChatMemberRestriction({ chat: groupChat, userId: bot.id });

  // Let the bot create invite links. This step needs a bot that creates a link for the supergroup
  // once it may. Once it has, another account uses the link; a link with an expiry date admits
  // nobody once the test makes that date arrive.
  const beforeInviting = await activity.position();
  await account.promoteChatMember({
    chat: groupChat,
    userId: bot.id,
    rights: { can_invite_users: true },
  });
  await activity.waitFor(
    { method: 'createChatInviteLink', chat_id: groupChat.chatId, ok: true },
    { after: beforeInviting },
  );
  // The owner sees the supergroup's links in the order bots created them, with each one's creator.
  const link = (await account.getChatInviteLinks({ chat: groupChat }))
    .findLast(({ creator_user_id }) => creator_user_id === bot.id);
  if (link !== undefined) {
    const { account: friend } = await session.createAccount({ first_name: 'Grace' });
    // The friend joins, or, through a link the bot created with creates_join_request, stays
    // outside with a pending request, which the bot receives as a chat_join_request update and
    // decides with approveChatJoinRequest or declineChatJoinRequest.
    const { outcome } = await friend.joinChatByInviteLink({ inviteLink: link.invite_link });
    console.log(outcome, await account.getChatJoinRequests({ chat: groupChat }));
    if (link.expire_date !== undefined) {
      await session.expireChatInviteLink({
        chatId: groupChat.chatId,
        inviteLink: link.invite_link,
      });
    }
    console.log(await account.getChatInviteLinks({ chat: groupChat }));
  }

  // Let members send only text by default. The owner and administrators are exempt, and bots see
  // the defaults as permissions in getChat.
  await account.setChatPermissions({ chat: groupChat, permissions: { can_send_messages: true } });

  // Remove the bot, which bans it: it receives a my_chat_member update showing it as kicked, and
  // its requests to the supergroup fail with 403 until the owner adds it again.
  await account.removeChatMember({ chat: groupChat, userId: bot.id });
  console.log(token, session.botApiRoot, incomingMessage, history);
} finally {
  await session.end();
}
```
