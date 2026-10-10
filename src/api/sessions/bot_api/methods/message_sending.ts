import { z } from 'zod';

import type { EmulationSession } from '../../../../types/emulation_session.ts';
import {
  createGeoLocation,
  isPointOnEarth,
  MAX_HORIZONTAL_ACCURACY_METERS,
} from '../../../../types/geo_location.ts';
import {
  MAX_MEDIA_DURATION_SECONDS,
  MAX_VIDEO_SIDE_LENGTH,
} from '../../../../types/stored_file.ts';
import type { ChatAction } from '../../../../types/virtual_chat.ts';
import {
  BOT_BLOCKED_DESCRIPTION,
  CHAT_ID_EMPTY_DESCRIPTION,
  supergroupBotAccessFailureAnswer,
} from '../chat_access.ts';
import { contactNameSchema, contactVcardSchema } from '../contact_parameter.ts';
import {
  captionParametersShape,
  linkPreviewParametersShape,
  readEmbeddedFormattedText,
  readFormattedTextParameters,
  readSpecifiedCaption,
  readSpecifiedFormattedText,
  type SpecifiedFormattedText,
} from '../formatted_text_reading.ts';
import { readInputFileParameter, readThumbnailParameter } from '../input_file_parameter.ts';
import {
  getRequestedMediaFile,
  INPUT_MEDIA_ERROR_PREFIX,
  readInputMediaGroupParameter,
  toMediaReplacementRequest,
} from '../input_media_parameter.ts';
import {
  describeInputPollOptionTextError,
  readInputPollOptionsParameter,
} from '../input_poll_option_parameter.ts';
import { MESSAGE_TEXT_TOO_LONG_DESCRIPTION } from '../message_content_answers.ts';
import { messageEntitiesParameter } from '../message_entities_parameter.ts';
import {
  albumMessageNotSentError,
  badRequestDescription,
  botApiError,
  type BotApiMethod,
  type BotApiMethodAnswer,
  type BotApiMethodContext,
  botApiResult,
} from '../method_call.ts';
import { readCorrectOptionIdsParameter } from '../quiz_parameters.ts';
import {
  booleanParameter,
  type BotApiRequestParameters,
  type BotApiUploadedFiles,
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
  sendOptionsParametersShape,
} from '../send_options.ts';
import {
  readSpecifiedRichMessage,
  resolveSpecifiedRichMessage,
} from '../specified_rich_message.ts';
import { resolveRequestedInputFile } from '../web_file_parameter.ts';

/** The methods that send a new message, or show a chat action before one. */
export const MESSAGE_SENDING_METHODS: readonly BotApiMethod[] = [
  { name: 'sendAudio', recordsActivity: true, handler: handleSendAudio },
  { name: 'sendChatAction', recordsActivity: true, handler: handleSendChatAction },
  { name: 'sendContact', recordsActivity: true, handler: handleSendContact },
  { name: 'sendDocument', recordsActivity: true, handler: handleSendDocument },
  { name: 'sendLocation', recordsActivity: true, handler: handleSendLocation },
  { name: 'sendMediaGroup', recordsActivity: true, handler: handleSendMediaGroup },
  { name: 'sendMessage', recordsActivity: true, handler: handleSendMessage },
  { name: 'sendMessageDraft', recordsActivity: true, handler: handleSendMessageDraft },
  { name: 'sendPhoto', recordsActivity: true, handler: handleSendPhoto },
  { name: 'sendPoll', recordsActivity: true, handler: handleSendPoll },
  { name: 'sendRichMessage', recordsActivity: true, handler: handleSendRichMessage },
  { name: 'sendVideo', recordsActivity: true, handler: handleSendVideo },
  { name: 'sendVoice', recordsActivity: true, handler: handleSendVoice },
];

/** Telegram's descriptions for a message draft its servers refuse. */
const DRAFT_ID_INVALID_DESCRIPTION = 'Bad Request: RANDOM_ID_INVALID';
const DRAFT_CHAT_NOT_PRIVATE_DESCRIPTION = 'Bad Request: TEXTDRAFT_PEER_INVALID';

/** Telegram's description for a missing or unknown chat action. */
const CHAT_ACTION_INVALID_DESCRIPTION = 'Bad Request: wrong parameter action in request';

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

type SendMediaGroupResult = ReturnType<EmulationSession['botApi']['sendMediaGroup']>;

