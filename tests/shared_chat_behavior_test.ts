/**
 * The shared-behavior matrix: what private chats and supergroups do alike when their members send
 * and edit messages, run once per chat type through one session of the production composition
 * root.
 *
 * Each row of `SHARED_BEHAVIORS` is one behavior, and names the chat types it applies to; every
 * row runs for each of them. The HTTP scenarios in `tests/http/message_*_test.ts` and
 * `reply_interfaces_test.ts` run the shared failure order, numbering and reply interfaces of
 * sending, editing, deletion, pinning and pressing per chat type too, through
 * `tests/support/chat_type_scenarios.ts`. What differs between the chat types, such as
 * permissions, message numbering and which messages a bot sees, stays in their own tests.
 */
import { assertEquals } from '@std/assert';
import type { MediaContent } from '../src/services/domain/message_content.ts';
import type { InlineKeyboard } from '../src/types/inline_keyboard.ts';
import type { PhotoUpload } from '../src/types/stored_file.ts';
import type { ChatAddress } from '../src/types/virtual_chat.ts';
import {
  type ChatMessage,
  getContentText,
  MAX_CAPTION_LENGTH,
  MAX_TEXT_MESSAGE_LENGTH,
  type TextEntity,
} from '../src/types/virtual_message.ts';
import { CHAT_TYPES, type ChatType } from './support/chat_type_scenarios.ts';
import { TEST_UNIX_TIME_SECONDS } from './support/fixed_wall_clock.ts';
import { buildSessionServices, type SessionServices } from './support/session_services.ts';
import { createVirtualAccount, createVirtualBot } from './support/virtual_users.ts';

/** A send's outcome, whichever chat type it was sent to. */
type SendOutcome =
  | { readonly sent: true; readonly message: ChatMessage }
  | { readonly sent: false; readonly reason: string };

/** An album's outcome, whichever chat type it was sent to. */
type AlbumOutcome =
  | { readonly sent: true; readonly messages: readonly ChatMessage[] }
  | { readonly sent: false; readonly reason: string };

/** An edit's outcome, whichever chat type it was made in. */
type EditOutcome =
  | { readonly edited: true; readonly message: ChatMessage }
  | { readonly edited: false; readonly reason: string };

/** What a bot's message carries besides its chat and sender. */
interface BotMessageInput {
  readonly content: { readonly kind: 'text'; readonly text: string };
  readonly inlineKeyboard?: InlineKeyboard;
  readonly replyTo?: { readonly messageId: number; readonly allowSendingWithoutReply: boolean };
}

/** What a bot's text edit replaces. */
interface BotTextEditInput {
  readonly content: {
    readonly kind: 'text';
    readonly text: string;
    readonly entities?: readonly TextEntity[];
  };
  readonly inlineKeyboard?: InlineKeyboard;
}

/**
 * Ada and a bot in one chat of the given type, with the shared services' entry points for that
 * type: in a private chat Ada started, or in a supergroup Ada owns, of which the bot is a member.
 * Disposing of it ends the session.
 */
interface SharedChatSubject extends Disposable {
  readonly chatType: ChatType;
  readonly session: SessionServices;
  readonly adaId: number;
  readonly botId: number;
  /** Moves the session's calendar time on. */
  advanceClockSeconds(seconds: number): void;
  sendBotMessage(input: BotMessageInput): SendOutcome;
  sendBotAlbum(contents: readonly MediaContent[]): AlbumOutcome;
  sendAccountText(text: string): SendOutcome;
  editBotText(messageId: number, input: BotTextEditInput): EditOutcome;
  editBotKeyboard(messageId: number, inlineKeyboard: InlineKeyboard): EditOutcome;
  editAccountText(messageId: number, text: string): EditOutcome;
  /** The ID by which the chat's members address the message. */
  messageIdOf(message: ChatMessage): number;
  /** The IDs, in the chat, of the messages Ada sees there, oldest first. */
  historyMessageIds(): readonly number[];
}

