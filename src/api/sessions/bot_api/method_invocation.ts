import { z } from 'zod';

import { recordBotApiCall } from './call_recording.ts';
import { CHAT_NOT_FOUND_DESCRIPTION, resolveChatIdentifier } from './chat_access.ts';
import {
  type BotApiCallContext,
  botApiError,
  type BotApiMethod,
  type BotApiMethodAnswer,
  type BotApiMethodContext,
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

/**
 * Runs a bot's call of a method, however the call arrived, unless a test queued a rate limit or
 * server error answer for it, which the call receives instead, before the method reads its
 * parameters or changes anything. The call and its answer are recorded as bot activity.
 */
export async function callBotApiMethod(
  context: BotApiCallContext,
  { method, requestedMethodName, parameters, uploadedFiles }: BotApiMethodCall,
): Promise<BotApiMethodAnswer> {
  const answer = await answerBotApiMethodCall(context, method, parameters, uploadedFiles);
  recordBotApiCall(context, {
    methodName: method.name,
    requestedMethodName,
    parameters,
    uploadedFiles,
    chatId: findNamedChatId(context, parameters),
  }, answer);
  return answer;
}

/**
 * Answers a call that names no method the emulator implements, however the call arrived, and
 * records it as bot activity.
 */
export function rejectUnknownBotApiMethod(
  context: BotApiCallContext,
  requestedMethodName: string,
  parameters: BotApiRequestParameters,
  uploadedFiles: BotApiUploadedFiles,
): BotApiMethodAnswer {
  const answer = botApiError(404, 'Not Found: method not found');
  recordBotApiCall(context, {
    methodName: requestedMethodName,
    requestedMethodName,
    parameters,
    uploadedFiles,
    chatId: findNamedChatId(context, parameters),
  }, answer);
  return answer;
}

/**
 * Answers a call of an implemented method whose request could not be decoded, and records it as
 * bot activity without parameters.
 */
export function rejectUndecodableBotApiCall(
  context: BotApiCallContext,
  { name }: BotApiMethod,
  requestedMethodName: string,
  description: string,
): BotApiMethodAnswer {
  const answer = botApiError(400, description);
  recordBotApiCall(context, {
    methodName: name,
    requestedMethodName,
    parameters: {},
    uploadedFiles: new Map(),
    chatId: undefined,
  }, answer);
  return answer;
}

async function answerBotApiMethodCall(
  context: BotApiCallContext,
  { name, handler }: BotApiMethod,
  parameters: BotApiRequestParameters,
  uploadedFiles: BotApiUploadedFiles,
): Promise<BotApiMethodAnswer> {
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
      return { resolved: false, errorAnswer: botApiError(400, CHAT_NOT_FOUND_DESCRIPTION) };
    }
    resolvedParameters = { ...resolvedParameters, [parameterName]: String(chatId) };
  }
  return { resolved: true, parameters: resolvedParameters };
}
