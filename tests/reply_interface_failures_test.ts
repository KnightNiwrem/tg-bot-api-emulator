/**
 * Compile-time checks that each entry point of the shared reply interface service reports exactly
 * the failures its chat type can produce: only a supergroup refuses a non-member or content its
 * member may not send, and only a private chat's press answers a request or meets the bot's block.
 * The expected sets are written out here, independently of the service's types; the content and
 * peer-sharing rules a press applies keep their own failure types.
 */
import type { ContentNormalizationFailure } from '../src/services/domain/message_content.ts';
import type { ReplyInterfaceService } from '../src/services/domain/reply_interface.ts';
import type {
  SharedChatFailureReason,
  SharedUsersFailureReason,
} from '../src/services/domain/requested_peer_sharing.ts';
import type { ExpectTrue, IsExactly } from './support/type_conformance.ts';

type FailureReason<Method extends keyof ReplyInterfaceService> =
  ReturnType<ReplyInterfaceService[Method]> extends infer Result
    ? Result extends { readonly reason: infer Reason } ? Reason : never
    : never;

/** The reasons a selection of a reply keyboard's button by its text and answer fails. */
type SelectionFailureReason =
  | 'reply_keyboard_button_not_found'
  | 'reply_keyboard_button_answer_missing'
  | 'reply_keyboard_button_answer_not_requested'
  | 'reply_keyboard_button_ambiguous';

/** The reasons an account's message fails, wherever it is sent. */
type AccountMessageFailureReason =
  | 'message_text_empty'
  | 'account_phone_number_missing'
  | 'reply_message_not_found'
  | ContentNormalizationFailure['reason'];

type _Reads = [
  ExpectTrue<
    IsExactly<FailureReason<'getPrivateChatReplyInterface'>, 'account_not_found' | 'bot_not_found'>
  >,
  ExpectTrue<
    IsExactly<
      FailureReason<'getSupergroupReplyInterface'>,
      'account_not_found' | 'chat_not_found' | 'not_a_member'
    >
  >,
];

type _Presses = [
  ExpectTrue<
    IsExactly<
      FailureReason<'pressPrivateChatReplyKeyboardButton'>,
      | 'account_not_found'
      | 'bot_not_found'
      | SelectionFailureReason
      | 'bot_blocked'
      | AccountMessageFailureReason
      | 'requested_poll_type_mismatch'
      | SharedUsersFailureReason
      | SharedChatFailureReason
    >
  >,
  ExpectTrue<
    IsExactly<
      FailureReason<'pressSupergroupReplyKeyboardButton'>,
      | 'account_not_found'
      | 'chat_not_found'
      | 'not_a_member'
      | SelectionFailureReason
      | AccountMessageFailureReason
      | 'send_permission_missing'
    >
  >,
];

Deno.test('each reply interface entry point reports only the failures its chat type produces', () => {
  // The checks above run when this file is type-checked.
});
