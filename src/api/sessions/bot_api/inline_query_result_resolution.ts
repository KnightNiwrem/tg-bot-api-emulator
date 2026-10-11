import { cleanInputString, trimTdlibSpaces } from '../../../text_entities/input_string.ts';
import { createWrittenContact, type WrittenContact } from '../../../types/contact.ts';
import type { GeoLocation } from '../../../types/geo_location.ts';
import type { InlineKeyboard } from '../../../types/inline_keyboard.ts';
import type { InlineQueryId, InlineQueryResultsButton } from '../../../types/inline_query.ts';
import type { AudioAttributes, VideoAttributes } from '../../../types/stored_file.ts';
import type { LocationMessageContent } from '../../../types/virtual_message.ts';
import type { EmulationSession } from '../../../session/emulation_session.ts';
import type { SpecifiedFormattedText } from './formatted_text_reading.ts';
import type { BotApiFamilyContext } from './method_call.ts';
import { richMessageUploadsFile } from './specified_rich_message.ts';

type BotMediaResolver = EmulationSession['botMediaResolver'];

/** A rich message as a request specifies it, naming each file it sends. */
type RequestedRichMessage = Parameters<BotMediaResolver['resolveRichMessageFiles']>[1];

/**
 * The file of a media result: one the bot knows by `file_id`, or one it names by URL, which
 * Telegram downloads when an account sends the result.
 */
type InlineResultFileRequest = Parameters<BotMediaResolver['resolveInlineResultFile']>[1];

/** A result as the inline query service lists and sends it, with its files resolved. */
type SpecifiedInlineQueryResult = Parameters<
  EmulationSession['inlineQueries']['answerInlineQuery']
>[0]['results'][number];

type SpecifiedInlineQueryResultOfKind<Kind extends SpecifiedInlineQueryResult['kind']> = Extract<
  SpecifiedInlineQueryResult,
  { readonly kind: Kind }
>;

/** What a result sends, as the inline query service sends it. */
type SpecifiedInlineResultContent = SpecifiedInlineQueryResult['messageContent'];

/** Why the file of a media result cannot be used: its `file_id` names no file of its type. */
type InlineResultFileFailure = Extract<
  ReturnType<BotMediaResolver['resolveInlineResultFile']>,
  { readonly resolved: false }
>['failure'];

/** Why a file the bot knows by `file_id` is not of the type the result sends. */
type FileTypeMismatchFailure = Extract<
  InlineResultFileFailure,
  { readonly reason: 'file_type_mismatch' }
>;

interface InlineQueryResultRequestBase {
  /** The bot's identifier of the result. */
  readonly id: string;
  /** Empty for none. */
  readonly description: string;
  /** The keyboard of the sent message; omitted for none. */
  readonly inlineKeyboard?: InlineKeyboard;
}

/**
 * What a result's `input_message_content` sends: text; a rich message, which reuses its files by
 * the `file_id` the bot knows them by; a contact the bot writes; or a static location.
 */
export type InlineResultMessageContentRequest =
  | { readonly kind: 'text'; readonly text: SpecifiedFormattedText }
  | {
    readonly kind: 'rich_message';
    readonly richMessage: RequestedRichMessage;
    /** Whether Telegram marks the entities it detects in the text. */
    readonly detectsEntities: boolean;
  }
  | { readonly kind: 'contact'; readonly contact: WrittenContact }
  | LocationMessageContent;

/**
 * A result of `answerInlineQuery`, as the Bot API specifies it. A media result sends the content
 * of its `input_message_content`, if it has one, instead of its own file.
 */
