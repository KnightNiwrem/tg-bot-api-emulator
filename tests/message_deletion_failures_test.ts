/**
 * Compile-time checks that each entry point of the shared deletion service reports exactly the
 * failures its sender and chat type can produce: a private chat refuses no message it finds, and
 * only a supergroup turns away former members. The expected sets are written out here,
 * independently of the service's types.
 */
import type { MessageDeletionService } from '../src/services/domain/message_deletion.ts';
import type { ExpectTrue, IsExactly } from './support/type_conformance.ts';

type DeletionFailureReason<Method extends keyof MessageDeletionService> =
  ReturnType<MessageDeletionService[Method]> extends infer Result
    ? Result extends { readonly deleted: false; readonly reason: infer Reason } ? Reason : never
    : never;

type _BotDeletions = [
  ExpectTrue<
    IsExactly<
      DeletionFailureReason<'deletePrivateChatMessages'>,
      'bot_not_found' | 'account_not_found' | 'conversation_not_started'
    >
  >,
  ExpectTrue<
    IsExactly<
      DeletionFailureReason<'deleteSupergroupMessages'>,
      | 'bot_not_found'
      | 'chat_not_found'
      | 'bot_not_a_member'
      | 'bot_kicked'
      | 'message_not_deletable'
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