function createSharedChatSubject(chatType: ChatType): SharedChatSubject {
  let currentUnixTimeSeconds = TEST_UNIX_TIME_SECONDS;
  const session = buildSessionServices({
    id: `shared-${chatType}-chat`,
    wallClock: { currentUnixTimeSeconds: () => currentUnixTimeSeconds },
  });
  const { messageSending, messageEditing, botMessageViews } = session;
  const adaId = createVirtualAccount(session.virtualUsers, { first_name: 'Ada' }).profile.id;
  const botId = createVirtualBot(session.virtualUsers, {
    first_name: 'Test Bot',
    username: 'test_bot',
  }).profile.id;
  const common = {
    chatType,
    session,
    adaId,
    botId,
    advanceClockSeconds: (seconds: number) => {
      currentUnixTimeSeconds += seconds;
    },
    [Symbol.dispose]: () => session[Symbol.dispose](),
  };

  if (chatType === 'private') {
    const botChat = { type: 'private', peerId: adaId } as const satisfies ChatAddress;
    const accountChat = { type: 'private', peerId: botId } as const satisfies ChatAddress;
    expectSent(messageSending.sendAccountPrivateChatMessage({
      fromAccountId: adaId,
      chat: accountChat,
      content: { kind: 'text', text: '/start' },
    }));
    return {
      ...common,
      sendBotMessage: (input) =>
        messageSending.sendChatMessage({ fromBotId: botId, chat: botChat, ...input }),
      sendBotAlbum: (contents) =>
        messageSending.sendChatAlbum({ fromBotId: botId, chat: botChat, contents }),
      sendAccountText: (text) =>
        messageSending.sendAccountPrivateChatMessage({
          fromAccountId: adaId,
          chat: accountChat,
          content: { kind: 'text', text },
        }),
      editBotText: (messageId, input) =>
        messageEditing.editChatMessageText({
          fromBotId: botId,
          chat: botChat,
          messageId,
          ...input,
        }),
      editBotKeyboard: (messageId, inlineKeyboard) =>
        messageEditing.editChatMessageKeyboard({
          fromBotId: botId,
          chat: botChat,
          messageId,
          inlineKeyboard,
        }),
      editAccountText: (messageId, text) =>
        messageEditing.editAccountPrivateChatMessage({
          fromAccountId: adaId,
          chat: accountChat,
          messageId,
          edit: { kind: 'text', text },
        }),
      messageIdOf: (message) =>
        message.kind === 'private_message'
          ? botMessageViews.viewPrivateMessageForBot(message).message_id
          : unexpectedMessage(message),
      historyMessageIds: () => {
        const history = session.privateMessaging.getPrivateMessageHistory({
          accountId: adaId,
          botId,
        });
        if (!history.found) {
          throw new Error(`Expected Ada's private chat to be found: ${history.reason}`);
        }
        return history.messages.map((message) =>
          botMessageViews.viewPrivateMessageForBot(message).message_id
        );
      },
    };
  }

  const creation = session.sharedChatAdministration.createSupergroup({
    title: 'Team',
    creatorAccountId: adaId,
  });
  if (!creation.created) {
    throw new Error(`Expected the supergroup to be created: ${creation.reason}`);
  }
  const chatId = creation.supergroup.id;
  const addition = session.sharedChatAdministration.addChatMember({
    actorAccountId: adaId,
    chatId,
    memberId: botId,
  });
  if (!addition.added) {
    throw new Error(`Expected the bot to join the supergroup: ${addition.reason}`);
  }
  const chat = { type: 'supergroup', chatId } as const satisfies ChatAddress;
  return {
    ...common,
    sendBotMessage: (input) => messageSending.sendChatMessage({ fromBotId: botId, chat, ...input }),
    sendBotAlbum: (contents) => messageSending.sendChatAlbum({ fromBotId: botId, chat, contents }),
    sendAccountText: (text) =>
      messageSending.sendAccountSupergroupMessage({
        fromAccountId: adaId,
        chat,
        content: { kind: 'text', text },
      }),
    editBotText: (messageId, input) =>
      messageEditing.editChatMessageText({ fromBotId: botId, chat, messageId, ...input }),
    editBotKeyboard: (messageId, inlineKeyboard) =>
      messageEditing.editChatMessageKeyboard({
        fromBotId: botId,
        chat,
        messageId,
        inlineKeyboard,
      }),
    editAccountText: (messageId, text) =>
      messageEditing.editAccountSupergroupMessage({
        fromAccountId: adaId,
        chat,
        messageId,
        edit: { kind: 'text', text },
      }),
    messageIdOf: (message) =>
      message.kind === 'supergroup_message'
        ? botMessageViews.viewSupergroupMessage(message, adaId).message_id
        : unexpectedMessage(message),
    historyMessageIds: () => {
      const history = session.supergroupMessaging.getMessageHistory({ accountId: adaId, chatId });
      if (!history.found) {
        throw new Error(`Expected the supergroup to be found: ${history.reason}`);
      }
      return history.messages.map((message) =>
        botMessageViews.viewSupergroupMessage(message, adaId).message_id
      );
    },
  };
}

