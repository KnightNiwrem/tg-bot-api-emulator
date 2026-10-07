import type { InlineKeyboard } from '../../../types/inline_keyboard.ts';
import {
  badRequestDescription,
  botApiError,
  type BotApiMethodAnswer,
  type BotApiMethodContext,
} from './method_call.ts';

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
