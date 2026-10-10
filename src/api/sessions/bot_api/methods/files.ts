import { z } from 'zod';

import {
  botApiError,
  type BotApiMethod,
  type BotApiMethodAnswer,
  type BotApiMethodContext,
  botApiResult,
} from '../method_call.ts';
import type { BotApiRequestParameters } from '../request_parameters.ts';

/** The methods that prepare a file for the bot to download. */
export const FILE_METHODS: readonly BotApiMethod[] = [
  { name: 'getFile', recordsActivity: true, handler: handleGetFile },
];

/** Telegram's descriptions for rejected getFile requests. */
const FILE_ID_NOT_SPECIFIED_DESCRIPTION = 'Bad Request: file_id not specified';
const GET_FILE_ID_INVALID_DESCRIPTION = 'Bad Request: invalid file_id';
const FILE_TOO_BIG_DESCRIPTION = 'Bad Request: file is too big';

const getFileParametersSchema = z.strictObject({
  file_id: z.string().default(''),
});

function handleGetFile(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = getFileParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid getFile parameters');
  }
  const { file_id: fileId } = parsedParameters.data;
  if (fileId.length === 0) {
    return botApiError(400, FILE_ID_NOT_SPECIFIED_DESCRIPTION);
  }

  const result = context.session.botApi.getFile(
    context.bot,
    fileId,
  );
  if (result.found) {
    return botApiResult(result.file);
  }
  switch (result.reason) {
    case 'file_id_invalid':
      return botApiError(400, GET_FILE_ID_INVALID_DESCRIPTION);
    case 'file_too_big':
      return botApiError(400, FILE_TOO_BIG_DESCRIPTION);
    default: {
      const unhandledReason: never = result.reason;
      throw new Error(`Unhandled getFile failure: ${unhandledReason}`);
    }
  }
}
