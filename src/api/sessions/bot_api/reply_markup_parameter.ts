import { z } from 'zod';

import {
  CHAT_ADMINISTRATOR_RIGHT_NAMES,
  normalizeDefaultAdministratorRights,
} from '../../../types/bot_default_administrator_rights.ts';
import type { ButtonAppearance } from '../../../types/button_appearance.ts';
import {
  type InlineKeyboard,
  type InlineKeyboardButton,
  MAX_COPIED_TEXT_LENGTH,
} from '../../../types/inline_keyboard.ts';
import type { RichMessageButtonAction } from '../../../types/rich_message.ts';
import type {
  BotMessageReplyMarkup,
  ReplyInterfaceMarkup,
  ReplyKeyboardButton,
  ReplyKeyboardButtonRequest,
} from '../../../types/reply_interface.ts';
import { jsonParameter, optionalInt64Identifier } from './request_parameters.ts';

/** Telegram's documented limit on an input field placeholder. */
const MAX_INPUT_FIELD_PLACEHOLDER_LENGTH = 64;

/**
 * A button's appearance, read as the official Bot API server's `get_button_style` reads its
 * `style`: the name in any ASCII letter case, where an empty name or `default` chooses the
 * client's default. Telegram also reads the icon's identifier from a JSON number, which cannot
 * hold every 64-bit identifier exactly, so the emulator requires the documented string.
 */
const buttonAppearanceShape = {
  style: z.string()
    .transform((style) => style.replace(/[A-Z]/g, (letter) => letter.toLowerCase()))
    .pipe(z.enum(['', 'default', 'primary', 'danger', 'success']))
    .transform((style) => style === '' || style === 'default' ? undefined : style)
    .optional(),
  icon_custom_emoji_id: optionalInt64Identifier().optional(),
};

function readButtonAppearance(
  { style, icon_custom_emoji_id }: {
    readonly style?: ButtonAppearance['style'];
    readonly icon_custom_emoji_id?: string;
  },
): ButtonAppearance {
  return {
    ...(style === undefined ? {} : { style }),
    ...(icon_custom_emoji_id === undefined ? {} : { iconCustomEmojiId: icon_custom_emoji_id }),
  };
}

/** Removes one leading `@`, if present; a second `@` stays for username validation to reject. */
function removeOneLeadingAtSign(username: string): string {
  return username.startsWith('@') ? username.slice(1) : username;
}

/**
 * The fields of a button's action, which must be exactly one supported action: a callback, a URL,
 * copying text, switching to inline mode, a login URL, a Web App, or none. Telegram also accepts
 * game and payment buttons, and buttons with several actions, using the first action it
 * recognizes; rejecting them instead surfaces unsupported or ambiguous markup in tests.
 */
