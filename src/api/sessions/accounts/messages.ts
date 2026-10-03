import { Hono } from 'hono';
import { z } from 'zod';

import { isContactVcardWithinLimit, MAX_CONTACT_NAME_LENGTH } from '../../../types/contact.ts';
import type { EmulationSession } from '../../../types/emulation_session.ts';
import { MAX_MEDIA_DURATION_SECONDS, MAX_VIDEO_SIDE_LENGTH } from '../../../types/stored_file.ts';
import { countTextCharacters, MAX_TEXT_MESSAGE_LENGTH } from '../../../types/virtual_message.ts';
import { base64ContentSchema } from '../base64_content.ts';
import { readMessageEntitiesParameter } from '../bot_api/message_entities_parameter.ts';
import { readJsonRequestBody } from '../json_request_body.ts';
import type { SessionRouteContextTypes } from '../session_route_context_types.ts';
import {
  ACCOUNT_ID_PARAMETER,
  accountPathSchema,
  PRIVATE_MESSAGE_PATH,
  privateMessagePathSchema,
  SUPERGROUP_MESSAGE_PATH,
  supergroupMessagePathSchema,
} from './account_paths.ts';
import { viewChatMessageForAccount } from './chat_message_view.ts';
import {
  accountMessageFailureStatus,
  supergroupMemberFailureStatus,
} from './messaging_failure_statuses.ts';
import { accountLocationSchema, chatSchema } from './request_fields.ts';

const ACCOUNT_MESSAGE_COLLECTION_PATH = `/:${ACCOUNT_ID_PARAMETER}/messages` as const;
const ACCOUNT_MEDIA_GROUP_COLLECTION_PATH = `/:${ACCOUNT_ID_PARAMETER}/media-groups` as const;

/** Where a message the account sends goes: its chat, and the message it replies to, if any. */
const sentMessageTargetShape = {
  to: chatSchema,
  /** The replied message's ID as the chat's bots see it, which is how these routes show messages. */
  reply_to_message_id: z.int().positive().optional(),
};

/** A caption, which Telegram's service limits, so its length is checked when sending. */
const captionSchema = z.string().default('');

/**
 * Formatting an account specifies for its text or caption, as the Bot API's `MessageEntity`
 * objects, which are read as for bots: entity types Telegram detects by itself are ignored.
 */
const messageEntitiesSchema = z.array(z.unknown()).transform((entityValues, context) => {
  const reading = readMessageEntitiesParameter(entityValues, 'Invalid message entities');
  if (!reading.read) {
    context.issues.push({ code: 'custom', message: reading.description, input: entityValues });
    return z.NEVER;
  }
  return reading.entities;
}).optional();

/** Message text, whose length counts characters as Telegram's limit does, not UTF-16 code units. */
const messageTextSchema = z.string().min(1).refine(
  (text) => countTextCharacters(text) <= MAX_TEXT_MESSAGE_LENGTH,
  { message: `Text must have at most ${MAX_TEXT_MESSAGE_LENGTH} characters` },
);

/** A photo the account uploads, with an optional caption. */
const accountPhotoShape = {
  photo: z.strictObject({ content_base64: base64ContentSchema }),
  caption: captionSchema,
  caption_entities: messageEntitiesSchema,
};

/** A document the account uploads under a file name, with an optional caption. */
const accountDocumentShape = {
  document: z.strictObject({
    content_base64: base64ContentSchema,
    file_name: z.string().min(1),
  }),
  caption: captionSchema,
  caption_entities: messageEntitiesSchema,
};

/**
 * A video the account uploads, with an optional caption. Its client defines its duration and
 * dimensions, which default to 0, and may name its file, whose extension decides its `video/` MIME
 * type, or else `video/mp4`.
 */
const accountVideoShape = {
  video: z.strictObject({
    content_base64: base64ContentSchema,
    file_name: z.string().min(1).optional(),
    duration: z.int().min(0).max(MAX_MEDIA_DURATION_SECONDS).default(0),
    width: z.int().min(0).max(MAX_VIDEO_SIDE_LENGTH).default(0),
    height: z.int().min(0).max(MAX_VIDEO_SIDE_LENGTH).default(0),
  }),
  caption: captionSchema,
  caption_entities: messageEntitiesSchema,
};

