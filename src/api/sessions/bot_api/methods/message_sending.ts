import { z } from 'zod';

import {
  createGeoLocation,
  type GeoLocation,
  isPointOnEarth,
  MAX_HORIZONTAL_ACCURACY_METERS,
} from '../../../../types/geo_location.ts';
import {
  MAX_MEDIA_DURATION_SECONDS,
  MAX_VIDEO_SIDE_LENGTH,
} from '../../../../types/stored_file.ts';
import type { ChatAction } from '../../../../types/virtual_chat.ts';
import { requireSpecifiedChatId } from '../chat_access.ts';
import { contactNameSchema, contactVcardSchema } from '../contact_parameter.ts';
import { BOT_API_ERRORS } from '../errors/error_catalogue.ts';
import { presentBotApiError, presentFixedBotApiError } from '../errors/error_template.ts';
import { presentMessageSendingFailure } from '../errors/message_sending_failure_presenter.ts';
import {
  captionParametersShape,
  linkPreviewParametersShape,
  readEmbeddedFormattedText,
  readFormattedTextParameters,
  readSpecifiedCaption,
  readSpecifiedFormattedText,
  type SpecifiedFormattedText,
} from '../formatted_text_reading.ts';
import {
  type BotApiInputFile,
  readInputFileParameter,
  readThumbnailParameter,
  type RequestedInputFile,
} from '../input_file_parameter.ts';
import {
  getRequestedMediaFile,
  INPUT_MEDIA_ERROR_PREFIX,
  readInputMediaGroupParameter,
  toMediaReplacementRequest,
  type UnreadMediaReplacement,
} from '../input_media_parameter.ts';
import {
  describeInputPollOptionTextError,
  readInputPollOptionsParameter,
} from '../input_poll_option_parameter.ts';
import { messageEntitiesParameter } from '../message_entities_parameter.ts';
import {
  type MediaReplacementRequest,
  type MessageSendContext,
  type PollTypeRequest,
  sendChatAction,
  sendContact,
  sendLocation,
  sendMedia,
  sendMediaGroup,
  type SendMediaGroupResult,
  sendMessage,
  sendMessageDraft,
  sendPoll,
  sendRichMessage,
  sendVoice,
} from '../message_sends.ts';
import {
  type BotApiMethod,
  type BotApiMethodAnswer,
  type BotApiMethodContext,
  botApiResult,
  SESSION_ENDED,
} from '../method_call.ts';
import {
  answerWith,
  answerWithBadRequest,
  type BotApiStepCall,
  type BotApiStepResult,
  type BotApiSteps,
  commandMethodOfSteps,
  proceedWith,
  startSteps,
  waitingCommandMethodOfSteps,
} from '../method_steps.ts';
import { readCorrectOptionIdsParameter } from '../quiz_parameters.ts';
import {
  booleanParameter,
  clampedIntegerParameter,
  integerParameter,
  numberParameter,
  optionalInt64Identifier,
} from '../request_parameters.ts';
import { LOCATION_INVALID_DESCRIPTION } from '../rich_message_parameter.ts';
import { sendMethodAnswer } from '../send_answer.ts';
import {
  readSendOptions,
  replyMarkupParametersShape,
  type SendOptionsParameters,
  sendOptionsParametersShape,
  type SendRequestOptions,
} from '../send_options.ts';
import {
  readSpecifiedRichMessage,
  resolveSpecifiedRichMessage,
  type SpecifiedRichMessage,
} from '../specified_rich_message.ts';
import { resolveRequestedInputFile, toWaitResult } from '../web_file_parameter.ts';

/** Chat actions by the lowercase names Telegram reads, including its older aliases. */
const CHAT_ACTIONS_BY_NAME: ReadonlyMap<string, ChatAction> = new Map([
  ['cancel', 'cancel'],
  ['typing', 'typing'],
  ['record_video', 'record_video'],
  ['upload_video', 'upload_video'],
  ['record_voice', 'record_voice'],
  ['record_audio', 'record_voice'],
  ['upload_voice', 'upload_voice'],
  ['upload_audio', 'upload_voice'],
  ['upload_photo', 'upload_photo'],
  ['upload_document', 'upload_document'],
  ['choose_sticker', 'choose_sticker'],
  ['find_location', 'find_location'],
  ['pick_up_location', 'find_location'],
  ['record_video_note', 'record_video_note'],
  ['upload_video_note', 'upload_video_note'],
]);

// Telegram treats a missing parameter as empty text.
const sendMessageParametersSchema = z.strictObject({
  ...sendOptionsParametersShape,
  ...replyMarkupParametersShape,
  text: z.string().default(''),
  parse_mode: z.string().optional(),
  entities: messageEntitiesParameter().optional(),
  ...linkPreviewParametersShape,
});

