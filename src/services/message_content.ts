import {
  type EmptyTextTreatment,
  fixFormattedText,
  type FormattedTextFixingContext,
} from '../text_entities/formatted_text.ts';
import { areTextEntitiesEqual } from '../text_entities/text_entity_equality.ts';
import { compareTextEntities } from '../text_entities/text_entity_order.ts';
import { isSameButtonAppearance } from '../types/button_appearance.ts';
import {
  type InlineKeyboard,
  type InlineKeyboardButton,
  type InlineQuerySwitchTarget,
  MAX_CALLBACK_DATA_BYTES,
} from '../types/inline_keyboard.ts';
import {
  type AlbumCompositionFailureReason,
  checkAlbumComposition,
  toAlbumMember,
} from '../types/media_album.ts';
import {
  createAutomaticQuote,
  type ExternalReplyTarget,
  isQuoteEntity,
  MAX_QUOTE_LENGTH,
} from '../types/message_reply.ts';
import {
  areRichMessagesEqual,
  convertRichMessageFiles,
  listRichMessageButtons,
  listRichMessageFiles,
  type RichMessage,
  type RichMessageButtonAction,
} from '../types/rich_message.ts';
import type {
  DocumentUpload,
  FileUpload,
  PhotoUpload,
  StoredDocumentFile,
  StoredFile,
  StoredFileId,
  StoredPhotoFile,
} from '../types/stored_file.ts';
import {
  type ChatMessage,
  type ContentMessage,
  countTextCharacters,
  type DocumentMessageContent,
  type FormattedText,
  getContentText,
  MAX_CAPTION_LENGTH,
  MAX_TEXT_MESSAGE_LENGTH,
  type MessageContent,
  type PhotoMessageContent,
  type TextEntity,
  type TextQuote,
} from '../types/virtual_message.ts';
import { normalizeRichMessage } from './rich_message_normalization.ts';

// Telegram's rules for the content of messages, which apply alike in every chat type.

/**
 * Telegram rejected the text or its entities while normalizing them, for example because only
 * whitespace remains or an entity ends past the text. `textError` is TDLib's own description.
 */
export interface TextInvalidFailure {
  readonly reason: 'text_invalid';
  readonly textError: string;
}

/** Who writes a message, which decides how Telegram treats a caption without visible content. */
export type MessageSenderKind = 'account' | 'bot';

/** A file a new message carries: one the sender reuses by its `file_id`, or a new upload. */
export type OutgoingFile<Stored extends StoredFile, Upload extends FileUpload> =
  | { readonly kind: 'stored'; readonly file: Stored }
  | { readonly kind: 'upload'; readonly upload: Upload };

export type OutgoingPhoto = OutgoingFile<StoredPhotoFile, PhotoUpload>;

export type OutgoingDocument = OutgoingFile<StoredDocumentFile, DocumentUpload>;

/** The files of a rich message being sent: each reused by its stored file, or a new upload. */
export interface OutgoingRichMessageFileTypes {
  readonly photo: OutgoingPhoto;
  readonly document: OutgoingDocument;
}

export type OutgoingRichMessage = RichMessage<OutgoingRichMessageFileTypes>;

/** A caption as its sender specified it, before Telegram's normalization. */
export interface SpecifiedCaption {
  /** Empty for no caption. */
  readonly caption: string;
  /** Formatting the sender specified; omitted for none. */
  readonly captionEntities?: readonly TextEntity[];
}

/** The content a sender specified for a new message, before Telegram's normalization. */
export type OutgoingMessageContent =
  | {
    readonly kind: 'text';
    /** Nonempty text, which senders check before anything else, as Telegram does. */
    readonly text: string;
    /** Formatting the sender specified; omitted for none. */
    readonly entities?: readonly TextEntity[];
  }
  | (SpecifiedCaption & {
    readonly kind: 'photo';
    readonly photo: OutgoingPhoto;
    readonly hasSpoiler: boolean;
    readonly showsCaptionAboveMedia: boolean;
  })
  | (SpecifiedCaption & {
    readonly kind: 'document';
    readonly document: OutgoingDocument;
  })
  | {
    readonly kind: 'rich_message';
    readonly richMessage: OutgoingRichMessage;
    /**
     * Whether Telegram marks the entities it detects in the text, which a bot's
     * `skip_entity_detection` turns off.
     */
    readonly detectsEntities: boolean;
  }
  | {
    /** The content of an existing message, which a forward or a copy repeats. */
    readonly kind: 'existing';
    /** The content as Telegram checked it when the existing message was sent. */
    readonly content: MessageContent;
    /**
     * A caption that replaces the caption of media, as a copy may specify; omitted to keep the
     * caption. Text has no caption to replace and stays as it is.
     */
    readonly captionReplacement?: CaptionReplacement;
  };

