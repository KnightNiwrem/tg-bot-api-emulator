/**
 * A user's pending request to join a supergroup, sent through an invite link that creates join
 * requests, which waits until an administrator approves or declines it. A user has at most one
 * pending request per chat, as Telegram addresses a request by its chat and user.
 */
export interface ChatJoinRequest {
  readonly chatId: number;
  /** The account that wants to join. */
  readonly userId: number;
  /** The invite link the request was sent through. */
  readonly inviteLinkUrl: string;
  readonly requestedAtUnixSeconds: number;
  /**
   * The administrator bots that held `can_invite_users` when the request was sent, which receive
   * it, in the order of the chat's members.
   */
  readonly recipientBotIds: readonly number[];
  /** Which recipient bots may write to the user before it starts a private chat with them. */
  readonly requesterContact: JoinRequesterContact;
}

/**
 * The temporary permission to write to a join request's user that the Bot API documents for
 * `user_chat_id`: a bot that received the request may send the user messages until the request
 * is processed, assuming no other administrator contacted the user. The permission ends with the
 * request; the emulator never lets its five minutes pass by themselves, so a test expires it.
 */
export type JoinRequesterContact =
  /** Every recipient bot may write; the first to write claims the contact. */
  | { readonly status: 'open' }
  /** A recipient bot wrote to the user, so only that bot may write further. */
  | { readonly status: 'claimed'; readonly claimantBotId: number }
  /** A test made the contact window end, so no bot may write under it any more. */
  | { readonly status: 'expired' };
