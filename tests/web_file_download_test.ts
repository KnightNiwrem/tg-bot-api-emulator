import {
  type WebFileDownload,
  WebFileDownloader,
  type WebResourceFetcher,
} from '../src/services/web_file_download.ts';

const PDF_CONTENT = new TextEncoder().encode('%PDF-1.7 report');

Deno.test('WebFileDownloader downloads content with its media type', async () => {
  const requestedUrls: string[] = [];
  const downloader = createDownloader((request) => {
    requestedUrls.push(request.url);
    return Promise.resolve(
      new Response(PDF_CONTENT, { headers: { 'Content-Type': 'Application/PDF; charset=binary' } }),
    );
  });

  const download = await downloader.download('https://example.com/report.pdf', 1_000);
  assertDownloaded(download, PDF_CONTENT, 'application/pdf');
  if (JSON.stringify(requestedUrls) !== JSON.stringify(['https://example.com/report.pdf'])) {
    throw new Error(`Expected one request, received ${JSON.stringify(requestedUrls)}`);
  }
});

Deno.test('WebFileDownloader follows a bounded number of HTTP redirects', async () => {
  const redirects: Record<string, string> = {
    'https://example.com/a': '/b',
    'https://example.com/b': 'http://files.example.com/c.pdf',
  };
  const fetchWithRedirects: WebResourceFetcher = (request) => {
    const location = redirects[request.url];
    return Promise.resolve(
      location === undefined
        ? new Response(PDF_CONTENT, { headers: { 'Content-Type': 'application/pdf' } })
        : new Response(null, { status: 302, headers: { Location: location } }),
    );
  };
  assertDownloaded(
    await createDownloader(fetchWithRedirects).download('https://example.com/a', 1_000),
    PDF_CONTENT,
    'application/pdf',
  );

  const tooManyRedirects = createDownloader(fetchWithRedirects, { maxRedirects: 1 });
  assertFailure(
    await tooManyRedirects.download('https://example.com/a', 1_000),
    'content_unavailable',
  );

  const redirectLoop = createDownloader((request) =>
    Promise.resolve(new Response(null, { status: 301, headers: { Location: request.url } }))
  );
  assertFailure(
    await redirectLoop.download('https://example.com/loop', 1_000),
    'content_unavailable',
  );

  for (const location of ['file:///etc/passwd', 'data:text/plain,hi']) {
    const unsafeRedirect = createDownloader(() =>
      Promise.resolve(new Response(null, { status: 307, headers: { Location: location } }))
    );
    assertFailure(
      await unsafeRedirect.download('https://example.com/a', 1_000),
      'content_unavailable',
    );
  }
  const redirectWithoutLocation = createDownloader(() =>
    Promise.resolve(new Response(null, { status: 302 }))
  );
  assertFailure(
    await redirectWithoutLocation.download('https://example.com/a', 1_000),
    'content_unavailable',
  );
});

Deno.test('WebFileDownloader fails for unreachable resources and error statuses', async () => {
  const unreachable = createDownloader(() => Promise.reject(new TypeError('connection refused')));
  assertFailure(await unreachable.download('https://example.com/a', 1_000), 'content_unavailable');

  for (const status of [404, 500]) {
    const body = new CountingStream([PDF_CONTENT]);
    const failing = createDownloader(() => Promise.resolve(new Response(body.stream, { status })));
    assertFailure(await failing.download('https://example.com/a', 1_000), 'content_unavailable');
    if (!body.canceled) {
      throw new Error(`Expected the body of a ${status} response to be released`);
    }
  }
});

Deno.test('WebFileDownloader stops reading content larger than its limit', async () => {
  const declaredTooBig = new CountingStream([PDF_CONTENT]);
  const declaringDownloader = createDownloader(() =>
    Promise.resolve(
      new Response(declaredTooBig.stream, { headers: { 'Content-Length': '1001' } }),
    )
  );
  assertFailure(
    await declaringDownloader.download('https://example.com/a', 1_000),
    'content_too_big',
  );
  if (declaredTooBig.pulledChunkCount !== 0 || !declaredTooBig.canceled) {
    throw new Error('Expected content declared too big to be released unread');
  }

  // Without a declared length, reading stops at the first chunk past the limit.
  const chunk = new Uint8Array(400);
  const undeclaredTooBig = new CountingStream(Array.from({ length: 1_000 }, () => chunk));
  const streamingDownloader = createDownloader(() =>
    Promise.resolve(new Response(undeclaredTooBig.stream))
  );
  assertFailure(
    await streamingDownloader.download('https://example.com/a', 1_000),
    'content_too_big',
  );
  if (undeclaredTooBig.pulledChunkCount > 4 || !undeclaredTooBig.canceled) {
    throw new Error(
      `Expected reading to stop past the limit, read ${undeclaredTooBig.pulledChunkCount} chunks`,
    );
  }

  const atLimit = createDownloader(() => Promise.resolve(new Response(new Uint8Array(1_000))));
  const download = await atLimit.download('https://example.com/a', 1_000);
  if (!download.downloaded || download.content.length !== 1_000) {
    throw new Error(`Expected content of exactly the limit, received ${JSON.stringify(download)}`);
  }
});

Deno.test('WebFileDownloader fails for content shorter than its declared length', async () => {
  const truncated = createDownloader(() =>
    Promise.resolve(new Response(PDF_CONTENT, { headers: { 'Content-Length': '100' } }))
  );
  assertFailure(await truncated.download('https://example.com/a', 1_000), 'content_unavailable');

  const broken = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(PDF_CONTENT);
      controller.error(new TypeError('connection reset'));
    },
  });
  const interrupted = createDownloader(() => Promise.resolve(new Response(broken)));
  assertFailure(await interrupted.download('https://example.com/a', 1_000), 'content_unavailable');
});