/**
 * A voice note the account records, with an optional caption. Its client defines its duration,
 * which defaults to 0, and records it as `audio/ogg`, as Telegram's clients record OGG/Opus.
 */
const accountVoiceShape = {
  voice: z.strictObject({
    content_base64: base64ContentSchema,
    duration: z.int().min(0).max(MAX_MEDIA_DURATION_SECONDS).default(0),
  }),
  caption: captionSchema,
  caption_entities: messageEntitiesSchema,
};

/** A contact's first or last name, of at most as many characters as TDLib documents. */
const contactNameSchema = z.string().refine(
  (name) => countTextCharacters(name) <= MAX_CONTACT_NAME_LENGTH,
  { message: `A contact name must have at most ${MAX_CONTACT_NAME_LENGTH} characters` },
);

/**
 * A contact the account writes: a nonempty phone number in any form and first name, with an
 * optional last name and vCard, which is never parsed. Its Telegram user stays unknown, as the
 * emulator never looks users up by phone number.
 */
const accountContactShape = {
  contact: z.strictObject({
    phone_number: z.string().min(1),
    first_name: contactNameSchema.pipe(z.string().min(1)),
    last_name: contactNameSchema.default(''),
    vcard: z.string().refine(isContactVcardWithinLimit).default(''),
  }),
};

/**
 * A text message, a photo, a document, a video, or a voice note, each with an optional caption; a
 * contact the account writes, or its own contact, which Telegram shows as the account's user; a
 * static location; or a forward of a message of one of the account's chats, which, as in
 * Telegram's clients, replies to none.
 */
const sendMessageRequestSchema = z.union([
  z.strictObject({
    to: chatSchema,
    forward: z.strictObject({
      chat: chatSchema,
      /** The message's ID as the chat's bots see it, which is how these routes show messages. */
      message_id: z.int().positive(),
    }),
  }),
  z.strictObject({
    ...sentMessageTargetShape,
    text: messageTextSchema,
    entities: messageEntitiesSchema,
  }),
  z.strictObject({ ...sentMessageTargetShape, ...accountPhotoShape }),
  z.strictObject({ ...sentMessageTargetShape, ...accountDocumentShape }),
  z.strictObject({ ...sentMessageTargetShape, ...accountVideoShape }),
  z.strictObject({ ...sentMessageTargetShape, ...accountVoiceShape }),
  z.strictObject({ ...sentMessageTargetShape, ...accountContactShape }),
  z.strictObject({ ...sentMessageTargetShape, own_contact: z.literal(true) }),
  z.strictObject({ ...sentMessageTargetShape, location: accountLocationSchema }),
]);

/**
 * The photos, videos, or documents of an album, in the order the chat shows them, each with an
 * optional caption. Whether they can form an album is checked as Telegram checks it.
 */
const sendMediaGroupRequestSchema = z.strictObject({
  ...sentMessageTargetShape,
  media: z.array(z.union([
    z.strictObject(accountPhotoShape),
    z.strictObject(accountDocumentShape),
    z.strictObject(accountVideoShape),
  ])),
});

/** New text for a text message, or a new caption for captioned media; empty removes it. */
const editMessageRequestSchema = z.union([
  z.strictObject({ text: messageTextSchema, entities: messageEntitiesSchema }),
  z.strictObject({ caption: z.string(), caption_entities: messageEntitiesSchema }),
]);

/**
 * Routes through which an account sends messages and albums to its chats, forwards messages, and
 * edits and deletes its messages.
 */