/**
 * An album's photo, video, document, or audio file as the service sends it, with its file
 * resolved.
 */
type MediaReplacementRequest = Parameters<
  EmulationSession['botApi']['sendMediaGroup']
>[1]['media'][number];

/** An upload of an album's message that Telegram's servers refused once the album was sent. */
type ServerRefusedUploadFailure = Extract<
  SendMediaGroupResult,
  { readonly reason: 'media_group_member_not_sent' }
>['failure'];

/** A poll's type as `sendPoll` takes it. */
type PollTypeRequest = Parameters<EmulationSession['botApi']['sendPoll']>[1]['type'];

function handleSendMessage(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const invalidParametersDescription = 'Bad Request: invalid sendMessage parameters';
  const parsedParameters = sendMessageParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, invalidParametersDescription);
  }
  const { text, parse_mode: parseMode, entities } = parsedParameters.data;
  // Telegram reads the text and its formatting before it looks at the chat.
  const formattedTextReading = readSpecifiedFormattedText(
    context,
    { text, parseMode, entities },
    invalidParametersDescription,
  );
  if (!formattedTextReading.read) {
    return formattedTextReading.errorAnswer;
  }
  const optionsReading = readSendOptions(
    context,
    parsedParameters.data,
    invalidParametersDescription,
  );
  if (!optionsReading.read) {
    return optionsReading.errorAnswer;
  }

  return sendMethodAnswer(context.session.botApi.sendMessage(context.bot, {
    ...optionsReading.options,
    ...formattedTextReading.formattedText,
  }));
}

/**
 * Sends a contact as the official Bot API server's `process_send_contact_query` reads it, before
 * the chat: a phone number and a first name, each required, and an optional last name and vCard.
 * As that method does, a bot names no Telegram user for the contact.
 */
function handleSendContact(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const invalidParametersDescription = 'Bad Request: invalid sendContact parameters';
  const parsedParameters = sendContactParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, invalidParametersDescription);
  }
  const { data } = parsedParameters;
  if (data.phone_number.length === 0) {
    return botApiError(400, 'Bad Request: parameter "phone_number" is required');
  }
  if (data.first_name.length === 0) {
    return botApiError(400, 'Bad Request: parameter "first_name" is required');
  }
  const optionsReading = readSendOptions(context, data, invalidParametersDescription);
  if (!optionsReading.read) {
    return optionsReading.errorAnswer;
  }

  return sendMethodAnswer(context.session.botApi.sendContact(context.bot, {
    ...optionsReading.options,
    contact: {
      phoneNumber: data.phone_number,
      firstName: data.first_name,
      lastName: data.last_name,
      vcard: data.vcard,
    },
  }));
}

/**
 * Sends a static location as the official Bot API server's `process_send_location_query` reads
 * it: the latitude and longitude, each required, and an optional accuracy, which TDLib's
 * `get_input_geo_point` sends as whole meters, rounded up. As TDLib's `Location::init` decides,
 * coordinates that name no point on Earth are refused. The emulator checks them once it has read
 * `chat_id` and the reply markup, but before it looks the chat up, while TDLib checks them once
 * the chat is found.
 */
function handleSendLocation(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const invalidParametersDescription = 'Bad Request: invalid sendLocation parameters';
  const parsedParameters = sendLocationParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, invalidParametersDescription);
  }
  const { data } = parsedParameters;
  if (data.latitude === undefined) {
    return botApiError(400, 'Bad Request: latitude is empty');
  }
  if (data.longitude === undefined) {
    return botApiError(400, 'Bad Request: longitude is empty');
  }
  const optionsReading = readSendOptions(context, data, invalidParametersDescription);
  if (!optionsReading.read) {
    return optionsReading.errorAnswer;
  }
  if (!isPointOnEarth(data.latitude, data.longitude)) {
    return botApiError(400, LOCATION_INVALID_DESCRIPTION);
  }

  return sendMethodAnswer(context.session.botApi.sendLocation(context.bot, {
    ...optionsReading.options,
    location: createGeoLocation(data.latitude, data.longitude, data.horizontal_accuracy ?? 0),
  }));
}

