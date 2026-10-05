# Keyboards and callbacks

[Feature index and comparison baseline](README.md) · [Inline mode](inline-mode.md) ·
[TypeScript client guide: Buttons and menus](../clients/typescript/buttons-and-menus.md)

## Inline keyboards

Messages can carry inline keyboards with callback, URL, copy-text, switch-inline, login, Web App and
disabled buttons in private chats and supergroups. Callback data must contain 1–64 UTF-8 bytes. URL
buttons accept the links TDLib's [`get_inline_keyboard_button`][td-inline-button] accepts: a
`tg://user?id=` link opens the user's profile, and any other link must pass
[`LinkManager::check_link`][check-link], the same rule the emulator applies to text links. The
keyboard keeps and returns the normalized link, so `grammy.dev` becomes `http://grammy.dev/`, and a
refused link fails with TDLib's error, such as
`Bad Request: inline keyboard button URL 'grammy' is invalid: Wrong HTTP URL`. Telegram's servers
decide whether a profile link's user may be shown, which the emulator does not check. Bots replace
or remove a keyboard with `editMessageReplyMarkup`, or supply it when editing text/captions. An
empty `inline_keyboard` removes the keyboard.

Copy-text, switch-inline and disabled buttons act only in the user's client, so the emulator stores
them for inspection and nothing happens when they are pressed. The official server's
[`get_inline_keyboard_button_type`][button-parsing] reads `switch_inline_query` as a switch to a
chat of any kind, and `switch_inline_query_chosen_chat` as one limited to the kinds it allows, of
which TDLib's [`get_inline_keyboard_button`][td-inline-button] requires at least one:
`Bad Request: at least one chat type must be allowed`. As the official server's
[`JsonInlineKeyboardButton`][button-json] does, a returned keyboard shows a chosen-chat button that
allows every kind as a `switch_inline_query` button. To test what follows a switch-inline press,
send the inline query from the account. Copied text is limited to the documented 256 characters,
which TDLib does not check.

An account presses a callback button using its message ID and `callback_data`, whether the button
belongs to the message's inline keyboard or to its [rich message](rich-messages.md). The emulator
creates a `callback_query` update for the bot responsible for that button. The query includes the
account, data and `chat_instance`; ordinary message callbacks include a message, while inline
callbacks use `inline_message_id` instead. Tests inspect the answer after the bot calls
`answerCallbackQuery`. Answers store optional text, `show_alert`, `url` and `cache_time`; answer
text is limited to 200 UTF-16 code units by the emulator's schema. The TypeScript client's
`pressButton` selects a button by its label instead of its data, within the innermost keyboard row,
table row, list item or block whose text mentions a given text, and refuses a selection that matches
no button or several.

The [Bot API handler][answer-callback] and TDLib's [`answer_callback_query`][td-callback] pass `url`
to Telegram, whose servers decide which URLs to accept. The Bot API documents a game's URL for game
buttons and links like `t.me/<bot_username>?start=<parameter>`. The emulator has no game buttons. It
accepts only links that start the answering bot, recognizing the `t.me`, `telegram.me` and
`telegram.dog` forms that TDLib's [`LinkManager`][link-manager] parses, and
`tg://resolve?domain=<bot_username>&start=<parameter>`. Other URLs are rejected with
`Bad Request: URL_INVALID`, which may be stricter than Telegram. The link is recorded for tests to
inspect; the account's client does not follow it.

### Login and Web App buttons

Login buttons (`login_url`) and Web App buttons (`web_app`) open HTTPS pages. The official server's
[`get_inline_keyboard_button_type`][login-web-app-parsing] reads them, and TDLib's
[`get_inline_keyboard_button`][td-login-web-app] checks their links with `check_link`, allowing only
HTTPS and no profile links: for example,
`Bad Request: inline keyboard button Web App URL 'grammy.dev' is invalid: Only HTTPS links are allowed`
or `Bad Request: link to a user can't be used in login URL buttons`. The keyboard keeps the
normalized link. A login button's `bot_username` may start with `@`, must consist of letters, digits
and underscores (`Bad Request: loginUrl bot username is invalid`), and must name a bot of the
session, as the server resolves it: `Bad Request: bot "name" not found`.

