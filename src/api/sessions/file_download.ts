import type { Context } from 'hono';

import { STICKER_MIME_TYPE, type StoredFile } from '../../types/stored_file.ts';

/**
 * Serves a stored file's content with its media type: a document's, video's, voice note's, or audio
 * file's MIME type, the format an image was sent in, or WebP for a sticker.
 */
export function fileDownloadResponse(context: Context, file: StoredFile): Response {
  return context.body(file.content, 200, { 'Content-Type': getFileContentType(file) });
}

/** The media type a stored file is served in, as `fileDownloadResponse` serves it. */
export function getFileContentType(file: StoredFile): string {
  switch (file.type) {
    case 'document':
    case 'video':
    case 'voice':
    case 'audio':
      return file.mimeType;
    case 'photo':
    case 'thumbnail':
      return `image/${file.imageFormat}`;
    case 'sticker':
      return STICKER_MIME_TYPE;
    default: {
      const unhandledFile: never = file;
      throw new Error(`Unhandled stored file: ${JSON.stringify(unhandledFile)}`);
    }
  }
}