/** A behavior both chat types share, and the chat types it applies to. */
interface SharedBehavior {
  readonly behavior: string;
  readonly chatTypes: readonly ChatType[];
  readonly check: (subject: SharedChatSubject) => void;
}

const YES_NO_KEYBOARD: InlineKeyboard = [[
  { kind: 'callback', text: 'Yes', callbackData: 'yes' },
  { kind: 'callback', text: 'No', callbackData: 'no' },
]];

const SHARED_BEHAVIORS: readonly SharedBehavior[] = [
  {
    behavior: "a bot's text is trimmed, has its bot commands marked, and is dated by the session",
    chatTypes: CHAT_TYPES,
    check: (subject) => {
      const message = expectSent(subject.sendBotMessage({
        content: { kind: 'text', text: '  Use /help  ' },
      }));
      assertEquals(
        [textOf(message), message.sentAtUnixSeconds],
        [
          { text: 'Use /help', entities: [{ type: 'bot_command', offset: 4, length: 5 }] },
          TEST_UNIX_TIME_SECONDS,
        ],
        'Expected the text normalized as Telegram does, dated now',
      );
    },
  },
  {
    behavior: "a bot's text is limited by its characters, and a refused text is not stored",
    chatTypes: CHAT_TYPES,
    check: (subject) => {
      const send = (text: string) => subject.sendBotMessage({ content: { kind: 'text', text } });
      const fitting = send('😀'.repeat(MAX_TEXT_MESSAGE_LENGTH));
      const historyBeforeRefusals = subject.historyMessageIds();
      assertEquals(
        [
          fitting.sent,
          describeSend(send('😀'.repeat(MAX_TEXT_MESSAGE_LENGTH + 1))),
          describeSend(send(`${'a'.repeat(MAX_TEXT_MESSAGE_LENGTH)}😀`)),
          subject.historyMessageIds(),
        ],
        [true, 'message_text_too_long', 'message_text_too_long', historyBeforeRefusals],
        'Expected the limit to count characters, not UTF-16 code units, and refusals to store none',
      );
    },
  },
  {
    behavior: "an account's text is trimmed and has its command marked, and blank text is refused",
    chatTypes: CHAT_TYPES,
    check: (subject) => {
      const message = expectSent(subject.sendAccountText('  /start\r\n'));
      const blank = subject.sendAccountText(' \n ');
      assertEquals(
        [
          textOf(message),
          blank.sent || [blank.reason, 'textError' in blank ? blank.textError : undefined],
        ],
        [
          { text: '/start', entities: [{ type: 'bot_command', offset: 0, length: 6 }] },
          ['text_invalid', 'Text must be non-empty'],
        ],
        'Expected the text normalized as a Telegram client does',
      );
    },
  },
  {
    behavior: "a bot's inline keyboard holds callback data of up to 64 bytes",
    chatTypes: CHAT_TYPES,
    check: (subject) => {
      const send = (callbackData: string) =>
        subject.sendBotMessage({
          content: { kind: 'text', text: 'Continue?' },
          inlineKeyboard: [[{ kind: 'callback', text: 'Go', callbackData }]],
        });
      const fitting = expectSent(send('é'.repeat(32)));
      assertEquals(
        [fitting.inlineKeyboard, describeSend(send('é'.repeat(33)))],
        [
          [[{ kind: 'callback', text: 'Go', callbackData: 'é'.repeat(32) }]],
          'callback_data_invalid',
        ],
        'Expected 64 bytes of callback data kept, and 66 refused',
      );
    },
  },
  {
    behavior: "a bot's text edit is dated, recomputes the entities, and drops the keyboard",
    chatTypes: CHAT_TYPES,
    check: (subject) => {
      const message = expectSent(subject.sendBotMessage({
        content: { kind: 'text', text: 'Continue?' },
        inlineKeyboard: YES_NO_KEYBOARD,
      }));
      subject.advanceClockSeconds(5);
      const edit = expectEdited(subject.editBotText(subject.messageIdOf(message), {
        content: { kind: 'text', text: 'Chosen: /yes' },
      }));
      assertEquals(
        [
          edit.id,
          edit.sentAtUnixSeconds,
          edit.contentEditedAtUnixSeconds,
          textOf(edit),
          edit.inlineKeyboard,
        ],
        [
          message.id,
          TEST_UNIX_TIME_SECONDS,
          TEST_UNIX_TIME_SECONDS + 5,
          { text: 'Chosen: /yes', entities: [{ type: 'bot_command', offset: 8, length: 4 }] },
          undefined,
        ],
        'Expected the same message, dated by its edit, with new entities and no keyboard',
      );
    },
  },
  {
    behavior:
      'changed formatting alone edits a text, and formatting that normalizes the same does not',
    chatTypes: CHAT_TYPES,
    check: (subject) => {
      const message = expectSent(subject.sendBotMessage({
        content: { kind: 'text', text: 'Continue?' },
      }));
      const messageId = subject.messageIdOf(message);
      subject.advanceClockSeconds(5);
      const edit = (entities: readonly TextEntity[]) =>
        subject.editBotText(messageId, { content: { kind: 'text', text: 'Continue?', entities } });
      const boldEdit = expectEdited(edit([{ type: 'bold', offset: 0, length: 9 }]));
      assertEquals(
        [
          boldEdit.contentEditedAtUnixSeconds,
          getContentText(boldEdit.content).entities,
          describeEdit(edit([
            { type: 'bold', offset: 0, length: 4 },
            { type: 'bold', offset: 4, length: 5 },
          ])),
        ],
        [
          TEST_UNIX_TIME_SECONDS + 5,
          [{ type: 'bold', offset: 0, length: 9 }],
          'message_not_modified',
        ],
        'Expected new formatting to be an edit, and adjacent spans of it to be none',
      );
    },
  },
  {
    behavior: "a bot's keyboard edit keeps the text and the date of its last content edit",
    chatTypes: CHAT_TYPES,
    check: (subject) => {
      const message = expectSent(subject.sendBotMessage({
        content: { kind: 'text', text: 'Continue?' },
      }));
      const messageId = subject.messageIdOf(message);
      subject.advanceClockSeconds(5);
      expectEdited(subject.editBotText(messageId, { content: { kind: 'text', text: 'Choose' } }));
      subject.advanceClockSeconds(5);
      const edit = expectEdited(subject.editBotKeyboard(messageId, YES_NO_KEYBOARD));
      // The status quo pending #241 (does Telegram date a keyboard-only edit?), which may change it.
      assertEquals(
        [getContentText(edit.content).text, edit.contentEditedAtUnixSeconds, edit.inlineKeyboard],
        ['Choose', TEST_UNIX_TIME_SECONDS + 5, YES_NO_KEYBOARD],
        'Expected only the keyboard to change, keeping the date of the text edit',
      );
    },
  },
  {
    behavior:
      'a bot replies to a message of the chat, and a reply to a missing one is refused or sent without it',
    chatTypes: CHAT_TYPES,
    check: (subject) => {
      const question = expectSent(subject.sendAccountText('Where is my order?'));
      const questionId = subject.messageIdOf(question);
      const reply = (messageId: number, allowSendingWithoutReply: boolean) =>
        subject.sendBotMessage({
          content: { kind: 'text', text: 'On its way' },
          replyTo: { messageId, allowSendingWithoutReply },
        });
      const answer = expectSent(reply(questionId, false));
      const historyBeforeRefusal = subject.historyMessageIds();
      const refused = reply(9_999, false);
      const historyAfterRefusal = subject.historyMessageIds();
      const withoutReply = expectSent(reply(9_999, true));
      assertEquals(
        [
          answer.replyToMessageId,
          describeSend(refused),
          historyAfterRefusal,
          withoutReply.replyToMessageId,
        ],
        [question.id, 'reply_message_not_found', historyBeforeRefusal, undefined],
        'Expected a reply within the chat, and a missing message refused or left out',
      );
    },
  },
  {
    behavior: "a bot's album is numbered in order and shares one album, or is refused whole",
    chatTypes: CHAT_TYPES,
    check: (subject) => {
      const album = subject.sendBotAlbum([photo('First'), photo('Second')]);
      if (!album.sent) {
        throw new Error(`Expected the album to be sent: ${album.reason}`);
      }
      const [first, second] = album.messages;
      const historyBeforeRefusal = subject.historyMessageIds();
      const refused = subject.sendBotAlbum([
        photo('Fits'),
        photo('a'.repeat(MAX_CAPTION_LENGTH + 1)),
      ]);
      assertEquals(
        [
          album.messages.map((message) => getContentText(message.content).text),
          subject.messageIdOf(second) - subject.messageIdOf(first),
          first.mediaGroupId !== undefined && first.mediaGroupId === second.mediaGroupId,
          refused.sent || refused.reason,
          subject.historyMessageIds(),
        ],
        [['First', 'Second'], 1, true, 'caption_too_long', historyBeforeRefusal],
        'Expected consecutive messages of one album, and a refused album to store none of it',
      );
    },
  },
  {
    behavior: "an account edits its own text, normalized again, but not the bot's message",
    chatTypes: CHAT_TYPES,
    check: (subject) => {
      const own = expectSent(subject.sendAccountText('Hello'));
      const botMessage = expectSent(
        subject.sendBotMessage({ content: { kind: 'text', text: 'Hi' } }),
      );
      subject.advanceClockSeconds(5);
      const edit = expectEdited(
        subject.editAccountText(subject.messageIdOf(own), '  Hello /help  '),
      );
      assertEquals(
        [
          edit.contentEditedAtUnixSeconds,
          textOf(edit),
          describeEdit(subject.editAccountText(subject.messageIdOf(own), ' Hello /help ')),
          describeEdit(subject.editAccountText(subject.messageIdOf(botMessage), 'Edited')),
        ],
        [
          TEST_UNIX_TIME_SECONDS + 5,
          { text: 'Hello /help', entities: [{ type: 'bot_command', offset: 6, length: 5 }] },
          'message_not_modified',
          'message_not_editable',
        ],
        "Expected the account's text edited as when sending, and the bot's message refused",
      );
    },
  },
];

