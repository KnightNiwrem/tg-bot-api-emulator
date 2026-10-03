import type { FormattedTextFixingContext } from '../text_entities/formatted_text.ts';
import type { VirtualAccount } from '../types/virtual_account.ts';
import type { VirtualBot } from '../types/virtual_bot.ts';

/** The users of one emulation session: its accounts and its bots. */
interface SessionUserLookups {
  readonly accounts: { getById(accountId: number): VirtualAccount | undefined };
  readonly bots: { getById(botId: number): VirtualBot | undefined };
}

/**
 * The context in which text from any chat of the session is fixed: a text mention may name any user
 * of the session, account or bot.
 */
export function createSessionUserMentionContext(
  { accounts, bots }: SessionUserLookups,
): FormattedTextFixingContext {
  return {
    isMentionableUser: (userId) =>
      accounts.getById(userId) !== undefined || bots.getById(userId) !== undefined,
  };
}
