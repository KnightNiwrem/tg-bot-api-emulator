import type { MessageTarget, SendRequestOptions, SendResult } from '../src/services/bot_api.ts';
import { BotMessageRepeater } from '../src/services/bot_message_repetition.ts';
import type {
  BotChatMessageLookup,
  RepetitionDetails,
} from '../src/services/bot_message_sending.ts';
import type { OutgoingMessageContent } from '../src/services/message_content.ts';
import type { Poll, PollType } from '../src/types/poll.ts';
import type {
  CanonicalMessageId,
  MessageContent,
  PrivateMessage,
} from '../src/types/virtual_message.ts';

const BOT_ID = 20;
/** The account whose private chat with the bot holds the repeated messages. */
const ACCOUNT_ID = 10;
const OTHER_ACCOUNT_ID = 30;
const NOW_UNIX_SECONDS = 1_700_000_000;
const FIRST_SENT_MESSAGE_ID = 100;

/** A repetition that the repeater asked the message sender to send. */
interface SentRepetition {
  readonly messageId: number;
  readonly content: OutgoingMessageContent;
  readonly options: SendRequestOptions;
  readonly repetitionDetails: RepetitionDetails | undefined;
}

Deno.test('BotMessageRepeater requires increasing IDs only of the messages it finds', () => {
  const { repeater, sentRepetitions } = createRepeaterFixture([
    textMessage('First'),
    textMessage('Second'),
    textMessage('Third'),
  ]);
  const request = { chatId: ACCOUNT_ID, fromChatId: ACCOUNT_ID };

  const refusals = [
    repeater.forwardMessages(BOT_ID, { ...request, messageIds: [2, 1] }),
    repeater.copyMessages(BOT_ID, { ...request, messageIds: [2, 2], removesCaptions: false }),
    // The missing message 1000 does not count, so the found messages 3 and 2 are out of order.
    repeater.forwardMessages(BOT_ID, { ...request, messageIds: [3, 1_000, 2] }),
  ];
  if (
    refusals.some((result) =>
      result.sent || result.reason !== 'repeated_message_ids_not_increasing'
    ) || sentRepetitions.length !== 0
  ) {
    throw new Error(
      `Expected the requests to fail before sending anything, received ${
        JSON.stringify({ refusals, sentRepetitions })
      }`,
    );
  }

  // A missing message between them leaves the found messages 2 and 3 in order.
  const forwarded = repeater.forwardMessages(BOT_ID, { ...request, messageIds: [2, 1_000, 3] });
  if (
    !forwarded.sent ||
    JSON.stringify(forwarded.messageIds) !==
      JSON.stringify([FIRST_SENT_MESSAGE_ID, FIRST_SENT_MESSAGE_ID + 1]) ||
    JSON.stringify(sentRepetitions.map(describeSentText)) !== JSON.stringify(['Second', 'Third'])
  ) {
    throw new Error(
      `Expected the found messages to be forwarded, received ${
        JSON.stringify({ forwarded, sentRepetitions })
      }`,
    );
  }
});

Deno.test('BotMessageRepeater replies only to the repetitions of earlier messages of the request', () => {
  const question = textMessage('Question');
  const protectedAnswer = { ...textMessage('Protected'), isContentProtected: true };
  const elsewhere = textMessage('Elsewhere');
  const { repeater, sentRepetitions } = createRepeaterFixture([
    question,
    protectedAnswer,
    textMessage('Follow-up', { replyToMessageId: question.id }),
    textMessage('About the protected answer', { replyToMessageId: protectedAnswer.id }),
    textMessage('About another message', { replyToMessageId: elsewhere.id }),
    elsewhere,
  ]);

  const forwarded = repeater.forwardMessages(BOT_ID, {
    chatId: ACCOUNT_ID,
    fromChatId: ACCOUNT_ID,
    messageIds: [1, 2, 3, 4, 5],
  });
  const sentReplies = sentRepetitions.map((repetition) => [
    describeSentText(repetition),
    repetition.options.replyTo,
  ]);
  // The protected answer cannot be forwarded, so the message replying to it is no reply, as is the
  // message replying to a message the request does not repeat.
  const expectedReplies = [
    ['Question', undefined],
    ['Follow-up', { messageId: FIRST_SENT_MESSAGE_ID, allowSendingWithoutReply: true }],
    ['About the protected answer', undefined],
    ['About another message', undefined],
  ];
  if (!forwarded.sent || JSON.stringify(sentReplies) !== JSON.stringify(expectedReplies)) {
    throw new Error(
      `Expected replies within the request to be kept, received ${JSON.stringify(sentReplies)}`,
    );
  }
});

