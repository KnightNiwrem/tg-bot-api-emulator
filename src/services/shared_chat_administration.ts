import type {
  BasicGroupRegistrationResult,
  ChatMemberAdditionResult,
  ChatMemberRemovalResult,
  ChatMemberStatusUpdateResult,
  CustomTitleUpdateResult,
  FormerMemberStatusUpdateResult,
  JoiningMemberStatus,
  NonOwnerMemberStatus,
  SharedChatRegistrationResult,
} from '../repositories/shared_chat.ts';
import type {
  IdentityReservationResult,
  TelegramIdentity,
} from '../repositories/telegram_identity.ts';
import {
  cleanInputString,
  cleanName,
  stripEmptyCharacters,
} from '../text_entities/input_string.ts';
import type { ChatDomainEvent } from '../types/chat_domain_event.ts';
import {
  type AdministratorMembership,
  type AdministratorTenureId,
  canEditSupergroupAdministrator,
  type ChatMembership,
  type ChatMemberStatus,
  createRestrictedStatus,
  type CustomTitleViolation,
  findCustomTitleViolation,
  type FormerChatMemberStatus,
  getEffectiveChatPermissions,
  getSupergroupNonMemberFailureReason,
  holdsSupergroupAdministratorRight,
  isAdministratorPromotedBy,
  isChatMember,
  isSameChatMemberStatus,
  isSameSupergroupAdministratorRights,
  LEFT_CHAT_MEMBER_STATUS,
  MAX_CUSTOM_TITLE_LENGTH,
  resolveSupergroupBotMembership,
  type SupergroupAdministratorRights,
  type SupergroupBotAccessFailureReason,
  type SupergroupMembershipReader,
} from '../types/chat_membership.ts';
import {
  ALL_CHAT_PERMISSIONS,
  type ChatPermissions,
  isSameChatPermissions,
} from '../types/chat_permissions.ts';
import type { VirtualAccount } from '../types/virtual_account.ts';
import type { VirtualBot } from '../types/virtual_bot.ts';
import {
  type BasicGroup,
  type Channel,
  createChatInstance,
  type SharedChat,
  type Supergroup,
} from '../types/virtual_chat.ts';
import type {
  SupergroupMessageAuthor,
  SupergroupServiceContent,
} from '../types/virtual_message.ts';

export interface CreateBasicGroupInput {
  readonly title: string;
  readonly creatorAccountId: number;
  readonly initialMemberIds: readonly number[];
}

type BasicGroupParticipantValidationFailureReason =
  | 'creator_account_not_found'
  | 'initial_member_not_found'
  | 'initial_members_not_unique';

export type BasicGroupCreationFailureReason =
  | BasicGroupParticipantValidationFailureReason
  | 'identity_limit_reached';

export type BasicGroupCreationResult =
  | {
    readonly created: true;
    readonly group: BasicGroup;
  }
  | {
    readonly created: false;
    readonly reason: BasicGroupCreationFailureReason;
  };

export interface CreateSupergroupInput {
  readonly title: string;
  /** Makes the supergroup public under this username; omitted for a private supergroup. */
  readonly username?: string;
  readonly description?: string;
  readonly creatorAccountId: number;
}

export type SupergroupCreationFailureReason =
  | 'creator_account_not_found'
  | 'username_taken'
  | 'identity_limit_reached';

export type SupergroupCreationResult =
  | {
    readonly created: true;
    readonly supergroup: Supergroup;
  }
  | {
    readonly created: false;
    readonly reason: SupergroupCreationFailureReason;
  };

export interface CreateChannelInput {
  readonly title: string;
  readonly description?: string;
  readonly creatorAccountId: number;
}

export type ChannelCreationFailureReason =
  | 'creator_account_not_found'
  | 'identity_limit_reached';

export type ChannelCreationResult =
  | {
    readonly created: true;
    readonly channel: Channel;
  }
  | {
    readonly created: false;
    readonly reason: ChannelCreationFailureReason;
  };

export interface AddChatMemberInput {
  readonly actorAccountId: number;
  readonly chatId: number;
  readonly memberId: number;
}

export type AddChatMemberFailureReason =
  | 'actor_account_not_found'
  | 'chat_not_found'
  | 'actor_not_authorized'
  | 'member_not_found'
  | 'bot_not_permitted_in_channel'
  | 'member_already_present';

export type AddChatMemberResult =
  | { readonly added: true }
  | {
    readonly added: false;
    readonly reason: AddChatMemberFailureReason;
  };

export interface LeaveChatInput {
  /** The account or bot that leaves. */
  readonly memberId: number;
  readonly chatId: number;
}

export type LeaveChatFailureReason =
  | 'member_not_found'
  | 'chat_not_found'
  | 'not_a_member'
  | 'owner_cannot_leave';

export type LeaveChatResult =
  | { readonly left: true }
  | {
    readonly left: false;
    readonly reason: LeaveChatFailureReason;
    /** How the membership ended, for a former member; omitted for a user that never joined. */
    readonly formerStatus?: FormerChatMemberStatus;
  };

export interface RemoveChatMemberInput {
  readonly actorAccountId: number;
  readonly chatId: number;
  readonly memberId: number;
}

export type RemoveChatMemberFailureReason =
  | 'actor_account_not_found'
  | 'chat_not_found'
  | 'actor_not_authorized'
  | 'member_not_found'
  | 'not_a_member'
  | 'member_is_owner';

export type RemoveChatMemberResult =
  | { readonly removed: true }
  | {
    readonly removed: false;
    readonly reason: RemoveChatMemberFailureReason;
  };

export interface PromoteChatMemberInput {
  /** The owner, who alone promotes administrators here. */
  readonly actorAccountId: number;
  readonly chatId: number;
  readonly memberId: number;
  /** The rights the administrator holds from now on, which must include at least one. */
  readonly rights: SupergroupAdministratorRights;
}

/** Why the owner of a supergroup cannot manage one of its members. */
type OwnerMemberManagementFailureReason =
  | 'actor_account_not_found'
  | 'chat_not_found'
  | 'actor_not_authorized'
  | 'member_not_found'
  | 'not_a_member';

export type ChatMemberRoleChangeFailureReason =
  | OwnerMemberManagementFailureReason
  | 'member_is_owner';

export type PromoteChatMemberFailureReason =
  | ChatMemberRoleChangeFailureReason
  | 'no_rights_granted';

export type PromoteChatMemberResult =
  | { readonly promoted: true }
  | { readonly promoted: false; readonly reason: PromoteChatMemberFailureReason };

export interface SetCustomTitleInput {
  /** The owner, who alone sets custom titles here. */
  readonly actorAccountId: number;
  readonly chatId: number;
  /** The owner itself or an administrator. */
  readonly memberId: number;
  /** The new title, before Telegram cleans it; empty removes it. */
  readonly customTitle: string;
}

/** Why a custom title is refused: Telegram cannot read it, or its servers refuse it. */
type CustomTitleRefusal = 'text_encoding_invalid' | `custom_title_${CustomTitleViolation}`;

export type SetCustomTitleResult =
  | { readonly set: true }
  | {
    readonly set: false;
    readonly reason:
      | OwnerMemberManagementFailureReason
      | 'not_an_administrator'
      | CustomTitleRefusal;
  };

export interface SetCustomTitleAsBotInput {
  readonly actorBotId: number;
  readonly chatId: number;
  /** An administrator the bot may edit. */
  readonly memberId: number;
  /** The new title, before Telegram cleans it; empty removes it. */
  readonly customTitle: string;
}

/**
 * Why a bot cannot set an administrator's custom title, in the order the official Bot API server
 * and then Telegram check them.
 */
export type SetCustomTitleAsBotFailureReason =
  | 'bot_not_found'
  | SupergroupBotAccessFailureReason
  | 'member_not_found'
  /** The owner alone sets its own title. */
  | 'member_is_owner'
  | 'member_is_not_administrator'
  /** The bot may not edit the administrator, as `canEditSupergroupAdministrator` decides. */
  | 'custom_title_not_editable'
  | CustomTitleRefusal;

export type SetCustomTitleAsBotResult =
  | { readonly set: true }
  | { readonly set: false; readonly reason: SetCustomTitleAsBotFailureReason };

export interface SetContentProtectionInput {
  /** The owner, who alone restricts saving content. */
  readonly actorAccountId: number;
  readonly chatId: number;
  readonly hasProtectedContent: boolean;
}

export type SetContentProtectionResult =
  | { readonly set: true }
  | {
    readonly set: false;
    readonly reason: 'actor_account_not_found' | 'chat_not_found' | 'actor_not_authorized';
  };

/** The most characters of a chat's title, which TDLib keeps and Telegram's servers accept. */
const MAX_CHAT_TITLE_LENGTH = 128;

/** The most characters of a chat's description, which TDLib keeps and Telegram's servers accept. */
const MAX_CHAT_DESCRIPTION_LENGTH = 255;

export interface ChangeSupergroupTitleInput {
  /** The account or bot that changes the title, which the service message names. */
  readonly actor: SupergroupMessageAuthor;
  readonly chatId: number;
  /** The title as the actor specified it, before Telegram cleans it. */
  readonly title: string;
}

export interface ChangeSupergroupDescriptionInput {
  /** The account or bot that changes the description. */
  readonly actor: SupergroupMessageAuthor;
  readonly chatId: number;
  /** The description as the actor specified it, before Telegram cleans it; empty removes it. */
  readonly description: string;
}

/** Why an account or a bot cannot change a supergroup's information, in TDLib's order. */
type SupergroupInfoChangeFailureReason =
  | 'actor_not_found'
  | SupergroupBotAccessFailureReason
  /** The actor is an account that is not a member of the supergroup. */
  | 'not_a_member'
  /** The text is not well-formed Unicode, which Telegram rejects as not encoded in UTF-8. */
  | 'text_encoding_invalid'
  /** The actor may not change the supergroup's information, as `canChangeSupergroupInfo` decides. */
  | 'not_enough_rights';

export type ChangeSupergroupTitleResult =
  | { readonly changed: true }
  | {
    readonly changed: false;
    readonly reason: SupergroupInfoChangeFailureReason | 'title_empty';
  };

export type ChangeSupergroupDescriptionResult =
  | { readonly changed: true }
  | {
    readonly changed: false;
    readonly reason: SupergroupInfoChangeFailureReason | 'description_not_modified';
  };

