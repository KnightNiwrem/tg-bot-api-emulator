// Checks at compile time that the Bot API objects the emulator emits conform to an independent
// definition: grammY's types, imported as `grammy-types-reference` at an exact version that stays
// pinned when the caret grammY import moves on. `deno task check` fails when a local wire type
// stops conforming. Each local type is checked against the specific grammY variant it stands for,
// such as `Message & Update.Edited & Update.NonChannel` for an edited message, without `readonly`,
// and with every key it declares required to exist on that variant; see
// `support/type_conformance.ts`. A failing check names the failing paths in its error.
//
// The local types stay authoritative. Where the emulator's output knowingly differs from grammY,
// the difference is listed below as a deviation, with its scope, evidence and the upstream change
// that should prompt a re-review. Output is never changed merely to match grammY.

import type {
  Audio,
  BotCommand,
  CallbackQuery,
  Chat,
  ChatAdministratorRights,
  ChatFullInfo,
  ChatInviteLink,
  ChatJoinRequest,
  ChatMember,
  ChatMemberAdministrator,
  ChatMemberBanned,
  ChatMemberLeft,
  ChatMemberMember,
  ChatMemberOwner,
  ChatMemberRestricted,
  ChatMemberUpdated,
  ChatPermissions,
  ChosenInlineResult,
  Document,
  File,
  InlineQuery,
  MenuButton,
  Message,
  MessageEntity,
  MessageGenerationStopped,
  MessageReactionUpdated,
  PhotoSize,
  Poll,
  PollAnswer,
  RichBlockMap,
  Update,
  User,
  UserFromGetMe,
  UsersShared,
  Video,
  WebhookInfo,
} from 'grammy-types-reference';

import type {
  BotApiAudio,
  BotApiBotCommand,
  BotApiCallbackQueryUpdate,
  BotApiChatInviteLink,
  BotApiChatJoinRequestUpdate,
  BotApiChatMember,
  BotApiChatMemberUpdate,
  BotApiChosenInlineResultUpdate,
  BotApiDefaultAdministratorRights,
  BotApiDocument,
  BotApiDownloadableFile,
  BotApiEditedMessageUpdate,
  BotApiInlineQueryUpdate,
  BotApiMenuButton,
  BotApiMessageEntity,
  BotApiMessageGenerationStopped,
  BotApiMessageReactionUpdate,
  BotApiMessageReactionUpdated,
  BotApiMessageUpdate,
  BotApiMyChatMemberUpdate,
  BotApiPinnedPrivateMessage,
  BotApiPollAnswerUpdate,
  BotApiPollUpdate,
  BotApiPrivateChatFullInfo,
  BotApiPrivateMessage,
  BotApiStoppedMessageGenerationUpdate,
  BotApiSupergroupChatFullInfo,
  BotApiSupergroupMessage,
  BotApiUpdate,
  BotApiVideo,
  BotApiWebhookInfo,
} from '../src/types/bot_api.ts';
import type { BotApiPoll } from '../src/types/bot_api_poll.ts';
import type { BotApiRichMessage } from '../src/types/bot_api_rich_message.ts';
import type { VirtualBotProfile } from '../src/types/virtual_bot.ts';
import type {
  Conformance,
  DeepMutable,
  ExpectTrue,
  FailingPaths,
  IsExactly,
  ReferenceDeviation,
} from './support/type_conformance.ts';

// ## Deviations from grammY
//
// The official Bot API server's source is cited at the commit the emulator follows,
// e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1, and TDLib's at bc9c263e2bfee06aaab41e82db51a103376030bc.

/**
 * `stopped_message_generation.draft_id` is decimal text, as the official Bot API server writes
 * it, where grammY declares a number.
 *
 * - Scope: `draft_id` of `MessageGenerationStopped`.
 * - Evidence: the server writes it with `td::to_string`
 *   (https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L3980-L3992),
 *   and `tests/message_draft_api_test.ts` checks the text on the wire.
 * - Re-review when grammY's `MessageGenerationStopped.draft_id` or the server's
 *   `JsonMessageGenerationStopped` changes.
 */
