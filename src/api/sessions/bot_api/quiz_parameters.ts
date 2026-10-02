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
  let value: unknown;
  try {
    value = JSON.parse(correctOptionIdsText);
  } catch {
    return {
      read: false,
      description: "Bad Request: can't parse correct option identifiers JSON object",
    };
  }
  if (!Array.isArray(value)) {
    return {
      read: false,
      description: 'Bad Request: expected an Array of correct option identifiers',
    };
  }
  const correctOptionPositions: number[] = [];
  for (const optionId of value) {
    if (typeof optionId !== 'number') {
      return {
        read: false,
        description: 'Bad Request: correct option identifier must be of type Number',
      };
    }
    if (!Number.isInteger(optionId) || optionId < MIN_INT32 || optionId > MAX_INT32) {
      return {
        read: false,
        description: 'Bad Request: invalid correct option identifier specified',
      };
    }
    correctOptionPositions.push(optionId);
  }
  return { read: true, correctOptionPositions };
}
