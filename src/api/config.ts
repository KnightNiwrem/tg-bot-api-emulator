import { z } from 'zod';

import { DEFAULT_PORT } from './server.ts';

const DEFAULT_DOMAIN = 'localhost';

const serverEnvironmentSchema = z.object({
  DOMAIN: z.string().trim().pipe(z.hostname()).default(DEFAULT_DOMAIN),
  PORT: z.coerce.number().int().min(1).max(65_535).default(DEFAULT_PORT),
});

export interface ServerConfiguration {
  readonly domain: string;
  readonly port: number;
  readonly publicOrigin: string;
}

export function parseServerConfiguration(
  environment: Readonly<Record<string, string | undefined>>,
): ServerConfiguration {
  const { DOMAIN: domain, PORT: port } = serverEnvironmentSchema.parse(environment);

  return {
    domain,
    port,
    publicOrigin: `http://${domain}:${port}`,
  };
}