/** A new caption of media, with where a photo shows it; a document ignores the placement. */
export type CaptionReplacement = SpecifiedCaption & { readonly showsCaptionAboveMedia: boolean };

/** New message content that passed Telegram's checks, whose upload is not yet stored. */
export type NormalizedOutgoingContent =
  | Extract<MessageContent, { readonly kind: 'text' }>
  | { readonly kind: 'existing'; readonly content: MessageContent }
  | {
    readonly kind: 'photo';
    readonly photo: OutgoingPhoto;
    readonly caption: FormattedText;
    readonly hasSpoiler: boolean;
    readonly showsCaptionAboveMedia: boolean;
  }
  | {
    readonly kind: 'document';
    readonly document: OutgoingDocument;
    readonly caption: FormattedText;
  }
  | { readonly kind: 'rich_message'; readonly richMessage: OutgoingRichMessage };

export type ContentNormalizationFailure =
  | TextInvalidFailure
  | { readonly reason: 'message_text_too_long' | 'caption_too_long' };

export type OutgoingContentNormalization =
  | { readonly normalized: true; readonly content: NormalizedOutgoingContent }
  | { readonly normalized: false; readonly failure: ContentNormalizationFailure };

/**
 * Normalizes the text or caption of new message content, with the entities its sender specified,
 * as Telegram does, which also marks bot commands; then checks that the result fits in a message.
 * A rich message is checked and has its entities marked as `normalizeRichMessage` does.
 */
export function normalizeOutgoingContent(
  content: OutgoingMessageContent,
  sender: MessageSenderKind,
  context: FormattedTextFixingContext,
): OutgoingContentNormalization {
  if (content.kind === 'text' || content.kind === 'rich_message') {
    const replacement = normalizeTextMessageReplacement(content, context);
    return replacement.normalized
      ? replacement
      : { normalized: false, failure: replacement.failure };
  }
  if (content.kind === 'existing') {
    return normalizeExistingContent(content.content, content.captionReplacement, sender, context);
  }
  return normalizeMediaContent(content, sender, context);
}

/** New media of a message with its caption, as its sender specified it. */
export type MediaContent = Extract<
  OutgoingMessageContent,
  { readonly kind: 'photo' | 'document' }
>;

type MediaContentNormalization =
  | { readonly normalized: true; readonly content: NormalizedOutgoingContent }
  | { readonly normalized: false; readonly failure: CaptionNormalizationFailure };

/** Normalizes the caption of new media as `normalizeCaption` does. */
function normalizeMediaContent(
  content: MediaContent,
  sender: MessageSenderKind,
  context: FormattedTextFixingContext,
): MediaContentNormalization {
  const captionNormalization = normalizeCaption(content, sender, context);
  if (!captionNormalization.normalized) {
    return captionNormalization;
  }
  const { caption } = captionNormalization;
  return {
    normalized: true,
    content: content.kind === 'photo'
      ? {
        kind: 'photo',
        photo: content.photo,
        caption,
        hasSpoiler: content.hasSpoiler,
        showsCaptionAboveMedia: content.showsCaptionAboveMedia,
      }
      : { kind: 'document', document: content.document, caption },
  };
}

export type OutgoingAlbumNormalization =
  | { readonly normalized: true; readonly contents: readonly NormalizedOutgoingContent[] }
  | {
    readonly normalized: false;
    readonly failure:
      | CaptionNormalizationFailure
      | { readonly reason: AlbumCompositionFailureReason };
  };

/**
 * Normalizes the media of an album as `normalizeOutgoingContent` normalizes each, in order, then
 * checks that they form an album as `checkAlbumComposition` does, as TDLib checks an album after
 * reading every message's content.
 */
export function normalizeOutgoingAlbum(
  contents: readonly MediaContent[],
  sender: MessageSenderKind,
  context: FormattedTextFixingContext,
): OutgoingAlbumNormalization {
  const normalizedContents: NormalizedOutgoingContent[] = [];
  for (const content of contents) {
    const normalization = normalizeMediaContent(content, sender, context);
    if (!normalization.normalized) {
      return normalization;
    }
    normalizedContents.push(normalization.content);
  }
  const compositionFailure = checkAlbumComposition(contents.map(toAlbumMember));
  return compositionFailure === undefined
    ? { normalized: true, contents: normalizedContents }
    : { normalized: false, failure: { reason: compositionFailure } };
}

/**
 * Keeps the content of an existing message as it is, apart from a replaced caption of media, which
 * is normalized as a new caption is. Text and rich messages have no caption to replace.
 */
