# Media and files

[Feature index and comparison baseline](README.md) · [Message operations](messages.md)

## Supported behavior

Bots send photos and documents with `sendPhoto` and `sendDocument`, and in the blocks of
[rich messages](rich-messages.md). Files can be multipart uploads, either in the part named for the
parameter or referenced with `attach://<part-name>`, or an existing `file_id` known to that bot.
Accounts upload base64 content through the emulation API; the TypeScript client accepts bytes and
performs the encoding. Both sides can supply captions and caption entities.

Photos expose dimensions, `has_media_spoiler` when requested and `show_caption_above_media` for a
caption above the photo. Documents expose their cleaned filename and a MIME type derived from its
extension, falling back to `application/octet-stream` for unknown extensions. Empty uploads fail.
Photo uploads larger than 10 × 1024 × 1024 bytes fail before the image is read, from bots and
accounts alike, as TDLib's [`check_full_local_location`][photo-size-limit] refuses them; bots
receive
`Bad Request: file of size <size> bytes is too big for a photo; the maximum size is 10485760 bytes`.
Captions can be edited with `editMessageCaption` or the account client, and bots replace a message's
photo or document with [`editMessageMedia`](messages.md#editing-and-deleting).

A bot can upload a thumbnail with `sendDocument`: the part that `thumbnail` names with
`attach://<part-name>`, or else the part named `thumbnail`, and failing both, likewise for the
legacy `thumb`, as the official server's [`get_input_thumbnail`][thumbnail-input] reads it. Other
text, such as a URL, is ignored, because a thumbnail must be uploaded. As TDLib's
[`get_input_thumbnail_photo_size`][thumbnail-photo-size] does, an empty thumbnail or one larger than
204,799 bytes is left out rather than failing the document; so is one whose image header the
emulator cannot read. Documents show the thumbnail as `thumbnail` and the legacy `thumb`, with its
own `file_id` and `file_unique_id`, and bots download it with `getFile` from `thumbnails/`. A
document sent again by `file_id` keeps its thumbnail, and a thumbnail's `file_id` cannot send a
photo or document (`Bad Request: can't use file of type Thumbnail as Photo`).

Each observer receives a different `file_id` for the same stored file. `file_unique_id` identifies
it across observers in that session. Reusing another bot's `file_id`, or sending a document ID as a
photo, fails. `getFile` returns a `file_path`; download the bytes at
`<botApiRoot>/file/bot<token>/<file_path>`. A path is available after `getFile` assigns it, and
remains valid for the session. Tests can bypass bot downloads with
`session.downloadFile(file_unique_id)`; that is an emulation API convenience, not a Telegram API.

### Upload profiles

A session's [upload profile](sessions-and-requests.md#supported-behavior) names the official Bot API
server deployment whose upload limits its bots meet: `cloud` for `api.telegram.org`, the default, or
`local` for a server started with `--local`. Both profiles currently apply the same upload checks,
described above. The profile changes nothing else; see
[the cloud server's other file handling](#the-cloud-servers-other-file-handling).

## Intentional deviations

### Lightweight photo validation and unchanged fixture bytes

The emulator reads image headers for JPEG, PNG, GIF, WebP and BMP. It checks that width plus height
does not exceed 10,000 and that the aspect ratio does not exceed 20. Unrecognized image content
produces `IMAGE_PROCESS_FAILED`; rejected dimensions produce `PHOTO_INVALID_DIMENSIONS`.

It keeps the original bytes, format and one photo size. It does not fully decode the image,
recompress it to JPEG, generate thumbnails or produce multiple sizes. A header-valid but damaged
image may therefore pass. Lightweight validation is sufficient for the intended tests, and keeping
fixture bytes unchanged avoids a media-processing pipeline.

TDLib's [`Photo` implementation][photos] consumes server-provided sizes and sends uploads to
Telegram; the actual server image processor is outside these open-source repositories. The
comparison establishes the missing processing pipeline, not an exhaustive list of formats or exact
transformations Telegram will apply.

### No generated document previews

Document fixtures are kept without a preview-generation pipeline. Automatically generating previews
is intentionally omitted; tests that need a preview upload a thumbnail. An uploaded thumbnail is
kept as sent, like a photo: Telegram asks for a JPEG of at most 320 pixels a side, and its server's
handling of other thumbnails is not visible in the source.

### The cloud server's other file handling

Apart from upload limits, every session behaves as the official server does without `--local`,
whatever its upload profile. As that server's [file handling][download-limit] does outside local
mode, bots cannot download files larger than 20 × 1024 × 1024 bytes: `getFile` fails with
`Bad Request: file is too big`, so there is no path to download them from. `getFile` returns a
relative `file_path` to download over HTTP, never a local filesystem path.
[`Client::get_input_file`][file-input] reads local filesystem paths and `file://` URIs only in local
mode, so the emulator does not read them either.

[Local mode][local-mode] is a setting of a self-hosted server, not behavior of the bot under test.
Beyond its upload limits, it chiefly gives the bot direct access to the server's filesystem, which
an isolated test session has no use for: files the bot would read from disk are uploaded instead,
and files it would read from a `getFile` path are downloaded. The webhook restrictions that local
mode relaxes are relaxed in every session; see [webhooks](webhooks.md#intentional-deviations).

### Opaque session file identifiers

`file_id` and `file_unique_id` are opaque emulator identifiers. Tests should treat them as session
values; they do not use TDLib's file-ID encoding or provide durable Telegram identity across
sessions. This also follows the intentional use of
[disposable session state](sessions-and-requests.md#intentional-deviations).

### Independent uploads

Each explicit upload creates an independent test fixture with a new stored file and unique ID, even
when its bytes match an earlier upload. Only reuse, forwarding and copying preserve the stored
identity. Upload deduplication is intentionally absent.

### Stable file references

File references and download paths remain valid throughout a session without expiry or refresh.
Stable references keep fixtures reusable throughout each test session. File-reference expiry and
long-lived Telegram storage are outside this model.

## Real gaps

### Document classification

Documents always remain documents, including GIFs, audio and video uploads.
`disable_content_type_detection` is accepted but has no effect. Upstream chooses between document
file types based on that flag in [`get_input_message_content`][document-input], and
[`DocumentsManager`][documents] classifies returned media using its attributes. The emulator does
not inspect document content or reproduce that classification.

Tests need to exercise media classification and the flag's effect.

### File limits and sources

| Concern               | Emulator    | Upstream comparison                                                          |
| --------------------- | ----------- | ---------------------------------------------------------------------------- |
| Document upload sizes | No byte cap | Server-side 50 MB cap, 2000 MB in local mode; its error is not in the source |
| HTTP URL file sources | Rejected    | `get_input_file` and TDLib support remote sources                            |

Upload handling is in [`Client::get_input_file`][file-input]. The public [document][send-document]
method reference documents the cloud upload ceiling. Passing a large document to the emulator does
not test it.

Tests need document size validation and files sent by URL.

### Additional media types and methods

Media types other than photos/documents, albums, stickers and sticker sets are missing, including
`sendMediaGroup`. `editMessageMedia` therefore replaces media only with photos and documents.

## Local evidence

[Media service](../../src/services/media_file.ts),
[image header reader](../../src/media/image_dimensions.ts),
[file repository](../../src/repositories/file.ts),
[media tests](../../tests/media_file_service_test.ts) and
[image tests](../../tests/image_dimensions_test.ts).

[thumbnail-input]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L10778-L10813
[thumbnail-photo-size]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/PhotoSize.cpp#L460-L481
[photo-size-limit]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/files/FileLoaderUtils.cpp#L273-L340
[photos]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/Photo.cpp#L45-L210
[document-input]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessageContent.cpp#L5201-L5213
[documents]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/DocumentsManager.cpp#L329-L605
[download-limit]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L9365-L9390
[file-input]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L10758-L10839
[send-document]: https://core.telegram.org/bots/api#senddocument
[local-mode]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/README.md#usage
