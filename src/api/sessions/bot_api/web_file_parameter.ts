import type { EmulationSession } from '../../../types/emulation_session.ts';
import {
  convertRichMessageFiles,
  listRichMessageFiles,
  type RichMessage,
  type RichMessageFile,
} from '../../../types/rich_message.ts';
import type { VideoAttributes } from '../../../types/stored_file.ts';
import type { BotApiInputFile, RequestedInputFile } from './input_file_parameter.ts';
import {
  albumMessageNotSentError,
  botApiError,
  type BotApiMethodAnswer,
  type BotApiMethodContext,
} from './method_call.ts';

/**
 * The files of a rich message's media blocks in the shapes the service takes, each named as an
 * `InputFile` along with what the request specifies for it.
 */
interface RichMessageFileRequests<InputFile> {
  readonly photo: InputFile;
  readonly document: {
    readonly document: InputFile;
    readonly thumbnail?: Uint8Array<ArrayBuffer>;
  };
  readonly video: {
    readonly video: InputFile;
    readonly attributes: VideoAttributes;
    readonly thumbnail?: Uint8Array<ArrayBuffer>;
  };
  readonly voice: {
    readonly voice: InputFile;
    readonly durationSeconds: number;
  };
}

/** The files of a rich message's media blocks, as a request names them. */
export type RequestedRichMessageFileTypes = RichMessageFileRequests<RequestedInputFile>;

/** The files of a rich message's media blocks, with every URL downloaded. */
type ResolvedRichMessageFileTypes = RichMessageFileRequests<BotApiInputFile>;

export type WebFileResolution<Resolved> =
  | { readonly resolved: true; readonly value: Resolved }
  | { readonly resolved: false; readonly errorAnswer: BotApiMethodAnswer };

/** What a request sends a file named by URL as, which decides how Telegram downloads it. */
type WebFileKind = Parameters<EmulationSession['mediaFiles']['downloadWebFile']>[0]['fileKind'];

type WebContentFailureReason = Exclude<
  Extract<
    Awaited<ReturnType<EmulationSession['mediaFiles']['downloadWebFile']>>,
    { readonly downloaded: false }
  >['reason'],
  'file_url_invalid'
>;

/**
 * Telegram's errors for a file it cannot download from the URL a bot sent, as its servers give
 * them, and as the official Bot API server's `fail_query_with_error` describes them for a single
 * message.
 */
const WEB_CONTENT_FAILURES: Readonly<
  Record<WebContentFailureReason, { readonly telegramError: string; readonly description: string }>
> = {
  web_content_unavailable: {
    telegramError: 'WEBPAGE_CURL_FAILED',
    description: 'Bad Request: failed to get HTTP URL content',
  },
  web_content_type_invalid: {
    telegramError: 'WEBPAGE_MEDIA_EMPTY',
    description: 'Bad Request: wrong type of the web page content',
  },
};

/**
 * Downloads a file that a request names by URL, as Telegram does before it sends the file, from
 * the session's emulated web; a `file_id` or an uploaded part is resolved as it is. Telegram
 * downloads the file after the Bot API server looks at the chat; the emulator downloads it once the
 * request's other parameters are read, before the service looks up the chat or the edited message,
 * as it reads uploads, so a request with both an unknown chat ID and an unusable URL fails for its
 * URL. A chat named by `@username` is resolved before any method runs, so an unknown username
 * fails first.
 *
 * `albumMemberPosition` is the position, counted from 1, of the album's message that sends the
 * file; as for an upload Telegram's servers refuse, content they cannot download fails the album
 * with that position. A URL TDLib cannot read fails before anything is sent, as for one message.
 */
export async function resolveRequestedInputFile(
  context: BotApiMethodContext,
  inputFile: RequestedInputFile,
  fileKind: WebFileKind,
  albumMemberPosition?: number,
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
    case 'web_content_type_invalid': {
      const { telegramError, description } = WEB_CONTENT_FAILURES[download.reason];
      return {
        resolved: false,
        errorAnswer: albumMemberPosition === undefined
          ? botApiError(400, description)
          : albumMessageNotSentError(albumMemberPosition, telegramError),
      };
    }
    default: {
      const unhandledFailure: never = download;
      throw new Error(`Unhandled web file failure: ${JSON.stringify(unhandledFailure)}`);
    }
  }
}

/**
 * Downloads the files that a rich message's blocks name by URL, in the order the message shows
 * them, as `resolveRequestedInputFile` downloads one, each as the kind of file its block shows;
 * the first that fails fails the message.
 */
export async function resolveRichMessageWebFiles(
  context: BotApiMethodContext,
  richMessage: RichMessage<RequestedRichMessageFileTypes>,
): Promise<WebFileResolution<RichMessage<ResolvedRichMessageFileTypes>>> {
  const resolvedFiles = new Map<RequestedInputFile, BotApiInputFile>();
  for (const file of listRichMessageFiles(richMessage)) {
    const requested = getRequestedRichMessageFile(file);
    const resolution = await resolveRequestedInputFile(context, requested, file.kind);
    if (!resolution.resolved) {
      return resolution;
    }
    resolvedFiles.set(requested, resolution.value);
  }
  return {
    resolved: true,
    value: replaceRichMessageInputFiles(richMessage, (requested) => {
      const resolved = resolvedFiles.get(requested);
      if (resolved === undefined) {
        throw new Error('Every file of a rich message is resolved before the message is converted');
      }
      return resolved;
    }),
  };
}

/**
 * Returns a rich message as the service takes it when its blocks name no file by URL, or
 * `undefined` when one does, for content that must not download files.
 */
export function excludeRichMessageWebFiles(
  richMessage: RichMessage<RequestedRichMessageFileTypes>,
): RichMessage<ResolvedRichMessageFileTypes> | undefined {
  const namesWebFile = listRichMessageFiles(richMessage).some((file) =>
    getRequestedRichMessageFile(file).kind === 'url'
  );
  return namesWebFile ? undefined : replaceRichMessageInputFiles(richMessage, excludeWebFile);
}

function excludeWebFile(inputFile: RequestedInputFile): BotApiInputFile {
  if (inputFile.kind === 'url') {
    throw new Error('A rich message without files named by URL was checked for them first');
  }
  return inputFile;
}

/** The file that a media block of a rich message sends, as the request names it. */
function getRequestedRichMessageFile(
  file: RichMessageFile<RequestedRichMessageFileTypes>,
): RequestedInputFile {
  switch (file.kind) {
    case 'photo':
      return file.file;
    case 'document':
      return file.file.document;
    case 'video':
      return file.file.video;
    case 'voice':
      return file.file.voice;
    default: {
      const unhandledFile: never = file;
      throw new Error(`Unhandled rich message file: ${JSON.stringify(unhandledFile)}`);
    }
  }
}

/** Returns a rich message whose media blocks send the files `replace` gives for theirs. */
function replaceRichMessageInputFiles(
  richMessage: RichMessage<RequestedRichMessageFileTypes>,
  replace: (requested: RequestedInputFile) => BotApiInputFile,
): RichMessage<ResolvedRichMessageFileTypes> {
  return convertRichMessageFiles(richMessage, {
    photo: replace,
    document: (document) => ({ ...document, document: replace(document.document) }),
    video: (video) => ({ ...video, video: replace(video.video) }),
    voice: (voiceNote) => ({ ...voiceNote, voice: replace(voiceNote.voice) }),
  });
}
