/** Telegram names a document whose file name cleans to nothing `file`. */
const FALLBACK_FILE_NAME = 'file';

/** The MIME type Telegram gives a document whose extension it does not recognize. */
const DEFAULT_MIME_TYPE = 'application/octet-stream';

/** Telegram keeps at most this many characters of a file name's stem and of its extension. */
const MAX_FILE_STEM_LENGTH = 64;
const MAX_FILE_EXTENSION_LENGTH = 16;

/** ASCII characters that Telegram replaces with spaces in the names of uploaded files. */
const REPLACED_ASCII_CHARACTERS = '<>:"/\\|?*&`\'';

/**
 * MIME types by lowercase file extension, for the common extensions of TDLib's table in
 * `tdutils/generate/mime_types.txt`. Other extensions get `application/octet-stream`.
 */
const MIME_TYPES_BY_EXTENSION: ReadonlyMap<string, string> = new Map([
  ['3gp', 'video/3gpp'],
  ['7z', 'application/x-7z-compressed'],
  ['apk', 'application/vnd.android.package-archive'],
  ['avi', 'video/x-msvideo'],
  ['bmp', 'image/bmp'],
  ['csv', 'text/csv'],
  ['doc', 'application/msword'],
  ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['epub', 'application/epub+zip'],
  ['flac', 'audio/flac'],
  ['gif', 'image/gif'],
  ['heic', 'image/heic'],
  ['htm', 'text/html'],
  ['html', 'text/html'],
  ['ics', 'text/calendar'],
  ['jpeg', 'image/jpeg'],
  ['jpg', 'image/jpeg'],
  ['json', 'application/json'],
  ['m4a', 'audio/mp4'],
  ['m4v', 'video/x-m4v'],
  ['md', 'text/markdown'],
  ['mkv', 'video/x-matroska'],
  ['mov', 'video/quicktime'],
  ['mp3', 'audio/mpeg'],
  ['mp4', 'video/mp4'],
  ['mpeg', 'video/mpeg'],
  ['mpg', 'video/mpeg'],
  ['odp', 'application/vnd.oasis.opendocument.presentation'],
  ['ods', 'application/vnd.oasis.opendocument.spreadsheet'],
  ['odt', 'application/vnd.oasis.opendocument.text'],
  ['oga', 'audio/ogg'],
  ['ogg', 'audio/ogg'],
  ['ogv', 'video/ogg'],
  ['opus', 'audio/ogg'],
  ['pdf', 'application/pdf'],
  ['png', 'image/png'],
  ['ppt', 'application/vnd.ms-powerpoint'],
  ['pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  ['rar', 'application/x-rar-compressed'],
  ['rtf', 'application/rtf'],
  ['svg', 'image/svg+xml'],
  ['tar', 'application/x-tar'],
  ['tif', 'image/tiff'],
  ['tiff', 'image/tiff'],
  ['txt', 'text/plain'],
  ['vcf', 'text/x-vcard'],
  ['wav', 'audio/x-wav'],
  ['webm', 'video/webm'],
  ['webp', 'image/webp'],
  ['xls', 'application/vnd.ms-excel'],
  ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['xml', 'application/xml'],
  ['zip', 'application/zip'],
]);

/**
 * Cleans the name a bot gave an uploaded file as the Bot API server does before sending it as a
 * document, mirroring TDLib's `clean_filename`: characters that are unsafe in file names become
 * spaces, the stem and the extension are shortened, and a name that cleans to nothing becomes
 * `file`. Which characters TDLib drops rather than replaces is approximated by combining marks.
 */
export function cleanUploadedFileName(fileName: string): string {
  if (!fileName.isWellFormed()) {
    return FALLBACK_FILE_NAME;
  }
  const { stem, extension } = splitFileName(fileName.slice(fileName.lastIndexOf('/') + 1));
  const cleanedStem = cleanFileNamePart(stem, MAX_FILE_STEM_LENGTH);
  const cleanedExtension = extension === undefined
    ? ''
    : cleanFileNamePart(extension, MAX_FILE_EXTENSION_LENGTH);
  const cleanedName = cleanedExtension.length === 0
    ? cleanedStem
    : cleanedStem.length === 0
    ? cleanedExtension
    : `${cleanedStem}.${cleanedExtension}`;
  return cleanedName.length === 0 ? FALLBACK_FILE_NAME : cleanedName;
}

/**
 * Returns the MIME type Telegram gives a document by its file name's extension, matched
 * case-insensitively, as TDLib's `MimeType::from_extension` does.
 */
export function getDocumentMimeType(fileName: string): string {
  const { extension } = splitFileName(fileName);
  return (extension === undefined
    ? undefined
    : MIME_TYPES_BY_EXTENSION.get(extension.toLowerCase())) ?? DEFAULT_MIME_TYPE;
}

/** Returns a file name's extension without its dot, or `undefined` when it has none. */
export function getFileNameExtension(fileName: string): string | undefined {
  return splitFileName(fileName).extension;
}

/**
 * Splits a file name at its last dot, as TDLib's `PathView` does: a dot that begins the name
 * starts no extension.
 */
function splitFileName(fileName: string): { readonly stem: string; readonly extension?: string } {
  const lastDotIndex = fileName.lastIndexOf('.');
  return lastDotIndex <= 0
    ? { stem: fileName }
    : { stem: fileName.slice(0, lastDotIndex), extension: fileName.slice(lastDotIndex + 1) };
}

/** Mirrors TDLib's `clean_filename_part`, which keeps letters, digits, and safe ASCII. */
function cleanFileNamePart(part: string, maxLength: number): string {
  let cleanedPart = '';
  let length = 0;
  for (const character of part) {
    if (length >= maxLength) {
      break;
    }
    let cleanedCharacter = character;
    if (!isKeptFileNameCharacter(character)) {
      if (/^\p{M}$/u.test(character)) {
        continue;
      }
      cleanedCharacter = ' ';
    }
    if (cleanedPart.length === 0 && (cleanedCharacter === ' ' || cleanedCharacter === '.')) {
      continue;
    }
    cleanedPart += cleanedCharacter;
    length++;
  }
  return cleanedPart.replace(/[ .]+$/, '');
}

function isKeptFileNameCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0) ?? 0;
  if (codePoint < 0x20) {
    return false;
  }
  if (codePoint < 0x7f) {
    return !REPLACED_ASCII_CHARACTERS.includes(character);
  }
  return /^[\p{L}\p{N}]$/u.test(character);
}
