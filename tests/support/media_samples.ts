/** The header of a GIF image, which is all the emulator reads of a photo. */
export function gifImage(width: number, height: number): Uint8Array<ArrayBuffer> {
  const image = new Uint8Array(13);
  image.set(new TextEncoder().encode('GIF89a'));
  const view = new DataView(image.buffer);
  view.setUint16(6, width, true);
  view.setUint16(8, height, true);
  return image;
}

/** A RIFF chunk of a WebP file: its four-character code, its payload's size, and its payload. */
function webpChunk(fourCc: string, payload: Uint8Array): Uint8Array<ArrayBuffer> {
  const chunk = new Uint8Array(8 + payload.length + (payload.length % 2));
  chunk.set(new TextEncoder().encode(fourCc));
  new DataView(chunk.buffer).setUint32(4, payload.length, true);
  chunk.set(payload, 8);
  return chunk;
}

/** A WebP file of the given chunks, whose RIFF size counts them. */
function webpFile(chunks: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const chunksLength = chunks.reduce((length, chunk) => length + chunk.length, 0);
  const file = new Uint8Array(12 + chunksLength);
  const encoder = new TextEncoder();
  file.set(encoder.encode('RIFF'));
  new DataView(file.buffer).setUint32(4, 4 + chunksLength, true);
  file.set(encoder.encode('WEBP'), 8);
  let offset = 12;
  for (const chunk of chunks) {
    file.set(chunk, offset);
    offset += chunk.length;
  }
  return file;
}

/**
 * The header of a lossless (`VP8L`) bitstream of the given dimensions, followed by a few bytes of
 * placeholder data, which the emulator never decodes.
 */
function vp8lBitstream(width: number, height: number): Uint8Array<ArrayBuffer> {
  const bitstream = new Uint8Array(9);
  bitstream[0] = 0x2f;
  new DataView(bitstream.buffer).setUint32(1, (width - 1) | ((height - 1) << 14), true);
  return bitstream;
}

/** The animation flag of a `VP8X` header's flags byte. */
const VP8X_ANIMATION_FLAG = 0x02;

/** Writes a 24-bit little-endian value, as the `VP8X` and `ANMF` headers hold their fields. */
function writeUint24(bytes: Uint8Array, offset: number, value: number): void {
  bytes.set([value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff], offset);
}

/** The payload of an extended (`VP8X`) header of the given canvas, with the animation flag set. */
function animatedVp8xHeader(width: number, height: number): Uint8Array<ArrayBuffer> {
  const header = new Uint8Array(10);
  header[0] = VP8X_ANIMATION_FLAG;
  writeUint24(header, 4, width - 1);
  writeUint24(header, 7, height - 1);
  return header;
}

/**
 * The payload of an `ANMF` frame covering the given canvas from its origin, shown for 100
 * milliseconds: the frame's header, then its lossless image as a `VP8L` chunk.
 */
function animationFrame(width: number, height: number): Uint8Array<ArrayBuffer> {
  const image = webpChunk('VP8L', vp8lBitstream(width, height));
  const frame = new Uint8Array(16 + image.length);
  writeUint24(frame, 6, width - 1);
  writeUint24(frame, 9, height - 1);
  writeUint24(frame, 12, 100);
  frame.set(image, 16);
  return frame;
}

/** A simple lossless static WebP image of the given dimensions, as a sticker fixture. */
export function staticWebpSticker(width: number, height: number): Uint8Array<ArrayBuffer> {
  return webpFile([webpChunk('VP8L', vp8lBitstream(width, height))]);
}

/**
 * An animated WebP image of the given canvas, as the container specification lays one out: an
 * extended header with the animation flag, the `ANIM` parameters, which loop forever on a
 * transparent background, and two lossless `ANMF` frames covering the canvas.
 */
export function animatedWebpSticker(width: number, height: number): Uint8Array<ArrayBuffer> {
  return webpFile([
    webpChunk('VP8X', animatedVp8xHeader(width, height)),
    webpChunk('ANIM', new Uint8Array(6)),
    webpChunk('ANMF', animationFrame(width, height)),
    webpChunk('ANMF', animationFrame(width, height)),
  ]);
}
