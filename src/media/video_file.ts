import { getDocumentMimeType } from './document_file.ts';

/** The MIME type TDLib uploads a video under when its file name names no video type. */
const DEFAULT_VIDEO_MIME_TYPE = 'video/mp4';

/**
 * Returns the MIME type Telegram gives an uploaded video, as TDLib's `VideosManager::get_input_media`
 * chooses it: the type the file name's extension decides, as for a document, when it is a `video/`
 * type, and otherwise `video/mp4`. A video without a file name is `video/mp4`.
 */
export function getVideoMimeType(fileName: string | undefined): string {
  const mimeType = fileName === undefined ? undefined : getDocumentMimeType(fileName);
  return mimeType?.startsWith('video/') ? mimeType : DEFAULT_VIDEO_MIME_TYPE;
}
