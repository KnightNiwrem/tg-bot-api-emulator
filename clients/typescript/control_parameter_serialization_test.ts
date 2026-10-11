/**
 * Path and query parameters that are not plain text, written by the typed caller and read back by
 * the contract-driven route registration: integers, booleans, `deepObject` objects and JSON values.
 */
import { Hono } from 'hono';
import { z } from 'zod';

import { defineControlOperation } from '../../control_contracts/operation_contract.ts';
import { registerControlOperation } from '../../src/api/control_operation_route.ts';
import { callJsonOperation, type ControlOperationTransport } from './control_operation_caller.ts';

const searchItemsContract = defineControlOperation({
  operationId: 'searchItems',
  method: 'GET',
  path: '/shelves/{shelfId}/items',
  params: z.strictObject({ shelfId: z.int().min(1) }),
  query: z.strictObject({
    after: z.int().min(0).default(0),
    archived: z.boolean().optional(),
    tags: z.record(z.string(), z.string()).optional(),
    filter: z.record(
      z.string(),
      z.union([z.record(z.string(), z.unknown()), z.array(z.unknown()).readonly()]),
    ).optional(),
  }),
  querySerialization: { tags: 'deepObject', filter: 'json' },
  success: { status: 200, body: { kind: 'json', schema: z.strictObject({ found: z.int() }) } },
  refusals: {},
});

/** A server of items whose route records each decoded request and each URL it was sent to. */
function createItemServer() {
  const routes = new Hono();
  const decodedRequests: unknown[] = [];
  const requestedUrls: URL[] = [];
  registerControlOperation(routes, '', searchItemsContract, (request) => {
    decodedRequests.push(request);
    return { status: 200, body: { found: 0 } };
  });
  const app = new Hono().route('/', routes);
  const transport: ControlOperationTransport = {
    serverRoot: new URL('http://items.example/'),
    fetch: (input, init) => {
      requestedUrls.push(new URL(input instanceof Request ? input.url : input));
      return Promise.resolve(app.request(input, init));
    },
  };
  return { transport, decodedRequests, requestedUrls };
}

Deno.test('Integers, booleans, objects and JSON values are written as their serialization says', async () => {
  const { transport, decodedRequests, requestedUrls } = createItemServer();

  await callJsonOperation(transport, searchItemsContract, {
    params: { shelfId: 7 },
    query: {
      after: 3,
      archived: false,
      tags: { 'a b': 'x&y', colour: 'red' },
      filter: { size: { max: 2 }, ids: [1, 2] },
    },
  });

  assertEqual(
    [...requestedUrls[0].searchParams],
    [
      ['after', '3'],
      ['archived', 'false'],
      ['tags[a b]', 'x&y'],
      ['tags[colour]', 'red'],
      ['filter', '{"size":{"max":2},"ids":[1,2]}'],
    ],
    'Expected one pair per single value and object member, and the JSON text of the JSON value',
  );
  const [decoded] = decodedRequests as {
    params: { shelfId: unknown };
    query: { after: unknown; archived: unknown; tags: unknown };
  }[];
  assertEqual(
    [decoded.params.shelfId, decoded.query.after, decoded.query.archived, decoded.query.tags],
    [7, 3, false, { 'a b': 'x&y', colour: 'red' }],
    'Expected the server to read back the values the client wrote',
  );
});

Deno.test('A text that writes no integer or boolean is a value of the wrong type', async () => {
  const { transport } = createItemServer();

  const response = await transport.fetch(
    'http://items.example/shelves/1e3/items?after=0x1&archived=yes&tags=red',
  );

  assertEqual(response.status, 400, 'Expected the request refused');
  assertEqual(
    (await response.json()).issues.map(({ source, path, code }: Record<string, unknown>) => ({
      source,
      path,
      code,
    })),
    [
      { source: 'path', path: ['shelfId'], code: 'invalid_type' },
      { source: 'query', path: ['after'], code: 'invalid_type' },
      { source: 'query', path: ['archived'], code: 'invalid_type' },
      { source: 'query', path: ['tags'], code: 'invalid_type' },
    ],
    'Expected each parameter whose text writes no value of its type reported',
  );
});

Deno.test('A __proto__ member is read and checked as any other member', async () => {
  const { transport, decodedRequests } = createItemServer();

  const accepted = await transport.fetch(
    'http://items.example/shelves/1/items?tags[__proto__]=red&filter=%7B%22__proto__%22%3A%5B%5D%7D',
  );
  const refused = await transport.fetch(
    'http://items.example/shelves/1/items?filter=%7B%22__proto__%22%3A%22red%22%7D',
  );

  assertEqual(accepted.status, 200, 'Expected __proto__ members of the right type accepted');
  const [decoded] = decodedRequests as { query: { tags: object; filter: object } }[];
  assertEqual(
    [
      Object.hasOwn(decoded.query.tags, '__proto__'),
      Object.hasOwn(decoded.query.filter, '__proto__'),
    ],
    [true, true],
    'Expected each __proto__ member kept as an own member',
  );
  assertEqual(refused.status, 400, 'Expected a __proto__ member of the wrong type refused');
  assertEqual(
    (await refused.json()).issues.map(({ path, code }: Record<string, unknown>) => ({
      path,
      code,
    })),
    [{ path: ['filter', '__proto__'], code: 'invalid_type' }],
    'Expected the member reported at its path',
  );
});

Deno.test('A parameter whose value no text writes cannot be registered', () => {
  const contract = defineControlOperation({
    operationId: 'readMeasure',
    method: 'GET',
    path: '/measures',
    query: z.strictObject({ ratio: z.number() }),
    success: { status: 204, body: { kind: 'empty' } },
    refusals: {},
  });

  let refusal: unknown;
  try {
    registerControlOperation(new Hono(), '', contract, () => ({ status: 204 }));
  } catch (error) {
    refusal = error;
  }

  if (!(refusal instanceof Error) || !refusal.message.includes('ratio')) {
    throw new Error(`Expected the registration refused for ratio, received ${refusal}`);
  }
});

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}
