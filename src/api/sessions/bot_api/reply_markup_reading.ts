import type { InlineKeyboard } from '../../../types/inline_keyboard.ts';
import type { BotMessageReplyMarkup } from '../../../types/reply_interface.ts';
import { isUserId } from '../../../types/telegram_identity.ts';
import {
  badRequestDescription,
  botApiError,
  type BotApiMethodAnswer,
  type BotApiMethodContext,
} from './method_call.ts';

/**
 * Reads the reply markup of a message being sent to a chat: an inline keyboard, as
 * `readInlineKeyboardParameter` reads it, or reply interface markup, as
 * `BotApiService.readReplyInterfaceMarkup` reads it, which allows buttons with a request only in a
 * private chat. Answers Telegram's error for a button it cannot read.
 */
export function readMessageReplyMarkupParameter(
  context: BotApiMethodContext,
  replyMarkup: BotMessageReplyMarkup,
  chatId: number,
):
  | { readonly read: true; readonly replyMarkup: BotMessageReplyMarkup }
  | { readonly read: false; readonly errorAnswer: BotApiMethodAnswer } {
  if (replyMarkup.replyInterfaceMarkup !== undefined) {
    const reading = context.session.botApi.readReplyInterfaceMarkup(
      replyMarkup.replyInterfaceMarkup,
      { allowsRequestButtons: isUserId(chatId) },
    );
    return reading.read
      ? { read: true, replyMarkup: { replyInterfaceMarkup: reading.replyInterfaceMarkup } }
      : {
        read: false,
        errorAnswer: botApiError(400, badRequestDescription(reading.keyboardError)),
      };
  }
  const keyboardReading = readInlineKeyboardParameter(context, replyMarkup.inlineKeyboard);
  if (!keyboardReading.read) {
    return keyboardReading;
  }
  return {
    read: true,
    replyMarkup: keyboardReading.inlineKeyboard === undefined
      ? {}
      : { inlineKeyboard: keyboardReading.inlineKeyboard },
  };
}

/**
 * Reads the inline keyboard a request attaches, as `BotApiService.readInlineKeyboard` does,
 * answering Telegram's error for a button it cannot read; a request without one reads none.
 */
export function readInlineKeyboardParameter(
  context: BotApiMethodContext,
  inlineKeyboard: InlineKeyboard | undefined,
):
  | { readonly read: true; readonly inlineKeyboard: InlineKeyboard | undefined }
  | { readonly read: false; readonly errorAnswer: BotApiMethodAnswer } {
  if (inlineKeyboard === undefined) {
    return { read: true, inlineKeyboard };
  }
  const reading = context.session.botApi.readInlineKeyboard(inlineKeyboard);
  return reading.read ? reading : {
    read: false,
    errorAnswer: botApiError(400, badRequestDescription(reading.keyboardError)),
  };
}
