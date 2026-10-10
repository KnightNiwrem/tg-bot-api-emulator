import { z } from 'zod';

import { recordBotApiCall, type RecordedBotApiCallDetails } from './call_recording.ts';
import { resolveChatIdentifier } from './chat_access.ts';
import { BOT_API_ERRORS } from './errors/error_catalogue.ts';
import { presentFixedBotApiError } from './errors/error_template.ts';
import {
  type BotApiCallContext,
  type BotApiCallOutcome,
  botApiError,
  type BotApiMethod,
  type BotApiMethodAnswer,
  type BotApiMethodContext,
  type BotApiMethodOutcome,
  SESSION_ENDED,
} from './method_call.ts';
import { takeQueuedAnswer } from './queued_answer.ts';
import {
  type BotApiRequestParameters,
  type BotApiUploadedFiles,
  CHAT_USERNAME_PREFIX,
  integerParameter,
} from './request_parameters.ts';

/** A bot's call of a method the emulator implements, as it arrived. */
export interface BotApiMethodCall {
  readonly method: BotApiMethod;
  /** The method name as the bot called it, which may be an older name or differ in case. */
  readonly requestedMethodName: string;
  readonly parameters: BotApiRequestParameters;
  readonly uploadedFiles: BotApiUploadedFiles;
}

/** The outcome of a call that its ended session refused. */
const SESSION_ENDED_CALL_OUTCOME: BotApiCallOutcome = { answered: false, reason: 'session_ended' };

/**
 * The outcome of a call of `method` that its session's end stopped before it changed anything: the
 * method's answer for that case, if it has one, and otherwise a refusal.
 */
function endedSessionCallOutcome({ answerOnceSessionEnded }: BotApiMethod): BotApiCallOutcome {
  return answerOnceSessionEnded === undefined
    ? SESSION_ENDED_CALL_OUTCOME
    : { answered: true, answer: answerOnceSessionEnded };
}

/**
 * Runs a bot's call of a method, however the call arrived, unless a test queued a rate limit or
 * server error answer for it, which the call receives instead, before the method reads its
 * parameters or changes anything. The call and its answer are recorded as bot activity if the
 * method's calls are.
 *
 * Once the session has ended, a call changes and records nothing, and gets its method's
 * ended-session outcome, whatever it would otherwise have been answered: a refusal, or, for a
 * method that declares one, such as `getUpdates`, its answer for that case. The session is checked
 * when the call starts and once its method has answered; a method that waits checks it itself
 * after each wait, before it changes anything.
 */
export async function callBotApiMethod(
  context: BotApiCallContext,
  { method, requestedMethodName, parameters, uploadedFiles }: BotApiMethodCall,
): Promise<BotApiCallOutcome> {
  if (!context.session.lifetime.admitsCommits) {
    return endedSessionCallOutcome(method);
  }
  const outcome = await answerBotApiMethodCall(context, method, parameters, uploadedFiles);
  if (outcome === SESSION_ENDED || !context.session.lifetime.admitsCommits) {
    return endedSessionCallOutcome(method);
  }
  recordImplementedMethodCall(context, method, {
    requestedMethodName,
    parameters,
    uploadedFiles,
    chatId: findNamedChatId(context, parameters),
  }, outcome);
  return { answered: true, answer: outcome };
}

/**
 * Answers a call that names no method the emulator implements, however the call arrived, and
 * records it as bot activity, unless its session has ended.
 */
export function rejectUnknownBotApiMethod(
  context: BotApiCallContext,
  requestedMethodName: string,
  parameters: BotApiRequestParameters,
  uploadedFiles: BotApiUploadedFiles,
): BotApiCallOutcome {
  if (!context.session.lifetime.admitsCommits) {
    return SESSION_ENDED_CALL_OUTCOME;
  }
  const answer = botApiError(404, 'Not Found: method not found');
  recordBotApiCall(context, {
    methodName: requestedMethodName,
    requestedMethodName,
    parameters,
    uploadedFiles,
    chatId: findNamedChatId(context, parameters),
  }, answer);
  return { answered: true, answer };
}