export type InlineQueryResultRequest =
  | (InlineQueryResultRequestBase & {
    readonly kind: 'article';
    readonly title: string;
    /** Empty for none. */
    readonly url: string;
    readonly messageContent: InlineResultMessageContentRequest;
  })
  | (Omit<InlineQueryResultRequestBase, 'description'> & {
    readonly kind: 'contact';
    /** Listed by its texts, which TDLib's `get_input_bot_inline_result` trims. */
    readonly contact: WrittenContact;
    readonly messageContent?: InlineResultMessageContentRequest;
  })
  | (Omit<InlineQueryResultRequestBase, 'description'> & {
    readonly kind: 'location';
    readonly title: string;
    /** Also listed by its coordinates, as TDLib's `get_input_bot_inline_result` describes them. */
    readonly location: GeoLocation;
    readonly messageContent?: InlineResultMessageContentRequest;
  })
  | (InlineQueryResultRequestBase & {
    readonly kind: 'photo';
    readonly photo: InlineResultFileRequest;
    /** The URL of the thumbnail the client lists; empty for none. */
    readonly thumbnailUrl: string;
    /** Empty for none. */
    readonly title: string;
    /** Empty text for no caption. */
    readonly caption: SpecifiedFormattedText;
    readonly showsCaptionAboveMedia: boolean;
    readonly messageContent?: InlineResultMessageContentRequest;
  })
  | (InlineQueryResultRequestBase & {
    readonly kind: 'document';
    readonly document: InlineResultFileRequest;
    /** The URL of the thumbnail the client lists; empty for none. */
    readonly thumbnailUrl: string;
    readonly title: string;
    /** Empty text for no caption. */
    readonly caption: SpecifiedFormattedText;
    readonly messageContent?: InlineResultMessageContentRequest;
  })
  | (InlineQueryResultRequestBase & {
    readonly kind: 'video';
    /** A video file, or a web page with an embedded video player, which the bot names by URL. */
    readonly video:
      | InlineResultFileRequest
      | { readonly kind: 'embedded_player'; readonly url: string };
    /** The URL of the thumbnail the client lists; empty for none. */
    readonly thumbnailUrl: string;
    readonly title: string;
    /** Empty text for no caption. */
    readonly caption: SpecifiedFormattedText;
    readonly showsCaptionAboveMedia: boolean;
    /** Kept by a video the bot names by URL; a stored video keeps its own. */
    readonly attributes: VideoAttributes;
    /** Required for an embedded video player, which cannot be sent itself. */
    readonly messageContent?: InlineResultMessageContentRequest;
  })
  | (Omit<InlineQueryResultRequestBase, 'description'> & {
    readonly kind: 'voice';
    readonly voice: InlineResultFileRequest;
    /** Empty for none. */
    readonly title: string;
    /** Empty text for no caption. */
    readonly caption: SpecifiedFormattedText;
    /** Kept by a voice note the bot names by URL; a stored one keeps its own. */
    readonly durationSeconds: number;
    readonly messageContent?: InlineResultMessageContentRequest;
  })
  | (Omit<InlineQueryResultRequestBase, 'description'> & {
    readonly kind: 'audio';
    readonly audio: InlineResultFileRequest;
    /** Empty for none; never empty for an audio file the bot names by URL. */
    readonly title: string;
    /** Empty for none. */
    readonly performer: string;
    /** Empty text for no caption. */
    readonly caption: SpecifiedFormattedText;
    /**
     * Kept by an audio file the bot names by URL, with its title and performer; a stored one keeps
     * its own.
     */
    readonly durationSeconds: number;
    readonly messageContent?: InlineResultMessageContentRequest;
  });

/** An answer to an inline query, as `answerInlineQuery`'s steps read it. */
export interface InlineQueryAnswerRequest {
  readonly inlineQueryId: InlineQueryId;
  readonly results: readonly InlineQueryResultRequest[];
  readonly cacheTimeSeconds: number;
  readonly isPersonal: boolean;
  /** Empty when there are no more results. */
  readonly nextOffset: string;
  /** Omitted when the client shows no button above the results. */
  readonly button?: InlineQueryResultsButton;
}

/**
 * Why TDLib's `get_input_bot_inline_result` refuses a contact result: its phone number or first
 * name, once trimmed, is empty.
 */
type InlineContactResultFailureReason = 'contact_phone_number_empty' | 'contact_first_name_empty';

/** TDLib's refusal of a result's title or description that is not well-formed Unicode. */
interface InlineResultTextInvalidFailure {
  readonly reason: 'text_invalid';
  readonly textError: string;
}

/** Why a result of an inline query's answer cannot be listed or sent. */
export type InlineQueryResultResolutionFailure =
  | {
    readonly reason:
      | 'file_id_invalid'
      | 'inline_message_content_invalid'
      | InlineContactResultFailureReason;
  }
  | FileTypeMismatchFailure
  | InlineResultTextInvalidFailure;

