import type { WebResource } from '../types/web_resource.ts';

/** Stores the responses a session's emulated web serves, by the request URL that finds each. */
export class WebResourceRepository {
  readonly #resourcesByRequestUrl = new Map<string, WebResource>();

  /** Stores a resource, replacing any stored for the same request URL. */
  set(requestUrl: string, resource: WebResource): void {
    this.#resourcesByRequestUrl.set(requestUrl, resource);
  }

  get(requestUrl: string): WebResource | undefined {
    return this.#resourcesByRequestUrl.get(requestUrl);
  }
}
