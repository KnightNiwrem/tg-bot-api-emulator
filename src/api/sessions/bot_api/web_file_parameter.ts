import type { EmulationSession } from '../../../session/emulation_session.ts';
import {
  convertRichMessageFiles,
  listRichMessageFiles,
  type RichMessage,
  type RichMessageFile,
} from '../../../types/rich_message.ts';
import type { VideoAttributes } from '../../../types/stored_file.ts';
import { BOT_API_ERRORS } from './errors/error_catalogue.ts';
import { presentBotApiError, presentFixedBotApiError } from './errors/error_template.ts';
import type { BotApiInputFile, RequestedInputFile } from './input_file_parameter.ts';
import {
  type BotApiMethodContext,
  type BotApiMethodOutcome,
  SESSION_ENDED,
} from './method_call.ts';
import { answerWith, type BotApiStepResult, proceedWith } from './method_steps.ts';

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

/**
 * The files a request names by URL, downloaded, or the answer the request gets instead:
 * Telegram's error for a download that failed, or `SESSION_ENDED` once the session has ended.
 */
export type WebFileResolution<Resolved> =
  | { readonly resolved: true; readonly value: Resolved }
  | { readonly resolved: false; readonly errorAnswer: BotApiMethodOutcome };

/**
 * The resolution of files whose session ended while they were downloaded. Every resolver checks
 * for it after each of its waits, so no download starts and nothing is reported as failed once the
 * session has ended.
 */
export const SESSION_ENDED_RESOLUTION = { resolved: false, errorAnswer: SESSION_ENDED } as const;

/**
 * A resolution as the wait of a method of steps reports it, as `waitingCommandMethodOfSteps` reads
 * it: what `toReady` makes of the downloaded value, Telegram's error for a failed download, or
 * `SESSION_ENDED` once the session has ended.
 */
export function toWaitResult<Resolved, Ready>(
  resolution: WebFileResolution<Resolved>,
  toReady: (resolved: Resolved) => Ready,
): BotApiStepResult<Ready> | typeof SESSION_ENDED {
  if (resolution.resolved) {
    return proceedWith(toReady(resolution.value));
  }
  return resolution.errorAnswer === SESSION_ENDED
    ? SESSION_ENDED
    : answerWith(resolution.errorAnswer);
}

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
 * Telegram's errors for a file it cannot download from the URL a bot sent, as the official Bot API
 * server's `fail_query_with_error` describes them for a single message.
 */
const WEB_CONTENT_ERRORS = {
  web_content_unavailable: BOT_API_ERRORS.webContentUnavailable,
  web_content_type_invalid: BOT_API_ERRORS.webContentTypeInvalid,
} as const satisfies Record<WebContentFailureReason, unknown>;

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
  if (!context.session.lifetime.admitsCommits) {
    return SESSION_ENDED_RESOLUTION;
  }
  if (download.downloaded) {
    return { resolved: true, value: { kind: 'web_file', webFile: download.webFile } };
  }
  switch (download.reason) {
    case 'file_url_invalid':
      return {
        resolved: false,
        errorAnswer: presentBotApiError(BOT_API_ERRORS.fileUrlInvalid, {
          urlError: download.urlError,
        }),
      };
    case 'web_content_unavailable':
    case 'web_content_type_invalid':
      return {
        resolved: false,
        errorAnswer: albumMemberPosition === undefined
          ? presentFixedBotApiError(WEB_CONTENT_ERRORS[download.reason])
          : presentBotApiError(BOT_API_ERRORS.albumMemberUploadRefused, {
            memberPosition: albumMemberPosition,
            refusal: { reason: download.reason },
          }),
      };
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
    if (!context.session.lifetime.admitsCommits) {
      return SESSION_ENDED_RESOLUTION;
    }
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
