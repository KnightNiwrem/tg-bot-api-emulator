/**
 * The OpenAPI conformance check that test APIs run every exchange through: what it accepts, what
 * it rejects, and what it records. A fixture document keeps these cases independent of the
 * repository's own document, which the last test covers.
 */
import { Hono } from 'hono';

import {
  OpenApiConformanceError,
  withOpenApiConformanceCheck,
} from './support/openapi_conformance/conformance_middleware.ts';
import { OpenApiConformanceChecker } from './support/openapi_conformance/exchange_conformance.ts';
import type { ExchangeRecord } from './support/openapi_conformance/exchange_record.ts';
import { JsonSchemaValidator } from './support/openapi_conformance/json_schema_validator.ts';
import { readOpenApiDocument } from './support/openapi_conformance/openapi_document.ts';

const FIXTURE_DOCUMENT_URL = new URL(
  './fixtures/openapi_conformance/openapi.yaml',
  import.meta.url,
);
const WIDGETS_PATH = '/sessions/s1/widgets';
const BOT_API_PATH = '/sessions/s1/bot-api/bot1:secret';

/** An API answering with `defineRoutes`' routes, checked against the fixture document. */
function createCheckedFixtureApi(defineRoutes: (api: Hono) => void) {
  const api = new Hono();
  defineRoutes(api);
  const records: ExchangeRecord[] = [];
  const checkedApi = withOpenApiConformanceCheck(api, {
    checker: new OpenApiConformanceChecker(readOpenApiDocument(FIXTURE_DOCUMENT_URL)),
    recordExchange: (record) => records.push(record),
  });
  return { checkedApi, records };
}

