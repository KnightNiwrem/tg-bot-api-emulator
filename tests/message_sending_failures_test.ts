/**
 * Compile-time checks that the shared sending service reports exactly the failures each sender and
 * chat type can produce: only a supergroup refuses message effects, Web App buttons and content a
 * member may not send, only a private chat meets the account's block, and only an inline query
 * result needs the right to use inline bots. Each chat type's bot results pin its own set; a bot's
 * entry point, whose address selects the chat type, reports the two chat types' sets together.
 * The expected sets are written out here, independently of the service's types; the shared content
 * rules keep their own failure types.
 */
import type {
  ContentNormalizationFailure,
  ContentTextNormalizationFailure,
} from '../src/services/domain/message_content.ts';
import type {
  BotAlbumSendResult,
  BotMessageSendResult,
  BotPrivateChatSendingTypes,
  BotSupergroupSendingTypes,
  MessageSendingService,
} from '../src/services/domain/message_sending.ts';
import type { AlbumCompositionFailureReason } from '../src/types/media_album.ts';
import type { PrivateMessage, SupergroupMessage } from '../src/types/virtual_message.ts';
import type { ExpectTrue, IsExactly } from './support/type_conformance.ts';

type Result<Method extends keyof MessageSendingService> = MessageSendingService[Method] extends
  (...input: never[]) => infer Output ? Output : never;

type ResultFailureReason<R> = R extends { readonly sent: false; readonly reason: infer Reason }
  ? Reason
  : never;

type FailureReason<Method extends keyof MessageSendingService> = ResultFailureReason<
  Result<Method>
>;

type ResultSentMessage<R> = R extends { readonly sent: true; readonly message: infer Message }
  ? Message
  : R extends { readonly sent: true; readonly messages: readonly (infer Message)[] } ? Message
  : never;

type SentMessage<Method extends keyof MessageSendingService> = ResultSentMessage<Result<Method>>;

type ContentFailureReason = ContentNormalizationFailure['reason'];
type TextFailureReason = ContentTextNormalizationFailure['reason'];

/** Why a bot does not reach its private chat, or a supergroup. */
type BotPrivateChatAccessReason = 'account_not_found' | 'conversation_not_started';
type BotSupergroupAccessReason = 'chat_not_found' | 'bot_not_a_member' | 'bot_kicked';

type BotPrivateChatMessageReason =
  | 'bot_not_found'
  | 'message_text_empty'
  | BotPrivateChatAccessReason
  | 'reply_message_not_found'
  | ContentFailureReason
  | 'callback_data_invalid'
  | 'quote_invalid'
  | 'bot_blocked';
type BotSupergroupMessageReason =
  | 'bot_not_found'
  | 'message_text_empty'
  | BotSupergroupAccessReason
  | 'reply_message_not_found'
  | 'message_effect_not_allowed_in_chat'
  | ContentFailureReason
  | 'send_permission_missing'
  | 'callback_data_invalid'
  | 'button_type_invalid'
  | 'quote_invalid';
type BotPrivateChatAlbumReason =
  | 'bot_not_found'
  | BotPrivateChatAccessReason
  | 'reply_message_not_found'
  | AlbumCompositionFailureReason
  | TextFailureReason
  | 'quote_invalid'
  | 'bot_blocked';
type BotSupergroupAlbumReason =
  | 'bot_not_found'
  | BotSupergroupAccessReason
  | 'reply_message_not_found'
  | 'message_effect_not_allowed_in_chat'
  | AlbumCompositionFailureReason
  | TextFailureReason
  | 'send_permission_missing'
  | 'quote_invalid';

type _BotMessages = [
  ExpectTrue<
    IsExactly<
      ResultFailureReason<BotMessageSendResult<BotPrivateChatSendingTypes>>,
      BotPrivateChatMessageReason
    >
  >,
  ExpectTrue<
    IsExactly<
      ResultFailureReason<BotMessageSendResult<BotSupergroupSendingTypes>>,
      BotSupergroupMessageReason
    >
  >,
  ExpectTrue<
    IsExactly<
      ResultFailureReason<BotAlbumSendResult<BotPrivateChatSendingTypes>>,
      BotPrivateChatAlbumReason
    >
  >,
  ExpectTrue<
    IsExactly<
      ResultFailureReason<BotAlbumSendResult<BotSupergroupSendingTypes>>,
      BotSupergroupAlbumReason
    >
  >,
  // A bot addresses its chat by the chat's address, so its entry points report what either chat
  // type reports, and nothing else.
  ExpectTrue<
    IsExactly<
      FailureReason<'sendChatMessage'>,
      BotPrivateChatMessageReason | BotSupergroupMessageReason
    >
  >,
  ExpectTrue<
    IsExactly<FailureReason<'sendChatAlbum'>, BotPrivateChatAlbumReason | BotSupergroupAlbumReason>
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
  ExpectTrue<
    IsExactly<
      ResultSentMessage<BotMessageSendResult<BotPrivateChatSendingTypes>>,
      PrivateMessage
    >
  >,
  ExpectTrue<
    IsExactly<
      ResultSentMessage<BotAlbumSendResult<BotSupergroupSendingTypes>>,
      SupergroupMessage
    >
  >,
  ExpectTrue<IsExactly<SentMessage<'sendChatMessage'>, PrivateMessage | SupergroupMessage>>,
  ExpectTrue<IsExactly<SentMessage<'sendAccountPrivateChatForward'>, PrivateMessage>>,
  ExpectTrue<IsExactly<SentMessage<'sendAccountSupergroupInlineResult'>, SupergroupMessage>>,
];

Deno.test('each sending entry point reports only the failures its sender and chat type produce', () => {
  // The checks above run when this file is type-checked.
});
