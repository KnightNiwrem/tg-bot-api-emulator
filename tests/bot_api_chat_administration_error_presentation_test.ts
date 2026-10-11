import { botChatAccessFailureAnswer } from '../src/api/sessions/bot_api/chat_access.ts';
import { presentChatInfoChangeFailure } from '../src/api/sessions/bot_api/errors/chat_info_failure_presenter.ts';
import { presentChatInviteLinkFailure } from '../src/api/sessions/bot_api/errors/chat_invite_link_failure_presenter.ts';
import { presentChatJoinRequestFailure } from '../src/api/sessions/bot_api/errors/chat_join_request_failure_presenter.ts';
import { presentChatMemberFailure } from '../src/api/sessions/bot_api/errors/chat_member_failure_presenter.ts';
import type { EmulationSession } from '../src/session/emulation_session.ts';
import {
  type CasesByReason,
  expectPresentations,
  SUPERGROUP_ACCESS_CASES,
} from './support/bot_api_error_presentation.ts';

// The families that administer chats: their information, their members, their invite links and
// the requests to join them. Each case is Telegram's literal answer.

type BotApi = EmulationSession['botApi'];

type ChatReadFailure = Extract<ReturnType<BotApi['getChat']>, { readonly found: false }>;
type ChatTitleChangeFailure = Extract<ReturnType<BotApi['setChatTitle']>, { readonly set: false }>;
type ChatDescriptionChangeFailure = Extract<
  ReturnType<BotApi['setChatDescription']>,
  { readonly set: false }
>;
type ChatPermissionsChangeFailure = Extract<
  ReturnType<BotApi['setChatPermissions']>,
  { readonly set: false }
>;
type MemberLookupFailure = Extract<
  ReturnType<
    BotApi['getChatMember'] | BotApi['getChatAdministrators'] | BotApi['getChatMemberCount']
  >,
  { readonly found: false }
>;
type ChatLeaveFailure = Extract<ReturnType<BotApi['leaveChat']>, { readonly left: false }>;
type BanFailure = Extract<ReturnType<BotApi['banChatMember']>, { readonly banned: false }>;
type UnbanFailure = Extract<ReturnType<BotApi['unbanChatMember']>, { readonly unbanned: false }>;
type RestrictionFailure = Extract<
  ReturnType<BotApi['restrictChatMember']>,
  { readonly restricted: false }
>;
type PromotionFailure = Extract<
  ReturnType<BotApi['promoteChatMember']>,
  { readonly promoted: false }
>;
type CustomTitleChangeFailure = Extract<
  ReturnType<BotApi['setChatAdministratorCustomTitle']>,
  { readonly set: false }
>;
type InviteLinkExportFailure = Extract<
  ReturnType<BotApi['exportChatInviteLink']>,
  { readonly exported: false }
>;
type InviteLinkCreationFailure = Extract<
  ReturnType<BotApi['createChatInviteLink']>,
  { readonly created: false }
>;
type InviteLinkEditFailure = Extract<
  ReturnType<BotApi['editChatInviteLink']>,
  { readonly edited: false }
>;
type InviteLinkRevocationFailure = Extract<
  ReturnType<BotApi['revokeChatInviteLink']>,
  { readonly revoked: false }
>;
type JoinRequestDecisionFailure = Extract<
  ReturnType<BotApi['approveChatJoinRequest'] | BotApi['declineChatJoinRequest']>,
  { readonly decided: false }
>;

const STRINGS_NOT_UTF8 = [400, 'Bad Request: strings must be encoded in UTF-8'] as const;
const TEXT_ENCODING_CASES = {
  text_encoding_invalid: [[{ reason: 'text_encoding_invalid' }, ...STRINGS_NOT_UTF8]],
} as const;

const CHAT_READ_CASES: CasesByReason<ChatReadFailure, 'found'> = SUPERGROUP_ACCESS_CASES;

