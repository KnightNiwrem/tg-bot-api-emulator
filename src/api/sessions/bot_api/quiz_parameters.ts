import { BOT_API_ERRORS } from './errors/error_catalogue.ts';
import { parseBotApiJsonParameter } from './request_parameters.ts';

export type CorrectOptionIdsParameterReading =
  | { readonly read: true; readonly correctOptionPositions: readonly number[] }
  | { readonly read: false; readonly description: string };

const MIN_INT32 = -(2 ** 31);
const MAX_INT32 = 2 ** 31 - 1;

/**
 * Reads the correct options of a quiz as the official Bot API server's `process_send_poll_query`
 * reads them: `correct_option_ids`, a JSON array of numbers that must be 32-bit integers, with the
 * server's descriptions of values it cannot read, or else the legacy `correct_option_id` as one
 * option. Neither lists no correct option, which TDLib refuses. Whether the options are in order
 * and exist is left to the service.
 */
export function readCorrectOptionIdsParameter(
  correctOptionIdsText: string | undefined,
  correctOptionId: number | undefined,
): CorrectOptionIdsParameterReading {
  if (correctOptionIdsText === undefined) {
    return {
      read: true,
      correctOptionPositions: correctOptionId === undefined ? [] : [correctOptionId],
    };
  }
  const parsedParameter = parseBotApiJsonParameter(correctOptionIdsText);
  if (parsedParameter === undefined) {
    return { read: false, description: BOT_API_ERRORS.correctOptionIdsJsonInvalid.description() };
  }
  const { value } = parsedParameter;
  if (!Array.isArray(value)) {
    return { read: false, description: BOT_API_ERRORS.correctOptionIdsNotArray.description() };
  }
  const correctOptionPositions: number[] = [];
  for (const optionId of value) {
    if (typeof optionId !== 'number') {
      return { read: false, description: BOT_API_ERRORS.correctOptionIdNotNumber.description() };
    }
    if (!Number.isInteger(optionId) || optionId < MIN_INT32 || optionId > MAX_INT32) {
      return { read: false, description: BOT_API_ERRORS.correctOptionIdInvalid.description() };
    }
    correctOptionPositions.push(optionId);
  }
  return { read: true, correctOptionPositions };
}