function normalizeExistingContent(
  content: MessageContent,
  captionReplacement: CaptionReplacement | undefined,
  sender: MessageSenderKind,
  context: FormattedTextFixingContext,
): OutgoingContentNormalization {
  if (
    captionReplacement === undefined || (content.kind !== 'photo' && content.kind !== 'document')
  ) {
    return { normalized: true, content: { kind: 'existing', content } };
  }
  const captionNormalization = normalizeCaption(captionReplacement, sender, context);
  if (!captionNormalization.normalized) {
    return captionNormalization;
  }
  return {
    normalized: true,
    content: {
      kind: 'existing',
      content: withCaption(
        content,
        captionNormalization.caption,
        captionReplacement.showsCaptionAboveMedia,
      ),
    },
  };
}

type MessageTextNormalization =
  | { readonly normalized: true; readonly formattedText: FormattedText }
  | {
    readonly normalized: false;
    readonly failure: TextInvalidFailure | { readonly reason: 'message_text_too_long' };
  };

/**
 * Normalizes message text and the entities its sender specified as Telegram does, which also marks
 * bot commands, then checks that the normalized text fits in a message.
 */
function normalizeMessageText(
  text: string,
  entities: readonly TextEntity[],
  context: FormattedTextFixingContext,
): MessageTextNormalization {
  const fixing = fixFormattedText(text, entities, context);
  if (!fixing.fixed) {
    return { normalized: false, failure: { reason: 'text_invalid', textError: fixing.error } };
  }
  if (countTextCharacters(fixing.formattedText.text) > MAX_TEXT_MESSAGE_LENGTH) {
    return { normalized: false, failure: { reason: 'message_text_too_long' } };
  }
  return { normalized: true, formattedText: fixing.formattedText };
}

/** New content of a text or rich message: text with the entities its sender specified, or a rich message. */
export type TextMessageReplacement = Extract<
  OutgoingMessageContent,
  { readonly kind: 'text' | 'rich_message' }
>;

type TextMessageReplacementNormalization =
  | {
    readonly normalized: true;
    readonly content: Extract<
      NormalizedOutgoingContent,
      { readonly kind: 'text' | 'rich_message' }
    >;
  }
  | {
    readonly normalized: false;
    readonly failure: TextInvalidFailure | { readonly reason: 'message_text_too_long' };
  };

/** Normalizes new text as `normalizeMessageText` does, or a rich message as `normalizeRichMessage` does. */
function normalizeTextMessageReplacement(
  replacement: TextMessageReplacement,
  context: FormattedTextFixingContext,
): TextMessageReplacementNormalization {
  if (replacement.kind === 'rich_message') {
    const normalization = normalizeRichMessage(
      replacement.richMessage,
      replacement.detectsEntities,
      context,
    );
    return normalization.normalized
      ? {
        normalized: true,
        content: { kind: 'rich_message', richMessage: normalization.richMessage },
      }
      : {
        normalized: false,
        failure: { reason: normalization.reason, textError: normalization.textError },
      };
  }
  const textNormalization = normalizeMessageText(
    replacement.text,
    replacement.entities ?? [],
    context,
  );
  return textNormalization.normalized
    ? { normalized: true, content: { kind: 'text', ...textNormalization.formattedText } }
    : textNormalization;
}

type CaptionNormalizationFailure = TextInvalidFailure | { readonly reason: 'caption_too_long' };

export type CaptionNormalization =
  | { readonly normalized: true; readonly caption: FormattedText }
  | { readonly normalized: false; readonly failure: CaptionNormalizationFailure };

/**
 * Normalizes a caption and the entities its sender specified as Telegram does, which also marks
 * bot commands, then checks the caption's length. A caption may be empty; how one without visible
 * content is treated depends on its sender.
 */
export function normalizeCaption(
  { caption, captionEntities }: SpecifiedCaption,
  sender: MessageSenderKind,
  context: FormattedTextFixingContext,
): CaptionNormalization {
  const emptyTextTreatment: EmptyTextTreatment = sender === 'bot'
    ? 'keep_invisible_characters'
    : 'clear';
  const fixing = fixFormattedText(caption, captionEntities ?? [], context, emptyTextTreatment);
  if (!fixing.fixed) {
    return { normalized: false, failure: { reason: 'text_invalid', textError: fixing.error } };
  }
  if (countTextCharacters(fixing.formattedText.text) > MAX_CAPTION_LENGTH) {
    return { normalized: false, failure: { reason: 'caption_too_long' } };
  }
  return { normalized: true, caption: fixing.formattedText };
}

/**
 * What an account sends: text, or media with a caption, which is a photo or a document as its
 * upload says, each with the formatting the account specified.
 */
