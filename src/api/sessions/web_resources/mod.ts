import { Hono } from 'hono';
import { z } from 'zod';

import type { WebResource } from '../../../types/web_resource.ts';
import { base64ContentSchema } from '../base64_content.ts';
import { readJsonRequestBody } from '../json_request_body.ts';
import type { SessionRouteContextTypes } from '../session_route_context_types.ts';

const registerWebResourceRequestSchema = z.strictObject({
  url: z.string().min(1),
  status: z.int().min(200).max(599).default(200),
  content_type: z.string().min(1).optional(),
  /** The redirect target of a 3xx response, relative to `url` or absolute. */
  location: z.string().min(1).optional(),
  content_base64: base64ContentSchema.default(() => new Uint8Array()),
});

/**
 * Routes that let tests register what the session's emulated web serves, from which Telegram
 * downloads the files bots send by URL.
 */
export function createWebResourceRoutes(): Hono<SessionRouteContextTypes> {
  const webResourceRoutes = new Hono<SessionRouteContextTypes>();

  webResourceRoutes.post('/', async (context) => {
    const requestBody = await readJsonRequestBody(context.req, registerWebResourceRequestSchema);
    if (requestBody === undefined) {
      return context.body(null, 400);
    }
    const { url, status, content_type: contentType, location, content_base64: content } =
      requestBody;
    const result = context.get('emulationSession').webResources.registerWebResource({
      url,
      status,
      ...(contentType === undefined ? {} : { contentType }),
      ...(location === undefined ? {} : { location }),
      content,
    });
    return result.registered
      ? context.json(viewWebResource(result.resource), 201)
      : context.body(null, 400);
  });

  return webResourceRoutes;
}

/** Shows a registered resource without its content, which the test supplied. */
function viewWebResource({ url, status, contentType, location, content }: WebResource) {
  return {
    url,
    status,
    ...(contentType === undefined ? {} : { content_type: contentType }),
    ...(location === undefined ? {} : { location }),
    content_length: content.length,
  };
}
