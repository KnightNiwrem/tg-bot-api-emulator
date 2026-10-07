import { z } from 'zod';

import type { EmulationSession } from '../../../types/emulation_session.ts';
import {
  CHAT_ID_EMPTY_DESCRIPTION,
  CHAT_NOT_FOUND_DESCRIPTION,
  resolveChatIdentifier,
} from './chat_access.ts';
import { readFormattedTextParameters } from './formatted_text_reading.ts';
import { botApiError, type BotApiMethodAnswer, type BotApiMethodContext } from './method_call.ts';
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

/** Removes properties from each member of a union, which keeps the union's alternatives apart. */
type OmitFromEach<Type, Key extends PropertyKey> = Type extends unknown ? Omit<Type, Key> : never;

/** Where and how a send method sends its message, which every send method takes alike. */
type SendRequestOptions = OmitFromEach<
  Parameters<EmulationSession['botApi']['sendMessage']>[1],
  'text' | 'entities'
>;

/** The send options of a request, with the reply markup of a method that reads one. */
type SendOptionsParameters =
  & z.infer<z.ZodObject<typeof sendOptionsParametersShape>>
  & Partial<z.infer<z.ZodObject<typeof replyMarkupParametersShape>>>;

/**
 * Reads where and how a send method sends its message, with its reply markup, if the method reads
 * one. As the official Bot API server's `get_reply_parameters` does, the formatting of a quote is
 * read before the chat; as its `check_reply_parameters` does, a reply naming the chat the message
 * is sent to replies in that chat.
 */
export function readSendOptions(
  context: BotApiMethodContext,
  parameters: SendOptionsParameters,
  invalidParametersDescription: string,
):
  | { readonly read: true; readonly options: SendRequestOptions }
  | { readonly read: false; readonly errorAnswer: BotApiMethodAnswer } {
  const {
    chat_id: chatId,
    disable_notification: isSilent,
    protect_content: isContentProtected,
    message_effect_id: messageEffectId,
    reply_markup: replyMarkup,
  } = parameters;
  const replyTarget = selectSpecifiedReplyTarget(parameters);
  const quote = replyTarget?.quote;
  const quoteReading = quote === undefined ? undefined : readFormattedTextParameters(
    context,
    { text: quote.text, parseMode: quote.parseMode, entities: quote.entities },
    invalidParametersDescription,
  );
  if (quoteReading?.read === false) {
    return { read: false, errorAnswer: botApiError(400, quoteReading.description) };
  }
  if (chatId === undefined) {
    return { read: false, errorAnswer: botApiError(400, CHAT_ID_EMPTY_DESCRIPTION) };
  }
  const markupReading = readMessageReplyMarkupParameter(context, replyMarkup ?? {}, chatId);
  if (!markupReading.read) {
    return markupReading;
  }
  const replyChatId = replyTarget?.chatId === undefined
    ? undefined
    : resolveChatIdentifier(context, replyTarget.chatId);
  if (replyTarget?.chatId !== undefined && replyChatId === undefined) {
    return { read: false, errorAnswer: botApiError(400, CHAT_NOT_FOUND_DESCRIPTION) };
  }
  return {
    read: true,
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
  };
}
