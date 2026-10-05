# Text formatting

[Feature index and comparison baseline](README.md) · [Messages](messages.md) ·
[TypeScript client guide: Messages](../clients/typescript/messages.md)

## Supported behavior

Bots format text and captions with `parse_mode` (`HTML`, `MarkdownV2`, legacy `Markdown`) or
explicit `entities`/`caption_entities`. Parse mode names are case-insensitive; `none` disables
markup parsing. A real parse mode takes precedence over supplied entities. Accounts format the text
and captions they send or edit through the emulation API with `entities`/`caption_entities`, in the
Bot API's `MessageEntity` form, which are validated and normalized as bots' are. Telegram clients
turn markup into entities themselves, so accounts have no parse mode.

The parser and normalizer implement the relevant TDLib rules: markup error descriptions, cleaning
control characters, trimming whitespace, shifting entity offsets, sorting entities, removing invalid
overlap and splitting/merging formatting. For example, an unescaped `.` in MarkdownV2 fails. Empty
message text fails; empty captions are allowed. Entity offsets and lengths use UTF-16 code units and
must not split a surrogate pair.

Supported explicit entities are `bold`, `italic`, `underline`, `strikethrough`, `spoiler`, `code`,
`pre` (with optional language), `blockquote`, `expandable_blockquote`, `text_link`, `text_mention`,
`custom_emoji` and `date_time`. `tg://user?id=…` text links become mentions of known session users.

Date and time entities come from explicit `date_time` entities, HTML `<tg-time>` tags or MarkdownV2
`![…](tg://time?…)` links. As in [`Client::get_text_entity_type`][entity-input], a
`date_time_format` is `r` or `R`, or letters for the parts shown; the last letter for a part decides
its precision. Markup keeps every letter, as TDLib's
[`FormattedDate::get_date_flags`][formatted-date] does, and a part given both ways is short.
Returned entities always include `date_time_format`, normalized to `r` or to `w`, `d`/`D` and
`t`/`T` in that order, and empty for no format. Like code, a date holds no other formatting.

Normalized message text is limited to 4,096 Unicode code points; captions to 1,024. Bot API
formatted input has an additional 32,768-byte UTF-8 limit before markup parsing, following
[`Client::get_formatted_text`][formatted-input].

### Detected entities

Telegram marks some entities in text by itself, and the emulator detects them in every message text
and caption, from bots and accounts alike: `mention`, `hashtag`, `cashtag`, `bot_command`, `url`,
`email` and `bank_card_number`. Bot framework handlers for commands, mentions or links therefore
match as they do on Telegram. The Bot API ignores these types when a sender supplies them, as
[`Client::get_text_entity_type`][entity-input] does, so entities copied from a received message can
be sent back, and they are detected again.

The rules are those of TDLib's [`find_entities`][entity-detection], checked against the cases of
TDLib's own [entity tests](../../tests/fixtures/tdlib_detected_entity_cases.ts). Mentions need a
username of at least four characters, or one of Telegram's short usernames, and a URL without a
protocol needs a known top-level domain. Bank card numbers must pass the Luhn checksum. Detected
entities that overlap supplied ones, or each other, are dropped, and none are detected in code. As
in TDLib's [`merge_new_entities`][entity-merging], formatting splits around them.

Telegram's servers detect these entities in the messages they receive; TDLib reproduces their rules
for displaying messages. Phone numbers are a [real gap](#real-gaps).

## Intentional deviations

- **One set of account limits.** Premium account differences are not modeled. Tests use the same
  text and caption limits for every account.
- **No link previews or preview metadata.** Tests should not depend on third-party websites, so the
  emulator does not fetch preview content, and returned messages omit `link_preview_options`.
  TDLib's [`get_message_content_object`][preview-options] derives that object from the preview
  Telegram generated: for bots, a message with a preview reports its URL. It also depends on whether
  the text contains a URL. Without previews, simulated options would differ from what Telegram
  returns, so tests should not expect them.
- **No phone number detection.** Telegram's servers mark `phone_number` entities by rules that are
  not published: TDLib's [`find_entities`][entity-detection] only has a placeholder for them, TDLib
  drops `phone_number` entities that clients specify, and the Bot API server ignores bots'. A
  guessed detector would match numbers differently from Telegram, so tests could pass against the
  emulator and fail in production. The emulator detects none, and handlers for phone numbers do not
  match.

## Real gaps

- **Mention access and privacy.** A text mention may reference any known account or bot in the
  session. Simulated access and privacy restrictions are missing, so tests cannot exercise them.
  TDLib resolves mentioned users in [`get_message_entities`][message-entities]; the exact remote
  authorization rules are not established by that local parser.
- **Custom emoji availability and eligibility.** Emoji IDs are only checked for valid syntax. Tests
  need simulated emoji availability and bot eligibility checks. These checks must work within the
  isolated session; the local upstream parser does not establish remote emoji availability.

## Comparison limits

TDLib is not linked into the emulator. The
[markup fixtures](../../tests/fixtures/tdlib_markup_cases.ts), detection fixtures and normalization
tests provide regression coverage, not proof that every input has the same output upstream.
Detection uses the Unicode tables of the JavaScript runtime, which can differ from TDLib's for
characters added in later Unicode versions. Nested JSON fields also follow the emulator's
intentional [stricter validation](sessions-and-requests.md#strict-request-validation).

## Local evidence

[Parse mode dispatch](../../src/text_entities/parse_mode.ts),
[normalization](../../src/text_entities/formatted_text.ts),
[entity detection](../../src/text_entities/detected_entities.ts),
[Bot API entity input](../../src/api/sessions/bot_api/message_entities_parameter.ts),
[markup tests](../../tests/text_markup_test.ts),
[normalization tests](../../tests/formatted_text_test.ts) and
[detection tests](../../tests/detected_entities_test.ts).

[formatted-input]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L11955-L12000
[entity-input]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L11872-L11952
[formatted-date]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/FormattedDate.cpp#L106-L132
[entity-detection]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessageEntity.cpp#L1742-L1781
[entity-merging]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessageEntity.cpp#L4440-L4475
[message-entities]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessageEntity.cpp#L3650-L3800
[preview-options]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessageContent.cpp#L11420-L11449
