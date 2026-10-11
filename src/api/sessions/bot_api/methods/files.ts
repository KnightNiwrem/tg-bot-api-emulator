import { z } from 'zod';

import { presentFilePreparationFailure } from '../errors/file_failure_presenter.ts';
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

/** Telegram's description for a getFile request that names no file. */
const FILE_ID_NOT_SPECIFIED_DESCRIPTION = 'Bad Request: file_id not specified';

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
  return result.found ? botApiResult(result.file) : presentFilePreparationFailure(result);
}
