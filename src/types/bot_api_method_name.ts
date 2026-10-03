/** Telegram's older names of Bot API methods, by lowercase older name, which still call them. */
const CURRENT_BOT_API_METHOD_NAMES_BY_LOWERCASE_LEGACY_NAME: ReadonlyMap<string, string> = new Map([
  ['kickchatmember', 'banChatMember'],
  ['getchatmemberscount', 'getChatMemberCount'],
]);

/**
 * The name a Bot API method is currently known by: its current name for one of Telegram's older
 * names, whose case Telegram ignores, and any other name unchanged.
 */
export function toCurrentBotApiMethodName(methodName: string): string {
  return CURRENT_BOT_API_METHOD_NAMES_BY_LOWERCASE_LEGACY_NAME.get(methodName.toLowerCase()) ??
    methodName;
}
