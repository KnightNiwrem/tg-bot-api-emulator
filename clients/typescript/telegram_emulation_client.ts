import { HTTP_STATUS_CREATED } from './constants.ts';
import {
  createEmulationSessionClient,
  type EmulationSessionClient,
} from './emulation_session_client.ts';
import { emulationSessionSchema } from './schemas.ts';
import type { CreateSessionInput } from './types.ts';
import { normalizeUrlRoot, requestJson } from './utils.ts';

export interface TelegramEmulationClientOptions {
  /** Overrides the global fetch implementation, primarily for in-process tests. */
  readonly fetch?: typeof globalThis.fetch;
}

/** Client for creating isolated sessions on a Telegram emulation server. */
export class TelegramEmulationClient {
  readonly #serverRoot: URL;
  readonly #fetch: typeof globalThis.fetch;

  constructor(serverRoot: string | URL, options: TelegramEmulationClientOptions = {}) {
    this.#serverRoot = normalizeUrlRoot(serverRoot, 'serverRoot');
    this.#fetch = options.fetch ?? globalThis.fetch;

    if (typeof this.#fetch !== 'function') {
      throw new TypeError('fetch must be a function');
    }
  }

  async createSession(input: CreateSessionInput = {}): Promise<EmulationSessionClient> {
    const session = await requestJson(this.#fetch, {
      method: 'POST',
      url: new URL('sessions', this.#serverRoot).href,
      expectedStatus: HTTP_STATUS_CREATED,
      responseSchema: emulationSessionSchema,
      body: input,
    });

    return createEmulationSessionClient(this.#serverRoot, session, this.#fetch);
  }
}
