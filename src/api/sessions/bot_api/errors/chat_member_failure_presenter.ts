import type { EmulationSession } from '../../../../session/emulation_session.ts';
import type { FormerSupergroupMemberFailureReason } from '../../../../types/chat_membership.ts';
import type { AuthenticatedBotFailure } from '../authenticated_bot_failures.ts';
import { BOT_CHAT_ACCESS_ERRORS } from '../chat_access.ts';
import type { BotApiMethodAnswer } from '../method_call.ts';
import { BOT_API_ERRORS } from './error_catalogue.ts';
import { type FixedBotApiError, presentFixedBotApiError } from './error_template.ts';

type SharedChatAdministration = EmulationSession['sharedChatAdministration'];

/** Why a bot cannot reach a supergroup's members: it is not one, or the chat does not exist. */
type ChatMemberAccessFailureReason = 'chat_not_found' | FormerSupergroupMemberFailureReason;

/** Why `getChatMember` found no member. */
export interface MemberReadFailure {
  readonly found: false;
  readonly reason: ChatMemberAccessFailureReason | 'member_not_found';
}

/** Why `getChatAdministrators` found no administrators. */
export interface AdministratorsReadFailure {
  readonly found: false;
  readonly reason: ChatMemberAccessFailureReason | 'private_chat_has_no_administrators';
}

/** Why `getChatMemberCount` counted no members. */
export interface MemberCountFailure {
  readonly found: false;
  readonly reason: ChatMemberAccessFailureReason;
}

/** Why `getChatMember`, `getChatAdministrators` or `getChatMemberCount` found nothing. */
type MemberLookupFailure = MemberReadFailure | AdministratorsReadFailure | MemberCountFailure;

/** Why `leaveChat` left no chat. */
export interface ChatLeaveFailure {
  readonly left: false;
  readonly reason:
    | 'chat_not_found'
    | FormerSupergroupMemberFailureReason
    | 'private_chat_not_leavable';
}

/** Why a bot cannot ban a user or lift its ban, as the Bot API reports it. */
type ChatMemberModerationFailureReason =
  | ChatMemberAccessFailureReason
  | 'member_not_found'
  | 'member_is_owner'
  | 'not_enough_rights'
  | 'member_is_administrator';

/** Why `banChatMember` banned no one. */
export interface MemberBanFailure {
  readonly banned: false;
  readonly reason:
    | ChatMemberModerationFailureReason
    | 'cannot_restrict_self'
    | 'private_chat_members_not_bannable';
}

/** Why `unbanChatMember` lifted no ban. */
export interface MemberUnbanFailure {
  readonly unbanned: false;
  readonly reason: ChatMemberModerationFailureReason | 'method_unavailable_in_private_chats';
}

/** Why `restrictChatMember` restricted no one. */
export interface MemberRestrictionFailure {
  readonly restricted: false;
  readonly reason:
    | ChatMemberModerationFailureReason
    | 'cannot_restrict_self'
    | 'cannot_unrestrict_self'
    | 'not_enough_rights_to_promote'
    | 'method_unavailable_outside_supergroups';
}

/** Why `banChatMember`, `unbanChatMember` or `restrictChatMember` changed no member. */
type MemberModerationFailure = MemberBanFailure | MemberUnbanFailure | MemberRestrictionFailure;

/** Why `promoteChatMember` changed no member. */
export type MemberPromotionFailure =
  | AuthenticatedBotFailure<
    Extract<
      ReturnType<SharedChatAdministration['promoteChatMemberAsBot']>,
      { readonly promoted: false }
    >
  >
  // A private chat, as `findPrivateChatRefusal` refuses it.
  | {
    readonly promoted: false;
    readonly reason: 'method_unavailable_in_private_chats' | 'chat_not_found';
  };

/** Why `setChatAdministratorCustomTitle` changed no title. */
export type CustomTitleChangeFailure =
  | AuthenticatedBotFailure<
    Extract<ReturnType<SharedChatAdministration['setCustomTitleAsBot']>, { readonly set: false }>
  >
  // A private chat, as `findPrivateChatRefusal` refuses it.
  | {
    readonly set: false;
    readonly reason: 'method_unavailable_outside_groups' | 'chat_not_found';
  };

