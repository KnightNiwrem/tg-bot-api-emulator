import { z } from 'zod';

import { accountProfileSchema } from '../../control_contracts/accounts.ts';
import { botProfileSchema } from '../../control_contracts/bots.ts';
import { controlValidationErrorSchema } from '../../control_contracts/control_errors.ts';
import {
  MAX_SUPERGROUP_OR_CHANNEL_ID,
  MAX_TELEGRAM_USER_ID,
  MIN_SUPERGROUP_OR_CHANNEL_ID,
  MIN_TELEGRAM_USER_ID,
} from './constants.ts';
import { CONTROL_REFUSAL_REASONS } from './control_refusal_reasons.ts';
import type {
  CallbackQuery,
  ControlErrorBody,
  InlineKeyboardMarkup,
  MessageEntity,
  MessageReactions,
  MessageSenderBot,
  PlainMessageEntityType,
  Poll,
  PollAnswer,
  PrivateMessage,
  ReactionTypeEmoji,
  ReplyInterface,
  ReplyKeyboardButton,
  RichBlock,
  RichMessage,
  RichMessageButton,
  RichText,
  RichTextObject,
  SupergroupMessage,
  UserReaction,
} from './types.ts';

const telegramUserIdSchema = z.number().int()
  .min(MIN_TELEGRAM_USER_ID)
  .max(MAX_TELEGRAM_USER_ID);

const supergroupIdSchema = z.number().int()
  .min(MIN_SUPERGROUP_OR_CHANNEL_ID)
  .max(MAX_SUPERGROUP_OR_CHANNEL_ID);

