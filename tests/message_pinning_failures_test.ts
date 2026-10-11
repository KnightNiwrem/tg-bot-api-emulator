/**
 * Compile-time checks that the shared pinning service reports exactly the failures each pinner and
 * chat type can produce: only a bot is turned away as a former supergroup member or before an
 * account started their private chat, only an account is refused as a non-member, and a private
 * chat asks for no right to pin. The expected sets are written out here, independently of the
 * service's types.
 */
import type {
  AccountPrivateChatPinningTypes,
  AccountSupergroupPinningTypes,
  BotPrivateChatPinningTypes,
  BotSupergroupPinningTypes,
  ChatMessagesUnpinResult,
  MessagePinningService,
  MessagePinResult,
  MessageUnpinResult,
} from '../src/services/domain/message_pinning.ts';
import type { ExpectTrue, IsExactly } from './support/type_conformance.ts';

type FailureReason<Result> = Result extends { readonly reason: infer Reason } ? Reason : never;

type EntryPointFailureReason<Method extends keyof MessagePinningService> = FailureReason<
  ReturnType<MessagePinningService[Method]>
>;

// A chat type's results, with `never` for the pinner's own failure, report what reaching the chat,
// the message and the right can refuse once the pinner is known to exist.
type _BotPrivateChatPins = [
  ExpectTrue<
    IsExactly<
      FailureReason<MessagePinResult<BotPrivateChatPinningTypes, never>>,
      | 'account_not_found'
      | 'conversation_not_started'
      | 'bot_blocked'
      | 'message_not_found'
      | 'service_message_not_pinnable'
      | 'message_already_pinned'
    >
  >,
  ExpectTrue<
    IsExactly<
      FailureReason<MessageUnpinResult<BotPrivateChatPinningTypes, never>>,
      | 'account_not_found'
      | 'conversation_not_started'
      | 'bot_blocked'
      | 'message_not_found'
      | 'service_message_not_pinnable'
      | 'message_not_pinned'
    >
  >,
  ExpectTrue<
    IsExactly<
      FailureReason<ChatMessagesUnpinResult<BotPrivateChatPinningTypes, never>>,
      'account_not_found' | 'conversation_not_started' | 'bot_blocked'
    >
  >,
];

type _BotSupergroupPins = [
  ExpectTrue<
    IsExactly<
      FailureReason<MessagePinResult<BotSupergroupPinningTypes, never>>,
      | 'chat_not_found'
      | 'bot_not_a_member'
      | 'bot_kicked'
      | 'message_not_found'
      | 'not_enough_rights'
      | 'service_message_not_pinnable'
      | 'message_already_pinned'
    >
  >,
  ExpectTrue<
    IsExactly<
      FailureReason<ChatMessagesUnpinResult<BotSupergroupPinningTypes, never>>,
      'chat_not_found' | 'bot_not_a_member' | 'bot_kicked' | 'not_enough_rights'
    >
  >,
];

type _AccountPrivateChatPins = [
  ExpectTrue<
    IsExactly<
      FailureReason<MessagePinResult<AccountPrivateChatPinningTypes, never>>,
      | 'chat_not_found'
      | 'bot_blocked'
      | 'message_not_found'
      | 'service_message_not_pinnable'
      | 'message_already_pinned'
    >
  >,
  ExpectTrue<
    IsExactly<
      FailureReason<ChatMessagesUnpinResult<AccountPrivateChatPinningTypes, never>>,
      'chat_not_found' | 'bot_blocked'
    >
  >,
];

type _AccountSupergroupPins = [
  ExpectTrue<
    IsExactly<
      FailureReason<MessagePinResult<AccountSupergroupPinningTypes, never>>,
      | 'chat_not_found'
      | 'not_a_member'
      | 'message_not_found'
      | 'not_enough_rights'
      | 'service_message_not_pinnable'
      | 'message_already_pinned'
    >
  >,
  ExpectTrue<
    IsExactly<
      FailureReason<ChatMessagesUnpinResult<AccountSupergroupPinningTypes, never>>,
      'chat_not_found' | 'not_a_member' | 'not_enough_rights'
    >
  >,
];

type _BotEntryPoints = [
  ExpectTrue<
    IsExactly<
      EntryPointFailureReason<'pinMessageByBot'>,
      | 'bot_not_found'
      | 'chat_not_found'
      | 'account_not_found'
      | 'conversation_not_started'
      | 'bot_not_a_member'
      | 'bot_kicked'
      | 'bot_blocked'
      | 'message_not_found'
      | 'not_enough_rights'
      | 'service_message_not_pinnable'
      | 'message_already_pinned'
    >
  >,
  ExpectTrue<
    IsExactly<
      EntryPointFailureReason<'unpinAllMessagesByBot'>,
      | 'bot_not_found'
      | 'chat_not_found'
      | 'account_not_found'
      | 'conversation_not_started'
      | 'bot_not_a_member'
      | 'bot_kicked'
      | 'bot_blocked'
      | 'not_enough_rights'
    >
  >,
];

type _AccountEntryPoints = [
  ExpectTrue<
    IsExactly<
      EntryPointFailureReason<'unpinMessageByAccount'>,
      | 'pinner_not_found'
      | 'chat_not_found'
      | 'not_a_member'
      | 'bot_blocked'
      | 'message_not_found'
      | 'not_enough_rights'
      | 'service_message_not_pinnable'
      | 'message_not_pinned'
    >
  >,
  ExpectTrue<
    IsExactly<
      EntryPointFailureReason<'getPinnedMessages'>,
      'pinner_not_found' | 'chat_not_found' | 'not_a_member'
    >
  >,
];

Deno.test('each pinning entry point reports only the failures its pinner and chat type produce', () => {
  // The checks above run when this file is type-checked.
});
