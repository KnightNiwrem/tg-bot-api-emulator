# API index

[Guide index](README.md)

Every operation of the TypeScript client, grouped by what it is for, with the guide page that shows
it in use. Each operation's documentation comment in
[`clients/typescript/types.ts`](../../../clients/typescript/types.ts) and
[`emulation_session_client.ts`](../../../clients/typescript/emulation_session_client.ts) states its
exact contract.

## Client and session

| Operation                                      | Purpose                                                    | Guide                                                       |
| ---------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------- |
| `new TelegramEmulationClient(url, { fetch? })` | Connects to an emulator                                    | [Getting started](getting-started.md)                       |
| `createSession({ upload_profile? })`           | Creates an isolated session                                | [Sessions and fixtures](sessions-and-fixtures.md)           |
| `session.id`, `botApiRoot`, `uploadProfile`    | The session's identity, Bot API root and upload limits     | [Sessions and fixtures](sessions-and-fixtures.md)           |
| `session.createBot(input)`                     | Registers a bot; returns its token and profile             | [Sessions and fixtures](sessions-and-fixtures.md)           |
| `session.createAccount(input)`                 | Registers an account; returns its client                   | [Sessions and fixtures](sessions-and-fixtures.md)           |
| `session.getMe(token)`                         | Reads a bot's profile as `getMe` returns it                | [Sessions and fixtures](sessions-and-fixtures.md)           |
| `session.end()`                                | Discards the session and everything in it                  | [Sessions and fixtures](sessions-and-fixtures.md)           |
| `session.downloadFile(fileUniqueId)`           | Reads the content of a file of the session's messages      | [Media and files](media-and-files.md)                       |
| `session.registerWebResource(input)`           | Serves content at a URL of the session's emulated web      | [Test controls](test-controls.md)                           |
| `session.queueRateLimitResponses(input)`       | Makes a bot's next calls fail with `429 Too Many Requests` | [Test controls](test-controls.md)                           |
| `session.getRateLimitResponses(botId)`         | Lists the rate limit answers still queued                  | [Test controls](test-controls.md)                           |
| `session.expirePoll(pollId)`                   | Closes a poll as its closing time arriving does            | [Polls](polls.md)                                           |
| `session.expireChatMemberRestriction(input)`   | Ends a temporary restriction                               | [Permissions and moderation](permissions-and-moderation.md) |
| `session.expireChatInviteLink(input)`          | Makes an invite link's expiry date arrive                  | [Invite links](invite-links.md)                             |

## Bot activity

| Operation                                           | Purpose                                             | Guide                                               |
| --------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------- |
| `session.botActivity(filter?, options?)`            | A view of the log of bot calls and updates          | [Observing bot behavior](observing-bot-behavior.md) |
| `activity.position()`                               | The latest position, taken before acting            | [Observing bot behavior](observing-bot-behavior.md) |
| `activity.waitFor(filter, { after })`               | Waits for the first matching entry after a position | [Observing bot behavior](observing-bot-behavior.md) |
| `activity.assertNone(filter, { after, before })`    | Checks that a recorded range has no matching entry  | [Observing bot behavior](observing-bot-behavior.md) |
| `activity.cursor({ after })`, `cursor.next(filter)` | Waits for a sequence of entries in order            | [Observing bot behavior](observing-bot-behavior.md) |
| `latest(...positions)`                              | The latest of several positions or entries          | [Observing bot behavior](observing-bot-behavior.md) |
| `BotActivityTimeoutError`                           | A wait found no matching entry in time              | [Observing bot behavior](observing-bot-behavior.md) |
| `UnexpectedBotActivityError`                        | `assertNone` found matching entries                 | [Observing bot behavior](observing-bot-behavior.md) |

## Account: messages

| Operation                    | Purpose                                               | Guide                                 |
| ---------------------------- | ----------------------------------------------------- | ------------------------------------- |
| `sendMessage`                | Sends text, optionally formatted or as a reply        | [Messages](messages.md)               |
| `getMessages`                | Reads a chat's history, oldest first                  | [Messages](messages.md)               |
| `editMessage`                | Edits the text of the account's message               | [Messages](messages.md)               |
| `editMessageCaption`         | Edits the caption of the account's media message      | [Media and files](media-and-files.md) |
| `deleteMessage`              | Deletes a message for everyone                        | [Messages](messages.md)               |
| `forwardMessage`             | Forwards a message to another chat                    | [Messages](messages.md)               |
| `pinMessage`, `unpinMessage` | Pins and unpins messages                              | [Messages](messages.md)               |
| `getPinnedMessages`          | Reads a chat's pinned messages                        | [Messages](messages.md)               |
| `blockBot`, `unblockBot`     | Stops and restarts a bot                              | [Messages](messages.md)               |
| `getNotifications`           | Reads the notifications the account's app shows       | [Messages](messages.md)               |
| `getChatActions`             | Reads the chat actions, such as typing, the app shows | [Messages](messages.md)               |

## Account: media, contacts and locations

| Operation         | Purpose                                            | Guide                                               |
| ----------------- | -------------------------------------------------- | --------------------------------------------------- |
| `sendPhoto`       | Sends a photo                                      | [Media and files](media-and-files.md)               |
| `sendDocument`    | Sends a file as a document                         | [Media and files](media-and-files.md)               |
| `sendVideo`       | Sends a video with the duration and size it states | [Media and files](media-and-files.md)               |
| `sendVoice`       | Sends a voice note with the duration it states     | [Media and files](media-and-files.md)               |
| `sendMediaGroup`  | Sends an album                                     | [Media and files](media-and-files.md)               |
| `sendContact`     | Shares a contact the account writes                | [Contacts and locations](contacts-and-locations.md) |
| `shareOwnContact` | Shares the account's own phone number              | [Contacts and locations](contacts-and-locations.md) |
| `sendLocation`    | Shares a static location                           | [Contacts and locations](contacts-and-locations.md) |

