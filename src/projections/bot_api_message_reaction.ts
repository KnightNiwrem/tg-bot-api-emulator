import type { BotApiMessageReactionUpdated, BotApiReactionTypeEmoji } from '../types/bot_api.ts';
import type { MessageReactionChangedEvent } from '../types/chat_domain_event.ts';
import type { ReactionEmoji } from '../types/message_reaction.ts';
import type { VirtualAccountProfile } from '../types/virtual_account.ts';
import type { Supergroup } from '../types/virtual_chat.ts';
import { projectSupergroupChat } from './bot_api_message.ts';

interface MessageReactionChangeProjectionInput {
  readonly event: MessageReactionChangedEvent;
  readonly supergroup: Supergroup;
  /** The account that changed its reactions. */
  readonly reactor: VirtualAccountProfile;
  /** The ID of the message in the supergroup, as its bots see it. */
  readonly messageId: number;
}

/**
 * Projects an account's change of its reactions as an administrator bot receives it, in the field
 * order of the official Bot API server's `JsonMessageReactionUpdated`.
 */
export function projectMessageReactionChange(
  { event, supergroup, reactor, messageId }: MessageReactionChangeProjectionInput,
): BotApiMessageReactionUpdated {
  return {
    chat: projectSupergroupChat(supergroup),
    message_id: messageId,
    user: reactor,
    date: event.changedAtUnixSeconds,
    old_reaction: event.oldEmojis.map(projectReactionType),
    new_reaction: event.newEmojis.map(projectReactionType),
  };
}

/** Shows an emoji reaction as the Bot API's `ReactionTypeEmoji`. */
function projectReactionType(emoji: ReactionEmoji): BotApiReactionTypeEmoji {
  return { type: 'emoji', emoji };
}
