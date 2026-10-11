import type { EmulationSession } from '../../../session/emulation_session.ts';
import { type ControlRequestInputReading, readPathParameters } from '../control_request_input.ts';
import { supergroupMessagePathSchema } from './account_paths.ts';

/** A message showing a poll, as an account addresses it. */
export type AccountPollMessageKey = Parameters<
  EmulationSession['polls']['getAccountPollAnswer']
>[0];

/** Reads the supergroup message of a poll route from its path parameters. */
export function readSupergroupPollMessageKey(
  pathParameters: Record<string, string>,
): ControlRequestInputReading<AccountPollMessageKey> {
  const messagePath = readPathParameters(supergroupMessagePathSchema, pathParameters);
  if (!messagePath.valid) {
    return messagePath;
  }
  const { accountId, chatId, messageId } = messagePath.value;
  return { valid: true, value: { accountId, chat: { type: 'supergroup', chatId }, messageId } };
}