export interface ChangeDefaultPermissionsInput {
  /** The account or bot that changes what members may do by default. */
  readonly actor: SupergroupMessageAuthor;
  readonly chatId: number;
  /** What members may do from now on, unless a restriction of their own withholds more. */
  readonly permissions: ChatPermissions;
}

export type ChangeDefaultPermissionsResult =
  | { readonly changed: true }
  | {
    readonly changed: false;
    readonly reason:
      | 'actor_not_found'
      | SupergroupBotAccessFailureReason
      /** The actor is an account that is not a member of the supergroup. */
      | 'not_a_member'
      /** The actor lacks the `can_restrict_members` administrator right. */
      | 'not_enough_rights';
  };

export interface DemoteChatMemberInput {
  /** The owner, who alone demotes administrators here. */
  readonly actorAccountId: number;
  readonly chatId: number;
  readonly memberId: number;
}

export type DemoteChatMemberResult =
  | { readonly demoted: true }
  | { readonly demoted: false; readonly reason: ChatMemberRoleChangeFailureReason };

export interface BanChatMemberInput {
  readonly actorBotId: number;
  readonly chatId: number;
  /** The account or bot to ban, whether it is a member or not. */
  readonly memberId: number;
  /**
   * When the ban ends, as the bot requested it; omitted for a ban that lasts until it is lifted.
   * As on Telegram, a ban shorter than 30 seconds or longer than 366 days lasts until it is lifted.
   */
  readonly requestedBanEndUnixSeconds?: number;
}

/** Why a bot cannot ban a user or lift its ban, in the order Telegram checks them. */
export type BotModerationFailureReason =
  | 'bot_not_found'
  | SupergroupBotAccessFailureReason
  | 'cannot_restrict_self'
  | 'member_not_found'
  | 'member_is_owner'
  | 'not_enough_rights'
  | 'member_is_administrator';

export type BanChatMemberResult =
  | { readonly banned: true }
  | { readonly banned: false; readonly reason: BotModerationFailureReason };

export interface RestrictChatMemberInput {
  readonly actorBotId: number;
  readonly chatId: number;
  /** The account or bot to restrict, whether it is a member or not. */
  readonly memberId: number;
  /** The permissions the user keeps; keeping every permission lifts its restriction. */
  readonly permissions: ChatPermissions;
  /**
   * When the restriction ends, as the bot requested it; omitted for one that lasts until it is
   * lifted. It is normalized as a ban's end is.
   */
  readonly requestedRestrictionEndUnixSeconds?: number;
}

/** Why a bot cannot restrict a user or lift its restriction, in the order TDLib checks them. */
export type RestrictChatMemberFailureReason =
  | BotModerationFailureReason
  /** The bot would lift its own restriction. */
  | 'cannot_unrestrict_self'
  /**
   * The bot would make an administrator a plain member, which TDLib's
   * `promote_channel_participant` allows only with the `can_promote_members` right.
   */
  | 'not_enough_rights_to_promote';

export type RestrictChatMemberResult =
  | { readonly restricted: true }
  | { readonly restricted: false; readonly reason: RestrictChatMemberFailureReason };

export interface PromoteChatMemberAsBotInput {
  readonly actorBotId: number;
  readonly chatId: number;
  /** The account or bot to promote, change the rights of, or demote. */
  readonly memberId: number;
  /** The rights the user holds from now on; none demotes an administrator to a member. */
  readonly rights: SupergroupAdministratorRights;
}

/**
 * Why a bot cannot promote a user, change an administrator's rights, or demote one, in the order
 * TDLib and then Telegram's servers check them.
 */
export type PromoteChatMemberAsBotFailureReason =
  | 'bot_not_found'
  | SupergroupBotAccessFailureReason
  | 'member_not_found'
  | 'member_is_owner'
  /** The bot would make itself an administrator, or change its own rights. */
  | 'cannot_promote_self'
  /** The bot lacks `can_promote_members`, which TDLib's `promote_channel_participant` requires. */
  | 'not_enough_rights_to_promote'
  /** The user is not a member, which Telegram's servers refuse as `USER_NOT_MUTUAL_CONTACT`. */
  | 'member_not_in_chat'
  /** The user is banned, which Telegram's servers refuse as `USER_KICKED`. */
  | 'member_kicked'
  /** The user is an administrator the bot did not promote, directly or indirectly. */
  | 'member_is_administrator'
  /** The bot would grant a right it does not hold, which Telegram refuses as `RIGHT_FORBIDDEN`. */
  | 'rights_not_held'
  /**
   * Demoting a user that is not a member would add it, which TDLib's `add_channel_participant`
   * refuses to bots.
   */
  | 'bots_cannot_add_members'
  /** Demoting a restricted or banned user lifts its restriction, which needs this right. */
  | 'not_enough_rights'
  /** The bot would lift its own restriction. */
  | 'cannot_unrestrict_self';

export type PromoteChatMemberAsBotResult =
  | { readonly promoted: true }
  | { readonly promoted: false; readonly reason: PromoteChatMemberAsBotFailureReason };

/** The checks of a bot's promotion that its target can fail once TDLib let the bot change it. */
type BotPromotionFailureReason = Extract<
  PromoteChatMemberAsBotFailureReason,
  | 'cannot_promote_self'
  | 'not_enough_rights_to_promote'
  | 'member_not_in_chat'
  | 'member_kicked'
  | 'member_is_administrator'
  | 'rights_not_held'
>;

export interface RestrictChatMemberAsOwnerInput {
  /** The owner, who alone restricts users through the emulation API. */
  readonly actorAccountId: number;
  readonly chatId: number;
  /** The account or bot to restrict, whether it is a member or not. */
  readonly memberId: number;
  /** As `RestrictChatMemberInput` describes it. */
  readonly permissions: ChatPermissions;
  /** As `RestrictChatMemberInput` describes it. */
  readonly requestedRestrictionEndUnixSeconds?: number;
}

export interface LiftRestrictionAsOwnerInput {
  /** The owner, who alone lifts restrictions through the emulation API. */
  readonly actorAccountId: number;
  readonly chatId: number;
  readonly memberId: number;
}

/** Why the owner cannot restrict a user of its supergroup, or lift the user's restriction. */
export type OwnerRestrictionFailureReason =
  | 'actor_account_not_found'
  | 'chat_not_found'
  | 'actor_not_authorized'
  | 'member_not_found'
  | 'member_is_owner';

export type OwnerRestrictionResult =
  | { readonly changed: true }
  | { readonly changed: false; readonly reason: OwnerRestrictionFailureReason };

export interface ExpireRestrictionInput {
  readonly chatId: number;
  readonly memberId: number;
}

export type ExpireRestrictionResult =
  | { readonly expired: true; readonly status: ChatMemberStatus }
  | {
    readonly expired: false;
    readonly reason:
      | 'chat_not_found'
      | 'member_not_found'
      /** The user is not restricted, or its restriction lasts until it is lifted. */
      | 'restriction_not_temporary';
  };

export interface UnbanChatMemberInput {
  readonly actorBotId: number;
  readonly chatId: number;
  readonly memberId: number;
  /** Changes nothing unless the user is banned; otherwise a member is removed, as Telegram does. */
  readonly onlyIfBanned: boolean;
}

export type UnbanChatMemberResult =
  | { readonly unbanned: true }
  | {
    readonly unbanned: false;
    readonly reason: Exclude<BotModerationFailureReason, 'cannot_restrict_self'>;
  };

export interface ChatMemberQueryInput {
  /** The bot that asks, which must be a member of the supergroup. */
  readonly observerBotId: number;
  readonly chatId: number;
}

export interface GetChatMemberStatusInput extends ChatMemberQueryInput {
  readonly userId: number;
}

export type GetChatMemberStatusResult =
  | { readonly found: true; readonly status: ChatMemberStatus }
  | {
    readonly found: false;
    readonly reason: 'bot_not_found' | SupergroupBotAccessFailureReason | 'member_not_found';
  };

/** A current member of a chat with its standing. */
export interface ChatMemberStanding {
  readonly userId: number;
  readonly status: ChatMembership;
}

export type GetChatAdministratorsResult =
  | {
    readonly found: true;
    /** The owner, then the administrators in the order they joined. */
    readonly administrators: readonly ChatMemberStanding[];
  }
  | { readonly found: false; readonly reason: 'bot_not_found' | SupergroupBotAccessFailureReason };

export interface GetAdministratorsForAccountInput {
  /** The account that inspects the supergroup, which must be a member of it. */
  readonly observerAccountId: number;
  readonly chatId: number;
}

/** The owner or an administrator of a supergroup, as a member account inspects it. */
export interface AdministratorStandingForAccount {
  readonly userId: number;
  readonly status: Extract<ChatMembership, { status: 'owner' }> | AdministratorMembership;
  /**
   * Whether the observing account may change the administrator's rights or demote it, as
   * `canEditSupergroupAdministrator` decides; nobody edits the owner.
   */
  readonly canBeEdited: boolean;
}

export type GetAdministratorsForAccountResult =
  | {
    readonly found: true;
    /** The owner, then the administrators in the order they joined. */
    readonly administrators: readonly AdministratorStandingForAccount[];
  }
  | {
    readonly found: false;
    readonly reason: 'account_not_found' | 'chat_not_found' | 'not_a_member';
  };

export type GetChatMemberCountResult =
  | { readonly found: true; readonly memberCount: number }
  | { readonly found: false; readonly reason: 'bot_not_found' | SupergroupBotAccessFailureReason };

export type GetReadableSupergroupResult =
  | { readonly found: true; readonly supergroup: Supergroup }
  | { readonly found: false; readonly reason: 'bot_not_found' | SupergroupBotAccessFailureReason };

/** A bot moderating a supergroup it is a member of, and the user it moderates. */
interface ModerationTarget {
  readonly chat: Supergroup;
  readonly botId: number;
  readonly botMembership: ChatMembership;
  readonly memberId: number;
  readonly memberStatus: ChatMemberStatus;
}

/** A ban of a member that the bot lifts at once, which is how Telegram removes a member. */
const MEMBER_REMOVAL_BAN_DURATION_SECONDS = 60;

/** Telegram treats a ban or restriction shorter than this as one that lasts until it is lifted. */
const MIN_TEMPORARY_STATUS_DURATION_SECONDS = 30;

