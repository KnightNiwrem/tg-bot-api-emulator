/**
 * The rights a bot can ask for by default when it is added to a chat as an administrator, by the
 * Bot API's names in the order the official Bot API server reads them from `ChatAdministratorRights`.
 */
export const CHAT_ADMINISTRATOR_RIGHT_NAMES = [
  'can_manage_chat',
  'can_change_info',
  'can_post_messages',
  'can_edit_messages',
  'can_delete_messages',
  'can_invite_users',
  'can_restrict_members',
  'can_pin_messages',
  'can_manage_topics',
  'can_promote_members',
  'can_manage_video_chats',
  'can_post_stories',
  'can_edit_stories',
  'can_delete_stories',
  'can_manage_direct_messages',
  'can_manage_tags',
  'can_send_welcome_messages',
  'is_anonymous',
] as const;

export type ChatAdministratorRightName = typeof CHAT_ADMINISTRATOR_RIGHT_NAMES[number];

/** The kind of chat a bot's default administrator rights are for. */
export type DefaultAdministratorRightsChatKind = 'group' | 'channel';

/**
 * The rights that apply to each kind of chat, in the order the official Bot API server shows them
 * for supergroups and channels in `json_store_administrator_rights`.
 */
const APPLICABLE_ADMINISTRATOR_RIGHT_NAMES: {
  readonly [Kind in DefaultAdministratorRightsChatKind]: readonly ChatAdministratorRightName[];
} = {
  group: [
    'can_manage_chat',
    'can_change_info',
    'can_delete_messages',
    'can_invite_users',
    'can_restrict_members',
    'can_pin_messages',
    'can_manage_topics',
    'can_promote_members',
    'can_manage_video_chats',
    'can_post_stories',
    'can_edit_stories',
    'can_delete_stories',
    'can_manage_tags',
    'can_send_welcome_messages',
    'is_anonymous',
  ],
  channel: [
    'can_manage_chat',
    'can_change_info',
    'can_post_messages',
    'can_edit_messages',
    'can_delete_messages',
    'can_invite_users',
    'can_restrict_members',
    'can_promote_members',
    'can_manage_video_chats',
    'can_post_stories',
    'can_edit_stories',
    'can_delete_stories',
    'can_manage_direct_messages',
    'can_send_welcome_messages',
    'is_anonymous',
  ],
};

/** The rights a bot asks for by default in one kind of chat; empty for none. */
export type DefaultAdministratorRights = ReadonlySet<ChatAdministratorRightName>;

/**
 * Keeps the requested rights that TDLib's `AdministratorRights` keeps for a kind of chat: those
 * that apply to it, except anonymity in channels. As in TDLib, any right includes
 * `can_manage_chat`, so requesting no right requests none at all.
 */
export function normalizeDefaultAdministratorRights(
  kind: DefaultAdministratorRightsChatKind,
  requestedRights: Iterable<ChatAdministratorRightName>,
): DefaultAdministratorRights {
  const applicableRights: ReadonlySet<ChatAdministratorRightName> = new Set(
    APPLICABLE_ADMINISTRATOR_RIGHT_NAMES[kind],
  );
  const rights = new Set(
    [...requestedRights].filter((right) =>
      applicableRights.has(right) && !(kind === 'channel' && right === 'is_anonymous')
    ),
  );
  if (rights.size > 0) {
    rights.add('can_manage_chat');
  }
  return rights;
}

/**
 * Administrator rights as flags for every right that applies to a kind of chat, held or not, in
 * the order the official Bot API server's `json_store_administrator_rights` shows them.
 */
export function getApplicableAdministratorRightFlags(
  kind: DefaultAdministratorRightsChatKind,
  rights: DefaultAdministratorRights,
): { readonly [Right in ChatAdministratorRightName]?: boolean } {
  return Object.fromEntries(
    APPLICABLE_ADMINISTRATOR_RIGHT_NAMES[kind].map((right) => [right, rights.has(right)]),
  );
}
