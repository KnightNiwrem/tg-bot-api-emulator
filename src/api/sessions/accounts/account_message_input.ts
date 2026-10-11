/**
 * Codecs of what an account sends: they read the wire values of a message, an album, or a poll,
 * which the contracts check, into the domain's content, checking the rules the contracts' JSON
 * Schema cannot state, and prepare the files the account uploads as its client does.
 */
import type { z } from 'zod';

import type { controlRequestIssueSchema } from '../../contracts/control_errors.ts';
import type {
  accountPollInputSchema,
  messageEntityInputListSchema,
  sendAccountMediaGroupContract,
  sendAccountMessageContract,
} from '../../contracts/message_sending.ts';
import type { DecodedControlRequest } from '../../contracts/operation_contract.ts';
import type { EmulationSession } from '../../../session/emulation_session.ts';
import { isContactVcardWithinLimit } from '../../../types/contact.ts';
import { createGeoLocation, type GeoLocation } from '../../../types/geo_location.ts';
import type { SpecifiedAccountPoll } from '../../../types/poll.ts';
import type { TextEntity } from '../../../types/virtual_message.ts';
import { decodeBase64Content } from '../base64_content.ts';
import { readAccountMessageEntities } from './account_message_entities.ts';

/** One problem with a control request's input, as a refusal lists it. */
type ControlRequestIssue = z.output<typeof controlRequestIssueSchema>;

type IssuePath = readonly (string | number)[];

type SendMessageBody = DecodedControlRequest<typeof sendAccountMessageContract>['body'];
type SendMediaGroupBody = DecodedControlRequest<typeof sendAccountMediaGroupContract>['body'];
type SentContentBody = Exclude<SendMessageBody, { readonly forward: unknown }>;
type AlbumMediaBody = SendMediaGroupBody['media'][number];

type MessageSending = EmulationSession['messageSending'];
type MediaFiles = EmulationSession['mediaFiles'];

/** The content of an account's message, as the domain sends it. */
export type AccountMessageContent = Parameters<
  MessageSending['sendAccountPrivateChatMessage']
>[0]['content'];

/** The content of a message of an account's album, as the domain sends it. */
export type AccountAlbumMediaContent = Parameters<
  MessageSending['sendAccountPrivateChatAlbum']
>[0]['contents'][number];

/** A file an account uploads, read from its request but not yet prepared as its client does. */
export type AccountUpload =
  | { readonly kind: 'photo'; readonly content: Uint8Array<ArrayBuffer> }
  | {
    readonly kind: 'document';
    readonly content: Uint8Array<ArrayBuffer>;
    readonly fileName: string;
  }
  | {
    readonly kind: 'video';
    readonly content: Uint8Array<ArrayBuffer>;
    readonly fileName: string | undefined;
    readonly attributes: {
      readonly durationSeconds: number;
      readonly width: number;
      readonly height: number;
    };
  }
  | {
    readonly kind: 'audio';
    readonly content: Uint8Array<ArrayBuffer>;
    readonly fileName: string | undefined;
    readonly attributes: {
      readonly durationSeconds: number;
      readonly performer: string;
      readonly title: string;
    };
  }
  | {
    readonly kind: 'voice';
    readonly content: Uint8Array<ArrayBuffer>;
    readonly durationSeconds: number;
  };

/** A file an account uploads that can join an album: any but a voice note. */
type AccountAlbumUpload = Exclude<AccountUpload, { readonly kind: 'voice' }>;

/** Media an account uploads, with its caption. */
export interface AccountMediaDraft<Upload extends AccountUpload = AccountUpload> {
  readonly kind: 'media';
  readonly upload: Upload;
  readonly caption: string;
  readonly captionEntities: readonly TextEntity[] | undefined;
}

/**
 * The content of an account's message as its request gives it: the domain's content, except that
 * an uploaded file is not yet prepared.
 */
export type AccountMessageDraft =
  | Exclude<AccountMessageContent, { readonly kind: 'media' }>
  | AccountMediaDraft;

