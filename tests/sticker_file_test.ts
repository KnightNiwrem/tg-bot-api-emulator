import { assertEquals } from '@std/assert';

import { readStaticWebpSticker } from '../src/media/sticker_file.ts';
import {
  LIBWEBP_TRANSPARENT_PIXEL,
  staticWebpSticker,
  vp8Bitstream,
  vp8lBitstream,
  VP8X_ALPHA_FLAG,
  VP8X_ANIMATION_FLAG,
  vp8xHeader,
  webpChunk,
  webpFile,
} from './support/media_samples.ts';

const UNKNOWN_CHUNK = webpChunk('ABCD', new Uint8Array([1, 2, 3]));

Deno.test('Static WebP images in every container form are read with their dimensions', () => {
  const images = {
    libwebpPixel: LIBWEBP_TRANSPARENT_PIXEL,
    lossy: webpFile([webpChunk('VP8 ', vp8Bitstream(320, 200))]),
    lossless: staticWebpSticker(512, 384),
    smallest: staticWebpSticker(1, 1),
    largestLossless: staticWebpSticker(16_384, 16_384),
    extendedLossy: webpFile([
      webpChunk('VP8X', vp8xHeader(640, 480, { flags: VP8X_ALPHA_FLAG })),
      webpChunk('ALPH', new Uint8Array([0, 0, 0])),
      webpChunk('VP8 ', vp8Bitstream(640, 480)),
    ]),
    // The canvas, not the image chunk, gives an extended image's dimensions.
    extendedLossless: webpFile([
      webpChunk('VP8X', vp8xHeader(700, 300)),
      webpChunk('ICCP', new Uint8Array(5)),
      webpChunk('VP8L', vp8lBitstream(1, 1)),
      webpChunk('EXIF', new Uint8Array(4)),
    ]),
  };

  assertEquals(
    Object.fromEntries(
      Object.entries(images).map(([name, content]) => [name, readStaticWebpSticker(content)]),
    ),
    {
      libwebpPixel: { read: true, width: 1, height: 1 },
      lossy: { read: true, width: 320, height: 200 },
      lossless: { read: true, width: 512, height: 384 },
      smallest: { read: true, width: 1, height: 1 },
      largestLossless: { read: true, width: 16_384, height: 16_384 },
      extendedLossy: { read: true, width: 640, height: 480 },
      extendedLossless: { read: true, width: 700, height: 300 },
    },
  );
});

Deno.test('A static WebP image ignores what the container specification lets readers skip', () => {
  const lossless = webpChunk('VP8L', vp8lBitstream(64, 64));
  const images = {
    unknownChunks: webpFile([lossless, UNKNOWN_CHUNK]),
    trailingDataAfterRiff: webpFile([lossless], { trailingBytes: new Uint8Array([9, 9, 9]) }),
    animChunkWithoutFlag: webpFile([
      webpChunk('VP8X', vp8xHeader(64, 64)),
      webpChunk('ANIM', new Uint8Array(6)),
      lossless,
    ]),
    anmfChunkWithoutFlag: webpFile([
      webpChunk('VP8X', vp8xHeader(64, 64)),
      webpChunk('ANMF', new Uint8Array(16)),
      lossless,
    ]),
  };

  for (const [name, content] of Object.entries(images)) {
    assertEquals(
      readStaticWebpSticker(content),
      { read: true, width: 64, height: 64 },
      `Expected ${name} read as a static image`,
    );
  }
});

Deno.test('Content that is not a well-formed static WebP image is refused', () => {
  const lossless = webpChunk('VP8L', vp8lBitstream(64, 64));
  const brokenLossy = vp8Bitstream(64, 64);
  brokenLossy[3] = 0;
  const brokenLossless = vp8lBitstream(64, 64);
  brokenLossless[0] = 0;
  // A 9-byte bitstream needs a padding byte, which this chunk leaves out.
  const unpadded = webpFile([webpChunk('VP8L', vp8lBitstream(64, 64), { padded: false })]);
  const contents = {
    empty: new Uint8Array(),
    notRiff: new TextEncoder().encode('GIF89a not a WebP image'),
    notWebp: (() => {
      const file = webpFile([lossless]);
      file.set(new TextEncoder().encode('WAVE'), 8);
      return file;
    })(),
    noChunks: webpFile([]),
    riffSizeBeyondContent: webpFile([lossless], { riffSizeAdjustment: 2 }),
    chunkBeyondRiffSize: webpFile([webpChunk('VP8L', vp8lBitstream(64, 64), { declaredSize: 40 })]),
    truncatedChunkHeader: webpFile([lossless, new Uint8Array([0x41, 0x42, 0x43, 0x44])]),
    missingPadding: unpadded,
    imageOnlyInUnknownChunk: webpFile([UNKNOWN_CHUNK]),
    lossyWithoutStartCode: webpFile([webpChunk('VP8 ', brokenLossy)]),
    lossyWithoutPixels: webpFile([webpChunk('VP8 ', vp8Bitstream(0, 64))]),
    truncatedLossyHeader: webpFile([webpChunk('VP8 ', vp8Bitstream(64, 64).slice(0, 8))]),
    losslessWithoutSignature: webpFile([webpChunk('VP8L', brokenLossless)]),
    truncatedExtendedHeader: webpFile([
      webpChunk('VP8X', vp8xHeader(64, 64).slice(0, 6)),
      lossless,
    ]),
    extendedWithoutImage: webpFile([webpChunk('VP8X', vp8xHeader(64, 64)), UNKNOWN_CHUNK]),
    extendedWithBrokenImage: webpFile([
      webpChunk('VP8X', vp8xHeader(64, 64)),
      webpChunk('VP8L', brokenLossless),
    ]),
  };

  for (const [name, content] of Object.entries(contents)) {
    assertEquals(
      readStaticWebpSticker(content),
      { read: false, reason: 'sticker_invalid' },
      `Expected ${name} refused`,
    );
  }
});

Deno.test('A WebP image with the animation flag is refused as an unsupported animation', () => {
  const animated = webpFile([
    webpChunk('VP8X', vp8xHeader(64, 64, { flags: VP8X_ANIMATION_FLAG | VP8X_ALPHA_FLAG })),
    webpChunk('ANIM', new Uint8Array(6)),
    webpChunk(
      'ANMF',
      new Uint8Array([...new Uint8Array(16), ...webpChunk('VP8L', vp8lBitstream(64, 64))]),
    ),
  ]);
  const flaggedStill = webpFile([
    webpChunk('VP8X', vp8xHeader(64, 64, { flags: VP8X_ANIMATION_FLAG })),
    webpChunk('VP8L', vp8lBitstream(64, 64)),
  ]);

  assertEquals(
    [readStaticWebpSticker(animated), readStaticWebpSticker(flaggedStill)],
    Array(2).fill({ read: false, reason: 'sticker_animation_unsupported' }),
  );
});
