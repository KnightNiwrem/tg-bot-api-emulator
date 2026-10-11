/**
 * Compile-time checks that the shared editing service reports exactly the failures each sender and
 * chat type can produce: none of another chat type's, and, for an inline message, none about a
 * chat. Each chat type's results pin its own set; a bot's entry point for chat messages, whose
 * address selects the chat type, reports the two chat types' sets together. The expected sets are
 * written out here, independently of the service's types.
 */
import type {
  BotCaptionEditResult,
  BotKeyboardEditResult,
  BotMediaEditResult,
  BotPollStopResult,
  BotPrivateChatEditTypes,
  BotSupergroupEditTypes,
  BotTextEditResult,
  MessageEditingService,
} from '../src/services/domain/message_editing.ts';
import type { PrivateMessage, SupergroupMessage } from '../src/types/virtual_message.ts';
import type { ExpectTrue, IsExactly } from './support/type_conformance.ts';

type Results = {
  [Method in keyof MessageEditingService]: ReturnType<MessageEditingService[Method]>;
};

/** A bot's results for an edit of a chat message, as one chat type's targeting reports them. */
interface ChatTypeResults<Types extends BotPrivateChatEditTypes | BotSupergroupEditTypes> {
  readonly keyboard: BotKeyboardEditResult<Types>;
  readonly text: BotTextEditResult<Types>;
  readonly caption: BotCaptionEditResult<Types>;
  readonly media: BotMediaEditResult<Types>;
  readonly pollStop: BotPollStopResult<Types>;
}
type PrivateChatResults = ChatTypeResults<BotPrivateChatEditTypes>;
type SupergroupResults = ChatTypeResults<BotSupergroupEditTypes>;

type EditFailureReason<Result> = Result extends
  { readonly edited: false; readonly reason: infer Reason } ? Reason
  : never;
type EditedMessage<Result> = Result extends
  { readonly edited: true; readonly message: infer Message } ? Message
  : never;
type PollStopFailureReason<Result> = Result extends
  { readonly stopped: false; readonly reason: infer Reason } ? Reason : never;

/** Why a bot's edit of any kind fails, by the target it addresses. */
type PrivateChatTargetReason =
  | 'bot_not_found'
  | 'account_not_found'
  | 'conversation_not_started'
  | 'message_not_found'
  | 'message_not_editable';
type SupergroupTargetReason =
  | 'bot_not_found'
  | 'chat_not_found'
  | 'bot_not_a_member'
  | 'bot_kicked'
  | 'message_not_found'
  | 'message_not_editable';
type InlineMessageTargetReason = 'bot_not_found' | 'message_not_found' | 'message_not_editable';

/** Why a bot's edited message is refused, in a private chat or wherever Web Apps are refused. */
type PrivateChatEditedMessageReason = 'callback_data_invalid' | 'message_not_modified';
type ButtonRefusingEditedMessageReason = PrivateChatEditedMessageReason | 'button_type_invalid';

type TextReason = 'message_text_empty' | 'message_has_no_text' | 'message_text_too_long';
type CaptionReason = 'message_has_no_caption' | 'caption_too_long';
type MediaReason = 'message_media_not_editable' | 'caption_too_long' | 'album_media_kind_changed';
type PollReason = 'message_has_no_poll' | 'poll_not_stoppable' | 'poll_already_closed';

type PrivateChatKeyboardEditReason = PrivateChatTargetReason | PrivateChatEditedMessageReason;
type PrivateChatTextEditReason =
  | PrivateChatTargetReason
  | TextReason
  | PrivateChatEditedMessageReason
  | 'text_invalid';
type PrivateChatCaptionEditReason =
  | PrivateChatTargetReason
  | CaptionReason
  | PrivateChatEditedMessageReason
  | 'text_invalid';
type PrivateChatMediaEditReason =
  | PrivateChatTargetReason
  | MediaReason
  | PrivateChatEditedMessageReason
  | 'text_invalid';
type PrivateChatPollStopReason =
  | 'bot_not_found'
  | 'account_not_found'
  | 'conversation_not_started'
  | 'message_not_found'
  | PollReason
  | 'callback_data_invalid';

type _PrivateChatEdits = [
  ExpectTrue<
    IsExactly<EditFailureReason<PrivateChatResults['keyboard']>, PrivateChatKeyboardEditReason>
  >,
  ExpectTrue<IsExactly<EditFailureReason<PrivateChatResults['text']>, PrivateChatTextEditReason>>,
  ExpectTrue<
    IsExactly<EditFailureReason<PrivateChatResults['caption']>, PrivateChatCaptionEditReason>
  >,
  ExpectTrue<
    IsExactly<EditFailureReason<PrivateChatResults['media']>, PrivateChatMediaEditReason>
  >,
  ExpectTrue<
    IsExactly<PollStopFailureReason<PrivateChatResults['pollStop']>, PrivateChatPollStopReason>
  >,
  ExpectTrue<IsExactly<EditedMessage<PrivateChatResults['text']>, PrivateMessage>>,
];

type SupergroupKeyboardEditReason = SupergroupTargetReason | ButtonRefusingEditedMessageReason;
type SupergroupTextEditReason =
  | SupergroupTargetReason
  | TextReason
  | ButtonRefusingEditedMessageReason
  | 'text_invalid'
  | 'send_permission_missing';