## Account: buttons, menus and rich messages

| Operation                   | Purpose                                                      | Guide                                     |
| --------------------------- | ------------------------------------------------------------ | ----------------------------------------- |
| `pressButton`               | Presses a callback button chosen by its label or a predicate | [Buttons and menus](buttons-and-menus.md) |
| `pressCallbackButton`       | Presses a callback button by its callback data               | [Buttons and menus](buttons-and-menus.md) |
| `getCallbackQuery`          | Reads a callback query with the bot's answer                 | [Buttons and menus](buttons-and-menus.md) |
| `listButtons`, `findButton` | Lists a message's buttons, or finds one, without pressing it | [Buttons and menus](buttons-and-menus.md) |
| `ButtonSelectionError`      | A selector matched no button, or several                     | [Buttons and menus](buttons-and-menus.md) |
| `getReplyInterface`         | Reads the reply keyboard or forced reply the app shows       | [Buttons and menus](buttons-and-menus.md) |
| `pressReplyKeyboardButton`  | Presses a reply keyboard button                              | [Buttons and menus](buttons-and-menus.md) |
| `getBotCommands`            | Reads the commands the app suggests in a private chat        | [Buttons and menus](buttons-and-menus.md) |
| `getSupergroupBotCommands`  | Reads the commands the app suggests in a supergroup          | [Buttons and menus](buttons-and-menus.md) |
| `getMenuButton`             | Reads the menu button the app shows                          | [Buttons and menus](buttons-and-menus.md) |
| `richMessageToPlainText`    | Reads what a rich message shows as plain text                | [Rich messages](rich-messages.md)         |
| `richTextToPlainText`       | Reads a piece of rich text as plain text                     | [Rich messages](rich-messages.md)         |

## Account: polls and inline mode

| Operation                 | Purpose                                          | Guide                         |
| ------------------------- | ------------------------------------------------ | ----------------------------- |
| `answerPoll`              | Votes in a poll, or changes the vote             | [Polls](polls.md)             |
| `getPollAnswer`           | Reads the account's vote with the poll's message | [Polls](polls.md)             |
| `retractPollAnswer`       | Retracts the account's vote                      | [Polls](polls.md)             |
| `sendInlineQuery`         | Types an inline query for a bot                  | [Inline mode](inline-mode.md) |
| `getInlineQuery`          | Reads an inline query with the bot's answer      | [Inline mode](inline-mode.md) |
| `chooseInlineQueryResult` | Sends a result of the bot's answer               | [Inline mode](inline-mode.md) |

## Account: supergroups

| Operation                     | Purpose                                           | Guide                                                       |
| ----------------------------- | ------------------------------------------------- | ----------------------------------------------------------- |
| `createSupergroup`            | Creates a supergroup the account owns             | [Supergroups](supergroups.md)                               |
| `addChatMember`               | Adds an account or a bot                          | [Supergroups](supergroups.md)                               |
| `removeChatMember`            | Removes and bans a member                         | [Supergroups](supergroups.md)                               |
| `joinChat`                    | Joins a public supergroup                         | [Supergroups](supergroups.md)                               |
| `leaveChat`                   | Leaves a supergroup                               | [Supergroups](supergroups.md)                               |
| `changeSupergroupTitle`       | Changes the title                                 | [Supergroups](supergroups.md)                               |
| `changeSupergroupDescription` | Changes the description                           | [Supergroups](supergroups.md)                               |
| `setContentProtection`        | Protects the supergroup's content from forwarding | [Supergroups](supergroups.md)                               |
| `promoteChatMember`           | Makes a member an administrator with rights       | [Permissions and moderation](permissions-and-moderation.md) |
| `demoteChatMember`            | Makes an administrator a member again             | [Permissions and moderation](permissions-and-moderation.md) |
| `getChatAdministrators`       | Reads the owner and administrators                | [Permissions and moderation](permissions-and-moderation.md) |
| `setCustomTitle`              | Sets an administrator's custom title              | [Permissions and moderation](permissions-and-moderation.md) |
| `restrictChatMember`          | Restricts what a member may do                    | [Permissions and moderation](permissions-and-moderation.md) |
| `liftChatMemberRestriction`   | Lifts a restriction                               | [Permissions and moderation](permissions-and-moderation.md) |
| `setChatPermissions`          | Sets what members may do by default               | [Permissions and moderation](permissions-and-moderation.md) |
| `joinChatByInviteLink`        | Joins, or asks to join, through an invite link    | [Invite links](invite-links.md)                             |
| `getChatInviteLinks`          | Reads the supergroup's invite links               | [Invite links](invite-links.md)                             |
| `getChatJoinRequests`         | Reads the pending join requests                   | [Invite links](invite-links.md)                             |

## Errors

| Error                        | Raised when                                                               | Guide                                 |
| ---------------------------- | ------------------------------------------------------------------------- | ------------------------------------- |
| `EmulationClientError`       | The emulator refuses a request, or a request fails or breaks its contract | [Troubleshooting](troubleshooting.md) |
| `BotActivityTimeoutError`    | A wait finds no matching entry in time                                    | [Troubleshooting](troubleshooting.md) |
| `UnexpectedBotActivityError` | `assertNone` finds matching entries                                       | [Troubleshooting](troubleshooting.md) |
| `ButtonSelectionError`       | A button selector matches no button, or several                           | [Troubleshooting](troubleshooting.md) |