/** Telegram treats a ban or restriction longer than this as one that lasts until it is lifted. */
const MAX_TEMPORARY_STATUS_DURATION_SECONDS = 366 * 24 * 60 * 60;

interface AccountLookup {
  getById(accountId: number): VirtualAccount | undefined;
}

interface BotLookup {
  getById(botId: number): VirtualBot | undefined;
}

interface SharedChatIdentityReservationStore {
  reserveIdentity(
    input: { readonly kind: SharedChat['kind']; readonly username?: string },
  ): IdentityReservationResult;
  getByUsername(username: string): TelegramIdentity | undefined;
}

interface BasicGroupStore {
  registerBasicGroup(
    group: BasicGroup,
    ownerAccountId: number,
    initialMemberIds: readonly number[],
  ): BasicGroupRegistrationResult;
}

interface OwnerOnlySharedChatStore {
  registerSupergroup(
    supergroup: Supergroup,
    ownerAccountId: number,
  ): SharedChatRegistrationResult;

  registerChannel(
    channel: Channel,
    ownerAccountId: number,
  ): SharedChatRegistrationResult;
}

interface ChatMembershipStore {
  issueAdministratorTenureId(): AdministratorTenureId;
  getSharedChat(chatId: number): SharedChat | undefined;
  getChatMembership(chatId: number, identityId: number): ChatMembership | undefined;
  getFormerMemberStatus(chatId: number, identityId: number): FormerChatMemberStatus | undefined;
  getChatMemberIds(chatId: number): readonly number[];
  addChatMember(
    chatId: number,
    memberId: number,
    membership: JoiningMemberStatus,
  ): ChatMemberAdditionResult;
  updateChatMemberStatus(
    chatId: number,
    memberId: number,
    status: NonOwnerMemberStatus,
  ): ChatMemberStatusUpdateResult;
  setCustomTitle(
    chatId: number,
    memberId: number,
    customTitle: string | undefined,
  ): CustomTitleUpdateResult;
  updateSupergroupInfo(
    chatId: number,
    info: { readonly title?: string; readonly description?: string },
  ): boolean;
  updateSupergroupContentProtection(chatId: number, hasProtectedContent: boolean): boolean;
  updateSupergroupDefaultPermissions(chatId: number, defaultPermissions: ChatPermissions): boolean;
  removeChatMember(
    chatId: number,
    memberId: number,
    formerStatus: FormerChatMemberStatus,
  ): ChatMemberRemovalResult;
  updateFormerMemberStatus(
    chatId: number,
    identityId: number,
    formerStatus: FormerChatMemberStatus,
  ): FormerMemberStatusUpdateResult;
}

type SharedChatStore =
  & BasicGroupStore
  & OwnerOnlySharedChatStore
  & ChatMembershipStore;

interface ChatDomainEventSink {
  publish(event: ChatDomainEvent): void;
}

interface SupergroupServiceMessageRecorder {
  recordServiceMessage(input: {
    readonly chatId: number;
    readonly author: SupergroupMessageAuthor;
    readonly content: SupergroupServiceContent;
    readonly changedAtUnixSeconds: number;
  }): void;
}

interface SharedChatAdministrationServiceDependencies {
  readonly identities: SharedChatIdentityReservationStore;
  readonly accounts: AccountLookup;
  readonly bots: BotLookup;
  readonly sharedChats: SharedChatStore;
  readonly supergroupMessages: SupergroupServiceMessageRecorder;
  readonly events: ChatDomainEventSink;
  readonly currentUnixTimeSeconds: () => number;
}

/**
 * The tenure of an administrator bot that promotes someone. Only the owner, which no bot is,
 * promotes without a tenure.
 */
function getAdministratorTenureId(
  promoterId: number,
  promoterMembership: ChatMembership,
): AdministratorTenureId {
  if (promoterMembership.status !== 'administrator') {
    throw new Error(`User ${promoterId} promotes someone without being an administrator`);
  }
  return promoterMembership.tenureId;
}

/**
 * Whether a member may change a supergroup's title and description, as TDLib's
 * `can_change_info_and_settings` decides once `apply_restrictions` applies the supergroup's default
 * permissions, which `getEffectiveChatPermissions` does: the owner may, an administrator with
 * `can_change_info` may, and so may an account that the default permissions, and its restriction,
 * if any, let change it. A bot gets no such permission from default permissions, so it needs the
 * administrator right.
 */
function canChangeSupergroupInfo(
  supergroup: Supergroup,
  actor: SupergroupMessageAuthor,
  membership: ChatMembership,
): boolean {
  return getEffectiveChatPermissions(membership, {
    defaultPermissions: supergroup.defaultPermissions,
    isBot: actor.kind === 'bot',
  }).has('can_change_info');
}

/**
 * Establishes and changes who takes part in basic groups, supergroups, and channels, and in what
 * standing: supergroup owners promote administrators, and administrator bots ban users. Each
 * change of a standing is published, so that a bot learns of changes of its own, and a member's
 * arrival or departure is recorded in a supergroup as a service message, as Telegram does. Service
 * messages of basic groups and channels, whose messages are not supported, are not recorded.
 *
 * Members and bots also change a supergroup's title and description here, and a new title is
 * recorded as a service message too. Bots also read the standing of a supergroup's users here, as
 * a member of the supergroup.
 */
export class SharedChatAdministrationService {
  readonly #identities: SharedChatIdentityReservationStore;
  readonly #accounts: AccountLookup;
  readonly #bots: BotLookup;
  readonly #sharedChats: SharedChatStore;
  readonly #supergroupMessages: SupergroupServiceMessageRecorder;
  readonly #events: ChatDomainEventSink;
  readonly #currentUnixTimeSeconds: () => number;

  constructor(
    {
      identities,
      accounts,
      bots,
      sharedChats,
      supergroupMessages,
      events,
      currentUnixTimeSeconds,
    }: SharedChatAdministrationServiceDependencies,
  ) {
    this.#identities = identities;
    this.#accounts = accounts;
    this.#bots = bots;
    this.#sharedChats = sharedChats;
    this.#supergroupMessages = supergroupMessages;
    this.#events = events;
    this.#currentUnixTimeSeconds = currentUnixTimeSeconds;
  }

  createBasicGroup(input: CreateBasicGroupInput): BasicGroupCreationResult {
    const participantValidationFailure = this.#validateBasicGroupParticipants(input);
    if (participantValidationFailure !== undefined) {
      return { created: false, reason: participantValidationFailure };
    }

    const groupId = this.#reserveSharedChatId('basic_group');
    if (groupId === undefined) {
      return { created: false, reason: 'identity_limit_reached' };
    }
    const group: BasicGroup = {
      kind: 'basic_group',
      id: groupId,
      title: input.title,
    };
    const registration = this.#sharedChats.registerBasicGroup(
      group,
      input.creatorAccountId,
      input.initialMemberIds,
    );
    if (!registration.registered) {
      throw new Error(`Reserved basic group could not be registered: ${registration.reason}`);
    }

