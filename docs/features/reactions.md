# Reactions

[Feature index and comparison baseline](README.md) · [Supergroups](supergroups.md) ·
[Updates and polling](updates.md) ·
[TypeScript client guide: Reactions](../clients/typescript/reactions.md)

## Capability matrix

| Area                            | Supported                                                                                           | Not supported                                                                    |
| ------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `setMessageReaction` parameters | `chat_id`, `message_id`, `reaction` (`ReactionTypeEmoji`), `is_big`                                 | `business_connection_id`; `custom_emoji` and `paid` reactions                    |
| Reaction types                  | The 73 ordinary emoji the Bot API lists for `ReactionTypeEmoji`                                     | Custom emoji, paid reactions                                                     |
| Updates                         | `message_reaction` for subscribed administrator bots                                                | `message_reaction_count`, `actor_chat` of anonymous administrators               |
| Account actions                 | Adding, changing and removing a reaction; reading a message's reactions                             | Reacting in private chats; several reactions as a Premium user                   |
| Chats                           | Supergroups                                                                                         | Private chats, basic groups, channels, forum topics, business chats              |
| Messages                        | Content messages, including the messages of albums                                                  | Service messages                                                                 |
| Moderation                      | `can_react_to_messages` in default permissions and restrictions; deleting a message deletes its own | `deleteMessageReaction`, `deleteAllMessageReactions`, chat `available_reactions` |

## Account reactions

Accounts react through the emulation API, as a Telegram client does for a user:
`PUT .../conversations/supergroup/{chatId}/messages/{messageId}/reactions` with `reaction`, a list
of `ReactionTypeEmoji` objects, replaces the account's reactions to a message of a supergroup it is
a member of. `DELETE` on the same path removes them, and `GET` reads every member's reactions, the
bots' included, one entry per member in the order they last changed them. Each route answers with
the reactions and, apart from `DELETE`, the message that holds them, as the account's history shows
it. The TypeScript client's `setMessageReaction`, `removeMessageReaction` and `getMessageReactions`
call these routes.

Emulated accounts have no Premium, so an account chooses one reaction per message, as Telegram's
`reactions_user_max_default` client option allows; choosing a new one replaces the old one, as
TDLib's [`MessageReactions::add_my_reaction`][add-my-reaction] removes the oldest reaction beyond
that limit. Choosing the reaction the account already chose changes nothing, as TDLib sends nothing
for it, and removing without a reaction changes nothing either.

| Choice                                                                    | Result    |
| ------------------------------------------------------------------------- | --------- |
| A supergroup, account or message the account cannot find                  | `404`     |
| A supergroup the account is no member of                                  | `403`     |
| A service message                                                         | `400`     |
| Without the `can_react_to_messages` permission                            | `403`     |
| An emoji the Bot API does not list, such as `❤️` with U+FE0F              | `400`     |
| More than one reaction                                                    | `400`     |
| A new reaction for a message that already shows eleven distinct reactions | `409`     |
| The reaction the account already chose, or a removal without any reaction | No change |

The checks follow TDLib's [`get_message_available_reactions`][available-reactions]: a restricted
member reacts as far as its `can_react_to_messages` permission and the supergroup's default
permissions allow, which Telegram keeps apart from `can_send_messages`; the owner and administrators
always may. A message shows at most eleven distinct reactions, Telegram's `reactions_uniq_max`,
after which only the reactions it already shows can be chosen. A refused choice changes no reaction
and sends no update.

## Bot reactions

Bots react with [`setMessageReaction`][bot-api-set-message-reaction] to messages of supergroups they
are members of. The request is read as the official server's
[`process_set_message_reaction_query`][set-reaction-query] reads it: `reaction` first, as
[`get_reaction_types`][get-reaction-types] parses it, then the chat and the message, as
[`check_message`][check-message] finds them, and the reactions last, as Telegram's servers check
them. A missing, empty or `null` `reaction`, or an empty list, removes the bot's reactions, as
`setMessageReactions` documents. `is_big` only animates the reaction in clients.

| Check                                                                             | Error                                                                    |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `reaction` is not JSON                                                            | `Bad Request: can't parse reaction types JSON object`                    |
| `reaction` is not an array                                                        | `Bad Request: expected an Array of ReactionType`                         |
| An element is not an object                                                       | `Bad Request: can't parse ReactionType: expected an Object`              |
| An element without `type`, or an emoji reaction without `emoji`                   | `Bad Request: can't parse ReactionType: Can't find field "type"`         |
| A type other than `emoji` and `custom_emoji`, `paid` included                     | `Bad Request: can't parse ReactionType: invalid reaction type specified` |
| An empty emoji, or one TDLib reads as none                                        | `Bad Request: invalid reaction type specified`                           |
| A `custom_emoji` reaction                                                         | `Bad Request: REACTION_INVALID`                                          |
| `chat_id` missing                                                                 | `Bad Request: chat_id is empty`                                          |
| A private chat                                                                    | `Bad Request: reactions in private chats are not supported`              |
| A chat the bot cannot address                                                     | `Bad Request: chat not found`                                            |
| A supergroup the bot left or was removed from                                     | `403` as for [sending](supergroups.md)                                   |
| `message_id` missing, not positive, or identifying no message                     | `Bad Request: message to react not found`                                |
| A service message, or an emoji the Bot API does not list                          | `Bad Request: REACTION_INVALID`                                          |
| Without the `can_react_to_messages` permission                                    | `Forbidden: CHAT_WRITE_FORBIDDEN`                                        |
| More than one reaction, or a new one for a message with eleven distinct reactions | `Bad Request: REACTIONS_TOO_MANY`                                        |