type SupergroupCaptionEditReason =
  | SupergroupTargetReason
  | CaptionReason
  | ButtonRefusingEditedMessageReason
  | 'text_invalid';
type SupergroupMediaEditReason =
  | SupergroupTargetReason
  | MediaReason
  | ButtonRefusingEditedMessageReason
  | 'text_invalid'
  | 'send_permission_missing';
type SupergroupPollStopReason =
  | 'bot_not_found'
  | 'chat_not_found'
  | 'bot_not_a_member'
  | 'bot_kicked'
  | 'message_not_found'
  | PollReason
  | 'button_type_invalid'
  | 'callback_data_invalid';

type _SupergroupEdits = [
  ExpectTrue<
    IsExactly<EditFailureReason<SupergroupResults['keyboard']>, SupergroupKeyboardEditReason>
  >,
  ExpectTrue<IsExactly<EditFailureReason<SupergroupResults['text']>, SupergroupTextEditReason>>,
  ExpectTrue<
    IsExactly<EditFailureReason<SupergroupResults['caption']>, SupergroupCaptionEditReason>
  >,
  ExpectTrue<IsExactly<EditFailureReason<SupergroupResults['media']>, SupergroupMediaEditReason>>,
  ExpectTrue<
    IsExactly<PollStopFailureReason<SupergroupResults['pollStop']>, SupergroupPollStopReason>
  >,
  ExpectTrue<IsExactly<EditedMessage<SupergroupResults['text']>, SupergroupMessage>>,
];

// A bot addresses a chat message by its chat's address, so its entry points report what either
// chat type reports, and nothing else.
type _BotChatMessageEdits = [
  ExpectTrue<
    IsExactly<
      EditFailureReason<Results['editChatMessageKeyboard']>,
      PrivateChatKeyboardEditReason | SupergroupKeyboardEditReason
    >
  >,
  ExpectTrue<
    IsExactly<
      EditFailureReason<Results['editChatMessageText']>,
      PrivateChatTextEditReason | SupergroupTextEditReason
    >
  >,
  ExpectTrue<
    IsExactly<
      EditFailureReason<Results['editChatMessageCaption']>,
      PrivateChatCaptionEditReason | SupergroupCaptionEditReason
    >
  >,
  ExpectTrue<
    IsExactly<
      EditFailureReason<Results['editChatMessageMedia']>,
      PrivateChatMediaEditReason | SupergroupMediaEditReason
    >
  >,
  ExpectTrue<
    IsExactly<
      PollStopFailureReason<Results['stopPoll']>,
      PrivateChatPollStopReason | SupergroupPollStopReason
    >
  >,
  ExpectTrue<
    IsExactly<EditedMessage<Results['editChatMessageText']>, PrivateMessage | SupergroupMessage>
  >,
];

// An inline message is reached by its identifier alone, so no failure names its chat, and TDLib
// checks no right for it.
type _InlineMessageEdits = [
  ExpectTrue<
    IsExactly<
      EditFailureReason<Results['editInlineMessageKeyboard']>,
      InlineMessageTargetReason | ButtonRefusingEditedMessageReason
    >
  >,
  ExpectTrue<
    IsExactly<
      EditFailureReason<Results['editInlineMessageText']>,
      InlineMessageTargetReason | TextReason | ButtonRefusingEditedMessageReason | 'text_invalid'
    >
  >,
  ExpectTrue<
    IsExactly<
      EditFailureReason<Results['editInlineMessageCaption']>,
      InlineMessageTargetReason | CaptionReason | ButtonRefusingEditedMessageReason | 'text_invalid'
    >
  >,
  ExpectTrue<
    IsExactly<
      EditFailureReason<Results['editInlineMessageMedia']>,
      InlineMessageTargetReason | MediaReason | ButtonRefusingEditedMessageReason | 'text_invalid'
    >
  >,
];

/** Why an account's edit fails after its chat is reached, in a chat of any type. */
type AccountEditReason =
  | 'message_not_found'
  | 'message_not_editable'
  | 'message_text_empty'
  | 'message_has_no_text'
  | 'message_text_too_long'
  | 'message_has_no_caption'
  | 'caption_too_long'
  | 'message_not_modified'
  | 'text_invalid';

type _AccountEdits = [
  ExpectTrue<
    IsExactly<
      EditFailureReason<Results['editAccountPrivateChatMessage']>,
      'account_not_found' | 'bot_not_found' | AccountEditReason
    >
  >,
  ExpectTrue<
    IsExactly<
      EditFailureReason<Results['editAccountSupergroupMessage']>,
      'account_not_found' | 'chat_not_found' | 'not_a_member' | AccountEditReason
    >
  >,
  ExpectTrue<IsExactly<EditedMessage<Results['editAccountPrivateChatMessage']>, PrivateMessage>>,
  ExpectTrue<
    IsExactly<EditedMessage<Results['editAccountSupergroupMessage']>, SupergroupMessage>
  >,
];

Deno.test('each editing entry point reports only the failures its sender and chat type produce', () => {
  // The checks above run when this file is type-checked.
});
