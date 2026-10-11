import { assertEquals } from '@std/assert';
import { readImageDimensions } from '../src/media/image_dimensions.ts';

Deno.test('readImageDimensions reads the header of every supported image format', () => {
  const cases = [
    { name: 'PNG', content: pngHeader(640, 480), expected: ['png', 640, 480] },
    { name: 'GIF', content: gifHeader(32, 16), expected: ['gif', 32, 16] },
    {
      name: 'JPEG',
      content: jpegWithMetadataBeforeFrame(1280, 720),
      expected: ['jpeg', 1280, 720],
    },
    { name: 'lossy WebP', content: lossyWebp(300, 200), expected: ['webp', 300, 200] },
    { name: 'lossless WebP', content: losslessWebp(300, 200), expected: ['webp', 300, 200] },
    { name: 'extended WebP', content: extendedWebp(4000, 3000), expected: ['webp', 4000, 3000] },
    { name: 'BMP', content: bmpWithInfoHeader(50, 40), expected: ['bmp', 50, 40] },
    { name: 'top-down BMP', content: bmpWithInfoHeader(50, -40), expected: ['bmp', 50, 40] },
    { name: 'OS/2 BMP', content: bmpWithCoreHeader(20, 10), expected: ['bmp', 20, 10] },
  ];

  for (const { name, content, expected } of cases) {
    const dimensions = readImageDimensions(content);
    const actual = dimensions === undefined
      ? undefined
      : [dimensions.imageFormat, dimensions.width, dimensions.height];
    assertEquals(actual, expected, `Expected the ${name} dimensions`);
  }
});

Deno.test('readImageDimensions rejects content that is no complete image header', () => {
  const cases = [
    { name: 'text', content: new TextEncoder().encode('%PDF-1.7 not an image') },
    { name: 'no content', content: new Uint8Array() },
    { name: 'truncated PNG', content: pngHeader(640, 480).slice(0, 20) },
    { name: 'PNG without pixels', content: pngHeader(0, 480) },
    { name: 'JPEG without a frame', content: bytes(0xff, 0xd8, 0xff, 0xd9) },
    { name: 'WebP of an unknown variant', content: riffWebp('VP9 ', new Uint8Array(10)) },
  ];

  for (const { name, content } of cases) {
    const dimensions = readImageDimensions(content);
    if (dimensions !== undefined) {
      throw new Error(`Expected ${name} to be rejected, received ${JSON.stringify(dimensions)}`);
    }
  }
});

function bytes(...values: number[]): Uint8Array<ArrayBuffer> {
  return new Uint8Array(values);
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function ascii(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}

function uint16(value: number, littleEndian: boolean): Uint8Array<ArrayBuffer> {
  const buffer = new Uint8Array(2);
  new DataView(buffer.buffer).setUint16(0, value, littleEndian);
  return buffer;
}

function uint32(value: number, littleEndian: boolean): Uint8Array<ArrayBuffer> {
  const buffer = new Uint8Array(4);
  new DataView(buffer.buffer).setUint32(0, value, littleEndian);
  return buffer;
}

function int32LittleEndian(value: number): Uint8Array<ArrayBuffer> {
  const buffer = new Uint8Array(4);
  new DataView(buffer.buffer).setInt32(0, value, true);
  return buffer;
}

function uint24LittleEndian(value: number): Uint8Array<ArrayBuffer> {
  return bytes(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff);
}

function pngHeader(width: number, height: number): Uint8Array<ArrayBuffer> {
  return concat(
    bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    uint32(13, false),
    ascii('IHDR'),
    uint32(width, false),
    uint32(height, false),
    bytes(8, 6, 0, 0, 0),
  );
}

function gifHeader(width: number, height: number): Uint8Array<ArrayBuffer> {
  return concat(ascii('GIF89a'), uint16(width, true), uint16(height, true), bytes(0, 0, 0));
}

/** A JPEG whose JFIF segment precedes the frame header, as in most JPEG files. */
function jpegWithMetadataBeforeFrame(width: number, height: number): Uint8Array<ArrayBuffer> {
  return concat(
    bytes(0xff, 0xd8),
    bytes(0xff, 0xe0),
    uint16(16, false),
    ascii('JFIF\0'),
    new Uint8Array(9),
    bytes(0xff, 0xc0),
    uint16(17, false),
    bytes(8),
    uint16(height, false),
    uint16(width, false),
    new Uint8Array(10),
  );
}

function riffWebp(chunkType: string, chunkData: Uint8Array): Uint8Array<ArrayBuffer> {
  return concat(
    ascii('RIFF'),
    uint32(4 + 8 + chunkData.length, true),
    ascii('WEBP'),
    ascii(chunkType),
    uint32(chunkData.length, true),
    chunkData,
  );
}

function lossyWebp(width: number, height: number): Uint8Array<ArrayBuffer> {
  return riffWebp(
    'VP8 ',
    concat(bytes(0, 0, 0), bytes(0x9d, 0x01, 0x2a), uint16(width, true), uint16(height, true)),
  );
}

function losslessWebp(width: number, height: number): Uint8Array<ArrayBuffer> {
  return riffWebp(
    'VP8L',
    concat(bytes(0x2f), uint32((width - 1) | ((height - 1) << 14), true), new Uint8Array(1)),
  );
}

function extendedWebp(width: number, height: number): Uint8Array<ArrayBuffer> {
  return riffWebp(
    'VP8X',
    concat(new Uint8Array(4), uint24LittleEndian(width - 1), uint24LittleEndian(height - 1)),
  );
}

function bmpWithInfoHeader(width: number, height: number): Uint8Array<ArrayBuffer> {
  return concat(
    ascii('BM'),
    new Uint8Array(12),
    uint32(40, true),
    int32LittleEndian(width),
    int32LittleEndian(height),
    new Uint8Array(28),
  );
}

function bmpWithCoreHeader(width: number, height: number): Uint8Array<ArrayBuffer> {
  return concat(
    ascii('BM'),
    new Uint8Array(12),
    uint32(12, true),
    uint16(width, true),
    uint16(height, true),
    new Uint8Array(4),
  );
}
