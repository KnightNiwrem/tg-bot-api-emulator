import type {
  BotApiAcceptedGiftTypes,
  BotApiPinnedPrivateMessage,
  BotApiPinnedSupergroupMessage,
  BotApiPrivateChatFullInfo,
  BotApiSupergroupChatFullInfo,
} from '../types/bot_api.ts';
import type { VirtualAccount } from '../types/virtual_account.ts';
import type { Supergroup } from '../types/virtual_chat.ts';
import { projectChatPermissions } from './bot_api_chat_permissions.ts';

/**
 * How many different reactions a message may carry, TDLib's `reactions_uniq_max` default that
 * `ChatReactions::get_chat_available_reactions_object` reports for chats that allow every
 * reaction, as the emulator's chats do.
 */
const MAX_REACTION_COUNT = 11;

/** The number of built-in accent colors, from which TDLib picks a default by chat identity. */
const BUILT_IN_ACCENT_COLOR_COUNT = 7;

/** Bot API supergroup IDs are the negated channel ID offset by 10^12. */
const SUPERGROUP_CHAT_ID_OFFSET = 1_000_000_000_000;

/**
 * A private chat with an account, as the official Bot API server's `JsonChat` shows its full
 * information, and in its field order. The account has no bio, photo, birthdate or business
 * profile, so those fields are omitted, and, as TDLib's default gift settings do, it accepts
 * every kind of gift. `JsonChat` shows the chat's newest pinned message without its reply.
 */
export function projectPrivateChatFullInfo(
  { profile, hasPrivateForwards }: VirtualAccount,
  pinnedMessage: BotApiPinnedPrivateMessage | undefined,
): BotApiPrivateChatFullInfo {
  const { id, first_name, last_name, username } = profile;
  return {
    id,
    first_name,
    ...(last_name === undefined ? {} : { last_name }),
    ...(username === undefined ? {} : { username }),
    type: 'private',
    can_send_gift: true,
    ...(username === undefined ? {} : { active_usernames: [username] }),
    ...(hasPrivateForwards ? { has_private_forwards: true } : {}),
    accepted_gift_types: acceptedGiftTypes(true),
    ...(pinnedMessage === undefined ? {} : { pinned_message: pinnedMessage }),
    max_reaction_count: MAX_REACTION_COUNT,
    // TDLib's `AccentColorId(UserId)`, for a user that chose no accent color.
    accent_color_id: id % BUILT_IN_ACCENT_COLOR_COUNT,
  };
}

/**
 * A supergroup, as the official Bot API server's `JsonChat` shows its full information, and in its
 * field order. Its `permissions` are its default permissions, and its other fields are those of a
 * supergroup that no one has configured beyond what the emulator models:
 *
 * - New members see earlier messages, as they do in the emulator, so its history is visible.
 * - As TDLib documents for `supergroup.join_to_send_messages`, only discussion groups let
 *   non-members write, and the emulator has none.
 * - Gifts cannot be sent to it, so it accepts none, as `JsonChat` derives from `can_send_gift`.
 *
 * As for a private chat, `JsonChat` shows the newest pinned message without its reply. It shows
 * the observing administrator's own primary invite link, whole, which `primaryInviteLinkUrl`
 * omits when the observer has none to show.
 */
export function projectSupergroupChatFullInfo(
  { id, title, username, description, hasProtectedContent, defaultPermissions }: Supergroup,
  pinnedMessage: BotApiPinnedSupergroupMessage | undefined,
  primaryInviteLinkUrl: string | undefined,
): BotApiSupergroupChatFullInfo {
  const channelId = -id - SUPERGROUP_CHAT_ID_OFFSET;
  return {
    id,
    title,
    ...(username === undefined ? {} : { username }),
    type: 'supergroup',
    ...(username === undefined ? {} : { active_usernames: [username] }),
    ...(description === undefined || description.length === 0 ? {} : { description }),
    ...(primaryInviteLinkUrl === undefined ? {} : { invite_link: primaryInviteLinkUrl }),
    has_visible_history: true,
    permissions: projectChatPermissions(defaultPermissions),
    join_to_send_messages: true,
    accepted_gift_types: acceptedGiftTypes(false),
    ...(pinnedMessage === undefined ? {} : { pinned_message: pinnedMessage }),
    max_reaction_count: MAX_REACTION_COUNT,
    // TDLib's `AccentColorId(ChannelId)`, for a supergroup that chose no accent color.
    accent_color_id: channelId % BUILT_IN_ACCENT_COLOR_COUNT,
    ...(hasProtectedContent ? { has_protected_content: true } : {}),
  };
}

function acceptedGiftTypes(acceptsGifts: boolean): BotApiAcceptedGiftTypes {
  return {
    unlimited_gifts: acceptsGifts,
    limited_gifts: acceptsGifts,
    unique_gifts: acceptsGifts,
    premium_subscription: acceptsGifts,
    gifts_from_channels: acceptsGifts,
  };
}