export function createMessageRoutes(): Hono<SessionRouteContextTypes> {
  const accountRoutes = new Hono<SessionRouteContextTypes>();

  accountRoutes.post(ACCOUNT_MESSAGE_COLLECTION_PATH, async (context) => {
    const accountPath = accountPathSchema.safeParse(context.req.param());
    if (!accountPath.success) {
      return context.body(null, 400);
    }
    const { accountId } = accountPath.data;

    const requestBody = await readJsonRequestBody(context.req, sendMessageRequestSchema);
    if (requestBody === undefined) {
      return context.body(null, 400);
    }

    const {
      privateMessaging,
      supergroupMessaging,
      messageForwarding,
      botMessageViews,
      mediaFiles,
    } = context.get('emulationSession');
    if ('forward' in requestBody) {
      const { to, forward } = requestBody;
      const result = messageForwarding.forwardAccountMessage({
        fromAccountId: accountId,
        fromChat: forward.chat,
        messageId: forward.message_id,
        toChat: to,
      });
      if (!result.forwarded) {
        return context.body(null, forwardFailureStatus(result.reason));
      }
      return context.json(
        { message: viewChatMessageForAccount(botMessageViews, result.message, accountId) },
        201,
      );
    }
    const content = readAccountMessageContent(requestBody, mediaFiles);
    if (content === undefined) {
      return context.body(null, 400);
    }
    const { to, reply_to_message_id: replyToMessageId } = requestBody;
    if (to.type === 'supergroup') {
      const result = supergroupMessaging.sendAccountMessage({
        fromAccountId: accountId,
        chatId: to.chatId,
        content,
        replyToMessageId,
      });
      if (!result.sent) {
        return context.body(null, supergroupMemberFailureStatus(result.reason));
      }
      return context.json(
        { message: botMessageViews.viewSupergroupMessage(result.message, accountId) },
        201,
      );
    }

    const result = privateMessaging.sendAccountMessage({
      fromAccountId: accountId,
      to,
      content,
      replyToBotMessageId: replyToMessageId,
    });
    if (!result.sent) {
      return context.body(null, accountMessageFailureStatus(result.reason));
    }

    return context.json(
      { message: botMessageViews.viewPrivateMessageForBot(result.message) },
      201,
    );
  });

  accountRoutes.post(ACCOUNT_MEDIA_GROUP_COLLECTION_PATH, async (context) => {
    const accountPath = accountPathSchema.safeParse(context.req.param());
    if (!accountPath.success) {
      return context.body(null, 400);
    }
    const { accountId } = accountPath.data;

    const requestBody = await readJsonRequestBody(context.req, sendMediaGroupRequestSchema);
    if (requestBody === undefined) {
      return context.body(null, 400);
    }

    const { privateMessaging, supergroupMessaging, botMessageViews, mediaFiles } = context.get(
      'emulationSession',
    );
    const contents: AccountAlbumMediaContent[] = [];
    for (const media of requestBody.media) {
      const content = readAccountMediaContent(media, mediaFiles);
      if (content === undefined) {
        return context.body(null, 400);
      }
      contents.push(content);
    }
    const { to, reply_to_message_id: replyToMessageId } = requestBody;
    if (to.type === 'supergroup') {
      const result = supergroupMessaging.sendAccountAlbum({
        fromAccountId: accountId,
        chatId: to.chatId,
        contents,
        replyToMessageId,
      });
      if (!result.sent) {
        return context.body(null, supergroupMemberFailureStatus(result.reason));
      }
      return context.json(
        {
          messages: result.messages.map((message) =>
            botMessageViews.viewSupergroupMessage(message, accountId)
          ),
        },
        201,
      );
    }

    const result = privateMessaging.sendAccountAlbum({
      fromAccountId: accountId,
      to,
      contents,
      replyToBotMessageId: replyToMessageId,
    });
    if (!result.sent) {
      return context.body(null, accountMessageFailureStatus(result.reason));
    }
    return context.json(
      {
        messages: result.messages.map((message) =>
          botMessageViews.viewPrivateMessageForBot(message)
        ),
      },
      201,
    );
  });

  accountRoutes.patch(SUPERGROUP_MESSAGE_PATH, async (context) => {
    const messagePath = supergroupMessagePathSchema.safeParse(context.req.param());
    if (!messagePath.success) {
      return context.body(null, 400);
    }
    const { accountId, chatId, messageId } = messagePath.data;

    const requestBody = await readJsonRequestBody(context.req, editMessageRequestSchema);
    if (requestBody === undefined) {
      return context.body(null, 400);
    }

    const { supergroupMessaging, botMessageViews } = context.get('emulationSession');
    const result = supergroupMessaging.editAccountMessage({
      fromAccountId: accountId,
      chatId,
      messageId,
      edit: readAccountMessageEdit(requestBody),
    });
    if (!result.edited) {
      return context.body(null, supergroupMemberFailureStatus(result.reason));
    }
    return context.json({
      message: botMessageViews.viewSupergroupMessage(result.message, accountId),
    });
  });

  // The account deletes the message for every member, as Telegram's clients do.
  accountRoutes.delete(SUPERGROUP_MESSAGE_PATH, (context) => {
    const messagePath = supergroupMessagePathSchema.safeParse(context.req.param());
    if (!messagePath.success) {
      return context.body(null, 400);
    }
    const { accountId, chatId, messageId } = messagePath.data;

    const result = context.get('emulationSession').supergroupMessaging.deleteAccountMessage({
      fromAccountId: accountId,
      chatId,
      messageId,
    });
    if (result.deleted) {
      return context.body(null, 204);
    }
    return context.body(
      null,
      result.reason === 'message_not_deletable'
        ? 403
        : supergroupMemberFailureStatus(result.reason),
    );
  });

  accountRoutes.patch(PRIVATE_MESSAGE_PATH, async (context) => {
    const messagePath = privateMessagePathSchema.safeParse(context.req.param());
    if (!messagePath.success) {
      return context.body(null, 400);
    }
    const { accountId, botId, messageId } = messagePath.data;

    const requestBody = await readJsonRequestBody(context.req, editMessageRequestSchema);
    if (requestBody === undefined) {
      return context.body(null, 400);
    }

    const { privateMessaging, botMessageViews } = context.get('emulationSession');
    const result = privateMessaging.editAccountMessage({
      fromAccountId: accountId,
      chat: { type: 'private', botId },
      botMessageId: messageId,
      edit: readAccountMessageEdit(requestBody),
    });
    if (!result.edited) {
      const isNotFound = result.reason === 'account_not_found' ||
        result.reason === 'bot_not_found' || result.reason === 'message_not_found';
      return context.body(null, isNotFound ? 404 : 400);
    }
    return context.json({ message: botMessageViews.viewPrivateMessageForBot(result.message) });
  });

  // The account deletes the message for both participants, as Telegram's clients can.
  accountRoutes.delete(PRIVATE_MESSAGE_PATH, (context) => {
    const messagePath = privateMessagePathSchema.safeParse(context.req.param());
    if (!messagePath.success) {
      return context.body(null, 400);
    }
    const { accountId, botId, messageId } = messagePath.data;

    const result = context.get('emulationSession').privateMessaging.deleteAccountMessage({
      fromAccountId: accountId,
      botId,
      botMessageId: messageId,
    });
    return context.body(null, result.deleted ? 204 : 404);
  });

  return accountRoutes;
}

