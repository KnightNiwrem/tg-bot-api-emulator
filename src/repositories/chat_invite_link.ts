import {
  type ChatInviteLink,
  type ChatInviteLinkSettings,
  createInviteLinkHash,
  INVITE_LINK_PREFIX,
} from '../types/chat_invite_link.ts';

/** A new additional invite link, before the repository issues its URL. */
export type NewChatInviteLink = Omit<
  ChatInviteLink,
  'url' | 'isPrimary' | 'hasExpired' | 'isRevoked'
>;

/** An administrator's new primary link of a chat, before the repository issues its URL. */
export interface NewPrimaryChatInviteLink {
  readonly chatId: number;
  readonly creatorId: number;
  readonly createdAtUnixSeconds: number;
}

/** The primary link a replacement revoked, if the administrator had one, and its replacement. */
export interface PrimaryChatInviteLinkReplacement {
  readonly revokedLink?: ChatInviteLink;
  readonly primaryLink: ChatInviteLink;
}

/**
 * Stores the invite links of a session's chats, each under a URL no other link of the session
 * has, so that a link of one session is unknown to every other. It keeps revoked links, and at
 * most one primary link per chat and administrator that is not revoked.
 */
export class ChatInviteLinkRepository {
  readonly #linksByUrl = new Map<string, ChatInviteLink>();
  readonly #linkUrlsByChatId = new Map<number, string[]>();

  /**
   * Stores a new additional link under a URL with a random hash that no link of the session has.
   */
  createInviteLink(newLink: NewChatInviteLink): ChatInviteLink {
    return this.#storeNewInviteLink({ ...newLink, isPrimary: false });
  }

  /**
   * Revokes an administrator's primary link of a chat, if it has one, and stores a new primary
   * link in its place, in one step, so that the administrator never has two.
   */
  replacePrimaryInviteLink(
    { chatId, creatorId, createdAtUnixSeconds }: NewPrimaryChatInviteLink,
  ): PrimaryChatInviteLinkReplacement {
    const currentLink = this.findPrimaryInviteLink(chatId, creatorId);
    const revokedLink = currentLink === undefined
      ? undefined
      : this.#replaceInviteLink({ ...currentLink, isRevoked: true });
    const primaryLink = this.#storeNewInviteLink({
      chatId,
      creatorId,
      createdAtUnixSeconds,
      isPrimary: true,
      createsJoinRequest: false,
    });
    return { ...(revokedLink === undefined ? {} : { revokedLink }), primaryLink };
  }

  findInviteLink(url: string): ChatInviteLink | undefined {
    return this.#linksByUrl.get(url);
  }

  /** Finds an administrator's primary link of a chat that is not revoked. */
  findPrimaryInviteLink(chatId: number, creatorId: number): ChatInviteLink | undefined {
    return this.listChatInviteLinks(chatId).find((link) =>
      link.isPrimary && !link.isRevoked && link.creatorId === creatorId
    );
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
    return this.#replaceInviteLink({ ...this.#getInviteLink(url), hasExpired: true });
  }

  /**
   * Replaces all of a link's settings, keeping its URL, chat, creator, creation date and
   * revocation. The link's new expiry date, if any, has not arrived, whether or not a test made
   * the previous one arrive. Returns the edited link.
   */
  replaceInviteLinkSettings(url: string, settings: ChatInviteLinkSettings): ChatInviteLink {
    const { chatId, creatorId, createdAtUnixSeconds, isRevoked } = this.#getAdditionalInviteLink(
      url,
    );
    return this.#replaceInviteLink({
      url,
      chatId,
      creatorId,
      createdAtUnixSeconds,
      isPrimary: false,
      ...settings,
      hasExpired: false,
      isRevoked,
    });
  }

  /**
   * Records that an additional link was revoked; returns the revoked link. A primary link is
   * revoked only by `replacePrimaryInviteLink`.
   */
  markInviteLinkRevoked(url: string): ChatInviteLink {
    return this.#replaceInviteLink({ ...this.#getAdditionalInviteLink(url), isRevoked: true });
  }

  #storeNewInviteLink(
    newLink: Omit<ChatInviteLink, 'url' | 'hasExpired' | 'isRevoked'>,
  ): ChatInviteLink {
    let url: string;
    do {
      url = `${INVITE_LINK_PREFIX}${createInviteLinkHash()}`;
    } while (this.#linksByUrl.has(url));

    const link: ChatInviteLink = { ...newLink, url, hasExpired: false, isRevoked: false };
    this.#linksByUrl.set(url, link);
    const chatLinkUrls = this.#linkUrlsByChatId.get(link.chatId) ?? [];
    chatLinkUrls.push(url);
    this.#linkUrlsByChatId.set(link.chatId, chatLinkUrls);
    return link;
  }

  #getInviteLink(url: string): ChatInviteLink {
    const link = this.#linksByUrl.get(url);
    if (link === undefined) {
      throw new Error(`Invite link ${url} is not stored`);
    }
    return link;
  }

  #getAdditionalInviteLink(url: string): ChatInviteLink {
    const link = this.#getInviteLink(url);
    if (link.isPrimary) {
      throw new Error(`Invite link ${url} is a primary link`);
    }
    return link;
  }

  #replaceInviteLink(link: ChatInviteLink): ChatInviteLink {
    this.#linksByUrl.set(link.url, link);
    return link;
  }
}
