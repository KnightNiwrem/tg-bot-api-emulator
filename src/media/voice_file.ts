import { getDocumentMimeType } from './document_file.ts';

/** The MIME type TDLib uploads a voice note under when its file name names none it keeps. */
const DEFAULT_VOICE_MIME_TYPE = 'audio/ogg';

/** The extension TDLib's `FileManager::get_file_name` gives a voice note's file by default. */
const DEFAULT_VOICE_FILE_EXTENSION = 'oga';

/**
 * The extension of a voice note's downloaded file by its MIME type. TDLib's
 * `FileManager::get_file_name` names a voice note `.oga` unless it already has an OGG, MP3 or M4A
 * extension, which each of these types takes.
 */
const VOICE_FILE_EXTENSIONS: ReadonlyMap<string, string> = new Map([
  [DEFAULT_VOICE_MIME_TYPE, DEFAULT_VOICE_FILE_EXTENSION],
  ['audio/mpeg', 'mp3'],
  ['audio/mp4', 'm4a'],
]);

/**
 * Returns the MIME type Telegram gives an uploaded voice note, as TDLib's
 * `VoiceNotesManager::get_input_media` chooses it: the type the file name's extension decides, as
 * for a document, when it is `audio/ogg`, `audio/mpeg`, or `audio/mp4`, and otherwise `audio/ogg`.
 * A voice note without a file name is `audio/ogg`.
 */
export function getVoiceMimeType(fileName: string | undefined): string {
  const mimeType = fileName === undefined ? undefined : getDocumentMimeType(fileName);
  return mimeType !== undefined && VOICE_FILE_EXTENSIONS.has(mimeType)
    ? mimeType
    : DEFAULT_VOICE_MIME_TYPE;
}

/** Returns the extension of a voice note's downloaded file, which its MIME type decides. */
export function getVoiceFileExtension(mimeType: string): string {
  return VOICE_FILE_EXTENSIONS.get(mimeType) ?? DEFAULT_VOICE_FILE_EXTENSION;
}
