/**
 * Reads the static WebP images that accounts send as regular stickers, following the RIFF layout
 * of the WebP container specification (https://developers.google.com/speed/webp/docs/riff_container).
 * Only the container and the image bitstream's header are read: compressed pixels are not decoded,
 * and nothing of Telegram's sticker-set preparation rules, such as a 512-pixel side or a size
 * limit, is applied, since Telegram documents none for sending a sticker.
 */
import {
  readFourCc,
  readVp8FrameDimensions,
  readVp8lHeader,
  readVp8xHeader,
  RIFF_CHUNK_HEADER_BYTES,
  VP8X_PAYLOAD_BYTES,
  WEBP_FIRST_CHUNK_OFFSET,
  type WebpDimensions,
} from './webp_headers.ts';

/** Why a file is not a static WebP sticker the emulator supports. */
export type StaticWebpStickerFailureReason =
  /** The file is not a well-formed WebP image with a still image whose dimensions it can read. */
  | 'sticker_invalid'
  /**
   * The file sets the animation flag of its extended header. Telegram documents that animated WebP
   * is not supported, and the emulator supports no animated stickers.
   */
  | 'sticker_animation_unsupported';

export type StaticWebpStickerReading =
  | { readonly read: true; readonly width: number; readonly height: number }
  | { readonly read: false; readonly reason: StaticWebpStickerFailureReason };

/** The animation flag of a `VP8X` chunk's first byte. */
const VP8X_ANIMATION_FLAG = 0x02;

/** The specification limits an extended image's canvas to this many pixels. */
const MAX_CANVAS_PIXELS = 2 ** 32 - 1;

interface RiffChunk {
  readonly fourCc: string;
  /** The payload, without the chunk header or its padding byte. */
  readonly payload: DataView;
}

/** The chunks of a WebP file that decide what it shows: the first, and the first image. */
interface WebpChunkScan {
  readonly firstChunk: RiffChunk;
  /** The first `VP8 ` or `VP8L` chunk; omitted for a file without one. */
  readonly imageChunk?: RiffChunk;
}

const INVALID: StaticWebpStickerReading = { read: false, reason: 'sticker_invalid' };

/**
 * Reads a static WebP image and its dimensions: a simple lossy (`VP8 `) or lossless (`VP8L`) file,
 * or an extended (`VP8X`) file without the animation flag, whose canvas gives its dimensions and
 * which holds a `VP8 ` or `VP8L` image.
 *
 * The RIFF size and every chunk's size and padding must fit the file, a `VP8X` payload must have
 * its fixed size and a canvas of at most 2^32 - 1 pixels, and a `VP8L` header version 0, as the
 * specifications require. Data after the RIFF size, which the specification lets readers parse or
 * ignore, is ignored. Unknown chunks are skipped, as the specification requires. Without the
 * animation flag, an `ANIM` chunk is ignored, as the specification requires, and so is an `ANMF`
 * chunk, which it says should not be present: the flag alone decides that a file is animated.
 */
export function readStaticWebpSticker(content: Uint8Array): StaticWebpStickerReading {
  const scan = scanRiffChunks(new DataView(content.buffer, content.byteOffset, content.length));
  if (scan === undefined) {
    return INVALID;
  }
  const { firstChunk, imageChunk } = scan;
  if (firstChunk.fourCc !== 'VP8X') {
    const dimensions = readImageDimensions(firstChunk);
    return dimensions === undefined ? INVALID : { read: true, ...dimensions };
  }
  const header = readVp8xHeader(firstChunk.payload);
  if (header === undefined || firstChunk.payload.byteLength !== VP8X_PAYLOAD_BYTES) {
    return INVALID;
  }
  if ((header.flags & VP8X_ANIMATION_FLAG) !== 0) {
    return { read: false, reason: 'sticker_animation_unsupported' };
  }
  if (
    header.width * header.height > MAX_CANVAS_PIXELS || imageChunk === undefined ||
    readImageDimensions(imageChunk) === undefined
  ) {
    return INVALID;
  }
  return { read: true, width: header.width, height: header.height };
}

/**
 * Walks a WebP file's RIFF payload chunk by chunk, keeping only its first chunk and its first
 * image chunk, or returns `undefined` for a file without the RIFF and WebP signatures or chunks,
 * or whose RIFF size or chunks do not fit it.
 */
function scanRiffChunks(bytes: DataView): WebpChunkScan | undefined {
  if (
    bytes.byteLength < WEBP_FIRST_CHUNK_OFFSET || readFourCc(bytes, 0) !== 'RIFF' ||
    readFourCc(bytes, 8) !== 'WEBP'
  ) {
    return undefined;
  }
  // The RIFF size counts the bytes after itself, from the `WEBP` signature on.
  const riffEnd = RIFF_CHUNK_HEADER_BYTES + bytes.getUint32(4, true);
  if (riffEnd > bytes.byteLength) {
    return undefined;
  }
  let firstChunk: RiffChunk | undefined;
  let imageChunk: RiffChunk | undefined;
  let offset = WEBP_FIRST_CHUNK_OFFSET;
  while (offset < riffEnd) {
    if (offset + RIFF_CHUNK_HEADER_BYTES > riffEnd) {
      return undefined;
    }
    const payloadSize = bytes.getUint32(offset + 4, true);
    const payloadOffset = offset + RIFF_CHUNK_HEADER_BYTES;
    // A payload of an odd size is followed by a padding byte.
    const nextOffset = payloadOffset + payloadSize + (payloadSize % 2);
    if (nextOffset > riffEnd) {
      return undefined;
    }
    const fourCc = readFourCc(bytes, offset);
    if (firstChunk === undefined || (imageChunk === undefined && isImageChunk(fourCc))) {
      const chunk = {
        fourCc,
        payload: new DataView(bytes.buffer, bytes.byteOffset + payloadOffset, payloadSize),
      };
      firstChunk ??= chunk;
      if (isImageChunk(fourCc)) {
        imageChunk ??= chunk;
      }
    }
    offset = nextOffset;
  }
  return firstChunk === undefined
    ? undefined
    : { firstChunk, ...(imageChunk === undefined ? {} : { imageChunk }) };
}

function isImageChunk(fourCc: string): boolean {
  return fourCc === 'VP8 ' || fourCc === 'VP8L';
}

/**
 * Reads the dimensions from the header of a lossy (`VP8 `) or lossless (`VP8L`) bitstream, or
 * returns `undefined` for another chunk, a header without its signature, a lossless header of a
 * version other than 0, or no pixels.
 */
function readImageDimensions({ fourCc, payload }: RiffChunk): WebpDimensions | undefined {
  if (fourCc === 'VP8 ') {
    const dimensions = readVp8FrameDimensions(payload);
    return dimensions !== undefined && dimensions.width > 0 && dimensions.height > 0
      ? dimensions
      : undefined;
  }
  if (fourCc === 'VP8L') {
    const header = readVp8lHeader(payload);
    return header?.version === 0 ? { width: header.width, height: header.height } : undefined;
  }
  return undefined;
}
