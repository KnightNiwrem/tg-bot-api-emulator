import type { HonoRequest } from 'hono';
import type { z } from 'zod';

import {
  type ControlRequestInputReading,
  readControlRequestInput,
} from './control_request_input.ts';

interface JsonRequestBodyOptions {
  /** Reads an empty body as an empty object, for a route whose settings all have defaults. */
  readonly allowsEmptyBody?: boolean;
}

/**
 * Reads a request's JSON body as the schema describes it. A body that is not JSON is reported as
 * one `invalid_json` issue, and one the schema rejects as the issues it has.
 */
export async function readJsonRequestBody<Schema extends z.ZodType<object>>(
  request: HonoRequest,
  schema: Schema,
  { allowsEmptyBody = false }: JsonRequestBodyOptions = {},
): Promise<ControlRequestInputReading<z.output<Schema>>> {
  const body = await request.text();
  let requestBody: unknown = {};
  if (body.length > 0 || !allowsEmptyBody) {
    try {
      requestBody = JSON.parse(body);
    } catch {
      return {
        valid: false,
        issues: [{
          source: 'body',
          path: [],
          code: 'invalid_json',
          message: 'The body is not JSON',
        }],
      };
    }
  }
  return readControlRequestInput(schema, requestBody, 'body');
}