type AccountMessageContent = Parameters<
  EmulationSession['privateMessaging']['sendAccountMessage']
>[0]['content'];

type AccountAlbumMediaContent = Parameters<
  EmulationSession['privateMessaging']['sendAccountAlbum']
>[0]['contents'][number];

/**
 * Reads the content of an account's message, checking an uploaded photo as Telegram does; returns
 * `undefined` for a file Telegram would not send.
 */
function readAccountMessageContent(
  request: Exclude<z.infer<typeof sendMessageRequestSchema>, { readonly forward: unknown }>,
  mediaFiles: EmulationSession['mediaFiles'],
): AccountMessageContent | undefined {
  if ('text' in request) {
    return { kind: 'text', text: request.text, entities: request.entities };
  }
  if ('own_contact' in request) {
    return { kind: 'own_contact' };
  }
  if ('location' in request) {
    return { kind: 'location', location: request.location };
  }
  if ('contact' in request) {
    const { phone_number, first_name, last_name, vcard } = request.contact;
    return {
      kind: 'contact',
      contact: { phoneNumber: phone_number, firstName: first_name, lastName: last_name, vcard },
    };
  }
  return 'voice' in request
    ? readAccountVoiceContent(request, mediaFiles)
    : readAccountMediaContent(request, mediaFiles);
}

