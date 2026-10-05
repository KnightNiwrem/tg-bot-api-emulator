import { z } from 'zod';

import { MAX_TELEGRAM_USER_ID, MIN_TELEGRAM_USER_ID } from '../../../types/telegram_identity.ts';

/** The name of the path parameter that identifies a virtual bot under `/bots`. */
export const BOT_ID_PARAMETER = 'botId';

export const botIdPathParameterSchema = z.coerce.number().pipe(
  z.int().min(MIN_TELEGRAM_USER_ID).max(MAX_TELEGRAM_USER_ID),
);
