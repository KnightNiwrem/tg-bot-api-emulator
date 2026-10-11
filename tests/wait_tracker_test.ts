import { assertEquals, assertRejects } from '@std/assert';

import { waitForNotification } from '../src/timing/notification_wait.ts';
import { WaitTracker } from '../src/timing/wait_tracker.ts';

Deno.test('a tracked wait is awake once its promise settles, resolved or rejected', async () => {
  for (const settle of ['resolve', 'reject'] as const) {
    const tracker = new WaitTracker();
    const awaited = Promise.withResolvers<void>();
    const waiting = tracker.waitOn(() => awaited.promise);
    const whileWaiting = tracker.isAwake;

    if (settle === 'resolve') {
      awaited.resolve();
    } else {
      awaited.reject(new Error('The wait failed'));
    }
    // A reader that learns of the settlement learns it after the tracker's own handler, which the
    // wait attached first.
    await awaited.promise.catch(() => {});
    const onceSettled = tracker.isAwake;
    if (settle === 'reject') {
      await assertRejects(() => waiting, Error, 'The wait failed');
    }

    assertEquals([settle, whileWaiting, onceSettled], [settle, false, true]);
  }
});

Deno.test('code that settles a tracked wait itself makes it awake in the same step', () => {
  const tracker = new WaitTracker();
  let endWait = () => {};
  tracker.waitOn((end) => {
    endWait = end;
    return new Promise(() => {});
  });
  const whileWaiting = tracker.isAwake;
  endWait();

  assertEquals([whileWaiting, tracker.isAwake], [false, true]);
});

Deno.test("an earlier wait's settlement does not wake a later wait", async () => {
  const tracker = new WaitTracker();
  const first = Promise.withResolvers<void>();
  const firstWait = tracker.waitOn(() => first.promise);
  first.resolve();
  await firstWait;
  tracker.waitOn(() => new Promise(() => {}));
  await Promise.resolve();

  assertEquals(tracker.isAwake, false);
});

Deno.test('a notification wait wakes its tracker in the step that ends it, however it ends', () => {
  const endings = {
    notified: (notify: () => void) => notify(),
    aborted: (_notify: () => void, abort: AbortController) => abort.abort(),
  } as const;
  const results = Object.entries(endings).map(([ending, end]) => {
    const tracker = new WaitTracker();
    const abort = new AbortController();
    let notify = () => {};
    tracker.waitOn((endWait) =>
      waitForNotification({
        subscribe: (onNotify) => {
          notify = onNotify;
          return () => {};
        },
        hasChanged: () => false,
        signal: abort.signal,
        onEnd: endWait,
      })
    );
    const whileWaiting = tracker.isAwake;
    end(notify, abort);
    return [ending, whileWaiting, tracker.isAwake];
  });

  assertEquals(results, [['notified', false, true], ['aborted', false, true]]);
});
