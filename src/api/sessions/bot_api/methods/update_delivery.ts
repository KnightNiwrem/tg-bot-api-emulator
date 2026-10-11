import { z } from 'zod';

import { presentUpdateDeliveryFailure } from '../errors/update_delivery_failure_presenter.ts';
import {
  type BotApiFamilyContext,
  type BotApiMethod,
  botApiResult,
  SESSION_ENDED,
} from '../method_call.ts';
import {
  answerWithBadRequest,
  type BotApiStepResult,
  commandMethodOfSteps,
  handledMethodOfSteps,
  proceedWith,
  startSteps,
} from '../method_steps.ts';
import {
  booleanParameter,
  type BotApiUploadedFiles,
  clampedIntegerParameter,
  integerParameter,
  jsonParameter,
} from '../request_parameters.ts';

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

type SetWebhookParameters = z.output<typeof setWebhookParametersSchema>;

/**
 * What the update delivery methods use: the bot's update consumers, which keep polling and webhook
 * delivery exclusive.
 */
type UpdateDeliveryContext = BotApiFamilyContext<'botUpdateConsumers'>;

/**
 * The methods by which a bot receives updates: polling with `getUpdates`, or a webhook. Setting and
 * deleting a webhook execute as commands in their call's transaction; a `getUpdates` call executes
 * a command when it arrives, and another when its long poll's wait ends.
 */
export const UPDATE_DELIVERY_METHODS: readonly BotApiMethod[] = [
  commandMethodOfSteps({
    name: 'deleteWebhook',
    recordsActivity: true,
    parameters: deleteWebhookParametersSchema,
    steps: ({ parameters }) => startSteps(parameters),
    execute: (
      context: UpdateDeliveryContext,
      { drop_pending_updates: dropPendingUpdates },
    ) => {
      const outcome = context.session.botUpdateConsumers.deleteWebhook(context.bot.id, {
        dropPendingUpdates,
      });
      return botApiResult(true, SET_WEBHOOK_OUTCOME_DESCRIPTIONS[outcome]);
    },
  }),
  handledMethodOfSteps({
    name: 'getUpdates',
    recordsActivity: false,
    parameters: getUpdatesParametersSchema,
    steps: ({ parameters }) => startSteps(parameters),
    execute: async (
      context: UpdateDeliveryContext,
      { offset, limit, timeout, allowed_updates: allowedUpdates },
    ) => {
      const result = await context.session.botUpdateConsumers.getUpdates(context.bot.id, {
        offset,
        limit,
        timeoutSeconds: timeout,
        allowedUpdates,
        signal: context.signal,
      });
      if (result.retrieved) {
        return botApiResult(result.updates);
      }
      // A poll whose session ended is refused without an answer.
      const { reason } = result;
      return reason === 'session_ended'
        ? SESSION_ENDED
        : presentUpdateDeliveryFailure({ retrieved: false, reason });
    },
    // A long poll held or still arriving when its session ends finds nothing, as one whose timeout
    // passes does; it confirms nothing.
    answerOnceSessionEnded: botApiResult([]),
  }),
  handledMethodOfSteps({
    name: 'getWebhookInfo',
    recordsActivity: true,
    parameters: getWebhookInfoParametersSchema,
    steps: ({ parameters }) => startSteps(parameters),
    execute: (context: UpdateDeliveryContext) =>
      botApiResult(context.session.botUpdateConsumers.getWebhookInfo(context.bot.id)),
  }),
  commandMethodOfSteps({
    name: 'setWebhook',
    recordsActivity: true,
    parameters: setWebhookParametersSchema,
    steps: ({ parameters, uploadedFiles }) =>
      startSteps(parameters)
        .andThen(refuseWebhookIpAddress)
        .andThen((webhookParameters) => refuseWebhookCertificate(webhookParameters, uploadedFiles)),
    execute: (context: UpdateDeliveryContext, parameters) => {
      const result = context.session.botUpdateConsumers.setWebhook(context.bot.id, {
        url: parameters.url,
        secretToken: parameters.secret_token,
        maxConnections: parameters.max_connections,
        allowedUpdates: parameters.allowed_updates,
        dropPendingUpdates: parameters.drop_pending_updates,
      });
      return result.accepted
        ? botApiResult(true, SET_WEBHOOK_OUTCOME_DESCRIPTIONS[result.outcome])
        : presentUpdateDeliveryFailure(result);
    },
  }),
];

/** The step that refuses a webhook at a given IP address, which the emulator does not support. */
function refuseWebhookIpAddress(
  parameters: SetWebhookParameters,
): BotApiStepResult<SetWebhookParameters> {
  return parameters.ip_address.length > 0
    ? answerWithBadRequest(WEBHOOK_IP_ADDRESS_UNSUPPORTED_DESCRIPTION)
    : proceedWith(parameters);
}

/**
 * The step that refuses a webhook's self-signed certificate, which the emulator does not support.
 * Telegram reads the certificate from a part of that name or through `attach://`.
 */
function refuseWebhookCertificate(
  parameters: SetWebhookParameters,
  uploadedFiles: BotApiUploadedFiles,
): BotApiStepResult<SetWebhookParameters> {
  const specifiesCertificate =
    (parameters.certificate !== undefined && parameters.certificate.length > 0) ||
    uploadedFiles.has('certificate');
  return specifiesCertificate
    ? answerWithBadRequest(WEBHOOK_CERTIFICATE_UNSUPPORTED_DESCRIPTION)
    : proceedWith(parameters);
}
