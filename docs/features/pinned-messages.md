# Pinned messages

[Feature index and comparison baseline](README.md) · [Messages](messages.md) ·
[Supergroups](supergroups.md)

## Capability matrix

| Area            | Supported                                                                                                 | Not supported                                                                           |
| --------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Pinned messages | Any number per chat, in private chats with bots and supergroups                                           | Basic groups, channels, forum topics, business chats                                    |
| Account actions | Pinning and unpinning messages, reading the pinned messages newest first                                  | Pinning only for itself in a private chat, choosing whether a supergroup pin notifies   |
| Bot API         | `pinned_message` in `getChat`                                                                             | `pinChatMessage`, `unpinChatMessage`, `unpinAllChatMessages`, `pinned_message` messages |
| Permissions     | `can_pin_messages` in supergroups, as the [permission evaluator](supergroups.md#member-restrictions) sets | Pinning rights of channels and basic groups                                             |

## Pinned messages of a chat

As Telegram's [pinned messages][api-pin] do, a chat pins any number of its messages, each of which
carries a pinned mark; both participants of a private chat, and every member of a supergroup, see
the same pinned messages. Pinning a message changes nothing else about it: it keeps its ID, content
and edits, and bots receive no update for the pin. Deleting a message unpins it. Service messages,
such as a member joining, are never pinned.

## Account pins

Accounts pin and unpin a message through the emulation API with
`PUT /sessions/{sessionId}/accounts/{accountId}/conversations/private/{botId}/pinned-messages/{messageId}`
and `DELETE` on the same path, or, in a supergroup, under
`/conversations/supergroup/{chatId}/pinned-messages/{messageId}`. Messages are addressed by their
IDs as message history shows them. The TypeScript client offers `pinMessage` and `unpinMessage`.

Either participant of a private chat pins any of its messages, as the Bot API documents for private
chats. In a supergroup, the account needs the `can_pin_messages` permission, as TDLib's
[`can_pin_messages`][can-pin-messages] requires once the
[permission evaluator](supergroups.md#member-restrictions) applies the supergroup's default
permissions: the owner holds it, an administrator holds it with that right or as the default
permissions grant it, and other members as the default permissions and their restriction grant it.
Unpinning needs the same permission.

A request is checked as TDLib's [`pin_dialog_message`][pin-dialog-message] checks it: the account
must reach the chat and find the message there (`404` otherwise, and `403` for a non-member of the
supergroup); then it must hold the permission (`403`), and, as [`can_pin_message`][can-pin-message]
refuses, the message must not be a service message (`400`), which applies to unpinning too. Pinning
a pinned message, or unpinning one that is not pinned, answers `409` without effect, as Telegram's
servers refuse it with `CHAT_NOT_MODIFIED` (see [comparison limits](#comparison-limits)).

`GET` on `.../pinned-messages`, or the client's `getPinnedMessages`, returns the chat's pinned
messages newest first by sending date, as Telegram's search for pinned messages lists them. Private
messages are shown as the bot sees them, as message history shows them.

## Pinned message in getChat

`getChat` shows the chat's newest pinned message by sending date as `pinned_message`, as the Bot API
documents for `ChatFullInfo`: the official server's [`getChat`][get-chat-pinned] asks TDLib's
[`getChatPinnedMessage`][get-dialog-pinned-message] for the newest pinned message, whose
[`last_pinned_message_id`][update-message-is-pinned] TDLib raises only for a pinned message with a
greater ID. Pinning an older message therefore leaves `pinned_message` unchanged, and unpinning the
newest shows the next newest. As [`JsonChat`][json-chat-pinned] shows it, the pinned message has no
`reply_to_message` of its own. A chat that pins nothing omits the field.

## Real gaps

- **Bot API methods.** `pinChatMessage`, `unpinChatMessage` and `unpinAllChatMessages` are not
  implemented, so bots cannot pin.
- **Pin service messages.** Pins create no service message with `pinned_message`.
- **One-sided pins.** Accounts cannot pin a message of a private chat only for themselves, which
  Telegram's clients allow and the Bot API never does.
- **Pin notifications.** Accounts cannot choose whether a supergroup pin notifies its members.

## Comparison limits

Whether a message is pinned is kept by Telegram's servers. The official
[`messages.updatePinnedMessage`][update-pinned-message-errors] reference lists `CHAT_NOT_MODIFIED`
among its errors, and TDLib's [`UpdateDialogPinnedMessageQuery`][update-pinned-message-query] passes
server errors on, unlike the queries that treat an unchanged chat setting as success; the
open-source code does not show the server's decision itself, so the emulator refuses a pin of a
pinned message and an unpin of a message that is not pinned.

## Local evidence

[Domain model](../../src/types/virtual_message.ts),
[pinning](../../src/services/message_pinning.ts), [storage](../../src/repositories/message.ts),
[`getChat` projection](../../src/projections/bot_api_chat_full_info.ts),
[account routes](../../src/api/sessions/accounts/mod.ts),
[service tests](../../tests/message_pinning_service_test.ts) and
[HTTP tests](../../tests/pinned_messages_api_test.ts).

[api-pin]: https://core.telegram.org/api/pin
[update-pinned-message-errors]: https://core.telegram.org/method/messages.updatePinnedMessage
[can-pin-messages]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/DialogManager.cpp#L2902-L2937
[can-pin-message]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessagesManager.cpp#L23322-L23336
[pin-dialog-message]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessagesManager.cpp#L30527-L30547
[update-pinned-message-query]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessagesManager.cpp#L352-L402
[update-message-is-pinned]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessagesManager.cpp#L8103-L8136
[get-dialog-pinned-message]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessagesManager.cpp#L15211-L15240
[get-chat-pinned]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L7659-L7710
[json-chat-pinned]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L1799-L1805
