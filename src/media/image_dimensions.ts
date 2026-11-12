import type { PhotoImageFormat } from '../types/stored_file.ts';
import {
  readVp8FrameDimensions,
  readVp8lDimensions,
  readVp8xCanvasDimensions,
  RIFF_CHUNK_HEADER_BYTES,
  WEBP_FIRST_CHUNK_OFFSET,
} from './webp_headers.ts';

export interface ImageDimensions {
  readonly imageFormat: PhotoImageFormat;
  readonly width: number;
  readonly height: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** JPEG start-of-frame markers, which carry the image size: every SOFn but DHT, JPG, and DAC. */
const JPEG_START_OF_FRAME_MARKERS = new Set([
  0xc0,
  0xc1,
  0xc2,
  0xc3,
  0xc5,
  0xc6,
  0xc7,
  0xc9,
  0xca,
  0xcb,
  0xcd,
  0xce,
  0xcf,
]);

/**
 * Reads the format and pixel dimensions of a JPEG, PNG, GIF, WebP, or BMP image from its header.
 * Returns `undefined` for content that is not an image in one of these formats, or whose header
 * is truncated or reports no pixels. The image data after the header is not validated.
 */
export function readImageDimensions(content: Uint8Array): ImageDimensions | undefined {
  const bytes = new DataView(content.buffer, content.byteOffset, content.byteLength);
  const dimensions = readPngDimensions(bytes) ?? readGifDimensions(bytes) ??
    readJpegDimensions(bytes) ?? readWebpDimensions(bytes) ?? readBmpDimensions(bytes);
  return dimensions !== undefined && dimensions.width > 0 && dimensions.height > 0
    ? dimensions
    : undefined;
}

function readPngDimensions(bytes: DataView): ImageDimensions | undefined {
  // The signature is followed by the IHDR chunk: its length, its type, then width and height.
  if (!startsWith(bytes, 0, PNG_SIGNATURE) || !startsWithText(bytes, 12, 'IHDR')) {
    return undefined;
  }
  return bytes.byteLength < 24 ? undefined : {
    imageFormat: 'png',
    width: bytes.getUint32(16),
    height: bytes.getUint32(20),
  };
}

function readGifDimensions(bytes: DataView): ImageDimensions | undefined {
  if (!startsWithText(bytes, 0, 'GIF87a') && !startsWithText(bytes, 0, 'GIF89a')) {
    return undefined;
  }
  // The logical screen size follows the signature.
  return bytes.byteLength < 10 ? undefined : {
    imageFormat: 'gif',
    width: bytes.getUint16(6, true),
    height: bytes.getUint16(8, true),
  };
}

/** Walks the marker segments that precede the first frame to its start-of-frame header. */
function readJpegDimensions(bytes: DataView): ImageDimensions | undefined {
  if (!startsWith(bytes, 0, [0xff, 0xd8])) {
    return undefined;
  }
  let offset = 2;
  while (offset + 4 <= bytes.byteLength) {
    if (bytes.getUint8(offset) !== 0xff) {
      return undefined;
    }
    const marker = bytes.getUint8(offset + 1);
    // Fill bytes may precede a marker.
    if (marker === 0xff) {
      offset++;
      continue;
    }
    const segmentLength = bytes.getUint16(offset + 2);
    if (JPEG_START_OF_FRAME_MARKERS.has(marker)) {
      // The frame header holds the sample precision, then the height and the width.
      return offset + 9 > bytes.byteLength ? undefined : {
        imageFormat: 'jpeg',
        width: bytes.getUint16(offset + 7),
        height: bytes.getUint16(offset + 5),
      };
    }
    // The end of the image or the start of scan data before any frame header means none follows.
    if (marker === 0xd9 || marker === 0xda || segmentLength < 2) {
      return undefined;
    }
    offset += 2 + segmentLength;
  }
  return undefined;
}

/**
 * Reads the first chunk of a WebP image, whose layout depends on the WebP variant, as
 * `webp_headers.ts` reads each. The chunk is read to the end of the content, whatever size its
 * header states.
 */
function readWebpDimensions(bytes: DataView): ImageDimensions | undefined {
  if (!startsWithText(bytes, 0, 'RIFF') || !startsWithText(bytes, 8, 'WEBP')) {
    return undefined;
  }
  const firstChunkPayloadOffset = WEBP_FIRST_CHUNK_OFFSET + RIFF_CHUNK_HEADER_BYTES;
  if (bytes.byteLength < firstChunkPayloadOffset) {
    return undefined;
  }
  const payload = new DataView(
    bytes.buffer,
    bytes.byteOffset + firstChunkPayloadOffset,
    bytes.byteLength - firstChunkPayloadOffset,
  );
  const dimensions = startsWithText(bytes, 12, 'VP8 ')
    ? readVp8FrameDimensions(payload)
    : startsWithText(bytes, 12, 'VP8L')
    ? readVp8lDimensions(payload)
    : startsWithText(bytes, 12, 'VP8X')
    ? readVp8xCanvasDimensions(payload)
    : undefined;
  return dimensions === undefined
    ? undefined
    : { imageFormat: 'webp', width: dimensions.width, height: dimensions.height };
}

/** Reads the DIB header that follows a BMP file header, in its oldest or any later version. */
function readBmpDimensions(bytes: DataView): ImageDimensions | undefined {
  if (!startsWithText(bytes, 0, 'BM') || bytes.byteLength < 26) {
    return undefined;
  }
  const dibHeaderSize = bytes.getUint32(14, true);
  if (dibHeaderSize === 12) {
    return {
      imageFormat: 'bmp',
      width: bytes.getUint16(18, true),
      height: bytes.getUint16(20, true),
    };
  }
  // A negative height marks an image stored top-down.
  return dibHeaderSize < 40 ? undefined : {
    imageFormat: 'bmp',
    width: bytes.getInt32(18, true),
    height: Math.abs(bytes.getInt32(22, true)),
  };
}

function startsWith(bytes: DataView, offset: number, expected: readonly number[]): boolean {
  return offset + expected.length <= bytes.byteLength &&
    expected.every((byte, index) => bytes.getUint8(offset + index) === byte);
}

function startsWithText(bytes: DataView, offset: number, expected: string): boolean {
  return startsWith(bytes, offset, [...expected].map((character) => character.charCodeAt(0)));
}
