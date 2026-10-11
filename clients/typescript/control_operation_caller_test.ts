/**
 * The contract-driven route registration and typed caller, exercised together on contracts of
 * operations that no control route has yet: a query, bytes, an empty success, and an optional body.
 */
import { assertEquals, assertRejects, assertThrows } from '@std/assert';
import { Hono } from 'hono';
import { z } from 'zod';

import { registerControlOperation } from '../../src/api/control_operation_route.ts';
import { controlRefusalSchema } from '../../control_contracts/control_errors.ts';
import { isContentTypeInRange } from '../../control_contracts/media_type.ts';
import { defineControlOperation } from '../../control_contracts/operation_contract.ts';
import {
  callBytesOperation,
  callEmptyOperation,
  callJsonOperation,
  type ControlOperationTransport,
} from './control_operation_caller.ts';
import { EmulationClientError, EmulationControlError } from './emulation_client_error.ts';

const readNoteContract = defineControlOperation({
  operationId: 'readNote',
  method: 'GET',
  path: '/notes/{noteId}',
  params: z.strictObject({ noteId: z.string() }),
  query: z.strictObject({ language: z.string(), format: z.enum(['plain', 'rich']).optional() }),
  success: {
    status: 200,
    body: {
      kind: 'json',
      schema: z.strictObject({ id: z.string(), language: z.string(), format: z.string() }),
    },
  },
  refusals: { 404: controlRefusalSchema(['file_not_found']) },
});

const downloadNoteContract = defineControlOperation({
  operationId: 'downloadNote',
  method: 'GET',
  path: '/notes/{noteId}/content',
  params: z.strictObject({ noteId: z.string() }),
  success: { status: 200, body: { kind: 'bytes', mediaTypeRange: 'text/*' } },
  refusals: {},
});

const writeNoteContract = defineControlOperation({
  operationId: 'writeNote',
  method: 'PUT',
  path: '/notes/{noteId}',
  params: z.strictObject({ noteId: z.string() }),
  body: { required: false, schema: z.strictObject({ pinned: z.boolean().default(false) }) },
  success: { status: 204, body: { kind: 'empty' } },
  refusals: {},
});

/** A server of notes whose routes record what each decoded request held. */
function createNoteServer(): { transport: ControlOperationTransport; writes: unknown[] } {
  const routes = new Hono();
  const writes: unknown[] = [];
  registerControlOperation(
    routes,
    '',
    readNoteContract,
    ({ params, query }) =>
      params.noteId === 'missing' ? { status: 404, body: { reason: 'file_not_found' } } : {
        status: 200,
        body: { id: params.noteId, language: query.language, format: query.format ?? 'plain' },
      },
  );
  registerControlOperation(routes, '', downloadNoteContract, ({ params }) => ({
    status: 200,
    body: new TextEncoder().encode(`Note ${params.noteId}`),
    mediaType: 'text/plain',
  }));
  registerControlOperation(routes, '', writeNoteContract, ({ params, body }) => {
    writes.push({ noteId: params.noteId, ...body });
    return { status: 204 };
  });
  const app = new Hono().route('/', routes);
  return {
    transport: {
      serverRoot: new URL('http://notes.example/'),
      fetch: (input, init) => Promise.resolve(app.request(input, init)),
    },
    writes,
  };
}

Deno.test('A path parameter is encoded into its segment and decoded back', async () => {
  const { transport } = createNoteServer();

  const note = await callJsonOperation(transport, readNoteContract, {
    params: { noteId: 'a b/c?d' },
    query: { language: 'en' },
  });

  assertEquals(note, { id: 'a b/c?d', language: 'en', format: 'plain' }, 'Expected the note');
});

Deno.test('A query sends the parameters given and leaves out an omitted optional one', async () => {
  const { transport } = createNoteServer();

  const rich = await callJsonOperation(transport, readNoteContract, {
    params: { noteId: '1' },
    query: { language: 'de', format: 'rich' },
  });

  assertEquals(rich.format, 'rich', 'Expected the optional parameter sent when given');
});

