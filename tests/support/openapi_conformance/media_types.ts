/**
 * Reads HTTP message bodies by media type, matching a `Content-Type` against the media types and
 * ranges a document lists.
 */
import type { DocumentedMediaType } from './openapi_document.ts';

/** The media type a `Content-Type` value names, lowercased and without parameters. */
export function mediaTypeEssence(contentType: string): string {
  return contentType.split(';', 1)[0].trim().toLowerCase();
}

/** Whether a body of `mediaType` is JSON text, as `application/json` and `+json` types are. */
export function isJsonMediaType(mediaType: string): boolean {
  return mediaType === 'application/json' || mediaType.endsWith('+json');
}

/**
 * The listed entry that describes `mediaType`, preferring an exact media type to a `type/*` range,
 * and that to `*\/*`, as OpenAPI prescribes.
 */
export function findDocumentedMediaType(
  documented: ReadonlyMap<string, DocumentedMediaType>,
  mediaType: string,
): { readonly key: string; readonly mediaType: DocumentedMediaType } | undefined {
  const [type] = mediaType.split('/', 1);
  for (const key of [mediaType, `${type}/*`, '*/*']) {
    const documentedMediaType = documented.get(key);
    if (documentedMediaType !== undefined) return { key, mediaType: documentedMediaType };
  }
  return undefined;
}

export type JsonBodyParsing =
  | { readonly parsed: true; readonly value: unknown }
  | { readonly parsed: false; readonly reason: string };

/** Parses `body` as UTF-8 JSON text. */
export function parseJsonBody(body: Uint8Array): JsonBodyParsing {
  try {
    return {
      parsed: true,
      value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)),
    };
  } catch (error) {
    return { parsed: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
