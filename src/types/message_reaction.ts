/**
 * The ordinary emoji that users and bots may react with, exactly as the Bot API documents
 * `ReactionTypeEmoji.emoji`, in its order. Several are written without the variation selector
 * U+FE0F that keyboards often add, such as "❤" and "☃", and Telegram matches them exactly.
 */
export const REACTION_EMOJIS = [
  '❤',
  '👍',
  '👎',
  '🔥',
  '🥰',
  '👏',
  '😁',
  '🤔',
  '🤯',
  '😱',
  '🤬',
  '😢',
  '🎉',
  '🤩',
  '🤮',
  '💩',
  '🙏',
  '👌',
  '🕊',
  '🤡',
  '🥱',
  '🥴',
  '😍',
  '🐳',
  '❤‍🔥',
  '🌚',
  '🌭',
  '💯',
  '🤣',
  '⚡',
  '🍌',
  '🏆',
  '💔',
  '🤨',
  '😐',
  '🍓',
  '🍾',
  '💋',
  '🖕',
  '😈',
  '😴',
  '😭',
  '🤓',
  '👻',
  '👨‍💻',
  '👀',
  '🎃',
  '🙈',
  '😇',
  '😨',
  '🤝',
  '✍',
  '🤗',
  '🫡',
  '🎅',
  '🎄',
  '☃',
  '💅',
  '🤪',
  '🗿',
  '🆒',
  '💘',
  '🙉',
  '🦄',
  '😘',
  '💊',
  '🙊',
  '😎',
  '👾',
  '🤷‍♂',
  '🤷',
  '🤷‍♀',
  '😡',
] as const;

/** An ordinary emoji that a reaction can show. */
export type ReactionEmoji = typeof REACTION_EMOJIS[number];

const REACTION_EMOJI_SET: ReadonlySet<string> = new Set(REACTION_EMOJIS);

export function isReactionEmoji(emoji: string): emoji is ReactionEmoji {
  return REACTION_EMOJI_SET.has(emoji);
}

/** The reactions one user, an account or a bot, chose for a message. */
export interface UserReaction {
  readonly userId: number;
  /** The chosen emoji, in the order the user chose them; never empty. */
  readonly emojis: readonly ReactionEmoji[];
}

/** Whether two lists of reactions are the same emoji in the same order. */
export function isSameReactionEmojis(
  first: readonly ReactionEmoji[],
  second: readonly ReactionEmoji[],
): boolean {
  return first.length === second.length && first.every((emoji, index) => emoji === second[index]);
}