    return { created: true, group };
  }

  createSupergroup(input: CreateSupergroupInput): SupergroupCreationResult {
    if (this.#accounts.getById(input.creatorAccountId) === undefined) {
      return { created: false, reason: 'creator_account_not_found' };
    }

    const identityReservation = this.#identities.reserveIdentity({
      kind: 'supergroup',
      ...(input.username === undefined ? {} : { username: input.username }),
    });
    if (!identityReservation.reserved) {
      return { created: false, reason: identityReservation.reason };
    }
    if (identityReservation.identity.kind !== 'supergroup') {
      throw new Error('Supergroup identity reservation returned a different identity kind');
    }
    const supergroup: Supergroup = {
      kind: 'supergroup',
      id: identityReservation.identity.id,
      title: input.title,
      ...(input.username === undefined ? {} : { username: input.username }),
      description: input.description,
      chatInstance: createChatInstance(),
      hasProtectedContent: false,
      defaultPermissions: ALL_CHAT_PERMISSIONS,
    };
    const registration = this.#sharedChats.registerSupergroup(supergroup, input.creatorAccountId);
    if (!registration.registered) {
      throw new Error(`Reserved supergroup could not be registered: ${registration.reason}`);
    }

    return { created: true, supergroup };
  }

  createChannel(input: CreateChannelInput): ChannelCreationResult {
    if (this.#accounts.getById(input.creatorAccountId) === undefined) {
      return { created: false, reason: 'creator_account_not_found' };
    }

    const channelId = this.#reserveSharedChatId('channel');
    if (channelId === undefined) {
      return { created: false, reason: 'identity_limit_reached' };
    }
    const channel: Channel = {
      kind: 'channel',
      id: channelId,
      title: input.title,
      description: input.description,
    };
    const registration = this.#sharedChats.registerChannel(channel, input.creatorAccountId);
    if (!registration.registered) {
      throw new Error(`Reserved channel could not be registered: ${registration.reason}`);
    }

    return { created: true, channel };
  }

  addChatMember(input: AddChatMemberInput): AddChatMemberResult {
    if (this.#accounts.getById(input.actorAccountId) === undefined) {
      return { added: false, reason: 'actor_account_not_found' };
    }

    const chat = this.#sharedChats.getSharedChat(input.chatId);
    if (chat === undefined) {
      return { added: false, reason: 'chat_not_found' };
    }
    const actorMembership = this.#sharedChats.getChatMembership(
      input.chatId,
      input.actorAccountId,
    );
    if (actorMembership?.status !== 'owner') {
      return { added: false, reason: 'actor_not_authorized' };
    }

    const member = this.#identifyUser(input.memberId);
    if (member === undefined) {
      return { added: false, reason: 'member_not_found' };
    }
    if (chat.kind === 'channel' && member.kind === 'bot') {
      return { added: false, reason: 'bot_not_permitted_in_channel' };
    }

    // As an owner does in Telegram's apps, adding a banned user lifts its ban, whereas a restricted
    // user joins with its restriction.
    const statusBeforeJoining = this.#sharedChats.getFormerMemberStatus(
      input.chatId,
      input.memberId,
    ) ?? LEFT_CHAT_MEMBER_STATUS;
    const statusAfterJoining: JoiningMemberStatus = statusBeforeJoining.status === 'restricted'
      ? { ...statusBeforeJoining, isMember: true }
      : { status: 'member' };
    const addition = this.#sharedChats.addChatMember(
      input.chatId,
      input.memberId,
      statusAfterJoining,
    );
    if (!addition.added) {
      return addition;
    }
    const addedAtUnixSeconds = this.#currentUnixTimeSeconds();
    this.#events.publish({
      type: 'chat_member_status_changed',
      chat,
      actorId: input.actorAccountId,
      memberId: input.memberId,
      oldStatus: statusBeforeJoining,
      newStatus: statusAfterJoining,
      changedAtUnixSeconds: addedAtUnixSeconds,
    });
    this.#recordSupergroupServiceMessage(chat, {
      author: { kind: 'account', accountId: input.actorAccountId },
      content: { kind: 'members_joined', memberIds: [input.memberId] },
      changedAtUnixSeconds: addedAtUnixSeconds,
    });
    return addition;
  }

  /**
   * Ends the membership of an account or a bot that leaves a chat. The owner cannot leave: Telegram
   * keeps a creator who left as the chat's owner, which the emulator does not support.
   */
  leaveChat({ memberId, chatId }: LeaveChatInput): LeaveChatResult {
    const member = this.#identifyUser(memberId);
    if (member === undefined) {
      return { left: false, reason: 'member_not_found' };
    }
    const chat = this.#sharedChats.getSharedChat(chatId);
    if (chat === undefined) {
      return { left: false, reason: 'chat_not_found' };
    }
    const membership = this.#sharedChats.getChatMembership(chatId, memberId);
    if (membership === undefined) {
      const formerStatus = this.#sharedChats.getFormerMemberStatus(chatId, memberId);
      return {
        left: false,
        reason: 'not_a_member',
        ...(formerStatus === undefined ? {} : { formerStatus }),
      };
    }
    if (membership.status === 'owner') {
      return { left: false, reason: 'owner_cannot_leave' };
    }

    this.#endMembership(chat, {
      actor: member,
      memberId,
      membership,
      // As TDLib's `leave_dialog` asks, a restricted member stays restricted once it leaves.
      statusAfterLeaving: membership.status === 'restricted'
        ? { ...membership, isMember: false }
        : LEFT_CHAT_MEMBER_STATUS,
    });
    return { left: true };
  }

  /**
   * Removes a member from a chat as its owner. As in Telegram's apps, removal from a supergroup or
   * channel bans the member until it is added again, whereas a basic group just loses the member.
   */
  removeChatMember(input: RemoveChatMemberInput): RemoveChatMemberResult {
    if (this.#accounts.getById(input.actorAccountId) === undefined) {
      return { removed: false, reason: 'actor_account_not_found' };
    }
    const chat = this.#sharedChats.getSharedChat(input.chatId);
    if (chat === undefined) {
      return { removed: false, reason: 'chat_not_found' };
    }
    const actorMembership = this.#sharedChats.getChatMembership(
      input.chatId,
      input.actorAccountId,
    );
    if (actorMembership?.status !== 'owner') {
      return { removed: false, reason: 'actor_not_authorized' };
    }
    if (this.#identifyUser(input.memberId) === undefined) {
      return { removed: false, reason: 'member_not_found' };
    }
    const membership = this.#sharedChats.getChatMembership(input.chatId, input.memberId);
    if (membership === undefined) {
      return { removed: false, reason: 'not_a_member' };
    }
    if (membership.status === 'owner') {
      return { removed: false, reason: 'member_is_owner' };
    }

    this.#endMembership(chat, {
      actor: { kind: 'account', accountId: input.actorAccountId },
      memberId: input.memberId,
      membership,
      statusAfterLeaving: chat.kind === 'basic_group'
        ? LEFT_CHAT_MEMBER_STATUS
        : { status: 'kicked' },
    });
    return { removed: true };
  }

  /**
   * Promotes a member of a supergroup to administrator as its owner, or changes the rights of an
   * administrator, who keeps its custom title. The owner then counts as the administrator's
   * promoter, as Telegram records whoever last set an administrator's rights. A promotion that
   * changes nothing succeeds without effect and keeps the promoter.
   */
  promoteChatMember(input: PromoteChatMemberInput): PromoteChatMemberResult {
    if (input.rights.size === 0) {
      return { promoted: false, reason: 'no_rights_granted' };
    }
    const change = this.#changeMemberRoleAsOwner(
      input,
      (membership) =>
        membership.status === 'administrator' &&
          isSameSupergroupAdministratorRights(membership.rights, input.rights)
          ? membership
          : this.#createAdministratorStatus(membership, input.rights, {
            promotedById: input.actorAccountId,
          }),
    );
    return change.changed ? { promoted: true } : { promoted: false, reason: change.reason };
  }

  /**
   * Demotes an administrator of a supergroup to a member as its owner, which drops its custom
   * title. Demoting a member that is no administrator succeeds without effect, and a restricted
   * member stays restricted.
   */
  demoteChatMember(input: DemoteChatMemberInput): DemoteChatMemberResult {
    const change = this.#changeMemberRoleAsOwner(
      input,
      (membership) => membership.status === 'administrator' ? { status: 'member' } : membership,
    );
    return change.changed ? { demoted: true } : { demoted: false, reason: change.reason };
  }

  /**
   * Sets the custom title that clients show for the owner of a supergroup or an administrator in
   * place of its role, as the owner, as Telegram's clients set it with `channels.editAdmin`, which
   * changes the participant and so publishes the change. The title is read as
   * `#normalizeCustomTitle` reads it. Setting the title it has succeeds without effect.
   */
  setCustomTitle(input: SetCustomTitleInput): SetCustomTitleResult {
    const target = this.#resolveMemberAsOwner(input);
    if (!target.resolved) {
      return { set: false, reason: target.reason };
    }
    const { chat, membership } = target;
    if (membership.status !== 'owner' && membership.status !== 'administrator') {
      return { set: false, reason: 'not_an_administrator' };
    }
    const title = this.#normalizeCustomTitle(input.customTitle);
    if (!title.read) {
      return { set: false, reason: title.reason };
    }
    if (membership.customTitle === title.customTitle) {
      return { set: true };
    }
    const { customTitle: _, ...untitledMembership } = membership;
    const newStatus: ChatMembership = title.customTitle === undefined
      ? untitledMembership
      : { ...untitledMembership, customTitle: title.customTitle };

    this.#storeCustomTitle(chat.id, input.memberId, title.customTitle);
    this.#events.publish({
      type: 'chat_member_status_changed',
      chat,
      actorId: input.actorAccountId,
      memberId: input.memberId,
      oldStatus: membership,
      newStatus,
      changedAtUnixSeconds: this.#currentUnixTimeSeconds(),
    });
    return { set: true };
  }

  /**
   * Sets the custom title of a supergroup administrator as a bot, as the official Bot API server's
   * `process_set_chat_administrator_custom_title_query` does: the owner alone sets its own title,
   * the user must be an administrator, and the bot must be allowed to edit it, as
   * `canEditSupergroupAdministrator` decides. The server then sets the title as the member's tag
   * with TDLib's `setChatMemberTag`, which reads it as `#normalizeCustomTitle` does. Telegram
   * announces tag changes only in basic groups, as its documentation of member tags says, so no
   * update reports the change. Setting the title the administrator has succeeds without effect.
   */
  setCustomTitleAsBot(input: SetCustomTitleAsBotInput): SetCustomTitleAsBotResult {
    const target = this.#resolveModerationTarget(input);
    if (!target.resolved) {
      return { set: false, reason: target.reason };
    }
    const { memberStatus } = target;
    if (memberStatus.status === 'owner') {
      return { set: false, reason: 'member_is_owner' };
    }
    if (memberStatus.status !== 'administrator') {
      return { set: false, reason: 'member_is_not_administrator' };
    }
    if (
      !canEditSupergroupAdministrator(this.#readMembership(input.chatId), input.actorBotId, {
        userId: input.memberId,
        membership: memberStatus,
      })
    ) {
      return { set: false, reason: 'custom_title_not_editable' };
    }
    const title = this.#normalizeCustomTitle(input.customTitle);
    if (!title.read) {
      return { set: false, reason: title.reason };
    }
    if (memberStatus.customTitle !== title.customTitle) {
      this.#storeCustomTitle(input.chatId, input.memberId, title.customTitle);
    }
    return { set: true };
  }

  /**
   * Bans a user from a supergroup as a bot, removing it if it is a member; a user that is not a
   * member is banned before it can join. The bot's removal of a member is recorded as the bot's
   * service message.
   *
   * Checks follow TDLib's order: a ban that changes nothing succeeds without rights, and nobody can
   * ban the owner; otherwise the bot needs the `can_restrict_members` right. Telegram lets a bot
   * ban only administrators it promoted, directly or indirectly, as `isAdministratorPromotedBy`
   * decides.
   */
  banChatMember(input: BanChatMemberInput): BanChatMemberResult {
    const target = this.#resolveModerationTarget(input);
    if (!target.resolved) {
      return { banned: false, reason: target.reason };
    }
    if (input.memberId === input.actorBotId) {
      return { banned: false, reason: 'cannot_restrict_self' };
    }
    const restriction = this.#restrictAsBot(target, {
      status: 'kicked',
      ...this.#normalizeBanEnd(input.requestedBanEndUnixSeconds),
    });
    return restriction.restricted
      ? { banned: true }
      : { banned: false, reason: restriction.reason };
  }

  /**
   * Lifts a user's ban from a supergroup as a bot, so that it may join again. As on Telegram,
   * unless only a ban is to be lifted, this also removes a member, which the bot's service message
   * records, and a bot that names itself leaves.
   */
  unbanChatMember(input: UnbanChatMemberInput): UnbanChatMemberResult {
    const target = this.#resolveModerationTarget(input);
    if (!target.resolved) {
      return { unbanned: false, reason: target.reason };
    }
    if (input.onlyIfBanned && target.memberStatus.status !== 'kicked') {
      return { unbanned: true };
    }
    if (input.memberId === input.actorBotId) {
      const leaving = this.leaveChat({ memberId: input.actorBotId, chatId: input.chatId });
      if (!leaving.left) {
        throw new Error(`Bot ${input.actorBotId} could not leave chat ${input.chatId}`);
      }
      return { unbanned: true };
    }

    let bannedTarget: ModerationTarget = target;
    if (isChatMember(target.memberStatus)) {
      // Telegram removes a member by banning it briefly, then lifting the ban.
      const removalBan: FormerChatMemberStatus = {
        status: 'kicked',
        bannedUntilUnixSeconds: this.#currentUnixTimeSeconds() +
          MEMBER_REMOVAL_BAN_DURATION_SECONDS,
      };
      const removal = this.#restrictAsBot(target, removalBan);
      if (!removal.restricted) {
        return { unbanned: false, reason: removal.reason };
      }
      bannedTarget = { ...target, memberStatus: removalBan };
    }
    const liftedBan = this.#restrictAsBot(bannedTarget, LEFT_CHAT_MEMBER_STATUS);
    return liftedBan.restricted
      ? { unbanned: true }
      : { unbanned: false, reason: liftedBan.reason };
  }

  /**
   * Restricts what a user may do in a supergroup as a bot, whether the user is a member or not, or
   * lifts its restriction when it keeps every permission, as TDLib's `setChatMemberStatus` does
   * with the status `restrictChatMember` asks for. No service message records it.
   *
   * Checks follow TDLib's `set_channel_participant_status_impl` and
   * `restrict_channel_participant`: a restriction that changes nothing succeeds without rights;
   * nobody restricts the owner; a bot changes its own standing only as `#restrictSelf` allows.
   * Making an administrator a plain member demotes it, as `#promoteAsBot` does. Otherwise a bot
   * needs `can_restrict_members`, and Telegram lets it restrict only administrators it promoted,
   * directly or indirectly. As for a ban, a restriction shorter than 30 seconds or longer than 366
   * days lasts until it is lifted.
   */
  restrictChatMember(input: RestrictChatMemberInput): RestrictChatMemberResult {
    const target = this.#resolveModerationTarget(input);
    if (!target.resolved) {
      return { restricted: false, reason: target.reason };
    }
    const { botMembership, memberStatus } = target;
    const newStatus = createRestrictedStatus(isChatMember(memberStatus), {
      permissions: input.permissions,
      ...this.#normalizeRestrictionEnd(input.requestedRestrictionEndUnixSeconds),
    });
    if (isSameChatMemberStatus(memberStatus, newStatus)) {
      return { restricted: true };
    }
    if (memberStatus.status === 'owner') {
      return { restricted: false, reason: 'member_is_owner' };
    }
    if (input.memberId === input.actorBotId) {
      return this.#restrictSelf(target, newStatus);
    }
    if (memberStatus.status === 'administrator' && newStatus.status === 'member') {
      const demotion = this.#promoteAsBot(target, new Set());
      if (demotion.promoted) {
        return { restricted: true };
      }
      switch (demotion.reason) {
        case 'not_enough_rights_to_promote':
        case 'member_is_administrator':
          return { restricted: false, reason: demotion.reason };
        default:
          throw new Error(
            `Administrator ${input.memberId} of chat ${input.chatId} could not be demoted: ${demotion.reason}`,
          );
      }
    }
    if (!holdsSupergroupAdministratorRight(botMembership, 'can_restrict_members')) {
      return { restricted: false, reason: 'not_enough_rights' };
    }
    if (
      memberStatus.status === 'administrator' &&
      !isAdministratorPromotedBy(this.#readMembership(input.chatId), input.actorBotId, {
        userId: input.memberId,
        membership: memberStatus,
      })
    ) {
      return { restricted: false, reason: 'member_is_administrator' };
    }

    this.#changeStatusOfUser(target.chat, {
      actorId: input.actorBotId,
      memberId: input.memberId,
      oldStatus: memberStatus,
      newStatus,
    });
    return { restricted: true };
  }

  /**
   * Promotes a supergroup member to administrator as a bot, changes an administrator's rights, or,
   * with no rights, demotes an administrator to a member, as the Bot API's `promoteChatMember`
   * asks TDLib's `setChatMemberStatus` to. The bot becomes the administrator's promoter, and an
   * administrator keeps its custom title while its rights change. No service message records it.
   *
   * Checks follow TDLib's `set_channel_participant_status_impl`: nobody changes the owner, and a
   * change that changes nothing succeeds without rights; for an administrator, only one the bot
   * may edit counts as unchanged, as TDLib compares `can_be_edited` too. Promotions and demotions
   * then go through `#promoteAsBot`. Demoting a user that is no administrator lifts a member's
   * restriction, as `restrictChatMember` does with every permission, and fails for a user that is
   * not a member, as TDLib would have to add it; unlike TDLib, which may first lift a ban, such a
   * failure changes nothing.
   */
  promoteChatMemberAsBot(input: PromoteChatMemberAsBotInput): PromoteChatMemberAsBotResult {
    const target = this.#resolveModerationTarget(input);
    if (!target.resolved) {
      return { promoted: false, reason: target.reason };
    }
    const { botMembership, memberStatus } = target;
    if (memberStatus.status === 'owner') {
      return { promoted: false, reason: 'member_is_owner' };
    }
    const isUnchanged = input.rights.size === 0
      ? memberStatus.status === 'member'
      : memberStatus.status === 'administrator' &&
        isSameSupergroupAdministratorRights(memberStatus.rights, input.rights) &&
        canEditSupergroupAdministrator(this.#readMembership(input.chatId), input.actorBotId, {
          userId: input.memberId,
          membership: memberStatus,
        });
    if (isUnchanged) {
      return { promoted: true };
    }
    if (input.rights.size > 0 || memberStatus.status === 'administrator') {
      return this.#promoteAsBot(target, input.rights);
    }
    if (isChatMember(memberStatus)) {
      return this.#liftRestrictionByDemotion(input);
    }
    if (
      memberStatus.status !== 'left' &&
      !holdsSupergroupAdministratorRight(botMembership, 'can_restrict_members')
    ) {
      return { promoted: false, reason: 'not_enough_rights' };
    }
    return { promoted: false, reason: 'bots_cannot_add_members' };
  }

  /**
   * Restricts what a user may do in a supergroup as its owner, whether the user is a member or not,
   * as `restrictChatMember` does for a bot. The owner may restrict an administrator, which then
   * loses its rights and custom title, as Telegram lets the owner do.
   */
  restrictChatMemberAsOwner(input: RestrictChatMemberAsOwnerInput): OwnerRestrictionResult {
    return this.#changeRestrictionAsOwner(input, (isMember) =>
      createRestrictedStatus(isMember, {
        permissions: input.permissions,
        ...this.#normalizeRestrictionEnd(input.requestedRestrictionEndUnixSeconds),
      }));
  }

  /**
   * Lifts a user's restriction in a supergroup as its owner, which leaves a member a plain member
   * and a non-member as having left. A user that is not restricted stays as it is.
   */
  liftRestrictionAsOwner(input: LiftRestrictionAsOwnerInput): OwnerRestrictionResult {
    return this.#changeRestrictionAsOwner(
      input,
      (isMember, status) =>
        status.status === 'restricted'
          ? createRestrictedStatus(isMember, { permissions: ALL_CHAT_PERMISSIONS })
          : status,
    );
  }

  /**
   * Ends a temporary restriction as its end arrives, which the emulator never does as time passes:
   * as TDLib's `DialogParticipantStatus::update_restrictions` clears an elapsed restriction, a
   * member becomes a plain member and a non-member is left as having left. TDLib clears it locally,
   * and the public source shows no update Telegram's servers send for it, so no event is published.
   */
  expireRestriction({ chatId, memberId }: ExpireRestrictionInput): ExpireRestrictionResult {
    if (this.#sharedChats.getSharedChat(chatId)?.kind !== 'supergroup') {
      return { expired: false, reason: 'chat_not_found' };
    }
    if (this.#identifyUser(memberId) === undefined) {
      return { expired: false, reason: 'member_not_found' };
    }
    const status = this.#lookUpChatMemberStatus(chatId, memberId);
    if (status.status !== 'restricted' || status.restrictedUntilUnixSeconds === undefined) {
      return { expired: false, reason: 'restriction_not_temporary' };
    }
    const statusAfterExpiry = createRestrictedStatus(status.isMember, {
      permissions: ALL_CHAT_PERMISSIONS,
    });
    this.#storeStatusOfUser(chatId, memberId, statusAfterExpiry);
    return { expired: true, status: statusAfterExpiry };
  }

  /**
   * Returns a user's standing in a supergroup to a bot that is a member of it. A user of the session
   * that never joined the supergroup has `left` it.
   */
  getChatMemberStatus(input: GetChatMemberStatusInput): GetChatMemberStatusResult {
    const access = this.#resolveBotObserver(input);
    if (!access.resolved) {
      return { found: false, reason: access.reason };
    }
    if (this.#identifyUser(input.userId) === undefined) {
      return { found: false, reason: 'member_not_found' };
    }
    return { found: true, status: this.#lookUpChatMemberStatus(input.chatId, input.userId) };
  }

  /** Returns the owner and administrators of a supergroup to a bot that is a member of it. */
  getChatAdministrators(input: ChatMemberQueryInput): GetChatAdministratorsResult {
    const access = this.#resolveBotObserver(input);
    if (!access.resolved) {
      return { found: false, reason: access.reason };
    }
    return { found: true, administrators: this.#listAdministratorStandings(input.chatId) };
  }

  /**
   * Returns the owner and administrators of a supergroup to an account that is a member of it,
   * with who promoted each administrator and whether the account may edit it.
   */
  getAdministratorsForAccount(
    { observerAccountId, chatId }: GetAdministratorsForAccountInput,
  ): GetAdministratorsForAccountResult {
    if (this.#accounts.getById(observerAccountId) === undefined) {
      return { found: false, reason: 'account_not_found' };
    }
    if (this.#sharedChats.getSharedChat(chatId)?.kind !== 'supergroup') {
      return { found: false, reason: 'chat_not_found' };
    }
    if (this.#sharedChats.getChatMembership(chatId, observerAccountId) === undefined) {
      return { found: false, reason: 'not_a_member' };
    }
    const readMembership = this.#readMembership(chatId);
    return {
      found: true,
      administrators: this.#listAdministratorStandings(chatId).map(({ userId, status }) => ({
        userId,
        status,
        canBeEdited: status.status === 'administrator' &&
          canEditSupergroupAdministrator(readMembership, observerAccountId, {
            userId,
            membership: status,
          }),
      })),
    };
  }

  /** Returns how many members a supergroup has, its owner and bots included. */
  getChatMemberCount(input: ChatMemberQueryInput): GetChatMemberCountResult {
    const access = this.#resolveBotObserver(input);
    return access.resolved
      ? { found: true, memberCount: this.#sharedChats.getChatMemberIds(input.chatId).length }
      : { found: false, reason: access.reason };
  }

  /**
   * Finds a supergroup whose information a bot reads, with the access the official Bot API server's
   * `check_chat_access` requires for reading: a bot removed from the supergroup is turned away,
   * and one that is not a member may read only a public supergroup.
   */
  getReadableSupergroup(
    { observerBotId, chatId }: ChatMemberQueryInput,
  ): GetReadableSupergroupResult {
    if (this.#bots.getById(observerBotId) === undefined) {
      return { found: false, reason: 'bot_not_found' };
    }
    const supergroup = this.#sharedChats.getSharedChat(chatId);
    if (supergroup?.kind !== 'supergroup') {
      return { found: false, reason: 'chat_not_found' };
    }
    if (this.#sharedChats.getChatMembership(chatId, observerBotId) !== undefined) {
      return { found: true, supergroup };
    }
    const formerStatus = this.#sharedChats.getFormerMemberStatus(chatId, observerBotId);
    if (supergroup.username !== undefined && formerStatus?.status !== 'kicked') {
      return { found: true, supergroup };
    }
    return { found: false, reason: getSupergroupNonMemberFailureReason(formerStatus) };
  }

  /** Changes the role of a supergroup member that is not the owner, as the owner. */
  /**
   * Protects all messages of a supergroup from forwarding and saving, or lifts that protection, as
   * its owner, who alone may, as TDLib's `toggle_dialog_has_protected_content` requires. It applies
   * to every message, including earlier ones, as long as it lasts.
   */
  setContentProtection(input: SetContentProtectionInput): SetContentProtectionResult {
    if (this.#accounts.getById(input.actorAccountId) === undefined) {
      return { set: false, reason: 'actor_account_not_found' };
    }
    if (this.#sharedChats.getSharedChat(input.chatId)?.kind !== 'supergroup') {
      return { set: false, reason: 'chat_not_found' };
    }
    if (
      this.#sharedChats.getChatMembership(input.chatId, input.actorAccountId)?.status !== 'owner'
    ) {
      return { set: false, reason: 'actor_not_authorized' };
    }
    if (
      !this.#sharedChats.updateSupergroupContentProtection(input.chatId, input.hasProtectedContent)
    ) {
      throw new Error(`Supergroup ${input.chatId} could not be updated`);
    }
    return { set: true };
  }

  /**
   * Changes a supergroup's title as an account or a bot, as TDLib's `set_dialog_title` does: the
   * title is cleaned as `cleanName` cleans it, keeping at most 128 characters, and must not be
   * empty; then the actor must be allowed to, as `canChangeSupergroupInfo` decides. A title the
   * supergroup has succeeds without effect; a new one is recorded as the actor's service message.
   */
  changeSupergroupTitle(input: ChangeSupergroupTitleInput): ChangeSupergroupTitleResult {
    const access = this.#resolveSupergroupActor(input);
    if (!access.resolved) {
      return { changed: false, reason: access.reason };
    }
    const cleanedTitle = cleanInputString(input.title);
    if (cleanedTitle === undefined) {
      return { changed: false, reason: 'text_encoding_invalid' };
    }
    const title = cleanName(cleanedTitle, MAX_CHAT_TITLE_LENGTH);
    if (title.length === 0) {
      return { changed: false, reason: 'title_empty' };
    }
    if (!canChangeSupergroupInfo(access.supergroup, input.actor, access.membership)) {
      return { changed: false, reason: 'not_enough_rights' };
    }
    if (access.supergroup.title === title) {
      return { changed: true };
    }

    if (!this.#sharedChats.updateSupergroupInfo(input.chatId, { title })) {
      throw new Error(`Supergroup ${input.chatId} could not be updated`);
    }
    this.#recordSupergroupServiceMessage(access.supergroup, {
      author: input.actor,
      content: { kind: 'title_changed', title },
      changedAtUnixSeconds: this.#currentUnixTimeSeconds(),
    });
    return { changed: true };
  }

  /**
   * Changes a supergroup's description as an account or a bot, as TDLib's
   * `set_channel_description` does: the description is stripped as `stripEmptyCharacters` strips
   * it, keeping at most 255 characters, and the actor must be allowed to, as
   * `canChangeSupergroupInfo` decides. Telegram's servers refuse a description the supergroup has.
   * No service message records the change.
   */
  changeSupergroupDescription(
    input: ChangeSupergroupDescriptionInput,
  ): ChangeSupergroupDescriptionResult {
    const access = this.#resolveSupergroupActor(input);
    if (!access.resolved) {
      return { changed: false, reason: access.reason };
    }
    const cleanedDescription = cleanInputString(input.description);
    if (cleanedDescription === undefined) {
      return { changed: false, reason: 'text_encoding_invalid' };
    }
    const description = stripEmptyCharacters(cleanedDescription, MAX_CHAT_DESCRIPTION_LENGTH);
    if (!canChangeSupergroupInfo(access.supergroup, input.actor, access.membership)) {
      return { changed: false, reason: 'not_enough_rights' };
    }
    if ((access.supergroup.description ?? '') === description) {
      return { changed: false, reason: 'description_not_modified' };
    }

    if (!this.#sharedChats.updateSupergroupInfo(input.chatId, { description })) {
      throw new Error(`Supergroup ${input.chatId} could not be updated`);
    }
    return { changed: true };
  }

  /**
   * Changes what a supergroup's members may do by default, as an account or a bot, as TDLib's
   * `set_dialog_permissions` does: the actor needs the `can_restrict_members` right, which the
   * owner holds, and permissions the supergroup has succeed without effect. Administrators stay
   * exempt, and a restricted member's restriction may withhold more. No service message records
   * the change, and no bot receives an update for it.
   */
  changeDefaultPermissions(input: ChangeDefaultPermissionsInput): ChangeDefaultPermissionsResult {
    const access = this.#resolveSupergroupActor(input);
    if (!access.resolved) {
      return { changed: false, reason: access.reason };
    }
    if (!holdsSupergroupAdministratorRight(access.membership, 'can_restrict_members')) {
      return { changed: false, reason: 'not_enough_rights' };
    }
    if (isSameChatPermissions(access.supergroup.defaultPermissions, input.permissions)) {
      return { changed: true };
    }
    if (!this.#sharedChats.updateSupergroupDefaultPermissions(input.chatId, input.permissions)) {
      throw new Error(`Supergroup ${input.chatId} could not be updated`);
    }
    return { changed: true };
  }

  /**
   * Finds the chat a bot addresses by a public username, as the official Bot API server's
   * `check_chat` finds it with `searchPublicChat`: a public supergroup, or the private chat with a
   * bot, whose ID is the bot's. An account's username names no chat a bot may address this way.
   */
  findPublicChatId(username: string): number | undefined {
    const identity = this.#identities.getByUsername(username);
    switch (identity?.kind) {
      case 'supergroup':
      case 'bot':
        return identity.id;
      default:
        return undefined;
    }
  }

  /**
   * Resolves a supergroup whose information or settings an account or a bot changes, and the
   * actor's membership: a bot as the Bot API server's `check_chat` requires for writing, and an
   * account as a member of the supergroup.
   */
  #resolveSupergroupActor(
    { actor, chatId }: { readonly actor: SupergroupMessageAuthor; readonly chatId: number },
  ):
    | {
      readonly resolved: true;
      readonly supergroup: Supergroup;
      readonly membership: ChatMembership;
    }
    | {
      readonly resolved: false;
      readonly reason: 'actor_not_found' | SupergroupBotAccessFailureReason | 'not_a_member';
    } {
    if (actor.kind === 'bot') {
      const access = this.#resolveBotObserver({ observerBotId: actor.botId, chatId });
      if (access.resolved) {
        return access;
      }
      return {
        resolved: false,
        reason: access.reason === 'bot_not_found' ? 'actor_not_found' : access.reason,
      };
    }
    if (this.#accounts.getById(actor.accountId) === undefined) {
      return { resolved: false, reason: 'actor_not_found' };
    }
    const supergroup = this.#sharedChats.getSharedChat(chatId);
    if (supergroup?.kind !== 'supergroup') {
      return { resolved: false, reason: 'chat_not_found' };
    }
    const membership = this.#sharedChats.getChatMembership(chatId, actor.accountId);
    return membership === undefined
      ? { resolved: false, reason: 'not_a_member' }
      : { resolved: true, supergroup, membership };
  }

  /** Resolves a member of a supergroup that the acting account owns, for the owner to manage. */
  #resolveMemberAsOwner(
    { actorAccountId, chatId, memberId }: {
      readonly actorAccountId: number;
      readonly chatId: number;
      readonly memberId: number;
    },
  ):
    | { readonly resolved: true; readonly chat: Supergroup; readonly membership: ChatMembership }
    | { readonly resolved: false; readonly reason: OwnerMemberManagementFailureReason } {
    if (this.#accounts.getById(actorAccountId) === undefined) {
      return { resolved: false, reason: 'actor_account_not_found' };
    }
    const chat = this.#sharedChats.getSharedChat(chatId);
    if (chat?.kind !== 'supergroup') {
      return { resolved: false, reason: 'chat_not_found' };
    }
    if (this.#sharedChats.getChatMembership(chatId, actorAccountId)?.status !== 'owner') {
      return { resolved: false, reason: 'actor_not_authorized' };
    }
    if (this.#identifyUser(memberId) === undefined) {
      return { resolved: false, reason: 'member_not_found' };
    }
    const membership = this.#sharedChats.getChatMembership(chatId, memberId);
    if (membership === undefined) {
      return { resolved: false, reason: 'not_a_member' };
    }
    return { resolved: true, chat, membership };
  }

  #changeMemberRoleAsOwner(
    input: {
      readonly actorAccountId: number;
      readonly chatId: number;
      readonly memberId: number;
    },
    getNewStatus: (membership: NonOwnerMemberStatus) => NonOwnerMemberStatus,
  ):
    | { readonly changed: true }
    | { readonly changed: false; readonly reason: ChatMemberRoleChangeFailureReason } {
    const target = this.#resolveMemberAsOwner(input);
    if (!target.resolved) {
      return { changed: false, reason: target.reason };
    }
    const { actorAccountId, chatId, memberId } = input;
    const { chat, membership } = target;
    if (membership.status === 'owner') {
      return { changed: false, reason: 'member_is_owner' };
    }
    const newStatus = getNewStatus(membership);
    if (isSameChatMemberStatus(membership, newStatus)) {
      return { changed: true };
    }

    const update = this.#sharedChats.updateChatMemberStatus(chatId, memberId, newStatus);
    if (!update.updated) {
      throw new Error(
        `Member ${memberId} of chat ${chatId} could not be updated: ${update.reason}`,
      );
    }
    this.#events.publish({
      type: 'chat_member_status_changed',
      chat,
      actorId: actorAccountId,
      memberId,
      oldStatus: membership,
      newStatus,
      changedAtUnixSeconds: this.#currentUnixTimeSeconds(),
    });
    return { changed: true };
  }

  /**
   * Promotes a user to administrator as a bot, changes an administrator's rights, or demotes one,
   * once TDLib's `set_channel_participant_status_impl` chose a promotion. As TDLib's
   * `promote_channel_participant` checks, a bot cannot promote itself, though it may demote itself,
   * and needs `can_promote_members` for anyone else. Telegram's servers then refuse a user that is
   * not a member, an administrator the bot did not promote, directly or indirectly, and rights the
   * bot does not hold, as the Bot API documents `can_promote_members`: an administrator adds others
   * "with a subset of their own privileges". The servers' order of these checks is not public.
   */
  #promoteAsBot(
    { chat, botId, botMembership, memberId, memberStatus }: ModerationTarget,
    rights: SupergroupAdministratorRights,
  ):
    | { readonly promoted: true }
    | { readonly promoted: false; readonly reason: BotPromotionFailureReason } {
    if (memberId === botId) {
      if (rights.size > 0) {
        return { promoted: false, reason: 'cannot_promote_self' };
      }
    } else {
      if (!holdsSupergroupAdministratorRight(botMembership, 'can_promote_members')) {
        return { promoted: false, reason: 'not_enough_rights_to_promote' };
      }
      if (!isChatMember(memberStatus)) {
        return {
          promoted: false,
          reason: memberStatus.status === 'kicked' ? 'member_kicked' : 'member_not_in_chat',
        };
      }
      if (
        memberStatus.status === 'administrator' &&
        !isAdministratorPromotedBy(this.#readMembership(chat.id), botId, {
          userId: memberId,
          membership: memberStatus,
        })
      ) {
        return { promoted: false, reason: 'member_is_administrator' };
      }
      if (![...rights].every((right) => holdsSupergroupAdministratorRight(botMembership, right))) {
        return { promoted: false, reason: 'rights_not_held' };
      }
    }

    this.#changeStatusOfUser(chat, {
      actorId: botId,
      memberId,
      oldStatus: memberStatus,
      newStatus: rights.size === 0
        ? { status: 'member' }
        : this.#createAdministratorStatus(memberStatus, rights, {
          promotedById: botId,
          promoterTenureId: getAdministratorTenureId(botId, botMembership),
        }),
    });
    return { promoted: true };
  }

  /**
   * The standing of an administrator holding `rights` that a promoter set, with the delegation
   * link to the promoter: one that already is an administrator keeps its tenure and custom title,
   * and anyone else starts a new tenure. Call it only for a change that will be stored, since a
   * new tenure takes its identifier for good.
   */
  #createAdministratorStatus(
    oldStatus: ChatMemberStatus,
    rights: SupergroupAdministratorRights,
    delegationLink: Pick<AdministratorMembership, 'promotedById' | 'promoterTenureId'>,
  ): AdministratorMembership {
    return {
      status: 'administrator',
      rights,
      tenureId: oldStatus.status === 'administrator'
        ? oldStatus.tenureId
        : this.#sharedChats.issueAdministratorTenureId(),
      ...delegationLink,
      ...(oldStatus.status === 'administrator' && oldStatus.customTitle !== undefined
        ? { customTitle: oldStatus.customTitle }
        : {}),
    };
  }

  /**
   * Lifts a restricted member's restriction as a bot that demotes it, which TDLib's
   * `set_channel_participant_status_impl` does as `restrictChatMember` does with every permission.
   */
  #liftRestrictionByDemotion(
    { actorBotId, chatId, memberId }: PromoteChatMemberAsBotInput,
  ): PromoteChatMemberAsBotResult {
    const lifting = this.restrictChatMember({
      actorBotId,
      chatId,
      memberId,
      permissions: ALL_CHAT_PERMISSIONS,
    });
    if (lifting.restricted) {
      return { promoted: true };
    }
    switch (lifting.reason) {
      case 'not_enough_rights':
      case 'cannot_unrestrict_self':
        return { promoted: false, reason: lifting.reason };
      default:
        throw new Error(
          `Restriction of member ${memberId} of chat ${chatId} could not be lifted: ${lifting.reason}`,
        );
    }
  }

  /**
   * Reads a custom title as Telegram does: TDLib's `clean_input_string` cleans it, refusing text
   * that is not well-formed Unicode; Telegram's servers refuse it as `findCustomTitleViolation`
   * decides; and TDLib keeps it as `strip_empty_characters` strips it. A title that is empty then
   * stands for none.
   */
  #normalizeCustomTitle(
    title: string,
  ):
    | { readonly read: true; readonly customTitle: string | undefined }
    | { readonly read: false; readonly reason: CustomTitleRefusal } {
    const cleanedTitle = cleanInputString(title);
    if (cleanedTitle === undefined) {
      return { read: false, reason: 'text_encoding_invalid' };
    }
    const violation = findCustomTitleViolation(cleanedTitle);
    if (violation !== undefined) {
      return { read: false, reason: `custom_title_${violation}` };
    }
    const customTitle = stripEmptyCharacters(cleanedTitle, MAX_CUSTOM_TITLE_LENGTH);
    return { read: true, customTitle: customTitle.length === 0 ? undefined : customTitle };
  }

  /** Stores the custom title of the owner or an administrator; `undefined` removes it. */
  #storeCustomTitle(chatId: number, memberId: number, customTitle: string | undefined): void {
    const update = this.#sharedChats.setCustomTitle(chatId, memberId, customTitle);
    if (!update.updated) {
      throw new Error(
        `Custom title of member ${memberId} of chat ${chatId} could not be set: ${update.reason}`,
      );
    }
  }

  /** Reads the current memberships of a chat, as administrator delegation follows them. */
  #readMembership(chatId: number): SupergroupMembershipReader {
    return (userId) => this.#sharedChats.getChatMembership(chatId, userId);
  }

  /**
   * Applies a bot's restriction of itself as TDLib does: it can neither restrict itself nor lift
   * its own restriction, but every permission makes an administrator a plain member, which TDLib's
   * `promote_channel_participant` lets a bot do to itself without the right to promote members.
   */
  #restrictSelf(
    { chat, botId, memberStatus }: ModerationTarget,
    newStatus: ChatMemberStatus,
  ): RestrictChatMemberResult {
    if (newStatus.status !== 'member') {
      return { restricted: false, reason: 'cannot_restrict_self' };
    }
    if (memberStatus.status !== 'administrator') {
      return { restricted: false, reason: 'cannot_unrestrict_self' };
    }
    this.#changeStatusOfUser(chat, {
      actorId: botId,
      memberId: botId,
      oldStatus: memberStatus,
      newStatus,
    });
    return { restricted: true };
  }

  /**
   * Changes a user's restriction as the owner of its supergroup, to the standing `getNewStatus`
   * gives the user from whether it is a member and its standing. The owner itself is refused even
   * when nothing would change; any other change that changes nothing succeeds without effect.
   */
  #changeRestrictionAsOwner(
    { actorAccountId, chatId, memberId }: {
      readonly actorAccountId: number;
      readonly chatId: number;
      readonly memberId: number;
    },
    getNewStatus: (isMember: boolean, status: ChatMemberStatus) => ChatMemberStatus,
  ): OwnerRestrictionResult {
    if (this.#accounts.getById(actorAccountId) === undefined) {
      return { changed: false, reason: 'actor_account_not_found' };
    }
    const chat = this.#sharedChats.getSharedChat(chatId);
    if (chat?.kind !== 'supergroup') {
      return { changed: false, reason: 'chat_not_found' };
    }
    if (this.#sharedChats.getChatMembership(chatId, actorAccountId)?.status !== 'owner') {
      return { changed: false, reason: 'actor_not_authorized' };
    }
    if (this.#identifyUser(memberId) === undefined) {
      return { changed: false, reason: 'member_not_found' };
    }
    const oldStatus = this.#lookUpChatMemberStatus(chatId, memberId);
    if (oldStatus.status === 'owner') {
      return { changed: false, reason: 'member_is_owner' };
    }
    const newStatus = getNewStatus(isChatMember(oldStatus), oldStatus);
    if (isSameChatMemberStatus(oldStatus, newStatus)) {
      return { changed: true };
    }
    this.#changeStatusOfUser(chat, { actorId: actorAccountId, memberId, oldStatus, newStatus });
    return { changed: true };
  }

  /**
   * Stores a user's new standing in a supergroup, which keeps it a member or not, and publishes the
   * change. Use it only for changes that neither add nor remove a member, which record service
   * messages.
   */
  #changeStatusOfUser(
    chat: Supergroup,
    { actorId, memberId, oldStatus, newStatus }: {
      readonly actorId: number;
      readonly memberId: number;
      readonly oldStatus: ChatMemberStatus;
      readonly newStatus: ChatMemberStatus;
    },
  ): void {
    if (isChatMember(oldStatus) !== isChatMember(newStatus)) {
      throw new Error(
        `Member ${memberId} of chat ${chat.id} would join or leave by a change of its standing`,
      );
    }
    this.#storeStatusOfUser(chat.id, memberId, newStatus);
    this.#events.publish({
      type: 'chat_member_status_changed',
      chat,
      actorId,
      memberId,
      oldStatus,
      newStatus,
      changedAtUnixSeconds: this.#currentUnixTimeSeconds(),
    });
  }

  /**
   * Stores a user's new standing in a supergroup: a member's, or, for a user that is not a
   * member, how its membership ended. The owner's standing never changes.
   */
  #storeStatusOfUser(chatId: number, memberId: number, status: ChatMemberStatus): void {
    if (isChatMember(status)) {
      if (status.status === 'owner') {
        throw new Error(`Member ${memberId} of chat ${chatId} cannot become its owner`);
      }
      const update = this.#sharedChats.updateChatMemberStatus(chatId, memberId, status);
      if (!update.updated) {
        throw new Error(
          `Member ${memberId} of chat ${chatId} could not be updated: ${update.reason}`,
        );
      }
      return;
    }
    const update = this.#sharedChats.updateFormerMemberStatus(chatId, memberId, status);
    if (!update.updated) {
      throw new Error(`Non-member ${memberId} of chat ${chatId} could not be updated`);
    }
  }

  /** Resolves a bot that moderates a supergroup and the standing of the user it moderates. */
  #resolveModerationTarget(
    { actorBotId, chatId, memberId }: {
      readonly actorBotId: number;
      readonly chatId: number;
      readonly memberId: number;
    },
  ):
    | ({ readonly resolved: true } & ModerationTarget)
    | {
      readonly resolved: false;
      readonly reason: 'bot_not_found' | SupergroupBotAccessFailureReason | 'member_not_found';
    } {
    const access = this.#resolveBotObserver({ observerBotId: actorBotId, chatId });
    if (!access.resolved) {
      return { resolved: false, reason: access.reason };
    }
    if (this.#identifyUser(memberId) === undefined) {
      return { resolved: false, reason: 'member_not_found' };
    }
    return {
      resolved: true,
      chat: access.supergroup,
      botId: actorBotId,
      botMembership: access.membership,
      memberId,
      memberStatus: this.#lookUpChatMemberStatus(chatId, memberId),
    };
  }

  /**
   * Bans a user or lifts its ban as a bot, in TDLib's order of checks, and removes the user if it is
   * a member.
   */
  #restrictAsBot(
    { chat, botId, botMembership, memberId, memberStatus }: ModerationTarget,
    newStatus: FormerChatMemberStatus,
  ):
    | { readonly restricted: true }
    | {
      readonly restricted: false;
      readonly reason: 'member_is_owner' | 'not_enough_rights' | 'member_is_administrator';
    } {
    if (isSameChatMemberStatus(memberStatus, newStatus)) {
      return { restricted: true };
    }
    if (memberStatus.status === 'owner') {
      return { restricted: false, reason: 'member_is_owner' };
    }
    if (!holdsSupergroupAdministratorRight(botMembership, 'can_restrict_members')) {
      return { restricted: false, reason: 'not_enough_rights' };
    }
    if (
      memberStatus.status === 'administrator' &&
      !isAdministratorPromotedBy(this.#readMembership(chat.id), botId, {
        userId: memberId,
        membership: memberStatus,
      })
    ) {
      return { restricted: false, reason: 'member_is_administrator' };
    }

    const actor: SupergroupMessageAuthor = { kind: 'bot', botId };
    if (isChatMember(memberStatus)) {
      this.#endMembership(chat, {
        actor,
        memberId,
        membership: memberStatus,
        statusAfterLeaving: newStatus,
      });
      return { restricted: true };
    }
    const update = this.#sharedChats.updateFormerMemberStatus(chat.id, memberId, newStatus);
    if (!update.updated) {
      throw new Error(`Non-member ${memberId} of chat ${chat.id} could not be updated`);
    }
    this.#events.publish({
      type: 'chat_member_status_changed',
      chat,
      actorId: botId,
      memberId,
      oldStatus: memberStatus,
      newStatus,
      changedAtUnixSeconds: this.#currentUnixTimeSeconds(),
    });
    return { restricted: true };
  }

  /**
   * Resolves the end of a ban as Telegram does: a ban shorter than 30 seconds or longer than 366
   * days lasts until it is lifted.
   */
  #normalizeBanEnd(
    requestedBanEndUnixSeconds: number | undefined,
  ): { readonly bannedUntilUnixSeconds?: number } {
    const bannedUntilUnixSeconds = this.#normalizeTemporaryStatusEnd(requestedBanEndUnixSeconds);
    return bannedUntilUnixSeconds === undefined ? {} : { bannedUntilUnixSeconds };
  }

  /** Resolves the end of a restriction as `#normalizeBanEnd` resolves a ban's. */
  #normalizeRestrictionEnd(
    requestedRestrictionEndUnixSeconds: number | undefined,
  ): { readonly restrictedUntilUnixSeconds?: number } {
    const restrictedUntilUnixSeconds = this.#normalizeTemporaryStatusEnd(
      requestedRestrictionEndUnixSeconds,
    );
    return restrictedUntilUnixSeconds === undefined ? {} : { restrictedUntilUnixSeconds };
  }

  /**
   * Resolves when a ban or restriction ends as TDLib's `get_dialog_participant_status` does: one
   * shorter than 30 seconds or longer than 366 days lasts until it is lifted, which `undefined`
   * stands for.
   */
  #normalizeTemporaryStatusEnd(requestedEndUnixSeconds: number | undefined): number | undefined {
    if (requestedEndUnixSeconds === undefined) {
      return undefined;
    }
    const durationSeconds = requestedEndUnixSeconds - this.#currentUnixTimeSeconds();
    return durationSeconds < MIN_TEMPORARY_STATUS_DURATION_SECONDS ||
        durationSeconds > MAX_TEMPORARY_STATUS_DURATION_SECONDS
      ? undefined
      : requestedEndUnixSeconds;
  }

  /** Resolves a bot that asks about a supergroup, which it must be a member of. */
  #resolveBotObserver({ observerBotId, chatId }: ChatMemberQueryInput):
    | {
      readonly resolved: true;
      readonly supergroup: Supergroup;
      readonly membership: ChatMembership;
    }
    | {
      readonly resolved: false;
      readonly reason: 'bot_not_found' | SupergroupBotAccessFailureReason;
    } {
    if (this.#bots.getById(observerBotId) === undefined) {
      return { resolved: false, reason: 'bot_not_found' };
    }
    return resolveSupergroupBotMembership(this.#sharedChats, observerBotId, chatId);
  }

  /** The owner and administrators of a chat: the owner, then the others in the order they joined. */
  #listAdministratorStandings(chatId: number): readonly {
    readonly userId: number;
    readonly status: Extract<ChatMembership, { status: 'owner' }> | AdministratorMembership;
  }[] {
    const standings = this.#sharedChats.getChatMemberIds(chatId).flatMap((userId) => {
      const status = this.#sharedChats.getChatMembership(chatId, userId);
      return status?.status === 'owner' || status?.status === 'administrator'
        ? [{ userId, status }]
        : [];
    });
    return [
      ...standings.filter(({ status }) => status.status === 'owner'),
      ...standings.filter(({ status }) => status.status === 'administrator'),
    ];
  }

  /** A user's standing in a chat; a user that never joined it has `left` it. */
  #lookUpChatMemberStatus(chatId: number, userId: number): ChatMemberStatus {
    return this.#sharedChats.getChatMembership(chatId, userId) ??
      this.#sharedChats.getFormerMemberStatus(chatId, userId) ?? LEFT_CHAT_MEMBER_STATUS;
  }

  /** Ends a current membership that is not the owner's, then publishes and records the change. */
  #endMembership(
    chat: SharedChat,
    { actor, memberId, membership, statusAfterLeaving }: {
      /** The member itself when it leaves, or the account or bot that removes it. */
      readonly actor: SupergroupMessageAuthor;
      readonly memberId: number;
      /** The membership that ends. */
      readonly membership: ChatMembership;
      readonly statusAfterLeaving: FormerChatMemberStatus;
    },
  ): void {
    const removal = this.#sharedChats.removeChatMember(chat.id, memberId, statusAfterLeaving);
    if (!removal.removed) {
      throw new Error(
        `Member ${memberId} of chat ${chat.id} could not be removed: ${removal.reason}`,
      );
    }
    const leftAtUnixSeconds = this.#currentUnixTimeSeconds();
    this.#events.publish({
      type: 'chat_member_status_changed',
      chat,
      actorId: actor.kind === 'account' ? actor.accountId : actor.botId,
      memberId,
      oldStatus: membership,
      newStatus: statusAfterLeaving,
      changedAtUnixSeconds: leftAtUnixSeconds,
    });
    this.#recordSupergroupServiceMessage(chat, {
      author: actor,
      content: { kind: 'member_left', memberId },
      changedAtUnixSeconds: leftAtUnixSeconds,
    });
  }

  #recordSupergroupServiceMessage(
    chat: SharedChat,
    change: {
      readonly author: SupergroupMessageAuthor;
      readonly content: SupergroupServiceContent;
      readonly changedAtUnixSeconds: number;
    },
  ): void {
    if (chat.kind === 'supergroup') {
      this.#supergroupMessages.recordServiceMessage({ chatId: chat.id, ...change });
    }
  }

  /** Identifies a user as an account or a bot, as service messages name their authors. */
  #identifyUser(userId: number): SupergroupMessageAuthor | undefined {
    if (this.#accounts.getById(userId) !== undefined) {
      return { kind: 'account', accountId: userId };
    }
    return this.#bots.getById(userId) === undefined ? undefined : { kind: 'bot', botId: userId };
  }

  #validateBasicGroupParticipants(
    input: CreateBasicGroupInput,
  ): BasicGroupParticipantValidationFailureReason | undefined {
    if (this.#accounts.getById(input.creatorAccountId) === undefined) {
      return 'creator_account_not_found';
    }

    const participantIds = new Set([input.creatorAccountId]);
    for (const initialMemberId of input.initialMemberIds) {
      if (participantIds.has(initialMemberId)) {
        return 'initial_members_not_unique';
      }
      participantIds.add(initialMemberId);
    }
    for (const initialMemberId of input.initialMemberIds) {
      if (
        this.#accounts.getById(initialMemberId) === undefined &&
        this.#bots.getById(initialMemberId) === undefined
      ) {
        return 'initial_member_not_found';
      }
    }

    return undefined;
  }

  #reserveSharedChatId(kind: SharedChat['kind']): number | undefined {
    const identityReservation = this.#identities.reserveIdentity({ kind });
    if (!identityReservation.reserved) {
      if (identityReservation.reason !== 'identity_limit_reached') {
        throw new Error(
          `${kind} identity reservation failed unexpectedly: ${identityReservation.reason}`,
        );
      }
      return undefined;
    }
    if (identityReservation.identity.kind !== kind) {
      throw new Error(`${kind} identity reservation returned a different identity kind`);
    }

    return identityReservation.identity.id;
  }
}
