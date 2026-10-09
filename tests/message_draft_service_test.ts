import { AccountRepository } from '../src/repositories/account.ts';
import { BotRepository } from '../src/repositories/bot.ts';
import { MessageDraftRepository } from '../src/repositories/message_draft.ts';
import { TelegramIdentityRepository } from '../src/repositories/telegram_identity.ts';
import {
  type ExpireMessageDraftResult,
  type GetMessageDraftResult,
  MessageDraftService,
  type StopMessageDraftResult,
} from '../src/services/message_draft.ts';
import { VirtualUserService } from '../src/services/virtual_user.ts';
import type { ChatDomainEvent } from '../src/types/chat_domain_event.ts';
import type { MessageDraft, WrittenMessageDraft } from '../src/types/message_draft.ts';
import type { PrivateConversationKey } from '../src/types/virtual_chat.ts';

Deno.test('MessageDraftService changes a draft by its ID and replaces it with another ID', () => {
  const { messageDrafts, conversation } = createMessageDraftFixture();
  const shown = () => describeDraft(messageDrafts.getPrivateMessageDraft(conversation));

  const beforeWrite = shown();
  messageDrafts.showBotDraft(conversation, plainDraft('7', ''));
  const thinking = shown();
  messageDrafts.showBotDraft(conversation, {
    draftId: '7',
    text: { text: 'Hello', entities: [{ type: 'bold', offset: 0, length: 5 }] },
    canStop: true,
    keepOnStop: false,
  });
  const changed = shown();
  messageDrafts.showBotDraft(conversation, plainDraft('-9223372036854775808', 'Other'));
  const replaced = shown();

  expectEqual(
    [beforeWrite, thinking, changed, replaced],
    [
      null,
      shownDraft('7', ''),
      {
        draftId: '7',
        text: { text: 'Hello', entities: [{ type: 'bold', offset: 0, length: 5 }] },
        canStop: true,
        keepOnStop: false,
        isStopped: false,
      },
      shownDraft('-9223372036854775808', 'Other'),
    ],
    'Expected one draft per chat, changed by its ID and replaced by another',
  );
});

Deno.test('MessageDraftService expires the shown draft only as a test asks', () => {
  const { messageDrafts, conversation } = createMessageDraftFixture();
  const expire = (expectedDraftId?: string) =>
    describeExpiration(messageDrafts.expirePrivateMessageDraft({
      ...conversation,
      ...(expectedDraftId === undefined ? {} : { expectedDraftId }),
    }));
  const shown = () => describeDraft(messageDrafts.getPrivateMessageDraft(conversation));

  const withoutDraft = expire();
  messageDrafts.showBotDraft(conversation, plainDraft('1', 'Partial'));
  const mismatch = expire('2');
  const afterMismatch = shown();
  const matching = expire('1');
  const afterExpiry = shown();
  const repeated = expire();
  messageDrafts.showBotDraft(conversation, plainDraft('1', 'Partial again'));
  const rewritten = shown();
  const unguarded = expire();

  expectEqual(
    [withoutDraft, mismatch, afterMismatch, matching, afterExpiry, repeated, rewritten, unguarded],
    [
      'draft_not_found',
      'draft_id_mismatch',
      shownDraft('1', 'Partial'),
      'expired',
      null,
      'draft_not_found',
      shownDraft('1', 'Partial again'),
      'expired',
    ],
    'Expected expiry to remove only the expected draft, which a later write shows again',
  );
});

Deno.test("MessageDraftService keeps each conversation's draft apart", () => {
  const { messageDrafts, virtualUsers, conversation } = createMessageDraftFixture();
  const otherAccountId = createAccount(virtualUsers, 'Grace');
  const otherBotId = createBot(virtualUsers, 'other_bot');
  const otherAccountChat = { accountId: otherAccountId, botId: conversation.botId };
  const otherBotChat = { accountId: conversation.accountId, botId: otherBotId };
  messageDrafts.showBotDraft(conversation, plainDraft('1', 'For Ada'));
  messageDrafts.showBotDraft(otherBotChat, plainDraft('1', 'From the other bot'));

  const otherAccountExpiry = describeExpiration(
    messageDrafts.expirePrivateMessageDraft(otherAccountChat),
  );
  messageDrafts.clearBotDraft(otherBotChat);

  expectEqual(
    [
      describeDraft(messageDrafts.getPrivateMessageDraft(conversation)),
      describeDraft(messageDrafts.getPrivateMessageDraft(otherAccountChat)),
      describeDraft(messageDrafts.getPrivateMessageDraft(otherBotChat)),
      otherAccountExpiry,
    ],
    [shownDraft('1', 'For Ada'), null, null, 'draft_not_found'],
    "Expected other chats' drafts, expiries and clearing to leave Ada's draft alone",
  );
});

Deno.test('MessageDraftService tells the bot once when the account stops a draft', () => {
  const { messageDrafts, conversation, publishedEvents } = createMessageDraftFixture();
  const stop = (expectedDraftId?: string) =>
    describeStop(messageDrafts.stopPrivateMessageDraft({
      ...conversation,
      ...(expectedDraftId === undefined ? {} : { expectedDraftId }),
    }));
  const shown = () => describeDraft(messageDrafts.getPrivateMessageDraft(conversation));

  const withoutDraft = stop();
  messageDrafts.showBotDraft(conversation, plainDraft('1', 'No button'));
  const notStoppable = stop();
  messageDrafts.showBotDraft(conversation, plainDraft('2', 'Partial', { canStop: true }));
  const mismatch = stop('1');
  const stopped = stop('2');
  const afterStop = shown();
  const repeated = stop('2');

  expectEqual(
    [withoutDraft, notStoppable, mismatch, stopped, afterStop, repeated],
    [
      'draft_not_found',
      'draft_not_stoppable',
      'draft_id_mismatch',
      'stopped',
      null,
      'draft_not_found',
    ],
    'Expected only a shown draft with a Stop button to stop, which removes it',
  );
  expectEqual(
    publishedEvents,
    [{
      type: 'message_generation_stopped',
      accountId: conversation.accountId,
      botId: conversation.botId,
      draftId: '2',
    }],
    'Expected one stop event for the stopped draft',
  );
});

