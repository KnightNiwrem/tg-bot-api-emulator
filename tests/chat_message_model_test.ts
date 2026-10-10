// Checks at compile time that the message model admits only the chat, sender and content
// combinations a chat type permits, and that the message repository returns each chat type's own
// messages. `deno task check` fails when a rejected combination starts to type-check.

import { MessageRepository } from '../src/repositories/message.ts';
import type { ChatActor, PrivateChatKey, SupergroupChatKey } from '../src/types/virtual_chat.ts';
import type {
  NewPrivateMessage,
  NewSupergroupMessage,
  PrivateMessage,
  SupergroupMessage,
  SupergroupMessageSender,
} from '../src/types/virtual_message.ts';

const PRIVATE_CHAT: PrivateChatKey = { type: 'private', conversation: { accountId: 1, botId: 2 } };
const SUPERGROUP: SupergroupChatKey = { type: 'supergroup', chatId: -1_000_000_000_001 };
const SENT_AT_UNIX_SECONDS = 1_700_000_000;
const TEXT = { kind: 'text', text: 'Hello', entities: [] } as const;

/** Accepts a private message to store, so a call type-checks only for a valid one. */
function acceptPrivateMessage(_message: NewPrivateMessage): void {}

/** Accepts a supergroup message to store, so a call type-checks only for a valid one. */
function acceptSupergroupMessage(_message: NewSupergroupMessage): void {}

Deno.test('message variants admit each chat type its own senders, contents and fields', () => {
  acceptPrivateMessage({
    chat: PRIVATE_CHAT,
    sender: 'bot',
    sentAtUnixSeconds: SENT_AT_UNIX_SECONDS,
    content: TEXT,
    messageEffectId: '5104841245755180586',
  });
  acceptPrivateMessage({
    chat: PRIVATE_CHAT,
    sender: 'account',
    sentAtUnixSeconds: SENT_AT_UNIX_SECONDS,
    content: { kind: 'web_app_data', buttonText: 'Open', data: '{}' },
  });
  acceptSupergroupMessage({
    chat: SUPERGROUP,
    sender: { kind: 'bot', botId: 2 },
    sentAtUnixSeconds: SENT_AT_UNIX_SECONDS,
    content: { kind: 'title_changed', title: 'Team' },
  });
});

Deno.test('message variants reject combinations that no chat type permits', () => {
  acceptPrivateMessage({
    // @ts-expect-error A private message belongs to a private chat.
    chat: SUPERGROUP,
    sender: 'bot',
    sentAtUnixSeconds: SENT_AT_UNIX_SECONDS,
    content: TEXT,
  });
  acceptPrivateMessage({
    chat: PRIVATE_CHAT,
    // @ts-expect-error A private message names its sender by its role in the conversation.
    sender: { kind: 'bot', botId: 2 },
    sentAtUnixSeconds: SENT_AT_UNIX_SECONDS,
    content: TEXT,
  });
  acceptPrivateMessage({
    chat: PRIVATE_CHAT,
    sender: 'account',
    sentAtUnixSeconds: SENT_AT_UNIX_SECONDS,
    // @ts-expect-error Only supergroups record title changes.
    content: { kind: 'title_changed', title: 'Team' },
  });
  acceptSupergroupMessage({
    chat: SUPERGROUP,
    // @ts-expect-error A supergroup message names its sender as a member, not by a private role.
    sender: 'bot',
    sentAtUnixSeconds: SENT_AT_UNIX_SECONDS,
    content: TEXT,
  });
  acceptSupergroupMessage({
    chat: SUPERGROUP,
    sender: { kind: 'account', accountId: 1 },
    sentAtUnixSeconds: SENT_AT_UNIX_SECONDS,
    // @ts-expect-error Only private chats record data a Web App sent their bot.
    content: { kind: 'web_app_data', buttonText: 'Open', data: '{}' },
  });
  acceptSupergroupMessage({
    chat: SUPERGROUP,
    sender: { kind: 'bot', botId: 2 },
    sentAtUnixSeconds: SENT_AT_UNIX_SECONDS,
    content: TEXT,
    // @ts-expect-error Telegram allows message effects only in private chats.
    messageEffectId: '5104841245755180586',
  });
});

/** Fields that only one chat type's messages have, which the other's type lacks. */
interface ChatTypeSpecificFields {
  // @ts-expect-error Only supergroup messages take reactions.
  readonly privateReactions: PrivateMessage['reactions'];
  // @ts-expect-error Only private messages carry a message effect.
  readonly supergroupEffect: SupergroupMessage['messageEffectId'];
}

/**
 * A sender that a chat type may add, such as a chat posting as itself, which is attribution and
 * not an authenticated actor.
 */
type ChatSenderCandidate = SupergroupMessageSender | {
  readonly kind: 'chat';
  readonly chatId: number;
};

/** A chat posting as itself, as a supergroup's anonymous administrators and channels do. */
function postAsChat(chatId: number): ChatSenderCandidate {
  return { kind: 'chat', chatId };
}

Deno.test('an authenticated actor may be shown as a sender, but a chat sender is no actor', () => {
  const actor: ChatActor = { kind: 'bot', botId: 2 };
  const sender: SupergroupMessageSender = actor;
  // @ts-expect-error A chat that posts as itself is no principal whose access an operation checks.
  const _chatActor: ChatActor = postAsChat(SUPERGROUP.chatId);
  const _specificFields: Partial<ChatTypeSpecificFields> = {};
  if (sender !== actor) {
    throw new Error('Expected the actor to be shown as the sender it was assigned to');
  }
});

Deno.test("the message repository returns each chat type's own messages", () => {
  const messages = new MessageRepository();
  const privateMessage: PrivateMessage = messages.addMessage({
    chat: PRIVATE_CHAT,
    sender: 'bot',
    sentAtUnixSeconds: SENT_AT_UNIX_SECONDS,
    content: TEXT,
  });
  const supergroupMessage: SupergroupMessage = messages.addMessage({
    chat: SUPERGROUP,
    sender: { kind: 'bot', botId: 2 },
    sentAtUnixSeconds: SENT_AT_UNIX_SECONDS,
    content: TEXT,
  });
  const foundPrivateMessage: PrivateMessage | undefined = messages.findChatMessage(
    PRIVATE_CHAT,
    privateMessage.id,
  );
  const supergroupHistory: readonly SupergroupMessage[] = messages.getChatMessages(SUPERGROUP);
  // @ts-expect-error A private chat's lookup finds no supergroup message.
  const misfoundMessage: SupergroupMessage | undefined = messages.findChatMessage(
    PRIVATE_CHAT,
    supergroupMessage.id,
  );
  messages.addMessage({
    chat: SUPERGROUP,
    // @ts-expect-error The repository stores a message only with its chat type's sender.
    sender: 'bot',
    sentAtUnixSeconds: SENT_AT_UNIX_SECONDS,
    content: TEXT,
  });

  if (
    foundPrivateMessage !== privateMessage || supergroupHistory[0] !== supergroupMessage ||
    misfoundMessage !== undefined
  ) {
    throw new Error("Expected each chat's lookup to find only its own messages");
  }
});
