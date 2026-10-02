# Media and files

[Feature index and comparison baseline](README.md) · [Message operations](messages.md)

## Supported behavior

Bots send photos and documents with `sendPhoto` and `sendDocument`, and in the blocks of
[rich messages](rich-messages.md). Files can be multipart uploads, either in the part named for the
parameter or referenced with `attach://<part-name>`, an existing `file_id` known to that bot, or an
HTTP URL that Telegram downloads, as described in [files sent by URL](#files-sent-by-url). Accounts
upload base64 content through the emulation API; the TypeScript client accepts bytes and performs
the encoding. Both sides can supply captions and caption entities.

Photos expose dimensions, `has_media_spoiler` when requested and `show_caption_above_media` for a
caption above the photo. Documents expose their cleaned filename and a MIME type derived from its
extension, falling back to `application/octet-stream` for unknown extensions. Empty uploads fail.
Photo uploads larger than 10 × 1024 × 1024 bytes fail before the image is read, from bots and
accounts alike, as TDLib's [`check_full_local_location`][photo-size-limit] refuses them; bots
receive
`Bad Request: file of size <size> bytes is too big for a photo; the maximum size is 10485760 bytes`.
Bot uploads must also fit the session's [upload profile](#upload-profiles). Captions can be edited
with `editMessageCaption` or the account client, and bots replace a message's photo or document with
[`editMessageMedia`](messages.md#editing-and-deleting).

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

### Files sent by URL

As TDLib does, a file parameter or `media` that contains a dot is an HTTP URL, which Telegram
downloads before it sends the file. The emulator downloads it from the session's emulated web: tests
register what each URL serves with `POST /sessions/{sessionId}/web-resources` or the TypeScript
client's `registerWebResource`, giving a status, `Content-Type`, body, or redirect `location`. A URL
without a registered resource is unreachable, and the emulator never reaches the network.
`sendPhoto`, `sendDocument`, `editMessageMedia`, including for inline messages, and the photo and
document blocks of rich messages accept URLs.

The URL is read as TDLib's [`parse_url`][parse-url] reads it, so a URL without a protocol is an HTTP
one, and a resource answers every spelling that TDLib reads alike; a URL TDLib refuses fails with
`Bad Request: invalid file HTTP URL specified: <reason>`, in TDLib's words. The download follows at
most 5 redirects to HTTP or HTTPS URLs and must answer 2xx within 10 seconds. Telegram's
[file sending reference][sending-files] limits URL photos to 5 MB and other files to 20 MB, read as
5,242,880 and 20,971,520 bytes, whatever the upload profile, since Telegram's servers download them.
A photo must be served as an image. As that reference says that only PDF and ZIP files can be sent
as documents, a document must be served as `application/pdf` or `application/zip`; its content is
not inspected.

| Download outcome                                                                         | Error                                             |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Unreachable, non-2xx, too many redirects, timed out, truncated, or larger than its limit | `Bad Request: failed to get HTTP URL content`     |
| Empty, or served with another type                                                       | `Bad Request: wrong type of the web page content` |

These are the server's descriptions of Telegram's `WEBPAGE_CURL_FAILED` and `WEBPAGE_MEDIA_EMPTY` in
[`Client::fail_query_with_error`][error-rewriting]. A downloaded photo is then checked as an
uploaded one, so content that is not a readable image fails with `IMAGE_PROCESS_FAILED`. A document
is named after the URL's last path segment, cleaned as an upload's name, keeps the type it was
served as, and takes no thumbnail, as TDLib sends it as `inputMediaDocumentExternal`. A file sent by
URL is stored as a new file, like an upload.

### Upload profiles

A session's [upload profile](sessions-and-requests.md#supported-behavior) names the official Bot API
server deployment whose upload limits its bots meet: `cloud` for `api.telegram.org`, the default, or
`local` for a server started with `--local`. Each photo or document a bot uploads with
`multipart/form-data` must fit the profile's limit; a photo must also meet the 10 × 1024 × 1024 byte
photo limit, whatever the profile. The cloud limit is checked first, as `api.telegram.org` refuses
an oversized request outright, and the local limit after the photo limit, as Telegram enforces it
after TDLib's checks, so in practice the local limit binds only documents: a photo that large fails
as too big for a photo.

| Profile | Largest bot upload                       | Larger uploads fail with                                                                   |
| ------- | ---------------------------------------- | ------------------------------------------------------------------------------------------ |
| `cloud` | 50 × 1024 × 1024 = 52,428,800 bytes      | `413` `Request Entity Too Large`                                                           |
| `local` | 2000 × 1024 × 1024 = 2,097,152,000 bytes | `400` `Bad Request: file of size <size> bytes is too big; the maximum size is <max> bytes` |

The limit is checked when the emulator reads the file, after the caption and other parameters and
before the chat, so a failed upload sends and stores nothing; `api.telegram.org` refuses an
oversized request before reading any parameter, so a request with another fault fails differently
there. Sending a file again by `file_id`, forwarding and copying are not uploads and meet no size
limit. An uploaded thumbnail is checked only against TDLib's own thumbnail limit, described above.
Accounts upload through their own client, so no profile limits them: their photos meet the photo
limit, and their documents no limit, since a user's client uploads files of up to 2000 MB, or 4000
MB with Telegram Premium, which base64 fixtures in JSON requests are not meant to reach.

The profile changes nothing else; see
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
and files it would read from a `getFile` path are downloaded. The webhook address and port
restrictions that local mode relaxes are relaxed in every session, while `max_connections` keeps the
cloud range; see [webhooks](webhooks.md#intentional-deviations).

### Upload limit units and errors

Telegram's [file sending reference][sending-files] gives the multipart limits as 10 MB for photos
and 50 MB for other files, and the [local server][local-mode] as 2000 MB, without naming the unit or
the error. The 10 MB photo limit is `10 * (1 << 20)` bytes in TDLib, as is the 20 MB download limit
in the Bot API server, so the emulator reads 50 MB and 2000 MB in the same binary megabytes; 2000 MB
is also TDLib's limit of 4000 upload parts of 512 KB each. Neither limit appears in the open-source
server or TDLib: the open-source server's own HTTP reader refuses only files larger than 4000 MB.
For the cloud limit, the emulator gives the answer bots observe from `api.telegram.org`. For the
local limit, which Telegram enforces after TDLib's checks with an error not visible in the source,
it words the error as `check_full_local_location` words its own size checks.

### An emulated web for files sent by URL

Telegram's servers download files sent by URL, and which responses they accept, their time and
redirect budgets, and their errors for each failure are not in the open-source server or TDLib. The
emulator downloads from resources the test registers rather than from the network, so tests stay
hermetic and bots keep the URLs they use in production; its budgets, the mapping of failures to the
two documented error descriptions, and the media types it accepts are its own bounded model. It
downloads the file after the caption and other parameters and before the chat, as it reads uploads,
while Telegram downloads it after the server looks at the chat, so a request with both an unknown
chat and an unusable URL fails for its URL. Telegram may also reuse a file it downloaded from the
same URL before; the emulator downloads it again, as [independent uploads](#independent-uploads)
describe.

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

### Files sent by URL in inline query results

A rich message that an inline query result sends must reuse its files by `file_id`: one naming a
file by URL fails, as an upload does, with `Bad Request: invalid inline message content specified`.
Telegram downloads such files; tests need inline query results that send files by URL.

### Additional media types and methods

Media types other than photos/documents, albums, stickers and sticker sets are missing, including
`sendMediaGroup`. `editMessageMedia` therefore replaces media only with photos and documents.

## Local evidence

[Media service](../../src/services/media_file.ts),
[image header reader](../../src/media/image_dimensions.ts),
[file repository](../../src/repositories/file.ts),
[URL downloads](../../src/services/web_file_download.ts),
[web resources](../../src/services/web_resource.ts),
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
[sending-files]: https://core.telegram.org/bots/api#sending-files
[parse-url]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/tdutils/td/utils/HttpUrl.cpp#L47-L196
[error-rewriting]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L73-L206
[local-mode]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/README.md#usage