export type AccountMessageContent =
  | {
    readonly kind: 'text';
    readonly text: string;
    /** Formatting the account specified; omitted for none. */
    readonly entities?: readonly TextEntity[];
  }
  | AccountMediaContent;

/** Media an account sends, a photo or a document as its upload says, with its caption. */
export type AccountMediaContent = SpecifiedCaption & {
  readonly kind: 'media';
  readonly upload: FileUpload;
};

/**
 * Turns what an account sends into outgoing content, which its client normalizes as Telegram
 * does, as `toOutgoingAccountMedia` turns media.
 */
export function toOutgoingAccountContent(content: AccountMessageContent): OutgoingMessageContent {
  return content.kind === 'text' ? content : toOutgoingAccountMedia(content);
}

/**
 * Turns media an account sends into outgoing media. An account never covers a photo or moves its
 * caption.
 */
export function toOutgoingAccountMedia(
  { upload, caption, captionEntities }: AccountMediaContent,
): MediaContent {
  return upload.type === 'photo'
    ? {
      kind: 'photo',
      photo: { kind: 'upload', upload },
      caption,
      captionEntities,
      hasSpoiler: false,
      showsCaptionAboveMedia: false,
    }
    : { kind: 'document', document: { kind: 'upload', upload }, caption, captionEntities };
}

/**
 * The new content of an edited message, or why it cannot replace the old: normalized as when
 * sending, with its upload, if any, not yet stored.
 */
export type ContentReplacement<FailureReason extends string> =
  | { readonly replaced: true; readonly content: NormalizedOutgoingContent }
  | {
    readonly replaced: false;
    readonly failure: { readonly reason: FailureReason } | TextInvalidFailure;
  };

/**
 * Replaces the content of a text or rich message with nonempty text and the entities its sender
 * specified, or with a rich message, normalized as when sending. As TDLib's `edit_message_text`
 * allows, either kind of message can become the other. A media message has no text to replace.
 */
export function replaceMessageText(
  content: MessageContent,
  replacement: TextMessageReplacement,
  context: FormattedTextFixingContext,
): ContentReplacement<'message_has_no_text' | 'message_text_too_long'> {
  if (content.kind !== 'text' && content.kind !== 'rich_message') {
    return { replaced: false, failure: { reason: 'message_has_no_text' } };
  }
  const normalization = normalizeTextMessageReplacement(replacement, context);
  return normalization.normalized
    ? { replaced: true, content: normalization.content }
    : { replaced: false, failure: normalization.failure };
}

/**
 * Replaces the caption of a media message, normalized as when sending; an empty caption removes
 * it. As on Telegram, a text message has no caption to replace, and only a photo shows its caption
 * above itself: a document ignores `showsCaptionAboveMedia`, and omitting it keeps the setting.
 */
export function replaceMessageCaption(
  content: MessageContent,
  specifiedCaption: SpecifiedCaption & { readonly showsCaptionAboveMedia?: boolean },
  sender: MessageSenderKind,
  context: FormattedTextFixingContext,
): ContentReplacement<'message_has_no_caption' | 'caption_too_long'> {
  if (content.kind !== 'photo' && content.kind !== 'document') {
    return { replaced: false, failure: { reason: 'message_has_no_caption' } };
  }
  const captionNormalization = normalizeCaption(specifiedCaption, sender, context);
  if (!captionNormalization.normalized) {
    return { replaced: false, failure: captionNormalization.failure };
  }
  return {
    replaced: true,
    content: {
      kind: 'existing',
      content: withCaption(
        content,
        captionNormalization.caption,
        specifiedCaption.showsCaptionAboveMedia,
      ),
    },
  };
}

/**
 * Replaces a message's content with new media and its caption, normalized as when a bot sends
 * them, as TDLib's `edit_message_media` does: the old caption goes with the old content, so new
 * media without a caption has none. As TDLib's `can_edit_message_media` allows, the old content
 * may be any content the emulator has: a photo or a document, whose media is replaced, or text or
 * a rich message, which becomes media. As that method checks once the new caption is read, a
 * message of an album keeps its kind of media, since documents form albums only with documents.
 */
export function replaceMessageMedia(
  { content, mediaGroupId }: Pick<ContentMessage, 'content' | 'mediaGroupId'>,
  media: MediaContent,
  context: FormattedTextFixingContext,
): ContentReplacement<'caption_too_long' | 'album_media_kind_changed'> {
  switch (content.kind) {
    case 'text':
    case 'photo':
    case 'document':
    case 'rich_message': {
      const normalization = normalizeMediaContent(media, 'bot', context);
      if (!normalization.normalized) {
        return { replaced: false, failure: normalization.failure };
      }
      return mediaGroupId !== undefined && media.kind !== content.kind
        ? { replaced: false, failure: { reason: 'album_media_kind_changed' } }
        : { replaced: true, content: normalization.content };
    }
    default: {
      const unhandledContent: never = content;
      throw new Error(`Unhandled message content: ${JSON.stringify(unhandledContent)}`);
    }
  }
}