type DraftIdIsDecimalText = ReferenceDeviation<MessageGenerationStopped, { draft_id: string }>;

/**
 * Unclassified pending Telegram evidence: an `edited_message` may lack `edit_date`, which grammY
 * requires. A bot's keyboard-only edit of a message an account sent through its inline mode keeps
 * the message's content-edit time, absent before any content edit, and the projection omits an
 * absent time. Telegram's output for that edit is not established, so the local type is not
 * narrowed and no timestamp is invented.
 *
 * - Scope: `edit_date` of the edited messages of `edited_message` updates.
 * - Evidence: https://github.com/KnightNiwrem/tg-bot-api-emulator/issues/164 (Finding 3);
 *   `tests/inline_message_keyboard_edit_test.ts` records the emulator's output in a private chat
 *   and a supergroup. The server writes `edit_date` only when it is positive
 *   (https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L4762-L4764).
 * - Re-review when a recording from Telegram shows what a bot receives for such an edit; then
 *   either fix the emulator or narrow this deviation to that edit.
 */
type EditDateOfEditedMessageUnclassified = ReferenceDeviation<
  Update.Edited,
  { edit_date?: number }
>;

/**
 * Unclassified pending Telegram evidence: a rich message's map shows the zoom its sender chose,
 * from 0 to 24 as TDLib accepts it, where grammY declares 13 to 20, as the Bot API documentation
 * describes a received map.
 *
 * - Scope: `zoom` of `RichBlockMap`.
 * - Evidence: TDLib accepts a zoom from 0 to 24 when sending
 *   (https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/WebPageBlock.cpp#L5761)
 *   and when receiving
 *   (https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/WebPageBlock.cpp#L5249-L5252),
 *   and the server writes TDLib's value
 *   (https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L4628).
 *   Whether Telegram's servers change it in between is not established.
 * - Re-review when a recording from Telegram shows a received map's zoom, or grammY's
 *   `RichBlockMap.zoom` changes.
 */
type MapZoomUnclassified = ReferenceDeviation<RichBlockMap, { zoom: number }>;

/**
 * Text entities include bank card numbers, which the official server writes and grammY lacks.
 *
 * - Scope: the `type` of `MessageEntity.CommonMessageEntity`.
 * - Evidence: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L580-L582;
 *   the emulator detects them as TDLib's `find_bank_card_numbers` does.
 * - Re-review when grammY adds the entity type or the server's `JsonEntity` drops it.
 */
type BankCardNumberEntities = ReferenceDeviation<
  MessageEntity.CommonMessageEntity,
  { type: MessageEntity.CommonMessageEntity['type'] | 'bank_card_number' }
>;

/**
 * A forward also shows the legacy forms of its origin, which the official server still writes and
 * grammY no longer declares.
 *
 * - Scope: `forward_from`, `forward_sender_name` and `forward_date` of `Message`.
 * - Evidence: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L4778-L4812.
 * - Re-review when the server's `JsonMessage` stops writing them, or grammY declares them.
 */
type LegacyForwardFields = ReferenceDeviation<
  Message,
  { forward_from?: User; forward_sender_name?: string; forward_date?: number }
>;

/**
 * A service message about members joining or leaving also shows its legacy fields, which the
 * official server still writes and grammY no longer declares.
 *
 * - Scope: `new_chat_participant`, `new_chat_member` and `left_chat_participant` of `Message`.
 * - Evidence: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L4967-L5001.
 * - Re-review when the server's `JsonMessage` stops writing them, or grammY declares them.
 */
type LegacyMembershipFields = ReferenceDeviation<
  Message,
  { new_chat_participant?: User; new_chat_member?: User; left_chat_participant?: User }
>;