async function handleSendRichMessage(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
  uploadedFiles: BotApiUploadedFiles,
): Promise<BotApiMethodAnswer> {
  const invalidParametersDescription = 'Bad Request: invalid sendRichMessage parameters';
  const parsedParameters = sendRichMessageParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, invalidParametersDescription);
  }
  const { data } = parsedParameters;
  // Telegram reads the rich message before it looks at the chat.
  const richMessageReading = readSpecifiedRichMessage(
    context,
    data.rich_message,
    uploadedFiles,
    invalidParametersDescription,
  );
  if (!richMessageReading.read) {
    return richMessageReading.errorAnswer;
  }
  const optionsReading = readSendOptions(context, data, invalidParametersDescription);
  if (!optionsReading.read) {
    return optionsReading.errorAnswer;
  }

  const richMessageResolution = await resolveSpecifiedRichMessage(
    context,
    richMessageReading.richMessage,
  );
  if (!richMessageResolution.resolved) {
    return richMessageResolution.errorAnswer;
  }

  return sendMethodAnswer(context.session.botApi.sendRichMessage(context.bot, {
    ...optionsReading.options,
    ...richMessageResolution.value,
  }));
}

/**
 * Sends a poll as the official Bot API server's `process_send_poll_query` reads it, before the
 * chat: the question and the options, each with its formatting, then the poll's type with a quiz's
 * explanation and correct options, then its closing time. `allows_revoting` defaults to true for a
 * regular poll and to false for a quiz. Quiz parameters of a regular poll, which the server
 * ignores, and both `open_period` and `close_date`, of which the server ignores `close_date`, are
 * rejected to surface the bot's mistake.
 */
function handleSendPoll(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const invalidParametersDescription = 'Bad Request: invalid sendPoll parameters';
  const parsedParameters = sendPollParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, invalidParametersDescription);
  }
  const { data } = parsedParameters;
  const questionReading = readFormattedTextParameters(
    context,
    { text: data.question, parseMode: data.question_parse_mode, entities: data.question_entities },
    invalidParametersDescription,
  );
  if (!questionReading.read) {
    return botApiError(400, questionReading.description);
  }
  const optionsReading = readInputPollOptionsParameter(data.options, invalidParametersDescription);
  if (!optionsReading.read) {
    return botApiError(400, optionsReading.description);
  }
  const pollOptions: SpecifiedFormattedText[] = [];
  for (const option of optionsReading.options) {
    const optionReading = readFormattedTextParameters(
      context,
      { text: option.text, parseMode: option.parseMode, entities: option.entities },
      invalidParametersDescription,
    );
    if (!optionReading.read) {
      return botApiError(
        400,
        optionReading.description === invalidParametersDescription
          ? invalidParametersDescription
          : describeInputPollOptionTextError(optionReading.description),
      );
    }
    pollOptions.push(optionReading.formattedText);
  }
  const typeReading = readPollTypeParameters(context, data, invalidParametersDescription);
  if (!typeReading.read) {
    return typeReading.errorAnswer;
  }
  if (data.open_period !== undefined && data.close_date !== undefined) {
    return botApiError(400, "Bad Request: open_period and close_date can't be used together");
  }
  const sendOptionsReading = readSendOptions(context, data, invalidParametersDescription);
  if (!sendOptionsReading.read) {
    return sendOptionsReading.errorAnswer;
  }

  return sendMethodAnswer(context.session.botApi.sendPoll(context.bot, {
    ...sendOptionsReading.options,
    question: questionReading.formattedText,
    pollOptions,
    isAnonymous: data.is_anonymous,
    allowsMultipleAnswers: data.allows_multiple_answers,
    allowsRevoting: data.allows_revoting ?? typeReading.type.kind === 'regular',
    type: typeReading.type,
    isClosed: data.is_closed,
    ...(data.open_period === undefined
      ? {}
      : { closingTime: { kind: 'open_period', openPeriodSeconds: data.open_period } }),
    ...(data.close_date === undefined
      ? {}
      : { closingTime: { kind: 'close_date', closeDateUnixSeconds: data.close_date } }),
  }));
}

/**
 * Reads a poll's type as `process_send_poll_query` reads it: a regular poll, or a quiz, whose
 * explanation is read with its formatting, then its correct options, as
 * `readCorrectOptionIdsParameter` reads them. A regular poll with any quiz parameter answers
 * `invalidParametersDescription`.
 */
