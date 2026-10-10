/**
 * The JSON bodies with which control routes refuse requests: a validation error listing what is
 * wrong with a request's input, and a refusal naming only its stable reason.
 */
import { z } from 'zod';

/** The reason of a refusal whose request breaks the operation's input contract. */
export const INVALID_REQUEST_REASON = 'invalid_request';

/** The parts of a control request an input issue can be in. */
export const CONTROL_REQUEST_ISSUE_SOURCES = ['body', 'path', 'query'] as const;

/**
 * What is wrong with one input value. The codes are the emulator's own, so that they stay stable
 * across validation libraries:
 *
 * - `invalid_json`: the body, or a query parameter whose value must be JSON, is not JSON;
 * - `invalid_type`: a value is missing or of the wrong type;
 * - `too_small` / `too_big`: a number, text, or list is outside its bounds;
 * - `invalid_format`: text does not have the required form;
 * - `invalid_value`: a value is not one of those allowed, or breaks a rule its field states;
 * - `unknown_field`: the operation takes no field or query parameter of that name;
 * - `duplicate_field`: a query parameter is repeated, or a JSON query parameter's object names a
 *   member more than once;
 * - `no_matching_variant`: a value that takes one of several forms matches none of them.
 */
export const CONTROL_REQUEST_ISSUE_CODES = [
  'invalid_json',
  'invalid_type',
  'too_small',
  'too_big',
  'invalid_format',
  'invalid_value',
  'unknown_field',
  'duplicate_field',
  'no_matching_variant',
] as const;

/**
 * One problem with a control request's input: the part of the request it is in, the field names
 * and list indexes that lead to it from that part's root (a path or query parameter's name,
 * followed by the members and indexes within a query parameter that holds JSON), its stable code,
 * and an explanation for a person, which never repeats an input value.
 */
export const controlRequestIssueSchema = z.strictObject({
  source: z.enum(CONTROL_REQUEST_ISSUE_SOURCES),
  path: z.array(z.union([z.string(), z.int().nonnegative()])),
  code: z.enum(CONTROL_REQUEST_ISSUE_CODES),
  message: z.string(),
});

/** The body of a refusal whose request breaks the operation's input contract: every issue. */
export const controlValidationErrorSchema = z.strictObject({
  reason: z.literal(INVALID_REQUEST_REASON),
  issues: z.tuple([controlRequestIssueSchema], controlRequestIssueSchema),
});

/**
 * The body of a refusal for any other cause than the request's input, such as a missing resource,
 * which names only its stable reason: one of `reasons`, the reasons the refusal's status can give.
 */
export function controlRefusalSchema<const Reason extends string>(
  reasons: readonly [Reason, ...Reason[]],
) {
  return z.strictObject({ reason: z.enum(reasons) });
}
