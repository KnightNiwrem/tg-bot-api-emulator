# Rich messages

[Feature index and comparison baseline](README.md) · [Messages](messages.md) ·
[Text formatting](text-formatting.md) · [Keyboards and callbacks](keyboards-and-callbacks.md) ·
[TypeScript client guide: Rich messages](../clients/typescript/rich-messages.md)

## Sending and editing

Bots send rich messages with `sendRichMessage` to private chats and supergroups. A rich message is
text laid out in blocks: paragraphs, headings, preformatted text, footers, dividers, mathematical
expressions, anchors, lists, quotations, collages, slideshows, tables, details, maps, rows of
buttons, photos, documents, videos and voice notes. Its text nests formatting, dates, links, text
mentions, custom emoji, references and buttons. The other parameters work as for `sendMessage`. The
emulator supports rich messages described as `blocks`; messages written in HTML or Markdown are an
[intentional deviation](#intentional-deviations).

The official server's [`get_input_rich_message`][input-rich-message],
[`get_input_page_block`][input-page-block] and [`get_rich_text`][input-rich-text] read the blocks,
and TDLib's [`RichMessage::get_rich_message`][rich-message], [`get_web_page_blocks`][input-blocks]
and [`RichText::get_rich_text`][tdlib-rich-text] check them. The emulator refuses what they refuse,
with their descriptions. For example, a heading size must be from 1 to 6, a list must be either
ordered or unordered, and a map's zoom and dimensions must fit TDLib's limits. A string that is not
well-formed Unicode fails, such as `Bad Request: rich text must be encoded in UTF-8`, and other
strings are cleaned as message text is. A text mention must name a user of the session:
`Bad Request: user not found`.

The sent message, and the same message in account history, shows the blocks in `rich_message`, as
the official server's [`JsonRichMessage`][rich-message-json] and [`JsonRichBlock`][rich-block-json]
show the message TDLib gives them. The message has no `text`, and TDLib's
[`get_message_content_text`][content-text] gives it none, so replies can quote no part of it. A
reply to it from another chat shows no content in `external_reply`, which has no field for one. As
TDLib keeps and shows them:

- A mention, hashtag, cashtag, bot command or bank card number that a bot specifies keeps only its
  text. Telegram detects those entities, URLs and email addresses in the plain text of the message
  unless `skip_entity_detection` is set. Each detected entity shows the text it covers, such as a
  mention's `username`.
- A reference without text is an anchor. A link to `#` and the name of an anchor or a reference of
  the message, raw or URL-decoded, is an `anchor_link` or `reference_link`, and `#` alone links to
  the top of the message. [`get_page_blocks_object`][page-blocks-object] resolves them. A link to a
  name the message lacks stays a `url`.
- A list item shows the label that [`get_ordered_list_label`][list-label] gives it, such as `iv.`,
  or `•` for an unordered item. An item without blocks holds an empty paragraph, as TDLib shows one
  that Telegram sends without content.
- A table cell is aligned left, or centered as a header, and to the middle, unless it says
  otherwise. It spans at least one column and row, and a cell without text is invisible, as the
  server's [`get_page_block_table_cell`][table-cell] and [`JsonRichTableCell`][table-cell-json]
  treat it. Empty captions and credits are left out.
- A map's zero dimension clears both, as TDLib's [`get_dimensions`][dimensions] does. Its location's
  accuracy is at most 1500 meters, rounded up to whole meters as for shared locations.

For assertions about content, the TypeScript client's `richMessageToPlainText` gives the text a rich
message shows, one block per line, including the content of closed `details` and expandable
blockquotes, and `listButtons` gives each of its buttons, disabled ones too, with its label and
where it is.

Buttons, in rows and in text, act as inline keyboard buttons of the same kind. TDLib's
[`get_inline_keyboard_button`][inline-button] reads them, so their links are checked and normalized
as keyboard links are. Their style is read as the server's [`get_button_style`][button-style] reads
a rich message's, which also accepts `link`. Callback data must fit in 64 bytes:
`Bad Request: BUTTON_DATA_INVALID`. An account presses a callback button of a rich message by its
`callback_data`, as it presses one of an inline keyboard. A login button cannot name a
`bot_username`: `Bad Request: bot username must be empty for login_url buttons in rich messages`.
Forwards and copies keep URL and copy-text buttons, and show the others as disabled buttons with
their text and style, as TDLib's [`InlineKeyboardButton::clone`][button-clone] decides. Login
buttons are the exception: a forward keeps them, showing their `forward_text` as plain text when
they have one, and a copy turns them into URL buttons. As for text, `copyMessage` ignores a
`caption` for a rich message.

Photo, document, video and voice note blocks hold an `InputMediaPhoto`, `InputMediaDocument`,
`InputMediaVideo` or `InputMediaVoiceNote`, whose `media` is a `file_id` the bot knows,
`attach://<part name>` for a file uploaded with the request, or an HTTP or HTTPS URL. A block's
media must be of the block's type, such as
`Bad Request: unexpected media type "photo" for block "video"`, and its caption is ignored. A
document's or video's thumbnail works as for `sendDocument` and `sendVideo`, and a video's duration
and dimensions and a voice note's duration are clamped as for `sendVideo` and `sendVoice`. TDLib's
[`get_web_page_blocks`][input-blocks] keeps only a video's file and spoiler, so a video's
`start_timestamp` and `supports_streaming` are validated and ignored; a `cover` is refused, as
[video covers](media-and-files.md#video-covers) are missing. A file reused by `file_id` keeps its
own attributes, and one of another type or that the bot does not know fails as for the send methods,
such as `Bad Request: can't use file of type Photo as VoiceNote` or
`Bad Request: wrong file identifier/HTTP URL specified`. Uploads are checked as for `sendPhoto`,
`sendDocument`, `sendVideo` and `sendVoice`. A URL is read and downloaded as for those methods, as
[files sent by URL](media-and-files.md#files-sent-by-url) describes: the emulator downloads it from
the session's emulated web, where tests register what each URL serves, and never from the network. A
photo must be served as an image of at most 5 MB, a document as a PDF or ZIP file, a video as
`video/mp4` and a voice note as `audio/ogg`, each of at most 20 MB. A voice note stays a voice note
however large, as a block has no document to become, which `sendVoice` makes of one larger than 1
MB. The files are downloaded in the order the message shows them, and the first that fails fails the
message with its download error, such as `Bad Request: failed to get HTTP URL content`.

Every file of a message is resolved before anything is sent or edited, so a message that fails for
any of its files, however deeply nested, sends nothing, leaves an edited message as it was, and
stores none of its uploads or downloads: a file is stored only with the message that shows it. A
photo shows its one kept size, and `has_spoiler` when the media covers it. A video shows its `Video`
without a start timestamp, and `has_spoiler` likewise; TDLib never plays a block's video
automatically or loops it, so the server's `need_autoplay` and `is_looped` never appear. A voice
note shows its `Voice`. As for [other media](media-and-files.md#supported-behavior), each observer
receives its own `file_id` for each file, in forwards and copies too, and bots download the files
with `getFile`.

`editMessageText` with a `rich_message` replaces the content of a text or rich message with a rich
message, and any `text` is ignored, as in the server's
[`process_edit_message_text_query`][edit-text-query]. As TDLib's [`edit_message_text`][edit-text]
allows, text can replace a rich message too. An empty `rich_message` fails as for sending, and an
unchanged message fails with `Bad Request: message is not modified: …`. The new rich message names
its files as a sent one does. An inline message's new rich message, edited by its
`inline_message_id`, reuses files by `file_id` or names them by URL, but as TDLib's
[`edit_inline_message_text`][edit-inline-text] requires, it uploads none:
`Bad Request: invalid message content specified`. `editMessageCaption` finds no caption in a rich
message.

A rich message that an [inline query result](inline-mode.md#supported-behavior) sends as its
`input_message_content` cannot name files by URL, unlike an edit of the inline message it becomes:
its photos, documents, videos and voice notes must be files the bot knows by `file_id`. TDLib's
[`get_inline_message`][inline-rich-message] passes the message on only when
[`get_input_rich_message`][tdlib-input-rich-message] finds every file already on Telegram's servers,
so an upload or a URL fails `answerInlineQuery` with
`Bad Request: invalid inline message content specified`. An account's choice of the result sends
those same files each time. Photo, document, video, voice and audio results themselves can
[name their files by URL](inline-mode.md#media-named-by-url), which an account's choice downloads,
unless the result's `input_message_content` replaces them.

## Intentional deviations

- **No HTML or Markdown.** Telegram's servers parse rich messages written with `html` or `markdown`.
  TDLib's [`RichMessage::get_rich_message`][rich-message] and
  [`get_input_rich_message`][tdlib-input-rich-message] pass the markup to them unparsed, so the
  open-source code does not contain the rules. A guessed parser would let tests pass against the
  emulator and fail in production. The emulator refuses such messages:
  `Bad Request: rich messages written in HTML or Markdown are not supported`.
- **Strict input.** Telegram reads a missing text as empty text, ignores unknown fields, and uses
  the first of `blocks`, `markdown` and `html` it finds. The emulator requires the fields the Bot
  API documents and exactly one source, and rejects other JSON as invalid parameters, to surface the
  bot's mistake in tests.
- **Documented limits without Telegram's descriptions.** Telegram's servers check what the Bot API
  documents but TDLib does not: a row has at most 8 buttons, only a callback button has the `link`
  style, a button's text holds only custom emoji and dates, and only drafts hold `thinking` blocks.
  The emulator refuses such messages with descriptions of its own, as it refuses a message without
  blocks.
- **Blocks read before the chat.** TDLib checks the blocks when it sends the message, after the
  server looks at the chat. The emulator reads the blocks and their files first, so a request that
  also names an unknown chat fails for its blocks.

## Real gaps

- **Drafts.** `sendRichMessageDraft` and `sendMessageDraft` are missing, along with the
  `stopped_message_generation` updates of drafts that users stop. Tests cannot observe streamed
  drafts.
- **Other media blocks.** Animation and audio blocks fail with
  `Bad Request: rich message blocks with an animation or an audio file are not supported`, as
  animations are [missing](media-and-files.md#additional-media-types-and-methods), and the
  emulator's [audio files](media-and-files.md#audio-files) have no blocks yet. Tests need rich
  messages that show them.
- **Accounts' rich messages.** Accounts cannot send or copy rich messages; they forward them as
  other messages. [Inline query results](inline-mode.md#supported-behavior) can send rich messages
  on an account's behalf.

## Comparison limits

TDLib sends the blocks to Telegram's servers, whose storage and checks the open-source code does not
show. The emulator shows the blocks as TDLib would show them if the servers returned them unchanged,
apart from detected entities. Their detection rules for rich text are not public. The emulator
applies the [rules of message text](text-formatting.md#detected-entities) to each plain text on its
own, outside code, preformatted blocks, links, text mentions, dates and buttons, and detects no
phone numbers. Telegram may also limit the length of rich text, the number of blocks, or map
dimensions it fills in, which the emulator does not.

## Local evidence

[Parameter reading](../../src/api/sessions/bot_api/rich_message_parameter.ts),
[domain model](../../src/types/rich_message.ts),
[normalization](../../src/services/rich_message_normalization.ts),
[projection](../../src/projections/bot_api_rich_message.ts),
[URL downloads](../../src/api/sessions/bot_api/web_file_parameter.ts),
[unit tests](../../tests/rich_message_test.ts), [HTTP tests](../../tests/emulation_api_test.ts),
[video and voice note block tests](../../tests/rich_video_voice_blocks_api_test.ts) and
[inline URL media tests](../../tests/inline_result_media_api_test.ts).

[input-rich-message]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L12462-L12486
[input-page-block]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L12267-L12437
[input-rich-text]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L12111-L12251
[table-cell]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L12072-L12109
[button-style]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L10226-L10246
[edit-text-query]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L14651-L14705
[rich-message-json]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L1023-L1039
[rich-block-json]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L4496-L4736
[table-cell-json]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L924-L961
[rich-message]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/RichMessage.cpp#L89-L135
[tdlib-input-rich-message]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/RichMessage.cpp#L233-L319
[input-blocks]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/WebPageBlock.cpp#L5535-L5809
[tdlib-rich-text]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/WebPageBlock.cpp#L159-L413
[page-blocks-object]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/WebPageBlock.cpp#L5839-L5861
[list-label]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/WebPageBlock.cpp#L2096-L2165
[dimensions]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/Dimensions.cpp#L24-L33
[inline-button]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/InlineKeyboardButton.cpp#L227-L387
[button-clone]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/InlineKeyboardButton.cpp#L42-L82
[content-text]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessageContent.cpp#L12268-L12286
[edit-text]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessagesManager.cpp#L23493-L23539
[edit-inline-text]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/InlineMessageManager.cpp#L219-L261
[inline-rich-message]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/InlineQueriesManager.cpp#L584-L598
