import { assertEquals } from '@std/assert';
import type { BotApiMethodAnswer } from '../../src/api/sessions/bot_api/method_call.ts';

// Presenter tests compare answers with Telegram's literal statuses and descriptions, written out
// rather than read from the catalogue, so that an edit of a catalogue entry fails them.

/**
 * A failure without the flag that tells its operation's outcome, such as `deleted: false`, which
 * the presenting function adds back.
 */
export type FailureDetails<Failure, OutcomeFlag extends PropertyKey> = Failure extends unknown
  ? Omit<Failure, OutcomeFlag>
  : never;

/** A failure with the status and description Telegram answers it with. */
export type PresentationCase<Details> = readonly [
  details: Details,
  status: number,
  description: string,
];

/**
 * Cases for every reason an operation fails for, so the compiler asks for a case when a reason is
 * added to the operation.
 */
export type CasesByReason<
  Failure extends { readonly reason: string },
  OutcomeFlag extends PropertyKey,
> = {
  readonly [Reason in Failure['reason']]: readonly PresentationCase<
    FailureDetails<Failure & { readonly reason: Reason }, OutcomeFlag>
  >[];
};

export const CHAT_NOT_FOUND = [400, 'Bad Request: chat not found'] as const;
const BOT_NOT_A_MEMBER = [
  403,
  'Forbidden: bot is not a member of the supergroup chat',
] as const;
const BOT_KICKED = [403, 'Forbidden: bot was kicked from the supergroup chat'] as const;
export const BOT_BLOCKED = [403, 'Forbidden: bot was blocked by the user'] as const;

/** The failures of a chat a supergroup operation cannot address. */
export const SUPERGROUP_ACCESS_CASES = {
  chat_not_found: [[{ reason: 'chat_not_found' }, ...CHAT_NOT_FOUND]],
  bot_not_a_member: [[{ reason: 'bot_not_a_member' }, ...BOT_NOT_A_MEMBER]],
  bot_kicked: [[{ reason: 'bot_kicked' }, ...BOT_KICKED]],
} as const;

/** The failures of any chat the bot cannot address, private chats included. */
export const CHAT_ACCESS_CASES = {
  ...SUPERGROUP_ACCESS_CASES,
  account_not_found: [[{ reason: 'account_not_found' }, ...CHAT_NOT_FOUND]],
  conversation_not_started: [[{ reason: 'conversation_not_started' }, ...CHAT_NOT_FOUND]],
} as const;

/** Checks that every case's failure is answered with its status and description. */
export function expectPresentations<
  Failure extends { readonly reason: string },
  OutcomeFlag extends PropertyKey,
>(
  casesByReason: CasesByReason<Failure, OutcomeFlag>,
  present: (details: FailureDetails<Failure, OutcomeFlag>) => BotApiMethodAnswer,
  operation: string,
): void {
  const casesOfReasons: readonly (readonly [
    reason: string,
    cases: readonly PresentationCase<FailureDetails<Failure, OutcomeFlag>>[],
  ])[] = Object.entries(casesByReason);
  for (const [reason, cases] of casesOfReasons) {
    for (const [details, status, description] of cases) {
      expectAnswer(present(details), [status, description], `${operation} ${reason}`);
    }
  }
}

/** Checks that an answer is an error with this status and description. */
export function expectAnswer(
  answer: BotApiMethodAnswer,
  [status, description]: readonly [number, string],
  label: string,
): void {
  assertEquals(
    [answer.status, answer.body.ok, answer.body.description],
    [status, false, description],
    `Expected ${label} to be answered with its error`,
  );
}
