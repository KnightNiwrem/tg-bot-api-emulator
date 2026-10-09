import type { MessageDraft } from '../types/message_draft.ts';
import type { VirtualAccount } from '../types/virtual_account.ts';
import type { VirtualBot } from '../types/virtual_bot.ts';
import type { PrivateConversationKey } from '../types/virtual_chat.ts';

export type GetMessageDraftResult =
  | {
    readonly found: true;
    /** `undefined` when the conversation shows no draft. */
    readonly draft: MessageDraft | undefined;
  }
  | { readonly found: false; readonly reason: 'account_not_found' | 'bot_not_found' };

export interface ExpireMessageDraftInput extends PrivateConversationKey {
  /**
   * The ID of the draft the caller expects the conversation to show, in Telegram's decimal text
   * form; omitted to expire whichever draft it shows. It guards which draft expires, not which
   * write to it.
   */
  readonly expectedDraftId?: string;
}

export type ExpireMessageDraftResult =
  | { readonly expired: true }
  | {
    readonly expired: false;
    readonly reason:
      | 'account_not_found'
      | 'bot_not_found'
      | 'draft_not_found'
      | 'draft_id_mismatch';
  };

interface AccountLookup {
  getById(accountId: number): VirtualAccount | undefined;
}

interface BotLookup {
  getById(botId: number): VirtualBot | undefined;
}

interface MessageDraftStore {
  showDraft(conversation: PrivateConversationKey, draft: MessageDraft): void;
  removeDraft(conversation: PrivateConversationKey): void;
  getDraft(conversation: PrivateConversationKey): MessageDraft | undefined;
}

interface MessageDraftServiceDependencies {
  readonly accounts: AccountLookup;
  readonly bots: BotLookup;
  readonly drafts: MessageDraftStore;
}

/**
 * Keeps the message drafts that bots stream to accounts' private chats, as `MessageDraft`
 * describes them. Drafts are separate from the conversation's messages: showing, replacing,
 * clearing or expiring one never changes its history.
 *
 * Callers check that the bot may write to the account, and read the draft's text, before showing
 * it.
 */
export class MessageDraftService {
  readonly #accounts: AccountLookup;
  readonly #bots: BotLookup;
  readonly #drafts: MessageDraftStore;

  constructor({ accounts, bots, drafts }: MessageDraftServiceDependencies) {
    this.#accounts = accounts;
    this.#bots = bots;
    this.#drafts = drafts;
  }

  /**
   * Shows a draft the bot wrote in its private chat with the account. A draft with the shown
   * draft's ID changes it; one with another ID replaces it.
   */
  showBotDraft(conversation: PrivateConversationKey, draft: MessageDraft): void {
    this.#drafts.showDraft(conversation, draft);
  }

  /** Removes the draft of a conversation whose bot sent a message to it, as any message does. */
  clearBotDraft(conversation: PrivateConversationKey): void {
    this.#drafts.removeDraft(conversation);
  }

  /** Returns the draft an account's client shows in its private chat with a bot. */
  getPrivateMessageDraft({ accountId, botId }: PrivateConversationKey): GetMessageDraftResult {
    if (this.#accounts.getById(accountId) === undefined) {
      return { found: false, reason: 'account_not_found' };
    }
    if (this.#bots.getById(botId) === undefined) {
      return { found: false, reason: 'bot_not_found' };
    }
    return { found: true, draft: this.#drafts.getDraft({ accountId, botId }) };
  }

  /**
   * Removes the draft an account's client shows, standing for the 30 seconds after which
   * Telegram's clients remove it. The bot is not told: it may write the draft again, which shows
   * it anew.
   */
  expirePrivateMessageDraft(
    { accountId, botId, expectedDraftId }: ExpireMessageDraftInput,
  ): ExpireMessageDraftResult {
    const lookup = this.getPrivateMessageDraft({ accountId, botId });
    if (!lookup.found) {
      return { expired: false, reason: lookup.reason };
    }
    if (lookup.draft === undefined) {
      return { expired: false, reason: 'draft_not_found' };
    }
    if (expectedDraftId !== undefined && lookup.draft.draftId !== expectedDraftId) {
      return { expired: false, reason: 'draft_id_mismatch' };
    }
    this.#drafts.removeDraft({ accountId, botId });
    return { expired: true };
  }
}
