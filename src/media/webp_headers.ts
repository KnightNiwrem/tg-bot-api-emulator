/**
 * The headers of WebP chunks, as the WebP container specification
 * (https://developers.google.com/speed/webp/docs/riff_container) and the lossy and lossless
 * bitstream specifications lay them out. Each reader takes a chunk's payload and reads only its
 * header; compressed pixels are never decoded.
 */

/** The bytes of a RIFF chunk's header: its four-character code, then its payload's size. */
export const RIFF_CHUNK_HEADER_BYTES = 8;

/** Where a WebP file's first chunk starts: after `RIFF`, the file size, and `WEBP`. */
export const WEBP_FIRST_CHUNK_OFFSET = 12;

/** The bytes of a `VP8X` chunk's payload: flags, reserved bytes, and the canvas size. */
const VP8X_PAYLOAD_BYTES = 10;

export interface WebpDimensions {
  readonly width: number;
  readonly height: number;
}

/**
 * The dimensions of a lossy (`VP8 `) key frame, whose header is a 3-byte frame tag, the start code,
 * then 14-bit width and height; `undefined` without the start code. A dimension may be 0.
 */
export function readVp8FrameDimensions(payload: DataView): WebpDimensions | undefined {
  if (
    payload.byteLength < 10 || payload.getUint8(3) !== 0x9d || payload.getUint8(4) !== 0x01 ||
    payload.getUint8(5) !== 0x2a
  ) {
    return undefined;
  }
  return {
    width: payload.getUint16(6, true) & 0x3fff,
    height: payload.getUint16(8, true) & 0x3fff,
  };
}

/**
 * The dimensions in the header of a lossless (`VP8L`) bitstream: a signature byte, then 14-bit
 * width and height, each minus one; `undefined` without the signature.
 */
export function readVp8lDimensions(payload: DataView): WebpDimensions | undefined {
  if (payload.byteLength < 5 || payload.getUint8(0) !== 0x2f) {
    return undefined;
  }
  const packedHeader = payload.getUint32(1, true);
  return {
    width: (packedHeader & 0x3fff) + 1,
    height: ((packedHeader >>> 14) & 0x3fff) + 1,
  };
}

/**
 * The canvas dimensions in the header of an extended (`VP8X`) file: after its flags and reserved
 * bytes, its 24-bit canvas width and height, each minus one; `undefined` for a payload too short to
 * hold them.
 */
export function readVp8xCanvasDimensions(payload: DataView): WebpDimensions | undefined {
  if (payload.byteLength < VP8X_PAYLOAD_BYTES) {
    return undefined;
  }
  return {
    width: readUint24LittleEndian(payload, 4) + 1,
    height: readUint24LittleEndian(payload, 7) + 1,
  };
}

function readUint24LittleEndian(bytes: DataView, offset: number): number {
  return bytes.getUint8(offset) | (bytes.getUint8(offset + 1) << 8) |
    (bytes.getUint8(offset + 2) << 16);
}
