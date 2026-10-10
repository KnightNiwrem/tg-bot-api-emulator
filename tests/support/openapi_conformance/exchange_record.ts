/**
 * What the OpenAPI conformance check finds about one HTTP exchange. Records are JSON, so that a
 * coverage run can collect them from every test module and report on them together.
 */
import { z } from 'zod';

import { DOCUMENTED_HTTP_METHODS } from './openapi_document.ts';

/**
 * The two halves of the document: the control API that tests drive, and the Bot API that bots
 * call under each session's `bot-api` root.
 */
const apiSurfaceSchema = z.enum(['control', 'bot-api']);
export type ApiSurface = z.infer<typeof apiSurfaceSchema>;

const BOT_API_PATH_PREFIX = '/sessions/{sessionId}/bot-api/';

/** The half of the document a listed path belongs to. */
export function apiSurfaceOf(pathTemplate: string): ApiSurface {
  return pathTemplate.startsWith(BOT_API_PATH_PREFIX) ? 'bot-api' : 'control';
}

const requestClassificationSchema = z.discriminatedUnion('validity', [
  z.strictObject({ validity: z.literal('valid') }),
  z.strictObject({ validity: z.literal('invalid'), reasons: z.array(z.string()).min(1) }),
  /** The document's description cannot decide whether the request is valid. */
  z.strictObject({ validity: z.literal('unclassified'), reason: z.string() }),
]);
export type RequestClassification = z.infer<typeof requestClassificationSchema>;

const exchangeRouteSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('documented'),
    surface: apiSurfaceSchema,
    operationId: z.string(),
    method: z.enum(DOCUMENTED_HTTP_METHODS),
    pathTemplate: z.string(),
    /** The `responses` entry that describes the status, if any. */
    statusKey: z.string().optional(),
    requestClassification: requestClassificationSchema,
  }),
  z.strictObject({ kind: z.literal('allowed-undocumented'), allowanceReason: z.string() }),
  z.strictObject({ kind: z.literal('undocumented') }),
]);
export const exchangeRecordSchema = z.strictObject({
  request: z.strictObject({
    method: z.string(),
    path: z.string(),
    /** The query string, with its leading `?`, or empty. */
    query: z.string(),
  }),
  status: z.int(),
  route: exchangeRouteSchema,
  /** Each way the exchange departs from the document; empty when it conforms. */
  violations: z.array(z.string()),
});
export type ExchangeRecord = z.infer<typeof exchangeRecordSchema>;
