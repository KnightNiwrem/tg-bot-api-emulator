import { checkLink, getLinkUserId } from '../../../text_entities/telegram_link.ts';
import {
  allowsSomeInlineQueryChat,
  type InlineKeyboard,
  type InlineKeyboardButton,
} from '../../../types/inline_keyboard.ts';
import type {
  BotMessageReplyMarkup,
  ReplyInterfaceMarkup,
  ReplyKeyboardButton,
  ReplyKeyboardButtonRequest,
} from '../../../types/reply_interface.ts';
import {
  mapRichMessageButtons,
  type RichMessage,
  type RichMessageButtonAction,
  type RichMessageFileTypes,
} from '../../../types/rich_message.ts';
import { isUserId } from '../../../types/telegram_identity.ts';
import { getBotApiChatAddress } from '../../../types/virtual_chat.ts';
import { BOT_API_ERRORS } from './errors/error_catalogue.ts';
import { presentBotApiError } from './errors/error_template.ts';
import type { BotApiFamilyContext, BotApiMethodAnswer } from './method_call.ts';

/**
 * What reading buttons uses: the public chats, which name the bot a login button's username
 * names.
 */
type ButtonReadingContext = BotApiFamilyContext<'sharedChatAdministration'>;

/** A button that opens a link, as TDLib names it in its errors about the link. */
export type LinkButton = 'inline_url' | 'inline_login' | 'inline_web_app' | 'keyboard_web_app';

/**
 * Why Telegram cannot read a button being sent:
 * - `request_outside_private_chat`: a reply keyboard button with a request, outside a private
 *   chat, as TDLib's `KeyboardButton::get_keyboard_button` refuses it;
 * - `login_bot_username_invalid` and `login_bot_not_found`: the bot that a login button of an
 *   inline keyboard names, as the official Bot API server reads it;
 * - `inline_query_chat_types_empty`: a switch-inline button for a chosen chat that allows no kind
 *   of chat;
 * - `button_url_invalid`: a link that TDLib's `check_link` refuses, with its error;
 * - `user_link_not_allowed`: a link to a user's profile on a button that needs an HTTPS link.
 */
export type ButtonFailure =
  | {
    readonly reason: 'request_outside_private_chat';
    readonly requestKind: ReplyKeyboardButtonRequest['kind'];
  }
  | {
    readonly reason: 'login_bot_username_invalid' | 'inline_query_chat_types_empty';
  }
  | { readonly reason: 'login_bot_not_found'; readonly botUsername: string }
  | {
    readonly reason: 'button_url_invalid';
    readonly button: LinkButton;
    /** TDLib's description of the link, as `checkLink` gives it. */
    readonly linkError: string;
  }
  | { readonly reason: 'user_link_not_allowed'; readonly button: HttpsLinkButton };

/** A button whose link must be an HTTPS link, which cannot open a user's profile. */
type HttpsLinkButton = Exclude<LinkButton, 'inline_url'>;

/**
 * Reads the reply markup of a message being sent to a chat: an inline keyboard, as
 * `readInlineKeyboardParameter` reads it, or reply interface markup, as `readReplyInterfaceMarkup`
 * reads it, which allows buttons with a request only in a private chat. Answers Telegram's error
 * for a button it cannot read.
 */