for (const { behavior, chatTypes, check } of SHARED_BEHAVIORS) {
  for (const chatType of chatTypes) {
    Deno.test(`in a ${chatType} chat, ${behavior}`, () => {
      using subject = createSharedChatSubject(chatType);
      check(subject);
    });
  }
}

function expectSent(outcome: SendOutcome): ChatMessage {
  if (!outcome.sent) {
    throw new Error(`Expected the message to be sent: ${outcome.reason}`);
  }
  return outcome.message;
}

function expectEdited(outcome: EditOutcome): ChatMessage {
  if (!outcome.edited) {
    throw new Error(`Expected the message to be edited: ${outcome.reason}`);
  }
  return outcome.message;
}

/** `sent` for a sent message; the reason for a refused one. */
function describeSend(outcome: SendOutcome): string {
  return outcome.sent ? 'sent' : outcome.reason;
}

/** `edited` for an edited message; the reason for a refused edit. */
function describeEdit(outcome: EditOutcome): string {
  return outcome.edited ? 'edited' : outcome.reason;
}

/** The text of a message, or of its caption, with its entities. */
function textOf(
  message: ChatMessage,
): { readonly text: string; readonly entities: readonly TextEntity[] } {
  const { text, entities } = getContentText(message.content);
  return { text, entities };
}

function unexpectedMessage(message: ChatMessage): never {
  throw new Error(`Expected a message of the subject's chat type, received a ${message.kind}`);
}

/** A photo of an album with the given caption. */
function photo(caption: string): MediaContent {
  return {
    kind: 'photo',
    photo: { kind: 'upload', upload: photoUpload() },
    caption,
    hasSpoiler: false,
    showsCaptionAboveMedia: false,
  };
}

/** A photo upload of a 4 by 3 GIF image, whose header is all the emulator reads. */
function photoUpload(): PhotoUpload {
  const content = new Uint8Array(13);
  content.set(new TextEncoder().encode('GIF89a'));
  content.set([4, 0, 3, 0], 6);
  return { type: 'photo', content, imageFormat: 'gif', width: 4, height: 3 };
}
