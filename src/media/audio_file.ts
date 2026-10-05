import { getDocumentMimeType, getFileNameExtension } from './document_file.ts';

/** The MIME type TDLib uploads an audio file under when its file name names no audio type. */
const DEFAULT_AUDIO_MIME_TYPE = 'audio/mpeg';

/** The extension TDLib's `FileManager::get_file_name` gives an audio file by default. */
const DEFAULT_AUDIO_FILE_EXTENSION = 'mp3';

/**
 * The extensions TDLib's `FileManager::get_file_name` keeps for an audio file, compared exactly as
 * it compares them.
 */
const KEPT_AUDIO_FILE_EXTENSIONS: ReadonlySet<string> = new Set([
  'ogg',
  'oga',
  'mp3',
  'mpeg3',
  'm4a',
]);

/**
 * Returns the MIME type Telegram gives an uploaded audio file, as TDLib's
 * `AudiosManager::get_input_media` chooses it: the type the file name's extension decides, as for a
 * document, when it is an `audio/` type, and otherwise `audio/mpeg`. An audio file without a file
 * name is `audio/mpeg`.
 */
export function getAudioMimeType(fileName: string | undefined): string {
  const mimeType = fileName === undefined ? undefined : getDocumentMimeType(fileName);
  return mimeType?.startsWith('audio/') ? mimeType : DEFAULT_AUDIO_MIME_TYPE;
}

/**
 * Returns the extension of an audio file's downloaded file, as TDLib's `FileManager::get_file_name`
 * names it: the extension of its file name when it is `ogg`, `oga`, `mp3`, `mpeg3`, or `m4a`, and
 * otherwise `mp3`.
 */
export function getAudioFileExtension(fileName: string | undefined): string {
  const extension = fileName === undefined ? undefined : getFileNameExtension(fileName);
  return extension !== undefined && KEPT_AUDIO_FILE_EXTENSIONS.has(extension)
    ? extension
    : DEFAULT_AUDIO_FILE_EXTENSION;
}
