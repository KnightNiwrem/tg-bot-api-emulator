export const DEFAULT_PORT = 8081;

export interface TelegramEmulationServerOptions {
  hostname?: string;
  port?: number;
}

export type HttpRequestHandler = (request: Request) => Response | Promise<Response>;

/** Owns the standalone HTTP listener for the Telegram emulation service. */
export class TelegramEmulationServer {
  readonly #hostname: string;
  readonly #port: number;
  #httpServer?: Deno.HttpServer<Deno.NetAddr>;

  constructor(options: TelegramEmulationServerOptions = {}) {
    const port = options.port ?? DEFAULT_PORT;
    if (!Number.isInteger(port) || port < 0 || port > 65_535) {
      throw new RangeError('port must be an integer between 0 and 65535');
    }

    this.#hostname = options.hostname ?? '0.0.0.0';
    this.#port = port;
  }

  start(handler: HttpRequestHandler): Deno.HttpServer<Deno.NetAddr> {
    if (this.#httpServer !== undefined) {
      throw new Error('Telegram emulation server has already been started');
    }

    this.#httpServer = Deno.serve(
      { hostname: this.#hostname, port: this.#port },
      handler,
    );
    return this.#httpServer;
  }
}