/**
 * Reads a voice note an account records, as its client prepares it; returns `undefined` for an
 * upload Telegram refuses. Unlike other media, a voice note never joins an album.
 */
function readAccountVoiceContent(
  request: z.infer<z.ZodObject<typeof accountVoiceShape>>,
  mediaFiles: EmulationSession['mediaFiles'],
): AccountMessageContent | undefined {
  const preparation = mediaFiles.prepareVoiceUpload({
    content: request.voice.content_base64,
    durationSeconds: request.voice.duration,
    source: 'account_upload',
  });
  return preparation.prepared
    ? {
      kind: 'media',
      upload: preparation.upload,
      caption: request.caption,
      captionEntities: request.caption_entities,
    }
    : undefined;
}

/**
 * Reads a photo, document, or video an account uploads, as its client prepares it; returns
 * `undefined` for an upload Telegram refuses.
 */
function readAccountMediaContent(
  request:
    | z.infer<z.ZodObject<typeof accountPhotoShape>>
    | z.infer<z.ZodObject<typeof accountDocumentShape>>
    | z.infer<z.ZodObject<typeof accountVideoShape>>,
  mediaFiles: EmulationSession['mediaFiles'],
): AccountAlbumMediaContent | undefined {
  const preparation = prepareAccountUpload(request, mediaFiles);
  return preparation.prepared
    ? {
      kind: 'media',
      upload: preparation.upload,
      caption: request.caption,
      captionEntities: request.caption_entities,
    }
    : undefined;
}

/** How a file an account uploads was prepared, or why Telegram refuses it. */
type AccountUploadPreparation =
  | ReturnType<EmulationSession['mediaFiles']['preparePhotoUpload']>
  | ReturnType<EmulationSession['mediaFiles']['prepareDocumentUpload']>
  | ReturnType<EmulationSession['mediaFiles']['prepareVideoUpload']>;

/** Prepares the file of an account's photo, document, or video as its client uploads it. */
function prepareAccountUpload(
  request: Parameters<typeof readAccountMediaContent>[0],
  mediaFiles: EmulationSession['mediaFiles'],
): AccountUploadPreparation {
  if ('photo' in request) {
    return mediaFiles.preparePhotoUpload({
      content: request.photo.content_base64,
      source: 'account_upload',
    });
  }
  if ('document' in request) {
    return mediaFiles.prepareDocumentUpload({
      content: request.document.content_base64,
      fileName: request.document.file_name,
      source: 'account_upload',
    });
  }
  const { content_base64: content, file_name: fileName, duration, width, height } = request.video;
  return mediaFiles.prepareVideoUpload({
    content,
    ...(fileName === undefined ? {} : { fileName }),
    attributes: { durationSeconds: duration, width, height },
    source: 'account_upload',
  });
}

type AccountMessageEdit = Parameters<
  EmulationSession['privateMessaging']['editAccountMessage']
>[0]['edit'];

function readAccountMessageEdit(
  request: z.infer<typeof editMessageRequestSchema>,
): AccountMessageEdit {
  return 'text' in request
    ? { kind: 'text', text: request.text, entities: request.entities }
    : { kind: 'caption', caption: request.caption, captionEntities: request.caption_entities };
}

/**
 * A missing account, bot, supergroup, or message is not found, and an account that is not a member
 * of a supergroup, or may not send the message's content there, is forbidden from it. A message
 * that cannot be forwarded rejects the request, and a block conflicts with writing to the bot.
 */
function forwardFailureStatus(
  reason: Extract<
    ReturnType<EmulationSession['messageForwarding']['forwardAccountMessage']>,
    { readonly forwarded: false }
  >['reason'],
): 400 | 403 | 404 | 409 {
  switch (reason) {
    case 'account_not_found':
    case 'bot_not_found':
    case 'chat_not_found':
    case 'message_not_found':
      return 404;
    case 'not_a_member':
    case 'send_permission_missing':
      return 403;
    case 'message_not_forwardable':
      return 400;
    case 'bot_blocked':
      return 409;
    default: {
      const unhandledReason: never = reason;
      throw new Error(`Unhandled account forward failure: ${unhandledReason}`);
    }
  }
}
