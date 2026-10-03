import { resolveReplyQuote, type SpecifiedQuote } from '../src/services/message_content.ts';
import { createAutomaticQuote, createExternalReply } from '../src/types/message_reply.ts';
import type {
  FormattedText,
  PrivateContentMessage,
  SupergroupContentMessage,
} from '../src/types/virtual_message.ts';

const ACCOUNT_ID = 1_000_001;
const BOT_ID = 1_000_002;
const SUPERGROUP_ID = -1_000_000_000_001;

const textFixingContext = { isMentionableUser: () => true };

Deno.test('createExternalReply shows a supergroup message by its hidden origin and ID', () => {
  const message: SupergroupContentMessage = {
    kind: 'supergroup_message',
    id: 'message',
    chatId: SUPERGROUP_ID,
    author: { kind: 'account', accountId: ACCOUNT_ID },
    sentAtUnixSeconds: 1_700_000_000,
    content: { kind: 'text', text: 'Ship it', entities: [] },
    isContentProtected: false,
    isSilent: false,
    isPinned: false,
  };

  const target = createExternalReply(
    message,
    42,
    (userId) => userId === ACCOUNT_ID ? 'Ada' : undefined,
  );
  const expected = {
    externalReply: {
      origin: {
        originalSender: { kind: 'hidden_user', name: 'Ada' },
        originalSentAtUnixSeconds: 1_700_000_000,
      },
      supergroupMessage: { chatId: SUPERGROUP_ID, messageId: 42 },
    },
    repliedText: { text: 'Ship it', entities: [] },
  };
  if (JSON.stringify(target) !== JSON.stringify(expected)) {
    throw new Error(`Expected the supergroup message, received ${JSON.stringify(target)}`);
  }
});

Deno.test('createExternalReply keeps private media without its caption', () => {
  const caption = { text: 'A photo', entities: [] };
  const message: PrivateContentMessage = {
    kind: 'private_message',
    id: 'message',
    conversation: { accountId: ACCOUNT_ID, botId: BOT_ID },
    authorRole: 'bot',
    sentAtUnixSeconds: 1_700_000_000,
    content: {
      kind: 'photo',
      fileId: 'photo',
      caption,
      hasSpoiler: true,
      showsCaptionAboveMedia: true,
    },
    isContentProtected: false,
    isSilent: false,
    isPinned: false,
  };

  const { externalReply, repliedText } = createExternalReply(message, 7, () => undefined);
  const expectedMedia = {
    kind: 'photo',
    fileId: 'photo',
    caption: { text: '', entities: [] },
    hasSpoiler: true,
    showsCaptionAboveMedia: true,
  };
  if (
    externalReply.supergroupMessage !== undefined ||
    JSON.stringify(externalReply.origin.originalSender) !==
      JSON.stringify({ kind: 'user', userId: BOT_ID }) ||
    JSON.stringify(externalReply.media) !== JSON.stringify(expectedMedia) ||
    JSON.stringify(repliedText) !== JSON.stringify(caption)
  ) {
    throw new Error(
      `Expected the photo without its caption, received ${JSON.stringify(externalReply)}`,
    );
  }
});

Deno.test('createAutomaticQuote truncates to 1,024 characters and keeps quote entities', () => {
  // The quote keeps 1,024 characters: the first emoji ends it at UTF-16 offset 1,025.
  const text: FormattedText = {
    text: `${'a'.repeat(1_023)}😀😀`,
    entities: [
      { type: 'code', offset: 0, length: 3 },
      { type: 'italic', offset: 1_021, length: 4 },
      { type: 'custom_emoji', offset: 1_023, length: 2, customEmojiId: '1' },
      { type: 'custom_emoji', offset: 1_025, length: 2, customEmojiId: '2' },
      { type: 'custom_emoji', offset: 1_023, length: 4, customEmojiId: '3' },
      { type: 'bold', offset: 1_021, length: 6 },
    ],
  };

  const quote = createAutomaticQuote(text);
  const expectedEntities = [
    { type: 'italic', offset: 1_021, length: 4 },
    { type: 'custom_emoji', offset: 1_023, length: 2, customEmojiId: '1' },
    { type: 'bold', offset: 1_021, length: 4 },
  ];
  if (
    quote?.text.text !== `${'a'.repeat(1_023)}😀` || quote.position !== 0 || quote.isManual ||
    JSON.stringify(quote.text.entities) !== JSON.stringify(expectedEntities)
  ) {
    throw new Error(`Expected a truncated automatic quote, received ${JSON.stringify(quote)}`);
  }
  if (createAutomaticQuote({ text: '', entities: [] }) !== undefined) {
    throw new Error('Expected empty text to have no quote');
  }
});

Deno.test('resolveReplyQuote finds a chosen quote nearest to its position', () => {
  const repliedText: FormattedText = {
    text: 'go, go, go now',
    entities: [{ type: 'bold', offset: 8, length: 6 }, { type: 'code', offset: 0, length: 2 }],
  };
  const resolve = (specifiedQuote: SpecifiedQuote | undefined, quotesAutomatically = false) =>
    resolveReplyQuote({ repliedText, quotesAutomatically }, specifiedQuote, textFixingContext);

  const nearest = resolve({ text: 'go', position: 5 });
  const withFormatting = resolve({
    text: '  go now',
    entities: [{ type: 'bold', offset: 2, length: 6 }],
    position: 6,
  });
  // The code entity is not kept in quotes, so it need not be quoted.
  const first = resolve({ text: 'go,', position: 1_000_001 });
  const expected = [
    { text: { text: 'go', entities: [] }, position: 4, isManual: true },
    {
      text: { text: 'go now', entities: [{ type: 'bold', offset: 0, length: 6 }] },
      position: 8,
      isManual: true,
    },
    { text: { text: 'go,', entities: [] }, position: 0, isManual: true },
  ];
  const received = [nearest, withFormatting, first].map((resolution) =>
    resolution.resolved ? resolution.quote : resolution.reason
  );
  if (JSON.stringify(received) !== JSON.stringify(expected)) {
    throw new Error(`Expected the quotes to be found, received ${JSON.stringify(received)}`);
  }
});

Deno.test('resolveReplyQuote rejects a quote that is not an exact part of the replied text', () => {
  const repliedText: FormattedText = {
    text: 'Ship it now',
    entities: [{ type: 'bold', offset: 0, length: 4 }],
  };
  const resolve = (specifiedQuote: SpecifiedQuote | undefined, quotesAutomatically = false) =>
    resolveReplyQuote({ repliedText, quotesAutomatically }, specifiedQuote, textFixingContext);

  for (
    const specifiedQuote of [
      { text: 'ship', position: 0 },
      // The replied text marks "Ship" bold, so the quote must too.
      { text: 'Ship it', position: 0 },
      { text: 'Ship it now!', position: 0 },
    ]
  ) {
    const resolution = resolve(specifiedQuote);
    if (resolution.resolved) {
      throw new Error(`Expected ${JSON.stringify(specifiedQuote)} to be rejected`);
    }
  }

  const blank = resolve({ text: ' \n', position: 0 });
  const blankFromAnotherChat = resolve({ text: ' ', position: 0 }, true);
  const noReply = resolveReplyQuote(undefined, { text: 'x', position: 0 }, textFixingContext);
  if (
    !blank.resolved || blank.quote !== undefined || !blankFromAnotherChat.resolved ||
    blankFromAnotherChat.quote?.isManual !== false || !noReply.resolved ||
    noReply.quote !== undefined
  ) {
    throw new Error('Expected an empty quote to be ignored, and no quote without a reply');
  }
});
