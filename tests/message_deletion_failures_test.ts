/**
 * Compile-time checks that the shared deletion service reports exactly the failures each sender
 * and chat type can produce: a private chat refuses no message it finds, and only a supergroup
 * turns away former members. Each chat type's bot results pin its own set; a bot's entry point,
 * whose address selects the chat type, reports the two chat types' sets together. The expected
 * sets are written out here, independently of the service's types.
 */
import type {
  BotDeletionResult,
  BotPrivateChatDeletionTypes,
  BotSupergroupDeletionTypes,
  MessageDeletionService,
} from '../src/services/domain/message_deletion.ts';
import type { ExpectTrue, IsExactly } from './support/type_conformance.ts';

type FailureReason<Result> = Result extends
  { readonly deleted: false; readonly reason: infer Reason } ? Reason : never;

type DeletionFailureReason<Method extends keyof MessageDeletionService> = FailureReason<
  ReturnType<MessageDeletionService[Method]>
>;

type BotPrivateChatDeletionReason =
  | 'bot_not_found'
  | 'account_not_found'
  | 'conversation_not_started';
type BotSupergroupDeletionReason =
  | 'bot_not_found'
  | 'chat_not_found'
  | 'bot_not_a_member'
  | 'bot_kicked'
  | 'message_not_deletable';

type _BotDeletions = [
  ExpectTrue<
    IsExactly<
      FailureReason<BotDeletionResult<BotPrivateChatDeletionTypes>>,
      BotPrivateChatDeletionReason
    >
  >,
  ExpectTrue<
    IsExactly<
      FailureReason<BotDeletionResult<BotSupergroupDeletionTypes>>,
      BotSupergroupDeletionReason
    >
  >,
  ExpectTrue<
    IsExactly<
      DeletionFailureReason<'deleteChatMessages'>,
      BotPrivateChatDeletionReason | BotSupergroupDeletionReason
    >
  >,
];

type _AccountDeletions = [
  ExpectTrue<
    IsExactly<
      DeletionFailureReason<'deleteAccountPrivateChatMessage'>,
      'account_not_found' | 'bot_not_found' | 'message_not_found'
    >
  >,
  ExpectTrue<
    IsExactly<
      DeletionFailureReason<'deleteAccountSupergroupMessage'>,
      | 'account_not_found'
      | 'chat_not_found'
      | 'not_a_member'
      | 'message_not_found'
      | 'message_not_deletable'
    >
  >,
];

Deno.test('each deletion entry point reports only the failures its sender and chat type produce', () => {
  // The checks above run when this file is type-checked.
});
