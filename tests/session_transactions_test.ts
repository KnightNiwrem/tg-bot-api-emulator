import { AccountRepository } from '../src/repositories/account.ts';
import { BotRepository } from '../src/repositories/bot.ts';
import { BotActivityLogRepository } from '../src/repositories/bot_activity_log.ts';
import { BotUpdateRepository } from '../src/repositories/bot_update.ts';
import { BotUpdateSubscriptionRepository } from '../src/repositories/bot_update_subscription.ts';
import { FileRepository } from '../src/repositories/file.ts';
import { LastMessageSendingBotRepository } from '../src/repositories/last_message_sending_bot.ts';
import { MessageRepository } from '../src/repositories/message.ts';
import { MessageBoxRepository } from '../src/repositories/message_box.ts';
import { PollRepository } from '../src/repositories/poll.ts';
import { SharedChatRepository } from '../src/repositories/shared_chat.ts';
import { TelegramIdentityRepository } from '../src/repositories/telegram_identity.ts';
import { BotMessageViewService } from '../src/services/bot_message_view.ts';
import { BotUpdateDeliveryService } from '../src/services/bot_update_delivery.ts';
import { SessionLifetime } from '../src/services/session_lifetime.ts';
import { SharedChatAdministrationService } from '../src/services/shared_chat_administration.ts';
import { SupergroupMessagingService } from '../src/services/supergroup_messaging.ts';
import { VirtualUserService } from '../src/services/virtual_user.ts';
import { SessionChangeJournal } from '../src/transactions/change_staging.ts';
import { SessionTransactions } from '../src/transactions/session_transactions.ts';
import type { BotApiSupergroupMessage } from '../src/types/bot_api.ts';
import type { NewPoll } from '../src/types/poll.ts';
import type { PhotoUpload } from '../src/types/stored_file.ts';
import type { SupergroupMessage } from '../src/types/virtual_message.ts';

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
  const [alphaView] = fixture.views.viewsSeen;
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
      error: 'The view of a message failed',
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
      messageIds: fixture.views.viewsSeen.slice(-2).map((message) => message.message_id),
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
  fixture.views.failingViewNumber = 2;
  const commandError = captureError(() =>
    fixture.transactions.execute(() => fixture.sendAccountAlbum(['First', 'Second']))
  );

  assertJson(
    { error: commandError, state: fixture.readState() },
    { error: 'The view of a message failed', state: stateBefore },
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

/** Views supergroup messages as the session does, failing for one observer when told to. */
class FailingBotMessageViews extends BotMessageViewService {
  /** The observer whose view fails; none while `undefined`. */
  failingObserverId: number | undefined;
  /** Which of the failing observer's views fails, counted from 1. */
  failingViewNumber = 1;
  /** The views that succeeded, in order. */
  readonly viewsSeen: BotApiSupergroupMessage[] = [];
  #failingObserverViewCount = 0;

  override viewSupergroupMessage(
    message: SupergroupMessage,
    observerId: number,
  ): BotApiSupergroupMessage {
    if (observerId === this.failingObserverId) {
      this.#failingObserverViewCount += 1;
      if (this.#failingObserverViewCount === this.failingViewNumber) {
        throw new Error('The view of a message failed');
      }
    }
    const view = super.viewSupergroupMessage(message, observerId);
    this.viewsSeen.push(view);
    return view;
  }
}

/**
 * A supergroup of Ada's with two bots, Alpha and Beta, over repositories staged in one session's
 * transactions. Only the shared chats are not staged.
 */
function createStagedSessionFixture({ privacyMode }: { readonly privacyMode: boolean }) {
  const notificationFailures: unknown[] = [];
  const journal = new SessionChangeJournal({
    reportNotificationFailure: (error) =>
      notificationFailures.push(error instanceof Error ? error.message : error),
  });
  const sessionEnd = new AbortController();
  const identities = new TelegramIdentityRepository();
  const accounts = new AccountRepository();
  const bots = new BotRepository();
  const virtualUsers = new VirtualUserService({ identities, accounts, bots });
  const sharedChats = new SharedChatRepository();
  const messages = new MessageRepository(journal);
  const files = new FileRepository(journal);
  const polls = new PollRepository(journal);
  const messageBoxes = new MessageBoxRepository(journal);
  const botUpdates = new BotUpdateRepository(journal);
  const lastMessageSendingBots = new LastMessageSendingBotRepository(journal);
  const activityLog = new BotActivityLogRepository(journal);
  const views = new FailingBotMessageViews({
    accounts,
    bots,
    sharedChats,
    messageBoxes,
    messages,
    files,
    polls,
  });
  const transactions = new SessionTransactions({
    journal,
    lifetime: new SessionLifetime(sessionEnd.signal),
    projector: new BotUpdateDeliveryService({
      botMessageViews: views,
      botUpdates,
      updateSubscriptions: new BotUpdateSubscriptionRepository(),
      bots,
      sharedChats,
      messages,
      lastMessageSendingBots,
    }),
  });
  const currentUnixTimeSeconds = () => 1_700_000_000;
  const supergroupMessaging = new SupergroupMessagingService({
    accounts,
    bots,
    sharedChats,
    messages,
    files,
    polls,
    messageBoxes,
    events: transactions,
    currentUnixTimeSeconds,
  });
  const administration = new SharedChatAdministrationService({
    identities,
    accounts,
    bots,
    sharedChats,
    supergroupMessages: supergroupMessaging,
    events: transactions,
    currentUnixTimeSeconds,
  });

  const ada = virtualUsers.createAccount({ first_name: 'Ada' });
  const [alpha, beta] = ['alpha_bot', 'beta_bot'].map((username) => {
    const creation = virtualUsers.createBot({
      first_name: username,
      username,
      can_read_all_group_messages: !privacyMode,
    });
    if (!creation.created) {
      throw new Error(`Expected ${username} to be created: ${creation.reason}`);
    }
    return creation.bot.profile.id;
  });
  if (!ada.created) {
    throw new Error(`Expected Ada to be created: ${ada.reason}`);
  }
  const adaId = ada.account.profile.id;
  const creation = administration.createSupergroup({ title: 'Team', creatorAccountId: adaId });
  if (!creation.created) {
    throw new Error(`Expected the supergroup to be created: ${creation.reason}`);
  }
  const chatId = creation.supergroup.id;
  for (const botId of [alpha, beta]) {
    administration.addChatMember({ actorAccountId: adaId, chatId, memberId: botId });
  }
  // The additions' updates and views are of no interest here.
  for (const botId of [alpha, beta]) {
    botUpdates.discardPendingUpdates(botId);
  }
  views.viewsSeen.splice(0);

  const expectSent = (result: { readonly sent: boolean }) => {
    if (!result.sent) {
      throw new Error(`Expected the message to be sent: ${JSON.stringify(result)}`);
    }
  };
  return {
    journal,
    transactions,
    views,
    files,
    polls,
    botUpdates,
    notificationFailures,
    adaId,
    alpha,
    beta,
    endSession: () => sessionEnd.abort(),
    sendAccountText: (text: string) =>
      expectSent(
        supergroupMessaging.sendAccountMessage({
          fromAccountId: adaId,
          chatId,
          content: { kind: 'text', text },
        }),
      ),
    sendAccountPhoto: (caption: string) =>
      expectSent(
        supergroupMessaging.sendAccountMessage({
          fromAccountId: adaId,
          chatId,
          content: { kind: 'media', upload: photoUpload(), caption },
        }),
      ),
    sendAccountAlbum: (captions: readonly string[]) =>
      expectSent(
        supergroupMessaging.sendAccountAlbum({
          fromAccountId: adaId,
          chatId,
          contents: captions.map((caption) => ({ kind: 'media', upload: photoUpload(), caption })),
        }),
      ),
    sendBotText: (botId: number, text: string) =>
      expectSent(
        supergroupMessaging.sendBotMessage({
          fromBotId: botId,
          chatId,
          content: { kind: 'text', text },
        }),
      ),
    recordActivity: (botId: number) =>
      activityLog.append({
        kind: 'bot_api_call',
        botId,
        method: 'sendMessage',
        requestedMethod: 'sendMessage',
        via: 'http',
        parameters: {},
        uploadedFiles: [],
        answer: { ok: true, result: true },
      }),
    /** What the staged repositories hold, as readers outside a command see it. */
    readState: (pollId?: string) => {
      const chatMessages = messages.getChatMessages({ type: 'supergroup', chatId });
      return {
        messageCount: chatMessages.length,
        numbering: chatMessages.map((message) => messageBoxes.getMessageId(chatId, message.id)),
        updates: [alpha, beta].map((botId) => ({
          pending: botUpdates.readPendingUpdates(botId).length,
          nextUpdateId: botUpdates.getNextUpdateId(botId),
        })),
        lastMessageSendingBotId: lastMessageSendingBots.getLastMessageSendingBotId(chatId) ?? null,
        activityHead: activityLog.getHeadPosition(),
        pollAnswers: pollId === undefined
          ? null
          : [...(polls.getPoll(pollId)?.answersByVoterId ?? new Map())],
      };
    },
  };
}

function photoUpload(): PhotoUpload {
  const content = new Uint8Array(13);
  content.set(new TextEncoder().encode('GIF89a'));
  content.set([4, 0, 3, 0], 6);
  return { type: 'photo', content, imageFormat: 'gif', width: 4, height: 3 };
}

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
