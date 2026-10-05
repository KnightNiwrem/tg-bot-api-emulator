import type { DefaultAdministratorRights } from './bot_default_administrator_rights.ts';
import type { ButtonAppearance } from './button_appearance.ts';
import type { GeoLocation } from './geo_location.ts';
import type { InlineKeyboard } from './inline_keyboard.ts';
import type { SpecifiedAccountPoll } from './poll.ts';

/**
 * A request that the user choose users to share with the bot, as the Bot API's
 * `KeyboardButtonRequestUsers` describes it.
 */
export interface ReplyKeyboardUsersRequest {
  readonly kind: 'users';
  /** Identifies the request in the service message that shares the users. */
  readonly requestId: number;
  /** Requires bots when `true` and other users when `false`; omitted for either. */
  readonly userIsBot?: boolean;
  /** Requires Premium users when `true` and other users when `false`; omitted for either. */
  readonly userIsPremium?: boolean;
  /** How many users the user may choose, from 1 to 10. */
  readonly maxQuantity: number;
  readonly requestsName: boolean;
  readonly requestsUsername: boolean;
  readonly requestsPhoto: boolean;
}

/**
 * A request that the user choose a chat to share with the bot, as the Bot API's
 * `KeyboardButtonRequestChat` describes it.
 */
export interface ReplyKeyboardChatRequest {
  readonly kind: 'chat';
  /** Identifies the request in the service message that shares the chat. */
  readonly requestId: number;
  /** Requires a channel rather than a group. */
  readonly chatIsChannel: boolean;
  /** Requires a forum when `true` and another chat when `false`; omitted for either. */
  readonly chatIsForum?: boolean;
  /** Requires a public chat when `true` and a private one when `false`; omitted for either. */
  readonly chatHasUsername?: boolean;
  /** Requires a chat the user created. */
  readonly chatIsCreated: boolean;
  /**
   * The rights the user must have in the chat, kept for the chat's kind as TDLib's
   * `AdministratorRights` keeps them; omitted for no requirement.
   */
  readonly userAdministratorRights?: DefaultAdministratorRights;
  /** The rights the bot must have in the chat, kept as `userAdministratorRights` is. */
  readonly botAdministratorRights?: DefaultAdministratorRights;
  /** Requires a chat of which the bot is a member. */
  readonly botIsMember: boolean;
  readonly requestsTitle: boolean;
  readonly requestsUsername: boolean;
  readonly requestsPhoto: boolean;
}

/**
 * What a reply keyboard button asks the user's client to do instead of sending the button's text:
 * share the user's contact or location, create a poll, open a Web App, or share users or a chat.
 * TDLib allows such buttons only in private chats.
 */
export type ReplyKeyboardButtonRequest =
  | { readonly kind: 'contact' }
  | { readonly kind: 'location' }
  | {
    readonly kind: 'poll';
    /** The only type of poll the user may create; omitted for either. */
    readonly pollType?: 'quiz' | 'regular';
  }
  | {
    readonly kind: 'web_app';
    /** The HTTPS page the Web App opens. */
    readonly url: string;
  }
  | ReplyKeyboardUsersRequest
  | ReplyKeyboardChatRequest;

/**
 * What the user's client answers a reply keyboard button's request with, by the request's kind:
 * the location the client reports, the users the user chose, the chat the user chose, or the poll
 * the user created. A button that requests the user's contact takes no answer, as the client
 * shares the user's own contact.
 */
export type ReplyKeyboardRequestAnswer =
  | { readonly kind: 'location'; readonly location: GeoLocation }
  | {
    readonly kind: 'users';
    /** The chosen users' IDs, in the order the user chose them. */
    readonly userIds: readonly number[];
  }
  | { readonly kind: 'chat'; readonly chatId: number }
  | { readonly kind: 'poll'; readonly poll: SpecifiedAccountPoll };

/**
 * Whether a poll the user created is of the type a `request_poll` button allows, as Telegram's
 * clients lock the poll creation form's quiz switch when the button names a type.
 */
export function isRequestedPollType(
  request: Extract<ReplyKeyboardButtonRequest, { readonly kind: 'poll' }>,
  poll: SpecifiedAccountPoll,
): boolean {
  return request.pollType === undefined || request.pollType === poll.type.kind;
}

/**
 * A reply keyboard button, which sends its text to the chat as the user's message, or asks the
 * user's client to do what its request describes.
 */
export interface ReplyKeyboardButton extends ButtonAppearance {
  readonly text: string;
  /** Omitted for a button that sends its text. */
  readonly request?: ReplyKeyboardButtonRequest;
}

