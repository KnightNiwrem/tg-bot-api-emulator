import type { VirtualBotProfile } from '../../../types/virtual_bot.ts';

/**
 * A failure without the reasons its caller knows it cannot meet. Its other reasons stay as precise
 * as the domain reports them, for the family's presenter to word.
 */
export type FailureWithout<
  Failure extends { readonly reason: string },
  ImpossibleReason extends string,
> = Failure extends unknown
  ? Omit<Failure, 'reason'> & { readonly reason: Exclude<Failure['reason'], ImpossibleReason> }
  : never;

/**
 * A failure of an operation of the bot whose token authenticated the call, without the
 * `bot_not_found` reason its service may report: that bot exists.
 */
export type AuthenticatedBotFailure<Failure extends { readonly reason: string }> = FailureWithout<
  Failure,
  'bot_not_found'
>;

/**
 * The error thrown when a service reports that the authenticated bot does not exist, which breaks
 * the invariant that authentication found it.
 */
export function missingAuthenticatedBotError(authenticatedBot: VirtualBotProfile): Error {
  return new Error(`Authenticated bot ${authenticatedBot.id} does not exist`);
}

/**
 * Narrows why an operation of the authenticated bot failed to the reasons it can meet, throwing
 * `missingAuthenticatedBotError` for `bot_not_found`.
 */
export function excludeMissingBotFailure<Reason extends string>(
  authenticatedBot: VirtualBotProfile,
  reason: Reason | 'bot_not_found',
): Reason {
  if (reason === 'bot_not_found') {
    throw missingAuthenticatedBotError(authenticatedBot);
  }
  return reason;
}
