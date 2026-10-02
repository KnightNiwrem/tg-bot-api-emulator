import { z } from 'zod';

import {
  MAX_SUPERGROUP_OR_CHANNEL_ID,
  MAX_TELEGRAM_USER_ID,
  MIN_SUPERGROUP_OR_CHANNEL_ID,
  MIN_TELEGRAM_USER_ID,
} from './constants.ts';
import type {
  BotActivityEntry,
  CallbackQuery,
  CreatedVirtualBot,
  EmulationSession,
  InlineKeyboardMarkup,
  InlineQuery,
  MessageEntity,
  MessageSenderBot,
  PlainMessageEntityType,
  PrivateMessage,
  RateLimitResponses,
  ReplyInterface,
  ReplyKeyboardButton,
  RichBlock,
  RichMessage,
  RichMessageButton,
  RichText,
  RichTextObject,
  Supergroup,
  SupergroupMessage,
  VirtualAccountProfile,
  VirtualBotProfile,
} from './types.ts';

interface CreatedVirtualAccountResponse {
  readonly account: VirtualAccountProfile;
}

const telegramUserIdSchema = z.number().int()
  .min(MIN_TELEGRAM_USER_ID)
  .max(MAX_TELEGRAM_USER_ID);

const supergroupIdSchema = z.number().int()
  .min(MIN_SUPERGROUP_OR_CHANNEL_ID)
  .max(MAX_SUPERGROUP_OR_CHANNEL_ID);

const virtualBotProfileSchema: z.ZodType<VirtualBotProfile> = z.strictObject({
  id: telegramUserIdSchema,
  is_bot: z.literal(true),
  first_name: z.string(),
  username: z.string(),
  can_join_groups: z.boolean(),
  can_read_all_group_messages: z.boolean(),
  supports_guest_queries: z.boolean().optional(),
  supports_inline_queries: z.boolean(),
  can_connect_to_business: z.boolean(),
  has_main_web_app: z.boolean(),
  has_topics_enabled: z.boolean(),
  allows_users_to_create_topics: z.boolean(),
  can_manage_bots: z.boolean(),
  supports_join_request_queries: z.boolean(),
});

export const virtualAccountProfileSchema: z.ZodType<VirtualAccountProfile> = z.strictObject({
  id: telegramUserIdSchema,
  is_bot: z.literal(false),
  first_name: z.string(),
  last_name: z.string().optional(),
  username: z.string().optional(),
  language_code: z.string().optional(),
});

export const emulationSessionSchema: z.ZodType<EmulationSession> = z.strictObject({
  id: z.uuid(),
  botApiRoot: z.url(),
  uploadProfile: z.enum(['cloud', 'local']),
});

export const createdVirtualBotSchema: z.ZodType<CreatedVirtualBot> = z.strictObject({
  token: z.string().min(1),
  bot: virtualBotProfileSchema,
});

export const rateLimitResponsesSchema: z.ZodType<RateLimitResponses> = z.strictObject({
  method: z.string().min(1).optional(),
  retry_after: z.int().positive(),
  remaining_count: z.int().positive(),
});

export const rateLimitResponsesListSchema = z.strictObject({
  rate_limit_responses: z.array(rateLimitResponsesSchema),
});

export const createdVirtualAccountSchema: z.ZodType<CreatedVirtualAccountResponse> = z.strictObject(
  {
    account: virtualAccountProfileSchema,
  },
);

export const getMeResponseSchema = z.strictObject({
  ok: z.literal(true),
  result: virtualBotProfileSchema,
});

const messageSenderBotSchema: z.ZodType<MessageSenderBot> = z.strictObject({
  id: telegramUserIdSchema,
  is_bot: z.literal(true),
  first_name: z.string(),
  last_name: z.string().optional(),
  username: z.string(),
});

const privateChatSchema = z.strictObject({
  id: telegramUserIdSchema,
  type: z.literal('private'),
  first_name: z.string(),
  last_name: z.string().optional(),
  username: z.string().optional(),
});

const supergroupChatSchema = z.strictObject({
  id: supergroupIdSchema,
  title: z.string(),
  username: z.string().min(1).optional(),
  type: z.literal('supergroup'),
});

const messageEntitySpanShape = {
  offset: z.number().int().nonnegative(),
  length: z.number().int().positive(),
};

