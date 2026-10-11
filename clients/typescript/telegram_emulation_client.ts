import { createSessionContract } from '../../src/api/contracts/sessions.ts';
import { callJsonAction } from './control_operation_caller.ts';
import {
  createEmulationSessionClient,
  type EmulationSessionClient,
} from './emulation_session_client.ts';
import type { ActionOutcome, CreateSessionInput } from './types.ts';
import { normalizeUrlRoot } from './utils.ts';

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

  /**
   * Creates a session, whose receipt is the new session's at position 0, before every entry of its
   * bot activity log.
   */
  async createSession(
    input: CreateSessionInput = {},
  ): Promise<ActionOutcome<EmulationSessionClient>> {
    const { result: session, receipt } = await callJsonAction(
      { serverRoot: this.#serverRoot, fetch: this.#fetch },
      createSessionContract,
      { body: input },
    );

    return {
      result: createEmulationSessionClient(this.#serverRoot, session, this.#fetch),
      receipt,
    };
  }
}
