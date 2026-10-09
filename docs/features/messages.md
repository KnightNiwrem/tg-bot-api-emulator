# Messages

[Feature index and comparison baseline](README.md) · [Text formatting](text-formatting.md) ·
[Media](media-and-files.md) · [Supergroups](supergroups.md) ·
[TypeScript client guide: Messages](../clients/typescript/messages.md)

## Sending, replying and inspecting history

Accounts and bots exchange text, photos, documents, [videos](media-and-files.md#videos),
[voice notes](media-and-files.md#voice-notes), [audio files](media-and-files.md#audio-files) and
[albums](media-and-files.md#albums) of photos and videos, of documents, or of audio files,
[contacts](contacts-and-locations.md#contacts) and static
[locations](contacts-and-locations.md#locations) and [polls](polls.md), in private chats and
supergroups, and bots also send [rich messages](rich-messages.md). A private conversation must first
be started by the account before the bot can send to it. `sendMessage`, `sendRichMessage`,
`sendPoll`, `sendPhoto`, `sendDocument`, `sendVideo`, `sendVoice`, `sendAudio`, `sendContact` and
`sendLocation` accept `protect_content` and supported [reply markup](keyboards-and-callbacks.md);
`sendMediaGroup` accepts `protect_content` and no reply markup. Bot messages appear in account
history; bots receive no updates for their own sends or edits.

Both sides can reply to a message in the same chat. Bots use `reply_parameters` or the legacy
`reply_to_message_id` and `allow_sending_without_reply` parameters. `reply_parameters` takes
precedence, and a missing/non-positive message ID means no reply. If a target is absent,
`allow_sending_without_reply` permits a normal send. Returned messages include `reply_to_message`
without recursively nesting the replied message's own reply.

Bots can add a message effect with `message_effect_id` to `sendMessage`, `sendPhoto`,
`sendDocument`, `sendVideo`, `sendVoice`, `sendAudio`, `sendContact`, `sendLocation`,
`sendMediaGroup`, `forwardMessage` and `copyMessage`, which gives it to every message of an album,
as TDLib's `send_message_group` does. The message then reports it as `effect_id`, including in
account history. `0` means no effect. As in TDLib's
[`MessageSendOptions::get_message_send_options`][effect-rules], effects are refused in supergroups,
and `forwardMessages` or `copyMessages` accept one only when a single message is found. Telegram's
servers decide which effect identifiers exist; that check is not in the open-source code, and the
emulator accepts any 64-bit identifier. The [official send path][message-effects] shows how the
option is read.

Bots can also reply to a message of another of their chats by naming its `chat_id` in
`reply_parameters`. As the official server's [`check_reply_parameters`][check-reply] does, the bot
must be able to read that chat, and a missing message fails the send unless
`allow_sending_without_reply` is set. The reply shows the message in `external_reply` as TDLib's
[`RepliedMessageInfo`][replied-message-info] keeps it. It includes the original sender and date, and
the chat and message ID when the message is in a supergroup. It also carries a photo, document,
video, voice note or audio file without its caption, a poll, a contact, or a location, which TDLib's
[`is_supported_reply_message_content`][reply-content] lists. The text or caption becomes an
automatic `quote` of up to 1,024 characters. That quote keeps only the entity types TDLib's
[`is_allowed_quote_entity_type`][quote-entities] allows. As TDLib's
[`create_message_input_reply_to`][external-reply-input] does, the emulator sends a reply to
protected content or a service message of another chat without a reply. The emulator resolves the
replied message before the destination chat and text. When a request fails both ways, it fails for
the reply.

Bots can quote part of the replied message with `quote`, `quote_parse_mode` or `quote_entities`, and
`quote_position`, which the reply shows as a `quote` with `is_manual`. As TDLib's
[`MessageQuote`][message-quote] does, the quote is normalized like message text. A quote that cannot
be normalized, or is empty, is ignored, and trimmed leading spaces shift its position. Telegram's
servers then look the quote up in the replied text; that check is not in the open-source code. The
emulator follows the documented contract. The quote must be an exact part of the replied text,
including its bold, italic, underline, strikethrough, spoiler, custom emoji and date and time
entities, and at most 1,024 characters long. Otherwise the send fails with
`Bad Request: QUOTE_TEXT_INVALID`. Among several occurrences, the one nearest to `quote_position` is
chosen, searching in the order of TDLib's `MessageQuote::search_quote`. A chosen quote replaces the
automatic quote of a reply to another chat.

Replies to checklist tasks or poll options are [real gaps](#real-gaps). Text and captions follow the
[formatting limits](text-formatting.md); link-preview metadata is
[intentionally absent](text-formatting.md#intentional-deviations).

Bots show chat actions, such as typing, with `sendChatAction`. Tests read the actions an account's
client shows through `account.getChatActions` for a private chat or a supergroup. As TDLib's
[`DialogActionManager`][dialog-actions] shows them, an action ends when the bot sends `cancel` or a
message to the chat, and a supergroup lists each bot's latest action, in the order the bots last
sent them. Sending an action again succeeds and records another call, whether or not it is the
action shown. An action never ends as time passes: `account.expireChatAction` stands in for the
timeout, as an [intentional deviation](#intentional-deviations) describes.

Private message IDs come from each observer's message box; a supergroup has one sequence shared by
all members. Private conversation history in the emulation API uses the **bot's** message IDs, so a
test can pass them to Bot API calls. History contains the currently stored messages, without
pagination or deleted entries; it is a test inspection API, not a Telegram history endpoint.

## Notifications

Tests read the notifications an account's client shows through `account.getNotifications` for a
private chat or a supergroup. Every message another participant sent to the chat notifies, in order,
and the account's own messages do not. `disable_notification` on `sendMessage`, `sendPhoto`,
`sendDocument`, `sendVideo`, `sendVoice`, `sendAudio`, `sendContact`, `sendLocation`,
`sendMediaGroup`, `forwardMessage(s)` and `copyMessage(s)` makes the notification silent. The
official server passes the option to TDLib's send options. As TDLib's
[`Message::disable_notification`][silent-message] carries it to the recipient, the notification
reports it as `is_silent`, as TDLib's [`notification`][notification-object] object does. Bot API
messages do not show it.

Accounts have no notification settings, so no chat is muted, and reading a message keeps its
notification; a deleted message has none.

## Message drafts

Bots stream the text of a message they are still generating with `sendMessageDraft`, which the
official server's [`process_send_message_draft_query`][send-message-draft] passes to TDLib's
[`sendTextMessageDraft`][text-draft-request]. Tests read the draft an account's client shows in its
private chat with the bot through `account.getMessageDraft`, which returns `null` for none. A draft
is never one of the chat's messages: writing, replacing, expiring or removing one leaves the history
unchanged and sends the bot no update. Only a press of its Stop button tells the bot.

As TDLib's [`updatePendingMessage`][pending-message] tells clients to show drafts:

- A write with the shown draft's `draft_id` changes the draft, and one with another ID replaces it.
  Each chat shows at most one draft.
- Any message from the bot to the chat removes the draft, including a forward, a copy, an album or
  the service message of the bot's pin. The account's own messages, the bot's messages to other
  chats, a send that fails, and chat actions keep it. A draft also leaves the bot's chat action as
  it was.
- The text is read as message text is, but may be empty, as a bot's caption may: empty text, or text
  of nothing but spaces and line breaks, shows a "Thinking…" placeholder. It has at most 4,096
  characters after formatting is applied.

The draft ID is a nonzero 64-bit integer, which `getMessageDraft` returns in its decimal text form,
as the official server writes it in `stopped_message_generation` updates.

`sendMessageDraft` reads the text's markup, parse mode and entities before the chat, as the official
server does. The chat must be one the bot can address, as for `sendChatAction`, before TDLib checks
the entities, such as a mention of an unknown user. Telegram's servers then refuse a supergroup with
`Bad Request: TEXTDRAFT_PEER_INVALID`, a bot the account blocks with
`Forbidden: bot was blocked by the user`, a missing or zero `draft_id` with
`Bad Request: RANDOM_ID_INVALID`, and longer text with `Bad Request: message is too long`. Those
descriptions are the ones Telegram's servers return to bots; the open-source code does not contain
them or the order in which the servers check, which the emulator takes as listed.

A draft written with `can_stop: true` shows a Stop button, which `account.stopMessageDraft` presses,
as TDLib's [`stopPendingMessage`][stop-pending-message] does. The bot then receives a
`stopped_message_generation` update, as the official server's
[`JsonMessageGenerationStopped`][generation-stopped] writes it: the private chat and the draft ID,
without a user or a `message_thread_id`. The server writes `draft_id` as decimal text, although the
Bot API documentation describes an integer, and the emulator follows the server. Bots receive the
update by default, as they do on Telegram, and stop receiving it when their `allowed_updates` leave
it out.

As `updatePendingMessage` describes, the draft disappears when the account presses Stop, unless the
bot wrote it with `keep_on_stop: true`. A kept draft stays shown without a Stop button until it
expires or the bot sends a message, so pressing Stop again is refused. A draft without a Stop button
cannot be stopped. Each accepted press reaches the bot once, and refused presses change nothing.

Stopping the generation is the bot's job. The emulator reports the press but cannot stop a producer
that keeps writing: a later `sendMessageDraft` shows a draft again, with any Stop button it asks
for, so tests can detect a bot that ignores the stop. A draft never becomes a message on its own: a
bot that wants to keep its partial answer sends it with `sendMessage`, which also removes the draft.

Topics are a [real gap](#real-gaps): `message_thread_id` is refused as an unknown parameter.

## Editing and deleting

Bots edit text, captions, media and inline keyboards with `editMessageText`, `editMessageCaption`,
`editMessageMedia` and `editMessageReplyMarkup`; `editMessageText` also turns text into a
[rich message](rich-messages.md#sending-and-editing) and back. Omitting the inline keyboard in an
edit removes it. Unchanged content and markup produce the message-not-modified error. A
[poll's](polls.md#sending-polls) media cannot be edited. Accounts can edit their own text or
captions through the emulation API, producing `edited_message` updates for eligible bots.

Forwarded messages and messages originally carrying a reply keyboard, keyboard removal or forced
reply cannot be edited. A bot can edit its own content or content sent through its inline mode;
administrator status does not grant general editing of other members' messages. These checks reflect
TDLib's [`MessagesManager::can_edit_message`][edit-permissions]. Inline edits are described under
[inline mode](inline-mode.md).

`deleteMessage` deletes one message and fails if it is missing. `deleteMessages` accepts 1–100 IDs
and skips missing messages. In private chats, the bot may delete either participant's messages. In
supergroups, it may delete its own content; `can_delete_messages` allows deleting other members'
messages and membership service messages. Deleting a message of an album leaves the album's other
messages in it. Deleting a pinned message unpins it, as
[pinned messages](pinned-messages.md#edits-deletions-and-replies) describes.

Accounts delete messages through the emulation API or `account.deleteMessage`, for every
participant, as Telegram's clients delete for everyone. As TDLib's
[`can_revoke_message`][delete-permissions] allows users in private chats, an account deletes either
participant's messages there. In supergroups, [`can_delete_channel_message`][delete-permissions]
lets an account delete its own content, and the owner or an administrator with `can_delete_messages`
delete any message. The official server only drops a deleted message from its cache in
[`updateDeleteMessages`][delete-update], so, as for a bot's deletion, no bot receives an update.
Bots then no longer find the message, for example to edit or reply to it. Deleting the message whose
reply interface the account's client shows removes that interface.

Message deletion does not consider message age, and account edits have no age limit. Scheduled
messages and automatic deletion timers are absent. These timing simplifications are
[intentional](#intentional-deviations).

`editMessageMedia` replaces a message's content with a photo, document, video or audio file and its
caption, read from an `InputMediaPhoto`, `InputMediaDocument`, `InputMediaVideo` or
`InputMediaAudio` as the official server's [`get_input_media`][input-media] reads it: the `media` is
a `file_id` the bot knows, `attach://<part name>` or a URL, a document, video or audio file may have
a thumbnail as for `sendDocument`, a video takes the attributes, spoiler, caption placement and
start that `sendVideo` takes, and an audio file the duration, performer and title that `sendAudio`
takes. As TDLib's [`edit_message_media`][edit-media] allows, a photo, document, video or audio file
changes its media, and a text or rich message becomes media, keeping its ID, its reply and its place
in an album; the old caption goes with the old content. As TDLib's `can_edit_message_media` refuses
it, a voice note's media cannot be replaced (`Bad Request: message media can't be edited`). As
TDLib's `edit_message_media` refuses it once the caption is read, a document or audio file of an
[album](media-and-files.md#albums) cannot become other media, nor other media a document or audio
file (`Bad Request: can't change media type in the album`). A caption or file is refused as by
`sendPhoto`, `sendVideo`, `sendDocument` and `sendAudio`, and media Telegram cannot read fails with
its description prefixed by `Bad Request: can't parse InputMedia:`, such as a `voice_note`, which
the official server reads only in rich messages (`type "voice_note" is not allowed`). Animations and
live photos are [missing](README.md#unimplemented-areas) and refused with
`Bad Request: InputMedia of type "…" is not supported`. An inline message's new media must reuse a
file by its `file_id` or name one by URL, as for
[rich messages](rich-messages.md#sending-and-editing); an upload fails with
`Bad Request: invalid message content specified`.

Deleting a message only for the account is an [intentional deviation](#intentional-deviations).

## Blocking

An account can block or unblock a bot through the emulation API. Each actual transition produces a
`my_chat_member` update, subject to the bot's subscription. While blocked, the account cannot send
to that bot, and the bot's private sends and chat actions fail with
`403 Forbidden: bot was blocked
by the user`. Existing history remains inspectable. Blocking does
not remove shared supergroup membership.

## Forwarding and copying

`forwardMessage` forwards supported content between private chats and supergroups accessible to the
bot. It keeps the original sender/date in `forward_origin` and legacy `forward_from`/`forward_date`,
including when forwarding an existing forward. It preserves `via_bot` and keeps an inline keyboard
only if every button works away from the original message: URL, copy-text, login and disabled
buttons, and the switch-inline buttons of a message sent through an inline bot, which then let the
user choose any chat. A forwarded login button shows its `forward_text`, when it has one, as its
text. Accounts can forward messages from their own chats too.

`copyMessage` returns only the new `message_id`. The copy has no forward origin and uses the
request's reply and markup. A supplied caption, including an empty one, replaces the caption of a
photo, document, video, voice note or audio file; without one the original caption is kept. Forwards
and copies of a rich message disable its [buttons](rich-messages.md#sending-and-editing) that would
not work away from the original. A forward of a poll shows the same poll, while a copy shows a
[new poll without votes](polls.md#forwards-copies-and-replies). Forwards and copies of a
[contact or location](contacts-and-locations.md#forwards-copies-and-replies) repeat it unchanged,
the user of an account's own contact included. `show_caption_above_media` applies to a copied photo
or video when a replacement caption is supplied. As the official server's
[`process_forward_message_query`][forward-video-start] and `process_copy_message_query` read it, a
`video_start_timestamp` gives a forwarded or copied video the second from which it plays, a negative
one its beginning, as TDLib's [`set_message_content_video_start_timestamp`][video-start-replacement]
does; other content ignores it. Without one, a video keeps its own start.

Protected messages, including every message of a supergroup whose owner
[protects its content](supergroups.md#administrator-operations), cannot be forwarded, but bots can
copy them. Service messages can be neither forwarded nor copied. The protected-content exception for
bot copies is explicit in TDLib's [`MessagesManager::can_forward_message`][forward-permissions].
Keyboard filtering follows [`dup_reply_markup`][forward-markup] and
[`InlineKeyboardButton::clone`][forward-buttons], except that a forwarded disabled button keeps its
text, which TDLib's copy leaves empty.

`forwardMessages` and `copyMessages` repeat up to 100 messages of one chat, whose IDs must be in
strictly increasing order, and return the new `message_id`s. As in TDLib's
[`forward_messages_impl`][forward-messages], missing messages and messages that cannot be forwarded
or copied are skipped, and the request fails only when none is left. A message that replies to an
earlier message of the same request replies to that message's new counterpart. Batch copies keep no
reply markup, and `remove_caption` drops media captions.

As TDLib's [`get_forwarded_messages`][forwarded-albums] groups them, the forwards or copies of an
[album](media-and-files.md#albums)'s messages form a new album of their own when a request repeats
two or more of them; a lone one, like a message `forwardMessage` or `copyMessage` repeats, belongs
to no album. A request that repeats 2 to 10 documents and nothing else, or 2 to 10 audio files and
nothing else, all first sent by one user, none of them a forward that hides its original sender,
puts them in one new album, whichever albums they came from, as TDLib does for media that
`is_homogenous_media_group_content` keeps apart.

An account created with `has_private_forwards` keeps forwards from linking to it, as Telegram's
"Forwarded messages" privacy setting does. As TDLib's
[`MessageOrigin::hide_sender_if_needed`][hide-sender] does, forwards of its messages show a
`hidden_user` origin with only its name, and the legacy `forward_sender_name` replaces
`forward_from`. This applies to forwards by bots and accounts, to forwards of those forwards, as
TDLib's [`copy_message_forward_info`][copy-forward-info] hides them again, and to replies from other
chats. Telegram's servers supply the shown name; the emulator uses the account's first and last
name, joined as TDLib's `get_user_title` joins them. The official server serializes the origin in
[`JsonMessageOrigin`][json-origin].

Other origins are users. Channel and chat origins are [real gaps](#real-gaps).

## Intentional deviations

- **Account-to-bot private chats only.** Private chat tests only need conversations between an
  account and a bot. Private conversations between two accounts are intentionally unsupported,
  including [inline-result use](inline-mode.md#intentional-deviations) in those chats.
- **Account edits regardless of age.** Tests should be able to edit account messages regardless of
  their age, so the emulator does not apply TDLib's configurable account edit time limit. Upstream
  already exempts bots editing their own outgoing messages; a blanket "all edits expire after 48
  hours" rule would be incorrect. See [`MessagesManager::can_edit_message`][edit-permissions].
- **Deletion regardless of age.** Bot deletion checks ownership and rights without considering
  message age. TDLib's [`can_delete_channel_message` and `can_revoke_message`][delete-permissions]
  stop bots from deleting messages older than two days in production. Test sessions do not run that
  long, so the limit could not be exercised.
- **Deletion for every participant only.** Telegram's clients can also delete a private message only
  for the account itself. That leaves the bot's copy in place, so no bot can observe it, and the
  emulator keeps one copy of each message that both participants see.
- **Immediate sends only.** The account emulation API does not expose scheduled messages. Tests only
  need immediately sent messages, so scheduling is outside the intended account simulation.
- **No automatic message deletion.** Message fixtures remain available until explicitly deleted or
  the session ends. Automatic deletion timers are intentionally absent to preserve those fixtures.
- **Drafts expire only when a test says so.** Telegram's clients remove a draft 30 seconds after the
  bot's last write, TDLib's [`pending_text_message_period`][pending-period]. Results that depend on
  how long a test runs would be unreliable, so the emulator never removes a draft as time passes.
  Clients also remove a stopped draft kept with `keep_on_stop` after a short time that TDLib does
  not specify. Tests stand in for either timeout with `account.expireMessageDraft`, which removes
  the draft without telling the bot. Given a `draft_id`, it removes only that draft and fails while
  another is shown.
- **Chat actions expire only when a test says so.** Telegram's clients stop showing a bot's chat
  action 5.5 seconds after the bot last sent it, TDLib's [`DIALOG_ACTION_TIMEOUT`][dialog-actions].
  Results that depend on how long a test runs would be unreliable, so the emulator never ends an
  action as time passes. An action the bot stops renewing therefore stays until the bot sends a
  message or `cancel`, and one the bot sends after its last message stays too. Tests stand in for
  the timeout with `account.expireChatAction`, which removes one bot's action from a private chat or
  a supergroup without telling the bot. A supergroup's action ends for every member, as the timeout
  ends it on every member's client; other bots' actions stay, and the bot's next action shows again.
  Keeping the bot's actions and expiries in the intended order is the test's part.

## Real gaps

- **Drafts in topics.** `message_thread_id` is refused, so tests cannot stream drafts to a topic of
  a private chat.
- **Checklist and poll reply targets.** Replies cannot target an individual checklist task or poll
  option. These targets are read by the upstream reply parser,
  [`Client::get_reply_parameters`][reply-parameters], and are missing from the emulator.
- **Channel and chat origins.** Forward origins are users or hidden users. Tests cannot exercise
  channel or chat origins, which TDLib's [forward origin model][forward-origin] supports; they need
  the missing channels and anonymous administrators.
- **Additional content.** The other message kinds listed in the
  [feature inventory](README.md#unimplemented-areas) are not implemented.

## Local evidence

[Bot API service](../../src/services/bot_api.ts),
[bot message sending](../../src/services/bot_message_sending.ts),
[forwarding and copying](../../src/services/bot_message_repetition.ts),
[private messaging](../../src/services/private_messaging.ts),
[message projection](../../src/projections/bot_api_message.ts),
[forward rules](../../src/types/message_forward.ts),
[reply rules](../../src/types/message_reply.ts), [chat actions](../../src/services/chat_action.ts),
[message drafts](../../src/services/message_draft.ts),
[private messaging tests](../../tests/private_messaging_service_test.ts),
[forward tests](../../tests/message_forward_test.ts),
[forwarding and copying tests](../../tests/bot_message_repetition_test.ts),
[reply tests](../../tests/message_reply_test.ts),
[chat action tests](../../tests/chat_action_service_test.ts),
[chat action API tests](../../tests/chat_action_api_test.ts),
[message draft tests](../../tests/message_draft_service_test.ts) and
[message draft API tests](../../tests/message_draft_api_test.ts).

[check-reply]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L9144-L9207
[forward-video-start]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L14365-L14455
[video-start-replacement]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessageContent.cpp#L13180-L13189
[message-quote]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessageQuote.cpp#L54-L71
[dialog-actions]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/DialogActionManager.cpp#L240-L334
[send-message-draft]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L14598-L14615
[text-draft-request]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/Requests.cpp#L4955-L4969
[pending-message]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/generate/scheme/td_api.tl#L10709-L10717
[pending-period]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/OptionManager.cpp#L203
[stop-pending-message]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/generate/scheme/td_api.tl#L13211-L13215
[generation-stopped]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L3980-L3997
[external-reply-input]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessagesManager.cpp#L21264-L21291
[quote-entities]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessageEntity.cpp#L4840-L4853
[replied-message-info]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/RepliedMessageInfo.cpp#L142-L200
[reply-content]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessageContentType.cpp#L848-L884
[reply-parameters]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L10130-L10180
[input-media]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L12794-L12883
[edit-media]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessagesManager.cpp#L23720-L23763
[edit-permissions]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessagesManager.cpp#L23183-L23292
[delete-permissions]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessagesManager.cpp#L8405-L8520
[forward-permissions]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessagesManager.cpp#L8270-L8330
[forward-markup]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/ReplyMarkup.cpp
[silent-message]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessagesManager.cpp#L11842
[notification-object]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/generate/scheme/td_api.tl#L8864-L8868
[delete-update]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L9565-L9576
[forward-origin]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessageForwardInfo.cpp
[hide-sender]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessageOrigin.cpp#L123-L131
[copy-forward-info]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessageForwardInfo.cpp#L182-L192
[json-origin]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L2140-L2185
[forward-messages]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessagesManager.cpp#L24816-L24965
[forwarded-albums]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessagesManager.cpp#L24612-L24814
[forward-buttons]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/InlineKeyboardButton.cpp#L42-L81
[effect-rules]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessageSendOptions.cpp#L161-L170
[message-effects]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L17343-L17375
