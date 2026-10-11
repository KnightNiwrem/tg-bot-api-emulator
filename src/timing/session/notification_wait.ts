import type { Deadline } from './session_timing.ts';

/** Ends a subscription; ending it again does nothing. */
export type Unsubscribe = () => void;

export interface NotificationWaitInput {
  /**
   * Subscribes `notify` to the wake source: the notification of the change being waited for, such
   * as a repository's enqueue or append notification, which calls `notify` each time it fires.
   */
  readonly subscribe: (notify: () => void) => Unsubscribe;
  /**
   * Whether the change being waited for has already happened since the caller last looked. It is
   * checked once, right after subscribing, so that a change made before the subscription, such as
   * by code that ran while a timer was being started, ends the wait at once instead of being
   * missed.
   */
  readonly hasChanged: () => boolean;
  /** Ends the wait when it arrives; omitted to wait without a time limit. */
  readonly deadline?: Deadline;
  /** Ends the wait when it aborts. */
  readonly signal?: AbortSignal;
}

/** Why a wait ended: its wake source fired, its deadline arrived, or its signal aborted. */
export type NotificationWaitEnd = 'notified' | 'deadline_arrived' | 'aborted';

/**
 * Waits for a notification of a change, its deadline or its signal, whichever comes first. The
 * wait subscribes, then rechecks the signal, the deadline and the change, so nothing that happened
 * before the subscription is missed; it never polls. Every exit ends the subscription and removes
 * the wait's listeners. A wait whose signal has already aborted ends as `aborted`, and one whose
 * deadline has already arrived as `deadline_arrived`, before the change is checked.
 */
export function waitForNotification(
  { subscribe, hasChanged, deadline, signal }: NotificationWaitInput,
): Promise<NotificationWaitEnd> {
  return new Promise((resolve) => {
    let hasEnded = false;
    // Replaced by the subscription's end once `subscribe` returns.
    let unsubscribe: Unsubscribe = () => {};
    const end = (waitEnd: NotificationWaitEnd) => {
      if (hasEnded) {
        return;
      }
      hasEnded = true;
      unsubscribe();
      deadline?.signal.removeEventListener('abort', endForDeadline);
      signal?.removeEventListener('abort', endForAbort);
      resolve(waitEnd);
    };
    const endForDeadline = () => end('deadline_arrived');
    const endForAbort = () => end('aborted');

    const subscription = subscribe(() => end('notified'));
    if (hasEnded) {
      // The wake source fired while subscribing.
      subscription();
      return;
    }
    unsubscribe = subscription;
    deadline?.signal.addEventListener('abort', endForDeadline, { once: true });
    signal?.addEventListener('abort', endForAbort, { once: true });

    if (signal?.aborted === true) {
      endForAbort();
    } else if (deadline?.signal.aborted === true) {
      endForDeadline();
    } else if (hasChanged()) {
      end('notified');
    }
  });
}