const buttonActionSchema = z.union([
  z.strictObject({ callback_data: z.string().min(1) })
    .transform(({ callback_data }): RichMessageButtonAction => ({
      kind: 'callback',
      callbackData: callback_data,
    })),
  // Sending reads the link as Telegram does; an empty link would leave a text button, which
  // Telegram refuses in an inline keyboard.
  z.strictObject({ url: z.string().min(1) })
    .transform(({ url }): RichMessageButtonAction => ({ kind: 'url', url })),
  // TDLib accepts any copied text; the emulator enforces the Bot API's documented length.
  z.strictObject({
    copy_text: z.strictObject({ text: z.string().min(1).max(MAX_COPIED_TEXT_LENGTH) }),
  }).transform(({ copy_text }): RichMessageButtonAction => ({
    kind: 'copy_text',
    copiedText: copy_text.text,
  })),
  // `switch_inline_query` lets the user choose any chat, as the official Bot API server's
  // `get_inline_keyboard_button_type` reads it.
  z.strictObject({ switch_inline_query: z.string() })
    .transform(({ switch_inline_query }): RichMessageButtonAction => ({
      kind: 'switch_inline_query',
      query: switch_inline_query,
      target: {
        kind: 'chosen_chat',
        chatTypes: {
          allowsUserChats: true,
          allowsBotChats: true,
          allowsGroupChats: true,
          allowsChannelChats: true,
        },
      },
    })),
  // `switch_inline_query_chosen_chat` limits the chats the user may choose; an omitted kind is
  // not allowed. Sending checks that it allows at least one, as TDLib does.
  z.strictObject({
    switch_inline_query_chosen_chat: z.strictObject({
      query: z.string().default(''),
      allow_user_chats: z.boolean().default(false),
      allow_bot_chats: z.boolean().default(false),
      allow_group_chats: z.boolean().default(false),
      allow_channel_chats: z.boolean().default(false),
    }),
  }).transform(({ switch_inline_query_chosen_chat: chosenChat }): RichMessageButtonAction => ({
    kind: 'switch_inline_query',
    query: chosenChat.query,
    target: {
      kind: 'chosen_chat',
      chatTypes: {
        allowsUserChats: chosenChat.allow_user_chats,
        allowsBotChats: chosenChat.allow_bot_chats,
        allowsGroupChats: chosenChat.allow_group_chats,
        allowsChannelChats: chosenChat.allow_channel_chats,
      },
    },
  })),
  z.strictObject({ switch_inline_query_current_chat: z.string() })
    .transform(({ switch_inline_query_current_chat }): RichMessageButtonAction => ({
      kind: 'switch_inline_query',
      query: switch_inline_query_current_chat,
      target: { kind: 'current_chat' },
    })),
  // Sending checks the URL and the bot's username as Telegram does. The official Bot API server
  // reads a non-empty `bot_username` with or without one leading `@`.
  z.strictObject({
    login_url: z.strictObject({
      url: z.string(),
      forward_text: z.string().optional(),
      bot_username: z.string().optional(),
      request_write_access: z.boolean().default(false),
    }),
  }).transform(({ login_url: loginUrl }): RichMessageButtonAction => ({
    kind: 'login_url',
    url: loginUrl.url,
    // As in TDLib, empty forward text keeps the button's text in forwards.
    ...(loginUrl.forward_text === undefined || loginUrl.forward_text.length === 0
      ? {}
      : { forwardText: loginUrl.forward_text }),
    ...(loginUrl.bot_username === undefined || loginUrl.bot_username.length === 0
      ? {}
      : { authorizingBotUsername: removeOneLeadingAtSign(loginUrl.bot_username) }),
    requestsWriteAccess: loginUrl.request_write_access,
  })),
  // Sending checks the URL as Telegram does.
  z.strictObject({ web_app: z.strictObject({ url: z.string() }) })
    .transform(({ web_app }): RichMessageButtonAction => ({ kind: 'web_app', url: web_app.url })),
  // Telegram reads any `disabled` value; the emulator requires the documented empty object.
  z.strictObject({ disabled: z.strictObject({}) })
    .transform((): RichMessageButtonAction => ({ kind: 'disabled' })),
]);

/**
 * A button of an inline keyboard or of a rich message: the fields `faceShape` describes, which show
 * the button, and the fields of its action, as `buttonActionSchema` reads them. Parses as the
 * face's fields and the action.
 */
export function buttonSchema<FaceShape extends z.ZodRawShape>(faceShape: FaceShape) {
  const faceSchema = z.strictObject(faceShape);
  return z.record(z.string(), z.unknown()).transform((fields, context) => {
    const faceFields: Record<string, unknown> = {};
    const actionFields: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(fields)) {
      (Object.hasOwn(faceShape, name) ? faceFields : actionFields)[name] = value;
    }
    const face = faceSchema.safeParse(faceFields);
    const action = buttonActionSchema.safeParse(actionFields);
    if (!face.success || !action.success) {
      context.issues.push({
        code: 'custom',
        message: 'Expected the fields of a button and of one supported action',
        input: fields,
      });
      return z.NEVER;
    }
    return { face: face.data, action: action.data };
  });
}

const inlineKeyboardButtonSchema = buttonSchema({
  text: z.string().min(1),
  ...buttonAppearanceShape,
}).transform(({ face, action }): InlineKeyboardButton => ({
  ...action,
  text: face.text,
  ...readButtonAppearance(face),
}));

/**
 * An `InlineKeyboardMarkup` object, as `inlineKeyboardMarkupParameter` describes it, for objects
 * that hold one, such as inline query results.
 */
export const inlineKeyboardMarkupSchema = z.strictObject({
  inline_keyboard: z.array(z.array(inlineKeyboardButtonSchema).min(1)),
}).transform(({ inline_keyboard }): InlineKeyboard | undefined =>
  inline_keyboard.length === 0 ? undefined : inline_keyboard
);

/** Telegram reads a request's identifier as a signed 32-bit integer. */
const requestIdSchema = z.int().min(-(2 ** 31)).max(2 ** 31 - 1);

/**
 * `ChatAdministratorRights` that a chat request requires, read as the official Bot API server's
 * `get_chat_administrator_rights` reads them, where a missing right is not required.
 */