A missing `emoji` is reported as `Can't find field "emoji"`. Choosing the reactions the bot already
chose succeeds and changes nothing, as TDLib's [`SendReactionQuery`][send-reaction-query] treats
`MESSAGE_NOT_MODIFIED` as success. The bot's reactions show in the message's reactions that accounts
read, but, as the Bot API documents, no bot receives a `message_reaction` update for reactions set
by bots.

## Reaction updates

As the Bot API documents for [`message_reaction`][bot-api-update], "The bot must be an administrator
in the chat and must explicitly specify "message_reaction" in the list of allowed_updates to receive
these updates. The update isn't received for reactions set by bots." Each change of an account's
reactions therefore reaches every administrator bot of the supergroup whose subscription includes
`message_reaction`, privacy mode notwithstanding, and no other bot. The default subscription leaves
it out.

The update is the official server's [`JsonMessageReactionUpdated`][json-reaction-updated]: `chat`,
`message_id`, `user`, `date`, `old_reaction` and `new_reaction`, in that order, with the account's
reactions before and after the change; `new_reaction` is empty for a removal. Webhooks deliver the
updates of one supergroup in order, as [`add_update_message_reaction`][add-update-reaction] queues
them by chat. A choice that changes nothing sends no update, as TDLib's
[`process_qts_update`][process-qts-update] drops an update whose reactions did not change.

## Albums and deletion

As the Bot API documents for `setMessageReaction`'s `message_id`, a reaction to a message of an
album "is set to the first non-deleted message in the group instead". The emulator applies this to
accounts too: any message of an album addresses the album's reactions, which its first message that
is not deleted holds, inspection shows with that message, and `message_reaction` updates name by its
`message_id`.

Reactions belong to the message that holds them. Deleting a message deletes its reactions and sends
no update; its reactions can no longer be read, since the message cannot be found. Once an album's
first message is deleted, the next message holds the album's reactions, starting with none. Edits
keep a message's reactions, and forwards and copies start without any.

## Intentional deviations

- **Strict input.** The official server ignores unknown parameters and fields of a reaction, and
  reads a number where an emoji is expected as its text. The emulator rejects them with
  `Bad Request: invalid setMessageReaction parameters`, to surface the bot's mistake in tests.
- **Custom emoji refused early.** Telegram's servers refuse a custom emoji that is neither shown on
  the message nor allowed by the chat only after finding the message. No emulated chat allows custom
  emoji, so the emulator refuses them right after reading `reaction`.
- **Membership required.** Telegram lets a user that has not joined a public supergroup react where
  it could send messages without joining. As for every account action in a supergroup, the emulator
  requires membership.
- **Service messages refused.** Telegram's servers decide per message whether a service message
  accepts reactions; TDLib's fallback lists most supergroup service messages, such as members
  joining and pins, as accepting them. The emulator accepts reactions only on content messages.
- **Emulator descriptions for unverified refusals.** Which error Telegram's servers give for an
  unlisted emoji, for a bot choosing two reactions, for a service message or for a member without
  `can_react_to_messages` is not visible in the open-source code. The emulator answers with the
  errors `messages.sendReaction` documents, `REACTION_INVALID`, `REACTIONS_TOO_MANY` and
  `CHAT_WRITE_FORBIDDEN`, as the official server words them.

## Real gaps

- **Other chats.** Reactions in private chats, basic groups and channels, and the
  `message_reaction_count` updates of anonymous reactions, are not supported.
- **Custom emoji and paid reactions.** `ReactionTypeCustomEmoji` and `ReactionTypePaid` are refused,
  and chats have no `available_reactions` or `max_reaction_count` settings.
- **Moderation.** `deleteMessageReaction` and `deleteAllMessageReactions` are not implemented, and
  accounts cannot remove other members' reactions.
- **Premium.** Accounts and bots choose one reaction per message, as users without Premium do.

## Comparison limits

TDLib passes a bot's reactions to Telegram's servers without checking the emoji, their number or the
message's album, as TDLib's [`set_message_reactions`][set-message-reactions] shows. Which message of
an album holds the reactions after deletions, which `message_id` the update names, which errors the
servers give, and which bots they send `message_reaction` updates to are therefore taken from the
Bot API documentation and the `messages.sendReaction` error list, not verified against Telegram.

## Local evidence

[Domain model](../../src/types/message_reaction.ts),
[reaction service](../../src/services/message_reaction.ts),
[parameter reading](../../src/api/sessions/bot_api/reaction_type_parameter.ts),
[account routes](../../src/api/sessions/accounts/message_reactions.ts),
[update delivery](../../src/services/bot_update_delivery.ts),
[projection](../../src/projections/bot_api_message_reaction.ts),
[unit tests](../../tests/message_reaction_service_test.ts) and
[HTTP tests](../../tests/message_reaction_api_test.ts).

[bot-api-set-message-reaction]: https://core.telegram.org/bots/api#setmessagereaction
[bot-api-update]: https://core.telegram.org/bots/api#update
[set-reaction-query]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L14635-L14648
[get-reaction-types]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L13207-L13240
[check-message]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L9084-L9104
[json-reaction-updated]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L6109-L6128
[add-update-reaction]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L18751-L18762
[add-my-reaction]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessageReaction.cpp#L702-L748
[send-reaction-query]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessageReaction.cpp#L85-L91
[set-message-reactions]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessageReaction.cpp#L1123-L1134
[available-reactions]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessagesManager.cpp#L20194-L20246
[process-qts-update]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/UpdatesManager.cpp#L3277-L3301
