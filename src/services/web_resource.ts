import { formatHttpUrl, parseHttpUrl } from '../types/http_url.ts';
import type { WebResource } from '../types/web_resource.ts';

/** The range of statuses a `Response` can carry, which the emulator serves. */
const MIN_RESPONSE_STATUS = 200;
const MAX_RESPONSE_STATUS = 599;

/** HTTP statuses whose responses have no body. */
const NULL_BODY_STATUSES: ReadonlySet<number> = new Set([204, 205, 304]);

interface WebResourceStore {
  set(requestUrl: string, resource: WebResource): void;
  get(requestUrl: string): WebResource | undefined;
}

interface WebResourceServiceDependencies {
  readonly webResources: WebResourceStore;
}

export type WebResourceRegistration = Omit<WebResource, 'url'> & {
  /** The resource's HTTP URL, read as Telegram reads the URL a bot sends a file by. */
  readonly url: string;
};

export type RegisterWebResourceResult =
  | { readonly registered: true; readonly resource: WebResource }
  | { readonly registered: false; readonly reason: 'url_invalid'; readonly urlError: string }
  | { readonly registered: false; readonly reason: 'status_invalid' | 'header_invalid' };

/**
 * Serves a session's emulated web: the responses tests register for URLs, from which Telegram
 * downloads the files bots send by URL. Requests for other URLs fail as unreachable, so a session
 * never reaches the network.
 */
export class WebResourceService {
  readonly #webResources: WebResourceStore;

  constructor({ webResources }: WebResourceServiceDependencies) {
    this.#webResources = webResources;
  }

  /**
   * Registers what a URL serves, replacing what it served before. The URL is read as TDLib reads a
   * file URL, so the resource answers every spelling of it that TDLib reads alike.
   */
  registerWebResource(registration: WebResourceRegistration): RegisterWebResourceResult {
    if (
      !Number.isInteger(registration.status) || registration.status < MIN_RESPONSE_STATUS ||
      registration.status > MAX_RESPONSE_STATUS
    ) {
      return { registered: false, reason: 'status_invalid' };
    }
    const parsing = parseHttpUrl(registration.url);
    if (!parsing.parsed) {
      return { registered: false, reason: 'url_invalid', urlError: parsing.error };
    }
    const url = formatHttpUrl(parsing.url);
    const requestUrl = getRequestUrl(url);
    if (requestUrl === undefined) {
      // TDLib reads the URL, but a `Request` cannot carry it, so nothing could download it.
      return { registered: false, reason: 'url_invalid', urlError: 'Host is invalid' };
    }
    const resource = { ...registration, url };
    if (createResponseHeaders(resource) === undefined) {
      return { registered: false, reason: 'header_invalid' };
    }
    this.#webResources.set(requestUrl, resource);
    return { registered: true, resource };
  }

  /** Answers a request with the resource registered for its URL, whatever its method. */
  fetchWebResource(request: Request): Promise<Response> {
    const requestUrl = getRequestUrl(request.url);
    const resource = requestUrl === undefined ? undefined : this.#webResources.get(requestUrl);
    if (resource === undefined) {
      return Promise.reject(new TypeError(`No web resource is registered for ${request.url}`));
    }
    const headers = createResponseHeaders(resource);
    if (headers === undefined) {
      return Promise.reject(
        new Error(`Web resource ${resource.url} was registered with invalid headers`),
      );
    }
    return Promise.resolve(
      new Response(servesBody(resource) ? resource.content : null, {
        status: resource.status,
        headers,
      }),
    );
  }
}

/** Whether a resource's response carries its content, which a status without a body cannot. */
function servesBody(resource: WebResource): boolean {
  return resource.content.length > 0 && !NULL_BODY_STATUSES.has(resource.status);
}

/**
 * The headers a resource's response carries, with the length of the body it serves; or `undefined`
 * when a registered value cannot be a header value, such as one with a line break.
 */
function createResponseHeaders(resource: WebResource): Headers | undefined {
  try {
    const headers = new Headers({
      'Content-Length': String(servesBody(resource) ? resource.content.length : 0),
    });
    if (resource.contentType !== undefined) {
      headers.set('Content-Type', resource.contentType);
    }
    if (resource.location !== undefined) {
      headers.set('Location', resource.location);
    }
    return headers;
  } catch {
    return undefined;
  }
}

/**
 * The form of a URL that a `Request` carries, without its fragment, which is never requested; or
 * `undefined` for a URL that a `Request` cannot carry. It keys resources, so that a canonical URL
 * and the request for it find the same one.
 */
function getRequestUrl(url: string): string | undefined {
  const requestUrl = URL.parse(url);
  if (requestUrl === null) {
    return undefined;
  }
  requestUrl.hash = '';
  return requestUrl.href;
}