Deno.test('A repeated or unknown query parameter is an issue of the query', async () => {
  const { transport } = createNoteServer();

  const response = await transport.fetch(
    'http://notes.example/notes/1?language=en&language=de&x=1',
  );

  assertEquals(response.status, 400, 'Expected the query refused');
  assertEquals(
    (await response.json()).issues.map(({ source, path, code }: Record<string, unknown>) => ({
      source,
      path,
      code,
    })),
    [
      { source: 'query', path: ['language'], code: 'duplicate_field' },
      { source: 'query', path: ['x'], code: 'unknown_field' },
    ],
    'Expected the repeated and the unknown parameter reported',
  );
});

Deno.test('A refusal the contract declares throws its reason', async () => {
  const { transport } = createNoteServer();

  let refusal: unknown;
  try {
    await callJsonOperation(transport, readNoteContract, {
      params: { noteId: 'missing' },
      query: { language: 'en' },
    });
  } catch (error) {
    refusal = error;
  }

  if (!(refusal instanceof EmulationControlError) || refusal.reason !== 'file_not_found') {
    throw new Error(`Expected the refusal's reason, received ${refusal}`);
  }
});

Deno.test('A bytes success is read as bytes, served in its media type', async () => {
  const { transport } = createNoteServer();

  const bytes = await callBytesOperation(transport, downloadNoteContract, {
    params: { noteId: '7' },
  });
  const response = await transport.fetch('http://notes.example/notes/7/content');

  assertEquals(new TextDecoder().decode(bytes), 'Note 7', 'Expected the note content');
  assertEquals(response.headers.get('Content-Type'), 'text/plain', 'Expected its media type');
});

Deno.test('Bytes outside the media type range their contract declares are refused', async () => {
  const servedTypes: (string | null)[] = ['image/png', null, 'TEXT/Plain; charset=utf-8'];
  const transport: ControlOperationTransport = {
    serverRoot: new URL('http://notes.example/'),
    fetch: () => {
      const contentType = servedTypes.shift() ?? null;
      const response = new Response(new TextEncoder().encode('Note'), { status: 200 });
      if (contentType === null) response.headers.delete('Content-Type');
      else response.headers.set('Content-Type', contentType);
      return Promise.resolve(response);
    },
  };
  const download = () =>
    callBytesOperation(transport, downloadNoteContract, { params: { noteId: '1' } });

  await assertRejects(download, EmulationClientError, 'not text/*');
  await assertRejects(download, EmulationClientError, 'no media type');
  const accepted = new TextDecoder().decode(await download());

  assertEquals(accepted, 'Note', 'Expected text with parameters, in any letter case, accepted');
});

Deno.test('Bytes of the wrong media type are refused however cancelling their body ends', async () => {
  const unsettledCancel = () => new Promise<void>(() => {});
  const rejectedCancel = () => Promise.reject(new Error('The transport failed to cancel'));
  for (const cancel of [unsettledCancel, rejectedCancel]) {
    const transport: ControlOperationTransport = {
      serverRoot: new URL('http://notes.example/'),
      fetch: () =>
        Promise.resolve(
          new Response(new ReadableStream({ cancel }), {
            status: 200,
            headers: { 'Content-Type': 'image/png' },
          }),
        ),
    };

    await assertRejects(
      () => callBytesOperation(transport, downloadNoteContract, { params: { noteId: '1' } }),
      EmulationClientError,
      'not text/*',
    );
  }
});