/** What resolving inline query results uses: the resolver of the files bots send. */
type InlineQueryResultResolutionContext = BotApiFamilyContext<'botMediaResolver'>;

type ResultResolution =
  | { readonly resolved: true; readonly result: SpecifiedInlineQueryResult }
  | {
    readonly resolved: false;
    readonly failure: Exclude<InlineQueryResultResolutionFailure, InlineResultTextInvalidFailure>;
  };

/**
 * Resolves the results of an inline query's answer, one at a time, as the inline query service
 * lists and sends them: each result's files, as `resolveInlineQueryResult` resolves them, then its
 * listing, as `cleanInlineResultListing` cleans it. The first result that fails ends the answer.
 *
 * Every result's file is resolved before the service's checks, while TDLib checks the button and
 * the number of results first, and resolves each result's file after its message content and
 * after cleaning its title and description.
 */
export function resolveInlineQueryResults(
  context: InlineQueryResultResolutionContext,
  results: readonly InlineQueryResultRequest[],
):
  | { readonly resolved: true; readonly results: readonly SpecifiedInlineQueryResult[] }
  | { readonly resolved: false; readonly failure: InlineQueryResultResolutionFailure } {
  const specifiedResults: SpecifiedInlineQueryResult[] = [];
  for (const result of results) {
    const resolution = resolveInlineQueryResult(context, result);
    if (!resolution.resolved) {
      return resolution;
    }
    const cleaning = cleanInlineResultListing(resolution.result);
    if (!cleaning.cleaned) {
      return { resolved: false, failure: cleaning.failure };
    }
    specifiedResults.push(cleaning.result);
  }
  return { resolved: true, results: specifiedResults };
}

/**
 * Resolves the files of an inline query result as TDLib's `answer_inline_query` does: its photo,
 * document, video, voice note, or audio file known by `file_id`, and the files of a rich message it
 * sends, which must reuse files by `file_id` because an inline message cannot receive an upload.
 * Media named by URL keeps its URL, as TDLib passes it on, for Telegram to download when the result
 * is sent; an embedded video player is only listed, and sends its `input_message_content`. A
 * contact or location result sends its own contact or location unless its `input_message_content`
 * replaces it.
 */