const CHAT_TITLE_CHANGE_CASES: CasesByReason<ChatTitleChangeFailure, 'set'> = {
  ...SUPERGROUP_ACCESS_CASES,
  ...TEXT_ENCODING_CASES,
  private_chat_info_unchangeable: [
    [
      { reason: 'private_chat_info_unchangeable' },
      400,
      "Bad Request: can't change private chat title",
    ],
  ],
  not_enough_rights: [
    [{ reason: 'not_enough_rights' }, 400, 'Bad Request: not enough rights to change chat title'],
  ],
  title_empty: [[{ reason: 'title_empty' }, 400, 'Bad Request: title must be non-empty']],
};

const CHAT_DESCRIPTION_CHANGE_CASES: CasesByReason<ChatDescriptionChangeFailure, 'set'> = {
  ...SUPERGROUP_ACCESS_CASES,
  ...TEXT_ENCODING_CASES,
  private_chat_info_unchangeable: [
    [
      { reason: 'private_chat_info_unchangeable' },
      400,
      "Bad Request: can't change private chat description",
    ],
  ],
  not_enough_rights: [
    [
      { reason: 'not_enough_rights' },
      400,
      'Bad Request: not enough rights to set chat description',
    ],
  ],
  description_not_modified: [
    [{ reason: 'description_not_modified' }, 400, 'Bad Request: chat description is not modified'],
  ],
};

const CHAT_PERMISSIONS_CHANGE_CASES: CasesByReason<ChatPermissionsChangeFailure, 'set'> = {
  ...SUPERGROUP_ACCESS_CASES,
  private_chat_permissions_unchangeable: [
    [
      { reason: 'private_chat_permissions_unchangeable' },
      400,
      "Bad Request: can't change private chat permissions",
    ],
  ],
  not_enough_rights: [
    [
      { reason: 'not_enough_rights' },
      400,
      'Bad Request: not enough rights to change chat permissions',
    ],
  ],
};

const MEMBER_NOT_FOUND = [400, 'Bad Request: member not found'] as const;
const NOT_ENOUGH_RIGHTS_TO_RESTRICT = [
  400,
  'Bad Request: not enough rights to restrict/unrestrict chat member',
] as const;
const CHAT_OWNER_NOT_REMOVABLE = [400, "Bad Request: can't remove chat owner"] as const;
const MEMBER_IS_ADMINISTRATOR = [
  400,
  'Bad Request: user is an administrator of the chat',
] as const;
const ONLY_IN_SUPERGROUP_AND_CHANNEL_CHATS = [
  400,
  'Bad Request: method is available only in supergroup and channel chats',
] as const;
const CANNOT_RESTRICT_SELF = [400, "Bad Request: can't restrict self"] as const;

const MEMBER_LOOKUP_CASES: CasesByReason<MemberLookupFailure, 'found'> = {
  ...SUPERGROUP_ACCESS_CASES,
  member_not_found: [[{ reason: 'member_not_found' }, ...MEMBER_NOT_FOUND]],
  private_chat_has_no_administrators: [
    [
      { reason: 'private_chat_has_no_administrators' },
      400,
      'Bad Request: there are no administrators in the private chat',
    ],
  ],
};

const CHAT_LEAVE_CASES: CasesByReason<ChatLeaveFailure, 'left'> = {
  ...SUPERGROUP_ACCESS_CASES,
  private_chat_not_leavable: [
    [{ reason: 'private_chat_not_leavable' }, 400, "Bad Request: can't leave private chats"],
  ],
};

/** The failures that banning, unbanning and restricting share. */
const MODERATION_CASES = {
  ...SUPERGROUP_ACCESS_CASES,
  member_not_found: [[{ reason: 'member_not_found' }, ...MEMBER_NOT_FOUND]],
  member_is_owner: [[{ reason: 'member_is_owner' }, ...CHAT_OWNER_NOT_REMOVABLE]],
  not_enough_rights: [[{ reason: 'not_enough_rights' }, ...NOT_ENOUGH_RIGHTS_TO_RESTRICT]],
  member_is_administrator: [[{ reason: 'member_is_administrator' }, ...MEMBER_IS_ADMINISTRATOR]],
} as const;

