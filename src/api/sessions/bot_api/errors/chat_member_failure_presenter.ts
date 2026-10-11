import type { EmulationSession } from '../../../../session/emulation_session.ts';
import { BOT_CHAT_ACCESS_ERRORS } from '../chat_access.ts';
import type { BotApiMethodAnswer } from '../method_call.ts';
import { BOT_API_ERRORS } from './error_catalogue.ts';
import { type FixedBotApiError, presentFixedBotApiError } from './error_template.ts';

type BotApi = EmulationSession['botApi'];

/** Why `getChatMember`, `getChatAdministrators` or `getChatMemberCount` found nothing. */
type MemberLookupFailure = Extract<
  ReturnType<
    BotApi['getChatMember'] | BotApi['getChatAdministrators'] | BotApi['getChatMemberCount']
  >,
  { readonly found: false }
>;

/** Why `leaveChat` left no chat. */
type ChatLeaveFailure = Extract<ReturnType<BotApi['leaveChat']>, { readonly left: false }>;

/** Why `banChatMember`, `unbanChatMember` or `restrictChatMember` changed no member. */
type MemberModerationFailure =
  | Extract<ReturnType<BotApi['banChatMember']>, { readonly banned: false }>
  | Extract<ReturnType<BotApi['unbanChatMember']>, { readonly unbanned: false }>
  | Extract<ReturnType<BotApi['restrictChatMember']>, { readonly restricted: false }>;

/** Why `promoteChatMember` changed no member. */
type MemberPromotionFailure = Extract<
  ReturnType<BotApi['promoteChatMember']>,
  { readonly promoted: false }
>;

/** Why `setChatAdministratorCustomTitle` changed no title. */
type CustomTitleChangeFailure = Extract<
  ReturnType<BotApi['setChatAdministratorCustomTitle']>,
  { readonly set: false }
>;

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
