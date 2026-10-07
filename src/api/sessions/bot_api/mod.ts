import { type Context, Hono } from 'hono';

import type { VirtualBotProfile } from '../../../types/virtual_bot.ts';
import { fileDownloadResponse } from '../file_download.ts';
import type { SessionRouteContextTypes } from '../session_route_context_types.ts';
import { type BotApiCallContext, botApiError, type BotApiMethodAnswer } from './method_call.ts';
import { findBotApiMethod } from './method_catalogue.ts';
import {
  callBotApiMethod,
  rejectUndecodableBotApiCall,
  rejectUnknownBotApiMethod,
} from './method_invocation.ts';
import { decodeBotApiRequestParameters } from './request_parameters.ts';

const BOT_TOKEN_PATH_PARAMETER = 'botTokenPathSegment';
const BOT_TOKEN_PATH_PREFIX = 'bot';
const BOT_TOKEN_PATH = `/:${BOT_TOKEN_PATH_PARAMETER}{${BOT_TOKEN_PATH_PREFIX}[^/]+}` as const;
const BOT_API_SUBRESOURCE_PATH = `${BOT_TOKEN_PATH}/*` as const;
const BOT_API_METHOD_NAME_PARAMETER = 'methodName';
/** Everything after the token is the method name, as in the official Bot API server. */
const BOT_API_METHOD_PATH = `${BOT_TOKEN_PATH}/:${BOT_API_METHOD_NAME_PARAMETER}{.*}` as const;
const FILE_PATH_PARAMETER = 'filePath';
/** Where bots download files, as Telegram serves them: `/file/bot<token>/<file_path>`. */
const BOT_FILE_DOWNLOAD_PATH =
  `/file/:${BOT_TOKEN_PATH_PARAMETER}{${BOT_TOKEN_PATH_PREFIX}[^/]+}/:${FILE_PATH_PARAMETER}{.+}` as const;

type BotApiRouteVariables = SessionRouteContextTypes['Variables'] & {
  /** The bot whose token authenticated the request; set before any Bot API method runs. */
  readonly authenticatedBot: VirtualBotProfile;
};

interface BotApiRouteContextTypes {
  readonly Variables: BotApiRouteVariables;
}

export function createBotApiRoutes(): Hono<BotApiRouteContextTypes> {
  const botApiRoutes = new Hono<BotApiRouteContextTypes>();

  // Telegram answers a download with an unknown token or path as not found.
  botApiRoutes.get(BOT_FILE_DOWNLOAD_PATH, (context) => {
    const botTokenPathSegment = context.req.param(BOT_TOKEN_PATH_PARAMETER);
    const { botApi } = context.get('emulationSession');
    const authenticatedBot = botApi.authenticate(
      botTokenPathSegment.slice(BOT_TOKEN_PATH_PREFIX.length),
    );
    const file = authenticatedBot === undefined
      ? undefined
      : botApi.downloadFile(authenticatedBot, context.req.param(FILE_PATH_PARAMETER));
    return file === undefined
      ? botApiResponse(context, botApiError(404, 'Not Found'))
      : fileDownloadResponse(context, file);
  });

  // Telegram rejects a path without a method segment before it checks the token.
  botApiRoutes.all(
    BOT_TOKEN_PATH,
    (context) => botApiResponse(context, botApiError(404, 'Not Found')),
  );

  // Telegram rejects an invalid token before it resolves the method or validates parameters.
  botApiRoutes.use(BOT_API_SUBRESOURCE_PATH, async (context, next) => {
    const botTokenPathSegment = context.req.param(BOT_TOKEN_PATH_PARAMETER);
    const token = botTokenPathSegment.slice(BOT_TOKEN_PATH_PREFIX.length);
    const authenticatedBot = context.get('emulationSession').botApi.authenticate(token);
    if (authenticatedBot === undefined) {
      return botApiResponse(context, botApiError(401, 'Unauthorized'));
    }

    context.set('authenticatedBot', authenticatedBot);
    await next();
  });

  // Telegram accepts both HTTP methods for every Bot API method. It rejects an unknown method
  // before it reads the parameters; the emulator reads them anyway to record the call.
  botApiRoutes.on(['GET', 'POST'], BOT_API_METHOD_PATH, async (context) => {
    const requestedMethodName = context.req.param(BOT_API_METHOD_NAME_PARAMETER);
    const method = findBotApiMethod(requestedMethodName);
    const parametersDecoding = await decodeBotApiRequestParameters(context.req.raw);
    const callContext: BotApiCallContext = {
      session: context.get('emulationSession'),
      bot: context.get('authenticatedBot'),
      signal: context.req.raw.signal,
      via: 'http',
    };
    if (method === undefined) {
      const { parameters, uploadedFiles } = parametersDecoding.decoded
        ? parametersDecoding
        : { parameters: {}, uploadedFiles: new Map() };
      return botApiResponse(
        context,
        rejectUnknownBotApiMethod(callContext, requestedMethodName, parameters, uploadedFiles),
      );
    }
    if (!parametersDecoding.decoded) {
      return botApiResponse(
        context,
        rejectUndecodableBotApiCall(
          callContext,
          method,
          requestedMethodName,
          parametersDecoding.description,
        ),
      );
    }
    return botApiResponse(
      context,
      await callBotApiMethod(callContext, {
        method,
        requestedMethodName,
        parameters: parametersDecoding.parameters,
        uploadedFiles: parametersDecoding.uploadedFiles,
      }),
    );
  });

  // Telegram answers every other path in its Bot API namespace with a Bot API error.
  botApiRoutes.all('*', (context) => botApiResponse(context, botApiError(404, 'Not Found')));

  return botApiRoutes;
}

/** Sends a Bot API method's answer as the JSON body of an HTTP response. */
function botApiResponse(context: Context, { status, body }: BotApiMethodAnswer): Response {
  const retryAfterSeconds = body.ok ? undefined : body.parameters?.retry_after;
  return retryAfterSeconds === undefined
    ? context.json(body, status)
    : context.json(body, status, { 'Retry-After': String(retryAfterSeconds) });
}