// As for sendMessage, topics, business connections, paid broadcasts, suggested posts, and
// ephemeral messages are not supported.
const sendRichMessageParametersSchema = z.strictObject({
  ...sendOptionsParametersShape,
  ...replyMarkupParametersShape,
  rich_message: z.string().optional(),
});

// As for sendMessage, topics, business connections, paid broadcasts, and suggested posts are not
// supported; nor are options added after creation, restrictions on who may vote, shuffled options,
// hidden results, descriptions, and media.
const sendPollParametersSchema = z.strictObject({
  ...sendOptionsParametersShape,
  ...replyMarkupParametersShape,
  question: z.string().default(''),
  question_parse_mode: z.string().optional(),
  question_entities: messageEntitiesParameter().optional(),
  options: z.string().optional(),
  is_anonymous: booleanParameter().default(true),
  type: z.string().default(''),
  allows_multiple_answers: booleanParameter().default(false),
  allows_revoting: booleanParameter().optional(),
  correct_option_ids: z.string().optional(),
  correct_option_id: integerParameter(z.int()).optional(),
  explanation: z.string().optional(),
  explanation_parse_mode: z.string().optional(),
  explanation_entities: messageEntitiesParameter().optional(),
  open_period: integerParameter(z.int()).optional(),
  close_date: integerParameter(z.int()).optional(),
  is_closed: booleanParameter().default(false),
});

// As for sendMessage, topics, business connections, paid broadcasts, suggested posts, and
// ephemeral messages are not supported.
const sendContactParametersSchema = z.strictObject({
  ...sendOptionsParametersShape,
  ...replyMarkupParametersShape,
  phone_number: z.string().default(''),
  first_name: contactNameSchema.default(''),
  last_name: contactNameSchema.default(''),
  vcard: contactVcardSchema,
});

/**
 * A decimal number parameter, which the official server trims and reads as `undefined` when empty
 * or missing.
 */
const optionalTrimmedNumberParameter = () =>
  z.string().trim().pipe(z.union([
    z.literal('').transform(() => undefined),
    numberParameter(),
  ])).optional();

// As for sendMessage, topics, business connections, paid broadcasts, suggested posts, and
// ephemeral messages are not supported. Live locations are not supported either: `live_period`,
// `heading` and `proximity_alert_radius` are rejected, even with values that send a static
// location on Telegram, as is an accuracy outside the 0–1500 meters the Bot API documents, which
// Telegram clamps.
const sendLocationParametersSchema = z.strictObject({
  ...sendOptionsParametersShape,
  ...replyMarkupParametersShape,
  latitude: optionalTrimmedNumberParameter(),
  longitude: optionalTrimmedNumberParameter(),
  horizontal_accuracy: optionalTrimmedNumberParameter().refine((accuracy) =>
    accuracy === undefined || (accuracy >= 0 && accuracy <= MAX_HORIZONTAL_ACCURACY_METERS)
  ),
});

const sendPhotoParametersSchema = z.strictObject({
  ...sendOptionsParametersShape,
  ...replyMarkupParametersShape,
  photo: z.string().optional(),
  ...captionParametersShape,
  show_caption_above_media: booleanParameter().default(false),
  has_spoiler: booleanParameter().default(false),
});

// The emulator never detects other media types in documents, so `disable_content_type_detection`
// is validated and ignored.
const sendDocumentParametersSchema = z.strictObject({
  ...sendOptionsParametersShape,
  ...replyMarkupParametersShape,
  document: z.string().optional(),
  thumbnail: z.string().optional(),
  thumb: z.string().optional(),
  ...captionParametersShape,
  disable_content_type_detection: booleanParameter().optional(),
});

// The emulator never inspects or transcodes a video, so `supports_streaming`, which TDLib passes to
// Telegram's servers but the Bot API never shows, is validated and ignored. A cover is not
// supported.
const sendVideoParametersSchema = z.strictObject({
  ...sendOptionsParametersShape,
  ...replyMarkupParametersShape,
  video: z.string().optional(),
  duration: clampedIntegerParameter(0, MAX_MEDIA_DURATION_SECONDS).default(0),
  width: clampedIntegerParameter(0, MAX_VIDEO_SIDE_LENGTH).default(0),
  height: clampedIntegerParameter(0, MAX_VIDEO_SIDE_LENGTH).default(0),
  thumbnail: z.string().optional(),
  thumb: z.string().optional(),
  start_timestamp: clampedIntegerParameter(0, MAX_MEDIA_DURATION_SECONDS).default(0),
  ...captionParametersShape,
  show_caption_above_media: booleanParameter().default(false),
  has_spoiler: booleanParameter().default(false),
  supports_streaming: booleanParameter().optional(),
});

