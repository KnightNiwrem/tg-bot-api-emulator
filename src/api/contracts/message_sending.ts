/**
 * The contracts of the messages and albums an account sends to its private chat with a bot or to
 * a supergroup it is a member of, and of the forwards it makes there, each answering with the sent
 * message as the chat's message history shows it.
 */
import { z } from 'zod';

import { MAX_MESSAGE_TEXT_LENGTH, messageEntityInputSchema } from './account_messages.ts';
import { accountPathSchema } from './accounts.ts';
import { privateMessageSchema, supergroupMessageSchema } from './chat_messages.ts';
import { controlRefusalSchema, controlValidationErrorSchema } from './control_errors.ts';
import { defineControlOperation } from './operation_contract.ts';
import {
  accountLocationInputSchema,
  base64TextSchema,
  messageTargetSchema,
} from './wire_fields.ts';

/** The longest duration of a video, voice note, or audio file, in seconds: a day. */
export const MAX_MEDIA_DURATION_SECONDS = 86_400;

/** The widest or tallest a video may be, in pixels. */
export const MAX_VIDEO_SIDE_LENGTH = 10_000;

/** The most messages of an album. */
export const MAX_ALBUM_MESSAGE_COUNT = 10;

/** The most characters of a contact's first or last name, as TDLib limits them. */
export const MAX_CONTACT_NAME_LENGTH = 64;

/** Entities an account specifies, as `messageEntityInputSchema` reads each; omitted for none. */
export const messageEntityInputListSchema = z.array(messageEntityInputSchema).optional();

/**
 * The ID of the chat's message to reply to, as message history shows it; omitted to send a
 * message that replies to none.
 */
const replyToMessageIdSchema = z.int().min(1).optional();

/** Where a message the account sends goes: its chat, and the message it replies to, if any. */
const sentMessageTargetShape = {
  to: messageTargetSchema,
  reply_to_message_id: replyToMessageIdSchema,
};

/**
 * A caption, normalized as message text is; empty, or with no visible characters, for none. Its
 * length is checked when it is sent.
 */
const captionShape = {
  caption: z.string().default(''),
  caption_entities: messageEntityInputListSchema,
};

/**
 * A file's bytes as base64 text, which the server reads as `Uint8Array.fromBase64` does, refusing
 * other text as an `invalid_value` issue. Empty content is refused as `file_empty` when sent.
 */
const uploadContentSchema = base64TextSchema;

/** The duration of a recording its client defines, in seconds; 0 when omitted. */
const mediaDurationSchema = z.int().min(0).max(MAX_MEDIA_DURATION_SECONDS).default(0);

/** A side of a video its client defines, in pixels; 0 when omitted. */
const videoSideSchema = z.int().min(0).max(MAX_VIDEO_SIDE_LENGTH).default(0);

/** A photo the account uploads, with an optional caption. */
const accountPhotoShape = {
  photo: z.strictObject({ content_base64: uploadContentSchema }),
  ...captionShape,
};

/** A document the account uploads under a file name, with an optional caption. */
const accountDocumentShape = {
  document: z.strictObject({
    content_base64: uploadContentSchema,
    file_name: z.string().min(1),
  }),
  ...captionShape,
};

/**
 * A video the account uploads, with an optional caption. Its client defines its duration and
 * dimensions, and may name its file, whose extension decides its `video/` MIME type, or else
 * `video/mp4`.
 */
const accountVideoShape = {
  video: z.strictObject({
    content_base64: uploadContentSchema,
    file_name: z.string().min(1).optional(),
    duration: mediaDurationSchema,
    width: videoSideSchema,
    height: videoSideSchema,
  }),
  ...captionShape,
};

/**
 * A voice note the account records, with an optional caption. Its client defines its duration,
 * and records it as `audio/ogg`, as Telegram's clients record OGG/Opus.
 */
const accountVoiceShape = {
  voice: z.strictObject({
    content_base64: uploadContentSchema,
    duration: mediaDurationSchema,
  }),
  ...captionShape,
};

/**
 * An audio file, such as a music track, the account uploads, with an optional caption. Its client
 * defines its duration, and its performer and title, which are none when empty, without reading
 * tags from the content, and may name its file, whose extension decides its `audio/` MIME type,
 * or else `audio/mpeg`.
 */