const BAN_CASES: CasesByReason<BanFailure, 'banned'> = {
  ...MODERATION_CASES,
  cannot_restrict_self: [[{ reason: 'cannot_restrict_self' }, ...CANNOT_RESTRICT_SELF]],
  private_chat_members_not_bannable: [
    [
      { reason: 'private_chat_members_not_bannable' },
      400,
      "Bad Request: can't ban members in private chats",
    ],
  ],
};

const UNBAN_CASES: CasesByReason<UnbanFailure, 'unbanned'> = {
  ...MODERATION_CASES,
  method_unavailable_in_private_chats: [
    [{ reason: 'method_unavailable_in_private_chats' }, ...ONLY_IN_SUPERGROUP_AND_CHANNEL_CHATS],
  ],
};

const RESTRICTION_CASES: CasesByReason<RestrictionFailure, 'restricted'> = {
  ...MODERATION_CASES,
  cannot_restrict_self: [[{ reason: 'cannot_restrict_self' }, ...CANNOT_RESTRICT_SELF]],
  cannot_unrestrict_self: [
    [{ reason: 'cannot_unrestrict_self' }, 400, "Bad Request: can't unrestrict self"],
  ],
  not_enough_rights_to_promote: [
    [{ reason: 'not_enough_rights_to_promote' }, 400, 'Bad Request: not enough rights'],
  ],
  method_unavailable_outside_supergroups: [
    [
      { reason: 'method_unavailable_outside_supergroups' },
      400,
      'Bad Request: method is available only in supergroups',
    ],
  ],
};

const PROMOTION_CASES: CasesByReason<PromotionFailure, 'promoted'> = {
  ...SUPERGROUP_ACCESS_CASES,
  member_not_found: [[{ reason: 'member_not_found' }, ...MEMBER_NOT_FOUND]],
  member_is_owner: [[{ reason: 'member_is_owner' }, ...CHAT_OWNER_NOT_REMOVABLE]],
  cannot_promote_self: [
    [{ reason: 'cannot_promote_self' }, 400, "Bad Request: can't promote self"],
  ],
  not_enough_rights_to_promote: [
    [{ reason: 'not_enough_rights_to_promote' }, 400, 'Bad Request: not enough rights'],
  ],
  not_enough_rights: [[{ reason: 'not_enough_rights' }, ...NOT_ENOUGH_RIGHTS_TO_RESTRICT]],
  cannot_unrestrict_self: [
    [{ reason: 'cannot_unrestrict_self' }, 400, "Bad Request: can't unrestrict self"],
  ],
  member_not_in_chat: [
    [{ reason: 'member_not_in_chat' }, 400, 'Bad Request: USER_NOT_MUTUAL_CONTACT'],
  ],
  member_kicked: [[{ reason: 'member_kicked' }, 400, 'Bad Request: USER_KICKED']],
  member_is_administrator: [[{ reason: 'member_is_administrator' }, ...MEMBER_IS_ADMINISTRATOR]],
  rights_not_held: [[{ reason: 'rights_not_held' }, 400, 'Bad Request: RIGHT_FORBIDDEN']],
  bots_cannot_add_members: [
    [{ reason: 'bots_cannot_add_members' }, 400, "Bad Request: bots can't add new chat members"],
  ],
  method_unavailable_in_private_chats: [
    [{ reason: 'method_unavailable_in_private_chats' }, ...ONLY_IN_SUPERGROUP_AND_CHANNEL_CHATS],
  ],
};

const CUSTOM_TITLE_CHANGE_CASES: CasesByReason<CustomTitleChangeFailure, 'set'> = {
  ...SUPERGROUP_ACCESS_CASES,
  ...TEXT_ENCODING_CASES,
  member_not_found: [[{ reason: 'member_not_found' }, ...MEMBER_NOT_FOUND]],
  member_is_owner: [
    [
      { reason: 'member_is_owner' },
      400,
      'Bad Request: only the owner can edit their custom title',
    ],
  ],
  member_is_not_administrator: [
    [{ reason: 'member_is_not_administrator' }, 400, 'Bad Request: user is not an administrator'],
  ],
  custom_title_not_editable: [
    [
      { reason: 'custom_title_not_editable' },
      400,
      'Bad Request: not enough rights to change custom title of the user',
    ],
  ],
  custom_title_too_long: [
    [{ reason: 'custom_title_too_long' }, 400, 'Bad Request: CUSTOM_TITLE_INVALID'],
  ],
  custom_title_contains_emoji: [
    [
      { reason: 'custom_title_contains_emoji' },
      400,
      'Bad Request: CUSTOM_TITLE_EMOJI_NOT_ALLOWED',
    ],
  ],
  method_unavailable_outside_groups: [
    [
      { reason: 'method_unavailable_outside_groups' },
      400,
      'Bad Request: method is available only in groups and supergroups',
    ],
  ],
};