Deno.test('BotMessageRepeater regroups what is left of an album and sends a lone member alone', () => {
  const albumPhoto = (mediaGroupId: string, isContentProtected = false): PrivateMessage => ({
    ...privateMessage({
      kind: 'photo',
      fileId: 'photo',
      caption: { text: '', entities: [] },
      hasSpoiler: false,
      showsCaptionAboveMedia: false,
    }),
    mediaGroupId,
    isContentProtected,
  });
  const { repeater, sentRepetitions, issuedMediaGroupIds } = createRepeaterFixture([
    albumPhoto('original-1'),
    albumPhoto('original-1', true),
    albumPhoto('original-1'),
    albumPhoto('original-2'),
    albumPhoto('original-2', true),
  ]);

  const forwarded = repeater.forwardMessages(BOT_ID, {
    chatId: ACCOUNT_ID,
    fromChatId: ACCOUNT_ID,
    messageIds: [1, 2, 3, 4, 5],
  });
  const sentMediaGroupIds = sentRepetitions.map(({ repetitionDetails }) =>
    repetitionDetails?.mediaGroupId
  );
  // The protected photos are skipped: two photos of the first album remain and form a new album,
  // while the one remaining photo of the second album is sent outside any album.
  if (
    !forwarded.sent || JSON.stringify(issuedMediaGroupIds) !== JSON.stringify(['album-1']) ||
    JSON.stringify(sentMediaGroupIds) !== JSON.stringify(['album-1', 'album-1', undefined])
  ) {
    throw new Error(
      `Expected the remaining photos to form new albums, received ${
        JSON.stringify({ forwarded, sentMediaGroupIds, issuedMediaGroupIds })
      }`,
    );
  }
});

Deno.test('BotMessageRepeater copies a quiz only where the bot sees its solution', () => {
  const quizType: PollType = {
    kind: 'quiz',
    correctOptionPositions: [1],
    explanation: { text: '', entities: [] },
  };
  const hiddenQuiz = createPoll('hidden-quiz', quizType);
  const shownQuiz = createPoll('shown-quiz', quizType);
  // A forward of a quiz to the bot's private chat does not show the bot its solution, while the
  // quiz an account sent there does.
  const hiddenQuizMessage: PrivateMessage = {
    ...privateMessage({ kind: 'poll', pollId: hiddenQuiz.id }),
    forwardInfo: {
      originalSender: { kind: 'user', userId: OTHER_ACCOUNT_ID },
      originalSentAtUnixSeconds: NOW_UNIX_SECONDS - 60,
    },
  };
  const { repeater, sentRepetitions } = createRepeaterFixture(
    [
      hiddenQuizMessage,
      textMessage('Answer it'),
      privateMessage({ kind: 'poll', pollId: shownQuiz.id }),
    ],
    [hiddenQuiz, shownQuiz],
  );
  const copyTarget = (messageId: number) => ({
    chatId: ACCOUNT_ID,
    copiedMessage: { chatId: ACCOUNT_ID, messageId },
    showsCaptionAboveMedia: false,
  });

  const refusedCopy = repeater.copyMessage(BOT_ID, copyTarget(1));
  const sentAfterRefusal = sentRepetitions.length;
  const copies = repeater.copyMessages(BOT_ID, {
    chatId: ACCOUNT_ID,
    fromChatId: ACCOUNT_ID,
    messageIds: [1, 2],
    removesCaptions: false,
  });
  const shownQuizCopy = repeater.copyMessage(BOT_ID, copyTarget(3));
  const sentKinds = sentRepetitions.map(({ content }) => content.kind);
  const quizCopyContent = sentRepetitions.at(-1)?.content;
  if (
    refusedCopy.sent || refusedCopy.reason !== 'message_not_copyable' || sentAfterRefusal !== 0 ||
    !copies.sent || copies.messageIds.length !== 1 || !shownQuizCopy.sent ||
    JSON.stringify(sentKinds) !== JSON.stringify(['existing', 'poll']) ||
    quizCopyContent?.kind !== 'poll' ||
    JSON.stringify(quizCopyContent.poll.type) !== JSON.stringify(quizType)
  ) {
    throw new Error(
      `Expected only the quiz whose solution the bot sees to be copied, received ${
        JSON.stringify({ refusedCopy, copies, shownQuizCopy, sentRepetitions })
      }`,
    );
  }
});