function postJson(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

async function expectConformanceError(
  response: Response | Promise<Response>,
  expectedViolation: string,
): Promise<void> {
  try {
    await response;
  } catch (error) {
    if (!(error instanceof OpenApiConformanceError)) throw error;
    if (!error.record.violations.some((violation) => violation.includes(expectedViolation))) {
      throw new Error(
        `Expected a violation naming "${expectedViolation}", received ${
          JSON.stringify(error.record.violations)
        }`,
      );
    }
    return;
  }
  throw new Error(`Expected the check to reject the exchange for "${expectedViolation}"`);
}

function expectSingleRecord(records: readonly ExchangeRecord[]): ExchangeRecord {
  if (records.length !== 1) throw new Error(`Expected one record, received ${records.length}`);
  return records[0];
}

Deno.test('the conformance check passes a documented response and records its operation and status', async () => {
  const { checkedApi, records } = createCheckedFixtureApi((api) => {
    api.post(
      WIDGETS_PATH,
      (context) => context.json({ name: 'cog' }, 201, { Location: `${WIDGETS_PATH}/1` }),
    );
  });

  const response = await checkedApi.request(WIDGETS_PATH, postJson({ name: 'cog' }));

  if (response.status !== 201 || (await response.json()).name !== 'cog') {
    throw new Error('Expected the response to reach the test unchanged');
  }
  const { route, violations } = expectSingleRecord(records);
  if (
    route.kind !== 'documented' || route.operationId !== 'createWidget' ||
    route.surface !== 'control' || route.statusKey !== '201' ||
    route.requestClassification.validity !== 'valid' || violations.length !== 0
  ) {
    throw new Error(`Expected a conforming createWidget record, received ${JSON.stringify(route)}`);
  }
});

Deno.test('the conformance check rejects a status its operation does not document', async () => {
  const { checkedApi } = createCheckedFixtureApi((api) => {
    api.post(WIDGETS_PATH, (context) => context.body(null, 409));
  });

  await expectConformanceError(
    checkedApi.request(WIDGETS_PATH, postJson({ name: 'cog' })),
    'status 409 is not documented',
  );
});

Deno.test('the conformance check rejects a JSON body its schema does not allow', async () => {
  const { checkedApi } = createCheckedFixtureApi((api) => {
    api.post(
      WIDGETS_PATH,
      (context) =>
        context.json({ name: 'cog', colour: 'red' }, 201, { Location: `${WIDGETS_PATH}/1` }),
    );
  });

  await expectConformanceError(
    checkedApi.request(WIDGETS_PATH, postJson({ name: 'cog' })),
    'must NOT have additional properties',
  );
});

Deno.test('the conformance check rejects a body that is not JSON where JSON is documented', async () => {
  const { checkedApi } = createCheckedFixtureApi((api) => {
    api.post(WIDGETS_PATH, (context) =>
      context.body('{"name":', 201, {
        'Content-Type': 'application/json',
        Location: `${WIDGETS_PATH}/1`,
      }));
  });

  await expectConformanceError(
    checkedApi.request(WIDGETS_PATH, postJson({ name: 'cog' })),
    'body is not JSON',
  );
});

Deno.test('the conformance check counts string lengths in code points, as JSON Schema does', async () => {
  const { checkedApi } = createCheckedFixtureApi((api) => {
    api.post(
      WIDGETS_PATH,
      async (context) =>
        context.json(await context.req.json(), 201, { Location: `${WIDGETS_PATH}/1` }),
    );
  });

  // Three astral characters are three code points, but six UTF-16 code units.
  await checkedApi.request(WIDGETS_PATH, postJson({ name: '😀😀😀' }));
  await expectConformanceError(
    checkedApi.request(WIDGETS_PATH, postJson({ name: '😀😀😀😀' })),
    'must NOT have more than 3 characters',
  );
});

Deno.test('the conformance check rejects a missing or malformed required header', async () => {
  const { checkedApi } = createCheckedFixtureApi((api) => {
    api.post(WIDGETS_PATH, (context) => context.json({ name: 'cog' }, 201));
    api.post(
      `${BOT_API_PATH}/getMe`,
      (context) => context.json({ ok: false }, 429, { 'Retry-After': '0' }),
    );
  });

  await expectConformanceError(
    checkedApi.request(WIDGETS_PATH, postJson({ name: 'cog' })),
    'the required location header is missing',
  );
  await expectConformanceError(
    checkedApi.request(`${BOT_API_PATH}/getMe`, { method: 'POST' }),
    'the retry-after header "0"',
  );
});

Deno.test('the conformance check holds empty responses to having no body, and others to having one', async () => {
  const { checkedApi } = createCheckedFixtureApi((api) => {
    api.delete(`${WIDGETS_PATH}/1`, (context) => context.body(null, 204));
    api.delete(`${WIDGETS_PATH}/2`, (context) => context.text('gone', 404));
    api.post(WIDGETS_PATH, (context) => context.body(null, 201, { Location: `${WIDGETS_PATH}/3` }));
  });

  await checkedApi.request(`${WIDGETS_PATH}/1`, { method: 'DELETE' });
  await expectConformanceError(
    checkedApi.request(`${WIDGETS_PATH}/2`, { method: 'DELETE' }),
    'documents no body, but has 4 bytes',
  );
  await expectConformanceError(
    checkedApi.request(WIDGETS_PATH, postJson({ name: 'cog' })),
    'documents a body, but has none',
  );
});

Deno.test('the conformance check matches media types against the ranges a response lists', async () => {
  const { checkedApi } = createCheckedFixtureApi((api) => {
    api.get(
      '/sessions/s1/files/photo',
      (context) =>
        context.body(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), 200, {
          'Content-Type': 'image/png',
        }),
    );
    api.get(WIDGETS_PATH, (context) => context.text('[]', 200));
  });

  const download = await checkedApi.request('/sessions/s1/files/photo');
  if ((await download.bytes()).length !== 4) {
    throw new Error('Expected the binary body to reach the test unchanged');
  }
  await expectConformanceError(
    checkedApi.request(WIDGETS_PATH),
    'the Content-Type text/plain; charset=UTF-8 is not documented',
  );
});

Deno.test('the conformance check records invalid requests without failing them', async () => {
  const { checkedApi, records } = createCheckedFixtureApi((api) => {
    api.get(WIDGETS_PATH, (context) => context.body(null, 400));
    api.post(WIDGETS_PATH, (context) => context.body(null, 400));
    api.delete(`${WIDGETS_PATH}/:widgetId`, (context) => context.body(null, 404));
  });
  const invalidRequests: readonly [string, RequestInit | undefined, string][] = [
    [`${WIDGETS_PATH}?limit=1&limit=2`, undefined, 'the query parameter limit is repeated'],
    [`${WIDGETS_PATH}?limit=-1`, undefined, 'the query parameter limit: the value must be >= 0'],
    [`${WIDGETS_PATH}?colour=red`, undefined, 'the query parameter colour is not documented'],
    [
      `${WIDGETS_PATH}?labels[size]=s&labels[size]=m`,
      undefined,
      'the query parameter labels[size] is repeated',
    ],
    [WIDGETS_PATH, { method: 'POST' }, 'the required request body is missing'],
    [WIDGETS_PATH, postJson({ name: '' }), 'the request body: /name must NOT have fewer than 1'],
    [
      `${WIDGETS_PATH}/0`,
      { method: 'DELETE' },
      'the path parameter widgetId: the value must be >= 1',
    ],
  ];

  for (const [path, init] of invalidRequests) await checkedApi.request(path, init);

  for (const [index, [path, , expectedReason]] of invalidRequests.entries()) {
    const { route } = records[index];
    if (
      route.kind !== 'documented' || route.requestClassification.validity !== 'invalid' ||
      !route.requestClassification.reasons.some((reason) => reason.includes(expectedReason))
    ) {
      throw new Error(`Expected ${path} to be recorded as invalid: ${JSON.stringify(route)}`);
    }
  }
});