function resolveInlineQueryResult(
  context: InlineQueryResultResolutionContext,
  result: InlineQueryResultRequest,
): ResultResolution {
  const { botMediaResolver } = context.session;
  const botId = context.bot.id;
  const shared = {
    id: result.id,
    ...(result.inlineKeyboard === undefined ? {} : { inlineKeyboard: result.inlineKeyboard }),
  };
  const contentResolution = result.messageContent === undefined
    ? undefined
    : resolveInlineResultMessageContent(context, result.messageContent);
  if (contentResolution?.resolved === false) {
    return contentResolution;
  }
  const messageContent = contentResolution?.content;
  switch (result.kind) {
    case 'article':
      if (messageContent === undefined) {
        throw new Error('Expected an article result to send its input message content');
      }
      return {
        resolved: true,
        result: {
          ...shared,
          kind: 'article',
          title: result.title,
          description: result.description,
          url: result.url,
          messageContent,
        },
      };
    case 'contact': {
      const listing = listInlineContactResult(result.contact);
      return listing.listed
        ? {
          resolved: true,
          result: {
            ...shared,
            kind: 'contact',
            title: listing.title,
            description: listing.description,
            messageContent: messageContent ??
              { kind: 'contact', contact: createWrittenContact(result.contact) },
          },
        }
        : { resolved: false, failure: { reason: listing.reason } };
    }
    case 'location':
      return {
        resolved: true,
        result: {
          ...shared,
          kind: 'location',
          title: result.title,
          description: describeInlineResultLocation(result.location),
          messageContent: messageContent ?? { kind: 'location', location: result.location },
        },
      };
    case 'photo': {
      const resolution = botMediaResolver.resolveInlineResultFile(botId, result.photo, 'photo');
      return resolution.resolved
        ? {
          resolved: true,
          result: {
            ...shared,
            kind: 'photo',
            description: result.description,
            photo: resolution.file,
            thumbnailUrl: result.thumbnailUrl,
            title: result.title,
            messageContent: messageContent ?? toInlineResultPhotoContent(resolution.file, result),
          },
        }
        : resolution;
    }
    case 'document': {
      const resolution = botMediaResolver.resolveInlineResultFile(
        botId,
        result.document,
        'document',
      );
      return resolution.resolved
        ? {
          resolved: true,
          result: {
            ...shared,
            kind: 'document',
            description: result.description,
            document: resolution.file,
            thumbnailUrl: result.thumbnailUrl,
            title: result.title,
            messageContent: messageContent ??
              toInlineResultDocumentContent(resolution.file, result),
          },
        }
        : resolution;
    }
    case 'video': {
      const listing = {
        ...shared,
        kind: 'video' as const,
        description: result.description,
        title: result.title,
        thumbnailUrl: result.thumbnailUrl,
      };
      const { video } = result;
      if (video.kind !== 'embedded_player') {
        const resolution = botMediaResolver.resolveInlineResultFile(botId, video, 'video');
        return resolution.resolved
          ? {
            resolved: true,
            result: {
              ...listing,
              video: resolution.file,
              messageContent: messageContent ?? toInlineResultVideoContent(resolution.file, result),
            },
          }
          : resolution;
      }
      if (messageContent === undefined) {
        throw new Error('Expected an embedded video player to send its input message content');
      }
      return {
        resolved: true,
        result: {
          ...listing,
          video: { source: 'embedded_player', url: video.url },
          messageContent,
        },
      };
    }
    case 'voice': {
      const resolution = botMediaResolver.resolveInlineResultFile(botId, result.voice, 'voice');
      return resolution.resolved
        ? {
          resolved: true,
          result: {
            ...shared,
            kind: 'voice',
            voice: resolution.file,
            title: result.title,
            messageContent: messageContent ?? toInlineResultVoiceContent(resolution.file, result),
          },
        }
        : resolution;
    }
    case 'audio': {
      const resolution = botMediaResolver.resolveInlineResultFile(botId, result.audio, 'audio');
      return resolution.resolved
        ? {
          resolved: true,
          result: {
            ...shared,
            kind: 'audio',
            audio: resolution.file,
            title: result.title,
            description: result.performer,
            messageContent: messageContent ?? toInlineResultAudioContent(resolution.file, result),
          },
        }
        : resolution;
    }
    default: {
      const unhandledResult: never = result;
      throw new Error(`Unhandled inline query result: ${JSON.stringify(unhandledResult)}`);
    }
  }
}

/**
 * Resolves what a result's `input_message_content` sends: its text, a contact, a location, or a
 * rich message, whose files must be reused by `file_id`, as TDLib's `get_input_rich_message`
 * requires of an inline message.
 */
function resolveInlineResultMessageContent(
  context: InlineQueryResultResolutionContext,
  content: InlineResultMessageContentRequest,
):
  | {
    readonly resolved: true;
    readonly content: Exclude<
      SpecifiedInlineResultContent,
      { readonly kind: `web_${string}` }
    >;
  }
  | {
    readonly resolved: false;
    readonly failure:
      | { readonly reason: 'file_id_invalid' | 'inline_message_content_invalid' }
      | FileTypeMismatchFailure;
  } {
  if (content.kind === 'text') {
    return {
      resolved: true,
      content: { kind: 'text', text: content.text.text, entities: content.text.entities },
    };
  }
  if (content.kind === 'contact') {
    return {
      resolved: true,
      content: { kind: 'contact', contact: createWrittenContact(content.contact) },
    };
  }
  if (content.kind === 'location') {
    return { resolved: true, content };
  }
  if (richMessageUploadsFile(content.richMessage)) {
    return { resolved: false, failure: { reason: 'inline_message_content_invalid' } };
  }
  const resolution = context.session.botMediaResolver.resolveRichMessageFiles(
    context.bot.id,
    content.richMessage,
  );
  if (resolution.resolved) {
    return {
      resolved: true,
      content: {
        kind: 'rich_message',
        richMessage: resolution.richMessage,
        detectsEntities: content.detectsEntities,
      },
    };
  }
  const { failure } = resolution;
  switch (failure.reason) {
    case 'file_id_invalid':
      return { resolved: false, failure: { reason: failure.reason } };
    case 'file_type_mismatch':
      return { resolved: false, failure };
    default:
      throw new Error(`Expected only reused files, which failed with ${failure.reason}`);
  }
}

