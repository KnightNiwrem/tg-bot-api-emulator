import { Hono } from 'hono';
import type { z } from 'zod';

import { readBotActivityContract } from '../../contracts/bot_activity.ts';
import {
  type controlRequestIssueSchema,
  INVALID_REQUEST_REASON,
} from '../../contracts/control_errors.ts';
import type {
  ControlOperationResponse,
  DecodedControlRequest,
} from '../../contracts/operation_contract.ts';
import type { BotActivityEntry, BotActivityFilter } from '../../../types/bot_activity.ts';
import { toCurrentBotApiMethodName } from '../../../types/bot_api_method_name.ts';
import type { JsonStructure } from '../../../types/json_pattern.ts';
import { registerControlOperation } from '../../control_operation_route.ts';
import type { SessionRouteContextTypes } from '../session_route_context_types.ts';
import { presentWebhookAttemptFailure } from '../webhook_attempt_presentation.ts';

/** Where the bot activity routes are mounted within the server, as a contract path template. */
const BOT_ACTIVITY_MOUNT_PATH = '/sessions/{sessionId}/bot-activity';

type ReadBotActivityQuery = DecodedControlRequest<typeof readBotActivityContract>['query'];
type ReadBotActivityResponse = ControlOperationResponse<typeof readBotActivityContract>;

export function createBotActivityRoutes(): Hono<SessionRouteContextTypes> {
  const botActivityRoutes = new Hono<SessionRouteContextTypes>();

  registerControlOperation(
    botActivityRoutes,
    BOT_ACTIVITY_MOUNT_PATH,
    readBotActivityContract,
    async ({ query }, context): Promise<ReadBotActivityResponse> => {
      const [firstBoundIssue, ...otherBoundIssues] = findReadBoundIssues(query);
      if (firstBoundIssue !== undefined) {
        return {
          status: 400,
          body: { reason: INVALID_REQUEST_REASON, issues: [firstBoundIssue, ...otherBoundIssues] },
        };
      }
      const result = await context.get('emulationSession').botActivity.readEntries({
        after: query.after,
        before: query.before,
        filter: toBotActivityFilter(query),
        limit: query.limit,
        waitMilliseconds: query.wait_ms,
        signal: context.req.raw.signal,
      });
      if (!result.read) {
        return { status: 400, body: { reason: result.reason } };
      }
      return {
        status: 200,
        body: {
          entries: result.entries.map(presentBotActivityEntry),
          head_position: result.headPosition,
        },
      };
    },
  );

  return botActivityRoutes;
}

/**
 * The issues with a read's bounds that their schemas cannot state, each reported: a range must end
 * after it starts, and a read of a range that ends does not wait.
 */
function findReadBoundIssues(
  { after, before, wait_ms }: ReadBotActivityQuery,
): z.output<typeof controlRequestIssueSchema>[] {
  if (before === undefined) return [];
  return [
    ...(before <= after
      ? [{
        source: 'query' as const,
        path: ['before'],
        code: 'invalid_value' as const,
        message: 'A range must end after it starts',
      }]
      : []),
    ...(wait_ms !== 0
      ? [{
        source: 'query' as const,
        path: ['wait_ms'],
        code: 'invalid_value' as const,
        message: 'A read of a range that ends does not wait',
      }]
      : []),
  ];
}

function toBotActivityFilter(query: ReadBotActivityQuery): BotActivityFilter {
  return {
    ...(query.bot_id === undefined ? {} : { botId: query.bot_id }),
    ...(query.kind === undefined ? {} : { kind: query.kind }),
    // A method is recorded by its current name, so an older name finds its calls too.
    ...(query.method === undefined ? {} : { method: toCurrentBotApiMethodName(query.method) }),
    ...(query.chat_id === undefined ? {} : { chatId: query.chat_id }),
    ...(query.user_id === undefined ? {} : { userId: query.user_id }),
    ...(query.update_id === undefined ? {} : { updateId: query.update_id }),
    ...(query.ok === undefined ? {} : { ok: query.ok }),
    ...(query.parameters === undefined || Object.keys(query.parameters).length === 0
      ? {}
      : { parameters: query.parameters }),
    ...(query.parameters_json === undefined
      ? {}
      : { parameterPatterns: toParameterPatterns(query.parameters_json) }),
  };
}

/**
 * The patterns of a read by parameter name, kept in a map, where no name such as `__proto__` has a
 * special meaning.
 */
function toParameterPatterns(
  patternsByParameterName: NonNullable<ReadBotActivityQuery['parameters_json']>,
): ReadonlyMap<string, JsonStructure> {
  // The query reader keeps a JSON parameter's value as `readJsonText` read it, with its numbers
  // exact, and the contract's schema accepted each pattern as an object or array of JSON values;
  // the schema types those values as unknown, as it cannot name the exact numbers.
  return new Map(
    Object.entries(patternsByParameterName).map((
      [parameterName, pattern],
    ) => [parameterName, pattern as JsonStructure]),
  );
}

function presentBotActivityEntry(entry: BotActivityEntry) {
  const chatIdField = entry.chatId === undefined ? {} : { chat_id: entry.chatId };
  switch (entry.kind) {
    case 'bot_api_call':
      return {
        position: entry.position,
        kind: entry.kind,
        bot_id: entry.botId,
        method: entry.method,
        requested_method: entry.requestedMethod,
        via: entry.via,
        parameters: entry.parameters,
        uploaded_files: entry.uploadedFiles.map(({ fieldName, fileName, sizeBytes }) => ({
          field_name: fieldName,
          file_name: fileName,
          size_bytes: sizeBytes,
        })),
        ...chatIdField,
        answer: entry.answer,
      };
    case 'update_delivered':
      return {
        position: entry.position,
        kind: entry.kind,
        bot_id: entry.botId,
        via: entry.via,
        // A shallow copy, whose plain object type the contract's open Telegram object describes.
        update: { ...entry.update },
        ...chatIdField,
        ...(entry.userId === undefined ? {} : { user_id: entry.userId }),
        ...presentWebhookAttemptIdField(entry.webhookAttemptId),
      };
    case 'update_confirmed':
      return {
        position: entry.position,
        kind: entry.kind,
        bot_id: entry.botId,
        via: entry.via,
        update_id: entry.updateId,
        ...chatIdField,
        ...(entry.userId === undefined ? {} : { user_id: entry.userId }),
        ...presentWebhookAttemptIdField(entry.webhookAttemptId),
      };
    case 'webhook_attempt_failed':
      return {
        position: entry.position,
        kind: entry.kind,
        bot_id: entry.botId,
        update_id: entry.updateId,
        ...chatIdField,
        ...(entry.userId === undefined ? {} : { user_id: entry.userId }),
        webhook_attempt_id: entry.webhookAttemptId,
        failure: presentWebhookAttemptFailure(entry.failure),
        retry_delay_seconds: entry.retryDelaySeconds,
      };
    default: {
      const unhandledEntry: never = entry;
      throw new Error(`Unhandled bot activity entry: ${JSON.stringify(unhandledEntry)}`);
    }
  }
}

function presentWebhookAttemptIdField(webhookAttemptId: number | undefined) {
  return webhookAttemptId === undefined ? {} : { webhook_attempt_id: webhookAttemptId };
}