export function readMessageReplyMarkupParameter(
  context: ButtonReadingContext,
  replyMarkup: BotMessageReplyMarkup,
  chatId: number,
):
  | { readonly read: true; readonly replyMarkup: BotMessageReplyMarkup }
  | { readonly read: false; readonly errorAnswer: BotApiMethodAnswer } {
  if (replyMarkup.replyInterfaceMarkup !== undefined) {
    const reading = readReplyInterfaceMarkup(replyMarkup.replyInterfaceMarkup, {
      allowsRequestButtons: getBotApiChatAddress(chatId).type === 'private',
    });
    return reading.read
      ? { read: true, replyMarkup: { replyInterfaceMarkup: reading.replyInterfaceMarkup } }
      : {
        read: false,
        errorAnswer: presentBotApiError(BOT_API_ERRORS.buttonInvalid, reading.buttonFailure),
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
 * Reads the inline keyboard a request attaches, as `readInlineKeyboard` does, answering Telegram's
 * error for a button it cannot read; a request without one reads none.
 */
export function readInlineKeyboardParameter(
  context: ButtonReadingContext,
  inlineKeyboard: InlineKeyboard | undefined,
):
  | { readonly read: true; readonly inlineKeyboard: InlineKeyboard | undefined }
  | { readonly read: false; readonly errorAnswer: BotApiMethodAnswer } {
  if (inlineKeyboard === undefined) {
    return { read: true, inlineKeyboard };
  }
  const reading = readInlineKeyboard(context, inlineKeyboard);
  return reading.read ? reading : {
    read: false,
    errorAnswer: presentBotApiError(BOT_API_ERRORS.buttonInvalid, reading.buttonFailure),
  };
}

/** What reading buttons found, or why Telegram cannot read the first button it refuses. */
type ButtonReading<Read> =
  | ({ readonly read: true } & Read)
  | { readonly read: false; readonly buttonFailure: ButtonFailure };

/**
 * Reads an inline keyboard as TDLib's `get_inline_keyboard_button` does for a keyboard being sent,
 * with each button's action read as `readButtonAction` reads it. The keyboard still has to pass the
 * checks that sending or editing applies.
 */
function readInlineKeyboard(
  context: ButtonReadingContext,
  inlineKeyboard: InlineKeyboard,
): ButtonReading<{ readonly inlineKeyboard: InlineKeyboard }> {
  const readRows: InlineKeyboardButton[][] = [];
  for (const row of inlineKeyboard) {
    const readRow: InlineKeyboardButton[] = [];
    for (const button of row) {
      const actionReading = readButtonAction(context, button);
      if (!actionReading.read) {
        return actionReading;
      }
      readRow.push(
        actionReading.url === undefined || !hasButtonLink(button)
          ? button
          : { ...button, url: actionReading.url },
      );
    }
    readRows.push(readRow);
  }
  return { read: true, inlineKeyboard: readRows };
}

/**
 * Reads reply interface markup as TDLib's `KeyboardButton::get_keyboard_button` reads the buttons
 * of a reply keyboard being sent. As TDLib does, only a private chat allows buttons with a
 * request, and a Web App button needs an HTTPS link, which cannot open a profile. The keyboard
 * keeps the link as `check_link` normalizes it, which is how the user's client shows it.
 */
function readReplyInterfaceMarkup(
  replyInterfaceMarkup: ReplyInterfaceMarkup,
  { allowsRequestButtons }: { readonly allowsRequestButtons: boolean },
): ButtonReading<{ readonly replyInterfaceMarkup: ReplyInterfaceMarkup }> {
  if (replyInterfaceMarkup.kind !== 'reply_keyboard') {
    return { read: true, replyInterfaceMarkup };
  }
  const readRows: ReplyKeyboardButton[][] = [];
  for (const row of replyInterfaceMarkup.rows) {
    const readRow: ReplyKeyboardButton[] = [];
    for (const button of row) {
      const { request } = button;
      if (request !== undefined && !allowsRequestButtons) {
        return {
          read: false,
          buttonFailure: { reason: 'request_outside_private_chat', requestKind: request.kind },
        };
      }
      if (request?.kind !== 'web_app') {
        readRow.push(button);
        continue;
      }
      const urlReading = readHttpsButtonUrl(request.url, 'keyboard_web_app');
      if (!urlReading.read) {
        return urlReading;
      }
      readRow.push({ ...button, request: { ...request, url: urlReading.url } });
    }
    readRows.push(readRow);
  }
  return { read: true, replyInterfaceMarkup: { ...replyInterfaceMarkup, rows: readRows } };
}

/**
 * Reads the buttons of a rich message, in rows and in its text, as TDLib's
 * `get_inline_keyboard_button` reads them for a rich message: as `readInlineKeyboard` reads the
 * buttons of an inline keyboard. `readRichMessageParameter` has already refused a login button
 * that names a bot, as the official Bot API server does while it reads the blocks.
 */
export function readRichMessageButtons<Files extends RichMessageFileTypes>(
  context: ButtonReadingContext,
  richMessage: RichMessage<Files>,
): ButtonReading<{ readonly richMessage: RichMessage<Files> }> {
  let buttonFailure: ButtonFailure | undefined;
  const readRichMessage = mapRichMessageButtons(richMessage, (button) => {
    const { action } = button;
    if (buttonFailure !== undefined) {
      return button;
    }
    const actionReading = readButtonAction(context, action);
    if (!actionReading.read) {
      buttonFailure = actionReading.buttonFailure;
      return button;
    }
    return actionReading.url === undefined || !hasButtonLink(action)
      ? button
      : { ...button, action: { ...action, url: actionReading.url } };
  });
  return buttonFailure === undefined
    ? { read: true, richMessage: readRichMessage }
    : { read: false, buttonFailure };
}

/**
 * Reads a button's action as TDLib's `get_inline_keyboard_button` does, answering the link it
 * opens, normalized, for a button with one. A switch-inline button for a chosen chat must allow at
 * least one kind of chat. Of URL buttons' links, a `tg://user?id=` link opens the user's profile
 * and is kept in that canonical form, and any other link must pass `check_link`, which normalizes
 * it, so that `grammy.dev` opens `http://grammy.dev/`. Telegram's servers decide whether the user
 * of a profile link may be shown, which the emulator does not check. Login and Web App buttons
 * need an HTTPS link, which cannot open a profile.
 *
 * As the official Bot API server reads a login button, its bot's username consists of letters,
 * digits and underscores, and must name a bot.
 */
function readButtonAction(
  context: ButtonReadingContext,
  action: RichMessageButtonAction,
): ButtonReading<{ readonly url?: string }> {
  switch (action.kind) {
    case 'url':
      return readInlineButtonUrl(action.url);
    case 'login_url': {
      const { authorizingBotUsername } = action;
      if (authorizingBotUsername !== undefined) {
        if (!/^[A-Za-z0-9_]+$/.test(authorizingBotUsername)) {
          return { read: false, buttonFailure: { reason: 'login_bot_username_invalid' } };
        }
        const botId = context.session.sharedChatAdministration.findPublicChatId(
          authorizingBotUsername,
        );
        if (botId === undefined || !isUserId(botId)) {
          return {
            read: false,
            buttonFailure: { reason: 'login_bot_not_found', botUsername: authorizingBotUsername },
          };
        }
      }
      return readHttpsButtonUrl(action.url, 'inline_login');
    }
    case 'web_app':
      return readHttpsButtonUrl(action.url, 'inline_web_app');
    case 'switch_inline_query':
      return action.target.kind === 'chosen_chat' &&
          !allowsSomeInlineQueryChat(action.target.chatTypes)
        ? { read: false, buttonFailure: { reason: 'inline_query_chat_types_empty' } }
        : { read: true };
    case 'callback':
    case 'copy_text':
    case 'disabled':
      return { read: true };
    default: {
      const unhandledAction: never = action;
      throw new Error(`Unhandled button action: ${JSON.stringify(unhandledAction)}`);
    }
  }
}

/** Whether a button opens a link, which reading it normalizes. */
function hasButtonLink<Action extends RichMessageButtonAction>(
  action: Action,
): action is Extract<Action, { readonly url: string }> {
  return action.kind === 'url' || action.kind === 'login_url' || action.kind === 'web_app';
}

/**
 * Reads a URL button's link as TDLib's `get_inline_keyboard_button` does: a `tg://user?id=` link
 * opens the user's profile and is kept in that canonical form, and any other link must pass
 * `check_link`, which normalizes it.
 */
function readInlineButtonUrl(url: string): ButtonReading<{ readonly url?: string }> {
  const userId = getLinkUserId(url);
  if (userId !== undefined) {
    return { read: true, url: `tg://user?id=${userId}` };
  }
  const linkCheck = checkLink(url);
  return linkCheck.valid ? { read: true, url: linkCheck.url } : {
    read: false,
    buttonFailure: {
      reason: 'button_url_invalid',
      button: 'inline_url',
      linkError: linkCheck.error,
    },
  };
}

/**
 * Reads the link of a login or Web App button, as TDLib does: an HTTPS link, as `check_link`
 * normalizes it, which cannot open a user's profile.
 */
function readHttpsButtonUrl(
  url: string,
  button: HttpsLinkButton,
): ButtonReading<{ readonly url: string }> {
  if (getLinkUserId(url) !== undefined) {
    return { read: false, buttonFailure: { reason: 'user_link_not_allowed', button } };
  }
  const linkCheck = checkLink(url, { httpsOnly: true });
  return linkCheck.valid ? { read: true, url: linkCheck.url } : {
    read: false,
    buttonFailure: { reason: 'button_url_invalid', button, linkError: linkCheck.error },
  };
}