const requiredAdministratorRightsSchema = z.strictObject(
  Object.fromEntries(CHAT_ADMINISTRATOR_RIGHT_NAMES.map((name) => [name, z.boolean().optional()])),
).transform((rights) => CHAT_ADMINISTRATOR_RIGHT_NAMES.filter((name) => rights[name] === true));

/**
 * The fields of a reply keyboard button's request, which must be exactly one request, as the
 * official Bot API server's `get_keyboard_button_type` reads them under their documented names.
 * Telegram also reads legacy names and managed bot requests, and buttons with several requests,
 * using the first it recognizes; rejecting them instead surfaces ambiguous markup in tests.
 */
const replyKeyboardButtonRequestSchema = z.union([
  z.strictObject({ request_contact: z.literal(true) })
    .transform((): ReplyKeyboardButtonRequest => ({ kind: 'contact' })),
  z.strictObject({ request_location: z.literal(true) })
    .transform((): ReplyKeyboardButtonRequest => ({ kind: 'location' })),
  z.strictObject({
    request_poll: z.strictObject({ type: z.enum(['quiz', 'regular']).optional() }),
  }).transform(({ request_poll }): ReplyKeyboardButtonRequest => ({
    kind: 'poll',
    ...(request_poll.type === undefined ? {} : { pollType: request_poll.type }),
  })),
  // Sending checks the URL as Telegram does.
  z.strictObject({ web_app: z.strictObject({ url: z.string() }) })
    .transform(({ web_app }): ReplyKeyboardButtonRequest => ({
      kind: 'web_app',
      url: web_app.url,
    })),
  z.strictObject({
    request_users: z.strictObject({
      request_id: requestIdSchema,
      user_is_bot: z.boolean().optional(),
      user_is_premium: z.boolean().optional(),
      max_quantity: z.int().min(1).max(10).default(1),
      request_name: z.boolean().default(false),
      request_username: z.boolean().default(false),
      request_photo: z.boolean().default(false),
    }),
  }).transform(({ request_users: request }): ReplyKeyboardButtonRequest => ({
    kind: 'users',
    requestId: request.request_id,
    ...(request.user_is_bot === undefined ? {} : { userIsBot: request.user_is_bot }),
    ...(request.user_is_premium === undefined ? {} : { userIsPremium: request.user_is_premium }),
    maxQuantity: request.max_quantity,
    requestsName: request.request_name,
    requestsUsername: request.request_username,
    requestsPhoto: request.request_photo,
  })),
  z.strictObject({
    request_chat: z.strictObject({
      request_id: requestIdSchema,
      chat_is_channel: z.boolean(),
      chat_is_forum: z.boolean().optional(),
      chat_has_username: z.boolean().optional(),
      chat_is_created: z.boolean().default(false),
      user_administrator_rights: requiredAdministratorRightsSchema.optional(),
      bot_administrator_rights: requiredAdministratorRightsSchema.optional(),
      bot_is_member: z.boolean().default(false),
      request_title: z.boolean().default(false),
      request_username: z.boolean().default(false),
      request_photo: z.boolean().default(false),
    }),
  }).transform(({ request_chat: request }): ReplyKeyboardButtonRequest => {
    // As TDLib's `RequestedDialogType` does, the rights are kept for the requested kind of chat.
    const chatKind = request.chat_is_channel ? 'channel' : 'group';
    return {
      kind: 'chat',
      requestId: request.request_id,
      chatIsChannel: request.chat_is_channel,
      ...(request.chat_is_forum === undefined ? {} : { chatIsForum: request.chat_is_forum }),
      ...(request.chat_has_username === undefined
        ? {}
        : { chatHasUsername: request.chat_has_username }),
      chatIsCreated: request.chat_is_created,
      ...(request.user_administrator_rights === undefined ? {} : {
        userAdministratorRights: normalizeDefaultAdministratorRights(
          chatKind,
          request.user_administrator_rights,
        ),
      }),
      ...(request.bot_administrator_rights === undefined ? {} : {
        botAdministratorRights: normalizeDefaultAdministratorRights(
          chatKind,
          request.bot_administrator_rights,
        ),
      }),
      botIsMember: request.bot_is_member,
      requestsTitle: request.request_title,
      requestsUsername: request.request_username,
      requestsPhoto: request.request_photo,
    };
  }),
]);

const replyKeyboardButtonFaceSchema = z.strictObject({
  text: z.string().min(1),
  ...buttonAppearanceShape,
});

/**
 * A reply keyboard button: its text, which Telegram also reads from a plain string, its
 * appearance, and at most one request, as `replyKeyboardButtonRequestSchema` reads it.
 */