const messageEntitySchema: z.ZodType<MessageEntity> = z.union([
  z.strictObject({
    type: z.enum(
      [
        'mention',
        'hashtag',
        'cashtag',
        'bot_command',
        'url',
        'email',
        'bank_card_number',
        'bold',
        'italic',
        'underline',
        'strikethrough',
        'spoiler',
        'code',
        'blockquote',
        'expandable_blockquote',
      ] satisfies PlainMessageEntityType[],
    ),
    ...messageEntitySpanShape,
  }),
  z.strictObject({
    type: z.literal('pre'),
    ...messageEntitySpanShape,
    language: z.string().min(1).optional(),
  }),
  z.strictObject({ type: z.literal('text_link'), ...messageEntitySpanShape, url: z.string() }),
  z.strictObject({
    type: z.literal('text_mention'),
    ...messageEntitySpanShape,
    user: z.union([virtualAccountProfileSchema, messageSenderBotSchema]),
  }),
  z.strictObject({
    type: z.literal('custom_emoji'),
    ...messageEntitySpanShape,
    custom_emoji_id: z.string().regex(/^-?\d+$/),
  }),
  z.strictObject({
    type: z.literal('date_time'),
    ...messageEntitySpanShape,
    unix_time: z.int().positive(),
    date_time_format: z.string().regex(/^(r|w?[dD]?[tT]?)$/),
  }),
]);

const keyboardButtonFaceShape = {
  text: z.string().min(1),
  icon_custom_emoji_id: z.string().regex(/^-?[1-9]\d*$/).optional(),
  style: z.enum(['primary', 'danger', 'success']).optional(),
};