Deno.test('the conformance check reads form and deepObject query parameters by their schemas', async () => {
  const { checkedApi, records } = createCheckedFixtureApi((api) => {
    api.get(WIDGETS_PATH, (context) => context.json([{ name: 'cog' }]));
  });

  await checkedApi.request(`${WIDGETS_PATH}?limit=10&labels[size]=s&labels[colour]=red`);

  const { route } = expectSingleRecord(records);
  if (route.kind !== 'documented' || route.requestClassification.validity !== 'valid') {
    throw new Error(`Expected the query to be recorded as valid: ${JSON.stringify(route)}`);
  }
});

Deno.test('the conformance check rejects undocumented routes, except those tests call on purpose', async () => {
  const { checkedApi, records } = createCheckedFixtureApi((api) => {
    api.all('*', (context) => context.json({ ok: false, error_code: 404 }, 404));
  });

  await expectConformanceError(
    checkedApi.request('/sessions/s1/gadgets'),
    'the document lists no path that matches the request',
  );
  await expectConformanceError(
    checkedApi.request(WIDGETS_PATH, { method: 'PUT' }),
    'the document describes no PUT operation on /sessions/{sessionId}/widgets',
  );
  await checkedApi.request(`${BOT_API_PATH}/sendDice`, { method: 'POST' });
  await checkedApi.request('/sessions/s1/bot-api/getMe');

  const allowed = records.filter((record) => record.route.kind === 'allowed-undocumented');
  if (allowed.length !== 2) {
    throw new Error(`Expected two allowed undocumented requests, received ${allowed.length}`);
  }
});

Deno.test("Bot API method paths match by GET, without regard to case, and by Telegram's older names", async () => {
  const { checkedApi, records } = createCheckedFixtureApi((api) => {
    api.on(['GET', 'POST'], `${BOT_API_PATH}/:method`, (context) => context.json({ ok: true }));
  });

  await checkedApi.request(`${BOT_API_PATH}/GETME`);
  await checkedApi.request(`${BOT_API_PATH}/kickChatMember`, { method: 'POST' });

  const operationIds = records.map(({ route }) =>
    route.kind === 'documented' ? route.operationId : route.kind
  );
  if (operationIds.join() !== 'getMe,banChatMember') {
    throw new Error(`Expected getMe and banChatMember, received ${operationIds.join()}`);
  }
});

Deno.test('requests reach the checked API in the order they are sent', async () => {
  const handledRequests: string[] = [];
  const { checkedApi } = createCheckedFixtureApi((api) => {
    api.post(WIDGETS_PATH, (context) => {
      handledRequests.push('create');
      return context.json({ name: 'cog' }, 201, { Location: `${WIDGETS_PATH}/1` });
    });
    api.delete(`${WIDGETS_PATH}/1`, (context) => {
      handledRequests.push('delete');
      return context.body(null, 204);
    });
  });

  // A request with a large body is sent first; its body must not delay it behind the second.
  await Promise.all([
    checkedApi.request(WIDGETS_PATH, postJson({ name: 'cog', padding: 'x'.repeat(1_000_000) })),
    checkedApi.request(`${WIDGETS_PATH}/1`, { method: 'DELETE' }),
  ]);

  if (handledRequests.join() !== 'create,delete') {
    throw new Error(`Expected create, then delete, received ${handledRequests.join()}`);
  }
});

Deno.test('every schema in openapi/openapi.yaml compiles with unknown keywords rejected', () => {
  const document = readOpenApiDocument();
  const validator = new JsonSchemaValidator(document.schemaFiles);
  for (const operation of document.operations) {
    const schemas = [
      ...operation.parameters.map((parameter) => parameter.schema),
      ...[...operation.requestBody?.content.values() ?? []].map((mediaType) => mediaType.schema),
      ...[...operation.responses.values()].flatMap((response) => [
        ...[...response.headers.values()].map((header) => header.schema),
        ...[...response.content.values()].map((mediaType) => mediaType.schema),
      ]),
    ];
    for (const schema of schemas) {
      if (schema !== undefined) validator.findViolations(schema, null);
    }
  }
});
