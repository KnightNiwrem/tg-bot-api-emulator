import { Hono } from 'hono';

import { downloadFileContract } from '../../contracts/files.ts';
import { registerControlOperation } from '../../control_operation_route.ts';
import { getFileContentType } from '../file_download.ts';
import type { SessionRouteContextTypes } from '../session_route_context_types.ts';

/** Where the file routes are mounted within the server, as a contract path template. */
const FILE_COLLECTION_MOUNT_PATH = '/sessions/{sessionId}/files';

/**
 * Routes that let tests read the files of a session's messages by `file_unique_id`, which, unlike
 * `file_id`, is the same for every user.
 */
export function createFileRoutes(): Hono<SessionRouteContextTypes> {
  const fileRoutes = new Hono<SessionRouteContextTypes>();

  registerControlOperation(
    fileRoutes,
    FILE_COLLECTION_MOUNT_PATH,
    downloadFileContract,
    ({ params }, context) => {
      const file = context.get('emulationSession').mediaFiles.findFileByUniqueId(
        params.fileUniqueId,
      );
      return file === undefined
        ? { status: 404, body: { reason: 'file_not_found' } }
        : { status: 200, body: file.content, mediaType: getFileContentType(file) };
    },
  );

  return fileRoutes;
}
