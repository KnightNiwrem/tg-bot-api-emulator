# Command menus

[Feature index and comparison baseline](README.md) · [Text command detection](text-formatting.md) ·
[TypeScript client guide: Buttons and menus](../clients/typescript/buttons-and-menus.md)

## Supported behavior

Bots store, read and delete command lists with `setMyCommands`, `getMyCommands` and
`deleteMyCommands`. A list is keyed by scope and language. `getMyCommands` returns exactly that
list, without applying the fallback used by a user's command menu. A missing/empty list in
`setMyCommands` deletes the entry.

Commands are cleaned and trimmed, with a leading slash removed, before validation. Names contain
1–32 lowercase Latin letters, digits or underscores; descriptions contain 1–256 Unicode code points.
A list holds at most 100 commands. `is_ephemeral` is stored and returned, but the emulator has no
ephemeral message workflow. Language codes are empty or two lowercase letters. These normalization
checks follow TDLib's [`BotCommand` implementation][bot-command].

| Scope                                        | Emulator support                                                                            |
| -------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `default`                                    | Store/read/delete; participates in private and group menu fallback                          |
| `all_private_chats`                          | Store/read/delete; participates in private menu fallback                                    |
| `all_group_chats`, `all_chat_administrators` | Store/read/delete; participate in group menu fallback                                       |
| `chat`                                       | Private conversations already started with this bot, and supergroups the bot is a member of |
| `chat_administrators`, `chat_member`         | Supergroups the bot is a member of; rejected in private chats with Telegram's scope error   |

A chat scope naming a supergroup the bot left or was removed from is rejected with Telegram's `403`
membership errors, as the official server's [chat access check][chat-access] does. A `chat_member`
scope accepts any positive user ID, as TDLib does for bots.

Tests read a private chat's effective menu through `account.getBotCommands`. Resolution prefers the
chat scope, then all-private-chats, then default; within each scope, it prefers the account's
language and then the language-neutral list. The account's primary language subtag is used, such as
`en` from `en-US`.

Tests read a supergroup member's effective menus through `account.getSupergroupBotCommands`, which
returns one list for each bot member that has commands, as TDLib's `BotCommands` lists do.
Resolution prefers the member scope, then the chat administrators scope, the chat scope, the
all-chat-administrators scope, all-group-chats and default. Administrator scopes apply only to the
owner and administrators. Both orders implement Telegram's
[command scope documentation][scope-order].

Commands do not define message routing or restrict what users can type. Automatic `bot_command`
entities are handled separately by [text formatting](text-formatting.md).

## Bot descriptions

Bots store and read their description, shown in an empty chat with the bot, with `setMyDescription`
and `getMyDescription`, and their short description, shown on the bot's profile, with
`setMyShortDescription` and `getMyShortDescription`. Each text is kept per language, and the
language code is empty or two lowercase letters, as TDLib's
[`validate_bot_language_code`][bot-language] requires. A text is cleaned of control characters as
TDLib's [`setBotInfoDescription` request][description-request] cleans it, but not trimmed; its UTF-8
check comes before the language check. An empty or missing text removes the text for that language.

The getters return exactly the text of the requested language, `""` if it has none, in the
[`{"description": …}` or `{"short_description": …}`][description-json] objects of the official
server. Whether Telegram's server falls back to the language-neutral text there is not visible in
the source, so tests should not rely on a fallback. Telegram's server also limits a description to
512 characters and a short description to 120; the emulator does not enforce these limits, because
the source does not show the server's error. Accounts do not see either text.

## Default administrator rights

Bots store and read the rights they ask for by default when added to groups, or with `for_channels`
to channels, as an administrator with `setMyDefaultAdministratorRights` and
`getMyDefaultAdministratorRights`. The `rights` object is read as the official server's
[`get_chat_administrator_rights`][rights-parameter] reads it, with its errors for text that is not a
JSON object and for rights that are not JSON booleans; missing or empty `rights` remove the
defaults. As in TDLib's [`AdministratorRights`][administrator-rights], rights that do not apply to
the kind of chat are dropped, as is anonymity in channels, and any right includes `can_manage_chat`.
The getter shows every right that applies to the kind of chat, all false when none are set, as
[`json_store_administrator_rights`][rights-json] does.

The emulator has no workflow that adds a bot with these rights; supergroup owners still
[promote bots](supergroups.md#administrator-operations) through the emulation API.

## Menu buttons

Bots choose the button shown next to the message field of their private chats with
`setChatMenuButton`, for all chats or, with `chat_id`, for the chat with one account, and read it
with `getChatMenuButton`. The button is the bot's commands, a Web App, or the default button, which
removes the choice; a missing `menu_button` is the default button. The official server's
[`get_bot_menu_button`][menu-button-parameter] errors answer malformed buttons, and the button is
read before `chat_id`, which must be a positive user ID (`Bad Request: invalid chat_id specified`)
of an account (`Bad Request: user not found`). As TDLib's [`set_menu_button`][set-menu-button] does,
a Web App button needs nonempty text, both text and URL are cleaned of control characters, and the
URL must be a valid HTTPS link, which is stored normalized; for example, an HTTP URL fails with
`Bad Request: menu button Web App URL 'http://…' is invalid: Only HTTPS links are allowed`.

A chat's button is the one chosen for it, or else the one for all chats, or `{"type":"default"}`,
shown as the official server's [`JsonBotMenuButton`][menu-button-json] shows it. Tests read the
button an account sees through `account.getMenuButton`. Telegram's server decides what it returns
for chats without a choice, which the source does not show; the emulator's fallback follows the Bot
API's description of the default button as no specific choice. Pressing a Web App button needs the
missing [Mini App support](README.md#unimplemented-areas).

## Real gaps

Changing supported BotFather-style settings after bot creation is also a
[real gap](sessions-and-requests.md#real-gaps).

## Local evidence

[Command service](../../src/services/bot_command.ts),
[scope/command parsing](../../src/api/sessions/bot_api/bot_command_parameters.ts),
[command repository](../../src/repositories/bot_command.ts),
[command tests](../../tests/bot_command_service_test.ts),
[description service](../../src/services/bot_description.ts),
[description tests](../../tests/bot_description_service_test.ts),
[default administrator rights service](../../src/services/bot_default_administrator_rights.ts),
[their tests](../../tests/bot_default_administrator_rights_service_test.ts),
[menu button service](../../src/services/bot_menu_button.ts) and
[menu button tests](../../tests/bot_menu_button_service_test.ts).

[bot-command]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/BotCommand.cpp
[scope-order]: https://core.telegram.org/bots/api#determining-list-of-commands
[chat-access]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L8796-L8866
[bot-language]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/misc.cpp#L395-L404
[description-request]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/Requests.cpp#L7042-L7065
[description-json]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L5743-L5767
[rights-parameter]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L11438-L11489
[administrator-rights]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/DialogParticipant.cpp#L44-L115
[rights-json]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L18010-L18042
[menu-button-parameter]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L11393-L11436
[set-menu-button]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/BotMenuButton.cpp#L126-L155
[menu-button-json]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L5711-L5728
