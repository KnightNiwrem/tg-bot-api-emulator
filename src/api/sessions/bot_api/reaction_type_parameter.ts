/**
 * The reactions a `reaction` parameter names: ordinary emoji, or a custom emoji, which the
 * emulator never allows in a chat, so Telegram's servers would refuse it as `REACTION_INVALID`.
 */
export type ReactionTypesParameterReading =
  | {
    readonly read: true;
    /** The emoji of the ordinary reactions, in order; none removes the bot's reactions. */
    readonly emojis: readonly string[];
    readonly hasCustomEmoji: boolean;
  }
  | { readonly read: false; readonly description: string };

/** TDLib's `ReactionType` reads these emoji as no reaction, which it refuses. */
function isEmptyReactionEmoji(emoji: string): boolean {
  return emoji.length === 0 || emoji.startsWith('#') || emoji === '$';
}

/**
 * Reads a `reaction` parameter, a JSON array of `ReactionType` objects, as the official Bot API
 * server's `get_reaction_types` does: a missing, empty or `null` parameter is no reaction, and
 * Telegram's descriptions answer text that is not JSON, a value that is not an array, an element
 * that is not an object, a missing field, and a type other than `emoji` and `custom_emoji`, which
 * includes the paid reactions that bots cannot use. An emoji TDLib reads as no reaction is refused
 * as TDLib's `set_message_reactions` refuses it.
 *
 * `invalidParametersDescription` answers reactions Telegram would read leniently, such as unknown
 * fields or a number where an emoji is expected; rejecting them instead surfaces the bot's mistake
 * in tests.
 */
export function readReactionTypesParameter(
  text: string | undefined,
  invalidParametersDescription: string,
): ReactionTypesParameterReading {
  if (text === undefined || text.length === 0) {
    return { read: true, emojis: [], hasCustomEmoji: false };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { read: false, description: "Bad Request: can't parse reaction types JSON object" };
  }
  if (value === null) {
    return { read: true, emojis: [], hasCustomEmoji: false };
  }
  if (!Array.isArray(value)) {
    return { read: false, description: 'Bad Request: expected an Array of ReactionType' };
  }
  const reactionTypeError = (error: string): ReactionTypesParameterReading => ({
    read: false,
    description: `Bad Request: can't parse ReactionType: ${error}`,
  });
  const malformedReactionType: ReactionTypesParameterReading = {
    read: false,
    description: invalidParametersDescription,
  };

  const emojis: string[] = [];
  let hasCustomEmoji = false;
  for (const element of value) {
    if (typeof element !== 'object' || element === null || Array.isArray(element)) {
      return reactionTypeError('expected an Object');
    }
    if (!('type' in element)) {
      return reactionTypeError('Can\'t find field "type"');
    }
    switch (element.type) {
      case 'emoji': {
        if (!('emoji' in element)) {
          return reactionTypeError('Can\'t find field "emoji"');
        }
        const { emoji } = element;
        if (typeof emoji !== 'string' || !hasOnlyFields(element, ['type', 'emoji'])) {
          return malformedReactionType;
        }
        if (isEmptyReactionEmoji(emoji)) {
          return { read: false, description: 'Bad Request: invalid reaction type specified' };
        }
        emojis.push(emoji);
        break;
      }
      case 'custom_emoji': {
        if (!('custom_emoji_id' in element)) {
          return reactionTypeError('Can\'t find field "custom_emoji_id"');
        }
        const { custom_emoji_id: customEmojiId } = element;
        if (
          typeof customEmojiId !== 'string' ||
          !hasOnlyFields(element, ['type', 'custom_emoji_id'])
        ) {
          return malformedReactionType;
        }
        hasCustomEmoji = true;
        break;
      }
      default:
        return typeof element.type === 'string'
          ? reactionTypeError('invalid reaction type specified')
          : malformedReactionType;
    }
  }
  return { read: true, emojis, hasCustomEmoji };
}

function hasOnlyFields(object: object, fieldNames: readonly string[]): boolean {
  return Object.keys(object).every((fieldName) => fieldNames.includes(fieldName));
}