/**
 * A service message about shared users also shows the legacy forms of what was shared, which the
 * official server still writes and grammY no longer declares: `user_shared` when one user was
 * shared, and the shared users' IDs.
 *
 * - Scope: `user_shared` of `Message`, and `user_ids` of `UsersShared`.
 * - Evidence: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L5188-L5194
 *   and https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L3887.
 * - Re-review when the server's `JsonMessage` or `JsonUsersShared` stops writing them, or grammY
 *   declares them.
 */
type LegacySharedUserFields =
  | ReferenceDeviation<Message, { user_shared?: { user_id: number; request_id: number } }>
  | ReferenceDeviation<UsersShared, { user_ids: number[] }>;

/**
 * A file with a thumbnail also shows it as the legacy `thumb`, which the official server still
 * writes and grammY no longer declares.
 *
 * - Scope: `thumb` of `Document` and of the files that extend it, which include `Video` and
 *   `Audio`, the other files the emulator shows thumbnails of.
 * - Evidence: the server's `json_store_thumbnail`
 *   (https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L17975-L17983).
 * - Re-review when the server stops writing `thumb`, or grammY declares it.
 */
type LegacyThumbnailField = ReferenceDeviation<Document, { thumb?: PhotoSize }>;

/**
 * Chat members and permissions also show legacy rights, which the official server still writes
 * and grammY no longer declares: an administrator's `can_manage_voice_chats`, and
 * `can_send_media_messages` for any of the media rights.
 *
 * - Scope: `can_manage_voice_chats` of `ChatMemberAdministrator`, and `can_send_media_messages`
 *   of `ChatPermissions` and of `ChatMemberRestricted`, which extends it.
 * - Evidence: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L5837
 *   and the server's `json_store_permissions`
 *   (https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L18042-L18047).
 * - Re-review when the server stops writing them, or grammY declares them.
 */
type LegacyRightFields =
  | ReferenceDeviation<ChatMemberAdministrator, { can_manage_voice_chats: boolean }>
  | ReferenceDeviation<ChatPermissions, { can_send_media_messages: boolean }>;

/**
 * A quiz with one correct option also shows it as the legacy `correct_option_id`, which the
 * official server still writes and grammY no longer declares.
 *
 * - Scope: `correct_option_id` of `Poll`.
 * - Evidence: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L2802-L2804.
 * - Re-review when the server's `JsonPoll` stops writing it, or grammY declares it.
 */
type LegacyCorrectOptionField = ReferenceDeviation<Poll, { correct_option_id?: number }>;

/**
 * `getChat` shows a user other than a bot with the legacy `can_send_gift`, which the official
 * server still writes besides `accepted_gift_types` and grammY no longer declares.
 *
 * - Scope: `can_send_gift` of `ChatFullInfo.PrivateChat`.
 * - Evidence: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L1577-L1580.
 * - Re-review when the server's `JsonChat` stops writing it, or grammY declares it.
 */
type LegacyCanSendGiftField = ReferenceDeviation<
  ChatFullInfo.PrivateChat,
  { can_send_gift?: true }
>;

/**
 * Not a difference in output but in the local type, which marks every default administrator
 * right optional because the rights shown depend on the kind of chat at run time. The emulator
 * shows every right that applies to the kind, as the official server's
 * `json_store_administrator_rights` does, and those include every right grammY requires.
 *
 * - Scope: which keys of `ChatAdministratorRights` are present; their names and values are still
 *   checked.
 * - Evidence: `getApplicableAdministratorRightFlags` in
 *   `src/types/bot_default_administrator_rights.ts`.
 * - Re-review when the local type states the rights of each kind of chat.
 */
type DefaultAdministratorRightsPresenceUnchecked = ReferenceDeviation<
  ChatAdministratorRights,
  Partial<ChatAdministratorRights>
>;

type ReferenceDeviations =
  | DraftIdIsDecimalText
  | EditDateOfEditedMessageUnclassified
  | MapZoomUnclassified
  | BankCardNumberEntities
  | LegacyForwardFields
  | LegacyMembershipFields
  | LegacySharedUserFields
  | LegacyThumbnailField
  | LegacyRightFields
  | LegacyCorrectOptionField
  | LegacyCanSendGiftField
  | DefaultAdministratorRightsPresenceUnchecked;

