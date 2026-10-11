/**
 * The contract of a session's emulated web: what each URL serves, from which Telegram downloads
 * the files bots send by URL. The emulator never downloads them from the network.
 */
import { z } from 'zod';

import { controlRefusalSchema, controlValidationErrorSchema } from './control_errors.ts';
import { defineControlOperation } from './operation_contract.ts';
import { sessionNotFoundSchema } from './sessions.ts';
import { base64TextSchema, sessionIdParameterSchema } from './wire_fields.ts';

/** The lowest and highest HTTP status a resource can answer with. */
const MIN_WEB_RESOURCE_STATUS = 200;
const MAX_WEB_RESOURCE_STATUS = 599;

/** An HTTP status a resource answers with. */
const webResourceStatusSchema = z.int().min(MIN_WEB_RESOURCE_STATUS).max(MAX_WEB_RESOURCE_STATUS);

/**
 * An HTTP or HTTPS URL that may hold characters outside ASCII, as the canonical form TDLib reads a
 * URL in keeps them.
 */
const httpIriSchema = z.stringFormat('iri', (text) => {
  if (!URL.canParse(text)) return false;
  const { protocol } = new URL(text);
  return protocol === 'http:' || protocol === 'https:';
});

/**
 * What a URL of the session's emulated web serves. The server also refuses a URL TDLib would not
 * read, or one an HTTP request cannot carry, as `url_invalid`; a header value an HTTP response
 * cannot carry, such as one with a line break, as `header_invalid`; and a `content_type` that is
 * not a well-formed `Content-Type` naming one media type as `content_type_invalid`.
 */
const registerWebResourceRequestSchema = z.strictObject({
  /** An HTTP or HTTPS URL, matched as Telegram reads the URL a bot sends. */
  url: z.string().min(1),
  /** The HTTP status, from 200 to 599. Defaults to 200. */
  status: webResourceStatusSchema.default(200),
  /**
   * The `Content-Type` header. Telegram sends a URL photo served as an image, and a URL document
   * served as `application/pdf` or `application/zip`.
   */
  content_type: z.string().min(1).optional(),
  /** The `Location` header of a redirect, relative to `url` or absolute. */
  location: z.string().min(1).optional(),
  /** The response body, as base64 text. Defaults to none. */
  content_base64: base64TextSchema.default(''),
});

/** A registered web resource, without the content the test supplied. */
const webResourceSchema = z.strictObject({
  /** The URL in the canonical form Telegram reads it in. */
  url: httpIriSchema,
  status: webResourceStatusSchema,
  content_type: z.string().min(1).optional(),
  location: z.string().min(1).optional(),
  /** The size of the registered body in bytes. */
  content_length: z.int().min(0),
});

/** Registers what a URL serves, replacing what it served before. */
export const registerWebResourceContract = defineControlOperation({
  operationId: 'registerWebResource',
  method: 'POST',
  path: '/sessions/{sessionId}/web-resources',
  params: z.strictObject({ sessionId: sessionIdParameterSchema }),
  body: { required: true, schema: registerWebResourceRequestSchema },
  success: { status: 201, body: { kind: 'json', schema: webResourceSchema } },
  refusals: {
    // A resource the schema accepts can still break a rule the server checks.
    400: z.union([
      controlValidationErrorSchema,
      controlRefusalSchema([
        'content_type_invalid',
        'header_invalid',
        'status_invalid',
        'url_invalid',
      ]),
    ]),
    404: sessionNotFoundSchema,
  },
});
