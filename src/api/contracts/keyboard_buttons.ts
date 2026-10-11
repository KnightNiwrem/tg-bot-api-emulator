/**
 * Wire facts of the buttons Telegram's clients show with a bot's messages: the inline keyboard
 * below a message, and the reply keyboard a bot asks the client to show in place of its letter
 * keyboard. Both are Telegram's types, as the Bot API shows them.
 *
 * Each type is declared beside its schema, which it annotates, because readers tell the kinds of
 * button apart by the fields they read.
 */
import { z } from 'zod';

import { TELEGRAM_TYPE_ANNOTATION } from './wire_fields.ts';

/** A button's text and how Telegram clients draw it. */
export interface KeyboardButtonFace {
  readonly text: string;
  /** The custom emoji shown before the text; omitted for none. */
  readonly icon_custom_emoji_id?: string;
  /** Omitted for the client's default style. */
  readonly style?: 'primary' | 'danger' | 'success';
}

export interface CallbackInlineKeyboardButton extends KeyboardButtonFace {
  readonly callback_data: string;
}

/** A button that opens a link, including a login button, which the emulator shows by its URL. */
export interface UrlInlineKeyboardButton extends KeyboardButtonFace {
  readonly url: string;
}

/** A button that copies text to the clipboard. */
export interface CopyTextInlineKeyboardButton extends KeyboardButtonFace {
  readonly copy_text: { readonly text: string };
}

/**
 * A button that puts the bot's username and a query into the input field of a chat the user
 * chooses; tests send the inline query itself.
 */
export interface SwitchInlineQueryInlineKeyboardButton extends KeyboardButtonFace {
  readonly switch_inline_query: string;
}

/** A button that puts the bot's username and a query into the message's own chat. */
export interface SwitchInlineQueryCurrentChatInlineKeyboardButton extends KeyboardButtonFace {
  readonly switch_inline_query_current_chat: string;
}

/** A switch-inline button that lets the user choose only some kinds of chats. */
export interface SwitchInlineQueryChosenChatInlineKeyboardButton extends KeyboardButtonFace {
  readonly switch_inline_query_chosen_chat: {
    readonly query: string;
    readonly allow_user_chats: boolean;
    readonly allow_bot_chats: boolean;
    readonly allow_group_chats: boolean;
    readonly allow_channel_chats: boolean;
  };
}

/** A button that opens a Web App of the message's bot. */
export interface WebAppInlineKeyboardButton extends KeyboardButtonFace {
  readonly web_app: { readonly url: string };
}

/** A button that does nothing. */
export interface DisabledInlineKeyboardButton extends KeyboardButtonFace {
  readonly disabled: Record<string, never>;
}

export type InlineKeyboardButton =
  | CallbackInlineKeyboardButton
  | UrlInlineKeyboardButton
  | CopyTextInlineKeyboardButton
  | SwitchInlineQueryInlineKeyboardButton
  | SwitchInlineQueryCurrentChatInlineKeyboardButton
  | SwitchInlineQueryChosenChatInlineKeyboardButton
  | WebAppInlineKeyboardButton
  | DisabledInlineKeyboardButton;

export interface InlineKeyboardMarkup {
  readonly inline_keyboard: readonly (readonly InlineKeyboardButton[])[];
}

/**
 * Administrator rights that a chat request requires: every right that applies to the requested
 * kind of chat, by its Bot API name, required or not.
 */
export type RequiredChatAdministratorRights = Readonly<Record<string, boolean>>;

/**
 * What a reply keyboard button asks the client to share instead of sending its text, in the
 * fields of a Bot API `KeyboardButton`. Pressing a `request_contact` button shares the account's
 * own contact, pressing a `request_location` button shares the location the press reports,
 * pressing a `request_users` or `request_chat` button shares the users or supergroup the press
 * chooses, pressing a `request_poll` button sends the poll the press creates, and pressing a
 * `web_app` button sends the data the press gives.
 */
export type ReplyKeyboardButtonRequest =
  | { readonly request_contact: true }
  | { readonly request_location: true }
  | { readonly request_poll: { readonly type?: 'quiz' | 'regular' } }
  | { readonly web_app: { readonly url: string } }
  | {
    readonly request_users: {
      readonly request_id: number;
      readonly user_is_bot?: boolean;
      readonly user_is_premium?: boolean;
      readonly max_quantity: number;
      readonly request_name: boolean;
      readonly request_username: boolean;
      readonly request_photo: boolean;
    };
  }
  | {
    readonly request_chat: {
      readonly request_id: number;
      readonly chat_is_channel: boolean;
      readonly chat_is_forum?: boolean;
      readonly chat_has_username?: boolean;
      readonly chat_is_created: boolean;
      readonly user_administrator_rights?: RequiredChatAdministratorRights;
      readonly bot_administrator_rights?: RequiredChatAdministratorRights;
      readonly bot_is_member: boolean;
      readonly request_title: boolean;
      readonly request_username: boolean;
      readonly request_photo: boolean;
    };
  };