export const getMeResponseSchema = z.strictObject({
  ok: z.literal(true),
  result: botProfileSchema,
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
    user: z.union([accountProfileSchema, messageSenderBotSchema]),
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
      user: z.union([accountProfileSchema, messageSenderBotSchema]),
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
    z.strictObject({
      type: z.literal('video'),
      video: videoSchema.omit({ start_timestamp: true }),
      caption: richBlockCaptionSchema.optional(),
      has_spoiler: z.literal(true).optional(),
    }),
    z.strictObject({
      type: z.literal('voice_note'),
      voice_note: voiceSchema,
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
    sender_user: z.union([accountProfileSchema, messageSenderBotSchema]),
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
    from: z.union([accountProfileSchema, messageSenderBotSchema]),
    chat,
    date: z.number().int().nonnegative(),
    edit_date: z.number().int().nonnegative().optional(),
    forward_origin: messageOriginSchema.optional(),
    forward_from: z.union([accountProfileSchema, messageSenderBotSchema]).optional(),
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

const videoSchema = z.strictObject({
  duration: z.number().int().nonnegative(),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
  file_name: z.string().min(1).optional(),
  mime_type: z.string().regex(/^video\//),
  start_timestamp: z.number().int().positive().optional(),
  thumbnail: photoSizeSchema.optional(),
  thumb: photoSizeSchema.optional(),
  ...messageFileShape,
});

const voiceSchema = z.strictObject({
  duration: z.number().int().nonnegative(),
  mime_type: z.enum(['audio/ogg', 'audio/mpeg', 'audio/mp4']),
  ...messageFileShape,
});

const audioSchema = z.strictObject({
  duration: z.number().int().nonnegative(),
  file_name: z.string().min(1).optional(),
  mime_type: z.string().regex(/^audio\//),
  title: z.string().min(1).optional(),
  performer: z.string().min(1).optional(),
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

const videoContentShape = {
  video: videoSchema,
  ...captionShape,
  show_caption_above_media: z.literal(true).optional(),
  has_media_spoiler: z.literal(true).optional(),
};

const voiceContentShape = { voice: voiceSchema, ...captionShape };

const audioContentShape = { audio: audioSchema, ...captionShape };

const contactSchema = z.strictObject({
  phone_number: z.string().min(1),
  first_name: z.string().min(1),
  last_name: z.string().min(1).optional(),
  vcard: z.string().min(1).optional(),
  user_id: z.number().int().positive().optional(),
});

const locationSchema = z.strictObject({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  horizontal_accuracy: z.int().min(1).max(1500).optional(),
});

const pollSchema: z.ZodType<Poll> = z.strictObject({
  id: z.string().regex(/^[1-9]\d*$/),
  question: z.string().min(1),
  question_entities: z.array(messageEntitySchema).min(1).optional(),
  options: z.array(z.strictObject({
    persistent_id: z.string().min(1),
    text: z.string().min(1),
    text_entities: z.array(messageEntitySchema).min(1).optional(),
    voter_count: z.number().int().nonnegative(),
  })).min(1),
  total_voter_count: z.number().int().nonnegative(),
  open_period: z.number().int().positive().optional(),
  close_date: z.number().int().positive().optional(),
  is_closed: z.boolean(),
  is_anonymous: z.boolean(),
  allows_multiple_answers: z.boolean(),
  allows_revoting: z.boolean(),
  members_only: z.literal(false),
  type: z.enum(['regular', 'quiz']),
  correct_option_id: z.number().int().nonnegative().optional(),
  correct_option_ids: z.array(z.number().int().nonnegative()).min(1).optional(),
  explanation: z.string().min(1).optional(),
  explanation_entities: z.array(messageEntitySchema).optional(),
});

export const expiredPollResponseSchema = z.strictObject({ poll: pollSchema });

const externalReplyShape = {
  origin: messageOriginSchema,
  chat: supergroupChatSchema.optional(),
  message_id: z.number().int().positive().optional(),
};

/** How a message replies to a message of another chat, and what it quotes of a replied message. */
const messageReplyInfoShape = {
  // The replied message's media, which only a photo, document, video, voice, or audio message has,
  // or its poll, contact, or location.
  external_reply: z.union([
    z.strictObject(externalReplyShape),
    z.strictObject({ ...externalReplyShape, poll: pollSchema }),
    z.strictObject({
      ...externalReplyShape,
      photo: z.array(photoSizeSchema).min(1),
      has_media_spoiler: z.literal(true).optional(),
    }),
    z.strictObject({ ...externalReplyShape, document: documentSchema }),
    z.strictObject({
      ...externalReplyShape,
      video: videoSchema,
      has_media_spoiler: z.literal(true).optional(),
    }),
    z.strictObject({ ...externalReplyShape, voice: voiceSchema }),
    z.strictObject({ ...externalReplyShape, audio: audioSchema }),
    z.strictObject({ ...externalReplyShape, contact: contactSchema }),
    z.strictObject({ ...externalReplyShape, location: locationSchema }),
  ]).optional(),
  quote: z.strictObject({
    text: z.string().min(1),
    entities: z.array(messageEntitySchema).min(1).optional(),
    position: z.number().int().nonnegative(),
    is_manual: z.literal(true).optional(),
  }).optional(),
};

/** The album a message belongs to, which follows its reply and precedes its content. */
const messageAlbumInfoShape = {
  media_group_id: z.string().regex(/^[1-9]\d*$/).optional(),
};

const messageTrailerShape = {
  reply_markup: inlineKeyboardMarkupSchema.optional(),
  via_bot: messageSenderBotSchema.optional(),
  has_protected_content: z.literal(true).optional(),
  effect_id: z.string().regex(/^-?\d+$/).optional(),
};

const messageUserSchema = z.union([accountProfileSchema, messageSenderBotSchema]);

/** A user's standing once its temporary restriction ends, as bots see it. */
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
    z.strictObject({ ...header, ...videoContentShape, ...messageTrailerShape }),
    z.strictObject({ ...header, ...voiceContentShape, ...messageTrailerShape }),
    z.strictObject({ ...header, ...audioContentShape, ...messageTrailerShape }),
    z.strictObject({ ...header, rich_message: richMessageSchema, ...messageTrailerShape }),
    z.strictObject({ ...header, poll: pollSchema, ...messageTrailerShape }),
    z.strictObject({ ...header, contact: contactSchema, ...messageTrailerShape }),
    z.strictObject({ ...header, location: locationSchema, ...messageTrailerShape }),
  ] as const;
}

/**
 * A service message about a pin, with fields as `contentMessageSchemas` reads them: the pinned
 * message, which is never a service message, as a reply shows it, or, once deleted, inaccessible.
 */
function pinServiceMessageSchema<
  Header extends z.ZodRawShape,
  PinnedHeader extends z.ZodRawShape,
  ChatSchema extends z.ZodType,
>(header: Header, pinnedMessageHeader: PinnedHeader, chatSchema: ChatSchema) {
  return z.strictObject({
    ...header,
    pinned_message: z.union([
      ...contentMessageSchemas(pinnedMessageHeader),
      z.strictObject({
        message_id: z.number().int().positive(),
        chat: chatSchema,
        date: z.literal(0),
      }),
    ]),
    ...messageTrailerShape,
  });
}

/**
 * A service message about a pin as a replied message shows it, as `pinServiceMessageSchema` reads
 * it, but without a deleted pinned message, which the server leaves out there.
 */
function repliedPinServiceMessageSchema<Header extends z.ZodRawShape>(header: Header) {
  return z.strictObject({
    ...header,
    pinned_message: z.union(contentMessageSchemas(header)).optional(),
    ...messageTrailerShape,
  });
}

/**
 * A service message about members joining or leaving, or about a new title, as
 * `contentMessageSchemas` reads others.
 */
function supergroupChangeMessageSchemas<Header extends z.ZodRawShape>(header: Header) {
  return [
    z.strictObject({ ...header, ...membersJoinedContentShape, ...messageTrailerShape }),
    z.strictObject({ ...header, ...memberLeftContentShape, ...messageTrailerShape }),
    z.strictObject({ ...header, new_chat_title: z.string().min(1), ...messageTrailerShape }),
  ] as const;
}

const sharedUserSchema = z.strictObject({
  user_id: z.number().int().positive(),
  first_name: z.string().min(1).optional(),
  last_name: z.string().min(1).optional(),
  username: z.string().min(1).optional(),
});

/**
 * A service message about what an account sent the bot from its client, as
 * `contentMessageSchemas` reads others: the users or the supergroup it shared, a single shared user
 * also showing as the legacy `user_shared`, or the data a Web App sent.
 */
function accountServiceMessageSchemas<Header extends z.ZodRawShape>(header: Header) {
  return [
    z.strictObject({
      ...header,
      user_shared: z.strictObject({
        user_id: z.number().int().positive(),
        request_id: z.number().int(),
      }).optional(),
      users_shared: z.strictObject({
        user_ids: z.array(z.number().int().positive()).min(1),
        users: z.array(sharedUserSchema).min(1),
        request_id: z.number().int(),
      }),
      ...messageTrailerShape,
    }),
    z.strictObject({
      ...header,
      chat_shared: z.strictObject({
        chat_id: z.number().int().negative(),
        title: z.string().min(1).optional(),
        username: z.string().min(1).optional(),
        request_id: z.number().int(),
      }),
      ...messageTrailerShape,
    }),
    z.strictObject({
      ...header,
      web_app_data: z.strictObject({
        button_text: z.string().min(1),
        data: z.string().min(1),
      }),
      ...messageTrailerShape,
    }),
  ] as const;
}

// A reply, which shows no reply of its own, comes between a message's header and content, as does
// a reply to another chat or a quote, which a replied message still shows.
const privateMessageHeader = {
  ...messageHeaderShape(privateChatSchema),
  ...messageReplyInfoShape,
  ...messageAlbumInfoShape,
};

const supergroupMessageHeader = {
  ...messageHeaderShape(supergroupChatSchema),
  ...messageReplyInfoShape,
  ...messageAlbumInfoShape,
};

// A private message, which may be a service message about a pin, about users or a chat an account
// shared or about data a Web App sent, with its replied message, which may be one too.
const privateMessageSchema: z.ZodType<PrivateMessage> = z.union([
  ...contentMessageSchemas({ ...privateMessageHeader, reply_to_message: repliedPrivateMessage() }),
  pinServiceMessageSchema(
    { ...privateMessageHeader, reply_to_message: repliedPrivateMessage() },
    privateMessageHeader,
    privateChatSchema,
  ),
  ...accountServiceMessageSchemas({
    ...privateMessageHeader,
    reply_to_message: repliedPrivateMessage(),
  }),
]);

/** The message a private message replies to, which never shows its own reply. */
function repliedPrivateMessage() {
  return z.union([
    ...contentMessageSchemas(privateMessageHeader),
    repliedPinServiceMessageSchema(privateMessageHeader),
    ...accountServiceMessageSchemas(privateMessageHeader),
  ]).optional();
}

/** The message a supergroup message replies to, which never shows its own reply. */
function repliedSupergroupMessage() {
  return z.union([
    ...contentMessageSchemas(supergroupMessageHeader),
    ...supergroupChangeMessageSchemas(supergroupMessageHeader),
    repliedPinServiceMessageSchema(supergroupMessageHeader),
  ]).optional();
}

// Supergroup messages, which service messages about changes of the supergroup and pins are among.
const supergroupMessageSchema: z.ZodType<SupergroupMessage> = z.union([
  ...contentMessageSchemas({
    ...supergroupMessageHeader,
    reply_to_message: repliedSupergroupMessage(),
  }),
  ...supergroupChangeMessageSchemas({
    ...supergroupMessageHeader,
    reply_to_message: repliedSupergroupMessage(),
  }),
  pinServiceMessageSchema(
    { ...supergroupMessageHeader, reply_to_message: repliedSupergroupMessage() },
    supergroupMessageHeader,
    supergroupChatSchema,
  ),
]);

export const sentMessageResponseSchema = z.strictObject({
  message: privateMessageSchema,
});

export const messageHistoryResponseSchema = z.strictObject({
  messages: z.array(privateMessageSchema),
});

export const sentSupergroupMessageResponseSchema = z.strictObject({
  message: supergroupMessageSchema,
});

export const sentMediaGroupResponseSchema = z.strictObject({
  messages: z.array(privateMessageSchema),
});

export const sentSupergroupMediaGroupResponseSchema = z.strictObject({
  messages: z.array(supergroupMessageSchema),
});

export const supergroupMessageHistoryResponseSchema = z.strictObject({
  messages: z.array(supergroupMessageSchema),
});

const pollAnswerSchema: z.ZodType<PollAnswer> = z.strictObject({
  poll_id: z.string().regex(/^[1-9]\d*$/),
  option_ids: z.array(z.number().int().nonnegative()),
  option_persistent_ids: z.array(z.string().min(1)),
});

export const pollAnswerResponseSchema = z.strictObject({
  poll_answer: pollAnswerSchema,
  message: privateMessageSchema,
});

export const supergroupPollAnswerResponseSchema = z.strictObject({
  poll_answer: pollAnswerSchema,
  message: supergroupMessageSchema,
});

const reactionTypeEmojiSchema: z.ZodType<ReactionTypeEmoji> = z.strictObject({
  type: z.literal('emoji'),
  emoji: z.string().min(1),
});

const userReactionSchema: z.ZodType<UserReaction> = z.strictObject({
  user_id: telegramUserIdSchema,
  reaction: z.array(reactionTypeEmojiSchema).length(1),
});

export const messageReactionsResponseSchema: z.ZodType<MessageReactions> = z.strictObject({
  message: supergroupMessageSchema,
  reactions: z.array(userReactionSchema),
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

export const messageDraftResponseSchema = z.strictObject({
  message_draft: z.strictObject({
    draft_id: z.string().regex(/^-?[1-9][0-9]*$/),
    text: z.string(),
    entities: z.array(messageEntitySchema).min(1).optional(),
    can_stop: z.boolean(),
    keep_on_stop: z.boolean(),
    is_stopped: z.boolean(),
  }).nullable(),
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

/** A message sent from an inline query's answer, to the private chat or supergroup of the query. */
export const chosenInlineResultResponseSchema = z.strictObject({
  message: z.union([privateMessageSchema, supergroupMessageSchema]),
});

/**
 * A control error body: input that breaks an operation's contract, with at least one issue, or
 * another refusal, which names only its reason.
 */
export const controlErrorBodySchema: z.ZodType<ControlErrorBody> = z.union([
  controlValidationErrorSchema,
  z.strictObject({
    reason: z.enum(CONTROL_REFUSAL_REASONS),
  }),
]);
