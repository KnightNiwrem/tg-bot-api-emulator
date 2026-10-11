import type { z } from 'zod';

import type { messageEntityInputSchema } from '../../contracts/account_messages.ts';
import type { controlRequestIssueSchema } from '../../contracts/control_errors.ts';
import type { TextEntity } from '../../../types/virtual_message.ts';
import { readMessageEntitiesParameter } from '../bot_api/message_entities_parameter.ts';

/** The description of entities whose fields no entity type takes, as the account routes give it. */
const INVALID_ACCOUNT_ENTITIES_DESCRIPTION = 'Invalid message entities';

/** The entities an account specified for a text, caption, or poll text, as the domain reads them. */
export type AccountMessageEntitiesReading =
  | { readonly read: true; readonly entities: readonly TextEntity[] | undefined }
  | { readonly read: false; readonly issue: z.output<typeof controlRequestIssueSchema> };

/**
 * Reads the entities an account specified in the body field at `path`, as the Bot API reads a
 * bot's: entity types Telegram detects by itself are ignored. Entities Telegram cannot read are
 * an `invalid_value` issue at the field, a rule the wire schema cannot state, which names what is
 * wrong as Telegram's description does. Omitted entities stay omitted.
 */
export function readAccountMessageEntities(
  entities: readonly z.output<typeof messageEntityInputSchema>[] | undefined,
  path: readonly (string | number)[],
): AccountMessageEntitiesReading {
  if (entities === undefined) {
    return { read: true, entities: undefined };
  }
  const reading = readMessageEntitiesParameter(entities, INVALID_ACCOUNT_ENTITIES_DESCRIPTION);
  return reading.read ? { read: true, entities: reading.entities } : {
    read: false,
    issue: { source: 'body', path: [...path], code: 'invalid_value', message: reading.description },
  };
}
