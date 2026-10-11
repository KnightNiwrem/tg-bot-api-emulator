import { assertEquals } from '@std/assert';
import { SessionChangeJournal } from '../src/transactions/change_staging.ts';
import {
  TransactionalMap,
  TransactionalSet,
} from '../src/transactions/transactional_collections.ts';

Deno.test('an aborted transaction restores a map, the order of its entries included', () => {
  const journal = createJournal();
  const map = new TransactionalMap<string, number>(journal, [['a', 1], ['b', 2], ['c', 3]]);

  journal.begin();
  map.delete('a');
  map.set('b', 20);
  map.set('a', 10);
  map.set('d', 4);
  map.delete('c');
  const stagedEntries = [...map];
  journal.abort();
  const restoredEntries = [...map];

  journal.begin();
  map.set('e', 5);
  map.delete('b');
  journal.publish();

  assertEquals(
    { stagedEntries, restoredEntries, publishedEntries: [...map] },
    {
      stagedEntries: [['b', 20], ['a', 10], ['d', 4]],
      restoredEntries: [['a', 1], ['b', 2], ['c', 3]],
      publishedEntries: [['a', 1], ['c', 3], ['e', 5]],
    },
    'Expected the aborted writes to be reverted in order and the published ones to stay',
  );
});

Deno.test('an aborted transaction restores a set, the order of its values included', () => {
  const journal = createJournal();
  const set = new TransactionalSet<string>(journal);
  set.add('a').add('b').add('c');

  journal.begin();
  set.delete('a');
  set.add('a');
  set.add('d');
  set.delete('b');
  const stagedValues = [...set];
  journal.abort();

  assertEquals(
    { stagedValues, restoredValues: [...set] },
    { stagedValues: ['c', 'a', 'd'], restoredValues: ['a', 'b', 'c'] },
    'Expected the aborted writes to be reverted in order',
  );
});

Deno.test('writes outside a transaction are final and notify at once', () => {
  const journal = createJournal();
  const map = new TransactionalMap<string, number>(journal);
  const notifications: string[] = [];

  map.set('a', 1);
  journal.notifyAfterPublication(() => notifications.push('outside'));
  journal.begin();
  journal.notifyAfterPublication(() => notifications.push('aborted'));
  journal.abort();

  assertEquals(
    { entries: [...map], notifications },
    { entries: [['a', 1]], notifications: ['outside'] },
    'Expected the unstaged write to stay and an aborted notification never to run',
  );
});

function createJournal(): SessionChangeJournal {
  return new SessionChangeJournal({
    reportNotificationFailure: (error) => {
      throw error;
    },
  });
}
