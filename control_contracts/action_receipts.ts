/**
 * The contract of action receipts: the observation watermark that every successful control action
 * answers with, so that a test can wait for what happened after its own action without first
 * reading the bot activity log's head.
 *
 * A receipt names the session the action changed and a position of the session's bot activity
 * log, captured where the action executes, before anything it changes is published. Nothing the
 * action causes can be recorded at or before that position, so a read `after` it never misses an
 * entry the action caused. It is only a lower bound: activity that has nothing to do with the
 * action, such as another bot's concurrent calls, may follow it too, and a bot's calls carry no
 * identity of the update that led to them.
 *
 * Every response that carries one carries it the same way, whatever its body: in two headers, so
 * that an action without content, a `204`, needs no body, and a JSON body stays the resource it
 * describes.
 */
import { z } from 'zod';

/** The header that names the session whose bot activity log a receipt's position is in. */
export const ACTION_RECEIPT_SESSION_ID_HEADER = 'Action-Receipt-Session-Id';

/**
 * The header that gives a receipt's position: the head of the session's bot activity log before
 * the action, written in decimal digits.
 */
export const ACTION_RECEIPT_ACTIVITY_POSITION_HEADER = 'Action-Receipt-Activity-Position';

/**
 * The headers of a receipt, as the values their text stands for: the session's ID, and a position
 * of its log, 0 for the position before every entry.
 */
export const actionReceiptHeadersSchema = z.object({
  [ACTION_RECEIPT_SESSION_ID_HEADER]: z.uuid(),
  [ACTION_RECEIPT_ACTIVITY_POSITION_HEADER]: z.int().min(0),
});

/**
 * Where an operation's receipt comes from:
 *
 * - `before_action`: the head of the log of the session the request names, captured where the
 *   operation executes, after its request is decoded and before the operation changes anything;
 *   an operation that changes nothing, as when it is asked for a state that already holds, answers
 *   with the head as it is;
 * - `session_creation`: position 0 of the session the operation created, whose log has no entry
 *   yet.
 */
export type ActionReceiptSource = 'before_action' | 'session_creation';
