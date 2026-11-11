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
 * What resolving login buttons' bots uses: the public chats, which name the bot a login button's
 * username names.
 */
type LoginBotResolutionContext = BotApiFamilyContext<'sharedChatAdministration'>;

/** A button that opens a link, as TDLib names it in its errors about the link. */
export type LinkButton = 'inline_url' | 'inline_login' | 'inline_web_app' | 'keyboard_web_app';

/**
 * Why the official Bot API server's `get_inline_keyboard_button_type` cannot parse a button of an
 * inline keyboard: a login button's bot username that is not letters, digits and underscores
 * after one optional leading `@`.
 */
export type InlineKeyboardButtonParsingError = { readonly reason: 'login_bot_username_invalid' };

/**
 * Why Telegram cannot read a button being sent, once the official Bot API server has parsed it:
 * - `request_outside_private_chat`: a reply keyboard button with a request, outside a private
 *   chat, as TDLib's `KeyboardButton::get_keyboard_button` refuses it;
 * - `login_bot_not_found`: a login button of an inline keyboard naming no bot, as the official
 *   server's `on_resolve_bot_username` refuses it;
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
  | { readonly reason: 'inline_query_chat_types_empty' }
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
 * Parses the login buttons of an inline keyboard a request attaches as the official Bot API
 * server's `get_reply_markup` does: every button in turn, before it resolves any login button's
 * bot and before TDLib checks any button. Answers Telegram's error for the first button it cannot
 * parse; a request without a keyboard has none.
 */
export function parseInlineKeyboardParameter(
  inlineKeyboard: InlineKeyboard | undefined,
):
  | { readonly parsed: true }
  | { readonly parsed: false; readonly errorAnswer: BotApiMethodAnswer } {
  const parsingError = findInlineKeyboardParsingError(inlineKeyboard);
  return parsingError === undefined ? { parsed: true } : {
    parsed: false,
    errorAnswer: presentBotApiError(BOT_API_ERRORS.inlineKeyboardButtonUnparsable, parsingError),
  };
}

/**
 * Finds the first button of an inline keyboard that the official server's
 * `get_inline_keyboard_button_type` cannot parse: a login button whose bot username, after one
 * optional leading `@`, is not letters, digits and underscores.
 */
export function findInlineKeyboardParsingError(
  inlineKeyboard: InlineKeyboard | undefined,
): InlineKeyboardButtonParsingError | undefined {
  const invalidUsername = listLoginBotUsernames(inlineKeyboard).find((username) =>
    !LOGIN_BOT_USERNAME_PATTERN.test(username)
  );
  return invalidUsername === undefined ? undefined : { reason: 'login_bot_username_invalid' };
}

/** The characters of a login button's bot username, as the official server allows them. */
const LOGIN_BOT_USERNAME_PATTERN = /^[A-Za-z0-9_]+$/;

/**
 * Resolves the bots that the login buttons of parsed inline keyboards name, as the official
 * server's `resolve_bot_usernames` does once it has parsed the request and before TDLib checks any
 * button. Answers `Bad Request: bot "<username>" not found` for the first username, in keyboard
 * order, that names no bot of the session.
 */
export function resolveLoginButtonBots(
  context: LoginBotResolutionContext,
  inlineKeyboards: readonly (InlineKeyboard | undefined)[],
):
  | { readonly resolved: true }
  | { readonly resolved: false; readonly errorAnswer: BotApiMethodAnswer } {
  for (const botUsername of inlineKeyboards.flatMap(listLoginBotUsernames)) {
    const botId = context.session.sharedChatAdministration.findPublicChatId(botUsername);
    if (botId === undefined || !isUserId(botId)) {
      return {
        resolved: false,
        errorAnswer: presentBotApiError(BOT_API_ERRORS.buttonInvalid, {
          reason: 'login_bot_not_found',
          botUsername,
        }),
      };
    }
  }
  return { resolved: true };
}

/** The bot usernames that the login buttons of an inline keyboard name, in keyboard order. */
function listLoginBotUsernames(inlineKeyboard: InlineKeyboard | undefined): string[] {
  return (inlineKeyboard ?? []).flat().flatMap((button) =>
    button.kind === 'login_url' && button.authorizingBotUsername !== undefined
      ? [button.authorizingBotUsername]
      : []
  );
}