/** TDLib's error for a result's title or description that is not well-formed Unicode. */
const INLINE_RESULT_TEXT_ENCODING_INVALID_ERROR = 'Strings must be encoded in UTF-8';

/**
 * Cleans the title and description a result lists as TDLib's `get_input_bot_inline_result` does
 * once it has derived them, such as a contact's names: with `clean_input_string`, which refuses
 * text that is not well-formed Unicode. TDLib would pass on a contact whose phone number or title
 * cleaning empties; as for `sendContact`, the emulator refuses it instead, with the errors TDLib
 * gives for an empty trimmed phone number or first name, since Telegram's outcome is not public.
 */
function cleanInlineResultListing(
  result: SpecifiedInlineQueryResult,
):
  | { readonly cleaned: true; readonly result: SpecifiedInlineQueryResult }
  | {
    readonly cleaned: false;
    readonly failure:
      | InlineResultTextInvalidFailure
      | { readonly reason: InlineContactResultFailureReason };
  } {
  const encodingFailure = {
    cleaned: false,
    failure: { reason: 'text_invalid', textError: INLINE_RESULT_TEXT_ENCODING_INVALID_ERROR },
  } as const;
  const title = cleanInputString(result.title);
  if (result.kind === 'voice') {
    return title === undefined ? encodingFailure : { cleaned: true, result: { ...result, title } };
  }
  const description = cleanInputString(result.description);
  if (title === undefined || description === undefined) {
    return encodingFailure;
  }
  if (result.kind === 'contact' && description.length === 0) {
    return { cleaned: false, failure: { reason: 'contact_phone_number_empty' } };
  }
  if (result.kind === 'contact' && title.length === 0) {
    return { cleaned: false, failure: { reason: 'contact_first_name_empty' } };
  }
  if (result.kind === 'audio' && result.messageContent.kind === 'web_audio') {
    // An audio file named by URL takes the cleaned title and performer as its metadata.
    const { messageContent } = result;
    return {
      cleaned: true,
      result: {
        ...result,
        title,
        description,
        messageContent: {
          ...messageContent,
          attributes: toInlineResultAudioAttributes(
            messageContent.attributes.durationSeconds,
            title,
            description,
          ),
        },
      },
    };
  }
  return { cleaned: true, result: { ...result, title, description } };
}

/** The decimal places of the coordinates TDLib writes into a location result's description. */
const INLINE_RESULT_LOCATION_DECIMAL_PLACES = 6;

/**
 * Lists a contact result as TDLib's `get_input_bot_inline_result` does: by its trimmed first name,
 * followed by its trimmed last name after a space, and its trimmed phone number. TDLib refuses a
 * contact whose trimmed phone number or first name is empty.
 */
function listInlineContactResult(
  contact: WrittenContact,
):
  | { readonly listed: true; readonly title: string; readonly description: string }
  | { readonly listed: false; readonly reason: InlineContactResultFailureReason } {
  const phoneNumber = trimTdlibSpaces(contact.phoneNumber);
  if (phoneNumber.length === 0) {
    return { listed: false, reason: 'contact_phone_number_empty' };
  }
  const firstName = trimTdlibSpaces(contact.firstName);
  if (firstName.length === 0) {
    return { listed: false, reason: 'contact_first_name_empty' };
  }
  const lastName = trimTdlibSpaces(contact.lastName);
  return {
    listed: true,
    title: lastName.length === 0 ? firstName : `${firstName} ${lastName}`,
    description: phoneNumber,
  };
}

/**
 * Describes a location result as TDLib's `get_input_bot_inline_result` does: its latitude and
 * longitude, in fixed notation with six decimal places, separated by a space.
 */
function describeInlineResultLocation({ latitude, longitude }: GeoLocation): string {
  return `${latitude.toFixed(INLINE_RESULT_LOCATION_DECIMAL_PLACES)} ${
    longitude.toFixed(INLINE_RESULT_LOCATION_DECIMAL_PLACES)
  }`;
}

/** The caption a media result specified, as new content takes it. */
function toSpecifiedCaption({ caption }: { readonly caption: SpecifiedFormattedText }) {
  return { caption: caption.text, captionEntities: caption.entities };
}

/**
 * What a photo result sends without `input_message_content`: its photo, a stored one or one
 * named by URL, with its caption; inline results cover no photo with a spoiler.
 */
