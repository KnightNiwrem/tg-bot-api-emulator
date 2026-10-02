/**
 * Answers a request for a web resource, as `fetch` does. The emulator answers from the resources a
 * test registered in its session rather than from the network.
 */
export type WebResourceFetcher = (request: Request) => Promise<Response>;

export type WebFileDownload =
  | {
    readonly downloaded: true;
    readonly content: Uint8Array<ArrayBuffer>;
    /** The lowercase media type of the `Content-Type` header; omitted for none. */
    readonly mediaType?: string;
  }
  | { readonly downloaded: false; readonly reason: 'content_unavailable' | 'content_too_big' };

interface WebFileDownloaderDependencies {
  readonly fetchWebResource: WebResourceFetcher;
  /** How long a download, with its redirects, may take before it fails. */
  readonly timeoutMilliseconds: number;
  /** How many redirects a download follows before it fails. */
  readonly maxRedirects: number;
}

/** The emulator's budgets for downloads; Telegram's own are not public. */
export const WEB_FILE_DOWNLOAD_TIMEOUT_MILLISECONDS = 10_000;
export const MAX_WEB_FILE_REDIRECTS = 5;

const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

const CONTENT_UNAVAILABLE: WebFileDownload = { downloaded: false, reason: 'content_unavailable' };
const CONTENT_TOO_BIG: WebFileDownload = { downloaded: false, reason: 'content_too_big' };

/**
 * Downloads the file at an HTTP URL, as Telegram does for a file a bot sends by URL. A download
 * follows a bounded number of redirects to HTTP and HTTPS URLs, must answer 2xx within its time
 * budget, and reads at most the given number of bytes, stopping as soon as the content, or its
 * declared length, is larger. Content shorter than its declared length is truncated and fails.
 *
 * A failed download requests the cancellation of the response it was reading, whether it failed
 * for its content, its time budget, or the caller's signal, without waiting for the cancellation
 * to complete.
 */
export class WebFileDownloader {
  readonly #fetchWebResource: WebResourceFetcher;
  readonly #timeoutMilliseconds: number;
  readonly #maxRedirects: number;

  constructor(
    { fetchWebResource, timeoutMilliseconds, maxRedirects }: WebFileDownloaderDependencies,
  ) {
    this.#fetchWebResource = fetchWebResource;
    this.#timeoutMilliseconds = timeoutMilliseconds;
    this.#maxRedirects = maxRedirects;
  }

  async download(
    url: string,
    maxContentBytes: number,
    signal?: AbortSignal,
  ): Promise<WebFileDownload> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new DOMException('Download timed out', 'TimeoutError')),
      this.#timeoutMilliseconds,
    );
    const abortForCaller = () => controller.abort(signal?.reason);
    if (signal?.aborted) {
      abortForCaller();
    } else {
      signal?.addEventListener('abort', abortForCaller, { once: true });
    }
    try {
      return await this.#followRedirects(url, maxContentBytes, controller.signal);
    } catch {
      // The resource failed to answer, its content failed to arrive, or a budget ran out.
      return CONTENT_UNAVAILABLE;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abortForCaller);
    }
  }

  async #followRedirects(
    url: string,
    maxContentBytes: number,
    signal: AbortSignal,
  ): Promise<WebFileDownload> {
    let currentUrl = url;
    for (let redirectCount = 0;; redirectCount++) {
      const response = await this.#fetchUntilAborted(
        new Request(currentUrl, { redirect: 'manual', signal }),
        signal,
      );
      if (!REDIRECT_STATUSES.has(response.status)) {
        if (!response.ok) {
          releaseBody(response);
          return CONTENT_UNAVAILABLE;
        }
        return await readBoundedContent(response, maxContentBytes, signal);
      }
      releaseBody(response);
      const location = response.headers.get('Location');
      const nextUrl = location === null ? null : URL.parse(location, currentUrl);
      if (
        redirectCount >= this.#maxRedirects || nextUrl === null ||
        (nextUrl.protocol !== 'http:' && nextUrl.protocol !== 'https:')
      ) {
        return CONTENT_UNAVAILABLE;
      }
      currentUrl = nextUrl.href;
    }
  }

  /**
   * Fetches a resource, failing as soon as the signal aborts even if the fetcher ignores it, and
   * releasing a response that arrives after that.
   */
  #fetchUntilAborted(request: Request, signal: AbortSignal): Promise<Response> {
    if (signal.aborted) {
      return Promise.reject(signal.reason);
    }
    const responsePromise = this.#fetchWebResource(request);
    return new Promise<Response>((resolve, reject) => {
      const rejectForAbort = () => reject(signal.reason);
      signal.addEventListener('abort', rejectForAbort, { once: true });
      responsePromise.then(
        (response) => {
          signal.removeEventListener('abort', rejectForAbort);
          if (signal.aborted) {
            releaseBody(response);
          } else {
            resolve(response);
          }
        },
        (error) => {
          signal.removeEventListener('abort', rejectForAbort);
          reject(error);
        },
      );
    });
  }
}

