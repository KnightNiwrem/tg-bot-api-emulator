import { z } from 'zod';

/** File content that an emulation API request carries as base64 text, decoded to its bytes. */
export const base64ContentSchema = z.string().transform((base64Text, context) => {
  try {
    return Uint8Array.fromBase64(base64Text);
  } catch {
    context.issues.push({ code: 'custom', message: 'Expected base64 text', input: base64Text });
    return z.NEVER;
  }
});