function toInlineResultPhotoContent(
  photo: SpecifiedInlineQueryResultOfKind<'photo'>['photo'],
  result: Extract<InlineQueryResultRequest, { readonly kind: 'photo' }>,
): SpecifiedInlineResultContent {
  const presentation = {
    ...toSpecifiedCaption(result),
    showsCaptionAboveMedia: result.showsCaptionAboveMedia,
  };
  return photo.source === 'web' ? { kind: 'web_photo', url: photo.url, ...presentation } : {
    kind: 'photo',
    photo: { kind: 'stored', file: photo.file },
    ...presentation,
    hasSpoiler: false,
  };
}

/**
 * What a document result sends without `input_message_content`: its document, a stored one or
 * one named by URL, with its caption.
 */
function toInlineResultDocumentContent(
  document: SpecifiedInlineQueryResultOfKind<'document'>['document'],
  result: Extract<InlineQueryResultRequest, { readonly kind: 'document' }>,
): SpecifiedInlineResultContent {
  return document.source === 'web'
    ? { kind: 'web_document', url: document.url, ...toSpecifiedCaption(result) }
    : {
      kind: 'document',
      document: { kind: 'stored', file: document.file },
      ...toSpecifiedCaption(result),
    };
}

/**
 * What a video result sends without `input_message_content`: its video with its caption, played
 * from its beginning and covered by no spoiler. A video named by URL takes the attributes the bot
 * specified; a stored one keeps its own.
 */
function toInlineResultVideoContent(
  video: Exclude<
    SpecifiedInlineQueryResultOfKind<'video'>['video'],
    { readonly source: 'embedded_player' }
  >,
  result: Extract<InlineQueryResultRequest, { readonly kind: 'video' }>,
): SpecifiedInlineResultContent {
  const presentation = {
    ...toSpecifiedCaption(result),
    showsCaptionAboveMedia: result.showsCaptionAboveMedia,
  };
  return video.source === 'web'
    ? { kind: 'web_video', url: video.url, ...presentation, attributes: result.attributes }
    : {
      kind: 'video',
      video: { kind: 'stored', file: video.file },
      ...presentation,
      hasSpoiler: false,
      startTimestampSeconds: 0,
    };
}

/**
 * What a voice result sends without `input_message_content`: its voice note with its caption. A
 * voice note named by URL takes the duration the bot specified; a stored one keeps its own.
 */
function toInlineResultVoiceContent(
  voice: SpecifiedInlineQueryResultOfKind<'voice'>['voice'],
  result: Extract<InlineQueryResultRequest, { readonly kind: 'voice' }>,
): SpecifiedInlineResultContent {
  return voice.source === 'web'
    ? {
      kind: 'web_voice',
      url: voice.url,
      ...toSpecifiedCaption(result),
      durationSeconds: result.durationSeconds,
    }
    : { kind: 'voice', voice: { kind: 'stored', file: voice.file }, ...toSpecifiedCaption(result) };
}

/**
 * What an audio result sends without `input_message_content`: its audio file with its caption. An
 * audio file named by URL takes the duration, title and performer the result specified, as TDLib
 * gives its web document their attributes; a stored one keeps its own, which the result's title
 * and performer only list.
 */
function toInlineResultAudioContent(
  audio: SpecifiedInlineQueryResultOfKind<'audio'>['audio'],
  result: Extract<InlineQueryResultRequest, { readonly kind: 'audio' }>,
): SpecifiedInlineResultContent {
  return audio.source === 'web'
    ? {
      kind: 'web_audio',
      url: audio.url,
      ...toSpecifiedCaption(result),
      attributes: toInlineResultAudioAttributes(
        result.durationSeconds,
        result.title,
        result.performer,
      ),
    }
    : { kind: 'audio', audio: { kind: 'stored', file: audio.file }, ...toSpecifiedCaption(result) };
}

/** The metadata an audio result gives the audio file it names by URL; empty text is none. */
function toInlineResultAudioAttributes(
  durationSeconds: number,
  title: string,
  performer: string,
): AudioAttributes {
  return {
    durationSeconds,
    ...(performer.length === 0 ? {} : { performer }),
    ...(title.length === 0 ? {} : { title }),
  };
}
