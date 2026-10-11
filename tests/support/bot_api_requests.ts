/** Calls to a session's Bot API, and readers of the results and updates they return. */
import { type EmulationApi, requestJson } from './emulation_api.ts';

/** Calls a Bot API method with JSON parameters and returns the status and decoded body. */
export function callBotApi(
  api: EmulationApi,
  methodPath: string,
  parameters: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  return requestJson<unknown>(api, 'POST', methodPath, parameters);
}

/**
 * Calls a Bot API method with a multipart body of text parameters and uploaded files, as bots send
 * files, and returns the status and decoded body.
 */
export async function callBotApiWithFiles(
  api: EmulationApi,
  methodPath: string,
  parameters: Record<string, string>,
  files: Record<string, File>,
): Promise<{ status: number; body: unknown }> {
  const body = new FormData();
  for (const [name, value] of Object.entries(parameters)) {
    body.append(name, value);
  }
  for (const [name, file] of Object.entries(files)) {
    body.append(name, file);
  }
  const response = await api.request(methodPath, { method: 'POST', body });
  return { status: response.status, body: await response.json() };
}

/**
 * Returns a reader of each bot's updates since the reader last read that bot's updates. A read
 * that names `allowedUpdates` passes them to `getUpdates` as its `allowed_updates`.
 */
export function createUpdateReader(api: EmulationApi) {
  const nextOffsetsByBotApiPath = new Map<string, number>();
  return async (
    botApiPath: string,
    allowedUpdates?: readonly string[],
  ): Promise<Array<Record<string, unknown>>> => {
    const { body } = await callBotApi(api, `${botApiPath}/getUpdates`, {
      offset: nextOffsetsByBotApiPath.get(botApiPath) ?? 0,
      ...(allowedUpdates === undefined ? {} : { allowed_updates: allowedUpdates }),
    });
    const updates = (body as { result: Array<Record<string, unknown>> }).result;
    const lastUpdateId = updates.at(-1)?.update_id;
    if (typeof lastUpdateId === 'number') {
      nextOffsetsByBotApiPath.set(botApiPath, lastUpdateId + 1);
    }
    return updates;
  };
}

/** The updates without their `update_id`, for tests that compare updates but not their IDs. */
export function withoutUpdateIds(
  updates: readonly Record<string, unknown>[],
): Array<Record<string, unknown>> {
  return updates.map(({ update_id: _updateId, ...update }) => update);
}

/** Returns the messages and edited messages of a successful getUpdates response. */
export function updateMessages(body: unknown): Record<string, unknown>[] {
  if (typeof body !== 'object' || body === null) {
    return [];
  }
  const { ok, result } = body as Record<string, unknown>;
  if (ok !== true || !Array.isArray(result)) {
    return [];
  }
  return result.flatMap((update: Record<string, unknown>) => {
    const message = update.message ?? update.edited_message;
    return typeof message === 'object' && message !== null
      ? [message as Record<string, unknown>]
      : [];
  });
}

/** Returns the message a successful Bot API message method returned, if it did. */
export function botApiResult(body: unknown): Record<string, unknown> | undefined {
  if (typeof body !== 'object' || body === null) {
    return undefined;
  }
  const { ok, result } = body as Record<string, unknown>;
  return ok === true && typeof result === 'object' && result !== null
    ? result as Record<string, unknown>
    : undefined;
}

/** Returns the one size of a message's photo. */
export function photoSizeOf(
  message: Record<string, unknown> | undefined,
): { file_id: string; file_unique_id: string } | undefined {
  const photo = message?.photo;
  return Array.isArray(photo) ? photo[0] : undefined;
}