/** The failures every invite link method shares. */
const INVITE_LINK_MANAGEMENT_CASES = {
  ...SUPERGROUP_ACCESS_CASES,
  private_chat_has_no_invite_links: [
    [
      { reason: 'private_chat_has_no_invite_links' },
      400,
      "Bad Request: can't invite members to a private chat",
    ],
  ],
  not_enough_rights: [
    [
      { reason: 'not_enough_rights' },
      400,
      'Bad Request: not enough rights to manage chat invite link',
    ],
  ],
} as const;

/** The failures of the settings a created or edited link takes. */
const INVITE_LINK_SETTINGS_CASES = {
  ...TEXT_ENCODING_CASES,
  member_limit_with_join_request: [
    [
      { reason: 'member_limit_with_join_request' },
      400,
      "Bad Request: member limit can't be specified for links requiring administrator approval",
    ],
  ],
  expiry_date_invalid: [
    [{ reason: 'expiry_date_invalid' }, 400, 'Bad Request: EXPIRE_DATE_INVALID'],
  ],
  member_limit_invalid: [
    [{ reason: 'member_limit_invalid' }, 400, 'Bad Request: USAGE_LIMIT_INVALID'],
  ],
} as const;

const INVITE_LINK_UNAVAILABLE = [400, 'Bad Request: INVITE_HASH_EXPIRED'] as const;

/** The failures of an existing link that is edited or revoked. */
const EXISTING_INVITE_LINK_CASES = {
  invite_link_empty: [
    [{ reason: 'invite_link_empty' }, 400, 'Bad Request: invite link must be non-empty'],
  ],
  invite_link_not_found: [[{ reason: 'invite_link_not_found' }, ...INVITE_LINK_UNAVAILABLE]],
  invite_link_revoked: [[{ reason: 'invite_link_revoked' }, ...INVITE_LINK_UNAVAILABLE]],
  not_the_link_creator: [
    [{ reason: 'not_the_link_creator' }, 400, 'Bad Request: CHAT_ADMIN_REQUIRED'],
  ],
} as const;

const INVITE_LINK_EXPORT_CASES: CasesByReason<InviteLinkExportFailure, 'exported'> =
  INVITE_LINK_MANAGEMENT_CASES;

const INVITE_LINK_CREATION_CASES: CasesByReason<InviteLinkCreationFailure, 'created'> = {
  ...INVITE_LINK_MANAGEMENT_CASES,
  ...INVITE_LINK_SETTINGS_CASES,
};

const INVITE_LINK_EDIT_CASES: CasesByReason<InviteLinkEditFailure, 'edited'> = {
  ...INVITE_LINK_MANAGEMENT_CASES,
  ...INVITE_LINK_SETTINGS_CASES,
  ...EXISTING_INVITE_LINK_CASES,
  primary_invite_link_not_editable: [
    [{ reason: 'primary_invite_link_not_editable' }, 400, 'Bad Request: CHAT_INVITE_PERMANENT'],
  ],
};

const INVITE_LINK_REVOCATION_CASES: CasesByReason<InviteLinkRevocationFailure, 'revoked'> = {
  ...INVITE_LINK_MANAGEMENT_CASES,
  ...TEXT_ENCODING_CASES,
  ...EXISTING_INVITE_LINK_CASES,
};

