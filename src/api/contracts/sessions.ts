/** The contracts of the session resource: creating and ending isolated test sessions. */
import { z } from 'zod';

import { controlRefusalSchema, controlValidationErrorSchema } from './control_errors.ts';
import { defineControlOperation } from './operation_contract.ts';
import { createdResourceHeadersSchema, sessionIdParameterSchema } from './wire_fields.ts';

/**
 * The deployment of the official Bot API server whose upload limits a session's bots meet:
 * `cloud` for the server Telegram hosts at `api.telegram.org`, `local` for a self-hosted server
 * started with `--local`. The profile changes only upload limits; every other behavior stays that
 * of the cloud server.
 */
export const uploadProfileSchema = z.enum(['cloud', 'local']);

/** Settings of a new session, which stay fixed for its lifetime. */
const createSessionRequestSchema = z.strictObject({
  /** Defaults to `cloud`. */
  upload_profile: uploadProfileSchema.default('cloud'),
});

/** The server-assigned identity, Bot API location, and settings of an emulation session. */
const sessionSchema = z.strictObject({
  id: z.uuid(),
  /** The absolute API root for the session's bots. */
  botApiRoot: z.url(),
  uploadProfile: uploadProfileSchema,
});

/** The refusal of a request under a session that does not exist or has ended. */
export const sessionNotFoundSchema = controlRefusalSchema(['session_not_found']);

export const createSessionContract = defineControlOperation({
  operationId: 'createSession',
  method: 'POST',
  path: '/sessions',
  body: { required: false, schema: createSessionRequestSchema },
  success: {
    status: 201,
    headers: createdResourceHeadersSchema,
    body: { kind: 'json', schema: sessionSchema },
    actionReceipt: 'session_creation',
  },
  refusals: { 400: controlValidationErrorSchema },
});

export const deleteSessionContract = defineControlOperation({
  operationId: 'deleteSession',
  method: 'DELETE',
  path: '/sessions/{sessionId}',
  params: z.strictObject({ sessionId: sessionIdParameterSchema }),
  success: { status: 204, body: { kind: 'empty' } },
  refusals: { 404: sessionNotFoundSchema },
});