/**
 * Gives media a normalized caption. Only a photo shows its caption above itself; omitting the
 * placement keeps it.
 */
function withCaption(
  content: PhotoMessageContent | DocumentMessageContent,
  caption: FormattedText,
  showsCaptionAboveMedia: boolean | undefined,
): PhotoMessageContent | DocumentMessageContent {
  return content.kind === 'photo'
    ? {
      ...content,
      caption,
      showsCaptionAboveMedia: showsCaptionAboveMedia ?? content.showsCaptionAboveMedia,
    }
    : { ...content, caption };
}

/**
 * An account's edit of its message: new text for a text message, or a new caption for media, each
 * with the formatting the account specified.
 */
export type AccountMessageEdit =
  | {
    readonly kind: 'text';
    readonly text: string;
    /** Formatting the account specified; omitted for none. */
    readonly entities?: readonly TextEntity[];
  }
  | (SpecifiedCaption & { readonly kind: 'caption' });

/**
 * Applies an account's edit to its message's content, which its client normalizes as when
 * sending. New text must not be empty, while an empty caption removes the caption.
 */
export function replaceAccountMessageContent(
  content: MessageContent,
  edit: AccountMessageEdit,
  context: FormattedTextFixingContext,
): ContentReplacement<
  | 'message_has_no_text'
  | 'message_text_empty'
  | 'message_text_too_long'
  | 'message_has_no_caption'
  | 'caption_too_long'
> {
  if (edit.kind === 'caption') {
    const { caption, captionEntities } = edit;
    return replaceMessageCaption(content, { caption, captionEntities }, 'account', context);
  }
  if (content.kind !== 'text') {
    return { replaced: false, failure: { reason: 'message_has_no_text' } };
  }
  if (edit.text.length === 0) {
    return { replaced: false, failure: { reason: 'message_text_empty' } };
  }
  return replaceMessageText(
    content,
    { kind: 'text', text: edit.text, entities: edit.entities },
    context,
  );
}

/** Stores a file upload and returns the stored file's identity. */
export interface FileUploadStore {
  addFile(upload: FileUpload): Pick<StoredFile, 'id'>;
}

/**
 * Stores the upload of normalized content, if it carries one, and returns the content as a
 * message holds it. Call it only once the message is certain to be stored.
 */
export function storeOutgoingContent(
  content: NormalizedOutgoingContent,
  files: FileUploadStore,
): MessageContent {
  switch (content.kind) {
    case 'text':
      return content;
    case 'existing':
      return content.content;
    case 'photo':
      return {
        kind: 'photo',
        fileId: storeOutgoingFile(content.photo, files),
        caption: content.caption,
        hasSpoiler: content.hasSpoiler,
        showsCaptionAboveMedia: content.showsCaptionAboveMedia,
      };
    case 'document':
      return {
        kind: 'document',
        fileId: storeOutgoingFile(content.document, files),
        caption: content.caption,
      };
    case 'rich_message':
      return {
        kind: 'rich_message',
        ...convertRichMessageFiles(content.richMessage, {
          photo: (photo) => storeOutgoingFile(photo, files),
          document: (document) => storeOutgoingFile(document, files),
        }),
      };
    default: {
      const unhandledContent: never = content;
      throw new Error(`Unhandled message content: ${JSON.stringify(unhandledContent)}`);
    }
  }
}

function storeOutgoingFile(
  file: OutgoingPhoto | OutgoingDocument,
  files: FileUploadStore,
): StoredFileId {
  return file.kind === 'stored' ? file.file.id : files.addFile(file.upload).id;
}

/**
 * Returns normalized content as a message holds it, for content whose file, if any, is already
 * stored, as when a bot reuses a file by its `file_id`. Content with an upload must be stored with
 * `storeOutgoingContent` instead.
 */
export function toContentOfStoredFile(content: NormalizedOutgoingContent): MessageContent {
  switch (content.kind) {
    case 'text':
      return content;
    case 'existing':
      return content.content;
    case 'photo':
      return {
        kind: 'photo',
        fileId: getStoredFileId(content.photo),
        caption: content.caption,
        hasSpoiler: content.hasSpoiler,
        showsCaptionAboveMedia: content.showsCaptionAboveMedia,
      };
    case 'document':
      return {
        kind: 'document',
        fileId: getStoredFileId(content.document),
        caption: content.caption,
      };
    case 'rich_message':
      return {
        kind: 'rich_message',
        ...convertRichMessageFiles(content.richMessage, {
          photo: getStoredFileId,
          document: getStoredFileId,
        }),
      };
    default: {
      const unhandledContent: never = content;
      throw new Error(`Unhandled message content: ${JSON.stringify(unhandledContent)}`);
    }
  }
}

