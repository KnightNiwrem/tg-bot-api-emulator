import { z } from 'zod';

import type { EmulationSession } from '../../../session/emulation_session.ts';
import type { BotMessageReplyMarkup } from '../../../types/reply_interface.ts';
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
  readDeferredParameter,
} from './method_steps.ts';
import { messageReplyMarkupParameter } from './reply_markup_parameter.ts';
import {
  checkMessageReplyMarkupParameter,
  parseInlineKeyboardParameter,
  resolveLoginButtonBots,
} from './reply_markup_reading.ts';
import {
  replyParametersParameter,
  selectSpecifiedReplyTarget,
} from './reply_parameters_parameter.ts';
import {
  booleanParameter,
  deferredParameter,
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

/**
 * The reply markup that every send method but `sendMediaGroup` attaches to its message, which
 * `readSendOptions` reads where the official Bot API server's `do_send_message` does.
 */
export const replyMarkupParametersShape = {
  reply_markup: deferredParameter(messageReplyMarkupParameter().default({})),
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
 * the method reads one, in the order of the official Bot API server's `do_send_message`: the
 * formatting of a quote, as `get_reply_parameters` reads it; the reply markup and its buttons, as
 * `get_reply_markup` parses them; their login buttons' bots, as `resolve_reply_markup_bot_usernames`
 * resolves them; `chat_id`, as `check_chat` reads it; the reply's chat, as `check_reply_parameters`
 * reads it; and last the buttons as TDLib checks them. A reply naming the chat the message is sent
 * to replies in that chat.
 */
export function readSendOptions<Send extends { readonly parameters: SendOptionsParameters }>(
  call: BotApiStepCall<unknown>,
  send: Send,
): BotApiStepResult<Send & { readonly options: SendRequestOptions }> {
  const { parameters } = send;
  const {
    chat_id: chatId,
    disable_notification: isSilent,
    protect_content: isContentProtected,
    message_effect_id: messageEffectId,
    reply_markup: replyMarkupParameter,
  } = parameters;
  const { context, invalidParametersDescription } = call;
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
  const markupReading: BotApiStepResult<BotMessageReplyMarkup> = replyMarkupParameter === undefined
    ? proceedWith({})
    : readDeferredParameter(call, 'reply_markup', replyMarkupParameter);
  if (!markupReading.proceeds) {
    return markupReading;
  }
  const replyMarkup = markupReading.value;
  const markupParsing = parseInlineKeyboardParameter(replyMarkup.inlineKeyboard);
  if (!markupParsing.parsed) {
    return answerWith(markupParsing.errorAnswer);
  }
  const markupResolution = resolveLoginButtonBots(context, [replyMarkup.inlineKeyboard]);
  if (!markupResolution.resolved) {
    return answerWith(markupResolution.errorAnswer);
  }
  if (chatId === undefined) {
    return answerWith(presentFixedBotApiError(BOT_API_ERRORS.chatIdEmpty));
  }
  const replyChatId = replyTarget?.chatId === undefined
    ? undefined
    : resolveChatIdentifier(context, replyTarget.chatId);
  if (replyTarget?.chatId !== undefined && replyChatId === undefined) {
    return answerWith(presentFixedBotApiError(BOT_API_ERRORS.chatNotFound));
  }
  const markupChecking = checkMessageReplyMarkupParameter(replyMarkup, chatId);
  if (!markupChecking.read) {
    return answerWith(markupChecking.errorAnswer);
  }
  return proceedWith({
    ...send,
    options: {
      ...markupChecking.replyMarkup,
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