/** A decoded value, or every issue of the rules its wire schema cannot state. */
export type AccountInputReading<Value> =
  | { readonly read: true; readonly value: Value }
  | {
    readonly read: false;
    readonly issues: [ControlRequestIssue, ...ControlRequestIssue[]];
  };

/**
 * Collects the issues of the rules a request's wire schema cannot state while its values are read.
 * A value that breaks a rule reads as a placeholder, which the issue's refusal discards.
 */
class AccountInputIssues {
  readonly #issues: ControlRequestIssue[] = [];

  /** Records that the body field at `path` breaks a rule, which `message` names. */
  refuse(path: IssuePath, message: string): void {
    this.#issues.push({ source: 'body', path: [...path], code: 'invalid_value', message });
  }

  /** The entities of the field at `path`, as `readAccountMessageEntities` reads them. */
  readEntities(
    entities: z.output<typeof messageEntityInputListSchema>,
    path: IssuePath,
  ): readonly TextEntity[] | undefined {
    const reading = readAccountMessageEntities(entities, path);
    if (!reading.read) {
      this.#issues.push(reading.issue);
      return undefined;
    }
    return reading.entities;
  }

  /** The bytes the base64 text of the field at `path` stands for. */
  readContent(base64Text: string, path: IssuePath): Uint8Array<ArrayBuffer> {
    const content = decodeBase64Content(base64Text);
    if (content === undefined) {
      this.refuse(path, 'Expected base64 text');
      return new Uint8Array();
    }
    return content;
  }

  /** `value` when no rule was broken, or the issues of those that were. */
  conclude<Value>(value: Value): AccountInputReading<Value> {
    const [firstIssue, ...otherIssues] = this.#issues;
    return firstIssue === undefined
      ? { read: true, value }
      : { read: false, issues: [firstIssue, ...otherIssues] };
  }
}

/** Reads the content of a message an account sends, other than a forward. */
export function readAccountMessageDraft(
  body: SentContentBody,
): AccountInputReading<AccountMessageDraft> {
  const issues = new AccountInputIssues();
  return issues.conclude(readMessageDraft(body, issues));
}

/** Reads the photos, videos, documents, or audio files of an album an account sends. */
export function readAccountAlbumDrafts(
  body: SendMediaGroupBody,
): AccountInputReading<readonly AccountMediaDraft<AccountAlbumUpload>[]> {
  const issues = new AccountInputIssues();
  return issues.conclude(
    body.media.map((media, index) => readAlbumMediaDraft(media, ['media', index], issues)),
  );
}

/** Reads a poll an account creates, which the field at `path` gives. */
export function readAccountPoll(
  poll: z.output<typeof accountPollInputSchema>,
  path: IssuePath,
): AccountInputReading<SpecifiedAccountPoll> {
  const issues = new AccountInputIssues();
  return issues.conclude(readPoll(poll, path, issues));
}

/**
 * The point on Earth an account shares, with the radius of uncertainty its client reports, which
 * becomes whole meters as `createGeoLocation` rounds it; an accuracy left out is unknown.
 */
export function readAccountLocation(
  { latitude, longitude, horizontal_accuracy }: {
    readonly latitude: number;
    readonly longitude: number;
    readonly horizontal_accuracy?: number;
  },
): GeoLocation {
  return createGeoLocation(latitude, longitude, horizontal_accuracy ?? 0);
}

function readMessageDraft(body: SentContentBody, issues: AccountInputIssues): AccountMessageDraft {
  if ('text' in body) {
    return {
      kind: 'text',
      text: body.text,
      entities: issues.readEntities(body.entities, ['entities']),
    };
  }
  if ('own_contact' in body) {
    return { kind: 'own_contact' };
  }
  if ('location' in body) {
    return { kind: 'location', location: readAccountLocation(body.location) };
  }
  if ('poll' in body) {
    return { kind: 'poll', poll: readPoll(body.poll, ['poll'], issues) };
  }
  if ('contact' in body) {
    const { phone_number, first_name, last_name, vcard } = body.contact;
    if (!isContactVcardWithinLimit(vcard)) {
      issues.refuse(['contact', 'vcard'], 'A vCard must fit in the bytes the Bot API allows');
    }
    return {
      kind: 'contact',
      contact: { phoneNumber: phone_number, firstName: first_name, lastName: last_name, vcard },
    };
  }
  if ('voice' in body) {
    const { content_base64, duration } = body.voice;
    return readMediaDraft(
      {
        kind: 'voice',
        content: issues.readContent(content_base64, ['voice', 'content_base64']),
        durationSeconds: duration,
      },
      body,
      [],
      issues,
    );
  }
  return readAlbumMediaDraft(body, [], issues);
}

