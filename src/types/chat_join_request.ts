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
}