Deno.test('A wildcard Content-Type is no media type within a range', async () => {
  const transport: ControlOperationTransport = {
    serverRoot: new URL('http://notes.example/'),
    fetch: () =>
      Promise.resolve(
        new Response('Note', { status: 200, headers: { 'Content-Type': 'text/*' } }),
      ),
  };
  const routes = new Hono();
  registerControlOperation(routes, '', downloadNoteContract, () => ({
    status: 200,
    body: new Uint8Array([1]),
    mediaType: 'text/*',
  }));
  const app = new Hono().route('/', routes);

  await assertRejects(
    () => callBytesOperation(transport, downloadNoteContract, { params: { noteId: '1' } }),
    EmulationClientError,
    'not text/*',
  );
  const response = await app.request('http://notes.example/notes/1/content');
  assertEquals(response.status, 500, 'Expected the route to fail rather than answer a range');
});

Deno.test('A bytes contract declares a media range of RFC 9110 form', () => {
  for (
    const mediaTypeRange of ['text', '*/plain', 'text/', '/plain', 'text/plain/x', '', 'te xt/*']
  ) {
    assertThrows(
      () =>
        defineControlOperation({
          ...downloadNoteContract,
          success: { status: 200, body: { kind: 'bytes', mediaTypeRange } },
        }),
      Error,
      'no media range',
      `Expected ${JSON.stringify(mediaTypeRange)} refused`,
    );
  }
  for (const mediaTypeRange of ['text/plain', 'text/*', '*/*', 'Image/PNG']) {
    defineControlOperation({
      ...downloadNoteContract,
      success: { status: 200, body: { kind: 'bytes', mediaTypeRange } },
    });
  }
});

Deno.test('A route answering bytes outside its media type range is a server fault', async () => {
  const routes = new Hono();
  registerControlOperation(routes, '', downloadNoteContract, () => ({
    status: 200,
    body: new Uint8Array([1]),
    mediaType: 'image/png',
  }));
  const app = new Hono().route('/', routes);

  const response = await app.request('http://notes.example/notes/1/content');

  assertEquals(response.status, 500, 'Expected the route to fail rather than answer an image');
});

Deno.test('A Content-Type is within a range when it is well formed and its media type matches', () => {
  const cases: readonly (readonly [contentType: string, range: string, within: boolean])[] = [
    // Ranges.
    ['image/png', '*/*', true],
    ['image/png', 'image/*', true],
    ['image/png', 'image/png', true],
    ['image/png', 'image/jpeg', false],
    ['image/png', 'text/*', false],
    // Letter case, of the media type and of the range.
    ['Image/PNG', 'image/png', true],
    ['image/png', 'IMAGE/*', true],
    // Wildcards, which only a range may hold.
    ['text/*', 'text/*', false],
    ['*/*', '*/*', false],
    ['*/plain', '*/*', false],
    ['text/plain', '*/plain', false],
    // Malformed media types.
    ['image', '*/*', false],
    ['image/png/x', '*/*', false],
    ['', '*/*', false],
    [' text/plain', '*/*', false],
    ['text /plain', '*/*', false],
    ['text/plain, text/html', '*/*', false],
    // Parameters, of any case, around semicolons with optional spaces and tabs.
    ['text/plain;charset=utf-8', 'text/plain', true],
    ['text/plain ; Charset=UTF-8', 'text/plain', true],
    ['text/plain;\tcharset=utf-8;\tformat=flowed', 'text/plain', true],
    // Empty parameters, which the grammar allows.
    ['text/plain;', 'text/plain', true],
    ['text/plain; ;charset=utf-8;;', 'text/plain', true],
    // A name without a value, a value without a name, or text that is no parameter.
    ['text/plain; charset', 'text/plain', false],
    ['text/plain; charset=', 'text/plain', false],
    ['text/plain; =utf-8', 'text/plain', false],
    ['text/plain; garbage', 'text/plain', false],
    // Whitespace around the equals sign.
    ['text/plain; charset =utf-8', 'text/plain', false],
    ['text/plain; charset= utf-8', 'text/plain', false],
    // Quoted values, which may hold a semicolon, spaces and escaped quotes.
    ['text/plain; name="a;b c"', 'text/plain', true],
    ['text/plain; name="say \\"hi\\""', 'text/plain', true],
    ['text/plain; name=""', 'text/plain', true],
    ['text/plain; name="unterminated', 'text/plain', false],
    ['text/plain; name="a"b', 'text/plain', false],
    ['text/plain; name=a b', 'text/plain', false],
  ];
  assertEquals(
    cases.map(([contentType, range]) => isContentTypeInRange(contentType, range)),
    cases.map(([, , within]) => within),
    'Expected each Content-Type judged against its range',
  );
});

