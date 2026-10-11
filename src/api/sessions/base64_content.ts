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