/** Whether normalized content carries a file that is not yet stored. */
function hasOutgoingUpload(content: NormalizedOutgoingContent): boolean {
  switch (content.kind) {
    case 'text':
    case 'existing':
      return false;
    case 'photo':
      return content.photo.kind === 'upload';
    case 'document':
      return content.document.kind === 'upload';
    case 'rich_message':
      return listRichMessageFiles(content.richMessage).some(({ file }) => file.kind === 'upload');
    default: {
      const unhandledContent: never = content;
      throw new Error(`Unhandled message content: ${JSON.stringify(unhandledContent)}`);
    }
  }
}

/**
 * Whether normalized content would leave a message's content as it is. Content with a new upload
 * always changes it.
 */
export function isUnchangedContent(
  replacement: NormalizedOutgoingContent,
  content: MessageContent,
): boolean {
  return !hasOutgoingUpload(replacement) &&
    isSameMessageContent(toContentOfStoredFile(replacement), content);
}

function getStoredFileId(file: OutgoingPhoto | OutgoingDocument): StoredFileId {
  if (file.kind !== 'stored') {
    throw new Error('Expected a stored file rather than an upload');
  }
  return file.file.id;
}

/** The content of a message that a bot's edit replaces. */
interface EditableMessage {
  readonly content: MessageContent;
  readonly inlineKeyboard?: InlineKeyboard;
}

/** A bot's edit of its message: new content, whose upload is not yet stored, and keyboard. */
interface BotMessageEdit {
  readonly content: NormalizedOutgoingContent;
  readonly inlineKeyboard?: InlineKeyboard;
}

/**
 * Checks a bot's edit of its message as Telegram does: the callback data of the new keyboard and
 * of the buttons of new rich content must fit, and the edit must change the content or the
 * keyboard.
 */
export function checkBotMessageEdit(
  message: EditableMessage,
  edit: BotMessageEdit,
): 'callback_data_invalid' | 'message_not_modified' | undefined {
  if (!hasOnlyValidButtonCallbackData(edit.inlineKeyboard, edit.content)) {
    return 'callback_data_invalid';
  }
  return isUnchangedContent(edit.content, message.content) &&
      areInlineKeyboardsEqual(edit.inlineKeyboard, message.inlineKeyboard)
    ? 'message_not_modified'
    : undefined;
}

const utf8Encoder = new TextEncoder();

/** Telegram rejects a keyboard whose callback data exceeds its byte limit when UTF-8 encoded. */
export function hasOnlyValidCallbackData(inlineKeyboard: InlineKeyboard): boolean {
  return inlineKeyboard.every((row) => row.every(hasValidCallbackData));
}

/**
 * Telegram rejects a message whose buttons exceed the callback data limit, whether they are in
 * its inline keyboard or in its rich message.
 */
export function hasOnlyValidButtonCallbackData(
  inlineKeyboard: InlineKeyboard | undefined,
  content: NormalizedOutgoingContent,
): boolean {
  return (inlineKeyboard === undefined || hasOnlyValidCallbackData(inlineKeyboard)) &&
    (content.kind !== 'rich_message' ||
      listRichMessageButtons(content.richMessage).every(({ action }) =>
        hasValidCallbackData(action)
      ));
}

/**
 * Whether a message has a Web App button, in its inline keyboard or in its rich message. The Bot
 * API reference allows Web App buttons only in private chats between a user and the bot, and
 * Telegram's servers refuse them elsewhere.
 */
export function hasWebAppButton(
  inlineKeyboard: InlineKeyboard | undefined,
  content: NormalizedOutgoingContent,
): boolean {
  return (inlineKeyboard?.some((row) => row.some(({ kind }) => kind === 'web_app')) ?? false) ||
    (content.kind === 'rich_message' &&
      listRichMessageButtons(content.richMessage).some(({ action }) => action.kind === 'web_app'));
}

function hasValidCallbackData(action: RichMessageButtonAction): boolean {
  return action.kind !== 'callback' ||
    utf8Encoder.encode(action.callbackData).length <= MAX_CALLBACK_DATA_BYTES;
}

/**
 * Whether an edit leaves the content as it is, which Telegram refuses. Where the caption shows is
 * part of a caption's content only while there is a caption.
 */