/**
 * Checks the reply markup of a message being sent to a chat, once the official server has parsed
 * it and resolved its login buttons' bots: an inline keyboard, as `checkInlineKeyboardParameter`
 * checks it, or reply interface markup, as `checkReplyInterfaceMarkup` checks it, which allows
 * buttons with a request only in a private chat. Answers Telegram's error for a button TDLib
 * refuses.
 */
export function checkMessageReplyMarkupParameter(
  replyMarkup: BotMessageReplyMarkup,
  chatId: number,
):
  | { readonly read: true; readonly replyMarkup: BotMessageReplyMarkup }
  | { readonly read: false; readonly errorAnswer: BotApiMethodAnswer } {
  if (replyMarkup.replyInterfaceMarkup !== undefined) {
    const checking = checkReplyInterfaceMarkup(replyMarkup.replyInterfaceMarkup, {
      allowsRequestButtons: getBotApiChatAddress(chatId).type === 'private',
    });
    return checking.read
      ? { read: true, replyMarkup: { replyInterfaceMarkup: checking.replyInterfaceMarkup } }
      : {
        read: false,
        errorAnswer: presentBotApiError(BOT_API_ERRORS.buttonInvalid, checking.buttonFailure),
      };
  }
  const keyboardChecking = checkInlineKeyboardParameter(replyMarkup.inlineKeyboard);
  if (!keyboardChecking.read) {
    return keyboardChecking;
  }
  return {
    read: true,
    replyMarkup: keyboardChecking.inlineKeyboard === undefined
      ? {}
      : { inlineKeyboard: keyboardChecking.inlineKeyboard },
  };
}

/**
 * Checks the inline keyboard a request attaches, as `checkInlineKeyboard` does, once the official
 * server has parsed it and resolved its login buttons' bots. Answers Telegram's error for a button
 * TDLib refuses; a request without a keyboard has none.
 */
export function checkInlineKeyboardParameter(
  inlineKeyboard: InlineKeyboard | undefined,
):
  | { readonly read: true; readonly inlineKeyboard: InlineKeyboard | undefined }
  | { readonly read: false; readonly errorAnswer: BotApiMethodAnswer } {
  if (inlineKeyboard === undefined) {
    return { read: true, inlineKeyboard };
  }
  const checking = checkInlineKeyboard(inlineKeyboard);
  return checking.read ? checking : {
    read: false,
    errorAnswer: presentBotApiError(BOT_API_ERRORS.buttonInvalid, checking.buttonFailure),
  };
}

/** What checking buttons found, or why Telegram cannot read the first button it refuses. */
type ButtonChecking<Checked> =
  | ({ readonly read: true } & Checked)
  | { readonly read: false; readonly buttonFailure: ButtonFailure };

/**
 * Checks an inline keyboard as TDLib's `get_inline_keyboard_button` does for a keyboard being
 * sent, with each button's action checked as `checkButtonAction` checks it. The keyboard still has
 * to pass the checks that sending or editing applies.
 */
function checkInlineKeyboard(
  inlineKeyboard: InlineKeyboard,
): ButtonChecking<{ readonly inlineKeyboard: InlineKeyboard }> {
  const checkedRows: InlineKeyboardButton[][] = [];
  for (const row of inlineKeyboard) {
    const checkedRow: InlineKeyboardButton[] = [];
    for (const button of row) {
      const actionChecking = checkButtonAction(button);
      if (!actionChecking.read) {
        return actionChecking;
      }
      checkedRow.push(
        actionChecking.url === undefined || !hasButtonLink(button)
          ? button
          : { ...button, url: actionChecking.url },
      );
    }
    checkedRows.push(checkedRow);
  }
  return { read: true, inlineKeyboard: checkedRows };
}

/**
 * Checks reply interface markup as TDLib's `KeyboardButton::get_keyboard_button` checks the
 * buttons of a reply keyboard being sent. As TDLib does, only a private chat allows buttons with a
 * request, and a Web App button needs an HTTPS link, which cannot open a profile. The keyboard
 * keeps the link as `check_link` normalizes it, which is how the user's client shows it.
 */
