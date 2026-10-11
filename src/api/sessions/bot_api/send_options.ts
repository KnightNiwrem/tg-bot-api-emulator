import { z } from 'zod';

import type { EmulationSession } from '../../../session/emulation_session.ts';
import { resolveChatIdentifier } from './chat_access.ts';
import { BOT_API_ERRORS } from './errors/error_catalogue.ts';
import { presentFixedBotApiError } from './errors/error_template.ts';
import { readFormattedTextParameters } from './formatted_text_reading.ts';
import {
  answerWith,
  answerWithBadRequest,
  type BotApiStepCall,
  type BotApiStepResult,
  proceedWith,
} from './method_steps.ts';
import { messageReplyMarkupParameter } from './reply_markup_parameter.ts';
import { readMessageReplyMarkupParameter } from './reply_markup_reading.ts';
import {
  replyParametersParameter,
  selectSpecifiedReplyTarget,
} from './reply_parameters_parameter.ts';
import {
  booleanParameter,
  integerParameter,
  optionalInt64Identifier,
} from './request_parameters.ts';

// An `@username` chat_id reaches here already resolved by `resolveChatUsernameParameters`.
// `reply_to_message_id` and `allow_sending_without_reply` are the older form of
// `reply_parameters`, which Telegram still accepts.
export const sendOptionsParametersShape = {
  chat_id: integerParameter(z.int()).optional(),
  disable_notification: booleanParameter().default(false),
  protect_content: booleanParameter().default(false),
  message_effect_id: optionalInt64Identifier().optional(),
  reply_parameters: replyParametersParameter().optional(),
  reply_to_message_id: integerParameter(z.int()).optional(),
  allow_sending_without_reply: booleanParameter().default(false),
};

/** The reply markup that every send method but `sendMediaGroup` attaches to its message. */
export const replyMarkupParametersShape = {
  reply_markup: messageReplyMarkupParameter().default({}),
};

/** Where and how a send method sends its message, which every send method takes alike. */
export type SendRequestOptions = Parameters<
  EmulationSession['botMessageSending']['sender']['send']
>[2];

/** The send options of a request, with the reply markup of a method that reads one. */
export type SendOptionsParameters =
  & z.infer<z.ZodObject<typeof sendOptionsParametersShape>>
  & Partial<z.infer<z.ZodObject<typeof replyMarkupParametersShape>>>;

/**
 * The step that reads where and how a send method sends its message, with its reply markup, if
 * the method reads one: the formatting of a quote, then `chat_id`, then the reply markup, then the
 * reply's chat. As the official Bot API server's `get_reply_parameters` does, the formatting of a
 * quote is read before the chat; as its `check_reply_parameters` does, a reply naming the chat the
 * message is sent to replies in that chat.
 */
export function readSendOptions<Send extends { readonly parameters: SendOptionsParameters }>(
  { context, invalidParametersDescription }: BotApiStepCall<unknown>,
  send: Send,
): BotApiStepResult<Send & { readonly options: SendRequestOptions }> {
  const { parameters } = send;
  const {
    chat_id: chatId,
    disable_notification: isSilent,
    protect_content: isContentProtected,
    message_effect_id: messageEffectId,
    reply_markup: replyMarkup,
  } = parameters;
  const replyTarget = selectSpecifiedReplyTarget(parameters);
  const quote = replyTarget?.quote;
  const quoteReading = quote === undefined ? undefined : readFormattedTextParameters({
    text: quote.text,
    parseMode: quote.parseMode,
    entities: quote.entities,
  }, invalidParametersDescription);
  if (quoteReading?.read === false) {
    return answerWithBadRequest(quoteReading.description);
  }
  if (chatId === undefined) {
    return answerWith(presentFixedBotApiError(BOT_API_ERRORS.chatIdEmpty));
  }
  const markupReading = readMessageReplyMarkupParameter(context, replyMarkup ?? {}, chatId);
  if (!markupReading.read) {
    return answerWith(markupReading.errorAnswer);
  }
  const replyChatId = replyTarget?.chatId === undefined
    ? undefined
    : resolveChatIdentifier(context, replyTarget.chatId);
  if (replyTarget?.chatId !== undefined && replyChatId === undefined) {
    return answerWith(presentFixedBotApiError(BOT_API_ERRORS.chatNotFound));
  }
  return proceedWith({
    ...send,
    options: {
      ...markupReading.replyMarkup,
      chatId,
      replyTo: replyTarget === undefined ? undefined : {
        messageId: replyTarget.messageId,
        ...(replyChatId === undefined || replyChatId === chatId ? {} : { chatId: replyChatId }),
        allowSendingWithoutReply: replyTarget.allowSendingWithoutReply,
        ...(replyTarget.quote === undefined || quoteReading === undefined ? {} : {
          quote: { ...quoteReading.formattedText, position: replyTarget.quote.position },
        }),
      },
      isContentProtected,
      isSilent,
      messageEffectId,
    },
  });
}