/** Reads a photo, document, video, or audio file an account uploads, at `path` of the body. */
function readAlbumMediaDraft(
  media: AlbumMediaBody,
  path: IssuePath,
  issues: AccountInputIssues,
): AccountMediaDraft<AccountAlbumUpload> {
  return readMediaDraft(readAlbumUpload(media, path, issues), media, path, issues);
}

function readAlbumUpload(
  media: AlbumMediaBody,
  path: IssuePath,
  issues: AccountInputIssues,
): AccountAlbumUpload {
  if ('photo' in media) {
    return {
      kind: 'photo',
      content: issues.readContent(media.photo.content_base64, [...path, 'photo', 'content_base64']),
    };
  }
  if ('document' in media) {
    const { content_base64, file_name } = media.document;
    return {
      kind: 'document',
      content: issues.readContent(content_base64, [...path, 'document', 'content_base64']),
      fileName: file_name,
    };
  }
  if ('audio' in media) {
    const { content_base64, file_name, duration, performer, title } = media.audio;
    return {
      kind: 'audio',
      content: issues.readContent(content_base64, [...path, 'audio', 'content_base64']),
      fileName: file_name,
      attributes: { durationSeconds: duration, performer, title },
    };
  }
  const { content_base64, file_name, duration, width, height } = media.video;
  return {
    kind: 'video',
    content: issues.readContent(content_base64, [...path, 'video', 'content_base64']),
    fileName: file_name,
    attributes: { durationSeconds: duration, width, height },
  };
}

function readMediaDraft<Upload extends AccountUpload>(
  upload: Upload,
  { caption, caption_entities }: {
    readonly caption: string;
    readonly caption_entities?: z.output<typeof messageEntityInputListSchema>;
  },
  path: IssuePath,
  issues: AccountInputIssues,
): AccountMediaDraft<Upload> {
  return {
    kind: 'media',
    upload,
    caption,
    captionEntities: issues.readEntities(caption_entities, [...path, 'caption_entities']),
  };
}

/**
 * Reads a poll with its settings and their defaults: revoting is allowed for a regular poll but
 * not for a quiz. Only a quiz has correct options or an explanation, and explanation entities need
 * an explanation.
 */
function readPoll(
  poll: z.output<typeof accountPollInputSchema>,
  path: IssuePath,
  issues: AccountInputIssues,
): SpecifiedAccountPoll {
  const { type, correct_option_ids, explanation, explanation_entities } = poll;
  const questionEntities = issues.readEntities(poll.question_entities, [
    ...path,
    'question_entities',
  ]);
  const options = poll.options.map(({ text, text_entities }, index) => ({
    text,
    entities: issues.readEntities(text_entities, [...path, 'options', index, 'text_entities']),
  }));
  const explanationEntities = issues.readEntities(explanation_entities, [
    ...path,
    'explanation_entities',
  ]);
  if (
    type === 'regular' &&
    (correct_option_ids !== undefined || explanation !== undefined ||
      explanation_entities !== undefined)
  ) {
    issues.refuse(path, 'Only a quiz has correct options or explanation');
  } else if (explanation === undefined && explanation_entities !== undefined) {
    issues.refuse(path, 'Explanation entities need an explanation');
  }
  return {
    question: { text: poll.question, entities: questionEntities },
    options,
    isAnonymous: poll.is_anonymous,
    allowsMultipleAnswers: poll.allows_multiple_answers,
    allowsRevoting: poll.allows_revoting ?? type === 'regular',
    type: type === 'regular' ? { kind: 'regular' } : {
      kind: 'quiz',
      correctOptionPositions: correct_option_ids ?? [],
      explanation: { text: explanation ?? '', entities: explanationEntities },
    },
  };
}

