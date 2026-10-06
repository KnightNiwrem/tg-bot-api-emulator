import {
  type EmptyTextTreatment,
  fixFormattedText,
  type FormattedTextFixingContext,
} from '../text_entities/formatted_text.ts';
import { cleanInputString } from '../text_entities/input_string.ts';
import { areTextEntitiesEqual } from '../text_entities/text_entity_equality.ts';
import { compareTextEntities } from '../text_entities/text_entity_order.ts';
import { isSameButtonAppearance } from '../types/button_appearance.ts';
import { type Contact, createWrittenContact, type WrittenContact } from '../types/contact.ts';
import type { GeoLocation } from '../types/geo_location.ts';
import {
  type InlineKeyboard,
  type InlineKeyboardButton,
  type InlineQuerySwitchTarget,
  MAX_CALLBACK_DATA_BYTES,
} from '../types/inline_keyboard.ts';
import {
  type AlbumCompositionFailureReason,
  canChangeAlbumMediaKind,
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
import type { NewPoll, Poll, SpecifiedAccountPoll, SpecifiedPoll } from '../types/poll.ts';
import type {
  AudioUpload,
  DocumentUpload,
  FileUpload,
  PhotoUpload,
  StoredAudioFile,
  StoredDocumentFile,
  StoredFile,
  StoredFileId,
  StoredPhotoFile,
  StoredVideoFile,
  StoredVoiceFile,
  VideoUpload,
  VoiceUpload,
} from '../types/stored_file.ts';
import { getOwnContact, type VirtualAccount } from '../types/virtual_account.ts';
import {
  type CaptionedMediaContent,
  type ChatMessage,
  type ContactMessageContent,
  type ContentMessage,
  countTextCharacters,
  type FormattedText,
  getContentText,
  isCaptionedMediaContent,
  type LocationMessageContent,
  MAX_CAPTION_LENGTH,
  MAX_TEXT_MESSAGE_LENGTH,
  type MessageContent,
  type TextEntity,
  type TextQuote,
} from '../types/virtual_message.ts';
import { normalizeNewPoll, type PollLimitFailure } from './poll_normalization.ts';
import { normalizeRichMessage } from './rich_message_normalization.ts';

// Telegram's rules for the content of messages, which apply alike in every chat type.

/**
 * Telegram rejected the text or its entities while normalizing them, for example because only
 * whitespace remains or an entity ends past the text. `textError` is TDLib's own description, or,
 * for text that only Telegram's servers refuse, a description in its style.
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

export type OutgoingVideo = OutgoingFile<StoredVideoFile, VideoUpload>;

export type OutgoingVoice = OutgoingFile<StoredVoiceFile, VoiceUpload>;

export type OutgoingAudio = OutgoingFile<StoredAudioFile, AudioUpload>;

/** A file that new captioned media carries. */
type OutgoingMediaFile =
  | OutgoingPhoto
  | OutgoingDocument
  | OutgoingVideo
  | OutgoingVoice
  | OutgoingAudio;

/** The files of a rich message being sent: each reused by its stored file, or a new upload. */
export interface OutgoingRichMessageFileTypes {
  readonly photo: OutgoingPhoto;
  readonly document: OutgoingDocument;
  readonly video: OutgoingVideo;
  readonly voice: OutgoingVoice;
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
  | (SpecifiedCaption & {
    readonly kind: 'video';
    readonly video: OutgoingVideo;
    readonly hasSpoiler: boolean;
    readonly showsCaptionAboveMedia: boolean;
    /** As `VideoMessageContent` describes it. */
    readonly startTimestampSeconds: number;
  })
  | (SpecifiedCaption & {
    readonly kind: 'voice';
    readonly voice: OutgoingVoice;
  })
  | (SpecifiedCaption & {
    readonly kind: 'audio';
    readonly audio: OutgoingAudio;
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
    /** A new poll, which its sender creates. */
    readonly kind: 'poll';
    readonly poll: SpecifiedPoll;
  }
  | {
    /** A contact, whose texts Telegram cleans as `normalizeContact` does. */
    readonly kind: 'contact';
    readonly contact: Contact;
  }
  | LocationMessageContent
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

/**
 * A new caption of media, with where a photo or video shows it; other media ignores the placement.
 */
export type CaptionReplacement = SpecifiedCaption & { readonly showsCaptionAboveMedia: boolean };

/**
 * New message content that passed Telegram's checks, whose upload or new poll is not yet stored.
 */
export type NormalizedOutgoingContent =
  | Extract<MessageContent, { readonly kind: 'text' }>
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
  | {
    readonly kind: 'video';
    readonly video: OutgoingVideo;
    readonly caption: FormattedText;
    readonly hasSpoiler: boolean;
    readonly showsCaptionAboveMedia: boolean;
    readonly startTimestampSeconds: number;
  }
  | {
    readonly kind: 'voice';
    readonly voice: OutgoingVoice;
    readonly caption: FormattedText;
  }
  | {
    readonly kind: 'audio';
    readonly audio: OutgoingAudio;
    readonly caption: FormattedText;
  }
  | { readonly kind: 'rich_message'; readonly richMessage: OutgoingRichMessage }
  | { readonly kind: 'poll'; readonly poll: NewPoll }
  | ContactMessageContent
  | LocationMessageContent
  | { readonly kind: 'existing'; readonly content: MessageContent };

/** Why Telegram refuses the text or caption of new content: as for every content but a poll. */
export type ContentTextNormalizationFailure =
  | TextInvalidFailure
  | { readonly reason: 'message_text_too_long' | 'caption_too_long' };

export type ContentNormalizationFailure = ContentTextNormalizationFailure | PollLimitFailure;

export type OutgoingContentNormalization<
  Failure extends ContentNormalizationFailure = ContentNormalizationFailure,
> =
  | { readonly normalized: true; readonly content: NormalizedOutgoingContent }
  | { readonly normalized: false; readonly failure: Failure };

/** New content other than a poll, which `sendPoll`, accounts' polls, and copies of polls carry. */
export type OutgoingContentOtherThanPoll = Exclude<
  OutgoingMessageContent,
  { readonly kind: 'poll' }
>;

/**
 * Normalizes the text or caption of new message content, with the entities its sender specified,
 * as Telegram does, which also marks bot commands; then checks that the result fits in a message.
 * A rich message is checked and has its entities marked as `normalizeRichMessage` does, a poll is
 * checked as `normalizeNewPoll` does, and a contact is cleaned as `normalizeContact` cleans it. A
 * location carries no text, so it passes as it is: every reader of a location, the Bot API handler
 * and the account routes, checks it as `isPointOnEarth` requires before it becomes content.
 */
export function normalizeOutgoingContent(
  content: OutgoingContentOtherThanPoll,
  sender: MessageSenderKind,
  context: FormattedTextFixingContext,
): OutgoingContentNormalization<ContentTextNormalizationFailure>;
export function normalizeOutgoingContent(
  content: OutgoingMessageContent,
  sender: MessageSenderKind,
  context: FormattedTextFixingContext,
): OutgoingContentNormalization;
export function normalizeOutgoingContent(
  content: OutgoingMessageContent,
  sender: MessageSenderKind,
  context: FormattedTextFixingContext,
): OutgoingContentNormalization {
  if (content.kind === 'location') {
    return { normalized: true, content };
  }
  if (content.kind === 'text' || content.kind === 'rich_message') {
    const replacement = normalizeTextMessageReplacement(content, context);
    return replacement.normalized
      ? replacement
      : { normalized: false, failure: replacement.failure };
  }
  if (content.kind === 'existing') {
    return normalizeExistingContent(content.content, content.captionReplacement, sender, context);
  }
  if (content.kind === 'poll') {
    const pollNormalization = normalizeNewPoll(content.poll, context);
    return pollNormalization.normalized
      ? { normalized: true, content: { kind: 'poll', poll: pollNormalization.poll } }
      : pollNormalization;
  }
  if (content.kind === 'contact') {
    const contactNormalization = normalizeContact(content.contact);
    return contactNormalization.normalized
      ? { normalized: true, content: { kind: 'contact', contact: contactNormalization.contact } }
      : contactNormalization;
  }
  return normalizeMediaContent(content, sender, context);
}

/**
 * The texts of a contact in the order TDLib's `Contact::validate` cleans them, each with the name
 * its error gives the text.
 */
const CONTACT_TEXT_FIELDS = [
  { field: 'phoneNumber', name: 'Phone number' },
  { field: 'firstName', name: 'First name' },
  { field: 'lastName', name: 'Last name' },
  { field: 'vcard', name: 'vCard' },
] as const satisfies readonly { readonly field: keyof Contact; readonly name: string }[];

type ContactNormalization =
  | { readonly normalized: true; readonly contact: Contact }
  | { readonly normalized: false; readonly failure: TextInvalidFailure };

/** The texts every contact has, which its sender must not leave empty. */
const REQUIRED_CONTACT_TEXT_FIELDS: ReadonlySet<keyof Contact> = new Set([
  'phoneNumber',
  'firstName',
]);

/**
 * Cleans the texts of a contact in order as TDLib's `Contact::validate` does with
 * `clean_input_string`, which refuses text that is not well-formed Unicode with an error naming
 * it, such as "Phone number must be encoded in UTF-8". Cleaning removes some characters, such as
 * carriage returns, so a phone number or first name of only such characters becomes empty, which
 * TDLib passes on to Telegram's servers; the emulator refuses it, such as with "First name must be
 * non-empty". Nothing else of a contact is checked: the phone number keeps any form its sender
 * wrote, and the vCard is never parsed.
 */
function normalizeContact(contact: Contact): ContactNormalization {
  let cleanedContact = contact;
  for (const { field, name } of CONTACT_TEXT_FIELDS) {
    const cleanedText = cleanInputString(contact[field]);
    if (cleanedText === undefined) {
      return {
        normalized: false,
        failure: { reason: 'text_invalid', textError: `${name} must be encoded in UTF-8` },
      };
    }
    if (cleanedText.length === 0 && REQUIRED_CONTACT_TEXT_FIELDS.has(field)) {
      return {
        normalized: false,
        failure: { reason: 'text_invalid', textError: `${name} must be non-empty` },
      };
    }
    cleanedContact = { ...cleanedContact, [field]: cleanedText };
  }
  return { normalized: true, contact: cleanedContact };
}

/** New captioned media of a message, as its sender specified it. */
export type OutgoingCaptionedMedia = Extract<
  OutgoingMessageContent,
  { readonly kind: 'photo' | 'document' | 'video' | 'voice' | 'audio' }
>;

/**
 * New media that albums hold and that replaces a message's media, with its caption, as its sender
 * specified it: a photo, a document, a video, or an audio file. As TDLib's
 * `is_allowed_media_group_content` and `is_editable_media_message_content` decide, a voice note is
 * neither.
 */
export type MediaContent = Exclude<OutgoingCaptionedMedia, { readonly kind: 'voice' }>;

type MediaContentNormalization =
  | { readonly normalized: true; readonly content: NormalizedOutgoingContent }
  | { readonly normalized: false; readonly failure: CaptionNormalizationFailure };

/**
 * Normalizes the caption of new media as `normalizeCaption` does, and then the metadata of an
 * uploaded audio file as `normalizeAudioMetadata` does, in the order TDLib's
 * `create_input_message_content` checks them.
 */
function normalizeMediaContent(
  content: OutgoingCaptionedMedia,
  sender: MessageSenderKind,
  context: FormattedTextFixingContext,
): MediaContentNormalization {
  const captionNormalization = normalizeCaption(content, sender, context);
  if (!captionNormalization.normalized) {
    return captionNormalization;
  }
  if (content.kind === 'audio') {
    const audioNormalization = normalizeAudioMetadata(content.audio);
    return audioNormalization.normalized
      ? {
        normalized: true,
        content: {
          kind: 'audio',
          audio: audioNormalization.audio,
          caption: captionNormalization.caption,
        },
      }
      : audioNormalization;
  }
  return {
    normalized: true,
    content: withNormalizedCaption(content, captionNormalization.caption),
  };
}

type AudioMetadataNormalization =
  | { readonly normalized: true; readonly audio: OutgoingAudio }
  | { readonly normalized: false; readonly failure: TextInvalidFailure };

/**
 * Cleans the title, then the performer, of an uploaded audio file as TDLib's
 * `create_input_message_content` does with `clean_input_string`, refusing text that is not
 * well-formed Unicode with TDLib's error. A title or performer that cleaning empties is none. An
 * audio file reused by its `file_id` keeps the metadata it was stored with, which was cleaned when
 * it was sent.
 */
function normalizeAudioMetadata(audio: OutgoingAudio): AudioMetadataNormalization {
  if (audio.kind === 'stored') {
    return { normalized: true, audio };
  }
  const { title, performer, ...upload } = audio.upload;
  const cleanedTitle = title === undefined ? '' : cleanInputString(title);
  if (cleanedTitle === undefined) {
    return {
      normalized: false,
      failure: { reason: 'text_invalid', textError: 'Audio title must be encoded in UTF-8' },
    };
  }
  const cleanedPerformer = performer === undefined ? '' : cleanInputString(performer);
  if (cleanedPerformer === undefined) {
    return {
      normalized: false,
      failure: { reason: 'text_invalid', textError: 'Audio performer must be encoded in UTF-8' },
    };
  }
  return {
    normalized: true,
    audio: {
      kind: 'upload',
      upload: {
        ...upload,
        ...(cleanedPerformer.length === 0 ? {} : { performer: cleanedPerformer }),
        ...(cleanedTitle.length === 0 ? {} : { title: cleanedTitle }),
      },
    },
  };
}

/** New media with its caption normalized, in place of the caption its sender specified. */
function withNormalizedCaption(
  content: OutgoingCaptionedMedia,
  caption: FormattedText,
): NormalizedOutgoingContent {
  switch (content.kind) {
    case 'photo':
      return {
        kind: 'photo',
        photo: content.photo,
        caption,
        hasSpoiler: content.hasSpoiler,
        showsCaptionAboveMedia: content.showsCaptionAboveMedia,
      };
    case 'document':
      return { kind: 'document', document: content.document, caption };
    case 'video':
      return {
        kind: 'video',
        video: content.video,
        caption,
        hasSpoiler: content.hasSpoiler,
        showsCaptionAboveMedia: content.showsCaptionAboveMedia,
        startTimestampSeconds: content.startTimestampSeconds,
      };
    case 'voice':
      return { kind: 'voice', voice: content.voice, caption };
    case 'audio':
      return { kind: 'audio', audio: content.audio, caption };
    default: {
      const unhandledContent: never = content;
      throw new Error(`Unhandled media content: ${JSON.stringify(unhandledContent)}`);
    }
  }
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
 * Keeps the content of an existing message as it is, apart from a replaced caption of captioned
 * media, which is normalized as a new caption is. Text and rich messages have no caption to
 * replace.
 */
function normalizeExistingContent(
  content: MessageContent,
  captionReplacement: CaptionReplacement | undefined,
  sender: MessageSenderKind,
  context: FormattedTextFixingContext,
): OutgoingContentNormalization {
  if (captionReplacement === undefined || !isCaptionedMediaContent(content)) {
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
 * What an account sends: text; media with a caption, which is a photo, a document, a video, a voice
 * note, or an audio file as its upload says, each with the formatting the account specified; a contact the
 * account writes, whose Telegram user stays unknown; the account's own contact; a location; or a
 * new poll, which the account creates.
 */
export type AccountMessageContent =
  | {
    readonly kind: 'text';
    readonly text: string;
    /** Formatting the account specified; omitted for none. */
    readonly entities?: readonly TextEntity[];
  }
  | AccountMediaContent
  | { readonly kind: 'contact'; readonly contact: WrittenContact }
  | { readonly kind: 'own_contact' }
  | LocationMessageContent
  | { readonly kind: 'poll'; readonly poll: SpecifiedAccountPoll };

/** Media an account sends, of the kind its upload says, with its caption. */
export type AccountMediaContent<Upload extends FileUpload = FileUpload> = SpecifiedCaption & {
  readonly kind: 'media';
  readonly upload: Upload;
};

/**
 * Media an account sends in an album: a photo, a document, a video, or an audio file, but no voice
 * note.
 */
export type AccountAlbumMediaContent = AccountMediaContent<Exclude<FileUpload, VoiceUpload>>;

/**
 * Turns what an account sends into outgoing content, which its client normalizes as Telegram
 * does, as `toOutgoingAccountMedia` turns media. The account's own contact is the one
 * `getOwnContact` gives; returns `undefined` for the own contact of an account without a phone
 * number.
 */
export function toOutgoingAccountContent(
  content: AccountMessageContent,
  account: VirtualAccount,
): OutgoingMessageContent | undefined {
  switch (content.kind) {
    case 'text':
    case 'location':
      return content;
    case 'contact':
      return { kind: 'contact', contact: createWrittenContact(content.contact) };
    case 'own_contact': {
      const ownContact = getOwnContact(account);
      return ownContact === undefined ? undefined : { kind: 'contact', contact: ownContact };
    }
    case 'media':
      return toOutgoingAccountMedia(content);
    case 'poll':
      // TDLib creates a poll a user sends open, whatever the client asks.
      return {
        kind: 'poll',
        poll: {
          ...content.poll,
          creator: { kind: 'account', accountId: account.profile.id },
          isClosed: false,
        },
      };
    default: {
      const unhandledContent: never = content;
      throw new Error(`Unhandled account content: ${JSON.stringify(unhandledContent)}`);
    }
  }
}

/**
 * Turns media an account sends into outgoing media. An account never covers a photo or video,
 * moves its caption, or starts a video past its beginning.
 */
export function toOutgoingAccountMedia(content: AccountAlbumMediaContent): MediaContent;
export function toOutgoingAccountMedia(content: AccountMediaContent): OutgoingCaptionedMedia;
export function toOutgoingAccountMedia(
  { upload, caption, captionEntities }: AccountMediaContent,
): OutgoingCaptionedMedia {
  switch (upload.type) {
    case 'photo':
      return {
        kind: 'photo',
        photo: { kind: 'upload', upload },
        caption,
        captionEntities,
        hasSpoiler: false,
        showsCaptionAboveMedia: false,
      };
    case 'document':
      return { kind: 'document', document: { kind: 'upload', upload }, caption, captionEntities };
    case 'video':
      return {
        kind: 'video',
        video: { kind: 'upload', upload },
        caption,
        captionEntities,
        hasSpoiler: false,
        showsCaptionAboveMedia: false,
        startTimestampSeconds: 0,
      };
    case 'voice':
      return { kind: 'voice', voice: { kind: 'upload', upload }, caption, captionEntities };
    case 'audio':
      return { kind: 'audio', audio: { kind: 'upload', upload }, caption, captionEntities };
    default: {
      const unhandledUpload: never = upload;
      throw new Error(`Unhandled account upload: ${JSON.stringify(unhandledUpload)}`);
    }
  }
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
 * Replaces the caption of captioned media, normalized as when sending; an empty caption removes
 * it. As on Telegram, a text message has no caption to replace, and only a photo or video shows its
 * caption above itself: other media ignores `showsCaptionAboveMedia`, and omitting it keeps the
 * setting.
 */
export function replaceMessageCaption(
  content: MessageContent,
  specifiedCaption: SpecifiedCaption & { readonly showsCaptionAboveMedia?: boolean },
  sender: MessageSenderKind,
  context: FormattedTextFixingContext,
): ContentReplacement<'message_has_no_caption' | 'caption_too_long'> {
  if (!isCaptionedMediaContent(content)) {
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
 * may be a photo, a document, a video, or an audio file, whose media is replaced, or text or a rich
 * message, which becomes media; the media of a voice note, a poll, a contact, or a location cannot
 * be edited, which that method checks before it reads the new media. As that method checks once
 * the new caption is read, a message of an album changes its media only as
 * `canChangeAlbumMediaKind` allows; only media is sent in albums.
 */
export function replaceMessageMedia(
  { content, mediaGroupId }: Pick<ContentMessage, 'content' | 'mediaGroupId'>,
  media: MediaContent,
  context: FormattedTextFixingContext,
): ContentReplacement<
  'message_media_not_editable' | 'caption_too_long' | 'album_media_kind_changed'
> {
  switch (content.kind) {
    case 'voice':
      return { replaced: false, failure: { reason: 'message_media_not_editable' } };
    case 'text':
    case 'rich_message': {
      const normalization = normalizeMediaContent(media, 'bot', context);
      return normalization.normalized
        ? { replaced: true, content: normalization.content }
        : { replaced: false, failure: normalization.failure };
    }
    case 'photo':
    case 'document':
    case 'video':
    case 'audio': {
      const normalization = normalizeMediaContent(media, 'bot', context);
      if (!normalization.normalized) {
        return { replaced: false, failure: normalization.failure };
      }
      return mediaGroupId !== undefined && !canChangeAlbumMediaKind(content.kind, media.kind)
        ? { replaced: false, failure: { reason: 'album_media_kind_changed' } }
        : { replaced: true, content: normalization.content };
    }
    case 'poll':
    case 'contact':
    case 'location':
      return { replaced: false, failure: { reason: 'message_media_not_editable' } };
    default: {
      const unhandledContent: never = content;
      throw new Error(`Unhandled message content: ${JSON.stringify(unhandledContent)}`);
    }
  }
}

/**
 * Gives media a normalized caption. Only a photo or video shows its caption above itself; omitting
 * the placement keeps it.
 */
function withCaption(
  content: CaptionedMediaContent,
  caption: FormattedText,
  showsCaptionAboveMedia: boolean | undefined,
): CaptionedMediaContent {
  switch (content.kind) {
    case 'photo':
    case 'video':
      return {
        ...content,
        caption,
        showsCaptionAboveMedia: showsCaptionAboveMedia ?? content.showsCaptionAboveMedia,
      };
    case 'document':
    case 'voice':
    case 'audio':
      return { ...content, caption };
    default: {
      const unhandledContent: never = content;
      throw new Error(`Unhandled media content: ${JSON.stringify(unhandledContent)}`);
    }
  }
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

/** Stores a new poll and returns the stored poll's identity. */
export interface NewPollStore {
  addPoll(newPoll: NewPoll): Pick<Poll, 'id'>;
}

/**
 * Stores the upload or the new poll of normalized content, if it carries one, and returns the
 * content as a message holds it. Call it only once the message is certain to be stored.
 */
export function storeOutgoingContent(
  content: NormalizedOutgoingContent,
  files: FileUploadStore,
  polls: NewPollStore,
): MessageContent {
  switch (content.kind) {
    case 'text':
    case 'contact':
    case 'location':
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
    case 'video':
      return {
        kind: 'video',
        fileId: storeOutgoingFile(content.video, files),
        caption: content.caption,
        hasSpoiler: content.hasSpoiler,
        showsCaptionAboveMedia: content.showsCaptionAboveMedia,
        startTimestampSeconds: content.startTimestampSeconds,
      };
    case 'voice':
      return {
        kind: 'voice',
        fileId: storeOutgoingFile(content.voice, files),
        caption: content.caption,
      };
    case 'audio':
      return {
        kind: 'audio',
        fileId: storeOutgoingFile(content.audio, files),
        caption: content.caption,
      };
    case 'rich_message':
      return {
        kind: 'rich_message',
        ...convertRichMessageFiles(content.richMessage, {
          photo: (photo) => storeOutgoingFile(photo, files),
          document: (document) => storeOutgoingFile(document, files),
          video: (video) => storeOutgoingFile(video, files),
          voice: (voice) => storeOutgoingFile(voice, files),
        }),
      };
    case 'poll':
      return { kind: 'poll', pollId: polls.addPoll(content.poll).id };
    default: {
      const unhandledContent: never = content;
      throw new Error(`Unhandled message content: ${JSON.stringify(unhandledContent)}`);
    }
  }
}

function storeOutgoingFile(file: OutgoingMediaFile, files: FileUploadStore): StoredFileId {
  return file.kind === 'stored' ? file.file.id : files.addFile(file.upload).id;
}

/**
 * Returns normalized content as a message holds it, for content whose file, if any, is already
 * stored, as when a bot reuses a file by its `file_id`. Content with an upload or a new poll must be
 * stored with `storeOutgoingContent` instead.
 */
export function toContentOfStoredFile(content: NormalizedOutgoingContent): MessageContent {
  switch (content.kind) {
    case 'text':
    case 'contact':
    case 'location':
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
    case 'video':
      return {
        kind: 'video',
        fileId: getStoredFileId(content.video),
        caption: content.caption,
        hasSpoiler: content.hasSpoiler,
        showsCaptionAboveMedia: content.showsCaptionAboveMedia,
        startTimestampSeconds: content.startTimestampSeconds,
      };
    case 'voice':
      return { kind: 'voice', fileId: getStoredFileId(content.voice), caption: content.caption };
    case 'audio':
      return { kind: 'audio', fileId: getStoredFileId(content.audio), caption: content.caption };
    case 'rich_message':
      return {
        kind: 'rich_message',
        ...convertRichMessageFiles(content.richMessage, {
          photo: getStoredFileId,
          document: getStoredFileId,
          video: getStoredFileId,
          voice: getStoredFileId,
        }),
      };
    case 'poll':
      throw new Error('Expected content without a new poll, which only a message can store');
    default: {
      const unhandledContent: never = content;
      throw new Error(`Unhandled message content: ${JSON.stringify(unhandledContent)}`);
    }
  }
}

/**
 * Whether normalized content carries something that is not yet stored: a file upload, or a new
 * poll.
 */
function hasUnstoredContent(content: NormalizedOutgoingContent): boolean {
  switch (content.kind) {
    case 'text':
    case 'contact':
    case 'location':
    case 'existing':
      return false;
    case 'photo':
      return content.photo.kind === 'upload';
    case 'document':
      return content.document.kind === 'upload';
    case 'video':
      return content.video.kind === 'upload';
    case 'voice':
      return content.voice.kind === 'upload';
    case 'audio':
      return content.audio.kind === 'upload';
    case 'rich_message':
      return listRichMessageFiles(content.richMessage).some(({ file }) => file.kind === 'upload');
    case 'poll':
      return true;
    default: {
      const unhandledContent: never = content;
      throw new Error(`Unhandled message content: ${JSON.stringify(unhandledContent)}`);
    }
  }
}

/**
 * Whether normalized content would leave a message's content as it is. Content with a new upload
 * or a new poll always changes it.
 */
export function isUnchangedContent(
  replacement: NormalizedOutgoingContent,
  content: MessageContent,
): boolean {
  return !hasUnstoredContent(replacement) &&
    isSameMessageContent(toContentOfStoredFile(replacement), content);
}

function getStoredFileId(file: OutgoingMediaFile): StoredFileId {
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
    case 'video':
      return second.kind === 'video' && first.fileId === second.fileId &&
        first.hasSpoiler === second.hasSpoiler &&
        first.startTimestampSeconds === second.startTimestampSeconds &&
        isSameFormattedText(first.caption, second.caption) &&
        (first.caption.text.length === 0 ||
          first.showsCaptionAboveMedia === second.showsCaptionAboveMedia);
    case 'voice':
      return second.kind === 'voice' && first.fileId === second.fileId &&
        isSameFormattedText(first.caption, second.caption);
    case 'audio':
      return second.kind === 'audio' && first.fileId === second.fileId &&
        isSameFormattedText(first.caption, second.caption);
    case 'rich_message':
      return second.kind === 'rich_message' && areRichMessagesEqual(first, second);
    case 'poll':
      return second.kind === 'poll' && first.pollId === second.pollId;
    case 'contact':
      return second.kind === 'contact' && isSameContact(first.contact, second.contact);
    case 'location':
      return second.kind === 'location' && isSameGeoLocation(first.location, second.location);
    default: {
      const unhandledContent: never = first;
      throw new Error(`Unhandled message content: ${JSON.stringify(unhandledContent)}`);
    }
  }
}

/** Whether two contacts are the same, as TDLib's `Contact` compares every field. */
function isSameContact(first: Contact, second: Contact): boolean {
  return first.phoneNumber === second.phoneNumber && first.firstName === second.firstName &&
    first.lastName === second.lastName && first.vcard === second.vcard &&
    first.userId === second.userId;
}

function isSameGeoLocation(first: GeoLocation, second: GeoLocation): boolean {
  return first.latitude === second.latitude && first.longitude === second.longitude &&
    first.horizontalAccuracyMeters === second.horizontalAccuracyMeters;
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
