/**
 * The action receipt that tests' fake transports answer actions with, as the emulator writes it in
 * a response's headers.
 */
import {
  ACTION_RECEIPT_ACTIVITY_POSITION_HEADER,
  ACTION_RECEIPT_SESSION_ID_HEADER,
} from '../../../control_contracts/action_receipts.ts';
import type { ActionReceipt } from '../types.ts';

/** The receipt {@link TEST_ACTION_RECEIPT_HEADERS} carries. */
export const TEST_ACTION_RECEIPT: ActionReceipt = Object.freeze({
  sessionId: '3f1c2b8e-5d4a-4c6e-9b7f-0a1d2e3f4a5b',
  activityPosition: 7,
});

/** Response headers that carry {@link TEST_ACTION_RECEIPT}. */
export const TEST_ACTION_RECEIPT_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  [ACTION_RECEIPT_SESSION_ID_HEADER]: TEST_ACTION_RECEIPT.sessionId,
  [ACTION_RECEIPT_ACTIVITY_POSITION_HEADER]: String(TEST_ACTION_RECEIPT.activityPosition),
});
