/**
 * A response that a session's emulated web serves for a URL. Telegram downloads the files that bots
 * send by URL; tests register what each URL serves, so the emulator never reaches the network.
 */
export interface WebResource {
  /** The URL in TDLib's canonical form, as `parseHttpUrl` writes it. */
  readonly url: string;
  /** The HTTP status, from 200 to 599. */
  readonly status: number;
  /** The `Content-Type` header; omitted for none. */
  readonly contentType?: string;
  /** The `Location` header of a redirect, relative to the URL or absolute; omitted for none. */
  readonly location?: string;
  readonly content: Uint8Array<ArrayBuffer>;
}
