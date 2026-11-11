/**
 * Reads the static WebP images that accounts send as regular stickers, following the RIFF layout
 * of the WebP container specification (https://developers.google.com/speed/webp/docs/riff_container).
 * Only the container and the image bitstream's header are read: compressed pixels are not decoded,
 * and nothing of Telegram's sticker-set preparation rules, such as a 512-pixel side or a size
 * limit, is applied, since Telegram documents none for sending a sticker.
 */

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

/** The bytes of a RIFF chunk's header: its four-character code, then its payload's size. */
const CHUNK_HEADER_BYTES = 8;

/** Where the first chunk starts: after `RIFF`, the file size, and `WEBP`. */
const FIRST_CHUNK_OFFSET = 12;

/** The animation flag of a `VP8X` chunk's first byte. */
const VP8X_ANIMATION_FLAG = 0x02;

/** The bytes of a `VP8X` chunk's payload: flags, reserved bytes, and the canvas size. */
const VP8X_PAYLOAD_BYTES = 10;

interface RiffChunk {
  readonly fourCc: string;
  /** The payload, without the chunk header or its padding byte. */
  readonly payload: DataView;
}

/**
 * Reads a static WebP image and its dimensions: a simple lossy (`VP8 `) or lossless (`VP8L`) file,
 * or an extended (`VP8X`) file without the animation flag, whose canvas gives its dimensions and
 * which holds a `VP8 ` or `VP8L` image.
 *
 * The RIFF size and every chunk's size and padding must fit the file; data after the RIFF size,
 * which the specification lets readers parse or ignore, is ignored. Unknown chunks are skipped, as
 * the specification requires. Without the animation flag, an `ANIM` chunk is ignored, as the
 * specification requires, and so is an `ANMF` chunk, which it says should not be present: the
 * flag alone decides that a file is animated.
 */
export function readStaticWebpSticker(content: Uint8Array): StaticWebpStickerReading {
  const chunks = readRiffChunks(new DataView(content.buffer, content.byteOffset, content.length));
  const [firstChunk] = chunks ?? [];
  if (chunks === undefined || firstChunk === undefined) {
    return { read: false, reason: 'sticker_invalid' };
  }
  if (firstChunk.fourCc !== 'VP8X') {
    const dimensions = readImageBitstreamDimensions(firstChunk);
    return dimensions === undefined
      ? { read: false, reason: 'sticker_invalid' }
      : { read: true, ...dimensions };
  }
  const header = firstChunk.payload;
  if (header.byteLength < VP8X_PAYLOAD_BYTES) {
    return { read: false, reason: 'sticker_invalid' };
  }
  if ((header.getUint8(0) & VP8X_ANIMATION_FLAG) !== 0) {
    return { read: false, reason: 'sticker_animation_unsupported' };
  }
  const image = chunks.find(({ fourCc }) => fourCc === 'VP8 ' || fourCc === 'VP8L');
  if (image === undefined || readImageBitstreamDimensions(image) === undefined) {
    return { read: false, reason: 'sticker_invalid' };
  }
  return {
    read: true,
    width: readUint24LittleEndian(header, 4) + 1,
    height: readUint24LittleEndian(header, 7) + 1,
  };
}

/**
 * Splits a WebP file's RIFF payload into its chunks, or returns `undefined` for a file without the
 * RIFF and WebP signatures, or whose RIFF size or chunks do not fit it.
 */
function readRiffChunks(bytes: DataView): readonly RiffChunk[] | undefined {
  if (
    bytes.byteLength < FIRST_CHUNK_OFFSET || readFourCc(bytes, 0) !== 'RIFF' ||
    readFourCc(bytes, 8) !== 'WEBP'
  ) {
    return undefined;
  }
  // The RIFF size counts the bytes after itself, from the `WEBP` signature on.
  const riffEnd = CHUNK_HEADER_BYTES + bytes.getUint32(4, true);
  if (riffEnd > bytes.byteLength) {
    return undefined;
  }
  const chunks: RiffChunk[] = [];
  let offset = FIRST_CHUNK_OFFSET;
  while (offset < riffEnd) {
    if (offset + CHUNK_HEADER_BYTES > riffEnd) {
      return undefined;
    }
    const payloadSize = bytes.getUint32(offset + 4, true);
    const payloadOffset = offset + CHUNK_HEADER_BYTES;
    // A payload of an odd size is followed by a padding byte.
    const nextOffset = payloadOffset + payloadSize + (payloadSize % 2);
    if (nextOffset > riffEnd) {
      return undefined;
    }
    chunks.push({
      fourCc: readFourCc(bytes, offset),
      payload: new DataView(bytes.buffer, bytes.byteOffset + payloadOffset, payloadSize),
    });
    offset = nextOffset;
  }
  return chunks;
}

/**
 * Reads the dimensions from the header of a lossy (`VP8 `) or lossless (`VP8L`) bitstream, or
 * returns `undefined` for another chunk, a header without its signature, or no pixels.
 */
function readImageBitstreamDimensions(
  { fourCc, payload }: RiffChunk,
): { readonly width: number; readonly height: number } | undefined {
  if (fourCc === 'VP8 ') {
    // A key frame starts with a 3-byte frame tag and the start code, then 14-bit width and height.
    if (
      payload.byteLength < 10 || payload.getUint8(3) !== 0x9d || payload.getUint8(4) !== 0x01 ||
      payload.getUint8(5) !== 0x2a
    ) {
      return undefined;
    }
    const width = payload.getUint16(6, true) & 0x3fff;
    const height = payload.getUint16(8, true) & 0x3fff;
    return width > 0 && height > 0 ? { width, height } : undefined;
  }
  if (fourCc === 'VP8L') {
    // A signature byte, then 14-bit width and height, each minus one.
    if (payload.byteLength < 5 || payload.getUint8(0) !== 0x2f) {
      return undefined;
    }
    const packedSize = payload.getUint32(1, true);
    return { width: (packedSize & 0x3fff) + 1, height: ((packedSize >>> 14) & 0x3fff) + 1 };
  }
  return undefined;
}

function readFourCc(bytes: DataView, offset: number): string {
  return String.fromCharCode(
    bytes.getUint8(offset),
    bytes.getUint8(offset + 1),
    bytes.getUint8(offset + 2),
    bytes.getUint8(offset + 3),
  );
}

function readUint24LittleEndian(bytes: DataView, offset: number): number {
  return bytes.getUint8(offset) | (bytes.getUint8(offset + 1) << 8) |
    (bytes.getUint8(offset + 2) << 16);
}