function checkReplyInterfaceMarkup(
  replyInterfaceMarkup: ReplyInterfaceMarkup,
  { allowsRequestButtons }: { readonly allowsRequestButtons: boolean },
): ButtonChecking<{ readonly replyInterfaceMarkup: ReplyInterfaceMarkup }> {
  if (replyInterfaceMarkup.kind !== 'reply_keyboard') {
    return { read: true, replyInterfaceMarkup };
  }
  const checkedRows: ReplyKeyboardButton[][] = [];
  for (const row of replyInterfaceMarkup.rows) {
    const checkedRow: ReplyKeyboardButton[] = [];
    for (const button of row) {
      const { request } = button;
      if (request !== undefined && !allowsRequestButtons) {
        return {
          read: false,
          buttonFailure: { reason: 'request_outside_private_chat', requestKind: request.kind },
        };
      }
      if (request?.kind !== 'web_app') {
        checkedRow.push(button);
        continue;
      }
      const urlChecking = checkHttpsButtonUrl(request.url, 'keyboard_web_app');
      if (!urlChecking.read) {
        return urlChecking;
      }
      checkedRow.push({ ...button, request: { ...request, url: urlChecking.url } });
    }
    checkedRows.push(checkedRow);
  }
  return { read: true, replyInterfaceMarkup: { ...replyInterfaceMarkup, rows: checkedRows } };
}

/**
 * Checks the buttons of a rich message, in rows and in its text, as TDLib's
 * `get_inline_keyboard_button` checks them for a rich message: as `checkInlineKeyboard` checks the
 * buttons of an inline keyboard. `parseRichMessageParameter` has already refused a login button
 * that names a bot, as the official Bot API server does while it parses the blocks, so no button
 * has a bot to resolve.
 */
export function checkRichMessageButtons<Files extends RichMessageFileTypes>(
  richMessage: RichMessage<Files>,
): ButtonChecking<{ readonly richMessage: RichMessage<Files> }> {
  let buttonFailure: ButtonFailure | undefined;
  const checkedRichMessage = mapRichMessageButtons(richMessage, (button) => {
    const { action } = button;
    if (buttonFailure !== undefined) {
      return button;
    }
    const actionChecking = checkButtonAction(action);
    if (!actionChecking.read) {
      buttonFailure = actionChecking.buttonFailure;
      return button;
    }
    return actionChecking.url === undefined || !hasButtonLink(action)
      ? button
      : { ...button, action: { ...action, url: actionChecking.url } };
  });
  return buttonFailure === undefined
    ? { read: true, richMessage: checkedRichMessage }
    : { read: false, buttonFailure };
}

/**
 * Checks a button's action as TDLib's `get_inline_keyboard_button` does, answering the link it
 * opens, normalized, for a button with one. A switch-inline button for a chosen chat must allow at
 * least one kind of chat. Of URL buttons' links, a `tg://user?id=` link opens the user's profile
 * and is kept in that canonical form, and any other link must pass `check_link`, which normalizes
 * it, so that `grammy.dev` opens `http://grammy.dev/`. Telegram's servers decide whether the user
 * of a profile link may be shown, which the emulator does not check. Login and Web App buttons
 * need an HTTPS link, which cannot open a profile. A login button's bot was parsed and resolved
 * before TDLib checks it.
 */
function checkButtonAction(
  action: RichMessageButtonAction,
): ButtonChecking<{ readonly url?: string }> {
  switch (action.kind) {
    case 'url':
      return checkInlineButtonUrl(action.url);
    case 'login_url':
      return checkHttpsButtonUrl(action.url, 'inline_login');
    case 'web_app':
      return checkHttpsButtonUrl(action.url, 'inline_web_app');
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
 * Checks a URL button's link as TDLib's `get_inline_keyboard_button` does: a `tg://user?id=` link
 * opens the user's profile and is kept in that canonical form, and any other link must pass
 * `check_link`, which normalizes it.
 */
function checkInlineButtonUrl(url: string): ButtonChecking<{ readonly url?: string }> {
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
 * Checks the link of a login or Web App button, as TDLib does: an HTTPS link, as `check_link`
 * normalizes it, which cannot open a user's profile.
 */
function checkHttpsButtonUrl(
  url: string,
  button: HttpsLinkButton,
): ButtonChecking<{ readonly url: string }> {
  if (getLinkUserId(url) !== undefined) {
    return { read: false, buttonFailure: { reason: 'user_link_not_allowed', button } };
  }
  const linkCheck = checkLink(url, { httpsOnly: true });
  return linkCheck.valid ? { read: true, url: linkCheck.url } : {
    read: false,
    buttonFailure: { reason: 'button_url_invalid', button, linkError: linkCheck.error },
  };
}
