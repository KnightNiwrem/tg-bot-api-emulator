import { TelegramEmulationServer } from '../src/api/server.ts';

Deno.test('TelegramEmulationServer listens for HTTP requests', async () => {
  const server = new TelegramEmulationServer({ hostname: '127.0.0.1', port: 0 }).start(
    (request) => new Response(request.url, { status: 202 }),
  );

  try {
    const { hostname, port } = server.addr;
    const requestUrl = `http://${hostname}:${port}/handled`;
    const response = await fetch(requestUrl);

    if (response.status !== 202) {
      throw new Error(`Expected status 202, received ${response.status}`);
    }
    if (await response.text() !== requestUrl) {
      throw new Error('Expected the HTTP listener to delegate the request to its handler');
    }
  } finally {
    await server.shutdown();
  }
});
