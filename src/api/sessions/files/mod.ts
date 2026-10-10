import { Hono } from 'hono';

import { controlErrorResponse } from '../../control_error_response.ts';
import { fileDownloadResponse } from '../file_download.ts';
import type { SessionRouteContextTypes } from '../session_route_context_types.ts';

const FILE_UNIQUE_ID_PARAMETER = 'fileUniqueId';

/**
 * Routes that let tests read the files of a session's messages by `file_unique_id`, which, unlike
 * `file_id`, is the same for every user.
 */
export function createFileRoutes(): Hono<SessionRouteContextTypes> {
  const fileRoutes = new Hono<SessionRouteContextTypes>();

  fileRoutes.get(`/:${FILE_UNIQUE_ID_PARAMETER}`, (context) => {
    const file = context.get('emulationSession').mediaFiles.findFileByUniqueId(
      context.req.param(FILE_UNIQUE_ID_PARAMETER),
    );
    return file === undefined
      ? controlErrorResponse(context, 404, 'file_not_found')
      : fileDownloadResponse(context, file);
  });

  return fileRoutes;
}