/**
 * A reply keyboard button, which sends its text to the chat when pressed, or asks the client to
 * share what its request describes.
 */
export type ReplyKeyboardButton =
  | KeyboardButtonFace
  | (KeyboardButtonFace & ReplyKeyboardButtonRequest);

const keyboardButtonFaceShape = {
  text: z.string().min(1),
  icon_custom_emoji_id: z.string().regex(/^-?[1-9]\d*$/).optional(),
  style: z.enum(['primary', 'danger', 'success']).optional(),
};

/**
 * A button of each kind of action an inline keyboard button takes, with the fields of its face
 * that `faceShape` describes.
 */
export function inlineButtonSchemas<FaceShape extends z.ZodRawShape>(faceShape: FaceShape) {
  return [
    z.strictObject({ ...faceShape, callback_data: z.string() }),
    z.strictObject({ ...faceShape, url: z.string() }),
    z.strictObject({ ...faceShape, copy_text: z.strictObject({ text: z.string() }) }),
    z.strictObject({ ...faceShape, switch_inline_query: z.string() }),
    z.strictObject({ ...faceShape, switch_inline_query_current_chat: z.string() }),
    z.strictObject({
      ...faceShape,
      switch_inline_query_chosen_chat: z.strictObject({
        query: z.string(),
        allow_user_chats: z.boolean(),
        allow_bot_chats: z.boolean(),
        allow_group_chats: z.boolean(),
        allow_channel_chats: z.boolean(),
      }),
    }),
    z.strictObject({ ...faceShape, web_app: z.strictObject({ url: z.string() }) }),
    z.strictObject({ ...faceShape, disabled: z.strictObject({}) }),
  ] as const;
}

/** The inline keyboard a bot attached to a message, in rows of at least one button. */
export const inlineKeyboardMarkupSchema: z.ZodType<InlineKeyboardMarkup> = z.strictObject({
  inline_keyboard: z.array(
    z.array(z.union(inlineButtonSchemas(keyboardButtonFaceShape))).min(1),
  ).min(1),
});

const requiredChatAdministratorRightsSchema = z.record(z.string(), z.boolean());

/** A reply keyboard button, as the Bot API's `KeyboardButton`, with at most one request. */
export const replyKeyboardButtonSchema: z.ZodType<ReplyKeyboardButton> = z.union([
  z.strictObject(keyboardButtonFaceShape),
  z.strictObject({ ...keyboardButtonFaceShape, request_contact: z.literal(true) }),
  z.strictObject({ ...keyboardButtonFaceShape, request_location: z.literal(true) }),
  z.strictObject({
    ...keyboardButtonFaceShape,
    request_poll: z.strictObject({ type: z.enum(['quiz', 'regular']).optional() }),
  }),
  z.strictObject({ ...keyboardButtonFaceShape, web_app: z.strictObject({ url: z.string() }) }),
  z.strictObject({
    ...keyboardButtonFaceShape,
    request_users: z.strictObject({
      request_id: z.int(),
      user_is_bot: z.boolean().optional(),
      user_is_premium: z.boolean().optional(),
      max_quantity: z.int().min(1),
      request_name: z.boolean(),
      request_username: z.boolean(),
      request_photo: z.boolean(),
    }),
  }),
  z.strictObject({
    ...keyboardButtonFaceShape,
    request_chat: z.strictObject({
      request_id: z.int(),
      chat_is_channel: z.boolean(),
      chat_is_forum: z.boolean().optional(),
      chat_has_username: z.boolean().optional(),
      chat_is_created: z.boolean(),
      user_administrator_rights: requiredChatAdministratorRightsSchema.optional(),
      bot_administrator_rights: requiredChatAdministratorRightsSchema.optional(),
      bot_is_member: z.boolean(),
      request_title: z.boolean(),
      request_username: z.boolean(),
      request_photo: z.boolean(),
    }),
  }),
]).meta({ [TELEGRAM_TYPE_ANNOTATION]: 'KeyboardButton' });
