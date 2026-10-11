import { z } from 'zod';

import { BOT_API_ERRORS } from '../errors/error_catalogue.ts';
import { presentFixedBotApiError } from '../errors/error_template.ts';
import { presentFilePreparationFailure } from '../errors/file_failure_presenter.ts';
import { type BotApiMethod, botApiResult } from '../method_call.ts';
import {
  answerWith,
  type BotApiStepResult,
  handledMethodOfSteps,
  proceedWith,
  startSteps,
} from '../method_steps.ts';

const getFileParametersSchema = z.strictObject({
  file_id: z.string().default(''),
});

/** The methods that prepare a file for the bot to download. */
export const FILE_METHODS: readonly BotApiMethod[] = [
  handledMethodOfSteps({
    name: 'getFile',
    recordsActivity: true,
    parameters: getFileParametersSchema,
    steps: ({ parameters }) => startSteps(parameters).andThen(requireSpecifiedFileId),
    execute: (context, fileId) => {
      const result = context.session.botApi.getFile(context.bot, fileId);
      return result.found ? botApiResult(result.file) : presentFilePreparationFailure(result);
    },
  }),
];

/**
 * The step that reads the file a call names by `file_id`, refusing a call that names none, as the
 * official server's `check_remote_file_id` does before it looks the file up.
 */
function requireSpecifiedFileId(
  { file_id: fileId }: { readonly file_id: string },
): BotApiStepResult<string> {
  return fileId.length === 0
    ? answerWith(presentFixedBotApiError(BOT_API_ERRORS.fileIdNotSpecified))
    : proceedWith(fileId);
}
