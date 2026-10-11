/**
 * Transactions for tests that wire update delivery by hand, without a session's projector: they
 * execute commands under the given lifetime's commit gate, and run effects after publication, as a
 * session's transactions do.
 */
import { SessionChangeJournal } from '../../src/transactions/staging/change_staging.ts';
import { SessionTransactions } from '../../src/transactions/session/session_transactions.ts';

/**
 * Creates the transactions, over a journal of their own, under which the test's unstaged
 * repositories' writes are final at once. No event may be emitted, and an effect that throws fails
 * the command that published it.
 */
export function createUnprojectedTransactions(
  lifetime: ConstructorParameters<typeof SessionTransactions>[0]['lifetime'],
): SessionTransactions {
  return new SessionTransactions({
    journal: new SessionChangeJournal({
      reportNotificationFailure: (error) => {
        throw error;
      },
    }),
    lifetime,
    projector: {
      project: (event) => {
        throw new Error(`Unexpected ${event.type} event in a test without a projector`);
      },
    },
  });
}
