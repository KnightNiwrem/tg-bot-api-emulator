import { type NotificationWaitEnd, waitForNotification } from '../src/timing/notification_wait.ts';
import { ControlledDeadline } from './support/scheduler.ts';

Deno.test('waitForNotification ends when its wake source fires, and unsubscribes', async () => {
  const wakeSource = new CountingWakeSource();
  const wait = waitForNotification({ subscribe: wakeSource.subscribe, hasChanged: () => false });
  expectSubscriberCount(wakeSource, 1, 'Expected the wait to subscribe to its wake source');

  wakeSource.notify();

  await expectWaitEnd(wait, 'notified');
  expectSubscriberCount(wakeSource, 0, 'Expected the woken wait to unsubscribe');
});

Deno.test('waitForNotification ends at once for a change made before it subscribed', async () => {
  const wakeSource = new CountingWakeSource();
  let changeCheckCount = 0;
  const wait = waitForNotification({
    subscribe: wakeSource.subscribe,
    hasChanged: () => {
      changeCheckCount++;
      // The change is checked only once the wake source would report a later one.
      return wakeSource.subscriberCount === 1;
    },
  });

  await expectWaitEnd(wait, 'notified');
  if (changeCheckCount !== 1) {
    throw new Error(`Expected one check of the change, without polling, saw ${changeCheckCount}`);
  }
  expectSubscriberCount(wakeSource, 0, 'Expected the ended wait to unsubscribe');
});

Deno.test('waitForNotification ends when its wake source fires while it subscribes', async () => {
  let unsubscribeCount = 0;
  const wait = waitForNotification({
    subscribe: (notify) => {
      notify();
      return () => unsubscribeCount++;
    },
    hasChanged: () => false,
  });

  await expectWaitEnd(wait, 'notified');
  if (unsubscribeCount !== 1) {
    throw new Error(`Expected the wait to unsubscribe once, saw ${unsubscribeCount}`);
  }
});

Deno.test('waitForNotification ends when its deadline arrives, and unsubscribes', async () => {
  const wakeSource = new CountingWakeSource();
  const deadline = createDeadline();
  const wait = waitForNotification({
    subscribe: wakeSource.subscribe,
    hasChanged: () => false,
    deadline,
  });

  deadline.arrive();

  await expectWaitEnd(wait, 'deadline_arrived');
  expectSubscriberCount(wakeSource, 0, 'Expected the expired wait to unsubscribe');
  // A later notification is no longer the wait's to handle.
  wakeSource.notify();
});

Deno.test('waitForNotification ends when its signal aborts, before or during the wait', async () => {
  const wakeSource = new CountingWakeSource();
  const waitEnd = new AbortController();
  const wait = waitForNotification({
    subscribe: wakeSource.subscribe,
    hasChanged: () => false,
    signal: waitEnd.signal,
  });
  waitEnd.abort();
  await expectWaitEnd(wait, 'aborted');

  // An ended signal decides before an arrived deadline or a change, which also end the wait.
  const arrivedDeadline = createDeadline();
  arrivedDeadline.arrive();
  await expectWaitEnd(
    waitForNotification({
      subscribe: wakeSource.subscribe,
      hasChanged: () => true,
      deadline: arrivedDeadline,
      signal: waitEnd.signal,
    }),
    'aborted',
  );
  await expectWaitEnd(
    waitForNotification({
      subscribe: wakeSource.subscribe,
      hasChanged: () => true,
      deadline: arrivedDeadline,
    }),
    'deadline_arrived',
  );
  expectSubscriberCount(wakeSource, 0, 'Expected every ended wait to unsubscribe');
});

/** A wake source that counts its subscribers. */
class CountingWakeSource {
  readonly #notifiers = new Set<() => void>();

  get subscriberCount(): number {
    return this.#notifiers.size;
  }

  readonly subscribe = (notify: () => void) => {
    this.#notifiers.add(notify);
    return () => {
      this.#notifiers.delete(notify);
    };
  };

  notify(): void {
    for (const notify of [...this.#notifiers]) {
      notify();
    }
  }
}

function expectSubscriberCount(
  wakeSource: CountingWakeSource,
  expectedCount: number,
  message: string,
): void {
  if (wakeSource.subscriberCount !== expectedCount) {
    throw new Error(`${message}, saw ${wakeSource.subscriberCount} subscribers`);
  }
}

async function expectWaitEnd(
  wait: Promise<NotificationWaitEnd>,
  expectedEnd: NotificationWaitEnd,
): Promise<void> {
  const waitEnd = await wait;
  if (waitEnd !== expectedEnd) {
    throw new Error(`Expected the wait to end as ${expectedEnd}, saw ${waitEnd}`);
  }
}

function createDeadline(): ControlledDeadline {
  return new ControlledDeadline(Infinity, new AbortController().signal);
}
