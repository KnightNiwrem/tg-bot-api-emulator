import { type ChangeStaging, UNSTAGED_CHANGES } from '../transactions/change_staging.ts';
import { TransactionalMap } from '../transactions/transactional_collections.ts';
import type { CanonicalMessageId } from '../types/virtual_message.ts';

interface MessageBox {
  readonly messageIdsByCanonicalId: TransactionalMap<CanonicalMessageId, number>;
  readonly canonicalIdsByMessageId: TransactionalMap<number, CanonicalMessageId>;
}

/**
 * Assigns Telegram message IDs from message boxes, as Telegram numbers messages.
 *
 * Accounts and bots each own one common box. Private-chat and basic-group messages take the next
 * ID in the box of every participant they are delivered to, so one canonical message can have a
 * different Telegram message ID for each observer. Each supergroup owns a box of its own under its
 * chat ID, which numbers the supergroup's messages once for every member.
 */
export class MessageBoxRepository {
  readonly #staging: ChangeStaging;
  readonly #messageBoxesByOwnerId: TransactionalMap<number, MessageBox>;
  /** The ID each owner's box gives its next message; a box that numbered none gives 1. */
  readonly #nextMessageIdsByOwnerId: TransactionalMap<number, number>;

  /** `staging` decides how the repository's writes take part in its session's transactions. */
  constructor(staging: ChangeStaging = UNSTAGED_CHANGES) {
    this.#staging = staging;
    this.#messageBoxesByOwnerId = new TransactionalMap(staging);
    this.#nextMessageIdsByOwnerId = new TransactionalMap(staging);
  }

  /** Adds a canonical message to the owner's box and returns its Telegram message ID there. */
  assignMessageId(ownerId: number, canonicalMessageId: CanonicalMessageId): number {
    const messageBox = this.#getOrCreateMessageBox(ownerId);
    if (messageBox.messageIdsByCanonicalId.has(canonicalMessageId)) {
      throw new Error(
        `Message ${canonicalMessageId} already has a message ID in the box of ${ownerId}`,
      );
    }

    const messageId = this.#nextMessageIdsByOwnerId.get(ownerId) ?? 1;
    this.#nextMessageIdsByOwnerId.set(ownerId, messageId + 1);
    messageBox.messageIdsByCanonicalId.set(canonicalMessageId, messageId);
    messageBox.canonicalIdsByMessageId.set(messageId, canonicalMessageId);
    return messageId;
  }

  getMessageId(ownerId: number, canonicalMessageId: CanonicalMessageId): number | undefined {
    return this.#messageBoxesByOwnerId.get(ownerId)?.messageIdsByCanonicalId.get(
      canonicalMessageId,
    );
  }

  /** Resolves a Telegram message ID in the owner's box to the canonical message it numbers. */
  getCanonicalMessageId(ownerId: number, messageId: number): CanonicalMessageId | undefined {
    return this.#messageBoxesByOwnerId.get(ownerId)?.canonicalIdsByMessageId.get(messageId);
  }

  #getOrCreateMessageBox(ownerId: number): MessageBox {
    const existingMessageBox = this.#messageBoxesByOwnerId.get(ownerId);
    if (existingMessageBox !== undefined) {
      return existingMessageBox;
    }

    const messageBox: MessageBox = {
      messageIdsByCanonicalId: new TransactionalMap(this.#staging),
      canonicalIdsByMessageId: new TransactionalMap(this.#staging),
    };
    this.#messageBoxesByOwnerId.set(ownerId, messageBox);
    return messageBox;
  }
}