/** A button of each kind of action, with the fields of its face that `faceShape` describes. */
function inlineButtonSchemas<FaceShape extends z.ZodRawShape>(faceShape: FaceShape) {
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

const inlineKeyboardMarkupSchema: z.ZodType<InlineKeyboardMarkup> = z.strictObject({
  inline_keyboard: z.array(
    z.array(z.union(inlineButtonSchemas(keyboardButtonFaceShape))).min(1),
  ).min(1),
});

const richTextSchema: z.ZodType<RichText> = z.lazy(() =>
  z.union([z.string(), z.array(richTextSchema), richTextObjectSchema])
);

const richMessageButtonSchema: z.ZodType<RichMessageButton> = z.lazy(() =>
  z.union(inlineButtonSchemas({
    text: richTextSchema,
    style: z.enum(['primary', 'danger', 'success', 'link']).optional(),
  }))
);

const richTextObjectSchema: z.ZodType<RichTextObject> = z.lazy(() =>
  z.union([
    z.strictObject({
      type: z.enum([
        'bold',
        'italic',
        'underline',
        'strikethrough',
        'spoiler',
        'subscript',
        'superscript',
        'marked',
        'code',
      ]),
      text: richTextSchema,
    }),
    z.strictObject({
      type: z.literal('date_time'),
      text: richTextSchema,
      unix_time: z.int().positive(),
      date_time_format: z.string().regex(/^(r|w?[dD]?[tT]?)$/),
    }),
    z.strictObject({ type: z.literal('mention'), text: richTextSchema, username: z.string() }),
    z.strictObject({ type: z.literal('hashtag'), text: richTextSchema, hashtag: z.string() }),
    z.strictObject({ type: z.literal('cashtag'), text: richTextSchema, cashtag: z.string() }),
    z.strictObject({
      type: z.literal('bot_command'),
      text: richTextSchema,
      bot_command: z.string(),
    }),
    z.strictObject({
      type: z.literal('bank_card_number'),
      text: richTextSchema,
      bank_card_number: z.string(),
    }),
    z.strictObject({
      type: z.literal('text_mention'),
      text: richTextSchema,
      user: z.union([virtualAccountProfileSchema, messageSenderBotSchema]),
    }),
    z.strictObject({ type: z.literal('url'), text: richTextSchema, url: z.string() }),
    z.strictObject({
      type: z.literal('email_address'),
      text: richTextSchema,
      email_address: z.string(),
    }),
    z.strictObject({
      type: z.literal('phone_number'),
      text: richTextSchema,
      phone_number: z.string(),
    }),
    z.strictObject({
      type: z.literal('custom_emoji'),
      custom_emoji_id: z.string().regex(/^-?[1-9]\d*$/),
      alternative_text: z.string(),
    }),
    z.strictObject({ type: z.literal('mathematical_expression'), expression: z.string() }),
    z.strictObject({ type: z.literal('reference'), text: richTextSchema, name: z.string() }),
    z.strictObject({
      type: z.literal('reference_link'),
      text: richTextSchema,
      reference_name: z.string(),
    }),
    z.strictObject({ type: z.literal('anchor'), name: z.string() }),
    z.strictObject({
      type: z.literal('anchor_link'),
      text: richTextSchema,
      anchor_name: z.string(),
    }),
    z.strictObject({ type: z.literal('button'), button: richMessageButtonSchema }),
  ])
);

const horizontalAlignmentSchema = z.enum(['left', 'center', 'right']);

const richBlockCaptionSchema = z.strictObject({
  text: richTextSchema,
  credit: richTextSchema.optional(),
});

const richBlockSchema: z.ZodType<RichBlock> = z.lazy(() =>
  z.union([
    z.strictObject({ type: z.enum(['paragraph', 'footer']), text: richTextSchema }),
    z.strictObject({
      type: z.literal('heading'),
      text: richTextSchema,
      size: z.int().min(1).max(6),
    }),
    z.strictObject({
      type: z.literal('pre'),
      text: richTextSchema,
      language: z.string().min(1).optional(),
    }),
    z.strictObject({ type: z.literal('divider') }),
    z.strictObject({ type: z.literal('mathematical_expression'), expression: z.string() }),
    z.strictObject({ type: z.literal('anchor'), name: z.string() }),
    z.strictObject({
      type: z.literal('list'),
      items: z.array(z.strictObject({
        label: z.string().min(1),
        blocks: z.array(richBlockSchema).min(1),
        has_checkbox: z.literal(true).optional(),
        is_checked: z.literal(true).optional(),
        type: z.enum(['a', 'A', 'i', 'I', '1']).optional(),
        value: z.int().optional(),
      })).min(1),
    }),
    z.strictObject({
      type: z.literal('blockquote'),
      blocks: z.array(richBlockSchema),
      credit: richTextSchema.optional(),
    }),
    z.strictObject({
      type: z.enum(['expandable_blockquote', 'pullquote']),
      text: richTextSchema,
      credit: richTextSchema.optional(),
    }),
    z.strictObject({
      type: z.enum(['collage', 'slideshow']),
      blocks: z.array(richBlockSchema),
      caption: richBlockCaptionSchema.optional(),
    }),
    z.strictObject({
      type: z.literal('table'),
      cells: z.array(z.array(z.strictObject({
        text: richTextSchema.optional(),
        is_header: z.literal(true).optional(),
        colspan: z.int().min(2).optional(),
        rowspan: z.int().min(2).optional(),
        align: horizontalAlignmentSchema,
        valign: z.enum(['top', 'middle', 'bottom']),
      }))),
      caption: richTextSchema.optional(),
      is_bordered: z.literal(true).optional(),
      is_striped: z.literal(true).optional(),
      is_compact: z.literal(true).optional(),
    }),
    z.strictObject({
      type: z.literal('details'),
      summary: richTextSchema,
      blocks: z.array(richBlockSchema),
      is_open: z.literal(true).optional(),
    }),
    z.strictObject({
      type: z.literal('map'),
      location: z.strictObject({
        latitude: z.number(),
        longitude: z.number(),
        horizontal_accuracy: z.number().positive().optional(),
      }),
      zoom: z.int().min(0).max(24),
      width: z.int().nonnegative(),
      height: z.int().nonnegative(),
      caption: richBlockCaptionSchema.optional(),
    }),
    z.strictObject({
      type: z.literal('buttons'),
      buttons: z.array(richMessageButtonSchema).min(1),
      align: horizontalAlignmentSchema.optional(),
    }),
    z.strictObject({
      type: z.literal('photo'),
      photo: z.array(photoSizeSchema).min(1),
      caption: richBlockCaptionSchema.optional(),
      has_spoiler: z.literal(true).optional(),
    }),
    z.strictObject({
      type: z.literal('document'),
      document: documentSchema,
      caption: richBlockCaptionSchema.optional(),
    }),
  ])
);

const richMessageSchema: z.ZodType<RichMessage> = z.strictObject({
  blocks: z.array(richBlockSchema).min(1),
  is_rtl: z.literal(true).optional(),
});

/** Where a forward, or the message of another chat a reply shows, first appeared. */
const messageOriginSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('user'),
    sender_user: z.union([virtualAccountProfileSchema, messageSenderBotSchema]),
    date: z.number().int().nonnegative(),
  }),
  z.strictObject({
    type: z.literal('hidden_user'),
    sender_user_name: z.string().min(1),
    date: z.number().int().nonnegative(),
  }),
]);

