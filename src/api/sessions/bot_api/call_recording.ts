import type { BotApiCallContext, BotApiMethodAnswer } from './method_call.ts';
import type { BotApiRequestParameters, BotApiUploadedFiles } from './request_parameters.ts';

/** A bot's call as the session's bot activity records it. */
export interface RecordedBotApiCallDetails {
  /** The method's current name; the name as called for a method the emulator does not implement. */
  readonly methodName: string;
  readonly requestedMethodName: string;
  /** The parameters as the bot sent them; empty when the request could not be decoded. */
  readonly parameters: BotApiRequestParameters;
  readonly uploadedFiles: BotApiUploadedFiles;
  /** The chat `chat_id` names; `undefined` when it names none. */
  readonly chatId: number | undefined;
}

/** Records a call and the answer the bot receives. */
export function recordBotApiCall(
  context: BotApiCallContext,
  { methodName, requestedMethodName, parameters, uploadedFiles, chatId }: RecordedBotApiCallDetails,
  answer: BotApiMethodAnswer,
): void {
  context.session.botActivity.recordBotApiCall({
    botId: context.bot.id,
    method: methodName,
    requestedMethod: requestedMethodName,
    via: context.via,
    parameters,
    uploadedFiles: [...uploadedFiles].map(([fieldName, { fileName, content }]) => ({
      fieldName,
      fileName,
      sizeBytes: content.byteLength,
    })),
    ...(chatId === undefined ? {} : { chatId }),
    answer: answer.body,
  });
}