/** Conformance to grammY, apart from the listed deviations. */
type ConformsToGrammy<Local, Reference> = Conformance<Local, Reference, ReferenceDeviations>;

// ## The grammY variants of emitted objects

/** A private message as grammY types each kind the emulator emits: content, a pin, or a sharing. */
type GrammyPrivateMessage =
  & Message
  & Update.NonChannel
  & Update.Private
  & (
    | Message.TextMessage
    | Message.PhotoMessage
    | Message.DocumentMessage
    | Message.VideoMessage
    | Message.VoiceMessage
    | Message.AudioMessage
    | Message.RichMessageMessage
    | Message.PollMessage
    | Message.ContactMessage
    | Message.LocationMessage
    | Message.PinnedMessageMessage
    | Message.UsersSharedMessage
    | Message.ChatSharedMessage
    | Message.WebAppDataMessage
  );

/** A supergroup message as grammY types each kind the emulator emits: content, or a change. */
type GrammySupergroupMessage =
  & Message
  & Update.NonChannel
  & { chat: Chat.SupergroupChat }
  & (
    | Message.TextMessage
    | Message.PhotoMessage
    | Message.DocumentMessage
    | Message.VideoMessage
    | Message.VoiceMessage
    | Message.AudioMessage
    | Message.RichMessageMessage
    | Message.PollMessage
    | Message.ContactMessage
    | Message.LocationMessage
    | Message.NewChatMembersMessage
    | Message.LeftChatMemberMessage
    | Message.NewChatTitleMessage
    | Message.PinnedMessageMessage
  );

type GrammyEditedPrivateMessage = Update.Edited & GrammyPrivateMessage;

type GrammyEditedSupergroupMessage = Update.Edited & GrammySupergroupMessage;

/** grammY's update that carries the field, which its `Update` leaves optional, as the payload. */
type GrammyUpdateCarrying<Field extends keyof Update, Payload> = Update & Record<Field, Payload>;

// ## Conformance

