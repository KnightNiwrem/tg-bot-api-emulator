/**
 * Telegram's older names of Bot API methods, as Telegram spelled them, which still call the method
 * now named `currentName`. The emulator reads a bot activity filter's `method` by its current name;
 * `server_definitions_test.ts` checks that this list matches the emulator's.
 */
export const LEGACY_BOT_API_METHOD_NAMES = [
  { legacyName: 'kickChatMember', currentName: 'banChatMember' },
  { legacyName: 'getChatMembersCount', currentName: 'getChatMemberCount' },
] as const;

const CURRENT_BOT_API_METHOD_NAMES_BY_LOWERCASE_LEGACY_NAME: ReadonlyMap<string, string> = new Map(
  LEGACY_BOT_API_METHOD_NAMES.map(({ legacyName, currentName }) =>
    [legacyName.toLowerCase(), currentName] as const
  ),
);

/**
 * The name a Bot API method is currently known by: its current name for one of Telegram's older
 * names, whose case Telegram ignores, and any other name unchanged.
 */
export function toCurrentBotApiMethodName(methodName: string): string {
  return CURRENT_BOT_API_METHOD_NAMES_BY_LOWERCASE_LEGACY_NAME.get(methodName.toLowerCase()) ??
    methodName;
}