/**
 * The operation of the chat member family that failed: reading members, leaving the chat,
 * banning, unbanning or restricting a member, promoting one, or changing an administrator's custom
 * title.
 */
type ChatMemberOperation =
  | 'member_lookup'
  | 'chat_leave'
  | 'member_moderation'
  | 'member_promotion'
  | 'custom_title_change';

/** Telegram's errors for the failures of the family that read alike in every operation. */
const FIXED_CHAT_MEMBER_ERRORS = {
  ...BOT_CHAT_ACCESS_ERRORS,
  text_encoding_invalid: BOT_API_ERRORS.stringsNotUtf8,
  member_not_found: BOT_API_ERRORS.memberNotFound,
  private_chat_has_no_administrators: BOT_API_ERRORS.privateChatHasNoAdministrators,
  private_chat_not_leavable: BOT_API_ERRORS.privateChatNotLeavable,
  private_chat_members_not_bannable: BOT_API_ERRORS.privateChatMembersNotBannable,
  method_unavailable_in_private_chats: BOT_API_ERRORS.methodUnavailableInPrivateChats,
  method_unavailable_outside_supergroups: BOT_API_ERRORS.methodUnavailableOutsideSupergroups,
  method_unavailable_outside_groups: BOT_API_ERRORS.methodUnavailableOutsideGroups,
  cannot_restrict_self: BOT_API_ERRORS.cannotRestrictSelf,
  cannot_unrestrict_self: BOT_API_ERRORS.cannotUnrestrictSelf,
  not_enough_rights: BOT_API_ERRORS.notEnoughRightsToRestrictMembers,
  not_enough_rights_to_promote: BOT_API_ERRORS.notEnoughRightsToPromoteMembers,
  member_is_administrator: BOT_API_ERRORS.memberIsAdministrator,
  cannot_promote_self: BOT_API_ERRORS.cannotPromoteSelf,
  member_not_in_chat: BOT_API_ERRORS.memberNotInChat,
  member_kicked: BOT_API_ERRORS.memberKicked,
  rights_not_held: BOT_API_ERRORS.rightsNotHeld,
  bots_cannot_add_members: BOT_API_ERRORS.botsCannotAddMembers,
  member_is_not_administrator: BOT_API_ERRORS.memberIsNotAdministrator,
  custom_title_not_editable: BOT_API_ERRORS.customTitleNotEditable,
  custom_title_too_long: BOT_API_ERRORS.customTitleInvalid,
  custom_title_contains_emoji: BOT_API_ERRORS.customTitleEmojiNotAllowed,
} as const satisfies Readonly<Record<string, FixedBotApiError>>;

/**
 * Telegram's error for a failure of the chat member family, in the context of its operation. The
 * owner cannot be moderated or promoted; only the owner itself may change the owner's custom title,
 * which the official server answers in its own words.
 */
export function presentChatMemberFailure(
  operation: 'member_lookup',
  failure: MemberLookupFailure,
): BotApiMethodAnswer;
export function presentChatMemberFailure(
  operation: 'chat_leave',
  failure: ChatLeaveFailure,
): BotApiMethodAnswer;
export function presentChatMemberFailure(
  operation: 'member_moderation',
  failure: MemberModerationFailure,
): BotApiMethodAnswer;
export function presentChatMemberFailure(
  operation: 'member_promotion',
  failure: MemberPromotionFailure,
): BotApiMethodAnswer;
export function presentChatMemberFailure(
  operation: 'custom_title_change',
  failure: CustomTitleChangeFailure,
): BotApiMethodAnswer;
export function presentChatMemberFailure(
  operation: ChatMemberOperation,
  failure:
    | MemberLookupFailure
    | ChatLeaveFailure
    | MemberModerationFailure
    | MemberPromotionFailure
    | CustomTitleChangeFailure,
): BotApiMethodAnswer {
  if (failure.reason === 'member_is_owner') {
    return presentFixedBotApiError(
      operation === 'custom_title_change'
        ? BOT_API_ERRORS.ownerCustomTitleNotEditable
        : BOT_API_ERRORS.chatOwnerNotRemovable,
    );
  }
  return presentFixedBotApiError(FIXED_CHAT_MEMBER_ERRORS[failure.reason]);
}