function readPollTypeParameters(
  context: BotApiMethodContext,
  parameters: Pick<
    z.infer<typeof sendPollParametersSchema>,
    | 'type'
    | 'correct_option_ids'
    | 'correct_option_id'
    | 'explanation'
    | 'explanation_parse_mode'
    | 'explanation_entities'
  >,
  invalidParametersDescription: string,
):
  | { readonly read: true; readonly type: PollTypeRequest }
  | { readonly read: false; readonly errorAnswer: BotApiMethodAnswer } {
  const {
    type,
    correct_option_ids: correctOptionIds,
    correct_option_id: correctOptionId,
    explanation,
    explanation_parse_mode: explanationParseMode,
    explanation_entities: explanationEntities,
  } = parameters;
  const specifiedQuizParameters = [
    correctOptionIds,
    correctOptionId,
    explanation,
    explanationParseMode,
    explanationEntities,
  ];
  if (type === '' || type === 'regular') {
    return specifiedQuizParameters.some((value) => value !== undefined)
      ? { read: false, errorAnswer: botApiError(400, invalidParametersDescription) }
      : { read: true, type: { kind: 'regular' } };
  }
  if (type !== 'quiz') {
    return {
      read: false,
      errorAnswer: botApiError(400, 'Bad Request: unsupported poll type specified'),
    };
  }
  const explanationReading = readFormattedTextParameters(
    context,
    { text: explanation ?? '', parseMode: explanationParseMode, entities: explanationEntities },
    invalidParametersDescription,
  );
  if (!explanationReading.read) {
    return { read: false, errorAnswer: botApiError(400, explanationReading.description) };
  }
  const correctOptionsReading = readCorrectOptionIdsParameter(correctOptionIds, correctOptionId);
  if (!correctOptionsReading.read) {
    return { read: false, errorAnswer: botApiError(400, correctOptionsReading.description) };
  }
  return {
    read: true,
    type: {
      kind: 'quiz',
      correctOptionPositions: correctOptionsReading.correctOptionPositions,
      explanation: explanationReading.formattedText,
    },
  };
}

async function handleSendPhoto(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
  uploadedFiles: BotApiUploadedFiles,
): Promise<BotApiMethodAnswer> {
  const invalidParametersDescription = 'Bad Request: invalid sendPhoto parameters';
  const parsedParameters = sendPhotoParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, invalidParametersDescription);
  }
  const { data } = parsedParameters;
  // Telegram reads the file, then the caption and its formatting, before it looks at the chat.
  const photoReading = readInputFileParameter('photo', data.photo, uploadedFiles);
  if (!photoReading.read) {
    return missingInputFileError('photo');
  }
  const captionReading = readSpecifiedCaption(context, data, invalidParametersDescription);
  if (!captionReading.read) {
    return captionReading.errorAnswer;
  }
  const optionsReading = readSendOptions(context, data, invalidParametersDescription);
  if (!optionsReading.read) {
    return optionsReading.errorAnswer;
  }

  const photoResolution = await resolveRequestedInputFile(context, photoReading.inputFile, 'photo');
  if (!photoResolution.resolved) {
    return photoResolution.errorAnswer;
  }

  return sendMethodAnswer(context.session.botApi.sendPhoto(context.bot, {
    ...optionsReading.options,
    photo: photoResolution.value,
    caption: captionReading.formattedText,
    hasSpoiler: data.has_spoiler,
    showsCaptionAboveMedia: data.show_caption_above_media,
  }));
}

async function handleSendDocument(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
  uploadedFiles: BotApiUploadedFiles,
): Promise<BotApiMethodAnswer> {
  const invalidParametersDescription = 'Bad Request: invalid sendDocument parameters';
  const parsedParameters = sendDocumentParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, invalidParametersDescription);
  }
  const { data } = parsedParameters;
  // Telegram reads the file, then the caption and its formatting, before it looks at the chat.
  const documentReading = readInputFileParameter('document', data.document, uploadedFiles);
  if (!documentReading.read) {
    return missingInputFileError('document');
  }
  const captionReading = readSpecifiedCaption(context, data, invalidParametersDescription);
  if (!captionReading.read) {
    return captionReading.errorAnswer;
  }
  const optionsReading = readSendOptions(context, data, invalidParametersDescription);
  if (!optionsReading.read) {
    return optionsReading.errorAnswer;
  }

  const documentResolution = await resolveRequestedInputFile(
    context,
    documentReading.inputFile,
    'document',
  );
  if (!documentResolution.resolved) {
    return documentResolution.errorAnswer;
  }

  const thumbnail = readThumbnailParameter(data, uploadedFiles);
  return sendMethodAnswer(context.session.botApi.sendDocument(context.bot, {
    ...optionsReading.options,
    document: documentResolution.value,
    ...(thumbnail === undefined ? {} : { thumbnail }),
    caption: captionReading.formattedText,
  }));
}