interface BotApiWireTypeConformance {
  getMeUser: ExpectTrue<ConformsToGrammy<VirtualBotProfile, UserFromGetMe>>;
  privateMessage: ExpectTrue<ConformsToGrammy<BotApiPrivateMessage, GrammyPrivateMessage>>;
  supergroupMessage: ExpectTrue<ConformsToGrammy<BotApiSupergroupMessage, GrammySupergroupMessage>>;
  richMessage: ExpectTrue<
    ConformsToGrammy<BotApiRichMessage, NonNullable<Message['rich_message']>>
  >;
  messageUpdate: ExpectTrue<
    ConformsToGrammy<
      BotApiMessageUpdate,
      GrammyUpdateCarrying<'message', GrammyPrivateMessage | GrammySupergroupMessage>
    >
  >;
  editedPrivateMessage: ExpectTrue<
    ConformsToGrammy<BotApiPrivateMessage, GrammyEditedPrivateMessage>
  >;
  editedSupergroupMessage: ExpectTrue<
    ConformsToGrammy<BotApiSupergroupMessage, GrammyEditedSupergroupMessage>
  >;
  editedMessageUpdate: ExpectTrue<
    ConformsToGrammy<
      BotApiEditedMessageUpdate,
      GrammyUpdateCarrying<
        'edited_message',
        GrammyEditedPrivateMessage | GrammyEditedSupergroupMessage
      >
    >
  >;
  callbackQueryUpdate: ExpectTrue<
    ConformsToGrammy<
      BotApiCallbackQueryUpdate,
      GrammyUpdateCarrying<'callback_query', CallbackQuery>
    >
  >;
  inlineQueryUpdate: ExpectTrue<
    ConformsToGrammy<BotApiInlineQueryUpdate, GrammyUpdateCarrying<'inline_query', InlineQuery>>
  >;
  chosenInlineResultUpdate: ExpectTrue<
    ConformsToGrammy<
      BotApiChosenInlineResultUpdate,
      GrammyUpdateCarrying<'chosen_inline_result', ChosenInlineResult>
    >
  >;
  pollUpdate: ExpectTrue<ConformsToGrammy<BotApiPollUpdate, GrammyUpdateCarrying<'poll', Poll>>>;
  pollAnswerUpdate: ExpectTrue<
    ConformsToGrammy<BotApiPollAnswerUpdate, GrammyUpdateCarrying<'poll_answer', PollAnswer>>
  >;
  myChatMemberUpdate: ExpectTrue<
    ConformsToGrammy<
      BotApiMyChatMemberUpdate,
      GrammyUpdateCarrying<'my_chat_member', ChatMemberUpdated>
    >
  >;
  chatMemberUpdate: ExpectTrue<
    ConformsToGrammy<BotApiChatMemberUpdate, GrammyUpdateCarrying<'chat_member', ChatMemberUpdated>>
  >;
  chatJoinRequestUpdate: ExpectTrue<
    ConformsToGrammy<
      BotApiChatJoinRequestUpdate,
      GrammyUpdateCarrying<'chat_join_request', ChatJoinRequest>
    >
  >;
  messageReactionUpdate: ExpectTrue<
    ConformsToGrammy<
      BotApiMessageReactionUpdate,
      GrammyUpdateCarrying<'message_reaction', MessageReactionUpdated>
    >
  >;
  stoppedMessageGenerationUpdate: ExpectTrue<
    ConformsToGrammy<
      BotApiStoppedMessageGenerationUpdate,
      GrammyUpdateCarrying<'stopped_message_generation', MessageGenerationStopped>
    >
  >;
  privateChatFullInfo: ExpectTrue<
    ConformsToGrammy<BotApiPrivateChatFullInfo, ChatFullInfo.PrivateChat>
  >;
  supergroupChatFullInfo: ExpectTrue<
    ConformsToGrammy<BotApiSupergroupChatFullInfo, ChatFullInfo.SupergroupChat>
  >;
  chatMember: ExpectTrue<ConformsToGrammy<BotApiChatMember, ChatMember>>;
  chatMemberOwner: ExpectTrue<
    ConformsToGrammy<Extract<BotApiChatMember, { status: 'creator' }>, ChatMemberOwner>
  >;
  chatMemberAdministrator: ExpectTrue<
    ConformsToGrammy<
      Extract<BotApiChatMember, { status: 'administrator' }>,
      ChatMemberAdministrator
    >
  >;
  chatMemberMember: ExpectTrue<
    ConformsToGrammy<Extract<BotApiChatMember, { status: 'member' }>, ChatMemberMember>
  >;
  chatMemberRestricted: ExpectTrue<
    ConformsToGrammy<Extract<BotApiChatMember, { status: 'restricted' }>, ChatMemberRestricted>
  >;
  chatMemberLeft: ExpectTrue<
    ConformsToGrammy<Extract<BotApiChatMember, { status: 'left' }>, ChatMemberLeft>
  >;
  chatMemberBanned: ExpectTrue<
    ConformsToGrammy<Extract<BotApiChatMember, { status: 'kicked' }>, ChatMemberBanned>
  >;
  chatInviteLink: ExpectTrue<ConformsToGrammy<BotApiChatInviteLink, ChatInviteLink>>;
  downloadableFile: ExpectTrue<ConformsToGrammy<BotApiDownloadableFile, File>>;
  botCommand: ExpectTrue<ConformsToGrammy<BotApiBotCommand, BotCommand>>;
  menuButton: ExpectTrue<ConformsToGrammy<BotApiMenuButton, MenuButton>>;
  defaultAdministratorRights: ExpectTrue<
    ConformsToGrammy<BotApiDefaultAdministratorRights, ChatAdministratorRights>
  >;
  webhookInfo: ExpectTrue<ConformsToGrammy<BotApiWebhookInfo, WebhookInfo>>;
}