const accountAudioShape = {
  audio: z.strictObject({
    content_base64: uploadContentSchema,
    file_name: z.string().min(1).optional(),
    duration: mediaDurationSchema,
    performer: z.string().default(''),
    title: z.string().default(''),
  }),
  ...captionShape,
};

/** A poll option's text, with the formatting the account specifies, of which custom emoji stay. */
const accountPollOptionSchema = z.strictObject({
  text: z.string(),
  text_entities: messageEntityInputListSchema,
});

/**
 * A poll an account creates, with the settings `sendPoll` takes from bots and their defaults: an
 * anonymous poll, with one answer, and revoting allowed for a regular poll but not for a quiz. A
 * quiz lists its correct options, as option positions in increasing order, and may explain them;
 * a regular poll has neither, and explanation entities need an explanation, rules the server
 * checks and refuses as an `invalid_value` issue at the poll. Its texts are normalized, and its
 * limits checked, when it is sent.
 */
export const accountPollInputSchema = z.strictObject({
  question: z.string(),
  question_entities: messageEntityInputListSchema,
  options: z.array(accountPollOptionSchema),
  is_anonymous: z.boolean().default(true),
  type: z.enum(['regular', 'quiz']).default('regular'),
  allows_multiple_answers: z.boolean().default(false),
  allows_revoting: z.boolean().optional(),
  correct_option_ids: z.array(z.int().min(0)).optional(),
  explanation: z.string().optional(),
  explanation_entities: messageEntityInputListSchema,
});

/**
 * A contact the account writes: a nonempty phone number in any form and first name, with an
 * optional last name and vCard, which is never parsed and must fit in the bytes the Bot API
 * allows, a rule the server checks and refuses as an `invalid_value` issue. Its Telegram user
 * stays unknown, as the emulator never looks users up by phone number.
 */
const accountContactSchema = z.strictObject({
  phone_number: z.string().min(1),
  first_name: z.string().min(1).max(MAX_CONTACT_NAME_LENGTH),
  last_name: z.string().max(MAX_CONTACT_NAME_LENGTH).default(''),
  vcard: z.string().default(''),
});

/**
 * A text message, a photo, a document, a video, a voice note, or an audio file, each with an
 * optional caption; a contact the account writes, or its own contact, which Telegram shows as the
 * account's user; a static location; a new poll; or a forward of a message of one of the
 * account's chats, which, as in Telegram's clients, replies to none.
 */
const sendAccountMessageRequestSchema = z.union([
  z.strictObject({
    ...sentMessageTargetShape,
    text: z.string().min(1).max(MAX_MESSAGE_TEXT_LENGTH),
    entities: messageEntityInputListSchema,
  }),
  z.strictObject({ ...sentMessageTargetShape, ...accountPhotoShape }),
  z.strictObject({ ...sentMessageTargetShape, ...accountDocumentShape }),
  z.strictObject({ ...sentMessageTargetShape, ...accountVideoShape }),
  z.strictObject({ ...sentMessageTargetShape, ...accountVoiceShape }),
  z.strictObject({ ...sentMessageTargetShape, ...accountAudioShape }),
  z.strictObject({ ...sentMessageTargetShape, contact: accountContactSchema }),
  z.strictObject({ ...sentMessageTargetShape, own_contact: z.literal(true) }),
  z.strictObject({ ...sentMessageTargetShape, location: accountLocationInputSchema }),
  z.strictObject({ ...sentMessageTargetShape, poll: accountPollInputSchema }),
  z.strictObject({
    to: messageTargetSchema,
    forward: z.strictObject({
      chat: messageTargetSchema,
      /** The message's ID as the chat's bots see it, which is how these routes show messages. */
      message_id: z.int().min(1),
    }),
  }),
]);

/**
 * The photos, videos, documents, or audio files of an album, in the order the chat shows them,
 * each with an optional caption. Whether they can form an album, including how many they are, is
 * checked as Telegram checks it.
 */
const sendAccountMediaGroupRequestSchema = z.strictObject({
  ...sentMessageTargetShape,
  media: z.array(z.union([
    z.strictObject(accountPhotoShape),
    z.strictObject(accountDocumentShape),
    z.strictObject(accountVideoShape),
    z.strictObject(accountAudioShape),
  ])),
});