As the official server's [`json_store_inline_keyboard_button_type`][button-type-json] does, bots and
accounts see a login button as a `url` button with its link. The button's `forward_text`,
`bot_username` and `request_write_access` still count when an edit is compared with the keyboard, as
in TDLib's [button comparison][td-button-equality], and a
[forward](messages.md#forwarding-and-copying) shows the forward text. A forward drops a keyboard
with a Web App button, as TDLib's [`InlineKeyboardButton::clone`][td-button-clone] does.

Telegram authorizes the user and opens the pages in the user's client, without involving the bot, so
the emulator only stores these buttons. As the Bot API reference documents, Web App buttons work
only in private chats between a user and the bot. Telegram's servers enforce this; the emulator
refuses them in messages that bots send or edit in supergroups with
`Bad Request: BUTTON_TYPE_INVALID`, Telegram's error for a button type it does not accept. It does
not check the Web App buttons of inline query results, which a user may send to any chat.

## Reply keyboards and forced replies

In private chats, bots can send a reply keyboard of text buttons, `remove_keyboard`, or
`force_reply`. Tests inspect the active reply interface and press a text button to send its text as
an account message. Keyboard flags and the input placeholder are exposed for inspection.

A new reply keyboard or forced reply replaces the current interface; removal clears it. Messages
without such markup leave it alone. Deleting its message clears the interface. Replacement and
removal follow the corresponding private-chat logic in TDLib's
[`MessagesManager` reply markup handling][reply-state].

`selective` has no effect in private chats. Messages sent with any non-inline reply markup remain
uneditable, even after the interface clears. A forced reply stays shown after the account replies;
its dismissal is an [intentional deviation](#intentional-deviations).

### Request buttons

Reply keyboard buttons can also request something instead of sending their text: `request_contact`,
`request_location`, `request_poll`, `web_app`, `request_users` and `request_chat`, which the
official server's [`get_keyboard_button_type`][reply-button-type] reads. As TDLib's
[`KeyboardButton::get_keyboard_button`][td-keyboard-button] requires, only private chats allow them;
elsewhere sending fails with its error, such as
`Bad Request: phone number can be requested in private chats only`. A `web_app` button's link is
checked as for [inline Web App buttons](#login-and-web-app-buttons), but named as a keyboard
button's: `Bad Request: keyboard button Web App URL '…' is invalid: Only HTTPS links are allowed`.
The administrator rights a chat request requires are kept for the requested kind of chat, as TDLib's
[`RequestedDialogType`][requested-dialog-type] keeps them, where any right includes
`can_manage_chat`.

Accounts see each request in the fields of a Bot API `KeyboardButton`, with every field of
`request_users` and `request_chat` and the normalized Web App link. Telegram's clients answer such a
button with what it requests rather than its text. Pressing a `request_contact` button shares the
account's [own contact](contacts-and-locations.md#answering-contact-requests), and pressing a
`request_location` button shares the
[location the press reports](contacts-and-locations.md#answering-location-requests), each in reply
to the keyboard's message. Pressing a `request_users` or `request_chat` button
[shares the users or supergroup](#sharing-users-and-chats) the press chooses. The emulator
[cannot answer](#real-gaps) `request_poll` and `web_app` buttons, so pressing one fails with `400`.
Legacy names that the server also reads, `request_phone_number` and `request_user`, and
`request_managed_bot` for the missing managed bots, are rejected.

### Sharing users and chats

A press of a `request_users` button carries `shared_user_ids`, the accounts and bots of the session
the account chooses, and a press of a `request_chat` button carries `shared_chat_id`, a supergroup
the account is a member of. Each answer belongs to its own kind of button, a press carries at most
one, and the other buttons refuse it, as they refuse a `location`. TDLib's
[`shareUsersWithBot` and `shareChatWithBot`][share-dialogs] find the request by its message and
`request_id`; the press finds it, as any press does, by the text of a button of the keyboard the
account's chat shows, so a replaced or removed keyboard, another chat's keyboard, or another
account's keyboard answers nothing.

The bot receives a service message from the account with `users_shared` or `chat_shared` and the
button's `request_id`, as the official server's [`JsonMessage`][shared-message-json] writes them. As
TDLib [ignores the reply][shared-reply-info] Telegram sends with it, the message replies to nothing.
A `users_shared` keeps the legacy `user_ids`, and a single shared user also shows as the legacy
`user_shared`. Each [`JsonSharedUser` and `JsonChatShared`][shared-json] shows only the details the
request asked for, as they were when the account shared them: `first_name` and `last_name` for
`request_name`, `username` for `request_username`, and `title` and `username` for `request_title`
and `request_username`; a user without a last name or username, or a private supergroup, leaves them
out. Emulated users and chats have no photos, so `request_photo` adds none. The account's history
shows the same message, which, like any message the account writes, starts the private chat.

The choice must meet the request as TDLib's
[`RequestedDialogType::check_shared_dialog_count` and `check_shared_dialog`][check-shared-dialog]
check it, and a refused choice creates no message or update and changes nothing:

- `request_users` takes at most `max_quantity` users, each of the kind `user_is_bot` requires.
  Emulated accounts are never Premium users, as their Bot API `User` shows, so
  `user_is_premium:
  false` accepts every user.
- `request_chat` takes a supergroup with a username exactly when `chat_has_username` asks for one,
  which the account owns when `chat_is_created` is set. Otherwise the account must hold every right
  of `user_administrator_rights`, as TDLib's [`has_all_administrator_rights`][has-all-rights]
  compares them; the owner holds every right. As TDLib [reads a received request][received-request],
  a chat the account must have created skips that check.
- The bot must already be a member when `bot_is_member` is set, and already hold every right of
  `bot_administrator_rights`. Telegram's clients add or promote the bot in that case; the emulator
  grants nothing, so tests add and promote the bot first.

Sharing grants nobody anything: the bot learns the identifiers, but can write to a shared account
only once it starts a chat, and to a shared supergroup only once it is a member. The emulation API
answers an unknown user or supergroup with `404`, a supergroup the account is not a member of with
`403`, and any other refusal with `400`.

### In supergroups

Bots also send reply keyboards, removals and forced replies to supergroups, which the official
server's [`Client::get_reply_markup`][reply-markup] reads as for private chats. Each account member
inspects and presses what its own client shows. As TDLib's [`get_reply_markup`][received-markup]
decides for received markup, markup applies to every member unless it is `selective`. Selective
markup applies only to the members the message mentions, by `@username` or a text mention, and to
the sender of the message of the chat that it replies to. Telegram's servers decide whom a message
mentions, which the open-source code does not show; the emulator matches mentions as it does for
[privacy mode](supergroups.md#privacy-mode).

Markup that applies to a member changes what its client shows as in a private chat, except that, as
TDLib's [`add_message_to_dialog`][dialog-markup] does, a removal removes only an interface that the
same bot set. An interface also disappears when its message is deleted, or when its bot leaves or is
removed from the supergroup, as TDLib does for that service message and in
[`on_dialog_bots_updated`][bots-updated].

Pressing a button sends its text as the account's message, replying to the keyboard's message as
Telegram Desktop's [`HistoryWidget::sendBotCommand`][desktop-bot-command] does outside private
chats. The bot that sent the keyboard therefore receives the press even in privacy mode. Reply
buttons with a [request](#request-buttons) are refused, as TDLib allows them only in private chats.

## Button appearance

Inline and reply keyboard buttons accept `style` and `icon_custom_emoji_id`, as the official
server's [`get_button_style`][button-style] and [button parsing][button-parsing] read them. `style`
is `primary`, `danger` or `success` in any ASCII letter case; an empty style or `default` chooses
the client's default. An icon of `0` means none; Telegram also reads an icon given as a JSON number,
which cannot hold every 64-bit identifier exactly, so the emulator requires a string. Bots see the
appearance in returned inline keyboards, in the field order of
[`JsonInlineKeyboardButton`][button-json], and accounts see it on inline and reply keyboard buttons.
The default style and a missing icon are omitted. As TDLib's [button comparison][td-button-equality]
does, an edit that only changes a button's appearance still changes the keyboard. The emulator draws
no buttons, and it checks only the icon identifier's syntax, as it does for
[custom emoji entities](text-formatting.md#real-gaps).

## Intentional deviations

- **Inspectable keyboard data without a client UI.** Tests inspect keyboard data without reproducing
  Telegram's rendering or hidden/shown state. Pressing a `one_time_keyboard` button leaves the
  keyboard available through the inspection API. Persistent and resize flags are recorded without
  rendering a keyboard.
- **No client-side dismissal.** Telegram apps call TDLib's
  [`delete_dialog_reply_markup`][dismiss-reply] after the user answers a forced reply or uses a
  one-time keyboard. That call only changes what the client shows and sends nothing to Telegram, so
  no bot can observe it. The inspection API keeps showing a forced reply until a bot's markup
  replaces or removes it, or its message is deleted.
- **URL inspection without navigation.** URL buttons are stored but cannot be opened through the
  test client. Tests can inspect the target without opening it.
- **Rejecting ambiguous buttons.** Markup and buttons with multiple actions fail strict validation
  to expose ambiguous definitions in tests. Upstream's [parser][button-parsing] selects an action
  according to its field-reading order.
- **Explicit callback expiry.** Queries do not expire with elapsed time; tests control expiry
  explicitly. Set `expired: true` when pressing a button to create an already expired query and
  exercise the query-too-old error. Missing queries, queries belonging to another bot and already
  answered queries also fail.
- **No cached callback answers.** `cache_time` is recorded for inspection, and every press reaches
  the bot. The Bot API describes it as client-side caching. TDLib's
  [`GetBotCallbackAnswerQuery`][callback-answer] drops the server's `cache_time` when it builds
  `callbackQueryAnswer`, so TDLib-based clients never reuse an answer. The emulated accounts follow
  TDLib rather than apps that implement their own cache.
- **Current button presses only.** Callback presses require a currently stored matching button
  because the intended tests only need those presses. Stale or arbitrary callback data and callbacks
  with inaccessible message payloads are not modeled.
- **Stricter user and chat sharing.** TDLib passes a repeated user on to Telegram, whose handling of
  it is unknown; the emulator refuses a repeated user. A shared supergroup must be one the account
  is a member of, while TDLib only needs a chat the client knows. The bot's membership and rights
  must exist before the press, since the emulator does not reproduce the client adding or promoting
  the bot.

## Real gaps

- **Game and payment buttons.** These inline buttons need their
  [missing features](README.md#unimplemented-areas). Tests cannot exercise those button definitions
  or actions.
- **Answering reply keyboard requests.** Accounts cannot answer a `request_poll` or `web_app`
  [request button](#request-buttons): accounts do not create polls, and the `web_app_data` service
  message is missing.
- **Premium users, channels, forums, anonymous administrators and photos.** The emulator models none
  of them, so a press refuses a request that requires Premium users, a channel, a forum, or
  `is_anonymous` among the account's or the bot's rights with `400`, and shared users and chats show
  no `photo`.

## Comparison limits

The remote callback query lifetime and all re-answer rules cannot be established from TDLib's
forwarding code. The emulator's single-answer state machine should not be read as proof of exact
server behavior.

## Local evidence

[Markup schemas](../../src/api/sessions/bot_api/reply_markup_parameter.ts),
[callback service](../../src/services/callback_query.ts),
[start link parsing](../../src/text_entities/telegram_link.ts),
[reply interface handling](../../src/services/private_messaging.ts),
[user and chat sharing](../../src/services/requested_peer_sharing.ts),
[callback tests](../../tests/callback_query_service_test.ts) and
[private message tests](../../tests/private_messaging_service_test.ts),
[sharing criteria tests](../../tests/requested_peer_sharing_test.ts) and
[sharing API tests](../../tests/requested_peer_sharing_api_test.ts).

[received-markup]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/ReplyMarkup.cpp#L104-L198
[dialog-markup]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessagesManager.cpp#L31226-L31241
[bots-updated]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessagesManager.cpp#L29539-L29546
[desktop-bot-command]: https://github.com/telegramdesktop/tdesktop/blob/64ca5475f24dde7331a388176d3fe60c0849b965/Telegram/SourceFiles/history/history_widget.cpp#L6437-L6458
[reply-state]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessagesManager.cpp#L12453-L12515
[dismiss-reply]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessagesManager.cpp#L16043-L16082
[reply-markup]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L10504-L10630
[button-parsing]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L10200-L10503
[td-inline-button]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/InlineKeyboardButton.cpp#L226-L262
[check-link]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/LinkManager.cpp#L1926-L1994
[button-style]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L10226-L10246
[button-json]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L4247-L4263
[td-button-equality]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/InlineKeyboardButton.cpp#L84-L87
[login-web-app-parsing]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L10442-L10488
[reply-button-type]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L10248-L10345
[shared-json]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L3839-L3922
[shared-message-json]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L5188-L5200
[share-dialogs]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessageQueryManager.cpp#L3206-L3260
[shared-reply-info]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessageContent.cpp#L10973-L10995
[check-shared-dialog]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/RequestedDialogType.cpp#L230-L335
[received-request]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/RequestedDialogType.cpp#L82-L95
[has-all-rights]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/DialogParticipant.h#L419-L423
[td-keyboard-button]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/KeyboardButton.cpp#L82-L179
[requested-dialog-type]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/RequestedDialogType.cpp#L33-L51
[td-login-web-app]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/InlineKeyboardButton.cpp#L315-L369
[td-button-clone]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/InlineKeyboardButton.cpp#L42-L82
[button-type-json]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L18115-L18201
[answer-callback]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L15544-L15565
[callback-answer]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/CallbackQueriesManager.cpp#L77-L90
[td-callback]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/CallbackQueriesManager.cpp#L145-L188
[link-manager]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/LinkManager.cpp#L2055-L2084