export function isSameMessageContent(first: MessageContent, second: MessageContent): boolean {
  switch (first.kind) {
    case 'text':
      return second.kind === 'text' && isSameFormattedText(first, second);
    case 'photo':
      return second.kind === 'photo' && first.fileId === second.fileId &&
        first.hasSpoiler === second.hasSpoiler &&
        isSameFormattedText(first.caption, second.caption) &&
        (first.caption.text.length === 0 ||
          first.showsCaptionAboveMedia === second.showsCaptionAboveMedia);
    case 'document':
      return second.kind === 'document' && first.fileId === second.fileId &&
        isSameFormattedText(first.caption, second.caption);
    case 'rich_message':
      return second.kind === 'rich_message' && areRichMessagesEqual(first, second);
    default: {
      const unhandledContent: never = first;
      throw new Error(`Unhandled message content: ${JSON.stringify(unhandledContent)}`);
    }
  }
}

function isSameFormattedText(first: FormattedText, second: FormattedText): boolean {
  return first.text === second.text && areTextEntitiesEqual(first.entities, second.entities);
}

/** Whether an edit leaves the inline keyboard as it is, which Telegram refuses. */
function areInlineKeyboardsEqual(
  first: InlineKeyboard | undefined,
  second: InlineKeyboard | undefined,
): boolean {
  if (first === undefined || second === undefined) {
    return first === second;
  }
  return first.length === second.length && first.every((firstRow, rowIndex) => {
    const secondRow = second[rowIndex];
    return firstRow.length === secondRow.length && firstRow.every((firstButton, buttonIndex) => {
      const secondButton = secondRow[buttonIndex];
      return firstButton.text === secondButton.text &&
        isSameButtonAppearance(firstButton, secondButton) &&
        isSameInlineKeyboardButtonAction(firstButton, secondButton);
    });
  });
}

/** Whether two buttons act the same, as TDLib compares their type and data. */
function isSameInlineKeyboardButtonAction(
  first: InlineKeyboardButton,
  second: InlineKeyboardButton,
): boolean {
  switch (first.kind) {
    case 'callback':
      return second.kind === 'callback' && first.callbackData === second.callbackData;
    case 'url':
      return second.kind === 'url' && first.url === second.url;
    case 'copy_text':
      return second.kind === 'copy_text' && first.copiedText === second.copiedText;
    case 'login_url':
      return second.kind === 'login_url' && first.url === second.url &&
        first.forwardText === second.forwardText &&
        first.authorizingBotUsername?.toLowerCase() ===
          second.authorizingBotUsername?.toLowerCase() &&
        first.requestsWriteAccess === second.requestsWriteAccess;
    case 'web_app':
      return second.kind === 'web_app' && first.url === second.url;
    case 'switch_inline_query':
      return second.kind === 'switch_inline_query' && first.query === second.query &&
        isSameInlineQuerySwitchTarget(first.target, second.target);
    case 'disabled':
      return second.kind === 'disabled';
    default: {
      const unhandledButton: never = first;
      throw new Error(`Unhandled inline keyboard button: ${JSON.stringify(unhandledButton)}`);
    }
  }
}

function isSameInlineQuerySwitchTarget(
  first: InlineQuerySwitchTarget,
  second: InlineQuerySwitchTarget,
): boolean {
  if (first.kind === 'current_chat' || second.kind === 'current_chat') {
    return first.kind === second.kind;
  }
  return first.chatTypes.allowsUserChats === second.chatTypes.allowsUserChats &&
    first.chatTypes.allowsBotChats === second.chatTypes.allowsBotChats &&
    first.chatTypes.allowsGroupChats === second.chatTypes.allowsGroupChats &&
    first.chatTypes.allowsChannelChats === second.chatTypes.allowsChannelChats;
}

/** The Bot API `quote_position` bound beyond which TDLib's `MessageQuote` reads position 0. */
const MAX_SPECIFIED_QUOTE_POSITION = 1_000_000;

/** A quote a sender chose from the message it replies to, before Telegram's normalization. */
export interface SpecifiedQuote {
  readonly text: string;
  /** Formatting the sender specified; omitted for none. */
  readonly entities?: readonly TextEntity[];
  /** Where the sender says the quote starts in the replied text, in UTF-16 code units. */
  readonly position: number;
}

/** The replied message's text, and whether Telegram quotes it when the sender chose no quote. */
export interface ReplyQuoteSource {
  /** The replied text or caption, which is empty for media without a caption. */
  readonly repliedText: FormattedText;
  /** True for a reply to a message of another chat, which Telegram quotes automatically. */
  readonly quotesAutomatically: boolean;
}

/**
 * The text a reply can quote: that of a message of another chat it replies to, or else that of the
 * message of its own chat; `undefined` for a message that replies to none.
 */