/** The fields that precede a message's reply, for a chat of the given schema. */
function messageHeaderShape<Chat extends z.ZodType>(chat: Chat) {
  return {
    message_id: z.number().int().positive(),
    from: z.union([virtualAccountProfileSchema, messageSenderBotSchema]),
    chat,
    date: z.number().int().nonnegative(),
    edit_date: z.number().int().nonnegative().optional(),
    forward_origin: messageOriginSchema.optional(),
    forward_from: z.union([virtualAccountProfileSchema, messageSenderBotSchema]).optional(),
    forward_sender_name: z.string().min(1).optional(),
    forward_date: z.number().int().nonnegative().optional(),
  };
}

const messageFileShape = {
  file_id: z.string().min(1),
  file_unique_id: z.string().min(1),
  file_size: z.number().int().positive(),
};

const photoSizeSchema = z.strictObject({
  ...messageFileShape,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

const documentSchema = z.strictObject({
  file_name: z.string().min(1),
  mime_type: z.string().min(1),
  thumbnail: photoSizeSchema.optional(),
  thumb: photoSizeSchema.optional(),
  ...messageFileShape,
});

const captionShape = {
  caption: z.string().min(1).optional(),
  caption_entities: z.array(messageEntitySchema).min(1).optional(),
};

const textContentShape = {
  text: z.string(),
  entities: z.array(messageEntitySchema).min(1).optional(),
};

const photoContentShape = {
  photo: z.array(photoSizeSchema).min(1),
  ...captionShape,
  show_caption_above_media: z.literal(true).optional(),
  has_media_spoiler: z.literal(true).optional(),
};

const documentContentShape = { document: documentSchema, ...captionShape };

const externalReplyShape = {
  origin: messageOriginSchema,
  chat: supergroupChatSchema.optional(),
  message_id: z.number().int().positive().optional(),
};

/** How a message replies to a message of another chat, and what it quotes of a replied message. */
const messageReplyInfoShape = {
  // The replied message's media, which only a photo or document message has.
  external_reply: z.union([
    z.strictObject(externalReplyShape),
    z.strictObject({
      ...externalReplyShape,
      photo: z.array(photoSizeSchema).min(1),
      has_media_spoiler: z.literal(true).optional(),
    }),
    z.strictObject({ ...externalReplyShape, document: documentSchema }),
  ]).optional(),
  quote: z.strictObject({
    text: z.string().min(1),
    entities: z.array(messageEntitySchema).min(1).optional(),
    position: z.number().int().nonnegative(),
    is_manual: z.literal(true).optional(),
  }).optional(),
};

const messageTrailerShape = {
  reply_markup: inlineKeyboardMarkupSchema.optional(),
  via_bot: messageSenderBotSchema.optional(),
  has_protected_content: z.literal(true).optional(),
  effect_id: z.string().regex(/^-?\d+$/).optional(),
};

const messageUserSchema = z.union([virtualAccountProfileSchema, messageSenderBotSchema]);

const membersJoinedContentShape = {
  new_chat_participant: messageUserSchema,
  new_chat_member: messageUserSchema,
  new_chat_members: z.array(messageUserSchema).min(1),
};

const memberLeftContentShape = {
  left_chat_participant: messageUserSchema,
  left_chat_member: messageUserSchema,
};

/**
 * A message with the given fields before its content, of each content kind, with fields in the
 * order the server sends them.
 */
function contentMessageSchemas<Header extends z.ZodRawShape>(header: Header) {
  return [
    z.strictObject({ ...header, ...textContentShape, ...messageTrailerShape }),
    z.strictObject({ ...header, ...photoContentShape, ...messageTrailerShape }),
    z.strictObject({ ...header, ...documentContentShape, ...messageTrailerShape }),
    z.strictObject({ ...header, rich_message: richMessageSchema, ...messageTrailerShape }),
  ] as const;
}

/**
 * A service message about members joining or leaving, or about a new title, as
 * `contentMessageSchemas` reads others.
 */
function serviceMessageSchemas<Header extends z.ZodRawShape>(header: Header) {
  return [
    z.strictObject({ ...header, ...membersJoinedContentShape, ...messageTrailerShape }),
    z.strictObject({ ...header, ...memberLeftContentShape, ...messageTrailerShape }),
    z.strictObject({ ...header, new_chat_title: z.string().min(1), ...messageTrailerShape }),
  ] as const;
}

// A reply, which shows no reply of its own, comes between a message's header and content, as does
// a reply to another chat or a quote, which a replied message still shows.
const privateMessageHeader = { ...messageHeaderShape(privateChatSchema), ...messageReplyInfoShape };

const privateMessageSchema: z.ZodType<PrivateMessage> = z.union(contentMessageSchemas({
  ...privateMessageHeader,
  reply_to_message: z.union(contentMessageSchemas(privateMessageHeader)).optional(),
}));

const supergroupMessageHeader = {
  ...messageHeaderShape(supergroupChatSchema),
  ...messageReplyInfoShape,
};

/** Supergroup messages, which service messages about changes of the supergroup are among. */
function supergroupMessageSchemas<Header extends z.ZodRawShape>(header: Header) {
  return [...contentMessageSchemas(header), ...serviceMessageSchemas(header)] as const;
}

const supergroupMessageSchema: z.ZodType<SupergroupMessage> = z.union(supergroupMessageSchemas({
  ...supergroupMessageHeader,
  reply_to_message: z.union(supergroupMessageSchemas(supergroupMessageHeader)).optional(),
}));

export const sentMessageResponseSchema = z.strictObject({
  message: privateMessageSchema,
});

export const messageHistoryResponseSchema = z.strictObject({
  messages: z.array(privateMessageSchema),
});

export const sentSupergroupMessageResponseSchema = z.strictObject({
  message: supergroupMessageSchema,
});

export const supergroupMessageHistoryResponseSchema = z.strictObject({
  messages: z.array(supergroupMessageSchema),
});

const supergroupSchema: z.ZodType<Supergroup> = z.strictObject({
  id: supergroupIdSchema,
  type: z.literal('supergroup'),
  title: z.string().min(1),
  username: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
});

export const createdSupergroupResponseSchema = z.strictObject({
  supergroup: supergroupSchema,
});

const callbackQuerySchema: z.ZodType<CallbackQuery> = z.strictObject({
  id: z.string().min(1),
  callback_data: z.string(),
  status: z.enum(['awaiting_answer', 'answered', 'expired']),
  answer: z.strictObject({
    text: z.string().optional(),
    show_alert: z.boolean(),
    url: z.string().min(1).optional(),
    cache_time: z.number().int().nonnegative(),
  }).nullable(),
});

const botCommandSchema = z.strictObject({
  command: z.string().min(1),
  description: z.string().min(1),
  is_ephemeral: z.boolean(),
});

export const botCommandsResponseSchema = z.strictObject({
  commands: z.array(botCommandSchema),
});

export const menuButtonResponseSchema = z.strictObject({
  menu_button: z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('commands') }),
    z.strictObject({
      type: z.literal('web_app'),
      text: z.string().min(1),
      web_app: z.strictObject({ url: z.string() }),
    }),
    z.strictObject({ type: z.literal('default') }),
  ]),
});