/** Every update the emulator emits is one of the variants checked above. */
type EveryUpdateVariantChecked = ExpectTrue<
  IsExactly<
    BotApiUpdate,
    | BotApiMessageUpdate
    | BotApiEditedMessageUpdate
    | BotApiCallbackQueryUpdate
    | BotApiInlineQueryUpdate
    | BotApiChosenInlineResultUpdate
    | BotApiPollUpdate
    | BotApiPollAnswerUpdate
    | BotApiMyChatMemberUpdate
    | BotApiChatMemberUpdate
    | BotApiChatJoinRequestUpdate
    | BotApiMessageReactionUpdate
    | BotApiStoppedMessageGenerationUpdate
  >
>;

// ## Each deviation is still needed
//
// Without its deviation, a check fails at the deviation's paths. Once an upstream change makes a
// deviation unnecessary, its check here fails, prompting the deviation's removal.

/** Conformance to grammY with every listed deviation but one. */
type ConformsWithout<Local, Reference, Deviation> = Conformance<
  Local,
  Reference,
  Exclude<ReferenceDeviations, Deviation>
>;

/** Whether a failing check names every one of the paths, among any others. */
type FailsAt<Result, Paths extends string> = [Paths] extends [FailingPaths<Result>] ? true
  : false;

interface DeviationsInUse {
  draftIdIsDecimalText: ExpectTrue<
    FailsAt<
      ConformsWithout<
        BotApiMessageGenerationStopped,
        MessageGenerationStopped,
        DraftIdIsDecimalText
      >,
      'draft_id'
    >
  >;
  editDateOfEditedMessageUnclassified: ExpectTrue<
    FailsAt<
      ConformsWithout<
        BotApiPrivateMessage,
        GrammyEditedPrivateMessage,
        EditDateOfEditedMessageUnclassified
      >,
      'edit_date'
    >
  >;
  mapZoomUnclassified: ExpectTrue<
    FailsAt<
      ConformsWithout<
        BotApiRichMessage,
        NonNullable<Message['rich_message']>,
        MapZoomUnclassified
      >,
      'blocks[].zoom'
    >
  >;
  bankCardNumberEntities: ExpectTrue<
    FailsAt<ConformsWithout<BotApiMessageEntity, MessageEntity, BankCardNumberEntities>, 'type'>
  >;
  legacyForwardFields: ExpectTrue<
    FailsAt<
      ConformsWithout<BotApiPinnedPrivateMessage, Message, LegacyForwardFields>,
      'forward_from' | 'forward_sender_name' | 'forward_date'
    >
  >;
  legacyMembershipFields: ExpectTrue<
    FailsAt<
      ConformsWithout<BotApiSupergroupMessage, GrammySupergroupMessage, LegacyMembershipFields>,
      'new_chat_participant' | 'new_chat_member' | 'left_chat_participant'
    >
  >;
  legacySharedUserFields: ExpectTrue<
    FailsAt<
      ConformsWithout<BotApiPrivateMessage, GrammyPrivateMessage, LegacySharedUserFields>,
      'user_shared' | 'users_shared.user_ids'
    >
  >;
  legacyThumbnailField: ExpectTrue<
    FailsAt<
      ConformsWithout<
        BotApiDocument | BotApiVideo | BotApiAudio,
        Document | Video | Audio,
        LegacyThumbnailField
      >,
      'thumb'
    >
  >;
  legacyRightFields: ExpectTrue<
    FailsAt<
      ConformsWithout<
        Exclude<BotApiChatMember, { status: 'creator' | 'member' | 'left' | 'kicked' }>,
        ChatMemberAdministrator | ChatMemberRestricted,
        LegacyRightFields
      >,
      'can_manage_voice_chats' | 'can_send_media_messages'
    >
  >;
  legacyCorrectOptionField: ExpectTrue<
    FailsAt<ConformsWithout<BotApiPoll, Poll, LegacyCorrectOptionField>, 'correct_option_id'>
  >;
  legacyCanSendGiftField: ExpectTrue<
    FailsAt<
      ConformsWithout<BotApiPrivateChatFullInfo, ChatFullInfo.PrivateChat, LegacyCanSendGiftField>,
      'can_send_gift'
    >
  >;
  defaultAdministratorRightsPresenceUnchecked: ExpectTrue<
    FailsAt<
      ConformsWithout<
        BotApiDefaultAdministratorRights,
        ChatAdministratorRights,
        DefaultAdministratorRightsPresenceUnchecked
      >,
      'can_manage_chat'
    >
  >;
}

