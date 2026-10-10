import { z } from 'zod';

import { MAX_TELEGRAM_USER_ID, MIN_TELEGRAM_USER_ID } from '../../../types/telegram_identity.ts';

/** The name of the path parameter that identifies a virtual bot under `/bots`. */
export const BOT_ID_PARAMETER = 'botId';

/**
 * The reason a route under `/bots/{botId}` gives for a bot the session does not have, including
 * for a path parameter that cannot be a bot's ID.
 */
export const BOT_NOT_FOUND_REASON = 'bot_not_found';

export const botIdPathParameterSchema = z.coerce.number().pipe(
  z.int().min(MIN_TELEGRAM_USER_ID).max(MAX_TELEGRAM_USER_ID),
);