Deno.test('BotMessageRepeater copies a poll as a new open poll of the bot, timed from now', () => {
  const closedPoll: Poll = {
    ...createPoll('closed-poll', { kind: 'regular' }),
    isClosed: true,
    closingTime: { openPeriodSeconds: 60, closeDateUnixSeconds: NOW_UNIX_SECONDS - 600 },
    answersByVoterId: new Map([[ACCOUNT_ID, [0]]]),
  };
  const { repeater, sentRepetitions } = createRepeaterFixture(
    [privateMessage({ kind: 'poll', pollId: closedPoll.id })],
    [closedPoll],
  );

  const copy = repeater.copyMessage(BOT_ID, {
    chatId: ACCOUNT_ID,
    copiedMessage: { chatId: ACCOUNT_ID, messageId: 1 },
    // A copy of a poll ignores a new caption.
    caption: { text: 'Ignored' },
    showsCaptionAboveMedia: false,
  });
  const [sentCopy] = sentRepetitions;
  const expectedContent: OutgoingMessageContent = {
    kind: 'poll',
    poll: {
      creator: { kind: 'bot', botId: BOT_ID },
      question: closedPoll.question,
      options: closedPoll.options.map(({ text }) => text),
      isAnonymous: closedPoll.isAnonymous,
      allowsMultipleAnswers: closedPoll.allowsMultipleAnswers,
      allowsRevoting: closedPoll.allowsRevoting,
      type: closedPoll.type,
      isClosed: false,
      closingTime: { openPeriodSeconds: 60, closeDateUnixSeconds: NOW_UNIX_SECONDS + 60 },
    },
  };
  if (
    !copy.sent || sentRepetitions.length !== 1 ||
    JSON.stringify(sentCopy.content) !== JSON.stringify(expectedContent)
  ) {
    throw new Error(
      `Expected a new open poll of the bot, received ${JSON.stringify(sentRepetitions)}`,
    );
  }
});

/**
 * A repeater whose message sender finds the given messages in the private chat with
 * `ACCOUNT_ID`, by their position counted from 1, and records each repetition it sends, which it
 * always sends.
 */
function createRepeaterFixture(messages: readonly PrivateMessage[], polls: readonly Poll[] = []) {
  const sentRepetitions: SentRepetition[] = [];
  const issuedMediaGroupIds: string[] = [];
  const repeater = new BotMessageRepeater({
    messageSender: {
      findBotChatMessage(_botId: number, { chatId, messageId }: MessageTarget) {
        const message = messages[messageId - 1];
        const lookup: BotChatMessageLookup = chatId !== ACCOUNT_ID
          ? { found: false, reason: 'chat_not_found' }
          : message === undefined
          ? { found: false, reason: 'message_not_found' }
          : { found: true, message, chatProtectsContent: false };
        return lookup;
      },
      lacksSendPermission: () => false,
      send(
        _botId: number,
        content: OutgoingMessageContent,
        options: SendRequestOptions,
        repetitionDetails?: RepetitionDetails,
      ): SendResult {
        const messageId = FIRST_SENT_MESSAGE_ID + sentRepetitions.length;
        sentRepetitions.push({ messageId, content, options, repetitionDetails });
        return {
          sent: true,
          message: {
            message_id: messageId,
            from: { id: BOT_ID, is_bot: true, first_name: 'Bot', username: 'test_bot' },
            chat: { id: ACCOUNT_ID, type: 'private', first_name: 'Ada' },
            date: NOW_UNIX_SECONDS,
            text: 'Sent',
          },
        };
      },
    },
    mediaGroups: {
      createMediaGroupId: () => {
        const mediaGroupId = `album-${issuedMediaGroupIds.length + 1}`;
        issuedMediaGroupIds.push(mediaGroupId);
        return mediaGroupId;
      },
    },
    polls: { getPoll: (pollId) => polls.find((poll) => poll.id === pollId) },
    getPrivateForwardName: () => undefined,
    currentUnixTimeSeconds: () => NOW_UNIX_SECONDS,
  });
  return { repeater, sentRepetitions, issuedMediaGroupIds };
}

/** The text that a sent repetition repeats, or `undefined` for other content. */
function describeSentText({ content }: Pick<SentRepetition, 'content'>): string | undefined {
  return content.kind === 'existing' && content.content.kind === 'text'
    ? content.content.text
    : undefined;
}

function textMessage(
  text: string,
  { replyToMessageId }: { readonly replyToMessageId?: CanonicalMessageId } = {},
): PrivateMessage {
  return {
    ...privateMessage({ kind: 'text', text, entities: [] }),
    ...(replyToMessageId === undefined ? {} : { replyToMessageId }),
  };
}

/** A message that the account sent to the bot's private chat. */
function privateMessage(content: MessageContent): PrivateMessage {
  return {
    kind: 'private_message',
    id: crypto.randomUUID(),
    conversation: { accountId: ACCOUNT_ID, botId: BOT_ID },
    authorRole: 'account',
    sentAtUnixSeconds: NOW_UNIX_SECONDS - 60,
    content,
    isContentProtected: false,
    isSilent: false,
    isPinned: false,
  };
}

/** An open poll that another account created, without votes. */
function createPoll(id: string, type: PollType): Poll {
  return {
    id,
    creator: { kind: 'account', accountId: OTHER_ACCOUNT_ID },
    question: { text: 'Which is round?', entities: [] },
    options: ['Pasta', 'Pizza'].map((text, position) => ({
      persistentId: String(position),
      text: { text, entities: [] },
    })),
    isAnonymous: false,
    allowsMultipleAnswers: false,
    allowsRevoting: false,
    type,
    isClosed: false,
    answersByVoterId: new Map(),
  };
}
