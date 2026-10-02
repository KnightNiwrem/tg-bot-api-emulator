import type { Context } from 'hono';

import type { StoredFile } from '../../types/stored_file.ts';

/**
 * Serves a stored file's content with its media type: a document's, video's, or voice note's MIME
 * type, or the format an image was sent in.
 */
export function fileDownloadResponse(context: Context, file: StoredFile): Response {
  return context.body(file.content, 200, { 'Content-Type': getFileContentType(file) });
}

function getFileContentType(file: StoredFile): string {
  switch (file.type) {
    case 'document':
    case 'video':
    case 'voice':
      return file.mimeType;
    case 'photo':
    case 'thumbnail':
      return `image/${file.imageFormat}`;
    default: {
      const unhandledFile: never = file;
      throw new Error(`Unhandled stored file: ${JSON.stringify(unhandledFile)}`);
    }
  }
}
