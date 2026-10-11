import { Hono } from 'hono';
import { basePath } from 'hono/route';
import { z } from 'zod';

import {
  getInlineQueryContract,
  sendInlineQueryContract,
} from '../../../../control_contracts/inline_queries.ts';
import type {
  ControlOperationRefusal,
  DecodedControlRequest,
} from '../../../../control_contracts/operation_contract.ts';
import { toBotApiLocation } from '../../../types/bot_api.ts';
import type { EmulationSession } from '../../../types/emulation_session.ts';
import { createGeoLocation, type GeoLocation } from '../../../types/geo_location.ts';
import type {
  InlineQuery,
  InlineQueryResult,
  InlineQueryResultsButton,
} from '../../../types/inline_query.ts';
import {
  controlErrorResponse,
  invalidControlRequestResponse,
} from '../../control_error_response.ts';
import { registerControlOperation } from '../../control_operation_route.ts';
import { readPathParameters } from '../control_request_input.ts';
import { readJsonRequestBody } from '../json_request_body.ts';
import type { SessionRouteContextTypes } from '../session_route_context_types.ts';
import { ACCOUNT_ID_PARAMETER, accountPathSchema } from './account_paths.ts';
import { viewChatMessageForAccount } from './chat_message_view.ts';

type SendInlineQueryBody = DecodedControlRequest<typeof sendInlineQueryContract>['body'];

const INLINE_QUERY_ID_PARAMETER = 'inlineQueryId';
const CHOSEN_INLINE_RESULT_COLLECTION_PATH =
  `/:${ACCOUNT_ID_PARAMETER}/inline-queries/:${INLINE_QUERY_ID_PARAMETER}/chosen-results` as const;

/** Where the account routes are mounted within the server, as a contract path template. */
const ACCOUNT_COLLECTION_MOUNT_PATH = '/sessions/{sessionId}/accounts';

const chooseInlineQueryResultRequestSchema = z.strictObject({
  result_id: z.string().min(1),
});

/**
 * Routes through which an account sends inline queries to inline bots, reads them with the bot's
 * answer, and sends a result it chooses.
 */
export function createInlineQueryRoutes(): Hono<SessionRouteContextTypes> {
  const accountRoutes = new Hono<SessionRouteContextTypes>();

  registerControlOperation(
    accountRoutes,
    ACCOUNT_COLLECTION_MOUNT_PATH,
    sendInlineQueryContract,
    ({ params: { accountId }, body }, context) => {
      const result = context.get('emulationSession').inlineQueries.sendInlineQuery({
        fromAccountId: accountId,
        botId: body.bot_id,
        chat: body.chat,
        query: body.query,
        offset: body.offset,
        ...(body.location === undefined ? {} : { userLocation: toGeoLocation(body.location) }),
      });
      if (!result.sent) {
        return refuseInlineQuerySending(result.reason);
      }
      return {
        status: 201,
        headers: {
          Location: `${basePath(context)}/${accountId}/inline-queries/${result.inlineQuery.id}`,
        },
        body: { inline_query: presentInlineQueryForAccount(result.inlineQuery) },
      };
    },
  );

  registerControlOperation(
    accountRoutes,
    ACCOUNT_COLLECTION_MOUNT_PATH,
    getInlineQueryContract,
    ({ params: { accountId, inlineQueryId } }, context) => {
      const inlineQuery = context.get('emulationSession').inlineQueries.getAccountInlineQuery({
        accountId,
        inlineQueryId,
      });
      return inlineQuery === undefined
        ? { status: 404, body: { reason: 'inline_query_not_found' } }
        : { status: 200, body: { inline_query: presentInlineQueryForAccount(inlineQuery) } };
    },
  );

  accountRoutes.post(CHOSEN_INLINE_RESULT_COLLECTION_PATH, async (context) => {
    const accountPath = readPathParameters(accountPathSchema, context.req.param());
    if (!accountPath.valid) {
      return invalidControlRequestResponse(context, accountPath.issues);
    }
    const { accountId } = accountPath.value;

    const requestBodyReading = await readJsonRequestBody(
      context.req,
      chooseInlineQueryResultRequestSchema,
    );
    if (!requestBodyReading.valid) {
      return invalidControlRequestResponse(context, requestBodyReading.issues);
    }
    const requestBody = requestBodyReading.value;

    const { inlineQueries, botMessageViews } = context.get('emulationSession');
    const result = await inlineQueries.chooseInlineQueryResult({
      accountId,
      inlineQueryId: context.req.param(INLINE_QUERY_ID_PARAMETER),
      resultId: requestBody.result_id,
      signal: context.req.raw.signal,
    });
    if (!result.chosen) {
      return controlErrorResponse(
        context,
        chosenInlineResultFailureStatus(result.reason),
        result.reason,
      );
    }
    return context.json(
      { message: viewChatMessageForAccount(botMessageViews, result.message, accountId) },
      201,
    );
  });

  return accountRoutes;
}

