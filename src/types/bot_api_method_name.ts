/** A Bot API method name Telegram has replaced, with the current name it still calls. */
export interface LegacyBotApiMethodName {
  readonly legacyName: string;
  readonly currentName: string;
}

/** Telegram's older names of Bot API methods, as Telegram spelled them, which still call them. */
const LEGACY_BOT_API_METHOD_NAMES: readonly LegacyBotApiMethodName[] = [
  { legacyName: 'kickChatMember', currentName: 'banChatMember' },
  { legacyName: 'getChatMembersCount', currentName: 'getChatMemberCount' },
];

const CURRENT_BOT_API_METHOD_NAMES_BY_LOWERCASE_LEGACY_NAME: ReadonlyMap<string, string> = new Map(
  LEGACY_BOT_API_METHOD_NAMES.map(({ legacyName, currentName }) =>
    [legacyName.toLowerCase(), currentName] as const
  ),
);

/** Telegram's older Bot API method names that still call a method, with the method's current name. */
export function listLegacyBotApiMethodNames(): readonly LegacyBotApiMethodName[] {
  return LEGACY_BOT_API_METHOD_NAMES;
}

/**
 * The name a Bot API method is currently known by: its current name for one of Telegram's older
 * names, whose case Telegram ignores, and any other name unchanged.
 */
export function toCurrentBotApiMethodName(methodName: string): string {
  return CURRENT_BOT_API_METHOD_NAMES_BY_LOWERCASE_LEGACY_NAME.get(methodName.toLowerCase()) ??
    methodName;
}
