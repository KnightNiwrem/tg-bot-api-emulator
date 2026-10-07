import { FileRepository } from '../src/repositories/file.ts';
import type { BotApiInputFile, BotApiRichMessageFileTypes } from '../src/services/bot_api.ts';
import { BotMediaResolver } from '../src/services/bot_media_resolution.ts';
import { MediaFileService } from '../src/services/media_file.ts';
import type { RichMessage } from '../src/types/rich_message.ts';

const BOT_ID = 1;
const OTHER_BOT_ID = 2;
const NO_CAPTION = { text: '' };
const MEGABYTE = 1024 * 1024;

Deno.test('BotMediaResolver refuses a file_id of another type or one the bot does not know', () => {
  const { files, botMedia } = createResolverFixture();
  const voiceFile = files.addFile({
    type: 'voice',
    content: new Uint8Array([1]),
    mimeType: 'audio/ogg',
    durationSeconds: 3,
  });
  const voice: BotApiInputFile = {
    kind: 'file_id',
    fileId: files.getOrAssignObserverFileId(BOT_ID, voiceFile.id),
  };

  const failures = [
    botMedia.resolveMediaContent(BOT_ID, {
      kind: 'document',
      document: voice,
      caption: NO_CAPTION,
    }),
    botMedia.resolveInlineResultFile(BOT_ID, voice, 'audio'),
    // As on Telegram, a `file_id` belongs to the bot that knows the file by it.
    botMedia.resolveVoiceMedia(OTHER_BOT_ID, { voice, durationSeconds: 0, caption: NO_CAPTION }),
  ].map((resolution) => resolution.resolved ? resolution : resolution.failure);
  const expectedFailures = [
    { reason: 'file_type_mismatch', expectedFileType: 'document', actualFileType: 'voice' },
    { reason: 'file_type_mismatch', expectedFileType: 'audio', actualFileType: 'voice' },
    { reason: 'file_id_invalid' },
  ];
  if (JSON.stringify(failures) !== JSON.stringify(expectedFailures)) {
    throw new Error(`Expected file_id failures, received ${JSON.stringify(failures)}`);
  }

  const reused = botMedia.resolveVoiceMedia(BOT_ID, {
    voice,
    durationSeconds: 0,
    caption: NO_CAPTION,
  });
  if (
    !reused.resolved || reused.file.kind !== 'voice' || reused.file.voice.kind !== 'stored' ||
    reused.file.voice.file !== voiceFile
  ) {
    throw new Error(
      `Expected the bot's voice note to be reused, received ${JSON.stringify(reused)}`,
    );
  }
});

Deno.test('BotMediaResolver leaves out the thumbnail uploaded for media sent by URL', () => {
  const { botMedia } = createResolverFixture();
  const thumbnail = gifImage(90, 90);
  const upload: BotApiInputFile = {
    kind: 'upload',
    fileName: 'scans/report.mp4',
    content: new Uint8Array([1]),
  };
  const webFile: BotApiInputFile = {
    kind: 'web_file',
    webFile: { content: new Uint8Array([1]), mediaType: 'video/mp4', fileName: 'clip.mp4' },
  };
  const resolveWithThumbnail = (file: BotApiInputFile) =>
    [
      botMedia.resolveMediaContent(BOT_ID, {
        kind: 'document',
        document: file,
        thumbnail,
        caption: NO_CAPTION,
      }),
      botMedia.resolveMediaContent(BOT_ID, {
        kind: 'video',
        video: file,
        attributes: { durationSeconds: 1, width: 640, height: 360 },
        thumbnail,
        startTimestampSeconds: 0,
        caption: NO_CAPTION,
        hasSpoiler: false,
        showsCaptionAboveMedia: false,
      }),
      botMedia.resolveMediaContent(BOT_ID, {
        kind: 'audio',
        audio: file,
        attributes: { durationSeconds: 1 },
        thumbnail,
        caption: NO_CAPTION,
      }),
    ].map((resolution) => {
      if (!resolution.resolved || resolution.file.kind === 'photo') {
        throw new Error(`Expected a resolved file, received ${JSON.stringify(resolution)}`);
      }
      const outgoingFile = resolution.file.kind === 'document'
        ? resolution.file.document
        : resolution.file.kind === 'video'
        ? resolution.file.video
        : resolution.file.audio;
      if (outgoingFile.kind !== 'upload') {
        throw new Error(`Expected an upload, received ${JSON.stringify(outgoingFile)}`);
      }
      return outgoingFile.upload;
    });

  const uploads = resolveWithThumbnail(upload);
  // An upload keeps its thumbnail and is named as the Bot API server cleans its name.
  if (uploads.some((file) => file.thumbnail === undefined || file.fileName !== 'report.mp4')) {
    throw new Error(`Expected named uploads with thumbnails, received ${JSON.stringify(uploads)}`);
  }
  const downloads = resolveWithThumbnail(webFile);
  if (downloads.some((file) => file.thumbnail !== undefined || file.fileName !== 'clip.mp4')) {
    throw new Error(`Expected URL files without thumbnails, received ${JSON.stringify(downloads)}`);
  }
});