/** Why Telegram refuses a file an account uploads. */
type AccountUploadFailureReason = Extract<
  | ReturnType<MediaFiles['preparePhotoUpload']>
  | ReturnType<MediaFiles['prepareDocumentUpload']>
  | ReturnType<MediaFiles['prepareVideoUpload']>
  | ReturnType<MediaFiles['prepareAudioUpload']>
  | ReturnType<MediaFiles['prepareVoiceUpload']>,
  { readonly prepared: false }
>['reason'];

/** The content of an account's message as its client prepares it, or why Telegram refuses it. */
export type AccountContentPreparation<Content> =
  | { readonly prepared: true; readonly content: Content }
  | { readonly prepared: false; readonly reason: AccountUploadFailureReason };

/** Prepares the content of an account's message, checking an uploaded file as Telegram does. */
export function prepareAccountMessageContent(
  draft: AccountMessageDraft,
  mediaFiles: MediaFiles,
): AccountContentPreparation<AccountMessageContent> {
  return draft.kind === 'media'
    ? prepareAccountMediaContent(draft, mediaFiles)
    : { prepared: true, content: draft };
}

/** Prepares a photo, document, video, or audio file of an account's album as its client does. */
export function prepareAccountAlbumMediaContent(
  draft: AccountMediaDraft<AccountAlbumUpload>,
  mediaFiles: MediaFiles,
): AccountContentPreparation<AccountAlbumMediaContent> {
  const preparation = prepareAlbumUpload(draft.upload, mediaFiles);
  return preparation.prepared
    ? {
      prepared: true,
      content: {
        kind: 'media',
        upload: preparation.upload,
        caption: draft.caption,
        captionEntities: draft.captionEntities,
      },
    }
    : { prepared: false, reason: preparation.reason };
}

/**
 * Prepares media of an account's message as its client does. Unlike other media, a voice note
 * never joins an album.
 */
function prepareAccountMediaContent(
  draft: AccountMediaDraft,
  mediaFiles: MediaFiles,
): AccountContentPreparation<AccountMessageContent> {
  const { upload } = draft;
  if (upload.kind !== 'voice') {
    return prepareAccountAlbumMediaContent({ ...draft, upload }, mediaFiles);
  }
  const preparation = mediaFiles.prepareVoiceUpload({
    content: upload.content,
    durationSeconds: upload.durationSeconds,
    source: 'account_upload',
  });
  return preparation.prepared
    ? {
      prepared: true,
      content: {
        kind: 'media',
        upload: preparation.upload,
        caption: draft.caption,
        captionEntities: draft.captionEntities,
      },
    }
    : { prepared: false, reason: preparation.reason };
}

/** Prepares the file of an account's photo, document, video, or audio file as its client does. */
function prepareAlbumUpload(upload: AccountAlbumUpload, mediaFiles: MediaFiles) {
  switch (upload.kind) {
    case 'photo':
      return mediaFiles.preparePhotoUpload({ content: upload.content, source: 'account_upload' });
    case 'document':
      return mediaFiles.prepareDocumentUpload({
        content: upload.content,
        fileName: upload.fileName,
        source: 'account_upload',
      });
    case 'audio':
      return mediaFiles.prepareAudioUpload({
        content: upload.content,
        ...(upload.fileName === undefined ? {} : { fileName: upload.fileName }),
        attributes: upload.attributes,
        source: 'account_upload',
      });
    case 'video':
      return mediaFiles.prepareVideoUpload({
        content: upload.content,
        ...(upload.fileName === undefined ? {} : { fileName: upload.fileName }),
        attributes: upload.attributes,
        source: 'account_upload',
      });
    default: {
      const unhandledUpload: never = upload;
      throw new Error(`Unhandled account upload: ${JSON.stringify(unhandledUpload)}`);
    }
  }
}