const JOIN_REQUEST_DECISION_CASES: CasesByReason<JoinRequestDecisionFailure, 'decided'> = {
  ...SUPERGROUP_ACCESS_CASES,
  private_chat_has_no_join_requests: [
    [
      { reason: 'private_chat_has_no_join_requests' },
      400,
      "Bad Request: the chat can't have join requests",
    ],
  ],
  not_enough_rights: [
    [
      { reason: 'not_enough_rights' },
      400,
      'Bad Request: not enough rights to manage chat join requests',
    ],
  ],
  already_a_member: [[
    { reason: 'already_a_member' },
    400,
    'Bad Request: USER_ALREADY_PARTICIPANT',
  ]],
  join_request_missing: [
    [{ reason: 'join_request_missing' }, 400, 'Bad Request: HIDE_REQUESTER_MISSING'],
  ],
};

Deno.test('the chat information family answers every failure as Telegram does', () => {
  expectPresentations(
    CHAT_READ_CASES,
    (failure) => botChatAccessFailureAnswer(failure.reason),
    'chat_read',
  );
  expectPresentations(
    CHAT_TITLE_CHANGE_CASES,
    (failure) => presentChatInfoChangeFailure('chat_title_change', { set: false, ...failure }),
    'chat_title_change',
  );
  expectPresentations(
    CHAT_DESCRIPTION_CHANGE_CASES,
    (failure) =>
      presentChatInfoChangeFailure('chat_description_change', { set: false, ...failure }),
    'chat_description_change',
  );
  expectPresentations(
    CHAT_PERMISSIONS_CHANGE_CASES,
    (failure) =>
      presentChatInfoChangeFailure('chat_permissions_change', { set: false, ...failure }),
    'chat_permissions_change',
  );
});

Deno.test('the chat member family answers every failure as Telegram does', () => {
  expectPresentations(
    MEMBER_LOOKUP_CASES,
    (failure) => presentChatMemberFailure('member_lookup', { found: false, ...failure }),
    'member_lookup',
  );
  expectPresentations(
    CHAT_LEAVE_CASES,
    (failure) => presentChatMemberFailure('chat_leave', { left: false, ...failure }),
    'chat_leave',
  );
  expectPresentations(
    BAN_CASES,
    (failure) => presentChatMemberFailure('member_moderation', { banned: false, ...failure }),
    'member_moderation ban',
  );
  expectPresentations(
    UNBAN_CASES,
    (failure) => presentChatMemberFailure('member_moderation', { unbanned: false, ...failure }),
    'member_moderation unban',
  );
  expectPresentations(
    RESTRICTION_CASES,
    (failure) => presentChatMemberFailure('member_moderation', { restricted: false, ...failure }),
    'member_moderation restriction',
  );
  expectPresentations(
    PROMOTION_CASES,
    (failure) => presentChatMemberFailure('member_promotion', { promoted: false, ...failure }),
    'member_promotion',
  );
  expectPresentations(
    CUSTOM_TITLE_CHANGE_CASES,
    (failure) => presentChatMemberFailure('custom_title_change', { set: false, ...failure }),
    'custom_title_change',
  );
});

Deno.test('the invite link family answers every failure as Telegram does', () => {
  expectPresentations(
    INVITE_LINK_EXPORT_CASES,
    (failure) => presentChatInviteLinkFailure({ exported: false, ...failure }),
    'invite_link_export',
  );
  expectPresentations(
    INVITE_LINK_CREATION_CASES,
    (failure) => presentChatInviteLinkFailure({ created: false, ...failure }),
    'invite_link_creation',
  );
  expectPresentations(
    INVITE_LINK_EDIT_CASES,
    (failure) => presentChatInviteLinkFailure({ edited: false, ...failure }),
    'invite_link_edit',
  );
  expectPresentations(
    INVITE_LINK_REVOCATION_CASES,
    (failure) => presentChatInviteLinkFailure({ revoked: false, ...failure }),
    'invite_link_revocation',
  );
});

Deno.test('the join request family answers every failure as Telegram does', () => {
  expectPresentations(
    JOIN_REQUEST_DECISION_CASES,
    (failure) => presentChatJoinRequestFailure({ decided: false, ...failure }),
    'join_request_decision',
  );
});