/**
 * The location an account shares, from the coordinates and accuracy its client reports; an
 * accuracy left out is unknown.
 */
function toGeoLocation(
  { latitude, longitude, horizontal_accuracy }: NonNullable<SendInlineQueryBody['location']>,
): GeoLocation {
  return createGeoLocation(latitude, longitude, horizontal_accuracy ?? 0);
}

/**
 * A supergroup the account is not a member of is forbidden; a bot without inline mode, or one
 * that does not ask for the account's location while the request shares it, conflicts with the
 * query; a missing account, bot, or chat is not found.
 */
function refuseInlineQuerySending(
  reason: Extract<
    ReturnType<EmulationSession['inlineQueries']['sendInlineQuery']>,
    { readonly sent: false }
  >['reason'],
): ControlOperationRefusal<typeof sendInlineQueryContract> {
  switch (reason) {
    case 'not_a_member':
      return { status: 403, body: { reason } };
    case 'inline_mode_disabled':
    case 'inline_location_not_requested':
      return { status: 409, body: { reason } };
    case 'account_not_found':
    case 'bot_not_found':
    case 'chat_not_found':
      return { status: 404, body: { reason } };
    default: {
      const unhandledReason: never = reason;
      throw new Error(`Unhandled inline query send failure: ${unhandledReason}`);
    }
  }
}

/**
 * A missing query is not found; a result the answer does not hold rejects the request; an account
 * no longer a member of the supergroup, or one that may not use inline bots or send the result's
 * content there, is forbidden; a query without an answer, or a bot the account blocks, conflicts
 * with sending it; and media the result names by URL that the emulated web does not serve fails as
 * a bad gateway, while media it serves that is not of the result's kind cannot be processed.
 */
function chosenInlineResultFailureStatus(
  reason: Extract<
    Awaited<ReturnType<EmulationSession['inlineQueries']['chooseInlineQueryResult']>>,
    { readonly chosen: false }
  >['reason'],
): 400 | 403 | 404 | 409 | 422 | 502 {
  switch (reason) {
    case 'inline_query_not_found':
      return 404;
    case 'result_not_found':
      return 400;
    case 'not_a_member':
    case 'inline_bots_not_permitted':
    case 'send_permission_missing':
      return 403;
    case 'inline_query_not_answered':
    case 'bot_blocked':
      return 409;
    case 'web_media_invalid':
      return 422;
    case 'web_media_unavailable':
      return 502;
    default: {
      const unhandledReason: never = reason;
      throw new Error(`Unhandled inline query result choice failure: ${unhandledReason}`);
    }
  }
}

/** Shows an inline query to the account that sent it, with the bot's answer once given. */
function presentInlineQueryForAccount(
  { id, botId, chat, query, offset, userLocation, state }: InlineQuery,
) {
  return {
    id,
    bot_id: botId,
    chat,
    query,
    offset,
    ...(userLocation === undefined ? {} : { location: toBotApiLocation(userLocation) }),
    status: state.status,
    answer: state.status !== 'answered' ? null : {
      results: state.answer.results.map(presentInlineQueryResultForAccount),
      cache_time: state.answer.cacheTimeSeconds,
      is_personal: state.answer.isPersonal,
      next_offset: state.answer.nextOffset,
      ...(state.answer.button === undefined
        ? {}
        : { button: presentInlineQueryResultsButton(state.answer.button) }),
    },
  };
}

/**
 * Shows a result as the account's client lists it, by its type, identifier, and texts. What
 * sending it writes shows in the sent message.
 */
function presentInlineQueryResultForAccount(result: InlineQueryResult) {
  return {
    type: result.kind,
    id: result.id,
    ...(result.title === undefined ? {} : { title: result.title }),
    // A voice note result has no description.
    ...('description' in result && result.description !== undefined
      ? { description: result.description }
      : {}),
    ...(result.kind === 'article' && result.url !== undefined ? { url: result.url } : {}),
  };
}

/** Shows the button above the results as the Bot API specifies it. */
function presentInlineQueryResultsButton(button: InlineQueryResultsButton) {
  return button.kind === 'start_bot'
    ? { text: button.text, start_parameter: button.startParameter }
    : { text: button.text, web_app: { url: button.url } };
}
