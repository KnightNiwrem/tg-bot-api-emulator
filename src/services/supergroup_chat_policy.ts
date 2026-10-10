import {
  resolveSupergroupBotMembership,
  type SupergroupBotAccessFailureReason,
  type SupergroupMembershipLookup,
} from '../types/chat_membership.ts';
import type {
  ChatIdentification,
  ChatMessageLookup,
  IdentifiedSupergroup,
  SupergroupAccessPredicates,
  SupergroupIdentityPolicy,
  SupergroupMembershipResolution,
} from '../types/chat_policy.ts';
import type {
  Supergroup,
  SupergroupChatAddress,
  SupergroupChatKey,
} from '../types/virtual_chat.ts';
import type { SupergroupMessage } from '../types/virtual_message.ts';

interface SupergroupMessageLookup {
  getMessageByChatMessageId(chatId: number, messageId: number): SupergroupMessage | undefined;
}

interface SupergroupChatPolicyDependencies {
  readonly sharedChats: SupergroupMembershipLookup;
  readonly supergroupMessages: SupergroupMessageLookup;
}

/**
 * How accounts and bots reach supergroups and their messages: identity, access predicates and
 * message lookup, read from the session's state. `supergroupMessagePolicy` states how supergroups
 * number their messages and who learns of their service messages.
 */
export class SupergroupChatPolicy
  implements
    SupergroupIdentityPolicy,
    SupergroupAccessPredicates,
    ChatMessageLookup<SupergroupChatKey, SupergroupMessage> {
  readonly #sharedChats: SupergroupMembershipLookup;
  readonly #supergroupMessages: SupergroupMessageLookup;

  constructor({ sharedChats, supergroupMessages }: SupergroupChatPolicyDependencies) {
    this.#sharedChats = sharedChats;
    this.#supergroupMessages = supergroupMessages;
  }

  identifyChatForAccount(
    _accountId: number,
    address: SupergroupChatAddress,
  ): ChatIdentification<IdentifiedSupergroup, 'chat_not_found'> {
    return this.#identifySupergroup(address);
  }

  identifyChatForBot(
    _botId: number,
    address: SupergroupChatAddress,
  ): ChatIdentification<IdentifiedSupergroup, 'chat_not_found'> {
    return this.#identifySupergroup(address);
  }

  resolveAccountMembership(
    accountId: number,
    supergroup: Supergroup,
  ): SupergroupMembershipResolution<'not_a_member'> {
    const membership = this.#sharedChats.getChatMembership(supergroup.id, accountId);
    return membership === undefined
      ? { member: false, reason: 'not_a_member' }
      : { member: true, membership };
  }

  resolveBotMembership(
    botId: number,
    supergroup: Supergroup,
  ): SupergroupMembershipResolution<SupergroupBotAccessFailureReason> {
    const resolution = resolveSupergroupBotMembership(this.#sharedChats, botId, supergroup.id);
    return resolution.resolved
      ? { member: true, membership: resolution.membership }
      : { member: false, reason: resolution.reason };
  }

  findMessageByChatMessageId(
    { chatId }: SupergroupChatKey,
    chatMessageId: number,
  ): SupergroupMessage | undefined {
    return this.#supergroupMessages.getMessageByChatMessageId(chatId, chatMessageId);
  }

  #identifySupergroup(
    { chatId }: SupergroupChatAddress,
  ): ChatIdentification<IdentifiedSupergroup, 'chat_not_found'> {
    const supergroup = this.#sharedChats.getSharedChat(chatId);
    return supergroup?.kind === 'supergroup'
      ? { identified: true, key: { type: 'supergroup', chatId }, supergroup }
      : { identified: false, reason: 'chat_not_found' };
  }
}
