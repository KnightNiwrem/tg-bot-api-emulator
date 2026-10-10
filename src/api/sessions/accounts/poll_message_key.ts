import type { EmulationSession } from '../../../types/emulation_session.ts';
import { type ControlRequestInputReading, readPathParameters } from '../control_request_input.ts';
import { privateMessagePathSchema, supergroupMessagePathSchema } from './account_paths.ts';

/** A message showing a poll, as an account addresses it. */
export type AccountPollMessageKey = Parameters<
  EmulationSession['polls']['getAccountPollAnswer']
>[0];

/**
 * Reads the message of a poll route, in an account's private chat with a bot or in a supergroup,
 * from its path parameters.
 */
export function readPollMessageKey(
  pathParameters: Record<string, string>,
  chatType: AccountPollMessageKey['chat']['type'],
): ControlRequestInputReading<AccountPollMessageKey> {
  if (chatType === 'private') {
    const messagePath = readPathParameters(privateMessagePathSchema, pathParameters);
    if (!messagePath.valid) {
      return messagePath;
    }
    const { accountId, botId, messageId } = messagePath.value;
    return { valid: true, value: { accountId, chat: { type: 'private', botId }, messageId } };
  }
  const messagePath = readPathParameters(supergroupMessagePathSchema, pathParameters);
  if (!messagePath.valid) {
    return messagePath;
  }
  const { accountId, chatId, messageId } = messagePath.value;
  return { valid: true, value: { accountId, chat: { type: 'supergroup', chatId }, messageId } };
}
