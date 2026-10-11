import { z } from 'zod';

import type { BotApiDownloadableFile } from '../../../../types/bot_api.ts';
import { BOT_API_ERRORS } from '../errors/error_catalogue.ts';
import { presentFixedBotApiError } from '../errors/error_template.ts';
import { presentFilePreparationFailure } from '../errors/file_failure_presenter.ts';
import { type BotApiFamilyContext, type BotApiMethod, botApiResult } from '../method_call.ts';
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

/** What the file methods use: the session's media files, which give each bot its file paths. */
type FileContext = BotApiFamilyContext<'mediaFiles'>;

/** A file the bot can download, as `MediaFileService.getBotFile` prepared it. */
type PreparedBotFile = Extract<
  ReturnType<FileContext['session']['mediaFiles']['getBotFile']>,
  { readonly found: true }
>['downloadableFile'];

/** The methods that prepare a file for the bot to download. */
export const FILE_METHODS: readonly BotApiMethod[] = [
  handledMethodOfSteps({
    name: 'getFile',
    recordsActivity: true,
    parameters: getFileParametersSchema,
    steps: ({ parameters }) => startSteps(parameters).andThen(requireSpecifiedFileId),
    execute: (context: FileContext, fileId) => {
      const result = context.session.mediaFiles.getBotFile(context.bot.id, fileId);
      return result.found
        ? botApiResult(viewDownloadableFile(result.downloadableFile))
        : presentFilePreparationFailure(result);
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

/** Shows a file the bot can download, with the `file_path` that `getFile` gives it. */
function viewDownloadableFile({ file, fileId, filePath }: PreparedBotFile): BotApiDownloadableFile {
  return {
    file_id: fileId,
    file_unique_id: file.uniqueId,
    file_size: file.content.length,
    file_path: filePath,
  };
}
