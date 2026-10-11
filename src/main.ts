import { parseServerConfiguration } from './api/config.ts';
import { createSessionLifecycleService } from './composition/session_lifecycle.ts';
import { createEmulationApi } from './api/mod.ts';
import { TelegramEmulationServer } from './api/server.ts';

if (import.meta.main) {
  const configuration = parseServerConfiguration({
    DOMAIN: Deno.env.get('DOMAIN'),
    PORT: Deno.env.get('PORT'),
  });

  const api = createEmulationApi({
    sessionLifecycle: createSessionLifecycleService(),
    publicOrigin: configuration.publicOrigin,
  });
  const server = new TelegramEmulationServer({ port: configuration.port }).start(api.fetch);
  await server.finished;
}
