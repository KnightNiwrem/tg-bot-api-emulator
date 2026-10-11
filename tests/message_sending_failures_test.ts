/**
 * Compile-time checks that each entry point of the shared sending service reports exactly the
 * failures its sender and chat type can produce: only a supergroup refuses message effects, Web
 * App buttons and content a member may not send, only a private chat meets the account's block,
 * and only an inline query result needs the right to use inline bots. The expected sets are
 * written out here, independently of the service's types; the shared content rules keep their
 * own failure types.
 */
import type {
  ContentNormalizationFailure,
  ContentTextNormalizationFailure,
} from '../src/services/message_content.ts';
import type { MessageSendingService } from '../src/services/message_sending.ts';
import type { AlbumCompositionFailureReason } from '../src/types/media_album.ts';
import type { PrivateMessage, SupergroupMessage } from '../src/types/virtual_message.ts';
import type { ExpectTrue, IsExactly } from './support/type_conformance.ts';

type Result<Method extends keyof MessageSendingService> = MessageSendingService[Method] extends
  (...input: never[]) => infer Output ? Output : never;

type FailureReason<Method extends keyof MessageSendingService> = Result<Method> extends infer R
  ? R extends { readonly sent: false; readonly reason: infer Reason } ? Reason : never
  : never;

type SentMessage<Method extends keyof MessageSendingService> = Result<Method> extends infer R
  ? R extends { readonly sent: true; readonly message: infer Message } ? Message
  : R extends { readonly sent: true; readonly messages: readonly (infer Message)[] } ? Message
  : never
  : never;

type ContentFailureReason = ContentNormalizationFailure['reason'];
type TextFailureReason = ContentTextNormalizationFailure['reason'];

/** Why a bot does not reach its private chat, or a supergroup. */
type BotPrivateChatAccessReason = 'account_not_found' | 'conversation_not_started';
type BotSupergroupAccessReason = 'chat_not_found' | 'bot_not_a_member' | 'bot_kicked';

type _BotMessages = [
  ExpectTrue<
    IsExactly<
      FailureReason<'sendPrivateChatMessage'>,
      | 'bot_not_found'
      | 'message_text_empty'
      | BotPrivateChatAccessReason
      | 'reply_message_not_found'
      | ContentFailureReason
      | 'callback_data_invalid'
      | 'quote_invalid'
      | 'bot_blocked'
    >
  >,
  ExpectTrue<
    IsExactly<
      FailureReason<'sendSupergroupMessage'>,
      | 'bot_not_found'
      | 'message_text_empty'
      | BotSupergroupAccessReason
      | 'reply_message_not_found'
      | 'message_effect_not_allowed_in_chat'
      | ContentFailureReason
      | 'send_permission_missing'
      | 'callback_data_invalid'
      | 'button_type_invalid'
      | 'quote_invalid'
    >
  >,
  ExpectTrue<
    IsExactly<
      FailureReason<'sendPrivateChatAlbum'>,
      | 'bot_not_found'
      | BotPrivateChatAccessReason
      | 'reply_message_not_found'
      | AlbumCompositionFailureReason
      | TextFailureReason
      | 'quote_invalid'
      | 'bot_blocked'
    >
  >,
  ExpectTrue<
    IsExactly<
      FailureReason<'sendSupergroupAlbum'>,
      | 'bot_not_found'
      | BotSupergroupAccessReason
      | 'reply_message_not_found'
      | 'message_effect_not_allowed_in_chat'
      | AlbumCompositionFailureReason
      | TextFailureReason
      | 'send_permission_missing'
      | 'quote_invalid'
    >
  >,
];

type _AccountMessages = [
  ExpectTrue<
    IsExactly<
      FailureReason<'sendAccountPrivateChatMessage'>,
      | 'account_not_found'
      | 'bot_not_found'
      | 'bot_blocked'
      | 'message_text_empty'
      | 'account_phone_number_missing'
      | ContentFailureReason
      | 'reply_message_not_found'
    >
  >,
  ExpectTrue<
    IsExactly<
      FailureReason<'sendAccountSupergroupMessage'>,
      | 'account_not_found'
      | 'chat_not_found'
      | 'not_a_member'
      | 'message_text_empty'
      | 'account_phone_number_missing'
      | ContentFailureReason
      | 'send_permission_missing'
      | 'reply_message_not_found'
    >
  >,
  ExpectTrue<
    IsExactly<
      FailureReason<'sendAccountPrivateChatAlbum'>,
      | 'account_not_found'
      | 'bot_not_found'
      | 'bot_blocked'
      | AlbumCompositionFailureReason
      | TextFailureReason
      | 'reply_message_not_found'
    >
  >,
  ExpectTrue<
    IsExactly<
      FailureReason<'sendAccountSupergroupAlbum'>,
      | 'account_not_found'
      | 'chat_not_found'
      | 'not_a_member'
      | AlbumCompositionFailureReason
      | TextFailureReason
      | 'send_permission_missing'
      | 'reply_message_not_found'
    >
  >,
  ExpectTrue<
    IsExactly<
      FailureReason<'sendAccountPrivateChatInlineResult'>,
      'account_not_found' | 'bot_not_found' | 'bot_blocked'
    >
  >,
  ExpectTrue<
    IsExactly<
      FailureReason<'sendAccountSupergroupInlineResult'>,
      | 'account_not_found'
      | 'chat_not_found'
      | 'not_a_member'
      | 'inline_bots_not_permitted'
      | 'send_permission_missing'
    >
  >,
  ExpectTrue<
    IsExactly<
      FailureReason<'sendAccountPrivateChatForward'>,
      'account_not_found' | 'bot_not_found' | 'bot_blocked'
    >
  >,
  ExpectTrue<
    IsExactly<
      FailureReason<'sendAccountSupergroupForward'>,
      'account_not_found' | 'chat_not_found' | 'not_a_member' | 'send_permission_missing'
    >
  >,
];

type _SentMessages = [
  ExpectTrue<IsExactly<SentMessage<'sendPrivateChatMessage'>, PrivateMessage>>,
  ExpectTrue<IsExactly<SentMessage<'sendSupergroupAlbum'>, SupergroupMessage>>,
  ExpectTrue<IsExactly<SentMessage<'sendAccountPrivateChatForward'>, PrivateMessage>>,
  ExpectTrue<IsExactly<SentMessage<'sendAccountSupergroupInlineResult'>, SupergroupMessage>>,
];

Deno.test('each sending entry point reports only the failures its sender and chat type produce', () => {
  // The checks above run when this file is type-checked.
});
