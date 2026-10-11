import { z } from 'zod';

import { presentUpdateDeliveryFailure } from '../errors/update_delivery_failure_presenter.ts';
import {
  botApiError,
  type BotApiMethod,
  type BotApiMethodAnswer,
  type BotApiMethodContext,
  type BotApiMethodOutcome,
  botApiResult,
  SESSION_ENDED,
} from '../method_call.ts';
import {
  booleanParameter,
  type BotApiRequestParameters,
  type BotApiUploadedFiles,
  clampedIntegerParameter,
  integerParameter,
  jsonParameter,
} from '../request_parameters.ts';

/** The methods by which a bot receives updates: polling with `getUpdates`, or a webhook. */
export const UPDATE_DELIVERY_METHODS: readonly BotApiMethod[] = [
  { name: 'deleteWebhook', recordsActivity: true, handler: handleDeleteWebhook },
  {
    name: 'getUpdates',
    recordsActivity: false,
    handler: handleGetUpdates,
    // A long poll held or still arriving when its session ends finds nothing, as one whose timeout
    // passes does; it confirms nothing.
    answerOnceSessionEnded: botApiResult([]),
  },
  { name: 'getWebhookInfo', recordsActivity: true, handler: handleGetWebhookInfo },
  { name: 'setWebhook', recordsActivity: true, handler: handleSetWebhook },
];

/** Telegram's answers to setWebhook and deleteWebhook, by what the request did. */
const SET_WEBHOOK_OUTCOME_DESCRIPTIONS = {
  webhook_set: 'Webhook was set',
  webhook_already_set: 'Webhook is already set',
  webhook_deleted: 'Webhook was deleted',
  webhook_already_deleted: 'Webhook is already deleted',
} as const;

/**
 * The emulator's descriptions for webhook options it does not support: Telegram connects to a
 * webhook at a given IP address, or trusts its self-signed certificate.
 */
const WEBHOOK_IP_ADDRESS_UNSUPPORTED_DESCRIPTION =
  'Bad Request: webhook IP addresses are not supported';
const WEBHOOK_CERTIFICATE_UNSUPPORTED_DESCRIPTION =
  'Bad Request: custom webhook certificates are not supported';

/** Telegram's default and range for `max_connections`, to which it clamps other values. */
const DEFAULT_WEBHOOK_MAX_CONNECTIONS = 40;
const MIN_WEBHOOK_MAX_CONNECTIONS = 1;
const MAX_WEBHOOK_MAX_CONNECTIONS = 100;

const deleteWebhookParametersSchema = z.strictObject({
  drop_pending_updates: booleanParameter().default(false),
});

const setWebhookParametersSchema = z.strictObject({
  url: z.string().default(''),
  certificate: z.string().optional(),
  ip_address: z.string().default(''),
  max_connections: clampedIntegerParameter(
    MIN_WEBHOOK_MAX_CONNECTIONS,
    MAX_WEBHOOK_MAX_CONNECTIONS,
  ).default(DEFAULT_WEBHOOK_MAX_CONNECTIONS),
  // As for getUpdates, a malformed value is rejected rather than ignored.
  allowed_updates: jsonParameter(z.array(z.string())).optional(),
  drop_pending_updates: booleanParameter().default(false),
  secret_token: z.string().default(''),
});

const getWebhookInfoParametersSchema = z.strictObject({});

const getUpdatesParametersSchema = z.strictObject({
  offset: integerParameter(z.int()).optional(),
  limit: integerParameter(z.int().min(1).max(100)).default(100),
  timeout: integerParameter(z.int().min(0).max(50)).default(0),
  // Telegram ignores a malformed value and keeps the current subscription; rejecting it instead
  // surfaces the bot's mistake in tests.
  allowed_updates: jsonParameter(z.array(z.string())).optional(),
});

async function handleGetUpdates(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): Promise<BotApiMethodOutcome> {
  const parsedParameters = getUpdatesParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid getUpdates parameters');
  }

  const result = await context.session.botApi.getUpdates(
    context.bot,
    {
      offset: parsedParameters.data.offset,
      limit: parsedParameters.data.limit,
      timeoutSeconds: parsedParameters.data.timeout,
      allowedUpdates: parsedParameters.data.allowed_updates,
      signal: context.signal,
    },
  );
  if (result.retrieved) {
    return botApiResult(result.updates);
  }
  // A poll whose session ended is refused without an answer.
  const { reason } = result;
  return reason === 'session_ended'
    ? SESSION_ENDED
    : presentUpdateDeliveryFailure({ retrieved: false, reason });
}

function handleSetWebhook(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
  uploadedFiles: BotApiUploadedFiles,
): BotApiMethodAnswer {
  const parsedParameters = setWebhookParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid setWebhook parameters');
  }
  const { data } = parsedParameters;
  if (data.ip_address.length > 0) {
    return botApiError(400, WEBHOOK_IP_ADDRESS_UNSUPPORTED_DESCRIPTION);
  }
  // Telegram reads the certificate from a part of that name or through `attach://`.
  const specifiesCertificate = (data.certificate !== undefined && data.certificate.length > 0) ||
    uploadedFiles.has('certificate');
  if (specifiesCertificate) {
    return botApiError(400, WEBHOOK_CERTIFICATE_UNSUPPORTED_DESCRIPTION);
  }

  const result = context.session.botApi.setWebhook(
    context.bot,
    {
      url: data.url,
      secretToken: data.secret_token,
      maxConnections: data.max_connections,
      allowedUpdates: data.allowed_updates,
      dropPendingUpdates: data.drop_pending_updates,
    },
  );
  if (!result.accepted) {
    return presentUpdateDeliveryFailure(result);
  }
  return botApiResult(true, SET_WEBHOOK_OUTCOME_DESCRIPTIONS[result.outcome]);
}

function handleGetWebhookInfo(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  if (!getWebhookInfoParametersSchema.safeParse(parameters).success) {
    return botApiError(400, 'Bad Request: invalid getWebhookInfo parameters');
  }
  return botApiResult(context.session.botApi.getWebhookInfo(context.bot));
}

function handleDeleteWebhook(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = deleteWebhookParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid deleteWebhook parameters');
  }

  const outcome = context.session.botApi.deleteWebhook(
    context.bot,
    { dropPendingUpdates: parsedParameters.data.drop_pending_updates },
  );
  return botApiResult(true, SET_WEBHOOK_OUTCOME_DESCRIPTIONS[outcome]);
}
