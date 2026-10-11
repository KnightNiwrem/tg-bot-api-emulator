import type { EmulationSession } from '../../../../session/emulation_session.ts';
import type { BotApiMethodAnswer } from '../method_call.ts';
import { BOT_API_ERRORS } from './error_catalogue.ts';
import { type FixedBotApiError, presentFixedBotApiError } from './error_template.ts';

type BotApi = EmulationSession['botApi'];

/**
 * Why `getUpdates` retrieved nothing, other than its session ending, which no answer reports.
 * Telegram delays a conflict by 3 seconds when another occurred within the previous 3 seconds;
 * the emulator answers immediately to keep tests fast.
 */
type UpdatesPollFailure = {
  readonly retrieved: false;
  readonly reason: Exclude<
    Extract<Awaited<ReturnType<BotApi['getUpdates']>>, { readonly retrieved: false }>['reason'],
    'session_ended'
  >;
};

/** Why `setWebhook` set no webhook. */
type WebhookSettingFailure = Extract<
  ReturnType<BotApi['setWebhook']>,
  { readonly accepted: false }
>;

/** Telegram's errors for the failures of the update delivery family, by reason. */
const UPDATE_DELIVERY_ERRORS = {
  terminated_by_other_long_poll: BOT_API_ERRORS.updatesPollTerminatedByOtherPoll,
  terminated_by_webhook: BOT_API_ERRORS.updatesPollTerminatedByWebhook,
  webhook_active: BOT_API_ERRORS.updatesPollWhileWebhookActive,
  url_invalid: BOT_API_ERRORS.webhookUrlInvalid,
  secret_token_too_long: BOT_API_ERRORS.webhookSecretTokenTooLong,
  secret_token_invalid: BOT_API_ERRORS.webhookSecretTokenInvalid,
} as const satisfies Readonly<Record<string, FixedBotApiError>>;

/** Telegram's error for a poll that retrieved no updates, or a webhook that was not set. */
export function presentUpdateDeliveryFailure(
  failure: UpdatesPollFailure | WebhookSettingFailure,
): BotApiMethodAnswer {
  return presentFixedBotApiError(UPDATE_DELIVERY_ERRORS[failure.reason]);
}
