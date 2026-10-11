import { Hono } from 'hono';

import { INVALID_REQUEST_REASON } from '../../contracts/control_errors.ts';
import { registerWebResourceContract } from '../../contracts/web_resources.ts';
import type { WebResource } from '../../../types/web_resource.ts';
import { registerControlOperation } from '../../control_operation_route.ts';
import { decodeBase64Content } from '../base64_content.ts';
import type { SessionRouteContextTypes } from '../session_route_context_types.ts';

/** Where the web resource routes are mounted within the server, as a contract path template. */
const WEB_RESOURCE_COLLECTION_MOUNT_PATH = '/sessions/{sessionId}/web-resources';

/**
 * Routes that let tests register what the session's emulated web serves, from which Telegram
 * downloads the files bots send by URL.
 */
export function createWebResourceRoutes(): Hono<SessionRouteContextTypes> {
  const webResourceRoutes = new Hono<SessionRouteContextTypes>();

  registerControlOperation(
    webResourceRoutes,
    WEB_RESOURCE_COLLECTION_MOUNT_PATH,
    registerWebResourceContract,
    ({ body }, context) => {
      const content = decodeBase64Content(body.content_base64);
      if (content === undefined) {
        return {
          status: 400,
          body: {
            reason: INVALID_REQUEST_REASON,
            issues: [{
              source: 'body',
              path: ['content_base64'],
              code: 'invalid_value',
              message: 'Expected base64 text',
            }],
          },
        };
      }
      const result = context.get('emulationSession').webResources.registerWebResource({
        url: body.url,
        status: body.status,
        ...(body.content_type === undefined ? {} : { contentType: body.content_type }),
        ...(body.location === undefined ? {} : { location: body.location }),
        content,
      });
      return result.registered
        ? { status: 201, body: viewWebResource(result.resource) }
        : { status: 400, body: { reason: result.reason } };
    },
  );

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
