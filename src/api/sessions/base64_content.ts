import { z } from 'zod';

/**
 * Decodes file content that an emulation API request carries as base64 text, or `undefined` for
 * text that is not base64.
 */
export function decodeBase64Content(base64Text: string): Uint8Array<ArrayBuffer> | undefined {
  try {
    return Uint8Array.fromBase64(base64Text);
  } catch {
    return undefined;
  }
}

/** File content that an emulation API request carries as base64 text, decoded to its bytes. */
export const base64ContentSchema = z.string().transform((base64Text, context) => {
  const content = decodeBase64Content(base64Text);
  if (content === undefined) {
    context.issues.push({ code: 'custom', message: 'Expected base64 text', input: base64Text });
    return z.NEVER;
  }
  return content;
});