/**
 * Reads a response's content up to a size, canceling the rest of a larger one, and fails for
 * content that is shorter than its declared `Content-Length`.
 */
async function readBoundedContent(
  response: Response,
  maxContentBytes: number,
  signal: AbortSignal,
): Promise<WebFileDownload> {
  const mediaType = readMediaType(response.headers.get('Content-Type'));
  const declaredLengthText = response.headers.get('Content-Length');
  const declaredLength = declaredLengthText !== null && /^\d+$/.test(declaredLengthText)
    ? Number(declaredLengthText)
    : undefined;
  if (declaredLength !== undefined && declaredLength > maxContentBytes) {
    releaseBody(response);
    return CONTENT_TOO_BIG;
  }
  if (response.body === null) {
    return declaredLength === undefined || declaredLength === 0
      ? {
        downloaded: true,
        content: new Uint8Array(),
        ...(mediaType === undefined ? {} : { mediaType }),
      }
      : CONTENT_UNAVAILABLE;
  }

  const reader = response.body.getReader();
  const cancelForAbort = () => cancelUnawaited(reader.cancel(signal.reason));
  signal.addEventListener('abort', cancelForAbort, { once: true });
  try {
    const chunks: Uint8Array[] = [];
    let contentLength = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (signal.aborted) {
        return CONTENT_UNAVAILABLE;
      }
      if (done) {
        break;
      }
      contentLength += value.byteLength;
      if (contentLength > maxContentBytes) {
        cancelUnawaited(reader.cancel());
        return CONTENT_TOO_BIG;
      }
      chunks.push(value);
    }
    if (declaredLength !== undefined && contentLength !== declaredLength) {
      return CONTENT_UNAVAILABLE;
    }
    const content = new Uint8Array(contentLength);
    let offset = 0;
    for (const chunk of chunks) {
      content.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { downloaded: true, content, ...(mediaType === undefined ? {} : { mediaType }) };
  } finally {
    signal.removeEventListener('abort', cancelForAbort);
    reader.releaseLock();
  }
}

/**
 * Requests the cancellation of a response's unread body, as `cancelUnawaited` describes; the
 * cancellation may never complete.
 */
function releaseBody(response: Response): void {
  if (response.body !== null) {
    cancelUnawaited(response.body.cancel());
  }
}

/**
 * Takes a stream's cancellation, already requested, without awaiting it and ignoring whether it
 * fails. A source whose cancellation never settles must not hold the download past its time
 * budget, and the download's outcome is decided once the cancellation is requested.
 */
function cancelUnawaited(cancellation: Promise<void>): void {
  cancellation.catch(() => {});
}

/** Reads the lowercase media type of a `Content-Type` header, without its parameters. */
function readMediaType(contentType: string | null): string | undefined {
  const mediaType = contentType?.split(';', 1)[0].trim().toLowerCase();
  return mediaType === undefined || mediaType.length === 0 ? undefined : mediaType;
}
