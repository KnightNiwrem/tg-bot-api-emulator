import type { z } from 'zod';

import type { controlRequestIssueSchema } from '../../../../control_contracts/control_errors.ts';
import { findBotApiMethod } from '../bot_api/method_catalogue.ts';

/** The `method` of a request that queues answers, as the answers record it, or why it is refused. */
type QueuedAnswerMethodReading =
  | { readonly valid: true; readonly methodName: string | undefined }
  | { readonly valid: false; readonly issue: z.output<typeof controlRequestIssueSchema> };

/**
 * Reads the `method` field of a queued answer: by any name Telegram accepts, as the method's
 * current name, or `undefined` when omitted, for every method. A name of no method the emulator
 * implements is an issue of the body.
 */
export function readQueuedAnswerMethodName(
  requestedMethodName: string | undefined,
): QueuedAnswerMethodReading {
  if (requestedMethodName === undefined) {
    return { valid: true, methodName: undefined };
  }
  const method = findBotApiMethod(requestedMethodName);
  return method === undefined
    ? {
      valid: false,
      issue: {
        source: 'body',
        path: ['method'],
        code: 'invalid_value',
        message: 'The emulator implements no Bot API method of this name',
      },
    }
    : { valid: true, methodName: method.name };
}