Deno.test('WebFileDownloader gives up when its time budget runs out', async () => {
  const lateResponse = Promise.withResolvers<Response>();
  const neverAnswering = createDownloader(() => lateResponse.promise, { timeoutMilliseconds: 20 });
  assertFailure(
    await neverAnswering.download('https://example.com/a', 1_000),
    'content_unavailable',
  );
  const lateResponseBody = new CountingStream([PDF_CONTENT]);
  lateResponse.resolve(new Response(lateResponseBody.stream));
  await Promise.resolve();
  await Promise.resolve();
  if (!lateResponseBody.canceled) {
    throw new Error('Expected a response arriving after the time budget to be released');
  }

  const stalledBody = new CountingStream([PDF_CONTENT], { stallsAfterChunks: true });
  const stalling = createDownloader(
    () => Promise.resolve(new Response(stalledBody.stream)),
    { timeoutMilliseconds: 20 },
  );
  assertFailure(await stalling.download('https://example.com/a', 1_000), 'content_unavailable');
  if (!stalledBody.canceled) {
    throw new Error('Expected a stalled body to be released when the time budget ran out');
  }
});

Deno.test('WebFileDownloader stops when the caller aborts', async () => {
  const stalledBody = new CountingStream([PDF_CONTENT], { stallsAfterChunks: true });
  const downloader = createDownloader(() => Promise.resolve(new Response(stalledBody.stream)));
  const caller = new AbortController();
  const download = downloader.download('https://example.com/a', 1_000, caller.signal);
  setTimeout(() => caller.abort(), 10);
  assertFailure(await download, 'content_unavailable');
  if (!stalledBody.canceled) {
    throw new Error('Expected the body to be released when the caller aborted');
  }

  let requested = false;
  const alreadyAborted = createDownloader(() => {
    requested = true;
    return Promise.resolve(new Response(PDF_CONTENT));
  });
  assertFailure(
    await alreadyAborted.download('https://example.com/a', 1_000, AbortSignal.abort()),
    'content_unavailable',
  );
  if (requested) {
    throw new Error('Expected an aborted download to request nothing');
  }
});

Deno.test('WebFileDownloader does not wait for a body whose cancellation never settles', async () => {
  // A source whose cancellation never settles, after an optional chunk of content.
  const stuckBody = (chunk?: Uint8Array<ArrayBuffer>) =>
    new ReadableStream<Uint8Array<ArrayBuffer>>({
      start(controller) {
        if (chunk !== undefined) {
          controller.enqueue(chunk);
        }
      },
      cancel: () => new Promise<void>(() => {}),
    });
  const cases: { respond: () => Response; expectedReason: string }[] = [
    {
      respond: () => new Response(stuckBody(), { status: 500 }),
      expectedReason: 'content_unavailable',
    },
    {
      respond: () => new Response(stuckBody(), { status: 302, headers: { Location: 'file:///x' } }),
      expectedReason: 'content_unavailable',
    },
    {
      respond: () => new Response(stuckBody(), { headers: { 'Content-Length': '1001' } }),
      expectedReason: 'content_too_big',
    },
    {
      respond: () => new Response(stuckBody(new Uint8Array(1_001))),
      expectedReason: 'content_too_big',
    },
  ];
  for (const { respond, expectedReason } of cases) {
    const downloader = createDownloader(() => Promise.resolve(respond()), {
      timeoutMilliseconds: 50,
    });
    const guard = Promise.withResolvers<'still waiting'>();
    const guardTimer = setTimeout(() => guard.resolve('still waiting'), 1_000);
    const outcome = await Promise.race([
      downloader.download('https://example.com/a', 1_000),
      guard.promise,
    ]);
    clearTimeout(guardTimer);
    if (outcome === 'still waiting') {
      throw new Error(`Expected ${expectedReason} without waiting for the cancellation`);
    }
    assertFailure(outcome, expectedReason);
  }
});

function createDownloader(
  fetchWebResource: WebResourceFetcher,
  { timeoutMilliseconds = 1_000, maxRedirects = 5 } = {},
): WebFileDownloader {
  return new WebFileDownloader({ fetchWebResource, timeoutMilliseconds, maxRedirects });
}

function assertDownloaded(
  download: WebFileDownload,
  expectedContent: Uint8Array,
  expectedMediaType: string,
): void {
  if (
    !download.downloaded || download.mediaType !== expectedMediaType ||
    download.content.toBase64() !== expectedContent.toBase64()
  ) {
    throw new Error(`Expected the content to be downloaded, received ${JSON.stringify(download)}`);
  }
}

function assertFailure(download: WebFileDownload, expectedReason: string): void {
  if (download.downloaded || download.reason !== expectedReason) {
    throw new Error(`Expected ${expectedReason}, received ${JSON.stringify(download)}`);
  }
}

/**
 * A response body that counts the chunks read from it and whether it was canceled, and that can
 * stall after its chunks instead of ending, as a connection that stops sending does.
 */
class CountingStream {
  readonly stream: ReadableStream<Uint8Array<ArrayBuffer>>;
  pulledChunkCount = 0;
  canceled = false;

  constructor(
    chunks: readonly Uint8Array<ArrayBuffer>[],
    { stallsAfterChunks = false } = {},
  ) {
    this.stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
      pull: (controller) => {
        const chunk = chunks[this.pulledChunkCount];
        if (chunk !== undefined) {
          this.pulledChunkCount++;
          controller.enqueue(chunk);
          return;
        }
        if (stallsAfterChunks) {
          return new Promise<void>(() => {});
        }
        controller.close();
      },
      cancel: () => {
        this.canceled = true;
      },
    }, { highWaterMark: 0 });
  }
}
