import type { HonoRequest } from 'hono';
import type { z } from 'zod';

interface JsonRequestBodyOptions {
  /** Reads an empty body as an empty object, for a route whose settings all have defaults. */
  readonly allowsEmptyBody?: boolean;
}

/**
 * Reads a request's JSON body as the schema describes it. Returns `undefined` for a body that is
 * not JSON or that the schema rejects, which the emulator's own routes answer with status 400.
 */
export async function readJsonRequestBody<Schema extends z.ZodType<object>>(
  request: HonoRequest,
  schema: Schema,
  { allowsEmptyBody = false }: JsonRequestBodyOptions = {},
): Promise<z.output<Schema> | undefined> {
  const body = await request.text();
  let requestBody: unknown = {};
  if (body.length > 0 || !allowsEmptyBody) {
    try {
      requestBody = JSON.parse(body);
    } catch {
      return undefined;
    }
  }
  const parsedRequestBody = schema.safeParse(requestBody);
  return parsedRequestBody.success ? parsedRequestBody.data : undefined;
}
