import { AccountRepository } from '../src/repositories/account.ts';
import { BotRepository } from '../src/repositories/bot.ts';
import { MessageDraftRepository } from '../src/repositories/message_draft.ts';
import { TelegramIdentityRepository } from '../src/repositories/telegram_identity.ts';
import {
  type ExpireMessageDraftResult,
  type GetMessageDraftResult,
  MessageDraftService,
} from '../src/services/message_draft.ts';
import { VirtualUserService } from '../src/services/virtual_user.ts';
import type { MessageDraft } from '../src/types/message_draft.ts';
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
  });
  const changed = shown();
  messageDrafts.showBotDraft(conversation, plainDraft('-9223372036854775808', 'Other'));
  const replaced = shown();

  expectEqual(
    [beforeWrite, thinking, changed, replaced],
    [
      null,
      { draftId: '7', text: { text: '', entities: [] } },
      { draftId: '7', text: { text: 'Hello', entities: [{ type: 'bold', offset: 0, length: 5 }] } },
      { draftId: '-9223372036854775808', text: { text: 'Other', entities: [] } },
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
      { draftId: '1', text: { text: 'Partial', entities: [] } },
      'expired',
      null,
      'draft_not_found',
      { draftId: '1', text: { text: 'Partial again', entities: [] } },
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
    [{ draftId: '1', text: { text: 'For Ada', entities: [] } }, null, null, 'draft_not_found'],
    "Expected other chats' drafts, expiries and clearing to leave Ada's draft alone",
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
    ],
    ['account_not_found', 'bot_not_found', 'account_not_found', 'bot_not_found'],
    'Expected unknown participants to be reported',
  );
});

function plainDraft(draftId: string, text: string): MessageDraft {
  return { draftId, text: { text, entities: [] } };
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

function createMessageDraftFixture() {
  const identities = new TelegramIdentityRepository();
  const accounts = new AccountRepository();
  const bots = new BotRepository();
  const virtualUsers = new VirtualUserService({ identities, accounts, bots });
  const messageDrafts = new MessageDraftService({
    accounts,
    bots,
    drafts: new MessageDraftRepository(),
  });
  const conversation: PrivateConversationKey = {
    accountId: createAccount(virtualUsers, 'Ada'),
    botId: createBot(virtualUsers, 'test_bot'),
  };
  return { messageDrafts, virtualUsers, conversation };
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