/**
 * A custom keyboard that the recipient's client shows in place of its letter keyboard. The
 * keyboard has at least one row and no empty rows.
 */
export interface ReplyKeyboard {
  readonly kind: 'reply_keyboard';
  readonly rows: readonly (readonly ReplyKeyboardButton[])[];
  /** Keeps the keyboard shown even when the client would otherwise hide it. */
  readonly isPersistent: boolean;
  /** Fits the keyboard's height to its rows instead of the letter keyboard's height. */
  readonly resizesToFit: boolean;
  /**
   * Hides the keyboard once a button is pressed; the keyboard stays available and can be shown
   * again, as on Telegram.
   */
  readonly isOneTime: boolean;
  /** Shown in the input field while the keyboard is shown; omitted for the client's default. */
  readonly inputFieldPlaceholder?: string;
  /**
   * The Bot API's `selective`: in a group, applies the markup only to the users the message
   * mentions and the sender of the message of the chat that it replies to, rather than to every
   * member. As in TDLib's `get_reply_markup`, it has no effect in private chats.
   */
  readonly isSelective: boolean;
}

/** A request that the recipient's client show a reply interface to the message. */
export interface ForcedReply {
  readonly kind: 'forced_reply';
  /** Shown in the input field while replying; omitted for the client's default. */
  readonly inputFieldPlaceholder?: string;
  /** As `ReplyKeyboard` describes it. */
  readonly isSelective: boolean;
}

/**
 * What a message asks its recipient's client to show in place of the usual input. The chat keeps
 * showing it until a later message replaces or removes it, or the message is deleted.
 */
export type ReplyInterface = ReplyKeyboard | ForcedReply;

/** A request that the recipient's client remove the reply keyboard it shows. */
export interface ReplyKeyboardRemoval {
  readonly kind: 'reply_keyboard_removal';
  /** As `ReplyKeyboard` describes it. */
  readonly isSelective: boolean;
}

/**
 * Reply markup other than an inline keyboard: it changes the reply interface of the recipient's
 * client instead of adding buttons to the message.
 */
export type ReplyInterfaceMarkup = ReplyInterface | ReplyKeyboardRemoval;

/**
 * Finds the button of a reply keyboard with the given text, which pressing it sends unless the
 * button has a request. Returns `undefined` if the keyboard has no such button.
 */
export function findReplyKeyboardButton(
  replyKeyboard: ReplyKeyboard,
  text: string,
): ReplyKeyboardButton | undefined {
  for (const row of replyKeyboard.rows) {
    const button = row.find((candidate) => candidate.text === text);
    if (button !== undefined) {
      return button;
    }
  }
  return undefined;
}

/**
 * TDLib's description of a reply keyboard button request that a chat other than a private chat
 * cannot show, as its `KeyboardButton::get_keyboard_button` describes it.
 */
const GROUP_REPLY_KEYBOARD_REQUEST_ERRORS: {
  readonly [Kind in ReplyKeyboardButtonRequest['kind']]: string;
} = {
  contact: 'Phone number can be requested in private chats only',
  location: 'Location can be requested in private chats only',
  poll: 'Poll can be requested in private chats only',
  web_app: 'Web App buttons can be used in private chats only',
  users: 'Users can be requested in private chats only',
  chat: 'Chats can be requested in private chats only',
};

/**
 * TDLib's description of a request that a chat other than a private chat cannot show on a reply
 * keyboard button.
 */
export function getGroupReplyKeyboardRequestError(request: ReplyKeyboardButtonRequest): string {
  return GROUP_REPLY_KEYBOARD_REQUEST_ERRORS[request.kind];
}

/**
 * Whether a group message's reply interface markup applies to a member, as TDLib's
 * `get_reply_markup` decides for received markup: markup that is not selective applies to every
 * member, and selective markup only to a member whom the message mentions or whose message it
 * replies to, which Telegram marks as mentioning the member.
 */
export function appliesReplyInterfaceTo(
  { isSelective }: ReplyInterfaceMarkup,
  { mentionsMember, repliesToMember }: {
    readonly mentionsMember: boolean;
    readonly repliesToMember: boolean;
  },
): boolean {
  return !isSelective || mentionsMember || repliesToMember;
}

/**
 * The reply markup a bot sends with a message: an inline keyboard on the message, or a change of
 * the recipient's reply interface, but not both.
 */
export type BotMessageReplyMarkup =
  | { readonly inlineKeyboard?: InlineKeyboard; readonly replyInterfaceMarkup?: never }
  | { readonly inlineKeyboard?: never; readonly replyInterfaceMarkup: ReplyInterfaceMarkup };
