/**
 * The client registers web resources through their contract, sending content as base64, and
 * refuses a registered resource that breaks what the contract promises.
 */
import { assertEquals, assertRejects } from '@std/assert';

import { registerWebResourceContract } from '../../control_contracts/web_resources.ts';
import { createTestInProcessEmulator } from '../../tests/support/emulation_api.ts';
import { callJsonOperation, type ControlOperationTransport } from './control_operation_caller.ts';
import { EmulationClientError } from './emulation_client_error.ts';

function transportAnswering(status: number, body: unknown): ControlOperationTransport {
  return {
    serverRoot: new URL('http://emulator.example/'),
    fetch: () => Promise.resolve(Response.json(body, { status })),
  };
}

Deno.test('The client sends a web resource content as base64 and reads the resource', async () => {
  await using emulator = createTestInProcessEmulator();
  const session = await emulator.client.createSession();

  const resources = [
    await session.registerWebResource({
      url: 'https://CDN.example.com/a.txt',
      content_type: 'text/plain',
      content: new TextEncoder().encode('notes'),
    }),
    await session.registerWebResource({ url: 'cdn.example.com/b', status: 404 }),
  ];

  assertEquals(
    resources,
    [
      {
        url: 'https://cdn.example.com/a.txt',
        status: 200,
        content_type: 'text/plain',
        content_length: 5,
      },
      { url: 'http://cdn.example.com/b', status: 404, content_length: 0 },
    ],
    'Expected each resource shown in its canonical form, with its content length',
  );
});

Deno.test('A web resource that breaks its contract is refused', async () => {
  const register = (resource: Record<string, unknown>) =>
    callJsonOperation(transportAnswering(201, resource), registerWebResourceContract, {
      params: { sessionId: 'session' },
      body: { url: 'https://cdn.example.com/a.txt' },
    });
  const resource = { url: 'https://cdn.example.com/a.txt', status: 200, content_length: 0 };

  for (
    const refused of [
      { ...resource, url: 'ftp://cdn.example.com/a.txt' },
      { ...resource, url: 'not a URL' },
      { ...resource, status: 199 },
      { ...resource, content_type: '' },
      { ...resource, location: '' },
      { ...resource, content_length: -1 },
    ]
  ) {
    await assertRejects(
      () => register(refused),
      EmulationClientError,
      'does not match its contract',
    );
  }
  assertEquals(
    await register({ ...resource, url: 'https://cdn.example.com/ä.txt' }),
    { ...resource, url: 'https://cdn.example.com/ä.txt' },
    'Expected a URL that keeps characters outside ASCII read',
  );
});
