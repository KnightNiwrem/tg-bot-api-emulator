import type { EmulationSession } from '../../../types/emulation_session.ts';
import { privateMessagePathSchema, supergroupMessagePathSchema } from './account_paths.ts';

/** A message showing a poll, as an account addresses it. */
export type AccountPollMessageKey = Parameters<
  EmulationSession['polls']['getAccountPollAnswer']
>[0];

/**
 * Reads the message of a poll route, in an account's private chat with a bot or in a supergroup;
 * `undefined` for path parameters that identify none.
 */
export function readPollMessageKey(
  pathParameters: Record<string, string>,
  chatType: AccountPollMessageKey['chat']['type'],
): AccountPollMessageKey | undefined {
  if (chatType === 'private') {
    const messagePath = privateMessagePathSchema.safeParse(pathParameters);
    return messagePath.success
      ? {
        accountId: messagePath.data.accountId,
        chat: { type: 'private', botId: messagePath.data.botId },
        messageId: messagePath.data.messageId,
      }
      : undefined;
  }
  const messagePath = supergroupMessagePathSchema.safeParse(pathParameters);
  return messagePath.success
    ? {
      accountId: messagePath.data.accountId,
      chat: { type: 'supergroup', chatId: messagePath.data.chatId },
      messageId: messagePath.data.messageId,
    }
    : undefined;
}
