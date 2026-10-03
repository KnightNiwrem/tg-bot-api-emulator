# TypeScript client walkthrough

[Project README](../README.md) · [Feature coverage](features/README.md)

The client drives virtual accounts and inspects session state. Your bot uses the ordinary Bot API
with its virtual token and `session.botApiRoot` configured as the API root.

This walkthrough shows the available client operations. Run your bot alongside it. The session's
[bot activity log](features/bot-activity.md) records the bot's calls, so a test can wait for the bot
to act before inspecting a reply, callback answer, or inline result. The photo and album examples
also need a local `receipt.png` file, and the video example a local `clip.mp4` file. The import
below assumes the example is saved directly in `docs/`.

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
  // message above. Wait for its reply before reading the stored history; the entry also holds the
  // parameters the bot sent and the answer it received.
  const greeting = await activity.waitFor(
    { method: 'sendMessage', chat_id: account.id },
    { after: start },
  );
  const history = await account.getMessages({
    chat: { type: 'private', botId: bot.id },
  });

  // Press a callback button on the bot's latest reply by its label, then read the bot's answer.
  // `within` narrows a repeated label to the innermost row, list item, or block that mentions the
  // text; a selector that matches no button or several fails and lists the candidates.
  // A selector can also be a predicate over the buttons `listButtons` returns, each with its path
  // and the parts of the message around it. `pressCallbackButton` presses a button by its exact
  // callback data instead.
  const menu = history.at(-1);
  if (menu !== undefined) {
    // Read what a rich message shows as plain text, including collapsed content.
    if (menu.rich_message !== undefined) console.log(richMessageToPlainText(menu.rich_message));
    const callbackQuery = await account.pressButton({
      chat: { type: 'private', botId: bot.id },
      message_id: menu.message_id,
      button: { label: 'Details', within: 'Potion' },
    });
    await activity.waitFor(
      { method: 'answerCallbackQuery', parameters: { callback_query_id: callbackQuery.id } },
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

  // Send the bot a photo, then read the bytes of the file the bot's reply carries, if any.
  const photo = await account.sendPhoto({
    to: { type: 'private', botId: bot.id },
    photo: await Deno.readFile('receipt.png'),
    caption: 'My receipt',
  });
  const reply = (await account.getMessages({ chat: { type: 'private', botId: bot.id } })).at(-1);
  const replyFile = reply?.document ?? reply?.video ?? reply?.voice ?? reply?.photo?.at(-1);
  if (replyFile !== undefined) {
    const content = await session.downloadFile(replyFile.file_unique_id);
    console.log(content.length, photo.photo?.[0].width);
  }

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

  // Vote in the latest poll the bot sent, if any. The answer comes back with the poll's message
  // as it is now, whose options show their voter counts.
  const pollMessage = (await account.getMessages({ chat: { type: 'private', botId: bot.id } }))
    .findLast(({ poll, from }) => poll !== undefined && from.id === bot.id);
  if (pollMessage !== undefined) {
    const { poll_answer, message } = await account.answerPoll({
      chat: { type: 'private', botId: bot.id },
      message_id: pollMessage.message_id,
      option_ids: [0],
    });
    console.log(poll_answer.option_persistent_ids, message.poll?.total_voter_count);
  }

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

  // Pin the command. A chat pins any number of messages, and getChat shows bots the newest.
  await account.pinMessage({ chat: groupChat, message_id: groupCommand.message_id });
  console.log((await account.getPinnedMessages({ chat: groupChat })).length);

  // Forward the command to the bot's private chat. The bot receives it with its forward_origin.
  const forwardedCommand = await account.forwardMessage({
    from: groupChat,
    message_id: groupCommand.message_id,
    to: { type: 'private', botId: bot.id },
  });
  console.log(forwardedCommand.forward_origin?.sender_user.first_name);

  // Type an inline query for the bot in the supergroup, read the bot's answer once it has
  // answered, and send a result, which appears in the supergroup with via_bot.
  const inlineQuery = await account.sendInlineQuery({
    bot_id: bot.id,
    chat: groupChat,
    query: 'cats',
  });
  await activity.waitFor(
    { method: 'answerInlineQuery', parameters: { inline_query_id: inlineQuery.id } },
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