Deno.test('MessageDraftService keeps a stopped draft without its Stop button until it ends', () => {
  const { messageDrafts, conversation, publishedEvents } = createMessageDraftFixture();
  const stop = () => describeStop(messageDrafts.stopPrivateMessageDraft(conversation));
  const shown = () => describeDraft(messageDrafts.getPrivateMessageDraft(conversation));
  const keptDraft = (draftId: string, text: string) =>
    plainDraft(draftId, text, { canStop: true, keepOnStop: true });

  messageDrafts.showBotDraft(conversation, keptDraft('1', 'Partial'));
  const firstStop = stop();
  const afterFirstStop = shown();
  const repeated = stop();
  const expiry = describeExpiration(messageDrafts.expirePrivateMessageDraft(conversation));
  const afterExpiry = shown();
  messageDrafts.showBotDraft(conversation, keptDraft('1', 'Late output'));
  const lateWrite = shown();
  const secondStop = stop();
  messageDrafts.clearBotDraft(conversation);

  expectEqual(
    [firstStop, afterFirstStop, repeated, expiry, afterExpiry, lateWrite, secondStop, shown()],
    [
      'stopped',
      shownDraft('1', 'Partial', { canStop: true, keepOnStop: true, isStopped: true }),
      'draft_already_stopped',
      'expired',
      null,
      shownDraft('1', 'Late output', { canStop: true, keepOnStop: true }),
      'stopped',
      null,
    ],
    'Expected a kept draft to stay stopped until it expires, and a late write to be stoppable',
  );
  expectEqual(
    publishedEvents.map((event) => event.type === 'message_generation_stopped' && event.draftId),
    ['1', '1'],
    'Expected each successful stop, and only those, to tell the bot',
  );
});

Deno.test('MessageDraftService reports unknown accounts and bots', () => {
  const { messageDrafts, conversation } = createMessageDraftFixture();
  const unknownAccount = { accountId: 999, botId: conversation.botId };
  const unknownBot = { accountId: conversation.accountId, botId: 999 };

  expectEqual(
    [
      describeDraft(messageDrafts.getPrivateMessageDraft(unknownAccount)),
      describeDraft(messageDrafts.getPrivateMessageDraft(unknownBot)),
      describeExpiration(messageDrafts.expirePrivateMessageDraft(unknownAccount)),
      describeExpiration(messageDrafts.expirePrivateMessageDraft(unknownBot)),
      describeStop(messageDrafts.stopPrivateMessageDraft(unknownAccount)),
      describeStop(messageDrafts.stopPrivateMessageDraft(unknownBot)),
    ],
    [
      'account_not_found',
      'bot_not_found',
      'account_not_found',
      'bot_not_found',
      'account_not_found',
      'bot_not_found',
    ],
    'Expected unknown participants to be reported',
  );
});

function plainDraft(
  draftId: string,
  text: string,
  stopping: Partial<Pick<WrittenMessageDraft, 'canStop' | 'keepOnStop'>> = {},
): WrittenMessageDraft {
  return {
    draftId,
    text: { text, entities: [] },
    canStop: stopping.canStop ?? false,
    keepOnStop: stopping.keepOnStop ?? false,
  };
}

/** A draft as the conversation shows it before anyone pressed Stop. */
function shownDraft(
  draftId: string,
  text: string,
  stopping: Partial<Pick<MessageDraft, 'canStop' | 'keepOnStop' | 'isStopped'>> = {},
): MessageDraft {
  return { ...plainDraft(draftId, text, stopping), isStopped: stopping.isStopped ?? false };
}

function describeDraft(result: GetMessageDraftResult): MessageDraft | string | null {
  if (!result.found) {
    return result.reason;
  }
  return result.draft ?? null;
}

function describeExpiration(result: ExpireMessageDraftResult): string {
  return result.expired ? 'expired' : result.reason;
}

function describeStop(result: StopMessageDraftResult): string {
  return result.stopped ? 'stopped' : result.reason;
}

function createMessageDraftFixture() {
  const identities = new TelegramIdentityRepository();
  const accounts = new AccountRepository();
  const bots = new BotRepository();
  const virtualUsers = new VirtualUserService({ identities, accounts, bots });
  const publishedEvents: ChatDomainEvent[] = [];
  const messageDrafts = new MessageDraftService({
    accounts,
    bots,
    drafts: new MessageDraftRepository(),
    events: { publish: (event) => publishedEvents.push(event) },
  });
  const conversation: PrivateConversationKey = {
    accountId: createAccount(virtualUsers, 'Ada'),
    botId: createBot(virtualUsers, 'test_bot'),
  };
  return { messageDrafts, virtualUsers, conversation, publishedEvents };
}

function createAccount(virtualUsers: VirtualUserService, firstName: string): number {
  const result = virtualUsers.createAccount({ first_name: firstName });
  if (!result.created) {
    throw new Error(`Expected account creation to succeed, received ${result.reason}`);
  }
  return result.account.profile.id;
}

function createBot(virtualUsers: VirtualUserService, username: string): number {
  const result = virtualUsers.createBot({ first_name: 'Bot', username });
  if (!result.created) {
    throw new Error(`Expected bot creation to succeed, received ${result.reason}`);
  }
  return result.bot.profile.id;
}

function expectEqual(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}
