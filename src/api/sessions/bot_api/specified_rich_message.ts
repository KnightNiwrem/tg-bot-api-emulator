import type { EmulationSession } from '../../../session/emulation_session.ts';
import { listRichMessageFiles, type RichMessage } from '../../../types/rich_message.ts';
import { BOT_API_ERRORS } from './errors/error_catalogue.ts';
import { presentBotApiError } from './errors/error_template.ts';
import { botApiError, type BotApiMethodAnswer, type BotApiMethodContext } from './method_call.ts';
import type { BotApiUploadedFiles } from './request_parameters.ts';
import { readRichMessageButtons } from './reply_markup_reading.ts';
import { readRichMessageParameter } from './rich_message_parameter.ts';
import {
  type RequestedRichMessageFileTypes,
  resolveRichMessageWebFiles,
  SESSION_ENDED_RESOLUTION,
  type WebFileResolution,
} from './web_file_parameter.ts';

/** A rich message as the service sends it, with every file it names resolved. */
interface SendableRichMessage {
  readonly richMessage: RequestedRichMessage;
  /**
   * Whether Telegram marks the entities it detects in the text; the Bot API's
   * `skip_entity_detection` turns it off.
   */
  readonly detectsEntities: boolean;
}

/** A rich message as a request specifies it, naming each file it sends. */
type RequestedRichMessage = Parameters<
  EmulationSession['botMediaResolver']['resolveRichMessageFiles']
>[1];

/** A rich message as a bot specified it, with the files it names by URL not yet downloaded. */
export type SpecifiedRichMessage = Omit<SendableRichMessage, 'richMessage'> & {
  readonly richMessage: RichMessage<RequestedRichMessageFileTypes>;
};

/** Downloads the files a rich message names by URL, as `resolveRichMessageWebFiles` does. */
export async function resolveSpecifiedRichMessage(
  context: BotApiMethodContext,
  { richMessage, detectsEntities }: SpecifiedRichMessage,
): Promise<WebFileResolution<SendableRichMessage>> {
  const resolution = await resolveRichMessageWebFiles(context, richMessage);
  if (!context.session.lifetime.admitsCommits) {
    return SESSION_ENDED_RESOLUTION;
  }
  return resolution.resolved
    ? { resolved: true, value: { richMessage: resolution.value, detectsEntities } }
    : resolution;
}

/**
 * Reads a `rich_message` parameter as `readRichMessageParameter` does, with its buttons as
 * `readRichMessageButtons` reads them, answering Telegram's error for a message it
 * cannot read.
 */
export function readSpecifiedRichMessage(
  context: BotApiMethodContext,
  richMessageParameter: string | undefined,
  uploadedFiles: BotApiUploadedFiles,
  invalidParametersDescription: string,
):
  | { readonly read: true; readonly richMessage: SpecifiedRichMessage }
  | { readonly read: false; readonly errorAnswer: BotApiMethodAnswer } {
  const parameterReading = readRichMessageParameter(
    richMessageParameter,
    uploadedFiles,
    invalidParametersDescription,
  );
  if (!parameterReading.read) {
    return { read: false, errorAnswer: botApiError(400, parameterReading.description) };
  }
  const buttonReading = readRichMessageButtons(context, parameterReading.richMessage);
  if (!buttonReading.read) {
    return {
      read: false,
      errorAnswer: presentBotApiError(BOT_API_ERRORS.buttonInvalid, buttonReading.buttonFailure),
    };
  }
  return {
    read: true,
    richMessage: {
      richMessage: buttonReading.richMessage,
      detectsEntities: parameterReading.detectsEntities,
    },
  };
}

/** Whether a rich message a request specifies uploads a file for one of its media blocks. */
export function richMessageUploadsFile(richMessage: RequestedRichMessage): boolean {
  return listRichMessageFiles(richMessage).some((file) => {
    switch (file.kind) {
      case 'photo':
        return file.file.kind === 'upload';
      case 'document':
        return file.file.document.kind === 'upload';
      case 'video':
        return file.file.video.kind === 'upload';
      case 'voice':
        return file.file.voice.kind === 'upload';
      default: {
        const unhandledFile: never = file;
        throw new Error(`Unhandled rich message file: ${JSON.stringify(unhandledFile)}`);
      }
    }
  });
}
