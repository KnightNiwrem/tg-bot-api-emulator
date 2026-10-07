import type { EmulationSession } from '../../../types/emulation_session.ts';
import type { RichMessage } from '../../../types/rich_message.ts';
import {
  badRequestDescription,
  botApiError,
  type BotApiMethodAnswer,
  type BotApiMethodContext,
} from './method_call.ts';
import type { BotApiUploadedFiles } from './request_parameters.ts';
import { readRichMessageParameter } from './rich_message_parameter.ts';
import {
  type RequestedRichMessageFileTypes,
  resolveRichMessageWebFiles,
  type WebFileResolution,
} from './web_file_parameter.ts';

/** A rich message as the service sends it, with every file it names resolved. */
type SendableRichMessage = Pick<
  Parameters<EmulationSession['botApi']['sendRichMessage']>[1],
  'richMessage' | 'detectsEntities'
>;

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
  return resolution.resolved
    ? { resolved: true, value: { richMessage: resolution.value, detectsEntities } }
    : resolution;
}

/**
 * Reads a `rich_message` parameter as `readRichMessageParameter` does, with its buttons as
 * `BotApiService.readRichMessageButtons` reads them, answering Telegram's error for a message it
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
  const buttonReading = context.session.botApi.readRichMessageButtons(
    parameterReading.richMessage,
  );
  if (!buttonReading.read) {
    return {
      read: false,
      errorAnswer: botApiError(400, badRequestDescription(buttonReading.keyboardError)),
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
