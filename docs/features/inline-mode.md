# Inline mode

[Feature index and comparison baseline](README.md) ·
[Keyboards and callbacks](keyboards-and-callbacks.md)

## Supported behavior

Create a bot with `supports_inline_queries: true`. An account can send it an inline query from a
private chat with a bot or from a supergroup. The bot receives `inline_query` with the account,
query, offset and appropriate `chat_type`, subject to its update subscription.

### User locations

A bot created with `requests_inline_location: true` stands in for BotFather's inline location
setting. An account can then share a `location` with its queries, which the bot receives in
`inline_query` and in the `chosen_inline_result` of a result sent from that query, as the official
server's [`JsonInlineQuery`][inline-query-json] and `JsonChosenInlineResult` show TDLib's user
location. As TDLib's `get_input_geo_point` sends it to Telegram, a horizontal accuracy is rounded up
to whole meters, and 0 means unknown. Telegram's apps share a location only with bots that request
it, so the emulator refuses a location for any other bot with `409`; coordinates outside ±90° and
±180° or an accuracy above 1500 meters are refused with `400`.

The bot answers with `answerInlineQuery`. Tests can inspect the answer and choose a result, sending
it to the original chat as the account's message with `via_bot`. The inline bot need not be a member
of the destination supergroup. Choices can be repeated while the account can still write there.
Eligible chat bots receive the resulting account message; privacy mode includes messages sent
through the observing bot.

