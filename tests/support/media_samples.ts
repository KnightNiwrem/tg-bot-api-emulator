/** The header of a GIF image, which is all the emulator reads of a photo. */
export function gifImage(width: number, height: number): Uint8Array<ArrayBuffer> {
  const image = new Uint8Array(13);
  image.set(new TextEncoder().encode('GIF89a'));
  const view = new DataView(image.buffer);
  view.setUint16(6, width, true);
  view.setUint16(8, height, true);
  return image;
}

/**
 * A RIFF chunk of a WebP file: its four-character code, its payload's size, its payload, and a
 * padding byte after a payload of an odd size. `declaredSize` overrides the size the header states.
 */
export function webpChunk(
  fourCc: string,
  payload: Uint8Array,
  { declaredSize = payload.length, padded = true }: {
    readonly declaredSize?: number;
    readonly padded?: boolean;
  } = {},
): Uint8Array<ArrayBuffer> {
  const paddingLength = padded ? payload.length % 2 : 0;
  const chunk = new Uint8Array(8 + payload.length + paddingLength);
  chunk.set(new TextEncoder().encode(fourCc));
  new DataView(chunk.buffer).setUint32(4, declaredSize, true);
  chunk.set(payload, 8);
  return chunk;
}

/**
 * A WebP file of the given chunks, whose RIFF size counts them unless `riffSizeAdjustment` changes
 * it, followed by `trailingBytes` that the RIFF size does not count.
 */
export function webpFile(
  chunks: readonly Uint8Array[],
  { riffSizeAdjustment = 0, trailingBytes = new Uint8Array() }: {
    readonly riffSizeAdjustment?: number;
    readonly trailingBytes?: Uint8Array;
  } = {},
): Uint8Array<ArrayBuffer> {
  const chunksLength = chunks.reduce((length, chunk) => length + chunk.length, 0);
  const file = new Uint8Array(12 + chunksLength + trailingBytes.length);
  const encoder = new TextEncoder();
  file.set(encoder.encode('RIFF'));
  new DataView(file.buffer).setUint32(4, 4 + chunksLength + riffSizeAdjustment, true);
  file.set(encoder.encode('WEBP'), 8);
  let offset = 12;
  for (const chunk of [...chunks, trailingBytes]) {
    file.set(chunk, offset);
    offset += chunk.length;
  }
  return file;
}

/**
 * The header of a lossy (`VP8 `) key frame of the given dimensions, followed by a few bytes of
 * placeholder data, which the emulator never decodes.
 */
export function vp8Bitstream(width: number, height: number): Uint8Array<ArrayBuffer> {
  const bitstream = new Uint8Array(14);
  const view = new DataView(bitstream.buffer);
  bitstream.set([0x50, 0x01, 0x00, 0x9d, 0x01, 0x2a]);
  view.setUint16(6, width, true);
  view.setUint16(8, height, true);
  return bitstream;
}

/**
 * The header of a lossless (`VP8L`) bitstream of the given dimensions, followed by a few bytes of
 * placeholder data, which the emulator never decodes.
 */
export function vp8lBitstream(width: number, height: number): Uint8Array<ArrayBuffer> {
  const bitstream = new Uint8Array(9);
  bitstream[0] = 0x2f;
  new DataView(bitstream.buffer).setUint32(1, (width - 1) | ((height - 1) << 14), true);
  return bitstream;
}

/** The payload of an extended (`VP8X`) header of the given canvas, with the given flags byte. */
export function vp8xHeader(
  width: number,
  height: number,
  { flags = 0 }: { readonly flags?: number } = {},
): Uint8Array<ArrayBuffer> {
  const header = new Uint8Array(10);
  header[0] = flags;
  const writeUint24 = (offset: number, value: number) =>
    header.set([value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff], offset);
  writeUint24(4, width - 1);
  writeUint24(7, height - 1);
  return header;
}

/** A simple lossless static WebP image of the given dimensions, as a sticker fixture. */
export function staticWebpSticker(width: number, height: number): Uint8Array<ArrayBuffer> {
  return webpFile([webpChunk('VP8L', vp8lBitstream(width, height))]);
}

/** The animation flag of a `VP8X` header's flags byte. */
export const VP8X_ANIMATION_FLAG = 0x02;

/** The alpha flag of a `VP8X` header's flags byte. */
export const VP8X_ALPHA_FLAG = 0x10;

/**
 * A 1×1 transparent lossless WebP image as libwebp encodes it, whose 13-byte `VP8L` chunk is
 * padded.
 */
export const LIBWEBP_TRANSPARENT_PIXEL: Uint8Array<ArrayBuffer> = Uint8Array.fromBase64(
  'UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==',
);
