# Pinned messages

[Feature index and comparison baseline](README.md) · [Messages](messages.md) ·
[Supergroups](supergroups.md)

## Capability matrix

| Area               | Supported                                                                                                 | Not supported                                                                         |
| ------------------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Pinned messages    | Any number per chat, in private chats with bots and supergroups                                           | Basic groups, channels, forum topics, business chats                                  |
| `pinChatMessage`   | `chat_id`, `message_id`, `disable_notification`                                                           | `business_connection_id`                                                              |
| `unpinChatMessage` | `chat_id`, `message_id`, which may be omitted to unpin the newest pin                                     | `business_connection_id`                                                              |
| Other Bot API      | `pinned_message` in `getChat`, service messages with `pinned_message`                                     | `unpinAllChatMessages`, `unpinAllForumTopicMessages`                                  |
| Account actions    | Pinning and unpinning messages, reading the pinned messages newest first                                  | Pinning only for itself in a private chat, choosing whether a supergroup pin notifies |
| Permissions        | `can_pin_messages` in supergroups, as the [permission evaluator](supergroups.md#member-restrictions) sets | Pinning rights of channels and basic groups                                           |

## Pinned messages of a chat

As Telegram's [pinned messages][api-pin] do, a chat pins any number of its messages, each of which
carries a pinned mark; both participants of a private chat, and every member of a supergroup, see
the same pinned messages. Pinning a message changes nothing else about it: it keeps its ID, content
and edits. Deleting a message unpins it. Service messages, such as a member joining or a pin, are
never pinned.

Each pin, by a bot or an account, is recorded as a service message of the pinner with
`pinned_message`, in private chats and supergroups alike (see
[service messages](#service-messages)). Unpinning records nothing, as Telegram has no service
message for it.

## Pinning with the Bot API

`pinChatMessage` pins a message of the bot's chat, read as the official server's
[`process_pin_chat_message_query`][pin-query] reads it. `unpinChatMessage` unpins one, and, as
[`process_unpin_chat_message_query`][unpin-query] does without a `message_id`, or with 0, unpins the
chat's newest pinned message, which `getChatPinnedMessage` finds. Both answer `True`.

In a private chat, the bot pins and unpins any message either participant wrote, as the Bot API
documents for private chats; the account must have started the chat. In a supergroup, the bot needs
the `can_pin_messages` permission, which, as the
[permission evaluator](supergroups.md#member-restrictions) decides, a bot holds only as an
administrator with that right, never from the default permissions, as TDLib's
[`can_pin_messages`][can-pin-messages] requires.

A request is checked in the order of the official server's [`check_message`][check-message] and
TDLib's [`pin_dialog_message`][pin-dialog-message] and [`can_pin_message`][can-pin-message], which
an unpin passes through too:

| Check                                                                | Error, after `Bad Request:`                                         |
| -------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `chat_id` is missing                                                 | `chat_id is empty`                                                  |
| The bot cannot address the chat, as for `sendMessage`                | `chat not found`, or `403` for a supergroup it left                 |
| `pinChatMessage`'s `message_id` is missing, not positive, or unknown | `message to pin not found`                                          |
| `unpinChatMessage`'s positive `message_id` is unknown                | `message to unpin not found`                                        |
| Without a `message_id`, the chat pins nothing                        | `message to unpin not found`, as [the server][unpin-target] answers |
| The bot lacks `can_pin_messages` in a supergroup                     | `not enough rights to manage pinned messages in the chat`           |
| The message is a service message, also for an unpin                  | `service messages can't be pinned`                                  |
| The message is already pinned, or, for an unpin, not pinned          | `CHAT_NOT_MODIFIED` (see [comparison limits](#comparison-limits))   |

## Account pins

Accounts pin and unpin a message through the emulation API with
`PUT /sessions/{sessionId}/accounts/{accountId}/conversations/private/{botId}/pinned-messages/{messageId}`
and `DELETE` on the same path, or, in a supergroup, under
`/conversations/supergroup/{chatId}/pinned-messages/{messageId}`. Messages are addressed by their
IDs as message history shows them. The TypeScript client offers `pinMessage` and `unpinMessage`.

The same rules apply as for bots, with an account's permissions: in a supergroup, the owner holds
`can_pin_messages`, an administrator holds it with that right or as the default permissions grant
it, and other members as the default permissions and their restriction grant it. As the Bot API
documents for `ChatPermissions.can_pin_messages`, a public supergroup ignores its default
permissions for pins, so only the owner and administrators with the right pin there. A refused
request answers `404` for an unknown account, bot, supergroup or message, `403` for a non-member or
a missing permission, `400` for a service message, and `409` for a pin that changes nothing or a
private chat whose bot the account blocks.

`GET` on `.../pinned-messages`, or the client's `getPinnedMessages`, returns the chat's pinned
messages newest first by sending date, as Telegram's search for pinned messages lists them. Private
messages are shown as the bot sees them, as message history shows them.

## Service messages

A pin's service message shows the pinned message as `pinned_message`, as the official server's
[`JsonMessage`][json-message-pin] does: as it is now, without its own `reply_to_message`. Once the
pinned message is deleted, it shows an [`InaccessibleMessage`][json-inaccessible] with the message's
ID, its chat and a `date` of 0, except where the service message is itself shown as a
`reply_to_message`, which then shows no `pinned_message`. The service message has no
`reply_to_message` of its own.

Every bot of a supergroup receives a pin's service message, privacy mode notwithstanding, as it
receives the supergroup's other service messages; in a private chat, the bot receives it. As the
official server's [`need_skip_update_message`][need-skip-update] keeps a bot's outgoing pin
messages, the pinning bot receives its own pin too, unlike its other messages. A bot whose
`allowed_updates` exclude `message` receives none.

Accounts see the service message in their history and notifications. In a supergroup, a bot's pin
with `disable_notification` notifies without sound, and an account's pin notifies with sound, as
Telegram's clients pin by default. In a private chat, a pin always notifies without sound, as
TDLib's [`pinChatMessage`][td-pin-chat-message] documents notifications to be always disabled there.

## Edits, deletions and replies

A pin follows its message, wherever the chat shows it:

- **Edits.** An edited message stays pinned. Its pin's service messages and `getChat` show it as it
  is now, with its `edit_date`; the edit reaches bots as an `edited_message`, and the pin as nothing
  further.
- **Deleting the pinned message.** The message leaves the pinned messages, so `getChat` shows the
  next newest pin, and pinning or unpinning it fails as for a message that was never there. Its
  pin's service messages then show it as an `InaccessibleMessage`.
- **Deleting a pin's service message.** The message stays pinned. Who may delete the service message
  is decided as for any message: either participant of a private chat, the bot that pinned in a
  supergroup, and accounts and bots with `can_delete_messages`.
- **Pinning again.** A message unpinned and pinned again gets another service message; the unpin
  gets none.
- **Replies, forwards and copies.** A reply may answer a pin's service message, and shows its pinned
  message nested, as [service messages](#service-messages) describes. A pin's service message cannot
  be edited, forwarded or copied, as for other service messages, and a forward or copy of a pinned
  message is not pinned.

## Pinned message in getChat

`getChat` shows the chat's newest pinned message by sending date as `pinned_message`, as the Bot API
documents for `ChatFullInfo`: the official server's [`getChat`][get-chat-pinned] asks TDLib's
[`getChatPinnedMessage`][get-dialog-pinned-message] for the newest pinned message, whose
[`last_pinned_message_id`][update-message-is-pinned] TDLib raises only for a pinned message with a
greater ID. Pinning an older message therefore leaves `pinned_message` unchanged, and unpinning the
newest shows the next newest. As [`JsonChat`][json-chat-pinned] shows it, the pinned message has no
`reply_to_message` of its own. A chat that pins nothing omits the field.

## Intentional deviations

- **Negative `message_id` of `unpinChatMessage`.** The official server's
  [`get_message_id`][get-message-id] reads a negative `message_id` as none, which unpins the newest
  pinned message. The emulator rejects it with `Bad Request: invalid unpinChatMessage parameters` to
  surface the bot's mistake in tests.

## Real gaps

- **Unpinning all messages.** `unpinAllChatMessages` is not implemented.
- **One-sided pins.** Accounts cannot pin a message of a private chat only for themselves, which
  Telegram's clients allow and the Bot API never does.
- **Pin notifications.** Accounts cannot choose whether a supergroup pin notifies its members.

## Comparison limits

Pins are kept by Telegram's servers, whose decisions the open-source code shows only in part:

- **Unchanged pins.** The official [`messages.updatePinnedMessage`][update-pinned-message-errors]
  reference lists `CHAT_NOT_MODIFIED` among its errors, and TDLib's
  [`UpdateDialogPinnedMessageQuery`][update-pinned-message-query] passes server errors on, unlike
  the queries that treat an unchanged chat setting as success; the official server keeps the
  uppercase error text. The server's decision itself is not visible, so the emulator refuses a pin
  of a pinned message and an unpin of a message that is not pinned.
- **Service messages in private chats.** Telegram's servers create the service message of a pin. The
  official server delivers a bot's outgoing pin messages in any chat, and TDLib documents pin
  notifications as disabled in private chats rather than absent, so the emulator records pins in
  private chats as in supergroups.
- **Blocked bots.** Whether Telegram's servers let a bot pin in the private chat of an account that
  blocked it is not visible. As for their messages, the emulator refuses pins and unpins there by
  either participant while the account blocks the bot: the bot's with
  `Forbidden: bot was blocked by the user`, the account's with `409`.

## Local evidence

[Domain model](../../src/types/virtual_message.ts),
[pinning](../../src/services/message_pinning.ts), [storage](../../src/repositories/message.ts),
[Bot API handlers](../../src/api/sessions/bot_api/mod.ts),
[Bot API service](../../src/services/bot_api.ts),
[update delivery](../../src/services/bot_update_delivery.ts),
[projection](../../src/projections/bot_api_message.ts),
[`getChat` projection](../../src/projections/bot_api_chat_full_info.ts),
[account routes](../../src/api/sessions/accounts/mod.ts),
[service tests](../../tests/message_pinning_service_test.ts),
[account HTTP tests](../../tests/pinned_messages_api_test.ts),
[Bot API HTTP tests](../../tests/pin_chat_message_api_test.ts) and
[edit and deletion tests](../../tests/pin_reconciliation_api_test.ts).

[api-pin]: https://core.telegram.org/api/pin
[update-pinned-message-errors]: https://core.telegram.org/method/messages.updatePinnedMessage
[pin-query]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L16043-L16065
[unpin-query]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L16067-L16096
[unpin-target]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L7712-L7739
[check-message]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L9084-L9104
[get-message-id]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L13486-L13498
[json-message-pin]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L5075-L5088
[json-inaccessible]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L2095-L2111
[need-skip-update]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L18833-L18878
[get-chat-pinned]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L7659-L7710
[json-chat-pinned]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L1799-L1805
[td-pin-chat-message]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/generate/scheme/td_api.tl#L13554-L13559
[can-pin-messages]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/DialogManager.cpp#L2902-L2937
[can-pin-message]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessagesManager.cpp#L23322-L23336
[pin-dialog-message]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessagesManager.cpp#L30527-L30547
[update-pinned-message-query]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessagesManager.cpp#L352-L402
[update-message-is-pinned]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessagesManager.cpp#L8103-L8136
[get-dialog-pinned-message]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessagesManager.cpp#L15211-L15240
