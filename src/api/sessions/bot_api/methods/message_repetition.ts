import { z } from 'zod';

import type { BotApiMessageId } from '../../../../types/bot_api.ts';
import type { EmulationSession } from '../../../../types/emulation_session.ts';
import { requireSpecifiedChatId } from '../chat_access.ts';
import { BOT_API_ERRORS } from '../errors/error_catalogue.ts';
import { presentFixedBotApiError } from '../errors/error_template.ts';
import { presentMessageRepetitionFailure } from '../errors/message_repetition_failure_presenter.ts';
import { readSpecifiedCaption, type SpecifiedFormattedText } from '../formatted_text_reading.ts';
import { messageEntitiesParameter } from '../message_entities_parameter.ts';
import {
  messageIdentifiersParameter,
  messageIdOrNone,
  requireMessageIdentifiers,
} from '../message_identifiers.ts';
import { type BotApiMethod, type BotApiMethodAnswer, botApiResult } from '../method_call.ts';
import {
  answerWith,
  type BotApiStepCall,
  type BotApiStepResult,
  type BotApiSteps,
  commandMethodOfSteps,
  proceedWith,
  startSteps,
} from '../method_steps.ts';
import {
  booleanParameter,
  integerParameter,
  optionalInt64Identifier,
} from '../request_parameters.ts';
import {
  readSendOptions,
  replyMarkupParametersShape,
  sendOptionsParametersShape,
} from '../send_options.ts';

/**
 * The second from which a forwarded or copied video plays, which other content ignores. As TDLib's
 * `send_message` reads it, a negative second plays the video from its beginning.
 */
const videoStartTimestampParametersShape = {
  video_start_timestamp: integerParameter(z.int().transform((seconds) => Math.max(seconds, 0)))
    .optional(),
};

// As for sending, an `@username` chat_id or from_chat_id reaches here already resolved by
// `resolveChatUsernameParameters`. Topics, paid broadcasts, and suggested posts are not supported.
const forwardMessageParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
  from_chat_id: integerParameter(z.int()).optional(),
  message_id: integerParameter(z.int()).optional(),
  ...videoStartTimestampParametersShape,
  disable_notification: booleanParameter().default(false),
  protect_content: booleanParameter().default(false),
  message_effect_id: optionalInt64Identifier().optional(),
});

// A caption, even an empty one, replaces the caption of copied media; without one, its parse mode
// and entities are ignored, as on Telegram.
const copyMessageParametersSchema = z.strictObject({
  ...sendOptionsParametersShape,
  ...replyMarkupParametersShape,
  from_chat_id: integerParameter(z.int()).optional(),
  message_id: integerParameter(z.int()).optional(),
  ...videoStartTimestampParametersShape,
  caption: z.string().optional(),
  parse_mode: z.string().optional(),
  caption_entities: messageEntitiesParameter().optional(),
  show_caption_above_media: booleanParameter().default(false),
});

type CopyMessageParameters = z.output<typeof copyMessageParametersSchema>;

// As for forwardMessage, topics, paid broadcasts, and suggested posts are not supported.
const repeatMessagesParametersShape = {
  chat_id: integerParameter(z.int()).optional(),
  from_chat_id: integerParameter(z.int()).optional(),
  message_ids: messageIdentifiersParameter().optional(),
  disable_notification: booleanParameter().default(false),
  protect_content: booleanParameter().default(false),
  message_effect_id: optionalInt64Identifier().optional(),
};

const forwardMessagesParametersSchema = z.strictObject(repeatMessagesParametersShape);

const copyMessagesParametersSchema = z.strictObject({
  ...repeatMessagesParametersShape,
  remove_caption: booleanParameter().default(false),
});

type RepeatMessagesParameters = z.output<z.ZodObject<typeof repeatMessagesParametersShape>>;

/** Where and how a copied message is sent, as `readSendOptions` reads it. */
type SendRequestOptions = Extract<
  ReturnType<typeof readSendOptions>,
  { readonly read: true }
