import {
  CHAT_ADMINISTRATOR_RIGHT_NAMES,
  type ChatAdministratorRightName,
} from '../../../types/bot_default_administrator_rights.ts';
import { parseBotApiJsonParameter } from './request_parameters.ts';

export type ChatAdministratorRightsParameterReading =
  | { readonly read: true; readonly requestedRights: readonly ChatAdministratorRightName[] }
  | { readonly read: false; readonly description: string };

const KNOWN_RIGHT_NAMES: ReadonlySet<string> = new Set(CHAT_ADMINISTRATOR_RIGHT_NAMES);

/**
 * Reads a `rights` parameter, a JSON `ChatAdministratorRights` object, as the official Bot API
 * server's `get_chat_administrator_rights` does: missing or empty text requests no rights, a
 * missing field is false, and Telegram's descriptions answer text that is not a JSON object or a
 * field that is not a JSON boolean, checking fields in the server's order.
 *
 * `invalidParametersDescription` answers a field Telegram does not know, which the server ignores;
 * rejecting it instead surfaces the bot's mistake in tests.
 */
export function readChatAdministratorRightsParameter(
  text: string | undefined,
  invalidParametersDescription: string,
): ChatAdministratorRightsParameterReading {
  if (text === undefined || text.length === 0) {
    return { read: true, requestedRights: [] };
  }
  const parsedParameter = parseBotApiJsonParameter(text);
  if (parsedParameter === undefined) {
    return {
      read: false,
      description: "Bad Request: can't parse ChatAdministratorRights JSON object",
    };
  }
  const { value } = parsedParameter;
  const rightsError = (error: string): ChatAdministratorRightsParameterReading => ({
    read: false,
    description: `Bad Request: can't parse ChatAdministratorRights: ${error}`,
  });
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return rightsError('ChatAdministratorRights must be an Object');
  }

  const fields = new Map(Object.entries(value));
  const requestedRights: ChatAdministratorRightName[] = [];
  for (const right of CHAT_ADMINISTRATOR_RIGHT_NAMES) {
    const field = fields.get(right);
    if (field === undefined) {
      continue;
    }
    if (typeof field !== 'boolean') {
      return rightsError(`Field "${right}" must be of type Boolean`);
    }
    if (field) {
      requestedRights.push(right);
    }
  }
  if ([...fields.keys()].some((name) => !KNOWN_RIGHT_NAMES.has(name))) {
    return { read: false, description: invalidParametersDescription };
  }
  return { read: true, requestedRights };
}
