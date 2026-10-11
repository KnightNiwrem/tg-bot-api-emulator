/**
 * Wire facts of the media, contacts and locations messages show, as the Bot API shows them:
 * photos, documents, videos, voice notes, audio files, phone contacts, and points on Earth. Each type is declared beside
 * its schema; the schemas of the messages that hold them are annotated by the message types.
 */
import { z } from 'zod';

import type { ReadonlySnapshot } from './readonly_snapshot.ts';
import type { sharedLocationSchema } from './wire_fields.ts';

/** A point on Earth, as Telegram shows it. */
export type Location = ReadonlySnapshot<z.output<typeof sharedLocationSchema>>;

/** A file of a message: a photo size, a document, a video, a voice note, or an audio file. */
interface MessageFile {
  /**
   * The identifier by which the message's observer knows the file. As on Telegram, each user
   * knows a file by a `file_id` of its own.
   */
  readonly file_id: string;
  /** The same for every user; `downloadFile` reads the file by it. */
  readonly file_unique_id: string;
  readonly file_size: number;
}

/** A photo in one size. The emulator keeps a photo in the one size it was sent in. */
export interface PhotoSize extends MessageFile {
  readonly width: number;
  readonly height: number;
}

export interface Document extends MessageFile {
  readonly file_name: string;
  readonly mime_type: string;
  /** The preview image the sender uploaded with the document; omitted for none. */
  readonly thumbnail?: PhotoSize;
  /** Legacy copy of `thumbnail`, which the Bot API still shows. */
  readonly thumb?: PhotoSize;
}

/** A video, whose duration and dimensions are those its sender defined. */
export interface Video extends MessageFile {
  /** In seconds. */
  readonly duration: number;
  readonly width: number;
  readonly height: number;
  /** Omitted for a video sent without a file name. */
  readonly file_name?: string;
  readonly mime_type: string;
  /** The second from which clients play the video in its message; omitted for its beginning. */
  readonly start_timestamp?: number;
  /** The preview image the sender uploaded with the video; omitted for none. */
  readonly thumbnail?: PhotoSize;
  /** Legacy copy of `thumbnail`, which the Bot API still shows. */
  readonly thumb?: PhotoSize;
}

/** A phone contact, as its sender wrote it. */
export interface Contact {
  readonly phone_number: string;
  readonly first_name: string;
  /** Omitted for a contact without a last name. */
  readonly last_name?: string;
  /** Omitted for a contact without a vCard. */
  readonly vcard?: string;
  /** The contact's Telegram user, known only when an account shares its own contact. */
  readonly user_id?: number;
}

/** A voice note, whose duration is the one its sender defined. */
export interface Voice extends MessageFile {
  /** In seconds. */
  readonly duration: number;
  /** `audio/ogg`, `audio/mpeg`, or `audio/mp4`. */
  readonly mime_type: string;
}

/**
 * An audio file, such as a music track, whose duration, performer and title are those its sender
 * defined.
 */
export interface Audio extends MessageFile {
  /** In seconds. */
  readonly duration: number;
  /** Omitted for an audio file sent without a file name. */
  readonly file_name?: string;
  /** Always an `audio/` type. */
  readonly mime_type: string;
  /** Omitted for an audio file without a title. */
  readonly title?: string;
  /** Omitted for an audio file without a performer. */
  readonly performer?: string;
  /**
   * The preview image the sender uploaded with the audio file, such as its album's cover; omitted
   * for none.
   */
  readonly thumbnail?: PhotoSize;
  /** Legacy copy of `thumbnail`, which the Bot API still shows. */
  readonly thumb?: PhotoSize;
}

const messageFileShape = {
  file_id: z.string().min(1),
  file_unique_id: z.string().min(1),
  file_size: z.int().positive(),
};

export const photoSizeSchema = z.strictObject({
  ...messageFileShape,
  width: z.int().positive(),
  height: z.int().positive(),
});

export const documentSchema = z.strictObject({
  file_name: z.string().min(1),
  mime_type: z.string().min(1),
  thumbnail: photoSizeSchema.optional(),
  thumb: photoSizeSchema.optional(),
  ...messageFileShape,
});

export const videoSchema = z.strictObject({
  duration: z.int().nonnegative(),
  width: z.int().nonnegative(),
  height: z.int().nonnegative(),
  file_name: z.string().min(1).optional(),
  mime_type: z.string().regex(/^video\//),
  start_timestamp: z.int().positive().optional(),
  thumbnail: photoSizeSchema.optional(),
  thumb: photoSizeSchema.optional(),
  ...messageFileShape,
});

export const voiceSchema = z.strictObject({
  duration: z.int().nonnegative(),
  mime_type: z.enum(['audio/ogg', 'audio/mpeg', 'audio/mp4']),
  ...messageFileShape,
});

export const audioSchema = z.strictObject({
  duration: z.int().nonnegative(),
  file_name: z.string().min(1).optional(),
  mime_type: z.string().regex(/^audio\//),
  title: z.string().min(1).optional(),
  performer: z.string().min(1).optional(),
  thumbnail: photoSizeSchema.optional(),
  thumb: photoSizeSchema.optional(),
  ...messageFileShape,
});

export const contactSchema = z.strictObject({
  phone_number: z.string().min(1),
  first_name: z.string().min(1),
  last_name: z.string().min(1).optional(),
  vcard: z.string().min(1).optional(),
  user_id: z.int().positive().optional(),
});