async function handleSendVideo(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
  uploadedFiles: BotApiUploadedFiles,
): Promise<BotApiMethodAnswer> {
  const invalidParametersDescription = 'Bad Request: invalid sendVideo parameters';
  const parsedParameters = sendVideoParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, invalidParametersDescription);
  }
  const { data } = parsedParameters;
  // Telegram reads the file, then the caption and its formatting, before it looks at the chat.
  const videoReading = readInputFileParameter('video', data.video, uploadedFiles);
  if (!videoReading.read) {
    return missingInputFileError('video');
  }
  const captionReading = readSpecifiedCaption(context, data, invalidParametersDescription);
  if (!captionReading.read) {
    return captionReading.errorAnswer;
  }
  const optionsReading = readSendOptions(context, data, invalidParametersDescription);
  if (!optionsReading.read) {
    return optionsReading.errorAnswer;
  }

  const videoResolution = await resolveRequestedInputFile(
    context,
    videoReading.inputFile,
    'video',
  );
  if (!videoResolution.resolved) {
    return videoResolution.errorAnswer;
  }

  const thumbnail = readThumbnailParameter(data, uploadedFiles);
  return sendMethodAnswer(context.session.botApi.sendVideo(context.bot, {
    ...optionsReading.options,
    video: videoResolution.value,
    attributes: { durationSeconds: data.duration, width: data.width, height: data.height },
    ...(thumbnail === undefined ? {} : { thumbnail }),
    startTimestampSeconds: data.start_timestamp,
    caption: captionReading.formattedText,
    hasSpoiler: data.has_spoiler,
    showsCaptionAboveMedia: data.show_caption_above_media,
  }));
}

async function handleSendVoice(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
  uploadedFiles: BotApiUploadedFiles,
): Promise<BotApiMethodAnswer> {
  const invalidParametersDescription = 'Bad Request: invalid sendVoice parameters';
  const parsedParameters = sendVoiceParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, invalidParametersDescription);
  }
  const { data } = parsedParameters;
  // Telegram reads the file, then the caption and its formatting, before it looks at the chat.
  const voiceReading = readInputFileParameter('voice', data.voice, uploadedFiles);
  if (!voiceReading.read) {
    return missingInputFileError('voice');
  }
  const captionReading = readSpecifiedCaption(context, data, invalidParametersDescription);
  if (!captionReading.read) {
    return captionReading.errorAnswer;
  }
  const optionsReading = readSendOptions(context, data, invalidParametersDescription);
  if (!optionsReading.read) {
    return optionsReading.errorAnswer;
  }

  const voiceResolution = await resolveRequestedInputFile(
    context,
    voiceReading.inputFile,
    'voice',
  );
  if (!voiceResolution.resolved) {
    return voiceResolution.errorAnswer;
  }

  return sendMethodAnswer(context.session.botApi.sendVoice(context.bot, {
    ...optionsReading.options,
    voice: voiceResolution.value,
    durationSeconds: data.duration,
    caption: captionReading.formattedText,
  }));
}

async function handleSendAudio(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
  uploadedFiles: BotApiUploadedFiles,
): Promise<BotApiMethodAnswer> {
  const invalidParametersDescription = 'Bad Request: invalid sendAudio parameters';
  const parsedParameters = sendAudioParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, invalidParametersDescription);
  }
  const { data } = parsedParameters;
  // Telegram reads the file, then the caption and its formatting, before it looks at the chat.
  const audioReading = readInputFileParameter('audio', data.audio, uploadedFiles);
  if (!audioReading.read) {
    return missingInputFileError('audio');
  }
  const captionReading = readSpecifiedCaption(context, data, invalidParametersDescription);
  if (!captionReading.read) {
    return captionReading.errorAnswer;
  }
  const optionsReading = readSendOptions(context, data, invalidParametersDescription);
  if (!optionsReading.read) {
    return optionsReading.errorAnswer;
  }

  const audioResolution = await resolveRequestedInputFile(
    context,
    audioReading.inputFile,
    'audio',
  );
  if (!audioResolution.resolved) {
    return audioResolution.errorAnswer;
  }

  const thumbnail = readThumbnailParameter(data, uploadedFiles);
  return sendMethodAnswer(context.session.botApi.sendAudio(context.bot, {
    ...optionsReading.options,
    audio: audioResolution.value,
    attributes: { durationSeconds: data.duration, performer: data.performer, title: data.title },
    ...(thumbnail === undefined ? {} : { thumbnail }),
    caption: captionReading.formattedText,
  }));
}

