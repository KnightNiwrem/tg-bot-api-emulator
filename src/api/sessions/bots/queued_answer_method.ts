import { findBotApiMethod } from '../bot_api/method_catalogue.ts';
import type { ControlRequestInputReading } from '../control_request_input.ts';

/**
 * Reads the `method` field of a queued answer: by any name Telegram accepts, as the method's
 * current name, or `undefined` when omitted, for every method. A name of no method the emulator
 * implements is an issue of the body.
 */
export function readQueuedAnswerMethodName(
  requestedMethodName: string | undefined,
): ControlRequestInputReading<string | undefined> {
  if (requestedMethodName === undefined) {
    return { valid: true, value: undefined };
  }
  const method = findBotApiMethod(requestedMethodName);
  return method === undefined
    ? {
      valid: false,
      issues: [{
        source: 'body',
        path: ['method'],
        code: 'invalid_value',
        message: 'The emulator implements no Bot API method of this name',
      }],
    }
    : { valid: true, value: method.name };
}