Deno.test('An optional body may be left out, and its defaults still apply', async () => {
  const { transport, writes } = createNoteServer();

  await callEmptyOperation(transport, writeNoteContract, { params: { noteId: '1' } });
  await callEmptyOperation(transport, writeNoteContract, {
    params: { noteId: '2' },
    body: { pinned: true },
  });

  assertEquals(
    writes,
    [{ noteId: '1', pinned: false }, { noteId: '2', pinned: true }],
    'Expected each write decoded with its defaults',
  );
});

/** The parts of a request every kind of call sends: a path parameter, a query and a body. */
const echoRequestParts = {
  params: z.strictObject({ echoId: z.string() }),
  query: z.strictObject({ tag: z.string() }),
  body: { required: true, schema: z.strictObject({ text: z.string() }) },
} as const;

const echoJsonContract = defineControlOperation({
  operationId: 'echoJson',
  method: 'POST',
  path: '/echoes/{echoId}/json',
  ...echoRequestParts,
  success: { status: 200, body: { kind: 'json', schema: z.strictObject({ echo: z.string() }) } },
  refusals: {},
});

const echoEmptyContract = defineControlOperation({
  operationId: 'echoEmpty',
  method: 'POST',
  path: '/echoes/{echoId}/empty',
  ...echoRequestParts,
  success: { status: 204, body: { kind: 'empty' } },
  refusals: {},
});

const echoBytesContract = defineControlOperation({
  operationId: 'echoBytes',
  method: 'POST',
  path: '/echoes/{echoId}/bytes',
  ...echoRequestParts,
  success: { status: 200, body: { kind: 'bytes', mediaTypeRange: 'text/*' } },
  refusals: {},
});

Deno.test('Every kind of call sends its path parameters, query and body', async () => {
  const routes = new Hono();
  const describeRequest = (
    { params, query, body }: {
      params: { echoId: string };
      query: { tag: string };
      body: { text: string };
    },
  ) => `${params.echoId} ${query.tag} ${body.text}`;
  const emptyEchoes: string[] = [];
  registerControlOperation(routes, '', echoJsonContract, (request) => ({
    status: 200,
    body: { echo: describeRequest(request) },
  }));
  registerControlOperation(routes, '', echoEmptyContract, (request) => {
    emptyEchoes.push(describeRequest(request));
    return { status: 204 };
  });
  registerControlOperation(routes, '', echoBytesContract, (request) => ({
    status: 200,
    body: new TextEncoder().encode(describeRequest(request)),
    mediaType: 'text/plain',
  }));
  const app = new Hono().route('/', routes);
  const transport: ControlOperationTransport = {
    serverRoot: new URL('http://echoes.example/'),
    fetch: (input, init) => Promise.resolve(app.request(input, init)),
  };
  const request = { params: { echoId: 'e/1' }, query: { tag: 'a&b' }, body: { text: 'Hi' } };

  const json = await callJsonOperation(transport, echoJsonContract, request);
  await callEmptyOperation(transport, echoEmptyContract, request);
  const bytes = await callBytesOperation(transport, echoBytesContract, request);

  assertEquals(
    [json.echo, emptyEchoes[0], new TextDecoder().decode(bytes)],
    ['e/1 a&b Hi', 'e/1 a&b Hi', 'e/1 a&b Hi'],
    'Expected each kind of call to send every part of its request',
  );
});