export const notificationsResponseSchema = z.strictObject({
  notifications: z.array(z.strictObject({
    message_id: z.number().int().positive(),
    is_silent: z.boolean(),
  })),
});

export const chatActionsResponseSchema = z.strictObject({
  chat_actions: z.array(z.strictObject({
    bot_id: z.number().int().positive(),
    action: z.enum([
      'typing',
      'record_video',
      'upload_video',
      'record_voice',
      'upload_voice',
      'upload_photo',
      'upload_document',
      'choose_sticker',
      'find_location',
      'record_video_note',
      'upload_video_note',
    ]),
  })),
});

export const supergroupBotCommandsResponseSchema = z.strictObject({
  bot_commands: z.array(z.strictObject({
    bot_id: z.number().int().positive(),
    commands: z.array(botCommandSchema),
  })),
});

const requiredChatAdministratorRightsSchema = z.record(z.string(), z.boolean());

/** A reply keyboard button, with at most one request. */
const replyKeyboardButtonSchema: z.ZodType<ReplyKeyboardButton> = z.union([
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
]);

const replyInterfaceSchema: z.ZodType<ReplyInterface> = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('keyboard'),
    message_id: z.number().int().positive(),
    keyboard: z.array(z.array(replyKeyboardButtonSchema).min(1)).min(1),
    is_persistent: z.boolean(),
    resize_keyboard: z.boolean(),
    one_time_keyboard: z.boolean(),
    input_field_placeholder: z.string().min(1).optional(),
  }),
  z.strictObject({
    type: z.literal('force_reply'),
    message_id: z.number().int().positive(),
    input_field_placeholder: z.string().min(1).optional(),
  }),
]);