/**
 * Sends an album, as `BotApiService.sendMediaGroup` does. As the official Bot API server reads
 * them, the media and their captions are read before the chat; the files the media name by URL are
 * then downloaded in order, as for `sendPhoto`.
 */
async function handleSendMediaGroup(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
  uploadedFiles: BotApiUploadedFiles,
): Promise<BotApiMethodAnswer> {
  const invalidParametersDescription = 'Bad Request: invalid sendMediaGroup parameters';
  const parsedParameters = sendMediaGroupParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, invalidParametersDescription);
  }
  const { data } = parsedParameters;
  const mediaReading = readInputMediaGroupParameter(
    data.media,
    uploadedFiles,
    invalidParametersDescription,
  );
  if (!mediaReading.read) {
    return botApiError(400, mediaReading.description);
  }
  const captions: SpecifiedFormattedText[] = [];
  for (const { caption } of mediaReading.media) {
    const captionReading = readEmbeddedFormattedText(
      context,
      caption,
      invalidParametersDescription,
      INPUT_MEDIA_ERROR_PREFIX,
    );
    if (!captionReading.read) {
      return botApiError(400, captionReading.description);
    }
    captions.push(captionReading.formattedText);
  }
  const optionsReading = readSendOptions(context, data, invalidParametersDescription);
  if (!optionsReading.read) {
    return optionsReading.errorAnswer;
  }

  const media: MediaReplacementRequest[] = [];
  for (const [memberIndex, member] of mediaReading.media.entries()) {
    const fileResolution = await resolveRequestedInputFile(
      context,
      getRequestedMediaFile(member),
      member.kind,
      memberIndex + 1,
    );
    if (!fileResolution.resolved) {
      return fileResolution.errorAnswer;
    }
    media.push(toMediaReplacementRequest(member, fileResolution.value, captions[memberIndex]));
  }

  const { chatId, replyTo, isContentProtected, isSilent, messageEffectId } = optionsReading.options;
  return sendMediaGroupAnswer(context.session.botApi.sendMediaGroup(context.bot, {
    chatId,
    replyTo,
    isContentProtected,
    isSilent,
    messageEffectId,
    media,
  }));
}

/**
 * Telegram's answer to `sendMediaGroup`: the album's messages, or, for an album TDLib refuses, the
 * description `fail_query_with_error` gives TDLib's error.
 */
function sendMediaGroupAnswer(result: SendMediaGroupResult): BotApiMethodAnswer {
  if (result.sent) {
    return botApiResult(result.messages);
  }
  switch (result.reason) {
    case 'album_empty':
      return botApiError(400, 'Bad Request: there are no messages to send');
    case 'album_too_large':
      return botApiError(400, 'Bad Request: too many messages to send as an album');
    case 'album_caption_placement_mixed':
      return botApiError(
        400,
        'Bad Request: parameter show_caption_above_media must be the same for all messages',
      );
    case 'album_documents_mixed':
      return botApiError(400, "Bad Request: document can't be mixed with other media types");
    case 'album_audio_mixed':
      return botApiError(400, "Bad Request: audio can't be mixed with other media types");
    case 'media_group_member_not_sent':
      return albumMessageNotSentError(
        result.memberPosition,
        serverRefusedUploadError(result.failure),
      );
    default:
      return sendMethodAnswer(result);
  }
}

/**
 * The error Telegram's servers give for an upload they refuse, as `albumMessageNotSentError`
 * reports it. A local server's upload limit is enforced with an error that is not in the source;
 * the emulator words it as TDLib's `check_full_local_location` words its own size checks.
 */
