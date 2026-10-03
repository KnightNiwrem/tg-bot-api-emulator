import {
  type ChatInviteLink,
  createInviteLinkHash,
  INVITE_LINK_PREFIX,
} from '../types/chat_invite_link.ts';

/** A new invite link, before the repository issues its URL. */
export type NewChatInviteLink = Omit<ChatInviteLink, 'url' | 'hasExpired'>;

/**
 * Stores the invite links of a session's chats, each under a URL no other link of the session
 * has, so that a link of one session is unknown to every other.
 */
export class ChatInviteLinkRepository {
  readonly #linksByUrl = new Map<string, ChatInviteLink>();
  readonly #linkUrlsByChatId = new Map<number, string[]>();

  /** Stores a new link under a URL with a random hash that no link of the session has. */
  createInviteLink(newLink: NewChatInviteLink): ChatInviteLink {
    let url: string;
    do {
      url = `${INVITE_LINK_PREFIX}${createInviteLinkHash()}`;
    } while (this.#linksByUrl.has(url));

    const link: ChatInviteLink = { ...newLink, url, hasExpired: false };
    this.#linksByUrl.set(url, link);
    const chatLinkUrls = this.#linkUrlsByChatId.get(link.chatId) ?? [];
    chatLinkUrls.push(url);
    this.#linkUrlsByChatId.set(link.chatId, chatLinkUrls);
    return link;
  }

  findInviteLink(url: string): ChatInviteLink | undefined {
    return this.#linksByUrl.get(url);
  }

  /** Returns a chat's invite links in the order they were created. */
  listChatInviteLinks(chatId: number): readonly ChatInviteLink[] {
    return (this.#linkUrlsByChatId.get(chatId) ?? []).map((url) => {
      const link = this.#linksByUrl.get(url);
      if (link === undefined) {
        throw new Error(`Invite link ${url} of chat ${chatId} is not stored`);
      }
      return link;
    });
  }

  /** Records that a link's expiry date arrived; returns the expired link. */
  markInviteLinkExpired(url: string): ChatInviteLink {
    const link = this.#linksByUrl.get(url);
    if (link === undefined) {
      throw new Error(`Invite link ${url} is not stored`);
    }
    const expiredLink: ChatInviteLink = { ...link, hasExpired: true };
    this.#linksByUrl.set(url, expiredLink);
    return expiredLink;
  }
}
