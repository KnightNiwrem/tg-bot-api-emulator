/**
 * The contract-driven route registration and typed caller, exercised together on contracts of
 * operations that no control route has yet: a query, bytes, an empty success, and an optional body.
 */
import { Hono } from 'hono';
import { z } from 'zod';

import { registerControlOperation } from '../../src/api/control_operation_route.ts';
import { controlRefusalSchema } from '../../control_contracts/control_errors.ts';
import { defineControlOperation } from '../../control_contracts/operation_contract.ts';
import {
  callBytesOperation,
  callEmptyOperation,
  callJsonOperation,
  type ControlOperationTransport,
} from './control_operation_caller.ts';
import { EmulationControlError } from './emulation_client_error.ts';

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
  success: { status: 200, body: { kind: 'bytes' } },
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

  assertEqual(note, { id: 'a b/c?d', language: 'en', format: 'plain' }, 'Expected the note');
});

Deno.test('A query sends the parameters given and leaves out an omitted optional one', async () => {
  const { transport } = createNoteServer();

  const rich = await callJsonOperation(transport, readNoteContract, {
    params: { noteId: '1' },
    query: { language: 'de', format: 'rich' },
  });

  assertEqual(rich.format, 'rich', 'Expected the optional parameter sent when given');
});

Deno.test('A repeated or unknown query parameter is an issue of the query', async () => {
  const { transport } = createNoteServer();

  const response = await transport.fetch(
    'http://notes.example/notes/1?language=en&language=de&x=1',
  );

  assertEqual(response.status, 400, 'Expected the query refused');
  assertEqual(
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

  assertEqual(new TextDecoder().decode(bytes), 'Note 7', 'Expected the note content');
  assertEqual(response.headers.get('Content-Type'), 'text/plain', 'Expected its media type');
});

Deno.test('An optional body may be left out, and its defaults still apply', async () => {
  const { transport, writes } = createNoteServer();

  await callEmptyOperation(transport, writeNoteContract, { params: { noteId: '1' } });
  await callEmptyOperation(transport, writeNoteContract, {
    params: { noteId: '2' },
    body: { pinned: true },
  });

  assertEqual(
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
  success: { status: 200, body: { kind: 'bytes' } },
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

  assertEqual(
    [json.echo, emptyEchoes[0], new TextDecoder().decode(bytes)],
    ['e/1 a&b Hi', 'e/1 a&b Hi', 'e/1 a&b Hi'],
    'Expected each kind of call to send every part of its request',
  );
});

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}
