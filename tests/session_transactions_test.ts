import type { NewPoll } from '../src/types/poll.ts';
import { createStagedSessionFixture, FAILED_VIEW_MESSAGE } from './support/staged_session.ts';

Deno.test('a command whose projection fails after one recipient commits nothing it staged', () => {
  const fixture = createStagedSessionFixture({ privacyMode: false });
  const { alpha, beta, polls, transactions } = fixture;
  const committedPoll = polls.addPoll(POLL);
  const stateBefore = fixture.readState(committedPoll.id);

  fixture.views.failingObserverId = beta;
  let stagedPollId = '';
  const commandError = captureError(() =>
    transactions.execute(() => {
      fixture.sendBotText(alpha, 'Morning, team');
      stagedPollId = polls.addPoll(POLL).id;
      polls.setVoterAnswer(committedPoll.id, fixture.adaId, [1]);
      fixture.recordActivity(alpha);
      // Alpha's update and its file ID for the photo are staged before Beta's view fails.
      fixture.sendAccountPhoto('Notes');
    })
  );
  const [alphaView] = fixture.views.messageViewsSeen;
  const stagedPhoto = alphaView !== undefined && 'photo' in alphaView
    ? alphaView.photo.at(-1)
    : undefined;

  assertJson(
    {
      error: commandError,
      state: fixture.readState(committedPoll.id),
      stagedPoll: polls.getPoll(stagedPollId) === undefined,
      stagedPhotoFile: stagedPhoto === undefined
        ? 'not viewed'
        : fixture.files.findObserverFile(alpha, stagedPhoto.file_id) === undefined,
    },
    {
      error: FAILED_VIEW_MESSAGE,
      state: stateBefore,
      stagedPoll: true,
      stagedPhotoFile: true,
    },
    'Expected the failed command to leave every repository as it was',
  );

  // The next command numbers its messages and updates as though the failed one never ran.
  fixture.views.failingObserverId = undefined;
  transactions.execute(() => fixture.sendAccountPhoto('Notes'));
  assertJson(
    {
      messageIds: fixture.views.messageViewsSeen.slice(-2).map((message) => message.message_id),
      alphaUpdateIds: fixture.botUpdates.readPendingUpdates(alpha).map((update) =>
        update.update_id
      ),
    },
    {
      messageIds: [stateBefore.messageCount + 1, stateBefore.messageCount + 1],
      alphaUpdateIds: [stateBefore.updates[0].nextUpdateId],
    },
    'Expected the failed command to have used up no message or update ID',
  );
});

Deno.test('an album whose second member fails to project commits none of its members', () => {
  const fixture = createStagedSessionFixture({ privacyMode: false });
  const stateBefore = fixture.readState();

  fixture.views.failingObserverId = fixture.alpha;
  fixture.views.failingMessageViewNumber = 2;
  const commandError = captureError(() =>
    fixture.transactions.execute(() => fixture.sendAccountAlbum(['First', 'Second']))
  );

  assertJson(
    { error: commandError, state: fixture.readState() },
    { error: FAILED_VIEW_MESSAGE, state: stateBefore },
    "Expected the album's first member to be reverted with the second",
  );
});

Deno.test('consumers learn of a command only once it is published, and a failing one undoes nothing', async () => {
  const fixture = createStagedSessionFixture({ privacyMode: false });
  const { alpha, botUpdates, journal, transactions } = fixture;
  const notifications: string[] = [];
  const longPoll = botUpdates.waitForUpdate(alpha, {
    awaitedUpdateId: botUpdates.getNextUpdateId(alpha),
  });

  transactions.execute(() => {
    journal.notifyAfterPublication(() => {
      notifications.push('failing consumer');
      throw new Error('The consumer failed');
    });
    fixture.sendAccountPhoto('Notes');
    journal.notifyAfterPublication(() => notifications.push('later consumer'));
    notifications.push(`command ended with ${notifications.length} notifications`);
  });

  assertJson(
    {
      notifications,
      failures: fixture.notificationFailures,
      alphaUpdates: botUpdates.readPendingUpdates(alpha).length,
      longPoll: await longPoll,
    },
    {
      notifications: [
        'command ended with 0 notifications',
        'failing consumer',
        'later consumer',
      ],
      failures: ['The consumer failed'],
      alphaUpdates: 1,
      longPoll: 'notified',
    },
    'Expected consumers to run after publication, and the failing one to undo or stop nothing',
  );
});

Deno.test('a command after its session ended does not run, and commands do not nest', () => {
  const fixture = createStagedSessionFixture({ privacyMode: false });
  const stateBefore = fixture.readState();

  const nestingError = captureError(() =>
    fixture.transactions.execute(() => {
      fixture.sendAccountPhoto('Outer');
      fixture.transactions.execute(() => fixture.sendAccountPhoto('Inner'));
    })
  );
  const joinedChangeError = captureError(() =>
    fixture.transactions.execute(() => {
      fixture.transactions.withinTransaction(() => fixture.sendAccountPhoto('Joined'));
      throw new Error('The command failed after its change');
    })
  );
  const stateAfterFailures = fixture.readState();
  fixture.endSession();
  let ranAfterEnd = false;
  const execution = fixture.transactions.execute(() => {
    ranAfterEnd = true;
  });

  assertJson(
    { nestingError, joinedChangeError, stateAfterFailures, execution, ranAfterEnd },
    {
      nestingError: 'A transaction is already open; transactions do not nest',
      joinedChangeError: 'The command failed after its change',
      stateAfterFailures: stateBefore,
      execution: { executed: false, reason: 'session_ended' },
      ranAfterEnd: false,
    },
    'Expected nested and joined changes to abort with their command, and an ended session to refuse',
  );
});

Deno.test('each event of a command is projected against the state the command staged before it', () => {
  const fixture = createStagedSessionFixture({ privacyMode: true });
  const { alpha, beta, botUpdates } = fixture;

  fixture.transactions.execute(() => {
    // Before any bot has written, a command without a username reaches every bot in privacy mode.
    fixture.sendAccountText('/help');
    fixture.sendBotText(alpha, 'I am listening');
    // Alpha now wrote last, so only it receives the next such command.
    fixture.sendAccountText('/start');
  });

  const texts = (botId: number) =>
    botUpdates.readPendingUpdates(botId).map((update) =>
      'message' in update && 'text' in update.message ? update.message.text : undefined
    );
  assertJson(
    { alpha: texts(alpha), beta: texts(beta) },
    { alpha: ['/help', '/start'], beta: ['/help'] },
    'Expected the routing Alpha staged to decide who received the later command',
  );
});

const POLL: NewPoll = {
  creator: { kind: 'account', accountId: 1 },
  question: { text: 'Lunch?', entities: [] },
  optionTexts: [{ text: 'Yes', entities: [] }, { text: 'No', entities: [] }],
  isAnonymous: false,
  allowsMultipleAnswers: false,
  allowsRevoting: true,
  type: { kind: 'regular' },
  isClosed: false,
};

function captureError(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return 'no error';
}

function assertJson(actual: unknown, expected: unknown, message: string): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${message}\nExpected: ${expectedJson}\nReceived: ${actualJson}`);
  }
}