const sendVoiceParametersSchema = z.strictObject({
  ...sendOptionsParametersShape,
  ...replyMarkupParametersShape,
  voice: z.string().optional(),
  ...captionParametersShape,
  duration: clampedIntegerParameter(0, MAX_MEDIA_DURATION_SECONDS).default(0),
});

// As for sendVoice, the emulator inspects no audio content, so it reads no tags; the duration,
// performer and title are the bot's, as the official server's `process_send_audio_query` reads
// them.
const sendAudioParametersSchema = z.strictObject({
  ...sendOptionsParametersShape,
  ...replyMarkupParametersShape,
  audio: z.string().optional(),
  ...captionParametersShape,
  duration: clampedIntegerParameter(0, MAX_MEDIA_DURATION_SECONDS).default(0),
  performer: z.string().default(''),
  title: z.string().default(''),
  thumbnail: z.string().optional(),
  thumb: z.string().optional(),
});

// As for sendMessage, topics, business connections, paid broadcasts, and suggested posts are not
// supported. The official server reads no reply markup for albums, so the emulator rejects one.
const sendMediaGroupParametersSchema = z.strictObject({
  ...sendOptionsParametersShape,
  media: z.string().optional(),
});

// Topics are not supported.
const sendMessageDraftParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
  draft_id: optionalInt64Identifier().optional(),
  text: z.string().default(''),
  parse_mode: z.string().optional(),
  entities: messageEntitiesParameter().optional(),
  can_stop: booleanParameter().default(false),
  keep_on_stop: booleanParameter().default(false),
});

// Topics and business connections are not supported.
const sendChatActionParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
  action: z.string().default(''),
});

type SendPollParameters = z.output<typeof sendPollParametersSchema>;

/** The files that send methods send from a parameter of their own name. */
type SentFileKind = 'photo' | 'document' | 'video' | 'voice' | 'audio';

/** The parameters of a method that sends a file of `FileKind` with a caption. */
type MediaSendParameters<FileKind extends SentFileKind> =
  & SendOptionsParameters
  & { readonly [Kind in FileKind]?: string }
  & {
    readonly caption: string;
    readonly parse_mode?: string;
    readonly caption_entities?: readonly unknown[];
  };

/** A message with a file as its steps read it, before the file is downloaded if named by URL. */
interface MediaSendReading<Parameters> {
  readonly parameters: Parameters;
  readonly requestedFile: RequestedInputFile;
  readonly caption: SpecifiedFormattedText;
  readonly options: SendRequestOptions;
}

/**
 * The methods that send a new message, or show a chat action or a draft before one, each executed
 * as a command in its call's transaction. Their steps read the parameters, including the send
 * options, whose reply to another chat is read from the session; a method that sends a file named
 * by URL then waits for its download. Execution reaches the chat and makes every other check
 * before it sends.
 */