// ## The checks catch what plain assignability misses

/**
 * Plain assignability would reject the local types for their `readonly` arrays, which serialize
 * like any other, so conformance compares them without `readonly`.
 */
type ReadonlyArraysAreNotAssignable = ExpectTrue<
  IsExactly<[BotApiMessageReactionUpdated] extends [MessageReactionUpdated] ? true : false, false>
>;
type ReadonlyArraysConform = ExpectTrue<
  IsExactly<
    [DeepMutable<BotApiMessageReactionUpdated>] extends [MessageReactionUpdated] ? true : false,
    true
  >
>;

/** A document message whose optional `caption_entities` is misspelled. */
type DocumentMessageWithMisspelledKey = Extract<BotApiPrivateMessage, { document: unknown }> extends
  infer DocumentMessage ? DocumentMessage extends unknown ?
      & Omit<DocumentMessage, 'caption_entities'>
      & { readonly caption_entitys?: readonly BotApiMessageEntity[] }
  : never
  : never;

/** An update whose `message` is misspelled, which grammY's `Update`, all optional, accepts. */
interface UpdateWithMisspelledKey {
  readonly update_id: number;
  readonly mesage: BotApiPrivateMessage;
}

/** A file whose size is text. */
type FileWithIncompatibleValue =
  & Omit<BotApiDownloadableFile, 'file_size'>
  & { readonly file_size: string };

/** An invite link without whether it is revoked, which grammY requires. */
type InviteLinkWithoutRequiredField = Omit<BotApiChatInviteLink, 'is_revoked'>;

interface NegativeCaseFailures {
  misspelledKeyIsUnknown: ExpectTrue<
    IsExactly<
      FailingPaths<ConformsToGrammy<DocumentMessageWithMisspelledKey, GrammyPrivateMessage>>,
      'caption_entitys'
    >
  >;
  misspelledUpdateKeyIsUnknown: ExpectTrue<
    IsExactly<FailingPaths<ConformsToGrammy<UpdateWithMisspelledKey, Update>>, 'mesage'>
  >;
  incompatibleValueIsNotAssignable: ExpectTrue<
    IsExactly<FailingPaths<ConformsToGrammy<FileWithIncompatibleValue, File>>, 'file_size'>
  >;
  missingRequiredFieldIsNotAssignable: ExpectTrue<
    IsExactly<
      FailingPaths<ConformsToGrammy<InviteLinkWithoutRequiredField, ChatInviteLink>>,
      'is_revoked'
    >
  >;
}

interface NegativeCasesFail {
  misspelledKey: ExpectTrue<
    // @ts-expect-error A misspelled optional key is a key grammY's message does not declare.
    ConformsToGrammy<DocumentMessageWithMisspelledKey, GrammyPrivateMessage>
  >;
  misspelledUpdateKey: ExpectTrue<
    // @ts-expect-error A misspelled update key fails even against grammY's all-optional `Update`.
    ConformsToGrammy<UpdateWithMisspelledKey, Update>
  >;
  incompatibleValue: ExpectTrue<
    // @ts-expect-error A value of another type is not assignable to grammY's.
    ConformsToGrammy<FileWithIncompatibleValue, File>
  >;
  missingRequiredField: ExpectTrue<
    // @ts-expect-error A field grammY requires cannot be missing.
    ConformsToGrammy<InviteLinkWithoutRequiredField, ChatInviteLink>
  >;
}
