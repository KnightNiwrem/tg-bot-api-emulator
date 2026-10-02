import type { BotApiDocument, BotApiPhotoSize, BotApiVideo } from '../types/bot_api.ts';
import type { StoredFile, StoredThumbnailFile } from '../types/stored_file.ts';

/** A stored file with the `file_id` by which the observer of a projection knows it. */
export interface ObservedFile {
  readonly file: StoredFile;
  readonly observerFileId: string;
  /**
   * The `file_id` by which the observer knows a document's or video's thumbnail; omitted for other
   * files and for a document or video without a thumbnail.
   */
  readonly observerThumbnailFileId?: string;
}

/** Shows a photo in its one kept size; the observed file must be the message's photo. */
export function projectPhotoSize(contentFile: ObservedFile | undefined): BotApiPhotoSize {
  const file = contentFile?.file;
  if (contentFile === undefined || file?.type !== 'photo') {
    throw new Error('Expected the photo of the message to be provided');
  }
  return {
    file_id: contentFile.observerFileId,
    file_unique_id: file.uniqueId,
    file_size: file.content.length,
    width: file.width,
    height: file.height,
  };
}

/** Shows a document; the observed file must be the message's document. */
export function projectDocument(contentFile: ObservedFile | undefined): BotApiDocument {
  const file = contentFile?.file;
  if (contentFile === undefined || file?.type !== 'document') {
    throw new Error('Expected the document of the message to be provided');
  }
  return {
    file_name: file.fileName,
    mime_type: file.mimeType,
    ...projectThumbnail(file.thumbnail, contentFile.observerThumbnailFileId),
    file_id: contentFile.observerFileId,
    file_unique_id: file.uniqueId,
    file_size: file.content.length,
  };
}

/**
 * Shows a video, in the field order of the official Bot API server's `JsonVideo`, with the start
 * timestamp of the message that shows it, which only a timestamp past the beginning shows; the
 * observed file must be the message's video.
 */
export function projectVideo(
  contentFile: ObservedFile | undefined,
  startTimestampSeconds: number,
): BotApiVideo {
  const file = contentFile?.file;
  if (contentFile === undefined || file?.type !== 'video') {
    throw new Error('Expected the video of the message to be provided');
  }
  return {
    duration: file.durationSeconds,
    width: file.width,
    height: file.height,
    ...(file.fileName === undefined ? {} : { file_name: file.fileName }),
    mime_type: file.mimeType,
    ...(startTimestampSeconds > 0 ? { start_timestamp: startTimestampSeconds } : {}),
    ...projectThumbnail(file.thumbnail, contentFile.observerThumbnailFileId),
    file_id: contentFile.observerFileId,
    file_unique_id: file.uniqueId,
    file_size: file.content.length,
  };
}

/**
 * Shows a file's thumbnail both as `thumbnail` and as the legacy `thumb`, as the official Bot API
 * server's `json_store_thumbnail` does; nothing for a file without one.
 */
function projectThumbnail(
  thumbnail: StoredThumbnailFile | undefined,
  observerThumbnailFileId: string | undefined,
): Pick<BotApiDocument, 'thumbnail' | 'thumb'> {
  if (thumbnail === undefined) {
    return {};
  }
  if (observerThumbnailFileId === undefined) {
    throw new Error('Expected the thumbnail of the file to be provided');
  }
  const projectedThumbnail: BotApiPhotoSize = {
    file_id: observerThumbnailFileId,
    file_unique_id: thumbnail.uniqueId,
    file_size: thumbnail.content.length,
    width: thumbnail.width,
    height: thumbnail.height,
  };
  return { thumbnail: projectedThumbnail, thumb: projectedThumbnail };
}