export const MESSAGE_SENDING_METHODS: readonly BotApiMethod[] = [
  waitingCommandMethodOfSteps({
    name: 'sendAudio',
    recordsActivity: true,
    parameters: sendAudioParametersSchema,
    steps: (call) => readMediaSend(call, 'audio').andThen((send) => readThumbnail(call, send)),
    waitFor: (context, send) => waitForMediaFile(context, send, 'audio'),
    execute: (context: MessageSendContext, { parameters, file, thumbnail, caption, options }) =>
      sendMethodAnswer(sendMedia(context, {
        media: {
          kind: 'audio',
          audio: file,
          attributes: {
            durationSeconds: parameters.duration,
            performer: parameters.performer,
            title: parameters.title,
          },
          ...(thumbnail === undefined ? {} : { thumbnail }),
          caption,
        },
        options,
      })),
  }),
  // Telegram reads the action before it looks at the chat.
  commandMethodOfSteps({
    name: 'sendChatAction',
    recordsActivity: true,
    parameters: sendChatActionParametersSchema,
    steps: ({ parameters }) =>
      startSteps(parameters).andThen(readChatAction).andThen(requireSpecifiedChatId),
    execute: (context: MessageSendContext, { chat_id: chatId, chatAction }) => {
      const result = sendChatAction(context, { chatId, action: chatAction });
      return result.sent ? botApiResult(true) : presentMessageSendingFailure('chat_action', result);
    },
  }),
  // As the official server's `process_send_contact_query` reads it, before the chat: a phone
  // number and a first name, each required, and an optional last name and vCard. As that method
  // does, a bot names no Telegram user for the contact.
  commandMethodOfSteps({
    name: 'sendContact',
    recordsActivity: true,
    parameters: sendContactParametersSchema,
    steps: (call) =>
      startSteps(call.parameters)
        .andThen((parameters) => requireTextParameter(parameters, 'phone_number'))
        .andThen((parameters) => requireTextParameter(parameters, 'first_name'))
        .andThen((parameters) => readSendOptions(call, { parameters })),
    execute: (context: MessageSendContext, { parameters, options }) =>
      sendMethodAnswer(sendContact(context, {
        ...options,
        contact: {
          phoneNumber: parameters.phone_number,
          firstName: parameters.first_name,
          lastName: parameters.last_name,
          vcard: parameters.vcard,
        },
      })),
  }),
  waitingCommandMethodOfSteps({
    name: 'sendDocument',
    recordsActivity: true,
    parameters: sendDocumentParametersSchema,
    steps: (call) => readMediaSend(call, 'document').andThen((send) => readThumbnail(call, send)),
    waitFor: (context, send) => waitForMediaFile(context, send, 'document'),
    execute: (context: MessageSendContext, { file, thumbnail, caption, options }) =>
      sendMethodAnswer(sendMedia(context, {
        media: {
          kind: 'document',
          document: file,
          ...(thumbnail === undefined ? {} : { thumbnail }),
          caption,
        },
        options,
      })),
  }),
  // As the official server's `process_send_location_query` reads it: the latitude and longitude,
  // each required, and an optional accuracy, which TDLib's `get_input_geo_point` sends as whole
  // meters, rounded up. As TDLib's `Location::init` decides, coordinates that name no point on
  // Earth are refused. The emulator checks them once it has read `chat_id` and the reply markup,
  // but before it looks the chat up, while TDLib checks them once the chat is found.
  commandMethodOfSteps({
    name: 'sendLocation',
    recordsActivity: true,
    parameters: sendLocationParametersSchema,
    steps: (call) =>
      startSteps(call.parameters)
        .andThen(requireCoordinates)
        .andThen((parameters) => readSendOptions(call, { parameters }))
        .andThen(readSentLocation),
    execute: (context: MessageSendContext, { location, options }) =>
      sendMethodAnswer(sendLocation(context, { ...options, location })),
  }),
  // As the official server reads them, the media and their captions are read before the chat; the
  // files the media name by URL are then downloaded in order, as for `sendPhoto`.
  waitingCommandMethodOfSteps({
    name: 'sendMediaGroup',
    recordsActivity: true,
    parameters: sendMediaGroupParametersSchema,
    steps: (call) =>
      startSteps(call.parameters)
        .andThen((parameters) => readAlbumMedia(call, parameters))
        .andThen((album) => readSendOptions(call, album)),
    waitFor: waitForAlbumFiles,
    execute: (context: MessageSendContext, { media, options }) => {
      const { chatId, replyTo, isContentProtected, isSilent, messageEffectId } = options;
      return sendMediaGroupAnswer(sendMediaGroup(context, {
        chatId,
        replyTo,
        isContentProtected,
        isSilent,
        messageEffectId,
        media,
      }));
    },
  }),
  // Telegram reads the text and its formatting before it looks at the chat.
  commandMethodOfSteps({
    name: 'sendMessage',
    recordsActivity: true,
    parameters: sendMessageParametersSchema,
    steps: (call) =>
      startSteps(call.parameters)
        .andThen((parameters) => readMessageText(call, parameters))
        .andThen((send) => readSendOptions(call, send)),
    execute: (context: MessageSendContext, { text, options }) =>
      sendMethodAnswer(sendMessage(context, { ...options, ...text })),
  }),
  // As the official server's `process_send_message_draft_query` reads it: the text and its
  // formatting before the chat, and a missing or zero `draft_id` as none, which Telegram's servers
  // refuse. Empty text is allowed.
  commandMethodOfSteps({
    name: 'sendMessageDraft',
    recordsActivity: true,
    parameters: sendMessageDraftParametersSchema,
    steps: (call) =>
      startSteps(call.parameters)
        .andThen((parameters) => readDraftText(call, parameters))
        .andThen(requireSpecifiedChatId),
    execute: (context: MessageSendContext, parameters) => {
      const result = sendMessageDraft(context, {
        chatId: parameters.chat_id,
        draftId: parameters.draft_id,
        text: parameters.text,
        canStop: parameters.can_stop,
        keepOnStop: parameters.keep_on_stop,
      });
      return result.sent
        ? botApiResult(true)
        : presentMessageSendingFailure('message_draft', result);
    },
  }),
  waitingCommandMethodOfSteps({
    name: 'sendPhoto',
    recordsActivity: true,
    parameters: sendPhotoParametersSchema,
    steps: (call) => readMediaSend(call, 'photo'),
    waitFor: (context, send) => waitForMediaFile(context, send, 'photo'),
    execute: (context: MessageSendContext, { parameters, file, caption, options }) =>
      sendMethodAnswer(sendMedia(context, {
        media: {
          kind: 'photo',
          photo: file,
          caption,
          hasSpoiler: parameters.has_spoiler,
          showsCaptionAboveMedia: parameters.show_caption_above_media,
        },
        options,
      })),
  }),
  // As the official server's `process_send_poll_query` reads it, before the chat: the question and
  // the options, each with its formatting, then the poll's type with a quiz's explanation and
  // correct options, then its closing time. `allows_revoting` defaults to true for a regular poll
  // and to false for a quiz. Quiz parameters of a regular poll, which the server ignores, and both
  // `open_period` and `close_date`, of which the server ignores `close_date`, are rejected to
  // surface the bot's mistake.
  commandMethodOfSteps({
    name: 'sendPoll',
    recordsActivity: true,
    parameters: sendPollParametersSchema,
    steps: (call) =>
      startSteps(call.parameters)
        .andThen((parameters) => readPollQuestion(call, parameters))
        .andThen((poll) => readPollOptions(call, poll))
        .andThen((poll) => readPollType(call, poll))
        .andThen(refuseBothPollClosingTimes)
        .andThen((poll) => readSendOptions(call, poll)),
    execute: (context: MessageSendContext, { parameters, question, pollOptions, type, options }) =>
      sendMethodAnswer(sendPoll(context, {
        ...options,
        question,
        pollOptions,
        isAnonymous: parameters.is_anonymous,
        allowsMultipleAnswers: parameters.allows_multiple_answers,
        allowsRevoting: parameters.allows_revoting ?? type.kind === 'regular',
        type,
        isClosed: parameters.is_closed,
        ...(parameters.open_period === undefined
          ? {}
          : { closingTime: { kind: 'open_period', openPeriodSeconds: parameters.open_period } }),
        ...(parameters.close_date === undefined
          ? {}
          : { closingTime: { kind: 'close_date', closeDateUnixSeconds: parameters.close_date } }),
      })),
  }),
  // Telegram reads the rich message before it looks at the chat.
  waitingCommandMethodOfSteps({
    name: 'sendRichMessage',
    recordsActivity: true,
    parameters: sendRichMessageParametersSchema,
    steps: (call) =>
      startSteps(call.parameters)
        .andThen((parameters) => readRichMessage(call, parameters))
        .andThen((send) => readSendOptions(call, send)),
    waitFor: async (context, { richMessage, options }) => {
      const resolution = await resolveSpecifiedRichMessage(context, richMessage);
      if (!context.session.lifetime.admitsCommits) {
        return SESSION_ENDED;
      }
      return toWaitResult(resolution, (resolvedRichMessage) => ({ resolvedRichMessage, options }));
    },
    execute: (context: MessageSendContext, { resolvedRichMessage, options }) =>
      sendMethodAnswer(sendRichMessage(context, {
        ...options,
        ...resolvedRichMessage,
      })),
  }),
  waitingCommandMethodOfSteps({
    name: 'sendVideo',
    recordsActivity: true,
    parameters: sendVideoParametersSchema,
    steps: (call) => readMediaSend(call, 'video').andThen((send) => readThumbnail(call, send)),
    waitFor: (context, send) => waitForMediaFile(context, send, 'video'),
    execute: (context: MessageSendContext, { parameters, file, thumbnail, caption, options }) =>
      sendMethodAnswer(sendMedia(context, {
        media: {
          kind: 'video',
          video: file,
          attributes: {
            durationSeconds: parameters.duration,
            width: parameters.width,
            height: parameters.height,
          },
          ...(thumbnail === undefined ? {} : { thumbnail }),
          startTimestampSeconds: parameters.start_timestamp,
          caption,
          hasSpoiler: parameters.has_spoiler,
          showsCaptionAboveMedia: parameters.show_caption_above_media,
        },
        options,
      })),
  }),
  waitingCommandMethodOfSteps({
    name: 'sendVoice',
    recordsActivity: true,
    parameters: sendVoiceParametersSchema,
    steps: (call) => readMediaSend(call, 'voice'),
    waitFor: (context, send) => waitForMediaFile(context, send, 'voice'),
    execute: (context: MessageSendContext, { parameters, file, caption, options }) =>
      sendMethodAnswer(sendVoice(context, {
        ...options,
        voice: file,
        durationSeconds: parameters.duration,
        caption,
      })),
  }),
];