/** The message an account sent: of its private chat with a bot, or of a supergroup. */
export const sentChatMessageResponseSchema = z.union([
  z.strictObject({ message: privateMessageSchema }),
  z.strictObject({ message: supergroupMessageSchema }),
]);

/** The account's chat or a chat of the request that is not found. */
const sentMessageNotFoundSchema = controlRefusalSchema([
  'account_not_found',
  'bot_not_found',
  'chat_not_found',
  'session_not_found',
]);

/**
 * Sends a message as the account to its private chat with a bot, or to a supergroup it is a
 * member of, or forwards a message of such a chat there, and returns the message as the chat's
 * message history shows it.
 */
export const sendAccountMessageContract = defineControlOperation({
  operationId: 'sendAccountMessage',
  method: 'POST',
  path: '/sessions/{sessionId}/accounts/{accountId}/messages',
  params: accountPathSchema,
  body: { required: true, schema: sendAccountMessageRequestSchema },
  success: {
    status: 201,
    body: { kind: 'json', schema: sentChatMessageResponseSchema },
    actionReceipt: 'before_action',
  },
  refusals: {
    // Content Telegram refuses is input the schema accepts but the server refuses.
    400: z.union([
      controlValidationErrorSchema,
      controlRefusalSchema([
        'bot_upload_too_big',
        'caption_too_long',
        'file_empty',
        'image_invalid',
        'invoice_forwarding_unsupported',
        'message_not_forwardable',
        'message_text_empty',
        'message_text_too_long',
        'photo_dimensions_invalid',
        'photo_too_big',
        'poll_has_too_many_options',
        'poll_option_too_long',
        'poll_options_missing',
        'poll_question_too_long',
        'quiz_correct_option_not_found',
        'quiz_correct_options_missing',
        'quiz_correct_options_not_increasing',
        'quiz_explanation_has_too_many_line_feeds',
        'quiz_explanation_too_long',
        'reply_message_not_found',
        'text_invalid',
      ]),
    ]),
    403: controlRefusalSchema(['not_a_member', 'send_permission_missing']),
    404: controlRefusalSchema([
      'account_not_found',
      'bot_not_found',
      'chat_not_found',
      'message_not_found',
      'session_not_found',
    ]),
    409: controlRefusalSchema(['account_phone_number_missing', 'bot_blocked']),
  },
});

/**
 * Sends an album as the account to its private chat with a bot, or to a supergroup it is a member
 * of, and returns its messages as the chat's message history shows them.
 */
export const sendAccountMediaGroupContract = defineControlOperation({
  operationId: 'sendAccountMediaGroup',
  method: 'POST',
  path: '/sessions/{sessionId}/accounts/{accountId}/media-groups',
  params: accountPathSchema,
  body: { required: true, schema: sendAccountMediaGroupRequestSchema },
  success: {
    status: 201,
    body: {
      kind: 'json',
      schema: z.union([
        z.strictObject({
          messages: z.array(privateMessageSchema).min(1).max(MAX_ALBUM_MESSAGE_COUNT),
        }),
        z.strictObject({
          messages: z.array(supergroupMessageSchema).min(1).max(MAX_ALBUM_MESSAGE_COUNT),
        }),
      ]),
    },
    actionReceipt: 'before_action',
  },
  refusals: {
    // An album Telegram refuses is input the schema accepts but the server refuses.
    400: z.union([
      controlValidationErrorSchema,
      controlRefusalSchema([
        'album_audio_mixed',
        'album_caption_placement_mixed',
        'album_documents_mixed',
        'album_empty',
        'album_too_large',
        'bot_upload_too_big',
        'caption_too_long',
        'file_empty',
        'image_invalid',
        'message_text_too_long',
        'photo_dimensions_invalid',
        'photo_too_big',
        'reply_message_not_found',
        'text_invalid',
      ]),
    ]),
    403: controlRefusalSchema(['not_a_member', 'send_permission_missing']),
    404: sentMessageNotFoundSchema,
    409: controlRefusalSchema(['bot_blocked']),
  },
});