/**
 * Answers a call of an implemented method whose request could not be decoded, and records it as
 * bot activity without parameters if the method's calls are recorded. Once the session has ended,
 * the call gets its method's ended-session outcome instead.
 */
export function rejectUndecodableBotApiCall(
  context: BotApiCallContext,
  method: BotApiMethod,
  requestedMethodName: string,
  description: string,
): BotApiCallOutcome {
  if (!context.session.lifetime.admitsCommits) {
    return endedSessionCallOutcome(method);
  }
  const answer = botApiError(400, description);
  recordImplementedMethodCall(context, method, {
    requestedMethodName,
    parameters: {},
    uploadedFiles: new Map(),
    chatId: undefined,
  }, answer);
  return { answered: true, answer };
}

/**
 * Records a call of an implemented method under the method's current name, unless the method's
 * record declares that its calls are not recorded.
 */
function recordImplementedMethodCall(
  context: BotApiCallContext,
  { name, recordsActivity }: BotApiMethod,
  call: Omit<RecordedBotApiCallDetails, 'methodName'>,
  answer: BotApiMethodAnswer,
): void {
  if (recordsActivity) {
    recordBotApiCall(context, { methodName: name, ...call }, answer);
  }
}

async function answerBotApiMethodCall(
  context: BotApiCallContext,
  { name, handler }: BotApiMethod,
  parameters: BotApiRequestParameters,
  uploadedFiles: BotApiUploadedFiles,
): Promise<BotApiMethodOutcome> {
  const queuedAnswer = takeQueuedAnswer(context, name);
  if (queuedAnswer !== undefined) {
    return queuedAnswer;
  }
  const chatResolution = resolveChatUsernameParameters(context, parameters);
  return chatResolution.resolved
    ? await handler(context, chatResolution.parameters, uploadedFiles)
    : chatResolution.errorAnswer;
}

const namedChatIdSchema = integerParameter(z.int());

/**
 * Finds the chat a call's `chat_id` names, by its ID or by a public username, for the call's bot
 * activity record; `undefined` when it names no chat.
 */
function findNamedChatId(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): number | undefined {
  const chatIdentifier = parameters.chat_id;
  if (chatIdentifier === undefined) {
    return undefined;
  }
  if (chatIdentifier.startsWith(CHAT_USERNAME_PREFIX)) {
    return resolveChatIdentifier(context, chatIdentifier);
  }
  const chatId = namedChatIdSchema.safeParse(chatIdentifier);
  return chatId.success ? chatId.data : undefined;
}

/** The parameters that name a chat, which the official Bot API server reads with `check_chat`. */
const CHAT_PARAMETER_NAMES = ['chat_id', 'from_chat_id'] as const;

/**
 * Replaces a public username after `@` in the parameters that name a chat with the ID of the chat
 * it names, as the official Bot API server's `check_chat` resolves it before using the chat; a
 * username that names no chat a bot may address fails with `Bad Request: chat not found`.
 *
 * Telegram resolves the username when it checks the chat, after reading most other parameters;
 * the emulator resolves it first, so a request that has another fault too may fail for the
 * username instead.
 */
function resolveChatUsernameParameters(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
):
  | { readonly resolved: true; readonly parameters: BotApiRequestParameters }
  | { readonly resolved: false; readonly errorAnswer: BotApiMethodAnswer } {
  let resolvedParameters = parameters;
  for (const parameterName of CHAT_PARAMETER_NAMES) {
    const chatIdentifier = parameters[parameterName];
    if (!chatIdentifier?.startsWith(CHAT_USERNAME_PREFIX)) {
      continue;
    }
    const chatId = resolveChatIdentifier(context, chatIdentifier);
    if (chatId === undefined) {
      return { resolved: false, errorAnswer: presentFixedBotApiError(BOT_API_ERRORS.chatNotFound) };
    }
    resolvedParameters = { ...resolvedParameters, [parameterName]: String(chatId) };
  }
  return { resolved: true, parameters: resolvedParameters };
}