/** The step that reads the text of `sendMessage` and its formatting. */
function readMessageText<Parameters extends z.output<typeof sendMessageParametersSchema>>(
  { invalidParametersDescription }: BotApiStepCall<unknown>,
  parameters: Parameters,
): BotApiStepResult<{ readonly parameters: Parameters; readonly text: SpecifiedFormattedText }> {
  const textReading = readSpecifiedFormattedText({
    text: parameters.text,
    parseMode: parameters.parse_mode,
    entities: parameters.entities,
  }, invalidParametersDescription);
  return textReading.read
    ? proceedWith({ parameters, text: textReading.formattedText })
    : answerWith(textReading.errorAnswer);
}

/** The step that reads the rich message of `sendRichMessage`, as `readSpecifiedRichMessage` does. */
function readRichMessage<Parameters extends z.output<typeof sendRichMessageParametersSchema>>(
  { context, uploadedFiles, invalidParametersDescription }: BotApiStepCall<unknown>,
  parameters: Parameters,
): BotApiStepResult<
  { readonly parameters: Parameters; readonly richMessage: SpecifiedRichMessage }
> {
  const richMessageReading = readSpecifiedRichMessage(
    context,
    parameters.rich_message,
    uploadedFiles,
    invalidParametersDescription,
  );
  return richMessageReading.read
    ? proceedWith({ parameters, richMessage: richMessageReading.richMessage })
    : answerWith(richMessageReading.errorAnswer);
}

