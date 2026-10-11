/** The contract of reading the files of a session's messages. */
import { z } from 'zod';

import { controlRefusalSchema } from './control_errors.ts';
import { defineControlOperation } from './operation_contract.ts';
import { sessionIdParameterSchema } from './wire_fields.ts';

/**
 * The `file_unique_id` of a file of the session's messages, which, unlike `file_id`, is the same for
 * every user; it can neither send nor, through the Bot API, download the file.
 */
const fileUniqueIdSchema = z.string().min(1);

/**
 * The content of a file of the session's messages, such as a photo, document, video, voice note,
 * audio file, or thumbnail, as it was sent: in its document's, video's, voice note's, or audio
 * file's MIME type, or the image type its photo or thumbnail was sent in.
 */
export const downloadFileContract = defineControlOperation({
  operationId: 'downloadFile',
  method: 'GET',
  path: '/sessions/{sessionId}/files/{fileUniqueId}',
  params: z.strictObject({
    sessionId: sessionIdParameterSchema,
    fileUniqueId: fileUniqueIdSchema,
  }),
  success: { status: 200, body: { kind: 'bytes', mediaTypeRange: '*/*' } },
  refusals: { 404: controlRefusalSchema(['file_not_found', 'session_not_found']) },
});
