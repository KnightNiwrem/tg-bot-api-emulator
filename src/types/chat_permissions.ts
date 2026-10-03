import {
  listRichMessageFiles,
  type RichMessage,
  type RichMessageFileTypes,
} from './rich_message.ts';

/**
 * What a supergroup lets its members do, by the Bot API's `ChatPermissions` names and in the order
 * the official Bot API server's `json_store_permissions` shows them. `can_send_media_messages` is
 * left out: the Bot API derives it from the media permissions, and TDLib stores no such permission.
 */
export const CHAT_PERMISSIONS = [
  'can_send_messages',
  'can_send_audios',
  'can_send_documents',
  'can_send_photos',
  'can_send_videos',
  'can_send_video_notes',
  'can_send_voice_notes',
  'can_send_polls',
  'can_send_other_messages',
  'can_add_web_page_previews',
  'can_react_to_messages',
  'can_edit_tag',
  'can_change_info',
  'can_invite_users',
  'can_pin_messages',
  'can_manage_topics',
] as const;

export type ChatPermission = typeof CHAT_PERMISSIONS[number];

/** The permissions granted, by name; a permission left out is withheld. */
export type ChatPermissions = ReadonlySet<ChatPermission>;

/** Every permission, which a supergroup grants its members until someone restricts them. */
export const ALL_CHAT_PERMISSIONS: ChatPermissions = new Set(CHAT_PERMISSIONS);

/**
 * The permissions that are also administrator rights of the same name, TDLib's
 * `ALL_ADMIN_PERMISSION_RIGHTS`. Default permissions grant them to administrators that are
 * accounts, but never to bots, which need the administrator right itself.
 */
export const ADMINISTRATOR_RIGHT_PERMISSIONS = [
  'can_change_info',
  'can_invite_users',
  'can_pin_messages',
  'can_manage_topics',
] as const satisfies readonly ChatPermission[];

export type AdministratorRightPermission = typeof ADMINISTRATOR_RIGHT_PERMISSIONS[number];

/** Whether a permission is also an administrator right, as `ADMINISTRATOR_RIGHT_PERMISSIONS` lists. */
export function isAdministratorRightPermission(
  permission: ChatPermission,
): permission is AdministratorRightPermission {
  return (ADMINISTRATOR_RIGHT_PERMISSIONS as readonly ChatPermission[]).includes(permission);
}

/** Whether two sets grant the same permissions. */
export function isSameChatPermissions(first: ChatPermissions, second: ChatPermissions): boolean {
  return first.size === second.size && [...first].every((permission) => second.has(permission));
}

/**
 * Content whose sending a permission governs: the kinds of message content the emulator supports,
 * with a rich message's blocks, whose photos and documents need their own permissions.
 */
export type PermissionGovernedContent =
  | {
    readonly kind:
      | 'text'
      | 'photo'
      | 'document'
      | 'video'
      | 'voice'
      | 'poll'
      | 'contact'
      | 'location';
  }
  | { readonly kind: 'rich_message'; readonly richMessage: RichMessage<RichMessageFileTypes> };

/**
 * The permissions a member needs to send content, as TDLib's `can_send_message_content` requires
 * them: one per media kind, `can_send_messages` for text, contacts, and locations, and, as
 * `RichMessage::can_send` and each block's `can_send` require, `can_send_messages` and the
 * permission of every photo and document a rich message shows.
 */
export function getContentSendPermissions(
  content: PermissionGovernedContent,
): readonly ChatPermission[] {
  switch (content.kind) {
    case 'text':
    case 'contact':
    case 'location':
      return ['can_send_messages'];
    case 'photo':
      return ['can_send_photos'];
    case 'document':
      return ['can_send_documents'];
    case 'video':
      return ['can_send_videos'];
    case 'voice':
      return ['can_send_voice_notes'];
    case 'poll':
      return ['can_send_polls'];
    case 'rich_message': {
      const permissions = new Set<ChatPermission>(['can_send_messages']);
      for (const file of listRichMessageFiles(content.richMessage)) {
        permissions.add(file.kind === 'photo' ? 'can_send_photos' : 'can_send_documents');
      }
      return [...permissions];
    }
    default: {
      const unhandledContent: never = content;
      throw new Error(`Unhandled permission-governed content: ${JSON.stringify(unhandledContent)}`);
    }
  }
}