export function getReplyQuoteSource(
  repliedMessage: ChatMessage | undefined,
  externalReply: ExternalReplyTarget | undefined,
): ReplyQuoteSource | undefined {
  if (externalReply !== undefined) {
    return { repliedText: externalReply.repliedText, quotesAutomatically: true };
  }
  return repliedMessage === undefined
    ? undefined
    : { repliedText: getContentText(repliedMessage.content), quotesAutomatically: false };
}

export type ReplyQuoteResolution =
  | { readonly resolved: true; readonly quote?: TextQuote }
  | { readonly resolved: false; readonly reason: 'quote_invalid' };

/**
 * Decides the quote a reply shows. A chosen quote is normalized as TDLib's `MessageQuote` does,
 * which drops it silently when it cannot be normalized or becomes empty, and shifts its position by
 * the leading spaces trimmed from it. Telegram then requires it to be an exact part of the replied
 * text, formatting included, and places it at the occurrence nearest to the position the sender
 * gave; a quote that is not found, or longer than 1,024 characters, fails the send. Without a
 * chosen quote, a reply to a message of another chat quotes its text automatically. A message
 * that replies to none has no quote.
 */
export function resolveReplyQuote(
  source: ReplyQuoteSource | undefined,
  specifiedQuote: SpecifiedQuote | undefined,
  context: FormattedTextFixingContext,
): ReplyQuoteResolution {
  if (source === undefined) {
    return { resolved: true };
  }
  const { repliedText, quotesAutomatically } = source;
  const fixing = specifiedQuote === undefined
    ? undefined
    : fixFormattedText(specifiedQuote.text, specifiedQuote.entities ?? [], context, 'clear');
  if (specifiedQuote === undefined || !fixing?.fixed || fixing.formattedText.text.length === 0) {
    const automaticQuote = quotesAutomatically ? createAutomaticQuote(repliedText) : undefined;
    return { resolved: true, ...(automaticQuote === undefined ? {} : { quote: automaticQuote }) };
  }

  const quoteText: FormattedText = {
    text: fixing.formattedText.text,
    entities: fixing.formattedText.entities.filter(isQuoteEntity),
  };
  if (countTextCharacters(quoteText.text) > MAX_QUOTE_LENGTH) {
    return { resolved: false, reason: 'quote_invalid' };
  }
  const { position } = specifiedQuote;
  const quotePosition = findQuotePosition(
    repliedText,
    quoteText,
    position >= 0 && position <= MAX_SPECIFIED_QUOTE_POSITION
      ? position + fixing.trimmedLeadingLength
      : 0,
  );
  return quotePosition === undefined
    ? { resolved: false, reason: 'quote_invalid' }
    : { resolved: true, quote: { text: quoteText, position: quotePosition, isManual: true } };
}

/**
 * Finds where a quote appears in the replied text with the same formatting, searching outward from
 * the given position in the order TDLib's `MessageQuote::search_quote` does.
 */
function findQuotePosition(
  repliedText: FormattedText,
  quote: FormattedText,
  position: number,
): number | undefined {
  const textLength = repliedText.text.length;
  const quoteLength = quote.text.length;
  if (quoteLength > textLength) {
    return undefined;
  }
  const quotesAt = (candidate: number) =>
    candidate >= 0 && candidate <= textLength - quoteLength &&
    !isLowSurrogate(repliedText.text.charCodeAt(candidate)) &&
    repliedText.text.startsWith(quote.text, candidate) &&
    areTextEntitiesEqual(
      getQuotedEntities(repliedText.entities, candidate, quoteLength),
      [...quote.entities].sort(compareTextEntities),
    );
  const start = Math.min(Math.max(position, 0), textLength - 1);
  for (
    let distance = 0;
    start - distance >= 0 || start + distance + 1 <= textLength - quoteLength;
    distance++
  ) {
    if (quotesAt(start - distance)) {
      return start - distance;
    }
    if (quotesAt(start + distance + 1)) {
      return start + distance + 1;
    }
  }
  return undefined;
}

/** The quotable entities of a text that a span covers, cut to the span and relative to its start. */
function getQuotedEntities(
  entities: readonly TextEntity[],
  spanOffset: number,
  spanLength: number,
): TextEntity[] {
  const spanEnd = spanOffset + spanLength;
  return entities.flatMap((entity) => {
    const start = Math.max(entity.offset, spanOffset);
    const end = Math.min(entity.offset + entity.length, spanEnd);
    return isQuoteEntity(entity) && start < end
      ? [{ ...entity, offset: start - spanOffset, length: end - start }]
      : [];
  }).sort(compareTextEntities);
}

function isLowSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xdc00 && codeUnit <= 0xdfff;
}
