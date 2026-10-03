import type { BotApiChatPermissions } from '../types/bot_api.ts';
import type { ChatPermission, ChatPermissions } from '../types/chat_permissions.ts';

/**
 * Shows permissions as the official Bot API server's `json_store_permissions` does, every one
 * granted or not and in its order, with `can_send_media_messages` granted when any media
 * permission is.
 */
export function projectChatPermissions(permissions: ChatPermissions): BotApiChatPermissions {
  const grants = (permission: ChatPermission) => permissions.has(permission);
  return {
    can_send_messages: grants('can_send_messages'),
    can_send_media_messages: grants('can_send_audios') || grants('can_send_documents') ||
      grants('can_send_photos') || grants('can_send_videos') || grants('can_send_video_notes') ||
      grants('can_send_voice_notes'),
    can_send_audios: grants('can_send_audios'),
    can_send_documents: grants('can_send_documents'),
    can_send_photos: grants('can_send_photos'),
    can_send_videos: grants('can_send_videos'),
    can_send_video_notes: grants('can_send_video_notes'),
    can_send_voice_notes: grants('can_send_voice_notes'),
    can_send_polls: grants('can_send_polls'),
    can_send_other_messages: grants('can_send_other_messages'),
    can_add_web_page_previews: grants('can_add_web_page_previews'),
    can_react_to_messages: grants('can_react_to_messages'),
    can_edit_tag: grants('can_edit_tag'),
    can_change_info: grants('can_change_info'),
    can_invite_users: grants('can_invite_users'),
    can_pin_messages: grants('can_pin_messages'),
    can_manage_topics: grants('can_manage_topics'),
  };
}