export const replyInterfaceResponseSchema = z.strictObject({
  reply_interface: replyInterfaceSchema.nullable(),
});

export const callbackQueryResponseSchema = z.strictObject({
  callback_query: callbackQuerySchema,
});

const messageTargetSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('private'), botId: telegramUserIdSchema }),
  z.strictObject({ type: z.literal('supergroup'), chatId: supergroupIdSchema }),
]);

const inlineQuerySchema: z.ZodType<InlineQuery> = z.strictObject({
  id: z.string().min(1),
  bot_id: telegramUserIdSchema,
  chat: messageTargetSchema,
  query: z.string(),
  offset: z.string(),
  location: z.strictObject({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    horizontal_accuracy: z.int().min(1).max(1500).optional(),
  }).optional(),
  status: z.enum(['awaiting_answer', 'answered']),
  answer: z.strictObject({
    results: z.array(z.strictObject({
      type: z.enum(['article', 'photo', 'document']),
      id: z.string().min(1),
      title: z.string().min(1).optional(),
      description: z.string().min(1).optional(),
      url: z.string().min(1).optional(),
    })),
    cache_time: z.number().int().nonnegative(),
    is_personal: z.boolean(),
    next_offset: z.string(),
    button: z.union([
      z.strictObject({ text: z.string(), start_parameter: z.string().min(1) }),
      z.strictObject({ text: z.string(), web_app: z.strictObject({ url: z.url() }) }),
    ]).optional(),
  }).nullable(),
});

export const inlineQueryResponseSchema = z.strictObject({
  inline_query: inlineQuerySchema,
});

/** A message sent from an inline query's answer, to the private chat or supergroup of the query. */
export const chosenInlineResultResponseSchema = z.strictObject({
  message: z.union([privateMessageSchema, supergroupMessageSchema]),
});

const botActivityPositionSchema = z.int().min(1);

const botApiCallEntrySchema = z.strictObject({
  position: botActivityPositionSchema,
  kind: z.literal('bot_api_call'),
  bot_id: telegramUserIdSchema,
  method: z.string().min(1),
  requested_method: z.string().min(1),
  via: z.enum(['http', 'webhook_reply']),
  parameters: z.record(z.string(), z.string()),
  uploaded_files: z.array(z.strictObject({
    field_name: z.string(),
    file_name: z.string(),
    size_bytes: z.int().nonnegative(),
  })),
  chat_id: z.int().optional(),
  answer: z.union([
    z.strictObject({
      ok: z.literal(true),
      result: z.unknown(),
      description: z.string().optional(),
    }),
    z.strictObject({
      ok: z.literal(false),
      error_code: z.int(),
      description: z.string(),
      parameters: z.strictObject({ retry_after: z.int().positive() }).optional(),
    }),
  ]),
});

const botUpdateTransportSchema = z.enum(['polling', 'webhook']);

const updateDeliveredEntrySchema = z.strictObject({
  position: botActivityPositionSchema,
  kind: z.literal('update_delivered'),
  bot_id: telegramUserIdSchema,
  via: botUpdateTransportSchema,
  update: z.looseObject({ update_id: z.int() }),
  chat_id: z.int().optional(),
  user_id: z.int(),
});

const updateConfirmedEntrySchema = z.strictObject({
  position: botActivityPositionSchema,
  kind: z.literal('update_confirmed'),
  bot_id: telegramUserIdSchema,
  via: botUpdateTransportSchema,
  update_id: z.int(),
  chat_id: z.int().optional(),
  user_id: z.int(),
});

const botActivityEntrySchema: z.ZodType<BotActivityEntry> = z.discriminatedUnion('kind', [
  botApiCallEntrySchema,
  updateDeliveredEntrySchema,
  updateConfirmedEntrySchema,
]);

export const botActivityReadResponseSchema = z.strictObject({
  entries: z.array(botActivityEntrySchema),
  head_position: z.int().nonnegative(),
});
