import type { MessageDraft } from '../types/message_draft.ts';
import type { PrivateConversationKey } from '../types/virtual_chat.ts';

/** Stores the message draft each private conversation's client shows: at most one per conversation. */
export class MessageDraftRepository {
  readonly #draftsByConversationKey = new Map<string, MessageDraft>();

  /** Shows the draft in the conversation, in place of any draft it showed. */
  showDraft(conversation: PrivateConversationKey, draft: MessageDraft): void {
    this.#draftsByConversationKey.set(serializeConversationKey(conversation), { ...draft });
  }

  /** Removes the conversation's draft, if it shows one. */
  removeDraft(conversation: PrivateConversationKey): void {
    this.#draftsByConversationKey.delete(serializeConversationKey(conversation));
  }

  /** Returns the draft the conversation shows, or `undefined` for none. */
  getDraft(conversation: PrivateConversationKey): MessageDraft | undefined {
    return this.#draftsByConversationKey.get(serializeConversationKey(conversation));
  }
}

function serializeConversationKey({ accountId, botId }: PrivateConversationKey): string {
  return `${accountId}:${botId}`;
}
