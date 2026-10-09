import type { ChatDomainEvent } from '../types/chat_domain_event.ts';
import type { MessageDraft, WrittenMessageDraft } from '../types/message_draft.ts';
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

/** The draft a test acts on: the one a private conversation shows. */
export interface ShownMessageDraftTarget extends PrivateConversationKey {
  /**
   * The ID of the draft the caller expects the conversation to show, in Telegram's decimal text
   * form; omitted to act on whichever draft it shows. It guards which draft the action applies to,
   * not which write to it.
   */
  readonly expectedDraftId?: string;
}

/** Why a test cannot act on the draft a conversation shows. */
type ShownMessageDraftLookupFailureReason =
  | 'account_not_found'
  | 'bot_not_found'
  | 'draft_not_found'
  | 'draft_id_mismatch';

export type ExpireMessageDraftResult =
  | { readonly expired: true }
  | { readonly expired: false; readonly reason: ShownMessageDraftLookupFailureReason };

export type StopMessageDraftResult =
  | { readonly stopped: true }
  | {
    readonly stopped: false;
    readonly reason:
      | ShownMessageDraftLookupFailureReason
      | 'draft_not_stoppable'
      | 'draft_already_stopped';
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

interface ChatDomainEventPublisher {
  publish(event: ChatDomainEvent): void;
}

interface MessageDraftServiceDependencies {
  readonly accounts: AccountLookup;
  readonly bots: BotLookup;
  readonly drafts: MessageDraftStore;
  readonly events: ChatDomainEventPublisher;
}

/**
 * Keeps the message drafts that bots stream to accounts' private chats, as `MessageDraft`
 * describes them. Drafts are separate from the conversation's messages: showing, replacing,
 * clearing, expiring or stopping one never changes its history.
 *
 * Callers check that the bot may write to the account, and read the draft's text, before showing
 * it.
 */
export class MessageDraftService {
  readonly #accounts: AccountLookup;
  readonly #bots: BotLookup;
  readonly #drafts: MessageDraftStore;
  readonly #events: ChatDomainEventPublisher;

  constructor({ accounts, bots, drafts, events }: MessageDraftServiceDependencies) {
    this.#accounts = accounts;
    this.#bots = bots;
    this.#drafts = drafts;
    this.#events = events;
  }

  /**
   * Shows a draft the bot wrote in its private chat with the account. A draft with the shown
   * draft's ID changes it; one with another ID replaces it. A write after the account pressed Stop
   * shows a draft again, which the account can stop anew: the emulator lets a test see a bot that
   * keeps generating rather than refuse its late output.
   */
  showBotDraft(conversation: PrivateConversationKey, draft: WrittenMessageDraft): void {
    this.#drafts.showDraft(conversation, { ...draft, isStopped: false });
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
  expirePrivateMessageDraft(target: ShownMessageDraftTarget): ExpireMessageDraftResult {
    const lookup = this.#findShownDraft(target);
    if (!lookup.found) {
      return { expired: false, reason: lookup.reason };
    }
    this.#drafts.removeDraft(target);
    return { expired: true };
  }

  /**
   * Presses the Stop button of the draft an account's client shows, which asks the bot to stop
   * generating the message: the bot receives a `stopped_message_generation` update. The draft
   * disappears, unless the bot kept it with `keepOnStop`; a kept draft shows no Stop button, so it
   * cannot be stopped again. The emulator only tells the bot; ending the generation is the bot's.
   */
  stopPrivateMessageDraft(target: ShownMessageDraftTarget): StopMessageDraftResult {
    const lookup = this.#findShownDraft(target);
    if (!lookup.found) {
      return { stopped: false, reason: lookup.reason };
    }
    const { draft } = lookup;
    if (draft.isStopped) {
      return { stopped: false, reason: 'draft_already_stopped' };
    }
    if (!draft.canStop) {
      return { stopped: false, reason: 'draft_not_stoppable' };
    }
    if (draft.keepOnStop) {
      this.#drafts.showDraft(target, { ...draft, isStopped: true });
    } else {
      this.#drafts.removeDraft(target);
    }
    this.#events.publish({
      type: 'message_generation_stopped',
      accountId: target.accountId,
      botId: target.botId,
      draftId: draft.draftId,
    });
    return { stopped: true };
  }

  /** Finds the draft a test acts on, which must be the one it expects, if it names one. */
  #findShownDraft(
    { accountId, botId, expectedDraftId }: ShownMessageDraftTarget,
  ):
    | { readonly found: true; readonly draft: MessageDraft }
    | { readonly found: false; readonly reason: ShownMessageDraftLookupFailureReason } {
    const lookup = this.getPrivateMessageDraft({ accountId, botId });
    if (!lookup.found) {
      return lookup;
    }
    if (lookup.draft === undefined) {
      return { found: false, reason: 'draft_not_found' };
    }
    if (expectedDraftId !== undefined && lookup.draft.draftId !== expectedDraftId) {
      return { found: false, reason: 'draft_id_mismatch' };
    }
    return { found: true, draft: lookup.draft };
  }
}