/**
 * The step that refuses a parameter that the official server reads with
 * `get_required_string_arg`, given as no text or not at all.
 */
function requireTextParameter<
  Parameters extends Readonly<Record<Name, string>>,
  Name extends string,
>(
  parameters: Parameters,
  parameterName: Name,
): BotApiStepResult<Parameters> {
  return parameters[parameterName].length === 0
    ? answerWith(presentBotApiError(BOT_API_ERRORS.requiredParameterMissing, { parameterName }))
    : proceedWith(parameters);
}

/** The step that reads a location's coordinates, which the official server's `get_location` requires. */
function requireCoordinates<
  Parameters extends { readonly latitude?: number; readonly longitude?: number },
>(
  parameters: Parameters,
): BotApiStepResult<Parameters & { readonly latitude: number; readonly longitude: number }> {
  const { latitude, longitude } = parameters;
  if (latitude === undefined) {
    return answerWith(presentFixedBotApiError(BOT_API_ERRORS.latitudeEmpty));
  }
  if (longitude === undefined) {
    return answerWith(presentFixedBotApiError(BOT_API_ERRORS.longitudeEmpty));
  }
  return proceedWith({ ...parameters, latitude, longitude });
}

/** The step that checks that a location's coordinates name a point on Earth. */
function readSentLocation<
  Send extends {
    readonly parameters: {
      readonly latitude: number;
      readonly longitude: number;
      readonly horizontal_accuracy?: number;
    };
  },
>(send: Send): BotApiStepResult<Send & { readonly location: GeoLocation }> {
  const { latitude, longitude, horizontal_accuracy: horizontalAccuracy } = send.parameters;
  return isPointOnEarth(latitude, longitude)
    ? proceedWith({
      ...send,
      location: createGeoLocation(latitude, longitude, horizontalAccuracy ?? 0),
    })
    : answerWithBadRequest(LOCATION_INVALID_DESCRIPTION);
}

/**
 * The steps of a method that sends a file of `fileKind` with a caption, as the official server
 * reads them before it looks at the chat: the file, then the caption and its formatting, then the
 * send options.
 */
function readMediaSend<
  FileKind extends SentFileKind,
  Parameters extends MediaSendParameters<FileKind>,
>(
  call: BotApiStepCall<Parameters>,
  fileKind: FileKind,
): BotApiSteps<MediaSendReading<Parameters>> {
  const { uploadedFiles, invalidParametersDescription } = call;
  return startSteps(call.parameters)
    .andThen((parameters) => {
      const fileReading = readInputFileParameter(fileKind, parameters[fileKind], uploadedFiles);
      return fileReading.read
        ? proceedWith({ parameters, requestedFile: fileReading.inputFile })
        : answerWith(presentBotApiError(BOT_API_ERRORS.inputFileMissing, { fileKind }));
    })
    .andThen((send) => {
      const captionReading = readSpecifiedCaption(send.parameters, invalidParametersDescription);
      return captionReading.read
        ? proceedWith({ ...send, caption: captionReading.formattedText })
        : answerWith(captionReading.errorAnswer);
    })
    .andThen((send) => readSendOptions(call, send));
}

/** The step that reads the thumbnail a document, video, or audio file is sent with, if any. */
function readThumbnail<
  Send extends {
    readonly parameters: { readonly thumbnail?: string; readonly thumb?: string };
  },
