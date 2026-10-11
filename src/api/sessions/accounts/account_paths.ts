import { z } from 'zod';

import { telegramUserIdSchema } from './request_fields.ts';

export const ACCOUNT_ID_PARAMETER = 'accountId';

const telegramUserIdPathParameterSchema = z.coerce.number().pipe(telegramUserIdSchema);

/** The path parameters of the account a route acts as. */
export const accountPathSchema = z.object({
  [ACCOUNT_ID_PARAMETER]: telegramUserIdPathParameterSchema,
});