Supported results are articles, [contacts and static locations](#contacts-and-locations), and
photos, documents, videos and voice notes identified by a `file_id` the bot knows or
[named by URL](#media-named-by-url). Any of them may specify `input_message_content` of text, a rich
message, a contact or a static location, which an article requires; the chosen message then holds
that content in place of what the listing shows. A video result needs a nonempty title
(`Bad Request: VIDEO_TITLE_EMPTY`), as a document result does (`Bad Request: FILE_TITLE_EMPTY`); a
voice note result has no description. Supported caption formatting and inline keyboards apply. A
rich message, which the official server's [`get_input_message_content`][input-message-content] reads
in place of text, is read as for [`sendRichMessage`](rich-messages.md#sending-and-editing), and its
buttons work as in any inline message. As TDLib's
[`InlineQueriesManager::get_inline_message`][inline-rich-message] requires, its photos and documents
are files the bot knows by `file_id`; an upload fails with
`Bad Request: invalid inline message content specified`. The server prefixes its own descriptions of
a rich message it cannot read with `can't parse InlineQueryResult:`, which the emulator words as for
`sendRichMessage`. Answers allow up to 50 results, unique nonempty result IDs of at most 64 UTF-8
bytes and a `next_offset` of at most 64 UTF-8 bytes. As TDLib's
[`get_input_bot_inline_result`][results] does, the emulator cleans every result's title and
description with `clean_input_string` before listing them, and refuses text that is not well-formed
Unicode with `Bad Request: strings must be encoded in UTF-8`. The emulator checks button options,
result count and message content before query state and result metadata, producing errors such as
`RESULT_ID_DUPLICATE` and the query-too-old error.

With `receives_chosen_inline_results: true`, a choice also generates `chosen_inline_result` for the
inline bot. If the result has an inline keyboard, that update supplies `inline_message_id`. Callback
presses then reach the inline bot without a message payload. That bot can edit text, captions, media
and keyboards using the inline ID, with a result of `true`, even without access to the chat. If it
can access the chat, it can also edit via `chat_id`/`message_id`; another bot cannot edit the inline
message. TDLib makes the originating bot check in
[`MessagesManager::can_edit_message`][edit-inline]. Media edits of an inline message reuse a file by
`file_id` or name one by URL, but an upload fails with
`Bad Request: invalid message content specified`. A voice note sent from a result keeps its media,
as any voice note does (`Bad Request: message media can't be edited`), while its caption and
keyboard can change.

### Contacts and locations

A contact result lists the names and phone number that TDLib's
[`get_input_bot_inline_result`][results] trims: its title is the first name, followed by the last
name after a space, and its description is the phone number, both then cleaned as every result's
title and description are. An empty trimmed phone number fails with
`Bad Request: field "phone_number" must contain a valid phone number`, and an empty first name with
`Bad Request: field "first_name" must be non-empty`. The emulator gives the same errors when
cleaning empties the phone number, or the title of a contact without a last name, which TDLib would
pass on to Telegram with an unknown outcome. The contact it sends keeps the texts as the bot wrote
them and is read as for [`sendContact`](contacts-and-locations.md#contacts): texts are cleaned,
names may have at most 64 characters and a vCard at most 2048 bytes, and it names no Telegram user.
A static location result lists its title and, as TDLib describes it, its coordinates to six decimal
places, and sends the location as [`sendLocation`](contacts-and-locations.md#locations) reads one:
coordinates outside ±90° and ±180° fail with `Bad Request: invalid location specified`, and an
accuracy, from 0 to 1500 meters, is rounded up to whole meters. The same rules apply to
`input_message_content` of a contact (`phone_number`, `first_name`, `last_name`, `vcard`) or a
location (`latitude`, `longitude`, `horizontal_accuracy`). The emulator checks a location result's
own coordinates even when its `input_message_content` replaces them, where TDLib only lists them.

As for `sendLocation`, live locations are not supported: `live_period`, `heading` and
`proximity_alert_radius` fail with the invalid-parameters error, in a result or its content. The
official server's [`get_input_message_content`][input-message-content] reads content with
coordinates, a `title` and an `address` as a venue, and content with a `payload` as an invoice; both
fail with `Bad Request: inline query results sending a venue or invoice are not supported`.

### Media named by URL

As TDLib's [`get_input_bot_inline_result`][results] reads them, `photo_url`, `document_url`,
`video_url` and `voice_url` name a file by URL when they contain a dot; otherwise they are a
`file_id`. TDLib passes the URL on as a web document, so answering does not download it, and
Telegram's servers check it: a URL the emulator cannot read as an HTTP or HTTPS URL, as for
[files sent by URL](media-and-files.md#files-sent-by-url), fails with
`Bad Request: WEBDOCUMENT_URL_INVALID`, as does a `thumbnail_url` of such a result that cannot be
read, since TDLib passes it on as a web document too. A photo without the `thumbnail_url` the Bot
API requires fails with `Bad Request: PHOTO_THUMB_URL_EMPTY`. A document must declare a `mime_type`
that begins with `application/pdf` or `application/zip`, which TDLib checks before anything else,
failing with `Bad Request: unallowed document MIME type`, and a video one that begins with
`video/mp4` or `text/html`, failing with `Bad Request: unallowed video MIME type`. A refused answer
records none of its results.

A video declared as `text/html` is a web page with an embedded video player, such as a YouTube page.
The Bot API requires such a result to replace its content with `input_message_content`, so the
emulator refuses one without it with
`Bad Request: inline query results with an embedded video player must specify input_message_content`;
what Telegram does instead is not documented. The page is only listed and never downloaded. The Bot
API also requires the `thumbnail_url` of a video named by URL, for which Telegram documents no
error, so the emulator refuses a video URL without one with the invalid-parameters error, and a
thumbnail URL it cannot read with `Bad Request: WEBDOCUMENT_URL_INVALID`, as for a photo.

Telegram downloads the file when an account sends the result: `messages.sendInlineBotResult`, unlike
`messages.setInlineBotResults`, fails with the download errors `WEBPAGE_CURL_FAILED` and
`WEBPAGE_MEDIA_EMPTY`. The emulator therefore downloads the file from the session's
[emulated web](media-and-files.md#files-sent-by-url) each time an account chooses the result, and
stores it as a new file, as a file a bot sends by URL. Inline results have their own contracts in
the Bot API reference rather than those of the send methods: a photo must be a JPEG image of at most
5 MB, which the emulator requires to be served as `image/jpeg` and to read as a JPEG image, and a
document a PDF or ZIP file, served as `application/pdf` or `application/zip`, of at most 20 MB, the
limit of other files sent by URL. A video file must be served as `video/mp4`, the only file type the
reference allows, and a voice note as `audio/ogg`, the type TDLib declares for it, each of at most
20 MB. Unlike with `sendVoice`, a voice note larger than 1 MB stays a voice note, as nothing
documents the conversion to a file for inline results. A photo is then read as an uploaded one; a
document, and a video whose URL path names a file, is named after the URL's last path segment, and
each keeps the type it was served as. A video keeps the duration, width and height the bot
specified, clamped as for `sendVideo`, and a voice note its specified duration; a video or voice
note the bot knows by `file_id` keeps its own. The declared photo dimensions and the thumbnails of
other results are validated and ignored; the client lists a thumbnail without the emulator
downloading it.

Choosing a result whose media no resource serves fails with `502`, and one whose media is empty,
served as another type, or a photo that is not a readable JPEG image fails with `422`; neither sends
a message or a `chosen_inline_result`. The file is downloaded before the account's access to the
chat is checked, and stored only with the message, so a choice the chat refuses stores no file. A
result with `input_message_content` sends that content, and its file, which only the listing shows,
is never downloaded. Cached answers, personal or not, hold the URL rather than a file, so every
account that sends a result from one downloads the file anew.

### Answer caching

An answer is reused for `cache_time` seconds, 300 by default. A repeated query within that time is
created already answered, and the bot receives no `inline_query` update. TDLib's
[`send_inline_query`][cache] identifies a repeated query by bot, chat type, offset and text without
surrounding whitespace, and reuses the answer for the account that received it whatever
`is_personal` says; it records the expiry when the [answer arrives][cache-expiry]. An answer that is
not personal is also reused for other accounts, as the Bot API documents for Telegram's server
cache. The server's cache key is not in the open-source code, so the emulator uses TDLib's. Reused
answers expire with the original, and the bot cannot answer a query that received one. Bots that
need a fresh answer every time answer with `cache_time: 0`. For a bot that requests locations,
TDLib's key also includes a shared location's coordinates in whole ten-thousandths of a degree, so a
query from elsewhere, or without a location, reaches the bot.

## Intentional deviations

**Account-to-bot private chats only.** Private chat tests only need conversations between an account
and a bot. Private conversations between two accounts, including inline-result use there, are
intentionally outside the emulator's scope.

**No timed query expiry.** Test timing should not invalidate unanswered inline queries, so queries
never expire with elapsed time. Unknown, wrong-bot and already answered query IDs still fail.

**Deterministic chosen-result feedback.** Feedback is an on/off switch: every choice generates
feedback when enabled. BotFather sampling percentages are not modeled, so tests can rely on
deterministic feedback.

**Result-header button metadata only.** The button above results can be recorded as a start-bot or
web-app button, including legacy `switch_pm_text`/`switch_pm_parameter`. Inspecting that metadata is
sufficient for the intended tests; pressing the button, launching an app and following the start
flow are intentionally unsupported. TDLib's [answer validation][answer] handles these button
variants.

**Metadata without rendering or media processing.** Thumbnail metadata is accepted where supported
by the result schema, but thumbnails are not downloaded or rendered. Optional photo dimensions are
validated without changing the stored photo. Tests inspect the metadata without fetching thumbnails
or reproducing a client UI.

**Opaque inline message identifiers.** Inline message IDs are emulator handles, without
TDLib-compatible encoding. Tests should treat them as opaque values.

## Real gaps

- **Additional results and input content.** Audio, animation, sticker, venue and game results are
  unsupported, as are venue, invoice and live location `input_message_content`, until the emulator
  models those messages. Compare the result dispatch in
  [`InlineQueriesManager::get_input_bot_inline_result`][results].

- **Prepared messages and sharing.** Prepared inline messages and result-sharing flows are not
  implemented. Tests currently have to use the supported query-and-choice workflow.

- **Basic groups and channels.** Inline use in these chats is missing along with their
  [HTTP messaging workflows](supergroups.md#real-gaps).

- **Business and ephemeral messages.** These variants are absent, along with their broader
  [feature workflows](README.md#unimplemented-areas).

## Comparison limits

TDLib passes query answers to Telegram's remote server in [`answer_inline_query`][answer]. The exact
remote expiry and repeated-answer rules were not verified through live calls. When Telegram
downloads media named by URL, and whether it reuses a download for later sends, is inferred from the
documented errors of `messages.setInlineBotResults` and `messages.sendInlineBotResult` rather than
from source code; Telegram's own wording of `WEBDOCUMENT_URL_INVALID` and its URL checks are not
public.

## Local evidence

[Inline query service](../../src/services/inline_query.ts),
[result parsing](../../src/api/sessions/bot_api/inline_query_answer_parameters.ts),
[message edit permissions](../../src/types/virtual_message.ts),
[inline tests](../../tests/inline_query_service_test.ts),
[HTTP tests](../../tests/emulation_api_test.ts),
[URL media tests](../../tests/inline_result_media_api_test.ts) and
[contact and location result tests](../../tests/inline_result_contact_location_api_test.ts).

[edit-inline]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessagesManager.cpp#L23183-L23292
[results]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/InlineQueriesManager.cpp#L870-L1280
[answer]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/InlineQueriesManager.cpp#L696-L760
[inline-query-json]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L5439-L5535
[input-message-content]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L10842-L10848
[inline-rich-message]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/InlineQueriesManager.cpp#L584-L598
[cache]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/InlineQueriesManager.cpp#L1335-L1410
[cache-expiry]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/InlineQueriesManager.cpp#L2280-L2320
