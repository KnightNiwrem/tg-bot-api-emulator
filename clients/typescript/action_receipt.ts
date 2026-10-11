/**
 * Reads the action receipt a successful control action answers with, from the headers that
 * `src/api/contracts/action_receipts.ts` describes.
 */
import { z } from 'zod';

import {
  ACTION_RECEIPT_ACTIVITY_POSITION_HEADER,
  ACTION_RECEIPT_SESSION_ID_HEADER,
  actionReceiptHeadersSchema,
} from '../../src/api/contracts/action_receipts.ts';
import type { ActionReceipt } from './types.ts';

/** A position as its header writes it: decimal digits, without a sign or a leading zero. */
const DECIMAL_POSITION_PATTERN = /^(?:0|[1-9][0-9]*)$/;

/** A receipt read from a response's headers, or why the headers hold none. */
export type ActionReceiptReading =
  | { readonly found: true; readonly receipt: ActionReceipt }
  | { readonly found: false; readonly problem: string };

/**
 * Reads a response's action receipt: the session its `Action-Receipt-Session-Id` header names and
 * the position its `Action-Receipt-Activity-Position` header gives. Reports a problem when either
 * header is missing, or holds text that is not a session ID or a nonnegative decimal integer.
 */
export function readActionReceipt(headers: Headers): ActionReceiptReading {
  const sessionIdText = headers.get(ACTION_RECEIPT_SESSION_ID_HEADER);
  const positionText = headers.get(ACTION_RECEIPT_ACTIVITY_POSITION_HEADER);
  const missingHeaders = [
    ...(sessionIdText === null ? [ACTION_RECEIPT_SESSION_ID_HEADER] : []),
    ...(positionText === null ? [ACTION_RECEIPT_ACTIVITY_POSITION_HEADER] : []),
  ];
  if (sessionIdText === null || positionText === null) {
    return { found: false, problem: `no ${missingHeaders.join(' or ')} header` };
  }
  if (!DECIMAL_POSITION_PATTERN.test(positionText)) {
    return {
      found: false,
      problem: `an ${ACTION_RECEIPT_ACTIVITY_POSITION_HEADER} header of ${
        JSON.stringify(positionText)
      }, which is no decimal position`,
    };
  }
  const headerValues = actionReceiptHeadersSchema.safeParse({
    [ACTION_RECEIPT_SESSION_ID_HEADER]: sessionIdText,
    [ACTION_RECEIPT_ACTIVITY_POSITION_HEADER]: Number(positionText),
  });
  if (!headerValues.success) {
    return {
      found: false,
      problem: `a malformed action receipt: ${z.prettifyError(headerValues.error)}`,
    };
  }
  return {
    found: true,
    receipt: Object.freeze({
      sessionId: headerValues.data[ACTION_RECEIPT_SESSION_ID_HEADER],
      activityPosition: headerValues.data[ACTION_RECEIPT_ACTIVITY_POSITION_HEADER],
    }),
  };
}