Deno.test('BotMediaResolver sends a voice note by URL larger than 1 MB as a document', () => {
  const { botMedia } = createResolverFixture();
  const resolveVoice = (voice: BotApiInputFile) =>
    botMedia.resolveVoiceMedia(BOT_ID, { voice, durationSeconds: 4, caption: { text: 'Memo' } });
  const webVoice = (sizeBytes: number): BotApiInputFile => ({
    kind: 'web_file',
    webFile: { content: new Uint8Array(sizeBytes), mediaType: 'audio/ogg', fileName: 'memo.ogg' },
  });

  const short = resolveVoice(webVoice(MEGABYTE));
  const long = resolveVoice(webVoice(MEGABYTE + 1));
  const uploaded = resolveVoice({
    kind: 'upload',
    fileName: 'memo.ogg',
    content: new Uint8Array(MEGABYTE + 1),
  });
  if (
    !short.resolved || short.file.kind !== 'voice' ||
    !long.resolved || long.file.kind !== 'document' || long.file.caption !== 'Memo' ||
    long.file.document.kind !== 'upload' || long.file.document.upload.fileName !== 'memo.ogg' ||
    long.file.document.upload.mimeType !== 'audio/ogg' ||
    !uploaded.resolved || uploaded.file.kind !== 'voice'
  ) {
    throw new Error(
      `Expected only the long URL voice note as a document, received ${
        JSON.stringify([short, long, uploaded].map(describeResolvedKind))
      }`,
    );
  }
});

Deno.test('BotMediaResolver keeps a voice note block sent by URL a voice note whatever its size', () => {
  const { botMedia } = createResolverFixture();
  const resolution = botMedia.resolveRichMessageFiles(
    BOT_ID,
    richMessage([{
      kind: 'voice_note',
      voiceNote: {
        voice: {
          kind: 'web_file',
          webFile: {
            content: new Uint8Array(MEGABYTE + 1),
            mediaType: 'audio/ogg',
            fileName: 'memo.ogg',
          },
        },
        durationSeconds: 4,
      },
    }]),
  );
  const [block] = resolution.resolved ? resolution.richMessage.blocks : [];
  if (
    block?.kind !== 'voice_note' || block.voiceNote.kind !== 'upload' ||
    block.voiceNote.upload.type !== 'voice' || block.voiceNote.upload.durationSeconds !== 4
  ) {
    throw new Error(`Expected a voice note block, received ${JSON.stringify(block)}`);
  }
});

Deno.test('BotMediaResolver fails a rich message at its first unusable file, leaving earlier ones unstored', () => {
  const { botMedia } = createResolverFixture();
  const photoBlock = {
    kind: 'photo',
    photo: { kind: 'upload', fileName: 'cat.gif', content: gifImage(1_280, 720) },
    hasSpoiler: false,
  } as const;

  const resolved = botMedia.resolveRichMessageFiles(BOT_ID, richMessage([photoBlock]));
  const [resolvedBlock] = resolved.resolved ? resolved.richMessage.blocks : [];
  // The photo is left as an upload, which the message stores only once it is sent.
  if (resolvedBlock?.kind !== 'photo' || resolvedBlock.photo.kind !== 'upload') {
    throw new Error(`Expected an unstored photo upload, received ${JSON.stringify(resolved)}`);
  }

  const failed = botMedia.resolveRichMessageFiles(
    BOT_ID,
    richMessage([
      photoBlock,
      {
        kind: 'voice_note',
        voiceNote: { voice: { kind: 'file_id', fileId: 'unknown' }, durationSeconds: 0 },
      },
      {
        kind: 'document',
        document: {
          document: { kind: 'upload', fileName: 'empty.pdf', content: new Uint8Array() },
        },
      },
    ]),
  );
  if (failed.resolved || failed.failure.reason !== 'file_id_invalid') {
    throw new Error(`Expected the unknown voice note to fail, received ${JSON.stringify(failed)}`);
  }
});

function createResolverFixture() {
  const files = new FileRepository();
  const mediaFiles = new MediaFileService({
    files,
    uploadProfile: 'cloud',
    webFiles: {
      download: () => Promise.resolve({ downloaded: false, reason: 'content_unavailable' }),
    },
  });
  return { files, botMedia: new BotMediaResolver({ mediaFiles }) };
}

function richMessage(
  blocks: RichMessage<BotApiRichMessageFileTypes>['blocks'],
): RichMessage<BotApiRichMessageFileTypes> {
  return { blocks, isRightToLeft: false };
}

function describeResolvedKind(
  resolution: ReturnType<BotMediaResolver['resolveVoiceMedia']>,
): string {
  return resolution.resolved ? resolution.file.kind : resolution.failure.reason;
}

/** The header of a GIF image, which is all the emulator reads of a photo. */
function gifImage(width: number, height: number): Uint8Array<ArrayBuffer> {
  const image = new Uint8Array(13);
  image.set(new TextEncoder().encode('GIF89a'));
  const view = new DataView(image.buffer);
  view.setUint16(6, width, true);
  view.setUint16(8, height, true);
  return image;
}
