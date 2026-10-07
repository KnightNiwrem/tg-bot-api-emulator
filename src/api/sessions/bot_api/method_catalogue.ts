import { toCurrentBotApiMethodName } from '../../../types/bot_api_method_name.ts';
import type { BotApiMethod } from './method_call.ts';
import { BOT_PROFILE_METHODS } from './methods/bot_profile.ts';
import { CHAT_INFO_METHODS } from './methods/chat_info.ts';
import { CHAT_INVITE_LINK_METHODS } from './methods/chat_invite_links.ts';
import { CHAT_JOIN_REQUEST_METHODS } from './methods/chat_join_requests.ts';
import { CHAT_MEMBER_METHODS } from './methods/chat_members.ts';
import { FILE_METHODS } from './methods/files.ts';
import { MESSAGE_DELETION_METHODS } from './methods/message_deletion.ts';
import { MESSAGE_EDITING_METHODS } from './methods/message_editing.ts';
import { MESSAGE_PINNING_METHODS } from './methods/message_pinning.ts';
import { MESSAGE_REACTION_METHODS } from './methods/message_reactions.ts';
import { MESSAGE_REPETITION_METHODS } from './methods/message_repetition.ts';
import { MESSAGE_SENDING_METHODS } from './methods/message_sending.ts';
import { QUERY_ANSWER_METHODS } from './methods/query_answers.ts';
import { UPDATE_DELIVERY_METHODS } from './methods/update_delivery.ts';

/** The Bot API methods the emulator implements, by family. */
const BOT_API_METHODS: readonly BotApiMethod[] = [
  ...UPDATE_DELIVERY_METHODS,
  ...BOT_PROFILE_METHODS,
  ...FILE_METHODS,
  ...CHAT_INFO_METHODS,
  ...CHAT_MEMBER_METHODS,
  ...CHAT_INVITE_LINK_METHODS,
  ...CHAT_JOIN_REQUEST_METHODS,
  ...QUERY_ANSWER_METHODS,
  ...MESSAGE_DELETION_METHODS,
  ...MESSAGE_PINNING_METHODS,
  ...MESSAGE_REACTION_METHODS,
  ...MESSAGE_SENDING_METHODS,
  ...MESSAGE_REPETITION_METHODS,
  ...MESSAGE_EDITING_METHODS,
];

/** Keyed by lowercase name, because Telegram matches method names case-insensitively. */
const BOT_API_METHODS_BY_LOWERCASE_NAME: ReadonlyMap<string, BotApiMethod> = new Map(
  BOT_API_METHODS.map((method) => [method.name.toLowerCase(), method] as const),
);

/**
 * Finds a Bot API method by its current or older name, which Telegram matches
 * case-insensitively.
 */
export function findBotApiMethod(methodName: string): BotApiMethod | undefined {
  return BOT_API_METHODS_BY_LOWERCASE_NAME.get(toCurrentBotApiMethodName(methodName).toLowerCase());
}