const replyKeyboardButtonSchema = z.union([
  z.string().min(1).transform((text): ReplyKeyboardButton => ({ text })),
  z.record(z.string(), z.unknown()).transform((fields, context): ReplyKeyboardButton => {
    const faceFields: Record<string, unknown> = {};
    const requestFields: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(fields)) {
      (Object.hasOwn(replyKeyboardButtonFaceSchema.shape, name) ? faceFields : requestFields)[
        name
      ] = value;
    }
    const face = replyKeyboardButtonFaceSchema.safeParse(faceFields);
    const request = Object.keys(requestFields).length === 0
      ? undefined
      : replyKeyboardButtonRequestSchema.safeParse(requestFields);
    if (!face.success || request?.success === false) {
      context.issues.push({
        code: 'custom',
        message: 'Expected the fields of a reply keyboard button and of at most one request',
        input: fields,
      });
      return z.NEVER;
    }
    return {
      text: face.data.text,
      ...readButtonAppearance(face.data),
      ...(request === undefined ? {} : { request: request.data }),
    };
  }),
]);

const inputFieldPlaceholderSchema = z.string().min(1).max(MAX_INPUT_FIELD_PLACEHOLDER_LENGTH);

// `selective` shows the markup only to mentioned users and the replied message's sender; as on
// Telegram, it has no effect in private chats.
const selectiveSchema = z.boolean().default(false);

const replyKeyboardMarkupSchema = z.strictObject({
  keyboard: z.array(z.array(replyKeyboardButtonSchema).min(1)),
  is_persistent: z.boolean().default(false),
  resize_keyboard: z.boolean().default(false),
  one_time_keyboard: z.boolean().default(false),
  input_field_placeholder: inputFieldPlaceholderSchema.optional(),
  selective: selectiveSchema,
}).transform((markup): ReplyInterfaceMarkup | undefined =>
  markup.keyboard.length === 0 ? undefined : {
    kind: 'reply_keyboard',
    rows: markup.keyboard,
    isPersistent: markup.is_persistent,
    resizesToFit: markup.resize_keyboard,
    isOneTime: markup.one_time_keyboard,
    ...(markup.input_field_placeholder === undefined
      ? {}
      : { inputFieldPlaceholder: markup.input_field_placeholder }),
    isSelective: markup.selective,
  }
);

const replyKeyboardRemovalSchema = z.strictObject({
  remove_keyboard: z.literal(true),
  selective: selectiveSchema,
}).transform(({ selective }): ReplyInterfaceMarkup => ({
  kind: 'reply_keyboard_removal',
  isSelective: selective,
}));

const forcedReplySchema = z.strictObject({
  force_reply: z.literal(true),
  input_field_placeholder: inputFieldPlaceholderSchema.optional(),
  selective: selectiveSchema,
}).transform(({ input_field_placeholder, selective }): ReplyInterfaceMarkup => ({
  kind: 'forced_reply',
  ...(input_field_placeholder === undefined
    ? {}
    : { inputFieldPlaceholder: input_field_placeholder }),
  isSelective: selective,
}));

/**
 * A `reply_markup` parameter holding an inline keyboard of callback, URL, copy-text,
 * switch-inline, login, Web App and disabled buttons, for methods that edit a message.
 *
 * As on Telegram, a keyboard without rows attaches no keyboard, so it parses as `undefined`.
 * Telegram also accepts game and payment buttons and buttons with several actions, using the first
 * action it recognizes; rejecting them instead surfaces unsupported or ambiguous markup in tests.
 * Telegram rejects callback data longer than 64 bytes only when sending, so that limit is checked
 * there.
 */
export function inlineKeyboardMarkupParameter() {
  return jsonParameter(inlineKeyboardMarkupSchema);
}

/**
 * A `reply_markup` parameter of a method that sends a message: an inline keyboard, as
 * `inlineKeyboardMarkupParameter` reads it, or a reply keyboard, its removal, or a forced reply.
 *
 * As on Telegram, a keyboard without rows attaches no markup. Markup that combines kinds, which
 * Telegram resolves by precedence, is rejected.
 */
export function messageReplyMarkupParameter() {
  return jsonParameter(
    z.union([
      inlineKeyboardMarkupSchema.transform((inlineKeyboard): BotMessageReplyMarkup =>
        inlineKeyboard === undefined ? {} : { inlineKeyboard }
      ),
      z.union([replyKeyboardMarkupSchema, replyKeyboardRemovalSchema, forcedReplySchema])
        .transform((replyInterfaceMarkup): BotMessageReplyMarkup =>
          replyInterfaceMarkup === undefined ? {} : { replyInterfaceMarkup }
        ),
    ]),
  );
}
