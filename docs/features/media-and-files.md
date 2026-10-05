# Media and files

[Feature index and comparison baseline](README.md) · [Message operations](messages.md) ·
[TypeScript client guide: Media and files](../clients/typescript/media-and-files.md)

## Supported behavior

Bots send photos and documents with `sendPhoto` and `sendDocument`, [videos](#videos) with
`sendVideo`, [voice notes](#voice-notes) with `sendVoice`, [audio files](#audio-files) with
`sendAudio`, photos and videos, documents, or audio files as [albums](#albums) with
`sendMediaGroup`, and photos, documents, videos and voice notes in the blocks of
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
with `editMessageCaption` or the account client, and bots replace a message's media with a photo,
document, video or audio file with [`editMessageMedia`](messages.md#editing-and-deleting).

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
photo, video, voice note or audio file, fails; see
[file IDs of other kinds](#file-ids-of-other-kinds). `getFile` returns a `file_path`; download the
bytes at `<botApiRoot>/file/bot<token>/<file_path>`. A path is available after `getFile` assigns it,
and remains valid for the session. Tests can bypass bot downloads with
`session.downloadFile(file_unique_id)`; that is an emulation API convenience, not a Telegram API.

### Files sent by URL

As TDLib does, a file parameter or `media` that contains a dot is an HTTP URL, which Telegram
downloads before it sends the file. The emulator downloads it from the session's emulated web: tests
register what each URL serves with `POST /sessions/{sessionId}/web-resources` or the TypeScript
client's `registerWebResource`, giving a status, `Content-Type`, body, or redirect `location`. A URL
without a registered resource is unreachable, and the emulator never reaches the network.
`sendPhoto`, `sendDocument`, `sendVideo`, `sendVoice`, `sendAudio` and `editMessageMedia` accept
URLs, as do the media blocks of [rich messages](rich-messages.md#sending-and-editing) that
`sendRichMessage` sends or `editMessageText` puts in place, including for inline messages. Photo,
document, video, voice and audio results of `answerInlineQuery` also accept them, with contracts of
their own; the file is downloaded when an account sends a result as its media, and never when
`input_message_content` replaces it, as [inline mode](inline-mode.md#media-named-by-url) describes.
A rich message in a result's `input_message_content` does not accept them, as
[Telegram refuses them](rich-messages.md#sending-and-editing) there.

The URL is read as TDLib's [`parse_url`][parse-url] reads it, so a URL without a protocol is an HTTP
one, and a resource answers every spelling that TDLib reads alike; a URL TDLib refuses fails with
`Bad Request: invalid file HTTP URL specified: <reason>`, in TDLib's words. The download follows at
most 5 redirects to HTTP or HTTPS URLs and must answer 2xx and deliver its whole body within 10
seconds. Telegram's [file sending reference][sending-files] limits URL photos to 5 MB and other
files to 20 MB, read as 5,242,880 and 20,971,520 bytes, whatever the upload profile, since
Telegram's servers download them. A photo must be served as an image. As that reference says that
only PDF and ZIP files can be sent as documents, a document must be served as `application/pdf` or
`application/zip`. The reference requires the correct MIME type for other media, and Telegram
documents only MPEG-4 videos as playable, so a video must be served as `video/mp4`. As the reference
says for `sendVoice`, a voice note must be served as `audio/ogg`; one of at most 1 MB, read as
1,048,576 bytes, is sent as a voice note, and a larger one, up to 20 MB, as a file, which the
emulator sends as a document named after the URL. As the reference names `audio/mpeg` for
`sendAudio`, an audio file must be served as `audio/mpeg`. The content of a document, video, voice
note or audio file is not inspected.

| Download outcome                                                                         | Error                                             |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Unreachable, non-2xx, too many redirects, timed out, truncated, or larger than its limit | `Bad Request: failed to get HTTP URL content`     |
| Empty, or served with another type                                                       | `Bad Request: wrong type of the web page content` |

These are the server's descriptions of Telegram's `WEBPAGE_CURL_FAILED` and `WEBPAGE_MEDIA_EMPTY` in
[`Client::fail_query_with_error`][error-rewriting]. A downloaded photo is then checked as an
uploaded one, so content that is not a readable image fails with `IMAGE_PROCESS_FAILED`. A document
is named after the URL's last path segment, cleaned as an upload's name, keeps the type it was
served as, and takes no thumbnail, as TDLib sends it as `inputMediaDocumentExternal`; a video or
audio file sent by URL is named and typed alike, without a name when the URL's path ends in `/`, and
takes no thumbnail either. A file sent by URL is stored as a new file, like an upload.

### Videos

Bots send videos with `sendVideo`, and accounts with a `video` in
`POST /sessions/{sessionId}/accounts/{accountId}/messages` or the TypeScript client's `sendVideo`.
The Bot API's [`Video`][video-object] gives the duration, width and height as defined by the sender,
and the emulator keeps them as the sender defines them. A bot's `duration`, `width` and `height` are
clamped to 0–86,400 seconds and 0–10,000 pixels, as the official server's
[`process_send_video_query`][send-video] clamps them; an account's must lie in those ranges. Each
defaults to 0. The emulator does not read video content, so it checks no container, codec or
duration and sends any non-empty content as a video; see
[sender-defined media attributes](#sender-defined-media-attributes).

A bot's upload is named as a document's is. Its MIME type is the type the file name's extension
decides when that is a `video/` type, and `video/mp4` otherwise, as TDLib's
[`VideosManager::get_input_media`][video-upload] uploads a video; an account may send a video
without a file name, which then shows none and is `video/mp4`. A bot can upload a thumbnail with the
video, read and kept as for `sendDocument`, which the video shows as `thumbnail` and `thumb`. Videos
are limited only by the session's [upload profile](#upload-profiles): TDLib's
[`check_full_local_location`][photo-size-limit] has no limit of its own for them. Bots download
videos with `getFile` from `videos/`, under the extension of the video's file name.

A message shows `has_media_spoiler` and `show_caption_above_media` for a video as for a photo, and
the video's `start_timestamp`, the second from which clients play it, when a bot's `start_timestamp`
places it past the beginning. As TDLib keeps it, the start belongs to the message: forwards and
copies keep it unless their request gives a
[`video_start_timestamp`](messages.md#forwarding-and-copying). `InputMediaVideo` specifies a video
for [albums](#albums) and `editMessageMedia` as `sendVideo` does, apart from its file, which `media`
names. A video sent again by `file_id` keeps its duration, dimensions, name, type and thumbnail,
whatever the request specifies, and takes the request's caption, spoiler, caption placement and
start. A video sent by [URL](#files-sent-by-url) keeps the attributes the bot specified and takes no
thumbnail: TDLib sends it as `inputMediaDocumentExternal`, which carries neither, and how Telegram's
servers determine the attributes of a downloaded video is not in the source.

### Voice notes

Bots send voice notes with `sendVoice`, and accounts with a `voice` in
`POST /sessions/{sessionId}/accounts/{accountId}/messages` or the TypeScript client's `sendVoice`.
As the Bot API's [`Voice`][voice-object] gives it, a voice note's duration is the one its sender
defines: a bot's `duration`, clamped to 0–86,400 seconds as the official server's
[`process_send_voice_query`][send-voice] clamps it, or an account's, which must lie in that range;
it defaults to 0. As for videos, the emulator reads no content, so it sends any non-empty content as
a voice note, while Telegram documents that its clients play OGG/Opus, MP3 and M4A voice notes and
that it may send other formats as audio or documents; see
[sender-defined media attributes](#sender-defined-media-attributes).

A voice note shows its duration and MIME type, but no file name. As TDLib's
[`VoiceNotesManager::get_input_media`][voice-upload] uploads a voice note, a bot's upload is
`audio/ogg`, `audio/mpeg` or `audio/mp4` when its file name's extension decides that type, and
`audio/ogg` otherwise; an account's voice note is `audio/ogg`, as Telegram's clients record
OGG/Opus. A voice note sent by [URL](#files-sent-by-url) is `audio/ogg`, keeps the duration the bot
specified, and becomes a document when it is larger than 1 MB. A voice note sent again by `file_id`
keeps its duration and type. Voice notes are limited only by the session's
[upload profile](#upload-profiles), and bots download them with `getFile` from `voice/`, under the
extension `oga`, `mp3` or `m4a` of their type, the extensions TDLib's
[`FileManager::get_file_name`][voice-file-name] keeps for voice notes.

A voice note has a caption, which `editMessageCaption` and the account client edit, but, as TDLib's
[`is_allowed_media_group_content`][album-content] and [`can_edit_message_media`][voice-media-edit]
decide, it never forms [albums](#albums), and its media cannot be replaced: `editMessageMedia` fails
with `Bad Request: message media can't be edited`. An `InputMediaVoiceNote` is refused for albums
and new media alike, as the official server's [`get_input_media`][input-media-album] reads it only
in [rich messages](rich-messages.md#sending-and-editing).

### Audio files

Bots send audio files, such as music tracks, with `sendAudio`, and accounts with an `audio` in
`POST /sessions/{sessionId}/accounts/{accountId}/messages` or the TypeScript client's `sendAudio`.
As the Bot API's [`Audio`][audio-object] gives them, an audio file's duration, performer and title
are those its sender defines: a bot's `duration` is clamped to 0–86,400 seconds, as the official
server's [`process_send_audio_query`][send-audio] clamps it, and an account's must lie in that
range; it defaults to 0. As TDLib's [`create_input_message_content`][audio-metadata] does, the title
and then the performer are cleaned with `clean_input_string`, and text that is not well-formed
Unicode fails with `Bad Request: audio title must be encoded in UTF-8` or
`Bad Request: audio performer must be encoded in UTF-8`. A title or performer that is empty, or that
cleaning empties, is omitted, as the official server's `JsonAudio` omits it. As for videos, the
emulator reads no content, so it sends any non-empty content as an audio file and reads no tags from
it, while Telegram documents that its clients play MP3 and M4A audio; see
[sender-defined media attributes](#sender-defined-media-attributes).

A bot's upload is named as a document's is. Its MIME type is the type the file name's extension
decides when that is an `audio/` type, and `audio/mpeg` otherwise, as TDLib's
[`AudiosManager::get_input_media`][audio-upload] uploads an audio file; an account may send one
without a file name, which then shows none and is `audio/mpeg`. A bot can upload a thumbnail with
the audio file, such as its album's cover, read and kept as for `sendDocument`, which the audio file
shows as `thumbnail` and `thumb`; accounts upload no thumbnails. Audio files are limited only by the
session's [upload profile](#upload-profiles). Bots download them with `getFile` from `music/`, under
the extension of their file name when it is `ogg`, `oga`, `mp3`, `mpeg3` or `m4a`, compared exactly,
and `mp3` otherwise, as TDLib's [`FileManager::get_file_name`][audio-file-name] names them.

An audio file sent again by `file_id` keeps its duration, performer, title, name, type and
thumbnail, whatever the request specifies, as [`AudiosManager::get_input_media`][audio-upload] sends
it as `inputMediaDocument` without them, and takes the request's caption. An audio file sent by
[URL](#files-sent-by-url) is `audio/mpeg`, is named after the URL, keeps the metadata the bot
specified, and takes no thumbnail: TDLib sends it as `inputMediaDocumentExternal`, which carries
neither, and how Telegram's servers determine the metadata of a downloaded audio file is not in the
source. As TDLib's `inputMessageAudio` has neither, an audio file takes no `has_spoiler` or
`show_caption_above_media`; `sendAudio` rejects them as unknown parameters, and `InputMediaAudio`,
whose fields the official server reads and drops, rejects them as fields the Bot API does not
document for it.

Unlike a voice note, an audio file has media that `editMessageMedia` replaces and forms
[albums](#albums), with other audio files only. In a supergroup, sending one needs the
[`can_send_audios`](supergroups.md#member-restrictions) permission. Inline query results send audio
files [by `file_id` or by URL](inline-mode.md#media-named-by-url).

### Albums

Bots send photos, videos, documents or audio files as an album with `sendMediaGroup`, whose `media`
is a JSON array of `InputMediaPhoto`, `InputMediaVideo`, `InputMediaDocument` and `InputMediaAudio`.
Each item names its file as `editMessageMedia` does: an upload, a `file_id`, or a
[URL](#files-sent-by-url). Accounts send albums with
`POST /sessions/{sessionId}/accounts/{accountId}/media-groups`, or the TypeScript client's
`sendMediaGroup`, uploading each file as they upload a single photo, video, document or audio file.
Each item has its own caption.

The emulator's albums hold photos and videos together, documents, or audio files. Telegram also
sends live photos in albums, which the emulator's albums [lack](#additional-media-types-and-methods)
and refuse by name, while it refuses other media itself, as the official server's
[`get_input_media`][input-media-album] reads it for an album:

| `InputMedia` type | Telegram's albums                   | Emulator                                                                                             |
| ----------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `photo`           | With photos, live photos and videos | With photos and videos                                                                               |
| `document`        | With documents only                 | With documents only                                                                                  |
| `video`           | With photos, live photos and videos | With photos and videos                                                                               |
| `live_photo`      | With photos, live photos and videos | `Bad Request: InputMedia of type "live_photo" is not supported`                                      |
| `audio`           | With audio only                     | With audio only                                                                                      |
| `animation`       | Refused                             | `Bad Request: can't parse InputMedia: type "animation" can't be used in sendMediaGroup`, as upstream |
| `voice_note`      | Refused                             | `Bad Request: can't parse InputMedia: type "voice_note" is not allowed`, as upstream                 |
| Any other type    | Refused                             | `Bad Request: can't parse InputMedia: type "<type>" is unsupported`, as upstream                     |

An album is a sequence of ordinary messages that share a `media_group_id`, which is the decimal text
of a positive 64-bit identifier and new for each album. The messages are stored in order, and each
reaches the chat's bots as a separate update, as it would alone; in a supergroup, a bot in privacy
mode receives only the items addressed to it. `sendMediaGroup` returns the messages in order. Every
message replies to the same message, and `disable_notification`, `protect_content` and
`message_effect_id` apply to each. As the official server's
[`process_send_media_group_query`][send-media-group] does, the method reads no `reply_markup`; the
emulator rejects one as an unknown parameter.

As TDLib's [`check_message_group_message_contents`][album-checks] does, an album holds at most 10
items, its photos and videos place their captions alike, and documents are sent only with documents
and audio files only with audio files, since TDLib's
[`is_homogenous_media_group_content`][album-homogeneous] keeps them apart. TDLib reports whichever
such kind it meets first in an unordered set of the album's kinds, so for an album that mixes
documents with audio files it is not defined which it names; the emulator names the kind of the
first such item. As [`send_message_group`][send-message-group] does, a single item is sent as one
message outside any album. A refused album sends and stores nothing.

| Album                                                      | Error                                                                               |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `media` is `[]` or `null`                                  | `Bad Request: there are no messages to send`                                        |
| More than 10 items                                         | `Bad Request: too many messages to send as an album`                                |
| Photos or videos with different `show_caption_above_media` | `Bad Request: parameter show_caption_above_media must be the same for all messages` |
| Documents with photos or videos                            | `Bad Request: document can't be mixed with other media types`                       |
| Audio files with other media                               | `Bad Request: audio can't be mixed with other media types`                          |
| An item Telegram cannot read, such as a missing part       | `Bad Request: can't parse InputMedia: media not found`, as for `editMessageMedia`   |
| A file Telegram's servers refuse, at item _position_       | `Bad Request: failed to send message #position with the error message "<error>"`    |

Forwards and copies of an album's messages form [new albums](messages.md#forwarding-and-copying). As
TDLib's [`edit_message_media`][album-media-edit] allows, `editMessageMedia` turns a photo of an
album into a video and a video into a photo, but keeps a document a document and an audio file an
audio file, and no other media becomes one (`Bad Request: can't change media type in the album`).
Deleting one message leaves the others in their album.

Telegram's servers, rather than TDLib, refuse content they cannot process as a photo
(`IMAGE_PROCESS_FAILED`, `PHOTO_INVALID_DIMENSIONS`), a file they cannot download from a URL
(`WEBPAGE_CURL_FAILED`, `WEBPAGE_MEDIA_EMPTY`), and, for the `local` upload profile, an upload
larger than it allows. As the official server's [`on_message_send_failed`][album-failure] does, it
reports the first such item with its position and Telegram's error, unchanged. Other file failures,
such as an empty upload, a photo larger than 10 MB, or an unknown `file_id`, and captions that
Telegram cannot normalize or that are longer than 1024 characters fail as they do for `sendPhoto`,
`sendVideo`, `sendDocument` and `sendAudio`, before the album is checked. As the official server
reads it, every item's caption formatting, such as its `parse_mode` and entities, is parsed with the
request, before any file. Then, as TDLib's `get_input_message_content` does, each item's file is
read and its caption normalized and measured before the next item's, so the first item with either
fault fails the album. As for `sendPhoto`, the emulator downloads files sent by URL, in the album's
order, once the request's parameters are read and before it reads the other items' files, so an
album with an unusable URL fails for its first such URL, whichever item holds it, rather than for an
upload or `file_id` that fails.

### Upload profiles

A session's [upload profile](sessions-and-requests.md#supported-behavior) names the official Bot API
server deployment whose upload limits its bots meet: `cloud` for `api.telegram.org`, the default, or
`local` for a server started with `--local`. Each photo, document, video, voice note or audio file a
bot uploads with `multipart/form-data` must fit the profile's limit; a photo must also meet the 10 ×
1024 × 1024 byte photo limit, whatever the profile. The cloud limit is checked first, as
`api.telegram.org` refuses an oversized request outright, and the local limit after the photo limit,
as Telegram enforces it after TDLib's checks, so in practice the local limit binds only documents,
videos, voice notes and audio files: a photo that large fails as too big for a photo.

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
limit, and their documents, videos, voice notes and audio files no limit, since a user's client
uploads files of up to 2000 MB, or 4000 MB with Telegram Premium, which base64 fixtures in JSON
requests are not meant to reach.

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

### Sender-defined media attributes

A video's duration and dimensions, a voice note's duration, and an audio file's duration, performer
and title are those their sender defines, as the Bot API documents them, and the emulator never
reads video or audio content: it does not parse containers, check codecs, measure durations, read
tags such as ID3, generate thumbnails, covers, alternative qualities or waveforms, transcribe, or
transcode. Telegram's servers do process uploaded media, and, as the
[`sendVideo`][send-video-reference] and [`sendVoice`][send-voice-reference] references say, may send
videos other than MPEG-4 as documents and voice notes other than OGG/Opus, MP3 or M4A as audio or
documents; which files they reclassify, and how, is not in the open-source server or TDLib. Keeping
fixture bytes unchanged lets tests send small placeholder media and predict every attribute the bot
sees.

### File IDs of other kinds

Each `file_id` sends only a file of its own kind: a photo's only a photo, a document's only a
document, a video's only a video, a voice note's only a voice note, and an audio file's only an
audio file, failing with TDLib's wording, such as
`Bad Request: can't use file of type Video as Document`,
`Bad Request: can't use file of type VoiceNote as Document` or
`Bad Request: can't use file of type Document as Audio`. TDLib's
[`check_input_file_id`][file-type-check] refuses a photo's `file_id` for other media, but treats
documents, videos, voice notes, audio files and other document-class files as one class and leaves
Telegram's servers to decide what the message shows, which is not in the source. Refusing them keeps
a bot's mix-up of media kinds visible in tests.

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

Documents always remain documents, including GIFs, audio and video uploads, whether or not
`disable_content_type_detection` is set; `sendDocument`, `InputMediaDocument` and document blocks
validate the flag. The emulator behaves as if every document set it, which matches Telegram for
documents uploaded in an album: the official server sets the flag for each of them, as described
below.

Upstream, the flag's only effect visible in the source is a request to Telegram's server. The Bot
API server passes it to TDLib's `inputDocument`, and sets it for every document of an album in
[`get_input_media`][document-flag]. TDLib then uploads the file as `DocumentAsFile`
([`get_input_message_content`][document-input]), which [`DocumentsManager`][documents-upload] sends
as `inputMediaUploadedDocument.force_file`. It affects uploads only: a document sent by URL goes as
`inputMediaDocumentExternal`, and one reused by `file_id` as `inputMediaDocument`, neither of which
carries it. Without the flag, Telegram's server may give an uploaded file video, audio or animation
attributes, by which [`DocumentsManager`][documents] classifies the returned media, and the Bot API
returns the message as that media. Which files the server reclassifies, and how, is not in the
source.

Classifying documents needs the animation media the emulator lacks, and rules for it would rest on
observed rather than documented server behavior. Tests need media classification, through which the
flag would take effect.

### Video covers

`sendVideo` rejects a `cover` as an unsupported parameter, so messages never show a video's cover, a
photo that Telegram shows in its place; `start_timestamp` is supported. `InputMediaVideo` rejects a
`cover` too, in albums, new media and rich message blocks. Tests need covers sent by upload,
`file_id` and URL.

### Additional media types and methods

Media types other than photos, documents, videos, voice notes and audio files, stickers and sticker
sets are missing, so `editMessageMedia` replaces media only with photos, documents, videos and audio
files, and albums hold only photos and videos, documents, or audio files. Rich message blocks hold
no audio files. Voice notes keep no waveform and are never transcribed.

## Local evidence

[Media service](../../src/services/media_file.ts),
[image header reader](../../src/media/image_dimensions.ts),
[video MIME types](../../src/media/video_file.ts),
[voice note MIME types](../../src/media/voice_file.ts),
[audio MIME types and extensions](../../src/media/audio_file.ts),
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
[documents-upload]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/DocumentsManager.cpp#L689-L725
[document-flag]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L12849-L12854
[download-limit]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L9365-L9390
[file-input]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L10758-L10839
[sending-files]: https://core.telegram.org/bots/api#sending-files
[parse-url]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/tdutils/td/utils/HttpUrl.cpp#L47-L196
[error-rewriting]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L73-L206
[local-mode]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/README.md#usage
[send-media-group]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L14505-L14565
[input-media-album]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L12815-L12865
[album-failure]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L13684-L13715
[album-checks]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessageContent.cpp#L5378-L5406
[send-message-group]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessagesManager.cpp#L21891-L21978
[album-media-edit]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessagesManager.cpp#L23720-L23763
[video-object]: https://core.telegram.org/bots/api#video
[send-video-reference]: https://core.telegram.org/bots/api#sendvideo
[voice-object]: https://core.telegram.org/bots/api#voice
[send-voice-reference]: https://core.telegram.org/bots/api#sendvoice
[send-voice]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L14159-L14172
[voice-upload]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/VoiceNotesManager.cpp#L168-L221
[voice-file-name]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/files/FileManager.cpp#L1344-L1370
[voice-media-edit]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessagesManager.cpp#L23294-L23310
[album-content]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessageContentType.cpp#L224-L328
[send-video]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L14120-L14143
[video-upload]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/VideosManager.cpp#L274-L377
[file-type-check]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/files/FileManager.cpp#L4140-L4165
[audio-object]: https://core.telegram.org/bots/api#audio
[send-audio]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L14033-L14049
[audio-metadata]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessageContent.cpp#L4849-L4865
[audio-upload]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/AudiosManager.cpp#L256-L299
[audio-file-name]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/files/FileManager.cpp#L1386-L1391
[album-homogeneous]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessageContentType.cpp#L330-L332