function serverRefusedUploadError(failure: ServerRefusedUploadFailure): string {
  switch (failure.reason) {
    case 'image_invalid':
      return 'IMAGE_PROCESS_FAILED';
    case 'photo_dimensions_invalid':
      return 'PHOTO_INVALID_DIMENSIONS';
    case 'bot_upload_too_big':
      return `File of size ${failure.fileSizeBytes} bytes is too big; ` +
        `the maximum size is ${failure.maxFileSizeBytes} bytes`;
    default: {
      const unhandledFailure: never = failure;
      throw new Error(`Unhandled refused upload: ${JSON.stringify(unhandledFailure)}`);
    }
  }
}

/** The error for a file parameter that names no uploaded file. */
function missingInputFileError(
  parameterName: 'photo' | 'document' | 'video' | 'voice' | 'audio',
): BotApiMethodAnswer {
  return botApiError(400, `Bad Request: there is no ${parameterName} in the request`);
}

/**
 * Shows a draft of a message the bot is generating, as the official Bot API server's
 * `process_send_message_draft_query` reads it: the text and its formatting before the chat, and a
 * missing or zero `draft_id` as none, which Telegram's servers refuse. Empty text is allowed.
 */
function handleSendMessageDraft(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const invalidParametersDescription = 'Bad Request: invalid sendMessageDraft parameters';
  const parsedParameters = sendMessageDraftParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, invalidParametersDescription);
  }
  const { data } = parsedParameters;
  const formattedTextReading = readFormattedTextParameters(
    context,
    { text: data.text, parseMode: data.parse_mode, entities: data.entities },
    invalidParametersDescription,
  );
  if (!formattedTextReading.read) {
    return botApiError(400, formattedTextReading.description);
  }
  if (data.chat_id === undefined) {
    return botApiError(400, CHAT_ID_EMPTY_DESCRIPTION);
  }

  const result = context.session.botApi.sendMessageDraft(context.bot, {
    chatId: data.chat_id,
    draftId: data.draft_id,
    text: formattedTextReading.formattedText,
    canStop: data.can_stop,
    keepOnStop: data.keep_on_stop,
  });
  if (result.sent) {
    return botApiResult(true);
  }
  switch (result.reason) {
    case 'chat_not_found':
    case 'bot_not_a_member':
    case 'bot_kicked':
      return supergroupBotAccessFailureAnswer(result.reason);
    case 'text_invalid':
      return botApiError(400, badRequestDescription(result.textError));
    case 'draft_chat_not_private':
      return botApiError(400, DRAFT_CHAT_NOT_PRIVATE_DESCRIPTION);
    case 'bot_blocked':
      return botApiError(403, BOT_BLOCKED_DESCRIPTION);
    case 'draft_id_missing':
      return botApiError(400, DRAFT_ID_INVALID_DESCRIPTION);
    case 'message_text_too_long':
      return botApiError(400, MESSAGE_TEXT_TOO_LONG_DESCRIPTION);
    default: {
      const unhandledReason: never = result;
      throw new Error(`Unhandled sendMessageDraft failure: ${JSON.stringify(unhandledReason)}`);
    }
  }
}

function handleSendChatAction(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = sendChatActionParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid sendChatAction parameters');
  }
  const { chat_id: chatId, action: actionName } = parsedParameters.data;
  // Telegram reads the action before it looks at the chat.
  const action = CHAT_ACTIONS_BY_NAME.get(actionName.toLowerCase());
  if (action === undefined) {
    return botApiError(400, CHAT_ACTION_INVALID_DESCRIPTION);
  }
  if (chatId === undefined) {
    return botApiError(400, CHAT_ID_EMPTY_DESCRIPTION);
  }

  const result = context.session.botApi.sendChatAction(
    context.bot,
    { chatId, action },
  );
  if (result.sent) {
    return botApiResult(true);
  }
  switch (result.reason) {
    case 'chat_not_found':
    case 'bot_not_a_member':
    case 'bot_kicked':
      return supergroupBotAccessFailureAnswer(result.reason);
    case 'bot_blocked':
      return botApiError(403, BOT_BLOCKED_DESCRIPTION);
    default: {
      const unhandledReason: never = result.reason;
      throw new Error(`Unhandled sendChatAction failure: ${unhandledReason}`);
    }
  }
}