>['options'];

/** The messages that `forwardMessages` or `copyMessages` repeats, and the chat they go to. */
type RepeatMessagesRequest = Parameters<EmulationSession['botApi']['forwardMessages']>[1];

/**
 * The methods that forward or copy existing messages, each executed as a command in its call's
 * transaction: the steps read the parameters, and execution finds the messages and both chats,
 * makes every check, and sends every new message, or none.
 */
export const MESSAGE_REPETITION_METHODS: readonly BotApiMethod[] = [
  // Telegram reads a new caption and its formatting before it looks at either chat. As for
  // forwardMessage, the emulator reports a missing chat_id before the copied message.
  commandMethodOfSteps({
    name: 'copyMessage',
    recordsActivity: true,
    parameters: copyMessageParametersSchema,
    steps: (call) =>
      startSteps(call.parameters)
        .andThen(requireFromChatId)
        .andThen((parameters) => readCopyCaption(call, parameters))
        .andThen((copy) => readCopySendOptions(call, copy)),
    execute: (context, { parameters, caption, options }) => {
      const result = context.session.botApi.copyMessage(
        context.bot,
        {
          ...options,
          copiedMessage: {
            chatId: parameters.from_chat_id,
            messageId: messageIdOrNone(parameters.message_id),
          },
          ...(parameters.video_start_timestamp === undefined
            ? {}
            : { videoStartTimestampSeconds: parameters.video_start_timestamp }),
          caption,
          showsCaptionAboveMedia: parameters.show_caption_above_media,
        },
      );
      return result.sent
        ? botApiResult({ message_id: result.messageId } satisfies BotApiMessageId)
        : presentMessageRepetitionFailure('message_copy', result);
    },
  }),
  commandMethodOfSteps({
    name: 'copyMessages',
    recordsActivity: true,
    parameters: copyMessagesParametersSchema,
    steps: ({ parameters }) => readRepeatMessagesRequest(parameters),
    execute: (context, { request, parameters }) =>
      repeatMessagesAnswer(
        'message_copy',
        context.session.botApi.copyMessages(context.bot, {
          ...request,
          removesCaptions: parameters.remove_caption,
        }),
      ),
  }),
  // Telegram looks for the forwarded message before it looks at chat_id; the emulator reports a
  // missing chat_id first.
  commandMethodOfSteps({
    name: 'forwardMessage',
    recordsActivity: true,
    parameters: forwardMessageParametersSchema,
    steps: ({ parameters }) =>
      startSteps(parameters).andThen(requireFromChatId).andThen(requireSpecifiedChatId),
    execute: (context, parameters) => {
      const videoStartTimestampSeconds = parameters.video_start_timestamp;
      const result = context.session.botApi.forwardMessage(
        context.bot,
        {
          chatId: parameters.chat_id,
          forwardedMessage: {
            chatId: parameters.from_chat_id,
            messageId: messageIdOrNone(parameters.message_id),
          },
          ...(videoStartTimestampSeconds === undefined ? {} : { videoStartTimestampSeconds }),
          isContentProtected: parameters.protect_content,
          isSilent: parameters.disable_notification,
          messageEffectId: parameters.message_effect_id,
        },
      );
      return result.sent
        ? botApiResult(result.message)
        : presentMessageRepetitionFailure('message_forward', result);
    },
  }),
  commandMethodOfSteps({
    name: 'forwardMessages',
    recordsActivity: true,
    parameters: forwardMessagesParametersSchema,
    steps: ({ parameters }) => readRepeatMessagesRequest(parameters),
    execute: (context, { request }) =>
      repeatMessagesAnswer(
        'message_forward',
        context.session.botApi.forwardMessages(context.bot, request),
      ),
  }),
];

/** A call's parameters once a step has found the chat they repeat from by `from_chat_id`. */
type WithFromChatId<Parameters extends { readonly from_chat_id?: number }> =
  & Omit<Parameters, 'from_chat_id'>
  & { readonly from_chat_id: number };

