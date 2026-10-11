# Upstream revisions

The emulator follows Telegram's open-source software as it was at fixed commits. This page lists the
upstream commits the repository cites and the areas of the emulator that depend on each. It is
maintained by hand, and nothing checks it against the citations, so treat it as the starting point
for a re-review after an upstream release, not as a guarantee: compare the cited files between the
listed commit and the new one, re-check the listed areas, update the links that cite the commit, and
search the repository for citations this page misses. A change that cites another upstream commit
adds it here.

## Official Bot API server

**[`tdlib/telegram-bot-api` at `e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1`](https://github.com/tdlib/telegram-bot-api/commit/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1)**,
committed 2026-08-25, Bot API 10.3. It is the server the
[comparison baseline](features/README.md#comparison-baseline-and-evidence) names.

- `telegram-bot-api/Client.cpp`:
  - the methods the server implements and how it reads their parameters, which
    `src/api/sessions/bot_api/` follows;
  - the error descriptions the server writes, which the error catalogue in
    `src/api/sessions/bot_api/errors/` links to;
  - how the server writes Bot API objects, which `src/projections/` and the wire types in
    `src/types/bot_api*.ts` follow, and which the evidence of the deviations in
    `tests/bot_api_type_conformance_test.ts` cites;
  - the update queue, `getUpdates` and webhook settings.
- `telegram-bot-api/WebhookActor.cpp` and `WebhookActor.h`: webhook delivery and retries.
- `telegram-bot-api/Query.cpp` and `Query.h`: how answers and errors, with `retry_after`, are
  written.
- Feature pages: every page in [`docs/features/`](features/README.md) cites it.
- Code and tests citing it: `src/api/sessions/bot_api/errors/error_template.ts`, the root of the
  error catalogue's links; `src/types/bot_api.ts`; `tests/bot_api_error_presentation_test.ts`, which
  checks that the catalogue's links use this revision; and `tests/bot_api_type_conformance_test.ts`.

## TDLib

**[`tdlib/td` at `bc9c263e2bfee06aaab41e82db51a103376030bc`](https://github.com/tdlib/td/commit/bc9c263e2bfee06aaab41e82db51a103376030bc)**,
committed 2026-08-24, TDLib 1.8.67: the
[submodule revision of that Bot API server](https://github.com/tdlib/telegram-bot-api/tree/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/td).
The emulator's local checks, limits and text handling follow it, and `src/` names the TDLib
functions it follows.

- `td/telegram/MessageEntity.cpp` and `LinkManager.cpp`: text parsing, entity detection and links,
  in `src/text_entities/`. The detected-entity cases in
  `tests/fixtures/tdlib_detected_entity_cases.ts` and the date and time cases in
  `tests/fixtures/tdlib_markup_cases.ts` come from its `test/message_entities.cpp`.
- `td/telegram/misc.cpp`: which usernames and language codes are valid.
- `td/telegram/Requests.cpp`: how requests for drafts and bot descriptions are read.
- `td/telegram/MessagesManager.cpp`, `MessageContent.cpp`, `MessageContentType.cpp`,
  `MessageForwardInfo.cpp`, `RepliedMessageInfo.cpp` and `MessageQueryManager.cpp`: sending,
  editing, forwarding, copying, replying to and deleting messages.
- `td/telegram/files/`, `DocumentsManager.cpp`, `PhotoSize.cpp`, `VideosManager.cpp` and
  `VoiceNotesManager.cpp`: media and files.
- `td/telegram/PollManager.cpp` and `PollOption.cpp`: polls.
- `td/telegram/InlineKeyboardButton.cpp`, `KeyboardButton.cpp`, `ReplyMarkup.cpp`,
  `RequestedDialogType.cpp` and `CallbackQueriesManager.cpp`: keyboards and callback queries.
- `td/telegram/InlineQueriesManager.cpp`: inline mode.
- `td/telegram/DialogParticipant.cpp`, `DialogParticipant.h`, `DialogParticipantManager.cpp`,
  `DialogManager.cpp` and `DialogInviteLinkManager.cpp`: supergroups, members, administrator rights
  and invite links.
- `td/telegram/MessageReaction.cpp`: reactions.
- `td/telegram/WebPageBlock.cpp` and `RichMessage.cpp`: rich messages.
- `td/telegram/Location.cpp`: locations.
- `td/telegram/UpdatesManager.cpp` and `tddb/td/db/TQueue.cpp`: the update queue and which updates
  bots receive.
- `tdnet/td/net/HttpReader.cpp`, `HttpConnectionBase.cpp`, `tdutils/td/utils/HttpUrl.cpp` and
  `JsonBuilder.cpp`: how requests are read, in `src/api/`.
- `td/generate/scheme/td_api.tl`: the TDLib API's own descriptions of fields and limits.
- Feature pages: every page in [`docs/features/`](features/README.md), the index included, except
  `bot-activity.md`.
- Code and tests citing it: `src/api/sessions/bot_api/errors/error_template.ts`, the root of the
  error catalogue's links; `tests/bot_api_error_presentation_test.ts`, which checks that the
  catalogue's links use this revision; `tests/bot_api_type_conformance_test.ts`; and the fixtures
  `tests/fixtures/tdlib_detected_entity_cases.ts` and `tests/fixtures/tdlib_markup_cases.ts`.

**[`tdlib/td` at `ea97bcdd3a15523c58ddfe772b4547187cf5bbeb`](https://github.com/tdlib/td/commit/ea97bcdd3a15523c58ddfe772b4547187cf5bbeb)**,
committed 2026-09-21: the tests that the text-handling fixtures were ported from.

- `test/message_entities.cpp`: the HTML and MarkdownV2 cases in
  `tests/fixtures/tdlib_markup_cases.ts` and the `fix_formatted_text` cases in
  `tests/formatted_text_test.ts`.
- `test/link.cpp`: the `check_link` cases in `tests/telegram_link_test.ts`.

## Official Telegram apps

The feature pages cite official apps where the Bot API server and TDLib leave a behavior to the
client, such as which buttons a client shows.

- **[`telegramdesktop/tdesktop` at `64ca5475f24dde7331a388176d3fe60c0849b965`](https://github.com/telegramdesktop/tdesktop/commit/64ca5475f24dde7331a388176d3fe60c0849b965)**,
  committed 2026-09-24: requesting the account's phone number, in
  [contacts and locations](features/contacts-and-locations.md), and sending a bot command, in
  [keyboards and callbacks](features/keyboards-and-callbacks.md).
- **[`telegramdesktop/tdesktop` at `d8594c011756265de4385408540bd9f7c787a003`](https://github.com/telegramdesktop/tdesktop/commit/d8594c011756265de4385408540bd9f7c787a003)**,
  committed 2026-10-02: requesting a poll, in
  [keyboards and callbacks](features/keyboards-and-callbacks.md), and the emoji stripped from a
  member's custom title, which administrators another may edit or restrict, and the rights editor,
  in [supergroups](features/supergroups.md).
- **[`DrKLO/Telegram` at `f2908b14133bbffbf7ab04f641ecb5bfaf533242`](https://github.com/DrKLO/Telegram/commit/f2908b14133bbffbf7ab04f641ecb5bfaf533242)**,
  committed 2026-09-30, Telegram for Android 12.10.6: sending a location and sharing a contact, in
  [contacts and locations](features/contacts-and-locations.md).

## Type reference

The compile-time check in `tests/bot_api_type_conformance_test.ts` compares the emulator's wire
types with grammY's types at
[`grammyjs/types` v5.0.0](https://github.com/grammyjs/types/tree/v5.0.0), which `deno.json` imports
as `grammy-types-reference`. Its deviations name the grammY types that should prompt their re-review
when they change.
