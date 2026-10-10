/**
 * Type guards that recognize the shapes of the emulator's control API and Bot API responses
 * which HTTP tests read.
 */

/** Whether `value` is the body of a bot created through `POST bots`. */
export function isCreatedBotResponse(value: unknown): value is {
  token: string;
  bot: { id: number; is_bot: boolean; first_name: string; username: string };
} {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const { token, bot } = value as Record<string, unknown>;
  return (
    typeof token === 'string' &&
    isUserProfile(bot) &&
    typeof bot.username === 'string'
  );
}

/** Whether `value` is the body of an account created through `POST accounts`. */
export function isCreatedAccountResponse(value: unknown): value is {
  account: {
    id: number;
    is_bot: boolean;
    first_name: string;
    last_name?: string;
    username?: string;
    language_code?: string;
  };
} {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const { account } = value as Record<string, unknown>;
  return isUserProfile(account);
}

/** Whether `value` is a user profile as the Bot API and the control API show it. */
export function isUserProfile(value: unknown): value is {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
} {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const profile = value as Record<string, unknown>;
  return (
    typeof profile.id === 'number' &&
    typeof profile.is_bot === 'boolean' &&
    typeof profile.first_name === 'string' &&
    (profile.last_name === undefined || typeof profile.last_name === 'string') &&
    (profile.username === undefined || typeof profile.username === 'string') &&
    (profile.language_code === undefined || typeof profile.language_code === 'string')
  );
}

/** Whether `value` is a Bot API error with code 400 and a `Bad Request: ` description. */
export function isBadRequestResponse(value: unknown): value is {
  ok: false;
  error_code: 400;
  description: string;
} {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const { ok, error_code, description } = value as Record<string, unknown>;
  return ok === false && error_code === 400 && typeof description === 'string' &&
    description.startsWith('Bad Request: ');
}

/** Whether `value` is a Bot API error with code 404 and the description `expectedDescription`. */
export function isNotFoundResponse<Description extends string>(
  value: unknown,
  expectedDescription: Description,
): value is { ok: false; error_code: 404; description: Description } {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const { ok, error_code, description } = value as Record<string, unknown>;
  return ok === false && error_code === 404 && description === expectedDescription;
}

/** Whether `value` is the body of a message an account sent through the control API. */
export function isSentMessageResponse(value: unknown): value is {
  message: TestPrivateMessage;
} {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { message } = value as Record<string, unknown>;
  return isPrivateMessage(message);
}

/** Whether `value` is the body of a chat history read through the control API. */
export function isMessageHistoryResponse(value: unknown): value is {
  messages: Array<TestPrivateMessage>;
} {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { messages } = value as Record<string, unknown>;
  return Array.isArray(messages) && messages.every(isPrivateMessage);
}

/** Whether `value` is a successful getUpdates response whose updates all carry a message. */
export function isGetUpdatesResponse(value: unknown): value is {
  ok: true;
  result: Array<{
    update_id: number;
    message: TestPrivateMessage;
  }>;
} {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { ok, result } = value as Record<string, unknown>;
  return ok === true && Array.isArray(result) && result.every((update) => {
    if (typeof update !== 'object' || update === null) {
      return false;
    }
    const candidate = update as Record<string, unknown>;
    return typeof candidate.update_id === 'number' && isPrivateMessage(candidate.message);
  });
}

/** The parts of a Bot API message these tests check. */
export interface TestPrivateMessage {
  message_id: number;
  from: { id: number };
  chat: { id: number; type: string };
  date: number;
  text: string;
  /** Left unchecked; tests compare it as a whole. */
  entities?: unknown;
  /** Left unchecked; tests compare it as a whole. */
  reply_markup?: unknown;
}

/** Whether `value` holds the parts of a Bot API text message that `TestPrivateMessage` names. */
export function isPrivateMessage(value: unknown): value is TestPrivateMessage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const message = value as Record<string, unknown>;
  return (
    typeof message.message_id === 'number' &&
    typeof message.date === 'number' &&
    typeof message.text === 'string' &&
    typeof message.from === 'object' &&
    message.from !== null &&
    typeof (message.from as Record<string, unknown>).id === 'number' &&
    typeof message.chat === 'object' &&
    message.chat !== null &&
    typeof (message.chat as Record<string, unknown>).id === 'number' &&
    typeof (message.chat as Record<string, unknown>).type === 'string'
  );
}