>(
  { uploadedFiles }: BotApiStepCall<unknown>,
  send: Send,
): BotApiStepResult<Send & { readonly thumbnail: Uint8Array<ArrayBuffer> | undefined }> {
  return proceedWith({
    ...send,
    thumbnail: readThumbnailParameter(send.parameters, uploadedFiles),
  });
}

/** Downloads the file a message names by URL; a file it names otherwise needs no download. */
async function waitForMediaFile<Send extends { readonly requestedFile: RequestedInputFile }>(
  context: BotApiMethodContext,
  { requestedFile, ...send }: Send,
  fileKind: SentFileKind,
): Promise<
  | BotApiStepResult<Omit<Send, 'requestedFile'> & { readonly file: BotApiInputFile }>
  | typeof SESSION_ENDED
> {
  const resolution = await resolveRequestedInputFile(context, requestedFile, fileKind);
  if (!context.session.lifetime.admitsCommits) {
    return SESSION_ENDED;
  }
  return toWaitResult(resolution, (file) => ({ ...send, file }));
}

/**
 * The step that reads the media of an album, as `readInputMediaGroupParameter` reads them, then
 * each member's caption, which the official server reports as media it cannot read.
 */
function readAlbumMedia<Parameters extends z.output<typeof sendMediaGroupParametersSchema>>(
  { uploadedFiles, invalidParametersDescription }: BotApiStepCall<unknown>,
  parameters: Parameters,
): BotApiStepResult<{
  readonly parameters: Parameters;
  readonly members: readonly UnreadMediaReplacement[];
  readonly captions: readonly SpecifiedFormattedText[];
}> {
  const mediaReading = readInputMediaGroupParameter(
    parameters.media,
    uploadedFiles,
    invalidParametersDescription,
  );
  if (!mediaReading.read) {
    return answerWithBadRequest(mediaReading.description);
  }
  const captions: SpecifiedFormattedText[] = [];
  for (const { caption } of mediaReading.media) {
    const captionReading = readEmbeddedFormattedText(
      caption,
      invalidParametersDescription,
      INPUT_MEDIA_ERROR_PREFIX,
    );
    if (!captionReading.read) {
      return answerWithBadRequest(captionReading.description);
    }
    captions.push(captionReading.formattedText);
  }
  return proceedWith({ parameters, members: mediaReading.media, captions });
}

/** Downloads, in the album's order, the files its media name by URL. */
async function waitForAlbumFiles(
  context: BotApiMethodContext,
  { members, captions, options }: {
    readonly members: readonly UnreadMediaReplacement[];
    readonly captions: readonly SpecifiedFormattedText[];
    readonly options: SendRequestOptions;
  },
): Promise<
  | BotApiStepResult<{
    readonly media: readonly MediaReplacementRequest[];
    readonly options: SendRequestOptions;
  }>
  | typeof SESSION_ENDED
> {
  const media: MediaReplacementRequest[] = [];
  for (const [memberIndex, member] of members.entries()) {
    const resolution = await resolveRequestedInputFile(
      context,
      getRequestedMediaFile(member),
      member.kind,
      memberIndex + 1,
    );
    if (!context.session.lifetime.admitsCommits) {
      return SESSION_ENDED;
    }
    const waitResult = toWaitResult(
      resolution,
      (file) => toMediaReplacementRequest(member, file, captions[memberIndex]),
    );
    if (waitResult === SESSION_ENDED || !waitResult.proceeds) {
      return waitResult;
    }
    media.push(waitResult.value);
  }
  return proceedWith({ media, options });
}

/** The step that reads a poll's question and its formatting. */
function readPollQuestion(
  { invalidParametersDescription }: BotApiStepCall<unknown>,
  parameters: SendPollParameters,
): BotApiStepResult<{
  readonly parameters: SendPollParameters;
  readonly question: SpecifiedFormattedText;
}> {
  const questionReading = readFormattedTextParameters({
    text: parameters.question,
    parseMode: parameters.question_parse_mode,
    entities: parameters.question_entities,
  }, invalidParametersDescription);
  return questionReading.read
    ? proceedWith({ parameters, question: questionReading.formattedText })
    : answerWithBadRequest(questionReading.description);
}

/**
 * The step that reads a poll's options, as `readInputPollOptionsParameter` reads them, then each
 * option's formatting, whose problems the official server reports per option.
 */
