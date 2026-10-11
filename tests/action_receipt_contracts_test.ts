/**
 * Where action receipts are declared and captured: on the success of exactly the control
 * operations that act, in the OpenAPI document and in the contracts, which refuse a receipt they
 * cannot give, and just before each route's action. Every documented response a test exercises is
 * checked against the document, so the document's declarations are what make each acting
 * operation's success carry its receipt.
 */
import { assertEquals, assertThrows } from '@std/assert';
import { Hono } from 'hono';
import { z } from 'zod';

import { ACTION_RECEIPT_SESSION_ID_HEADER } from '../src/api/contracts/action_receipts.ts';
import { defineControlOperation } from '../src/api/contracts/operation_contract.ts';
import { registerControlOperation } from '../src/api/control_operation_route.ts';
import { answerWithActionReceipt } from '../src/api/sessions/action_receipt.ts';
import type { SessionRouteContextTypes } from '../src/api/sessions/session_route_context_types.ts';
import type { EmulationSession } from '../src/session/emulation_session.ts';
import { readOpenApiDocument } from './support/openapi_conformance/openapi_document.ts';
import { buildSessionServices } from './support/session_services.ts';

const RECEIPT_HEADER_NAMES = ['action-receipt-session-id', 'action-receipt-activity-position'];

/** Ending a session leaves no log for a receipt to point into. */
const OPERATIONS_ACTING_WITHOUT_RECEIPT = new Set(['deleteSession']);

Deno.test('Exactly the control operations that act declare an action receipt', () => {
  const controlOperations = readOpenApiDocument().operations.filter(({ pathTemplate }) =>
    !pathTemplate.includes('/bot-api/')
  );
  const declarations = controlOperations.map(({ operationId, responses }) => {
    const successes = [...responses].filter(([status]) => status.startsWith('2'));
    const receiptHeaders = successes.flatMap(([, response]) =>
      RECEIPT_HEADER_NAMES.filter((name) => response.headers.get(name)?.required === true)
    );
    return { operationId, receiptHeaders };
  });

  assertEquals(
    declarations,
    controlOperations.map(({ operationId, method }) => ({
      operationId,
      receiptHeaders: method === 'get' || OPERATIONS_ACTING_WITHOUT_RECEIPT.has(operationId)
        ? []
        : RECEIPT_HEADER_NAMES,
    })),
    'Expected both receipt headers required on the success of each acting operation, and no other',
  );
});

const touchNoteContract = defineControlOperation({
  operationId: 'touchNote',
  method: 'POST',
  path: '/notes/{noteId}/touches',
  params: z.strictObject({ noteId: z.string() }),
  success: { status: 204, body: { kind: 'empty' }, actionReceipt: 'before_action' },
  refusals: {},
});

Deno.test('A contract refuses a receipt on a read, or receipt headers of its own', () => {
  assertThrows(
    () => defineControlOperation({ ...touchNoteContract, method: 'GET' }),
    Error,
    'answers with no action receipt',
  );
  // HTTP compares header names without regard to letter case.
  for (
    const name of [
      ACTION_RECEIPT_SESSION_ID_HEADER,
      'action-receipt-session-id',
      'ACTION-RECEIPT-ACTIVITY-POSITION',
      'Content-Type',
      'content-type',
    ]
  ) {
    assertThrows(
      () =>
        defineControlOperation({
          ...touchNoteContract,
          success: { ...touchNoteContract.success, headers: z.object({ [name]: z.string() }) },
        }),
      Error,
      'which its route writes',
      `Expected ${name} refused`,
    );
  }
  assertThrows(
    () =>
      defineControlOperation({
        ...touchNoteContract,
        success: {
          ...touchNoteContract.success,
          headers: z.object({ Location: z.string(), location: z.string() }),
        },
      }),
    Error,
    'header twice',
  );
});

Deno.test('A route outside a session cannot capture a receipt before its action', async () => {
  const routes = new Hono<SessionRouteContextTypes>();
  // No session middleware runs for these routes, as for the session collection's own.
  registerControlOperation(routes, '', touchNoteContract, () => ({ status: 204 }));
  const app = new Hono().route('/', routes);

  const response = await app.request('http://notes.example/notes/1/touches', { method: 'POST' });

  assertEquals(response.status, 500, 'Expected the route to fail rather than answer without one');
});

Deno.test('An entry an action records before it answers follows its receipt', async () => {
  const session = buildSessionServices({ id: 'receipts' });
  const routes = new Hono<SessionRouteContextTypes>();
  routes.use('*', (context, next) => {
    context.set('emulationSession', session);
    return next();
  });
  // Each action records a bot's call synchronously, as a held poll's delivery might be recorded
  // before the action's response is sent.
  registerControlOperation(routes, '', touchNoteContract, () => {
    recordCall(session);
    return { status: 204 };
  });
  routes.post(
    '/notes/:noteId/marks',
    (context) =>
      answerWithActionReceipt(context, (actionSession) => {
        recordCall(actionSession);
        return context.body(null, 204);
      }),
  );
  const app = new Hono().route('/', routes);

  try {
    const responses = [
      await app.request('http://notes.example/notes/1/touches', { method: 'POST' }),
      await app.request('http://notes.example/notes/1/marks', { method: 'POST' }),
    ];

    assertEquals(
      responses.map(({ headers }) => [
        headers.get('Action-Receipt-Session-Id'),
        headers.get('Action-Receipt-Activity-Position'),
      ]),
      [['receipts', '0'], ['receipts', '1']],
      'Expected each receipt to be the head before its action recorded its entry',
    );
  } finally {
    session.end();
  }
});

Deno.test("A route writes its own headers over a handler's, whatever their letter case", async () => {
  const session = buildSessionServices({ id: 'receipts' });
  const routes = new Hono<SessionRouteContextTypes>();
  routes.use('*', (context, next) => {
    context.set('emulationSession', session);
    return next();
  });
  // A contract that `defineControlOperation` would refuse, as a handler its types do not describe.
  const contract = {
    ...touchNoteContract,
    success: {
      status: 200,
      body: { kind: 'json', schema: z.strictObject({}) },
      headers: z.object({ 'action-receipt-session-id': z.string(), 'content-type': z.string() }),
      actionReceipt: 'before_action',
    },
  } as const;
  registerControlOperation(routes, '', contract, () => ({
    status: 200,
    headers: { 'action-receipt-session-id': 'forged', 'content-type': 'text/plain' },
    body: {},
  }));
  const app = new Hono().route('/', routes);

  try {
    const response = await app.request('http://notes.example/notes/1/touches', { method: 'POST' });
    await response.body?.cancel();

    assertEquals(
      [response.headers.get('Action-Receipt-Session-Id'), response.headers.get('Content-Type')],
      ['receipts', 'application/json'],
      "Expected the receipt and media type the route wrote, not joined to the handler's",
    );
  } finally {
    session.end();
  }
});

/** Records a call of a bot that does not exist, which the log takes as given. */
function recordCall(session: EmulationSession): void {
  session.botActivity.recordBotApiCall({
    botId: 1,
    method: 'getMe',
    requestedMethod: 'getMe',
    via: 'http',
    parameters: {},
    uploadedFiles: [],
    answer: { ok: true, result: true },
  });
}
