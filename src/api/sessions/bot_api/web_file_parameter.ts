import {
  convertRichMessageFiles,
  listRichMessageFiles,
  type RichMessage,
} from '../../../types/rich_message.ts';
import type { BotApiInputFile, RequestedInputFile } from './input_file_parameter.ts';
import { botApiError, type BotApiMethodAnswer, type BotApiMethodContext } from './method_call.ts';

/** A document of a rich message as a request names it, with the thumbnail uploaded for it. */
interface RequestedRichMessageDocument {
  readonly document: RequestedInputFile;
  readonly thumbnail?: Uint8Array<ArrayBuffer>;
}

/** The files of a rich message's photo and document blocks, as a request names them. */
export interface RequestedRichMessageFileTypes {
  readonly photo: RequestedInputFile;
  readonly document: RequestedRichMessageDocument;
}

/** The files of a rich message's blocks, with every URL downloaded. */
interface ResolvedRichMessageFileTypes {
  readonly photo: BotApiInputFile;
  readonly document: {
    readonly document: BotApiInputFile;
    readonly thumbnail?: Uint8Array<ArrayBuffer>;
  };
}

export type WebFileResolution<Resolved> =
  | { readonly resolved: true; readonly value: Resolved }
  | { readonly resolved: false; readonly errorAnswer: BotApiMethodAnswer };

/** Telegram's descriptions of a file it cannot download from the URL a bot sent. */
const WEB_CONTENT_UNAVAILABLE_DESCRIPTION = 'Bad Request: failed to get HTTP URL content';
const WEB_CONTENT_TYPE_INVALID_DESCRIPTION = 'Bad Request: wrong type of the web page content';

/**
 * Downloads a file that a request names by URL, as Telegram does before it sends the file, from
 * the session's emulated web; a `file_id` or an uploaded part is resolved as it is. Telegram
 * downloads the file after the Bot API server looks at the chat; the emulator downloads it first,
 * as it reads uploads first, so a request with both an unknown chat and an unusable URL fails for
 * its URL.
 */
export async function resolveRequestedInputFile(
  context: BotApiMethodContext,
  inputFile: RequestedInputFile,
  fileKind: 'photo' | 'document',
): Promise<WebFileResolution<BotApiInputFile>> {
  if (inputFile.kind !== 'url') {
    return { resolved: true, value: inputFile };
  }
  const download = await context.session.mediaFiles.downloadWebFile({
    url: inputFile.url,
    fileKind,
    signal: context.signal,
  });
  if (download.downloaded) {
    return { resolved: true, value: { kind: 'web_file', webFile: download.webFile } };
  }
  switch (download.reason) {
    case 'file_url_invalid':
      return {
        resolved: false,
        errorAnswer: botApiError(
          400,
          `Bad Request: invalid file HTTP URL specified: ${download.urlError}`,
        ),
      };
    case 'web_content_unavailable':
      return {
        resolved: false,
        errorAnswer: botApiError(400, WEB_CONTENT_UNAVAILABLE_DESCRIPTION),
      };
    case 'web_content_type_invalid':
      return {
        resolved: false,
        errorAnswer: botApiError(400, WEB_CONTENT_TYPE_INVALID_DESCRIPTION),
      };
    default: {
      const unhandledFailure: never = download;
      throw new Error(`Unhandled web file failure: ${JSON.stringify(unhandledFailure)}`);
    }
  }
}

/**
 * Downloads the files that a rich message's blocks name by URL, in the order the message shows
 * them, as `resolveRequestedInputFile` downloads one; the first that fails fails the message.
 */
export async function resolveRichMessageWebFiles(
  context: BotApiMethodContext,
  richMessage: RichMessage<RequestedRichMessageFileTypes>,
): Promise<WebFileResolution<RichMessage<ResolvedRichMessageFileTypes>>> {
  const photos = new Map<RequestedInputFile, BotApiInputFile>();
  const documents = new Map<
    RequestedRichMessageDocument,
    ResolvedRichMessageFileTypes['document']
  >();
  for (const file of listRichMessageFiles(richMessage)) {
    const requested = file.kind === 'photo' ? file.file : file.file.document;
    const resolution = await resolveRequestedInputFile(context, requested, file.kind);
    if (!resolution.resolved) {
      return resolution;
    }
    if (file.kind === 'photo') {
      photos.set(file.file, resolution.value);
    } else {
      documents.set(file.file, { ...file.file, document: resolution.value });
    }
  }
  return {
    resolved: true,
    value: convertRichMessageFiles(richMessage, {
      photo: (photo) => getResolvedFile(photos, photo),
      document: (document) => getResolvedFile(documents, document),
    }),
  };
}

function getResolvedFile<Requested, Resolved>(
  resolvedFiles: ReadonlyMap<Requested, Resolved>,
  requested: Requested,
): Resolved {
  const resolved = resolvedFiles.get(requested);
  if (resolved === undefined) {
    throw new Error('Every file of a rich message is resolved before the message is converted');
  }
  return resolved;
}

/**
 * Returns a rich message as the service takes it when its blocks name no file by URL, or
 * `undefined` when one does, for content that must not download files.
 */
export function excludeRichMessageWebFiles(
  richMessage: RichMessage<RequestedRichMessageFileTypes>,
): RichMessage<ResolvedRichMessageFileTypes> | undefined {
  const namesWebFile = listRichMessageFiles(richMessage).some((file) =>
    (file.kind === 'photo' ? file.file : file.file.document).kind === 'url'
  );
  return namesWebFile ? undefined : convertRichMessageFiles(richMessage, {
    photo: excludeWebFile,
    document: (document) => ({ ...document, document: excludeWebFile(document.document) }),
  });
}

function excludeWebFile(inputFile: RequestedInputFile): BotApiInputFile {
  if (inputFile.kind === 'url') {
    throw new Error('A rich message without files named by URL was checked for them first');
  }
  return inputFile;
}