function readPollOptions<Poll extends { readonly parameters: SendPollParameters }>(
  { invalidParametersDescription }: BotApiStepCall<unknown>,
  poll: Poll,
): BotApiStepResult<Poll & { readonly pollOptions: readonly SpecifiedFormattedText[] }> {
  const optionsReading = readInputPollOptionsParameter(
    poll.parameters.options,
    invalidParametersDescription,
  );
  if (!optionsReading.read) {
    return answerWithBadRequest(optionsReading.description);
  }
  const pollOptions: SpecifiedFormattedText[] = [];
  for (const option of optionsReading.options) {
    const optionReading = readFormattedTextParameters({
      text: option.text,
      parseMode: option.parseMode,
      entities: option.entities,
    }, invalidParametersDescription);
    if (!optionReading.read) {
      return answerWithBadRequest(
        optionReading.description === invalidParametersDescription
          ? invalidParametersDescription
          : describeInputPollOptionTextError(optionReading.description),
      );
    }
    pollOptions.push(optionReading.formattedText);
  }
  return proceedWith({ ...poll, pollOptions });
}

/**
 * The step that reads a poll's type as `process_send_poll_query` reads it: a regular poll, or a
 * quiz, whose explanation is read with its formatting, then its correct options, as
 * `readCorrectOptionIdsParameter` reads them. A regular poll with any quiz parameter answers the
 * method's description of parameters that do not fit it.
 */
function readPollType<Poll extends { readonly parameters: SendPollParameters }>(
  { invalidParametersDescription }: BotApiStepCall<unknown>,
  poll: Poll,
): BotApiStepResult<Poll & { readonly type: PollTypeRequest }> {
  const {
    type,
    correct_option_ids: correctOptionIds,
    correct_option_id: correctOptionId,
    explanation,
    explanation_parse_mode: explanationParseMode,
    explanation_entities: explanationEntities,
  } = poll.parameters;
  const specifiedQuizParameters = [
    correctOptionIds,
    correctOptionId,
    explanation,
    explanationParseMode,
    explanationEntities,
  ];
  if (type === '' || type === 'regular') {
    return specifiedQuizParameters.some((value) => value !== undefined)
      ? answerWithBadRequest(invalidParametersDescription)
      : proceedWith({ ...poll, type: { kind: 'regular' } });
  }
  if (type !== 'quiz') {
    return answerWith(presentFixedBotApiError(BOT_API_ERRORS.pollTypeUnsupported));
  }
  const explanationReading = readFormattedTextParameters({
    text: explanation ?? '',
    parseMode: explanationParseMode,
    entities: explanationEntities,
  }, invalidParametersDescription);
  if (!explanationReading.read) {
    return answerWithBadRequest(explanationReading.description);
  }
  const correctOptionsReading = readCorrectOptionIdsParameter(correctOptionIds, correctOptionId);
  if (!correctOptionsReading.read) {
    return answerWithBadRequest(correctOptionsReading.description);
  }
  return proceedWith({
    ...poll,
    type: {
      kind: 'quiz',
      correctOptionPositions: correctOptionsReading.correctOptionPositions,
      explanation: explanationReading.formattedText,
    },
  });
}

/** The step that refuses a poll with both `open_period` and `close_date`, as the Bot API documents. */
function refuseBothPollClosingTimes<Poll extends { readonly parameters: SendPollParameters }>(
  poll: Poll,
): BotApiStepResult<Poll> {
  return poll.parameters.open_period !== undefined && poll.parameters.close_date !== undefined
    ? answerWith(presentFixedBotApiError(BOT_API_ERRORS.pollClosingTimesConflict))
    : proceedWith(poll);
}

/** The step that reads a draft's text and its formatting; empty text is allowed. */
function readDraftText<Parameters extends z.output<typeof sendMessageDraftParametersSchema>>(
  { invalidParametersDescription }: BotApiStepCall<unknown>,
  parameters: Parameters,
): BotApiStepResult<Omit<Parameters, 'text'> & { readonly text: SpecifiedFormattedText }> {
  const textReading = readFormattedTextParameters({
    text: parameters.text,
    parseMode: parameters.parse_mode,
    entities: parameters.entities,
  }, invalidParametersDescription);
  return textReading.read
    ? proceedWith({ ...parameters, text: textReading.formattedText })
    : answerWithBadRequest(textReading.description);
}

/** The step that reads a chat action by the lowercase names Telegram reads. */
function readChatAction<Parameters extends z.output<typeof sendChatActionParametersSchema>>(
  parameters: Parameters,
): BotApiStepResult<Parameters & { readonly chatAction: ChatAction }> {
  const chatAction = CHAT_ACTIONS_BY_NAME.get(parameters.action.toLowerCase());
  return chatAction === undefined
    ? answerWith(presentFixedBotApiError(BOT_API_ERRORS.chatActionInvalid))
    : proceedWith({ ...parameters, chatAction });
}

/** Telegram's answer to `sendMediaGroup`: the album's messages, or its error for why none was sent. */
function sendMediaGroupAnswer(result: SendMediaGroupResult): BotApiMethodAnswer {
  return result.sent
    ? botApiResult(result.messages)
    : presentMessageSendingFailure('message_send', result);
}