/**
 * The step that finds the chat a forward or copy repeats from, refusing a call that names none,
 * as the official server's `get_required_string_arg` reads `from_chat_id` before anything else.
 */
function requireFromChatId<Parameters extends { readonly from_chat_id?: number }>(
  parameters: Parameters,
): BotApiStepResult<WithFromChatId<Parameters>> {
  const { from_chat_id: fromChatId } = parameters;
  return fromChatId === undefined
    ? answerWith(presentFixedBotApiError(BOT_API_ERRORS.fromChatIdRequired))
    : proceedWith({ ...parameters, from_chat_id: fromChatId });
}

/** The step that reads the new caption of a copied message and its formatting, if it has one. */
function readCopyCaption(
  { context, invalidParametersDescription }: BotApiStepCall<unknown>,
  parameters: WithFromChatId<CopyMessageParameters>,
): BotApiStepResult<{
  readonly parameters: WithFromChatId<CopyMessageParameters>;
  /** Omitted to keep the copied message's own caption. */
  readonly caption?: SpecifiedFormattedText;
}> {
  const { caption } = parameters;
  if (caption === undefined) {
    return proceedWith({ parameters });
  }
  const captionReading = readSpecifiedCaption(
    context,
    { ...parameters, caption },
    invalidParametersDescription,
  );
  return captionReading.read
    ? proceedWith({ parameters, caption: captionReading.formattedText })
    : answerWith(captionReading.errorAnswer);
}

/** The step that reads where and how a copy is sent, as `readSendOptions` does. */
function readCopySendOptions<Copy extends { readonly parameters: CopyMessageParameters }>(
  { context, invalidParametersDescription }: BotApiStepCall<unknown>,
  copy: Copy,
): BotApiStepResult<Copy & { readonly options: SendRequestOptions }> {
  const optionsReading = readSendOptions(context, copy.parameters, invalidParametersDescription);
  return optionsReading.read
    ? proceedWith({ ...copy, options: optionsReading.options })
    : answerWith(optionsReading.errorAnswer);
}

/**
 * The steps that read the messages that `forwardMessages` or `copyMessages` repeats and where to,
 * in the order the official Bot API server's `process_forward_messages_query` and
 * `process_copy_messages_query` check them: `from_chat_id`, then the message identifiers, which
 * must name at least one message, then `chat_id`.
 */
function readRepeatMessagesRequest<Parameters extends RepeatMessagesParameters>(
  parameters: Parameters,
): BotApiSteps<{ readonly request: RepeatMessagesRequest; readonly parameters: Parameters }> {
  return startSteps(parameters)
    .andThen(requireFromChatId)
    .andThen(requireMessageIdentifiers)
    .andThen((repetition) =>
      repetition.message_ids.length === 0
        ? answerWith(presentFixedBotApiError(BOT_API_ERRORS.repeatedMessageIdentifiersEmpty))
        : proceedWith(repetition)
    )
    .andThen(requireSpecifiedChatId)
    .andThen((repetition) => {
      const request: RepeatMessagesRequest = {
        chatId: repetition.chat_id,
        fromChatId: repetition.from_chat_id,
        messageIds: repetition.message_ids,
        isContentProtected: repetition.protect_content,
        isSilent: repetition.disable_notification,
        messageEffectId: repetition.message_effect_id,
      };
      return proceedWith({ request, parameters });
    });
}

/** Telegram's answer to `forwardMessages` or `copyMessages`: the new messages' IDs, or its error. */
function repeatMessagesAnswer(
  operation: 'message_forward' | 'message_copy',
  result: ReturnType<EmulationSession['botApi']['forwardMessages']>,
): BotApiMethodAnswer {
  return result.sent
    ? botApiResult(
      result.messageIds.map((messageId): BotApiMessageId => ({ message_id: messageId })),
    )
    : presentMessageRepetitionFailure(operation, result);
}
