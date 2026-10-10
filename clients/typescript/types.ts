/**
 * The deployment of the official Bot API server whose upload limits a session's bots meet:
 * `cloud` for the server Telegram hosts at `api.telegram.org`, `local` for a self-hosted server
 * started with `--local`. The profile changes only upload limits; every other behavior stays that
 * of the cloud server.
 */
export type UploadProfile = 'cloud' | 'local';

/** Settings of a new session, which stay fixed for its lifetime. */
export interface CreateSessionInput {
  /** Defaults to `cloud`. */
  readonly upload_profile?: UploadProfile;
}

/** The server-assigned identity, Bot API location, and settings of an emulation session. */
export interface EmulationSession {
  readonly id: string;
  readonly botApiRoot: string;
  readonly uploadProfile: UploadProfile;
}

export interface CreateVirtualBotInput {
  readonly first_name: string;
  /**
   * From 1 to 32 ASCII letters, digits, and underscores, beginning with a letter, without a
   * trailing or doubled underscore, as Telegram's username syntax allows; unique among the
   * session's usernames, compared without case.
   */
  readonly username: string;
  /**
   * Turns off the bot's privacy mode, so that it receives every message of its groups. Defaults to
   * `false`: the bot receives only commands, replies to its messages, and mentions of it.
   */
  readonly can_read_all_group_messages?: boolean;
  /**
   * Turns on inline mode, so that accounts send the bot inline queries. Defaults to `false`, as
   * for a new Telegram bot.
   */
  readonly supports_inline_queries?: boolean;
  /**
   * Turns on inline feedback, so that the bot receives a `chosen_inline_result` update for each
   * result of its inline queries that an account sends. Defaults to `false`.
   */
  readonly receives_chosen_inline_results?: boolean;
  /**
   * Asks accounts to share their location with the bot's inline queries. Defaults to `false`, in
   * which case accounts cannot share it.
   */
  readonly requests_inline_location?: boolean;
  /**
   * Turns on Bot-to-Bot Communication Mode. A bot's supergroup message then reaches another bot
   * it addresses, through a leading command naming that bot or a direct reply to one of that
   * bot's messages, when either of the two bots turned the mode on. Defaults to `false`.
   */
  readonly enables_bot_to_bot_communication?: boolean;
}

export interface VirtualBotProfile {
  readonly id: number;
  readonly is_bot: true;
  readonly first_name: string;
  readonly username: string;
  readonly can_join_groups: boolean;
  readonly can_read_all_group_messages: boolean;
  readonly supports_guest_queries?: boolean;
  readonly supports_inline_queries: boolean;
  readonly can_connect_to_business: boolean;
  readonly has_main_web_app: boolean;
  readonly has_topics_enabled: boolean;
  readonly allows_users_to_create_topics: boolean;
  readonly can_manage_bots: boolean;
  readonly supports_join_request_queries: boolean;
}

export interface CreatedVirtualBot {
  readonly token: string;
  readonly bot: VirtualBotProfile;
}

/**
 * `429 Too Many Requests` answers queued for a bot's next Bot API calls, which receive them
 * instead of running.
 */
export interface RateLimitResponses {
  /** The method whose calls receive the answers, by its current name; omitted for every method. */
  readonly method?: string;
  /** The `retry_after`, in seconds, of every answer. */
  readonly retry_after: number;
  /** How many of the bot's next matching calls still receive an answer. */
  readonly remaining_count: number;
}

/**
 * The HTTP status of a queued server error answer: `500 Internal Server Error` or
 * `503 Service Unavailable`.
 */
export type ServerErrorCode = 500 | 503;

/**
 * Server error answers queued for a bot's next Bot API calls, which receive them instead of
 * running. They are emulator fault injection, not a reproduction of when Telegram fails calls.
 */
export interface ServerErrorResponses {
  /** The method whose calls receive the answers, by its current name; omitted for every method. */
  readonly method?: string;
  /** The HTTP status and `error_code` of every answer. */
  readonly error_code: ServerErrorCode;
  /** How many of the bot's next matching calls still receive an answer. */
  readonly remaining_count: number;
}

/**
 * What a URL of the session's emulated web serves. Telegram downloads the files bots send by URL;
 * the emulator downloads them from these resources and never from the network.
 */
export interface RegisterWebResourceInput {
  /** An HTTP or HTTPS URL, matched as Telegram reads the URL a bot sends. */
  readonly url: string;
  /** The HTTP status, from 200 to 599. Defaults to 200. */
  readonly status?: number;
  /**
   * The `Content-Type` header. Telegram sends a URL photo served as an image, and a URL document
   * served as `application/pdf` or `application/zip`.
   */
  readonly content_type?: string;
  /** The `Location` header of a redirect, relative to `url` or absolute. */
  readonly location?: string;
  /** The response body. Defaults to none. */
  readonly content?: Uint8Array;
}

/** A registered web resource, without the content the test supplied. */
export interface WebResource {
  /** The URL in the canonical form Telegram reads it in. */
  readonly url: string;
  readonly status: number;
  readonly content_type?: string;
  readonly location?: string;
  readonly content_length: number;
}

export interface QueueRateLimitResponsesInput {
  readonly bot_id: number;
  /** An implemented Bot API method, by any name Telegram accepts; omit it for every method. */
  readonly method?: string;
  /** The `retry_after`, in seconds, of every answer; at least 1. */
  readonly retry_after: number;
  /** How many of the bot's next matching calls receive an answer. Defaults to 1. */
  readonly count?: number;
}

export interface QueueServerErrorResponsesInput {
  readonly bot_id: number;
  /** An implemented Bot API method, by any name Telegram accepts; omit it for every method. */
  readonly method?: string;
  /** The HTTP status and `error_code` of every answer. */
  readonly error_code: ServerErrorCode;
  /** How many of the bot's next matching calls receive an answer. Defaults to 1. */
  readonly count?: number;
}

/**
 * Who ends a bot's webhook delivery attempts and retry waits: the emulator by its own timing
 * (`automatic`, the default), or only the test, by expiring attempts and releasing retries
 * (`manual`). These are emulator controls; they do not reproduce Telegram's timing.
 */
export type WebhookScheduling = 'automatic' | 'manual';

/** How a bot's webhook updates are delivered. */
export interface WebhookDelivery {
  /** The scheduling of the attempts that begin from now on. */
  readonly scheduling: WebhookScheduling;
}

export interface SetWebhookDeliveryInput extends WebhookDelivery {
  readonly bot_id: number;
}

/**
 * Why an attempt to deliver an update to a webhook failed. `error_message` is the description
 * `getWebhookInfo` reports as `last_error_message`; Telegram describes no `response_interrupted`.
 */
export type WebhookAttemptFailure =
  | {
    /** The webhook answered with a status other than 2xx. */
    readonly reason: 'http_error';
    readonly status_code: number;
    readonly error_message: string;
  }
  | {
    /** The webhook could not be reached, or did not answer completely before the deadline. */
    readonly reason: 'connection_failed' | 'timed_out';
    readonly error_message: string;
  }
  | {
    /** The connection closed before the whole response arrived. */
    readonly reason: 'response_interrupted';
  };

/** The wait that a failed attempt schedules before its update is sent again. */
export interface WebhookRetry {
  /** The wait, in seconds, that `automatic` scheduling observes; `manual` scheduling ignores it. */
  readonly delay_seconds: number;
  /**
   * `waiting` until the delay passes or the test releases the retry, then `released`; `cancelled`
   * when the webhook was replaced or deleted, or the session ended, during the wait.
   */
  readonly status: 'waiting' | 'released' | 'cancelled';
}

interface WebhookAttemptIdentity {
  /** Identifies the attempt among every attempt of the session; the first is 1. */
  readonly id: number;
  readonly update_id: number;
  /** The scheduling the attempt and its retry follow: the bot's when the attempt began. */
  readonly scheduling: WebhookScheduling;
}

/** One request that delivers an update to a bot's webhook, and its outcome. */
export type WebhookAttempt =
  | WebhookAttemptIdentity & {
    /**
     * `in_flight` while the request runs, `accepted` once the webhook accepted the update, or
     * `cancelled` when delivery stopped before an outcome, which leaves the update pending.
     */
    readonly status: 'in_flight' | 'accepted' | 'cancelled';
  }
  | WebhookAttemptIdentity & {
    readonly status: 'failed';
    readonly failure: WebhookAttemptFailure;
    readonly retry: WebhookRetry;
  };

/** Names one attempt of one bot, which a control applies to. */
export interface WebhookAttemptControlInput {
  readonly botId: number;
  readonly attemptId: number;
}

export interface CreateVirtualAccountInput {
  /** From 1 to 64 characters, as Telegram's servers limit a user's names. */
  readonly first_name: string;
  /** From 1 to 64 characters; omitted for none. */
  readonly last_name?: string;
  /**
   * From 1 to 32 ASCII letters, digits, and underscores, beginning with a letter, without a
   * trailing or doubled underscore, as Telegram's username syntax allows; unique among the
   * session's usernames, compared without case; omitted for none.
   */
  readonly username?: string;
  readonly language_code?: string;
  /**
   * Keeps forwards of the account's messages, and replies to them from other chats, from linking
   * to the account: their origin is a hidden user that shows only its name. Defaults to `false`.
   */
  readonly has_private_forwards?: boolean;
  /**
   * The number the account signed up with, which it shares as its own contact: the digits of an
   * E.164 number without its `+`, such as `15550100`. Omitted for an account that has no contact
   * of its own to share.
   */
  readonly phone_number?: string;
}

export interface VirtualAccountProfile {
  readonly id: number;
  readonly is_bot: false;
  readonly first_name: string;
  readonly last_name?: string;
  readonly username?: string;
  readonly language_code?: string;
}

export interface PrivateMessageTarget {
  readonly type: 'private';
  readonly botId: number;
}

/** A supergroup the account is a member of. */
export interface SupergroupMessageTarget {
  readonly type: 'supergroup';
  readonly chatId: number;
}

/** A chat an account writes to: its private chat with a bot, or a supergroup. */
export type MessageTarget = PrivateMessageTarget | SupergroupMessageTarget;

/** The messages a chat holds: private messages for a private chat, or supergroup messages. */
export type MessageIn<Target extends MessageTarget> = Target extends SupergroupMessageTarget
  ? SupergroupMessage
  : PrivateMessage;

export interface AccountSendMessageInput<Target extends MessageTarget = MessageTarget> {
  readonly to: Target;
  readonly text: string;
  /** Formatting of the text; entity types Telegram detects by itself are ignored. */
  readonly entities?: readonly MessageEntityInput[];
  /** The ID of the chat's message to reply to, as message history shows it. */
  readonly reply_to_message_id?: number;
}

/**
 * A contact the account writes. Its Telegram user stays unknown, as the emulator never looks users
 * up by phone number; `shareOwnContact` shares the account's own contact with its user.
 */
export interface AccountSendContactInput<Target extends MessageTarget = MessageTarget> {
  readonly to: Target;
  readonly contact: {
    /** Nonempty, in any form; Telegram never reads it. */
    readonly phone_number: string;
    /** From 1 to 64 characters. */
    readonly first_name: string;
    /** At most 64 characters; omitted or empty for none. */
    readonly last_name?: string;
    /** At most 2048 bytes in UTF-8, which Telegram never parses; omitted or empty for none. */
    readonly vcard?: string;
  };
  /** The ID of the chat's message to reply to, as message history shows it. */
  readonly reply_to_message_id?: number;
}

/** A static location the account shares; live locations are not supported. */
export interface AccountSendLocationInput<Target extends MessageTarget = MessageTarget> {
  readonly to: Target;
  readonly location: LocationInput;
  /** The ID of the chat's message to reply to, as message history shows it. */
  readonly reply_to_message_id?: number;
}

/** An option of a poll an account creates: its text, of which only custom emoji stay formatted. */
export interface AccountPollOptionInput {
  /** From 1 to 100 characters once trimmed. */
  readonly text: string;
  readonly text_entities?: readonly MessageEntityInput[];
}

/** The question, options, and settings of any poll an account creates. */
interface AccountPollSettingsInput {
  /** From 1 to 255 characters once trimmed; only custom emoji stay formatted. */
  readonly question: string;
  readonly question_entities?: readonly MessageEntityInput[];
  /** From 1 to 12 options, in the order clients show them. */
  readonly options: readonly AccountPollOptionInput[];
  /** Hides who voted for what; `true` when omitted. */
  readonly is_anonymous?: boolean;
  /** Lets a voter choose several options; `false` when omitted. */
  readonly allows_multiple_answers?: boolean;
  /**
   * Lets a voter change or retract its answer; when omitted, `true` for a regular poll and
   * `false` for a quiz.
   */
  readonly allows_revoting?: boolean;
}

/**
 * A poll an account creates, which it sends open and without a closing time: a regular poll, or a
 * quiz with its correct options and an optional explanation.
 */
export type AccountPollInput =
  | (AccountPollSettingsInput & { readonly type?: 'regular' })
  | (AccountPollSettingsInput & {
    readonly type: 'quiz';
    /** The positions of the correct options, counted from 0, in increasing order; at least one. */
    readonly correct_option_ids: readonly number[];
    /** At most 200 characters and 2 line feeds; omitted for none. */
    readonly explanation?: string;
    readonly explanation_entities?: readonly MessageEntityInput[];
  });

export interface AccountSendPollInput<Target extends MessageTarget = MessageTarget> {
  readonly to: Target;
  readonly poll: AccountPollInput;
  /** The ID of the chat's message to reply to, as message history shows it. */
  readonly reply_to_message_id?: number;
}

export interface AccountShareOwnContactInput<Target extends MessageTarget = MessageTarget> {
  readonly to: Target;
  /** The ID of the chat's message to reply to, as message history shows it. */
  readonly reply_to_message_id?: number;
}

export interface AccountSendPhotoInput<Target extends MessageTarget = MessageTarget> {
  readonly to: Target;
  /** A JPEG, PNG, GIF, WebP, or BMP image of at most 10 × 1024 × 1024 bytes. */
  readonly photo: Uint8Array;
  /** Omitted or empty for no caption. */
  readonly caption?: string;
  /** Formatting of the caption; entity types Telegram detects by itself are ignored. */
  readonly caption_entities?: readonly MessageEntityInput[];
  /** The ID of the chat's message to reply to, as message history shows it. */
  readonly reply_to_message_id?: number;
}

export interface AccountSendDocumentInput<Target extends MessageTarget = MessageTarget> {
  readonly to: Target;
  readonly document: Uint8Array;
  /** The file name, whose extension decides the document's MIME type. */
  readonly file_name: string;
  /** Omitted or empty for no caption. */
  readonly caption?: string;
  /** Formatting of the caption; entity types Telegram detects by itself are ignored. */
  readonly caption_entities?: readonly MessageEntityInput[];
  /** The ID of the chat's message to reply to, as message history shows it. */
  readonly reply_to_message_id?: number;
}

export interface AccountSendVideoInput<Target extends MessageTarget = MessageTarget> {
  readonly to: Target;
  /** The video's content, which the emulator neither inspects nor transcodes. */
  readonly video: Uint8Array;
  /**
   * The file name, whose extension decides the video's MIME type when it names a `video/` type;
   * otherwise, and without a name, the video is `video/mp4`.
   */
  readonly file_name?: string;
  /** In seconds, from 0, the default, to 86400. */
  readonly duration?: number;
  /** In pixels, from 0, the default, to 10000. */
  readonly width?: number;
  /** In pixels, from 0, the default, to 10000. */
  readonly height?: number;
  /** Omitted or empty for no caption. */
  readonly caption?: string;
  /** Formatting of the caption; entity types Telegram detects by itself are ignored. */
  readonly caption_entities?: readonly MessageEntityInput[];
  /** The ID of the chat's message to reply to, as message history shows it. */
  readonly reply_to_message_id?: number;
}

export interface AccountSendVoiceInput<Target extends MessageTarget = MessageTarget> {
  readonly to: Target;
  /**
   * The recording, which the emulator neither inspects nor transcodes and sends as `audio/ogg`,
   * as Telegram's clients record voice notes.
   */
  readonly voice: Uint8Array;
  /** In seconds, from 0, the default, to 86400. */
  readonly duration?: number;
  /** Omitted or empty for no caption. */
  readonly caption?: string;
  /** Formatting of the caption; entity types Telegram detects by itself are ignored. */
  readonly caption_entities?: readonly MessageEntityInput[];
  /** The ID of the chat's message to reply to, as message history shows it. */
  readonly reply_to_message_id?: number;
}

export interface AccountSendAudioInput<Target extends MessageTarget = MessageTarget> {
  readonly to: Target;
  /**
   * The audio file's content, such as a music track, which the emulator neither inspects nor
   * transcodes, and from which it reads no tags.
   */
  readonly audio: Uint8Array;
  /**
   * The file name, whose extension decides the audio file's MIME type when it names an `audio/`
   * type; otherwise, and without a name, the audio file is `audio/mpeg`.
   */
  readonly file_name?: string;
  /** In seconds, from 0, the default, to 86400. */
  readonly duration?: number;
  /** Omitted or empty for none. */
  readonly performer?: string;
  /** Omitted or empty for none. */
  readonly title?: string;
  /** Omitted or empty for no caption. */
  readonly caption?: string;
  /** Formatting of the caption; entity types Telegram detects by itself are ignored. */
  readonly caption_entities?: readonly MessageEntityInput[];
  /** The ID of the chat's message to reply to, as message history shows it. */
  readonly reply_to_message_id?: number;
}

/** The fields that name the file of each kind of media of an album an account sends. */
interface AccountMediaGroupFileFields {
  readonly photo: {
    /** As `AccountSendPhotoInput` describes it. */
    readonly photo: Uint8Array;
  };
  readonly document: {
    readonly document: Uint8Array;
    /** The file name, whose extension decides the document's MIME type. */
    readonly file_name: string;
  };
  readonly video: Pick<
    AccountSendVideoInput,
    'video' | 'file_name' | 'duration' | 'width' | 'height'
  >;
  readonly audio: Pick<
    AccountSendAudioInput,
    'audio' | 'file_name' | 'duration' | 'performer' | 'title'
  >;
}

/**
 * A photo, video, document, or audio file of an album an account sends, with an optional caption.
 */
export type AccountMediaGroupItem =
  & ExclusiveAlternatives<AccountMediaGroupFileFields>
  & {
    /** Omitted or empty for no caption. */
    readonly caption?: string;
    /** Formatting of the caption; entity types Telegram detects by itself are ignored. */
    readonly caption_entities?: readonly MessageEntityInput[];
  };

export interface AccountSendMediaGroupInput<Target extends MessageTarget = MessageTarget> {
  readonly to: Target;
  /**
   * The album's photos and videos, documents, or audio files, in the order the chat shows them: at
   * most 10, documents only among documents, and audio files only among audio files. A single item is sent as a message outside any album.
   */
  readonly media: readonly AccountMediaGroupItem[];
  /** The ID of the chat's message that every message of the album replies to. */
  readonly reply_to_message_id?: number;
}

export interface AccountForwardMessageInput<Target extends MessageTarget = MessageTarget> {
  /** The chat of the message to forward. */
  readonly from: MessageTarget;
  /** The ID of the message to forward, as message history shows it. */
  readonly message_id: number;
  readonly to: Target;
}

export interface CreateSupergroupInput {
  readonly title: string;
  /**
   * Makes the supergroup public under this username, unique among the session's usernames, so
   * that bots can address it as `@username`; omitted for a private supergroup. It has the syntax
   * of a bot's or account's username.
   */
  readonly username?: string;
  readonly description?: string;
}

/** A supergroup as its creator sees it once created. */
export interface Supergroup {
  /** The Bot API `chat_id` of the supergroup, a negative number. */
  readonly id: number;
  readonly type: 'supergroup';
  readonly title: string;
  /** Omitted for a private supergroup. */
  readonly username?: string;
  readonly description?: string;
}

export interface AddChatMemberInput {
  readonly chat: SupergroupMessageTarget;
  /** The account or bot to add. */
  readonly userId: number;
}

export interface RemoveChatMemberInput {
  readonly chat: SupergroupMessageTarget;
  /** The account or bot to remove. */
  readonly userId: number;
}

export interface LeaveChatInput {
  readonly chat: SupergroupMessageTarget;
}

export interface JoinChatInput {
  /** A public supergroup, which has a username, addressed by its chat ID. */
  readonly chat: SupergroupMessageTarget;
}

export interface JoinChatByInviteLinkInput {
  /**
   * The whole link, as the bot that created it received it from `createChatInviteLink`,
   * `exportChatInviteLink` or `getChat`.
   */
  readonly inviteLink: string;
}

/** What an account's use of an invite link did. */
export interface ChatJoin {
  /** The Bot API `chat_id` of the supergroup the link leads to. */
  readonly chat_id: number;
  /**
   * `joined` when the account joined the supergroup; `join_request_sent` when the link creates
   * join requests, which leaves the account outside until an administrator decides.
   */
  readonly outcome: 'joined' | 'join_request_sent';
}

export interface AccountChatJoinRequestsInput {
  readonly chat: SupergroupMessageTarget;
}

/** A pending request to join a supergroup, which an administrator account approves or declines. */
export interface AccountChatJoinRequestDecisionInput {
  readonly chat: SupergroupMessageTarget;
  /** The account whose pending request is decided. */
  readonly userId: number;
}

/** A pending request to join a supergroup, as its owner inspects it. */
export interface ChatJoinRequest {
  /** The account that wants to join. */
  readonly user_id: number;
  /** The whole invite link the request was sent through. */
  readonly invite_link: string;
  /** When the request was sent, as a Unix time in seconds. */
  readonly date: number;
  /** Which bots may write to the user before it starts a private chat with them. */
  readonly requester_contact: JoinRequesterContact;
}

/**
 * The temporary permission to write to a join request's user that the Bot API documents for
 * `user_chat_id`. It ends with the request; the emulator never lets its five minutes pass by
 * themselves, so `session.expireJoinRequesterContact` ends it.
 */
export interface JoinRequesterContact {
  /**
   * `open` while every bot that received the request may write; `claimed` once one of them wrote,
   * after which only that bot may; `expired` once `session.expireJoinRequesterContact` ended it.
   */
  readonly status: 'open' | 'claimed' | 'expired';
  /**
   * The bots that may write to the user now: while open, the bots that received the request, and
   * once claimed, the bot that claimed it, as long as they hold `can_invite_users`.
   */
  readonly bot_ids: readonly number[];
}

export interface ExpireJoinRequesterContactInput {
  /** The supergroup's chat ID. */
  readonly chatId: number;
  /** The account whose pending request's contact window ends. */
  readonly userId: number;
}

export interface AccountChatInviteLinksInput {
  readonly chat: SupergroupMessageTarget;
}

/** An invite link of a supergroup, as its owner inspects it. */
export interface SupergroupInviteLink {
  /** The whole link, `https://t.me/+` and its hash. */
  readonly invite_link: string;
  /** Omitted for none. */
  readonly name?: string;
  /** The administrator bot that created the link. */
  readonly creator_user_id: number;
  /** When the link stops working, as a Unix time in seconds; omitted for no expiry date. */
  readonly expire_date?: number;
  /** How many users that joined through the link may be members at once; omitted for no limit. */
  readonly member_limit?: number;
  /** How many members joined through the link and still are, which its member limit counts. */
  readonly member_count: number;
  /** How many pending join requests were sent through the link. */
  readonly pending_join_request_count: number;
  /** Whether users who use the link send a join request instead of joining. */
  readonly creates_join_request: boolean;
  /**
   * Whether the link is its creator's primary link, from `exportChatInviteLink` or the
   * replacement that revoking the previous one created, rather than an additional link.
   */
  readonly is_primary: boolean;
  /**
   * Whether `session.expireChatInviteLink` made the link's current expiry date arrive; an edit
   * that gives the link another expiry date, or none, makes it false again.
   */
  readonly is_expired: boolean;
  /**
   * Whether the bot that created the link revoked it, for good: with `revokeChatInviteLink`, or,
   * for a primary link, by exporting a new one with `exportChatInviteLink`.
   */
  readonly is_revoked: boolean;
}

export interface ExpireChatInviteLinkInput {
  /** The supergroup's chat ID. */
  readonly chatId: number;
  /** The whole link, as `createChatInviteLink` returned it. */
  readonly inviteLink: string;
}

/**
 * A supergroup administrator right, by the Bot API's name. Any right includes `can_manage_chat`,
 * as on Telegram.
 */
export type SupergroupAdministratorRight =
  | 'can_manage_chat'
  | 'can_change_info'
  | 'can_delete_messages'
  | 'can_invite_users'
  | 'can_restrict_members'
  | 'can_pin_messages'
  | 'can_manage_topics'
  | 'can_promote_members'
  | 'can_manage_video_chats'
  | 'can_post_stories'
  | 'can_edit_stories'
  | 'can_delete_stories'
  | 'can_manage_tags'
  | 'can_send_welcome_messages';

export interface PromoteChatMemberInput {
  readonly chat: SupergroupMessageTarget;
  /** The member, account or bot, to promote. */
  readonly userId: number;
  /** The rights the administrator holds from now on; a right set to `true` is held. */
  readonly rights: Readonly<Partial<Record<SupergroupAdministratorRight, boolean>>>;
}

export interface AccountChatAdministratorsInput {
  readonly chat: SupergroupMessageTarget;
}

/** The owner or an administrator of a supergroup, as a member account inspects it. */
export type SupergroupAdministrator =
  | {
    readonly user_id: number;
    readonly status: 'owner';
    readonly custom_title?: string;
  }
  | {
    readonly user_id: number;
    readonly status: 'administrator';
    /** Every supergroup right, held or not. */
    readonly rights: Readonly<Record<SupergroupAdministratorRight, boolean>>;
    readonly custom_title?: string;
    /**
     * The owner or administrator that last set the administrator's rights, even once that
     * promoter's tenure has ended.
     */
    readonly promoted_by_user_id: number;
    /**
     * Whether this account may change the administrator's rights or demote it: it owns the
     * supergroup, or it holds `can_promote_members` and promoted the administrator, directly or
     * through administrators it promoted, during administrator tenures that still last. No
     * account may edit itself.
     */
    readonly can_be_edited: boolean;
  };

export interface DemoteChatMemberInput {
  readonly chat: SupergroupMessageTarget;
  /** The administrator, account or bot, to demote. */
  readonly userId: number;
}

/**
 * A permission a supergroup grants its members, by the Bot API's `ChatPermissions` name.
 * `can_send_media_messages`, which the Bot API derives from the media permissions, is none.
 */
export type ChatPermission =
  | 'can_send_messages'
  | 'can_send_audios'
  | 'can_send_documents'
  | 'can_send_photos'
  | 'can_send_videos'
  | 'can_send_video_notes'
  | 'can_send_voice_notes'
  | 'can_send_polls'
  | 'can_send_other_messages'
  | 'can_add_web_page_previews'
  | 'can_react_to_messages'
  | 'can_edit_tag'
  | 'can_change_info'
  | 'can_invite_users'
  | 'can_pin_messages'
  | 'can_manage_topics';

export interface RestrictChatMemberInput {
  readonly chat: SupergroupMessageTarget;
  /** The account or bot to restrict, whether it is a member or not. */
  readonly userId: number;
  /**
   * The permissions the user keeps; a permission set to `true` is kept, and, unlike in the Bot
   * API, none implies another. Keeping every permission lifts the restriction.
   */
  readonly permissions: Readonly<Partial<Record<ChatPermission, boolean>>>;
  /**
   * When the restriction ends, as a Unix time in seconds; omitted, or less than 30 seconds or more
   * than 366 days away, for one that lasts until it is lifted. The emulator never lifts it as time
   * passes: `session.expireChatMemberRestriction` makes its end arrive.
   */
  readonly untilDate?: number;
}

export interface LiftChatMemberRestrictionInput {
  readonly chat: SupergroupMessageTarget;
  /** The restricted account or bot. */
  readonly userId: number;
}

export interface SetChatPermissionsInput {
  readonly chat: SupergroupMessageTarget;
  /**
   * What members may do by default; a permission set to `true` is granted, and, unlike in the Bot
   * API, none implies another.
   */
  readonly permissions: Readonly<Partial<Record<ChatPermission, boolean>>>;
}

export interface ExpireChatMemberRestrictionInput {
  /** The supergroup's chat ID. */
  readonly chatId: number;
  /** The account or bot whose temporary restriction ends. */
  readonly userId: number;
}

export interface SetContentProtectionInput {
  readonly chat: SupergroupMessageTarget;
  readonly hasProtectedContent: boolean;
}

export interface ChangeSupergroupTitleInput {
  readonly chat: SupergroupMessageTarget;
  /** The new title, which Telegram cleans; one that cleans to nothing is refused. */
  readonly title: string;
}

export interface ChangeSupergroupDescriptionInput {
  readonly chat: SupergroupMessageTarget;
  /** The new description, which Telegram cleans; empty removes it. */
  readonly description: string;
}

export interface SetCustomTitleInput {
  readonly chat: SupergroupMessageTarget;
  /** The owner itself or an administrator, account or bot. */
  readonly userId: number;
  /** At most 16 characters without emoji; empty removes the title. */
  readonly customTitle: string;
}

export interface AccountEditMessageInput<Target extends MessageTarget = MessageTarget> {
  readonly chat: Target;
  /** The ID of the account's message to edit, as message history shows it. */
  readonly message_id: number;
  /** The new text, which must differ from the message's current text. */
  readonly text: string;
  /** Formatting of the new text; entity types Telegram detects by itself are ignored. */
  readonly entities?: readonly MessageEntityInput[];
}

export interface AccountDeleteMessageInput {
  readonly chat: MessageTarget;
  /** The ID of the message to delete, as message history shows it. */
  readonly message_id: number;
}

export interface AccountEditMessageCaptionInput<Target extends MessageTarget = MessageTarget> {
  readonly chat: Target;
  /** The ID of the account's captioned media to edit, as message history shows it. */
  readonly message_id: number;
  /** The new caption, which must differ from the current one; empty removes the caption. */
  readonly caption: string;
  /** Formatting of the new caption; entity types Telegram detects by itself are ignored. */
  readonly caption_entities?: readonly MessageEntityInput[];
}

export interface BotBlockInput {
  readonly botId: number;
}

export interface AccountMessageHistoryInput<Target extends MessageTarget = MessageTarget> {
  readonly chat: Target;
}

export interface AccountPinMessageInput {
  readonly chat: MessageTarget;
  /** The ID of the message to pin or unpin, as message history shows it. */
  readonly message_id: number;
}

export interface AccountPinnedMessagesInput<Target extends MessageTarget = MessageTarget> {
  readonly chat: Target;
}

export interface PressCallbackButtonInput {
  readonly chat: MessageTarget;
  /** The ID of the message carrying the button, as message history shows it. */
  readonly message_id: number;
  /** The callback data of the button to press, in the inline keyboard or the rich message. */
  readonly callback_data: string;
  /**
   * Creates the query already expired: the bot still receives it but cannot answer it, as when a
   * bot that was offline catches up on queries whose answer deadline has passed.
   */
  readonly expired?: boolean;
}

/** A message showing a poll, in a chat of the account. */
export interface AccountPollMessageInput<Target extends MessageTarget = MessageTarget> {
  readonly chat: Target;
  /** The ID of the message showing the poll, as message history shows it. */
  readonly message_id: number;
}

export interface AnswerPollInput<Target extends MessageTarget = MessageTarget>
  extends AccountPollMessageInput<Target> {
  /**
   * The chosen options' positions, counted from 0, as `option_ids` of the Bot API's `PollAnswer`
   * numbers them; at least one, and a repeated position counts once.
   */
  readonly option_ids: readonly number[];
}

/** The options an account chose in a poll; both lists are empty while it has no answer. */
export interface PollAnswer {
  readonly poll_id: string;
  /** The chosen options' positions, counted from 0, in increasing order. */
  readonly option_ids: readonly number[];
  /** The chosen options' `persistent_id`, in the same order. */
  readonly option_persistent_ids: readonly string[];
}

/** An account's answer to a poll, with the message showing the poll as the chat's history does. */
export interface AccountPollAnswer<Target extends MessageTarget = MessageTarget> {
  readonly poll_answer: PollAnswer;
  readonly message: MessageIn<Target>;
}

/**
 * An ordinary emoji reaction, as the Bot API's `ReactionTypeEmoji` shows it. The emoji must be one
 * the Bot API lists for it, written exactly as listed: for example `❤` without the variation
 * selector U+FE0F.
 */
export interface ReactionTypeEmoji {
  readonly type: 'emoji';
  readonly emoji: string;
}

/** A message of a supergroup this account is a member of. */
export interface AccountReactionMessageInput {
  readonly chat: SupergroupMessageTarget;
  /** The ID of the message, as message history shows it. */
  readonly message_id: number;
}

export interface SetMessageReactionInput extends AccountReactionMessageInput {
  /** The reactions to choose, which replace this account's earlier ones; exactly one. */
  readonly reaction: readonly ReactionTypeEmoji[];
}

/** The reactions one member, an account or a bot, chose for a message. */
export interface UserReaction {
  readonly user_id: number;
  /** The member's reactions; one, as members choose one reaction per message. */
  readonly reaction: readonly ReactionTypeEmoji[];
}

/** The reactions to a supergroup message, with the message that holds them. */
export interface MessageReactions {
  /**
   * The message that holds the reactions, as message history shows it: for a message of an album,
   * the album's first message that is not deleted.
   */
  readonly message: SupergroupMessage;
  /** One entry per reacting member, in the order they last changed their reactions. */
  readonly reactions: readonly UserReaction[];
}

export interface PressButtonInput {
  readonly chat: MessageTarget;
  /** The ID of the message carrying the button, as message history shows it. */
  readonly message_id: number;
  /** Selects exactly one button of the message, which must be a callback button. */
  readonly button: ButtonSelector;
  /** As for `pressCallbackButton`, creates the query already expired. */
  readonly expired?: boolean;
}

/** The parts of a message that show buttons: its rich message and its inline keyboard. */
export interface MessageWithButtons {
  readonly rich_message?: RichMessage;
  readonly reply_markup?: InlineKeyboardMarkup;
}

/**
 * A button of a message as the account's client shows it: a button of the rich message, in a row
 * or in text, or of the inline keyboard below it.
 */
export interface MessageButton {
  /** The button's text as plain text, with custom emoji shown by their alternative text. */
  readonly label: string;
  readonly button: InlineKeyboardButton | RichMessageButton;
  /** Where the button is in the message, such as `reply_markup.inline_keyboard[0][1]`. */
  readonly path: string;
  /** The parts of the message that enclose the button, outermost first. */
  readonly containers: readonly ButtonContainer[];
}

/** A block of a rich message that encloses a button. */
export interface RichBlockButtonContainer {
  readonly kind: 'block';
  readonly block: RichBlock;
  /** The block list that holds the block, which gives its neighbors. */
  readonly siblingBlocks: readonly RichBlock[];
  /** The block's index in `siblingBlocks`. */
  readonly index: number;
  /** Everything the block shows as plain text, including button labels. */
  readonly text: string;
  readonly path: string;
}

/** A list item, table row, or inline keyboard row that encloses a button. */
export interface ButtonRowContainer {
  readonly kind: 'list_item' | 'table_row' | 'inline_keyboard_row';
  /** Everything the item or row shows as plain text, including button labels. */
  readonly text: string;
  readonly path: string;
}

export type ButtonContainer = RichBlockButtonContainer | ButtonRowContainer;

/**
 * Selects a button by its label, optionally within a part of the message. `within` names the
 * innermost parts whose text contains the string or matches the pattern, so that `within: 'Potion'`
 * selects the table row that mentions Potion rather than the whole table.
 */
export interface ButtonLabelSelector {
  /** The whole label, or a pattern the label matches. */
  readonly label: string | RegExp;
  readonly within?: string | RegExp;
}

/** A label selector, or a predicate that inspects each button's label, path, and containers. */
export type ButtonSelector = ButtonLabelSelector | ((button: MessageButton) => boolean);

export interface PrivateChat {
  readonly id: number;
  readonly type: 'private';
  readonly first_name: string;
  readonly last_name?: string;
  readonly username?: string;
}

export interface SupergroupChat {
  readonly id: number;
  readonly title: string;
  /** Omitted for a private supergroup. */
  readonly username?: string;
  readonly type: 'supergroup';
}

/** Offsets and lengths count UTF-16 code units. */
interface MessageEntitySpan {
  readonly offset: number;
  readonly length: number;
}

/**
 * Entity types that carry nothing beyond their span. Telegram detects mentions, hashtags,
 * cashtags, bot commands, URLs, email addresses and bank card numbers in text by itself.
 */
export type PlainMessageEntityType =
  | 'mention'
  | 'hashtag'
  | 'cashtag'
  | 'bot_command'
  | 'url'
  | 'email'
  | 'bank_card_number'
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strikethrough'
  | 'spoiler'
  | 'code'
  | 'blockquote'
  | 'expandable_blockquote';

/** An entity Telegram detected in a message's text, or formatting its sender applied. */
export type MessageEntity =
  | (MessageEntitySpan & { readonly type: PlainMessageEntityType })
  | (MessageEntitySpan & { readonly type: 'pre'; readonly language?: string })
  | (MessageEntitySpan & { readonly type: 'text_link'; readonly url: string })
  | (MessageEntitySpan & {
    readonly type: 'text_mention';
    readonly user: VirtualAccountProfile | MessageSenderBot;
  })
  | (MessageEntitySpan & { readonly type: 'custom_emoji'; readonly custom_emoji_id: string })
  | (MessageEntitySpan & {
    readonly type: 'date_time';
    readonly unix_time: number;
    /**
     * `r` for relative time, otherwise `w` for the day of the week, `d` or `D` for a short or
     * long date, then `t` or `T` for a short or long time; empty when the bot chose no format.
     */
    readonly date_time_format: string;
  });

/**
 * Formatting an account applies to its text or caption, as bots specify it; a text mention names
 * its user by ID alone. Entities of received messages can be sent back as they are.
 */
export type MessageEntityInput =
  | Exclude<MessageEntity, { readonly type: 'text_mention' }>
  | (MessageEntitySpan & { readonly type: 'text_mention'; readonly user: { readonly id: number } });

/** A bot as a message sender, without the capabilities that only getMe reports. */
export interface MessageSenderBot {
  readonly id: number;
  readonly is_bot: true;
  readonly first_name: string;
  readonly last_name?: string;
  readonly username: string;
}

/** A button's text and how Telegram clients draw it. */
export interface KeyboardButtonFace {
  readonly text: string;
  /** The custom emoji shown before the text; omitted for none. */
  readonly icon_custom_emoji_id?: string;
  /** Omitted for the client's default style. */
  readonly style?: 'primary' | 'danger' | 'success';
}

export interface CallbackInlineKeyboardButton extends KeyboardButtonFace {
  readonly callback_data: string;
}

/** A button that opens a link, including a login button, which the emulator shows by its URL. */
export interface UrlInlineKeyboardButton extends KeyboardButtonFace {
  readonly url: string;
}

/** A button that copies text to the clipboard. */
export interface CopyTextInlineKeyboardButton extends KeyboardButtonFace {
  readonly copy_text: { readonly text: string };
}

/**
 * A button that puts the bot's username and a query into the input field of a chat the user
 * chooses; tests send the inline query itself.
 */
export interface SwitchInlineQueryInlineKeyboardButton extends KeyboardButtonFace {
  readonly switch_inline_query: string;
}

/** A button that puts the bot's username and a query into the message's own chat. */
export interface SwitchInlineQueryCurrentChatInlineKeyboardButton extends KeyboardButtonFace {
  readonly switch_inline_query_current_chat: string;
}

/** A switch-inline button that lets the user choose only some kinds of chats. */
export interface SwitchInlineQueryChosenChatInlineKeyboardButton extends KeyboardButtonFace {
  readonly switch_inline_query_chosen_chat: {
    readonly query: string;
    readonly allow_user_chats: boolean;
    readonly allow_bot_chats: boolean;
    readonly allow_group_chats: boolean;
    readonly allow_channel_chats: boolean;
  };
}

/** A button that opens a Web App of the message's bot. */
export interface WebAppInlineKeyboardButton extends KeyboardButtonFace {
  readonly web_app: { readonly url: string };
}

/** A button that does nothing. */
export interface DisabledInlineKeyboardButton extends KeyboardButtonFace {
  readonly disabled: Record<string, never>;
}

export type InlineKeyboardButton =
  | CallbackInlineKeyboardButton
  | UrlInlineKeyboardButton
  | CopyTextInlineKeyboardButton
  | SwitchInlineQueryInlineKeyboardButton
  | SwitchInlineQueryCurrentChatInlineKeyboardButton
  | SwitchInlineQueryChosenChatInlineKeyboardButton
  | WebAppInlineKeyboardButton
  | DisabledInlineKeyboardButton;

export interface InlineKeyboardMarkup {
  readonly inline_keyboard: readonly (readonly InlineKeyboardButton[])[];
}

/** A file of a message: a photo size, a document, a video, a voice note, or an audio file. */
interface MessageFile {
  /**
   * The identifier by which the message's observer knows the file. As on Telegram, each user
   * knows a file by a `file_id` of its own.
   */
  readonly file_id: string;
  /** The same for every user; `downloadFile` reads the file by it. */
  readonly file_unique_id: string;
  readonly file_size: number;
}

/** A photo in one size. The emulator keeps a photo in the one size it was sent in. */
export interface PhotoSize extends MessageFile {
  readonly width: number;
  readonly height: number;
}

export interface Document extends MessageFile {
  readonly file_name: string;
  readonly mime_type: string;
  /** The preview image the sender uploaded with the document; omitted for none. */
  readonly thumbnail?: PhotoSize;
  /** Legacy copy of `thumbnail`, which the Bot API still shows. */
  readonly thumb?: PhotoSize;
}

/** A video, whose duration and dimensions are those its sender defined. */
export interface Video extends MessageFile {
  /** In seconds. */
  readonly duration: number;
  readonly width: number;
  readonly height: number;
  /** Omitted for a video sent without a file name. */
  readonly file_name?: string;
  readonly mime_type: string;
  /** The second from which clients play the video in its message; omitted for its beginning. */
  readonly start_timestamp?: number;
  /** The preview image the sender uploaded with the video; omitted for none. */
  readonly thumbnail?: PhotoSize;
  /** Legacy copy of `thumbnail`, which the Bot API still shows. */
  readonly thumb?: PhotoSize;
}

/** A phone contact, as its sender wrote it. */
export interface Contact {
  readonly phone_number: string;
  readonly first_name: string;
  /** Omitted for a contact without a last name. */
  readonly last_name?: string;
  /** Omitted for a contact without a vCard. */
  readonly vcard?: string;
  /** The contact's Telegram user, known only when an account shares its own contact. */
  readonly user_id?: number;
}

/** A voice note, whose duration is the one its sender defined. */
export interface Voice extends MessageFile {
  /** In seconds. */
  readonly duration: number;
  /** `audio/ogg`, `audio/mpeg`, or `audio/mp4`. */
  readonly mime_type: string;
}

/**
 * An audio file, such as a music track, whose duration, performer and title are those its sender
 * defined.
 */
export interface Audio extends MessageFile {
  /** In seconds. */
  readonly duration: number;
  /** Omitted for an audio file sent without a file name. */
  readonly file_name?: string;
  /** Always an `audio/` type. */
  readonly mime_type: string;
  /** Omitted for an audio file without a title. */
  readonly title?: string;
  /** Omitted for an audio file without a performer. */
  readonly performer?: string;
  /**
   * The preview image the sender uploaded with the audio file, such as its album's cover; omitted
   * for none.
   */
  readonly thumbnail?: PhotoSize;
  /** Legacy copy of `thumbnail`, which the Bot API still shows. */
  readonly thumb?: PhotoSize;
}

/**
 * Text of a rich message: plain text as a string, texts one after another as an array, or an
 * object of a type.
 */
export type RichText = string | readonly RichText[] | RichTextObject;

/** Rich text of a type, as the Bot API's `RichText` shows it. */
export type RichTextObject =
  | {
    readonly type:
      | 'bold'
      | 'italic'
      | 'underline'
      | 'strikethrough'
      | 'spoiler'
      | 'subscript'
      | 'superscript'
      | 'marked'
      | 'code';
    readonly text: RichText;
  }
  | {
    readonly type: 'date_time';
    readonly text: RichText;
    readonly unix_time: number;
    /** As a `date_time` entity's `date_time_format`. */
    readonly date_time_format: string;
  }
  /** Entities Telegram detects in the text, each showing the text it covers. */
  | { readonly type: 'mention'; readonly text: RichText; readonly username: string }
  | { readonly type: 'hashtag'; readonly text: RichText; readonly hashtag: string }
  | { readonly type: 'cashtag'; readonly text: RichText; readonly cashtag: string }
  | { readonly type: 'bot_command'; readonly text: RichText; readonly bot_command: string }
  | {
    readonly type: 'bank_card_number';
    readonly text: RichText;
    readonly bank_card_number: string;
  }
  | {
    readonly type: 'text_mention';
    readonly text: RichText;
    readonly user: VirtualAccountProfile | MessageSenderBot;
  }
  | { readonly type: 'url'; readonly text: RichText; readonly url: string }
  | { readonly type: 'email_address'; readonly text: RichText; readonly email_address: string }
  | { readonly type: 'phone_number'; readonly text: RichText; readonly phone_number: string }
  | {
    readonly type: 'custom_emoji';
    readonly custom_emoji_id: string;
    readonly alternative_text: string;
  }
  | { readonly type: 'mathematical_expression'; readonly expression: string }
  | { readonly type: 'reference'; readonly text: RichText; readonly name: string }
  | { readonly type: 'reference_link'; readonly text: RichText; readonly reference_name: string }
  | { readonly type: 'anchor'; readonly name: string }
  /** A link to an anchor of the message; an empty name links to its top. */
  | { readonly type: 'anchor_link'; readonly text: RichText; readonly anchor_name: string }
  | { readonly type: 'button'; readonly button: RichMessageButton };

/** Removes properties from each member of a union, which keeps the union's alternatives apart. */
type OmitFromEach<Type, Key extends PropertyKey> = Type extends unknown ? Omit<Type, Key> : never;

/**
 * A button of a rich message, which acts as an inline keyboard button of the same kind. An
 * account presses a callback button by its callback data.
 */
export type RichMessageButton =
  & {
    readonly text: RichText;
    /** Omitted for the client's default style; `link` shows the button as a link. */
    readonly style?: 'primary' | 'danger' | 'success' | 'link';
  }
  & OmitFromEach<InlineKeyboardButton, keyof KeyboardButtonFace>;

export type HorizontalAlignment = 'left' | 'center' | 'right';

/** The caption of a block with media or a map. */
export interface RichBlockCaption {
  readonly text: RichText;
  readonly credit?: RichText;
}

export interface RichBlockListItem {
  /** `•` for an item of an unordered list, otherwise its number as its type shows it. */
  readonly label: string;
  readonly blocks: readonly RichBlock[];
  readonly has_checkbox?: true;
  readonly is_checked?: true;
  /** Present for an item of an ordered list: letters, Roman numerals, or decimal numbers. */
  readonly type?: 'a' | 'A' | 'i' | 'I' | '1';
  readonly value?: number;
}

export interface RichBlockTableCell {
  /** Omitted for an invisible cell. */
  readonly text?: RichText;
  readonly is_header?: true;
  /** Omitted for a cell that spans one column. */
  readonly colspan?: number;
  /** Omitted for a cell that spans one row. */
  readonly rowspan?: number;
  readonly align: HorizontalAlignment;
  readonly valign: 'top' | 'middle' | 'bottom';
}

/** A block of a rich message, as the Bot API's `RichBlock` shows it. */
export type RichBlock =
  | { readonly type: 'paragraph' | 'footer'; readonly text: RichText }
  | { readonly type: 'heading'; readonly text: RichText; readonly size: number }
  | { readonly type: 'pre'; readonly text: RichText; readonly language?: string }
  | { readonly type: 'divider' }
  | { readonly type: 'mathematical_expression'; readonly expression: string }
  | { readonly type: 'anchor'; readonly name: string }
  | { readonly type: 'list'; readonly items: readonly RichBlockListItem[] }
  | {
    readonly type: 'blockquote';
    readonly blocks: readonly RichBlock[];
    readonly credit?: RichText;
  }
  | {
    readonly type: 'expandable_blockquote' | 'pullquote';
    readonly text: RichText;
    readonly credit?: RichText;
  }
  | {
    readonly type: 'collage' | 'slideshow';
    readonly blocks: readonly RichBlock[];
    readonly caption?: RichBlockCaption;
  }
  | {
    readonly type: 'table';
    readonly cells: readonly (readonly RichBlockTableCell[])[];
    readonly caption?: RichText;
    readonly is_bordered?: true;
    readonly is_striped?: true;
    readonly is_compact?: true;
  }
  | {
    readonly type: 'details';
    readonly summary: RichText;
    readonly blocks: readonly RichBlock[];
    readonly is_open?: true;
  }
  | {
    readonly type: 'map';
    readonly location: Location;
    readonly zoom: number;
    /** 0, as is the height, when the bot chose no dimensions. */
    readonly width: number;
    readonly height: number;
    readonly caption?: RichBlockCaption;
  }
  | {
    readonly type: 'buttons';
    readonly buttons: readonly RichMessageButton[];
    readonly align?: HorizontalAlignment;
  }
  | {
    readonly type: 'photo';
    readonly photo: readonly PhotoSize[];
    readonly caption?: RichBlockCaption;
    readonly has_spoiler?: true;
  }
  | { readonly type: 'document'; readonly document: Document; readonly caption?: RichBlockCaption }
  | {
    readonly type: 'video';
    /** The video; a block keeps no start, so it never shows a `start_timestamp`. */
    readonly video: Omit<Video, 'start_timestamp'>;
    readonly caption?: RichBlockCaption;
    readonly has_spoiler?: true;
  }
  | {
    readonly type: 'voice_note';
    readonly voice_note: Voice;
    readonly caption?: RichBlockCaption;
  };

/** A message a bot laid out in blocks. */
export interface RichMessage {
  readonly blocks: readonly RichBlock[];
  /** Present when clients show the message right-to-left. */
  readonly is_rtl?: true;
}

/** An answer option of a poll, with how many accounts chose it. */
export interface PollOption {
  /** The option's identifier, which stays the same however options change. */
  readonly persistent_id: string;
  readonly text: string;
  /** Present when the text has custom emoji, its only entities. */
  readonly text_entities?: readonly MessageEntity[];
  readonly voter_count: number;
}

/** A regular poll or a quiz a bot sent, with its votes as they are now. */
export interface Poll {
  readonly id: string;
  readonly question: string;
  /** Present when the question has custom emoji, its only entities. */
  readonly question_entities?: readonly MessageEntity[];
  readonly options: readonly PollOption[];
  /** How many accounts chose any option. */
  readonly total_voter_count: number;
  /**
   * How long the poll was set to stay open after it was sent, in seconds; present, with
   * `close_date`, only while a poll sent with a closing time is open. The emulator does not close
   * polls as time passes: `session.expirePoll` makes the closing time arrive.
   */
  readonly open_period?: number;
  /** When the poll is set to close, as a Unix time in seconds; present only with `open_period`. */
  readonly close_date?: number;
  readonly is_closed: boolean;
  readonly is_anonymous: boolean;
  readonly allows_multiple_answers: boolean;
  readonly allows_revoting: boolean;
  /** The emulator's polls never restrict who may vote. */
  readonly members_only: false;
  readonly type: 'regular' | 'quiz';
  /**
   * The correct option of a quiz with one, shown to its bot, to accounts that answered, and to
   * everyone once it is closed.
   */
  readonly correct_option_id?: number;
  /** The correct options of a quiz, shown as `correct_option_id` is. */
  readonly correct_option_ids?: readonly number[];
  /** A quiz's explanation, shown as `correct_option_id` is; absent without one. */
  readonly explanation?: string;
  /** Present with the explanation, empty when it has no entities. */
  readonly explanation_entities?: readonly MessageEntity[];
}

/**
 * Declares fields absent, so that reading them from a value that cannot have them is typed as
 * `undefined`.
 */
type AbsentFields<FieldName extends PropertyKey> = { readonly [Name in FieldName]?: never };

/** The name of every field of every kind of a map from kinds to their fields. */
type FieldNameOfAnyKind<FieldsByKind> = {
  [Kind in keyof FieldsByKind]: keyof FieldsByKind[Kind];
}[keyof FieldsByKind];

/**
 * One alternative for each kind of a map from kinds to their fields, which declares the fields
 * of the other kinds absent, so that any of them can be read from a value of unknown kind.
 */
type ExclusiveAlternatives<FieldsByKind> = {
  [Kind in keyof FieldsByKind]:
    & FieldsByKind[Kind]
    & AbsentFields<Exclude<FieldNameOfAnyKind<FieldsByKind>, keyof FieldsByKind[Kind]>>;
}[keyof FieldsByKind];

/** The fields that show each kind of message content. */
interface MessageContentFields {
  readonly text: {
    readonly text: string;
    readonly entities?: readonly MessageEntity[];
  };
  readonly photo: {
    /** The photo's sizes, smallest first. */
    readonly photo: readonly PhotoSize[];
    /** Omitted for a photo without a caption. */
    readonly caption?: string;
    readonly caption_entities?: readonly MessageEntity[];
    /** Present when clients show the caption above the photo. */
    readonly show_caption_above_media?: true;
    /** Present when clients cover the photo until the user reveals it. */
    readonly has_media_spoiler?: true;
  };
  readonly document: {
    readonly document: Document;
    /** Omitted for a document without a caption. */
    readonly caption?: string;
    readonly caption_entities?: readonly MessageEntity[];
  };
  readonly video: {
    readonly video: Video;
    /** Omitted for a video without a caption. */
    readonly caption?: string;
    readonly caption_entities?: readonly MessageEntity[];
    /** Present when clients show the caption above the video. */
    readonly show_caption_above_media?: true;
    /** Present when clients cover the video until the user reveals it. */
    readonly has_media_spoiler?: true;
  };
  readonly voice: {
    readonly voice: Voice;
    /** Omitted for a voice note without a caption. */
    readonly caption?: string;
    readonly caption_entities?: readonly MessageEntity[];
  };
  readonly audio: {
    readonly audio: Audio;
    /** Omitted for an audio file without a caption. */
    readonly caption?: string;
    readonly caption_entities?: readonly MessageEntity[];
  };
  readonly rich_message: {
    /** A message a bot laid out in blocks, which only bots send. */
    readonly rich_message: RichMessage;
  };
  readonly poll: {
    /** A poll a bot sent, with its votes as they are now. */
    readonly poll: Poll;
  };
  readonly contact: { readonly contact: Contact };
  readonly location: {
    /** A static location, whose accuracy Telegram keeps in whole meters. */
    readonly location: Location;
  };
}

/**
 * The fields that show what a message is: text, a photo, a document, a video, a voice note, an audio
 * file, a rich message, a poll, a contact, or a location. Each kind declares the others' fields absent, so that
 * any of them can be read from a message of unknown kind.
 */
export type MessageContent = ExclusiveAlternatives<MessageContentFields>;

/** The fields of a service message's change of its chat, which content never has. */
interface NoServiceChange {
  readonly new_chat_participant?: never;
  readonly new_chat_member?: never;
  readonly new_chat_members?: never;
  readonly left_chat_participant?: never;
  readonly left_chat_member?: never;
  readonly new_chat_title?: never;
  readonly pinned_message?: never;
}

/** The fields of content, which a service message never has. */
type NoContent = AbsentFields<FieldNameOfAnyKind<MessageContentFields>>;

/**
 * The fields of a service message about members joining or leaving a supergroup, which take the
 * place of content. As Telegram does, each change also carries its legacy fields.
 */
export type MembershipChangeContent =
  | (NoContent & {
    readonly new_chat_title?: never;
    readonly pinned_message?: never;
    /** Legacy alias of `new_chat_member`. */
    readonly new_chat_participant: VirtualAccountProfile | MessageSenderBot;
    /** Legacy: the requesting account if it joined, otherwise the first new member. */
    readonly new_chat_member: VirtualAccountProfile | MessageSenderBot;
    readonly new_chat_members: readonly (VirtualAccountProfile | MessageSenderBot)[];
    readonly left_chat_participant?: never;
    readonly left_chat_member?: never;
  })
  | (NoContent & {
    readonly new_chat_title?: never;
    readonly pinned_message?: never;
    readonly new_chat_participant?: never;
    readonly new_chat_member?: never;
    readonly new_chat_members?: never;
    /** Legacy alias of `left_chat_member`. */
    readonly left_chat_participant: VirtualAccountProfile | MessageSenderBot;
    /** The member that left or was removed. */
    readonly left_chat_member: VirtualAccountProfile | MessageSenderBot;
  });

/** The field of a service message about a supergroup's new title. */
export type TitleChangeContent =
  & NoContent
  & Omit<NoServiceChange, 'new_chat_title'>
  & { readonly new_chat_title: string };

/** A deleted message, which a pin's service message shows in place of the pinned message. */
export interface InaccessibleMessage<Chat> {
  readonly message_id: number;
  readonly chat: Chat;
  /** Always 0, which tells an inaccessible message apart from a message. */
  readonly date: 0;
}

/**
 * The field of a service message about a pin, which takes the place of content: the pinned
 * message as a reply shows it, or, once deleted, inaccessible.
 */
export type PinContent<Chat, PinnedMessage> =
  & NoContent
  & Omit<NoServiceChange, 'pinned_message'>
  & { readonly pinned_message: PinnedMessage | InaccessibleMessage<Chat> };

/**
 * The field of a service message about a pin as a replied message shows it, which leaves out a
 * deleted pinned message rather than show it inaccessible.
 */
export type RepliedPinContent<PinnedMessage> =
  & NoContent
  & Omit<NoServiceChange, 'pinned_message'>
  & { readonly pinned_message?: PinnedMessage };

/**
 * The fields of a service message about what an account sent a bot from its client, the users or
 * chat it shared or the data a Web App sent, which other private messages never have.
 */
interface NoAccountServiceContent {
  readonly user_shared?: never;
  readonly users_shared?: never;
  readonly chat_shared?: never;
  readonly web_app_data?: never;
}

/**
 * A user an account shared with a bot: the details the bot's request asked for, as they were when
 * the account shared it, each omitted when the user lacks it.
 */
export interface SharedUser {
  readonly user_id: number;
  readonly first_name?: string;
  readonly last_name?: string;
  readonly username?: string;
}

/**
 * The fields of a service message about users an account shared in answer to a `request_users`
 * button, which take the place of content. As Telegram does, a single shared user also shows as
 * the legacy `user_shared`, and `users_shared` keeps the legacy `user_ids`.
 */
export type UsersSharedContent =
  & NoContent
  & NoServiceChange
  & {
    /** Legacy form of a single shared user; omitted when several were shared. */
    readonly user_shared?: { readonly user_id: number; readonly request_id: number };
    readonly users_shared: {
      /** Legacy: the IDs of `users`. */
      readonly user_ids: readonly number[];
      /** The shared users, in the order the account chose them. */
      readonly users: readonly SharedUser[];
      /** The `request_id` of the button's request. */
      readonly request_id: number;
    };
    readonly chat_shared?: never;
    readonly web_app_data?: never;
  };

/**
 * The field of a service message about a supergroup an account shared in answer to a
 * `request_chat` button, which takes the place of content: the details the request asked for, as
 * they were when the account shared it, each omitted when the chat lacks it.
 */
export type ChatSharedContent =
  & NoContent
  & NoServiceChange
  & {
    readonly user_shared?: never;
    readonly users_shared?: never;
    readonly chat_shared: {
      readonly chat_id: number;
      readonly title?: string;
      readonly username?: string;
      /** The `request_id` of the button's request. */
      readonly request_id: number;
    };
    readonly web_app_data?: never;
  };

/**
 * The field of a service message about data that the Web App of a `web_app` reply keyboard button
 * sent the bot, which takes the place of content. Telegram does not vouch for either value: a
 * client may send any data with any button text.
 */
export type WebAppDataContent =
  & NoContent
  & NoServiceChange
  & {
    readonly user_shared?: never;
    readonly users_shared?: never;
    readonly chat_shared?: never;
    readonly web_app_data: {
      /** The text of the button that opened the Web App. */
      readonly button_text: string;
      /** The data the Web App sent, as it sent it. */
      readonly data: string;
    };
  };

/**
 * What a private message shows: content, a pin, the users or chat an account shared, or the data
 * a Web App sent.
 */
export type PrivateMessageContent =
  | (MessageContent & NoServiceChange & NoAccountServiceContent)
  | (PinContent<PrivateChat, PinnedPrivateMessage> & NoAccountServiceContent)
  | UsersSharedContent
  | ChatSharedContent
  | WebAppDataContent;

/**
 * What a private message shows as a replied message, as `RepliedPinContent` shows a pin, or the
 * users or chat an account shared, or the data a Web App sent.
 */
export type RepliedPrivateMessageContent =
  | (MessageContent & NoServiceChange & NoAccountServiceContent)
  | (RepliedPinContent<PinnedPrivateMessage> & NoAccountServiceContent)
  | UsersSharedContent
  | ChatSharedContent
  | WebAppDataContent;

/**
 * What a supergroup message shows: content, or a change of the supergroup's members or title, or
 * a pin.
 */
export type SupergroupMessageContent =
  | (MessageContent & NoServiceChange)
  | MembershipChangeContent
  | TitleChangeContent
  | PinContent<SupergroupChat, PinnedSupergroupMessage>;

/** What a supergroup message shows as a replied message, as `RepliedPinContent` shows a pin. */
export type RepliedSupergroupMessageContent =
  | (MessageContent & NoServiceChange)
  | MembershipChangeContent
  | TitleChangeContent
  | RepliedPinContent<PinnedSupergroupMessage>;

/** Who first sent a forwarded message, and when. */
export interface MessageOriginUser {
  readonly type: 'user';
  readonly sender_user: VirtualAccountProfile | MessageSenderBot;
  readonly date: number;
}

/** The name of an account with private forwards that first sent a forwarded message, and when. */
export interface MessageOriginHiddenUser {
  readonly type: 'hidden_user';
  readonly sender_user_name: string;
  readonly date: number;
}

/** Where a forwarded message, or the message of another chat a reply shows, first appeared. */
export type MessageOrigin = MessageOriginUser | MessageOriginHiddenUser;

/**
 * The fields that show each kind of media of a message of another chat that a message replies to.
 */
interface ExternalReplyMediaFields {
  readonly poll: { readonly poll: Poll };
  readonly photo: {
    readonly photo: readonly PhotoSize[];
    /** Present when clients cover the photo until the user reveals it. */
    readonly has_media_spoiler?: true;
  };
  readonly document: { readonly document: Document };
  readonly video: {
    readonly video: Video;
    /** Present when clients cover the video until the user reveals it. */
    readonly has_media_spoiler?: true;
  };
  readonly voice: { readonly voice: Voice };
  readonly audio: { readonly audio: Audio };
  readonly contact: { readonly contact: Contact };
  readonly location: { readonly location: Location };
}

/**
 * A message of another chat that a message replies to: who first wrote it and when, the
 * supergroup message it is, and its media, if any, whose caption the reply's quote shows instead,
 * its poll as it is now, or its contact or location.
 */
export type ExternalReplyInfo =
  & {
    readonly origin: MessageOrigin;
    /** The replied message's supergroup; absent for a message of a private chat. */
    readonly chat?: SupergroupChat;
    /** The replied message's ID in its supergroup; absent for a message of a private chat. */
    readonly message_id?: number;
  }
  & (
    | AbsentFields<FieldNameOfAnyKind<ExternalReplyMediaFields>>
    | ExclusiveAlternatives<ExternalReplyMediaFields>
  );

/** The quoted part of the text or caption of a replied message. */
export interface TextQuote {
  readonly text: string;
  readonly entities?: readonly MessageEntity[];
  /** Where the quote starts in the replied text, in UTF-16 code units. */
  readonly position: number;
  /** Present when the sender chose the quote, rather than Telegram quoting the message. */
  readonly is_manual?: true;
}

/** How a message replies to a message of another chat, and what it quotes of a replied message. */
interface MessageReplyInfo {
  /** Present for a reply to a message of another chat. */
  readonly external_reply?: ExternalReplyInfo;
  /** Present for a reply that quotes the replied message. */
  readonly quote?: TextQuote;
}

/** The album a message belongs to, which follows its reply and precedes its content. */
interface MessageAlbumInfo {
  /** The identifier the messages of an album share; present only for a message of an album. */
  readonly media_group_id?: string;
}

/** The fields that precede a message's reply and content. */
interface MessageHeader<Chat> {
  readonly message_id: number;
  readonly from: VirtualAccountProfile | MessageSenderBot;
  readonly chat: Chat;
  readonly date: number;
  /** Present once the message's author has edited its text or caption. */
  readonly edit_date?: number;
  /** Present for a forward. */
  readonly forward_origin?: MessageOrigin;
  /** Telegram's legacy form of the origin's sender, present for a forward of a user's message. */
  readonly forward_from?: VirtualAccountProfile | MessageSenderBot;
  /** Telegram's legacy form of the origin's name, present for a forward of a hidden user. */
  readonly forward_sender_name?: string;
  /** Telegram's legacy form of the origin's date, present for a forward. */
  readonly forward_date?: number;
}

/** The fields that follow a message's content. */
interface MessageTrailer {
  /** The inline keyboard a bot attached to its message, or to a message sent through it. */
  readonly reply_markup?: InlineKeyboardMarkup;
  /** The bot through whose inline mode an account sent the message. */
  readonly via_bot?: MessageSenderBot;
  /** Present when the bot protected its message from forwarding and saving. */
  readonly has_protected_content?: true;
  /** The message effect a bot sent a private message with. */
  readonly effect_id?: string;
}

/** A pinned message, which is never a service message, as a reply shows a message. */
export type PinnedPrivateMessage =
  & MessageHeader<PrivateChat>
  & MessageReplyInfo
  & MessageAlbumInfo
  & MessageContent
  & NoServiceChange
  & MessageTrailer;

/** A message as a reply shows it, without its own reply. */
export type RepliedPrivateMessage =
  & MessageHeader<PrivateChat>
  & MessageReplyInfo
  & MessageAlbumInfo
  & RepliedPrivateMessageContent
  & MessageTrailer;

/**
 * A private-chat message as the conversation's bot sees it: numbered in the bot's message box,
 * with the account as its chat, whichever participant wrote it, or a service message about a pin,
 * from the participant who pinned.
 */
export type PrivateMessage =
  & MessageHeader<PrivateChat>
  & {
    /** The message this one replies to, unless it was deleted; it never shows its own reply. */
    readonly reply_to_message?: RepliedPrivateMessage;
  }
  & MessageReplyInfo
  & MessageAlbumInfo
  & PrivateMessageContent
  & MessageTrailer;

/** A pinned supergroup message, which is never a service message, as a reply shows a message. */
export type PinnedSupergroupMessage =
  & MessageHeader<SupergroupChat>
  & MessageReplyInfo
  & MessageAlbumInfo
  & MessageContent
  & NoServiceChange
  & MessageTrailer;

/** A message as a reply shows it, without its own reply. */
export type RepliedSupergroupMessage =
  & MessageHeader<SupergroupChat>
  & MessageReplyInfo
  & MessageAlbumInfo
  & RepliedSupergroupMessageContent
  & MessageTrailer;

/**
 * A supergroup message as the requesting account sees it: numbered once by the supergroup, and
 * written by an account or a bot, or a service message about members joining or leaving, a new
 * title, or a pin, from the member who made the change. Members see the same message, apart from
 * the `file_id` of its file and the legacy `new_chat_member` of a service message.
 */
export type SupergroupMessage =
  & MessageHeader<SupergroupChat>
  & {
    /** The message this one replies to, unless it was deleted; it never shows its own reply. */
    readonly reply_to_message?: RepliedSupergroupMessage;
  }
  & MessageReplyInfo
  & MessageAlbumInfo
  & SupergroupMessageContent
  & MessageTrailer;

/**
 * Administrator rights that a chat request requires: every right that applies to the requested
 * kind of chat, by its Bot API name, required or not.
 */
export type RequiredChatAdministratorRights = Readonly<Record<string, boolean>>;

/**
 * What a reply keyboard button asks the client to share instead of sending its text, in the
 * fields of a Bot API `KeyboardButton`. Pressing a `request_contact` button shares the account's
 * own contact, pressing a `request_location` button shares the location the press reports, and
 * pressing a `request_users` or `request_chat` button shares the users or supergroup the press
 * chooses; the emulator cannot answer the other requests, so such buttons cannot be pressed.
 */
export type ReplyKeyboardButtonRequest =
  | { readonly request_contact: true }
  | { readonly request_location: true }
  | { readonly request_poll: { readonly type?: 'quiz' | 'regular' } }
  | { readonly web_app: { readonly url: string } }
  | {
    readonly request_users: {
      readonly request_id: number;
      readonly user_is_bot?: boolean;
      readonly user_is_premium?: boolean;
      readonly max_quantity: number;
      readonly request_name: boolean;
      readonly request_username: boolean;
      readonly request_photo: boolean;
    };
  }
  | {
    readonly request_chat: {
      readonly request_id: number;
      readonly chat_is_channel: boolean;
      readonly chat_is_forum?: boolean;
      readonly chat_has_username?: boolean;
      readonly chat_is_created: boolean;
      readonly user_administrator_rights?: RequiredChatAdministratorRights;
      readonly bot_administrator_rights?: RequiredChatAdministratorRights;
      readonly bot_is_member: boolean;
      readonly request_title: boolean;
      readonly request_username: boolean;
      readonly request_photo: boolean;
    };
  };

/**
 * A reply keyboard button, which sends its text to the chat when pressed, or asks the client to
 * share what its request describes.
 */
export type ReplyKeyboardButton =
  | KeyboardButtonFace
  | (KeyboardButtonFace & ReplyKeyboardButtonRequest);

/** A custom keyboard the account's client shows in place of its letter keyboard. */
export interface ReplyKeyboardInterface {
  readonly type: 'keyboard';
  /** The ID of the bot message that sent the keyboard, as message history shows it. */
  readonly message_id: number;
  readonly keyboard: readonly (readonly ReplyKeyboardButton[])[];
  readonly is_persistent: boolean;
  readonly resize_keyboard: boolean;
  /**
   * Whether clients hide the keyboard once it is used; the keyboard stays available, so its
   * buttons can still be pressed.
   */
  readonly one_time_keyboard: boolean;
  readonly input_field_placeholder?: string;
}

/** A reply interface to a bot message, which the account's client shows as if replying to it. */
export interface ForceReplyInterface {
  readonly type: 'force_reply';
  /** The ID of the bot message to reply to, as message history shows it. */
  readonly message_id: number;
  readonly input_field_placeholder?: string;
}

/** What the account's client shows in place of its usual input in a chat with a bot. */
export type ReplyInterface = ReplyKeyboardInterface | ForceReplyInterface;

export interface PressReplyKeyboardButtonInput<Target extends MessageTarget = MessageTarget> {
  readonly chat: Target;
  /**
   * The text of the button to press, which a text button sends to the chat. Of the buttons with
   * this text, the press selects those that take its answer, or, without an answer, a text or
   * `request_contact` button; buttons left that request different things make the press fail.
   */
  readonly text: string;
  /**
   * The location the account's client reports, which a `request_location` button shares and no
   * other button takes.
   */
  readonly location?: LocationInput;
  /**
   * The IDs of the session's accounts and bots the account chooses, which a `request_users`
   * button shares and no other button takes: at most the request's `max_quantity`, each once, and
   * each of the kind the request requires.
   */
  readonly shared_user_ids?: readonly number[];
  /**
   * The ID of a supergroup the account is a member of and chooses, which a `request_chat` button
   * shares and no other button takes. It must meet the request's criteria; the bot must already be
   * a member and hold the rights the request requires of it, which the press does not grant.
   */
  readonly shared_chat_id?: number;
  /**
   * The poll the account creates, which a `request_poll` button sends and no other button takes.
   * It must be of the type the button requests, if any.
   */
  readonly poll?: AccountPollInput;
  /**
   * The data the Web App of a `web_app` button sends, as `Telegram.WebApp.sendData` sends it,
   * which such a button requires and no other button takes: 1 to 4096 bytes in UTF-8, kept as
   * given. The press stands for opening the Web App and sending the data at once.
   */
  readonly web_app_data?: string;
}

export interface AccountReplyInterfaceInput {
  readonly chat: MessageTarget;
}

/** A bot command as an account's client lists it. */
export interface BotCommand {
  /** The command without its leading slash. */
  readonly command: string;
  readonly description: string;
  readonly is_ephemeral: boolean;
}

/**
 * The button an account's client shows next to the message field of a private chat with a bot:
 * the bot's commands, a Web App, or `default` when the bot chose no specific button.
 */
export type MenuButton =
  | { readonly type: 'commands' }
  | { readonly type: 'web_app'; readonly text: string; readonly web_app: { readonly url: string } }
  | { readonly type: 'default' };

/** The notification an account's client shows for another participant's message. */
export interface Notification {
  /** The notifying message's ID, as the chat's bots see it. */
  readonly message_id: number;
  /** Whether the sender asked for the notification to play no sound, as `disable_notification`. */
  readonly is_silent: boolean;
}

/** What a bot shows it is doing in a chat, by the Bot API's lowercase action name. */
export interface ChatAction {
  readonly bot_id: number;
  readonly action:
    | 'typing'
    | 'record_video'
    | 'upload_video'
    | 'record_voice'
    | 'upload_voice'
    | 'upload_photo'
    | 'upload_document'
    | 'choose_sticker'
    | 'find_location'
    | 'record_video_note'
    | 'upload_video_note';
}

/**
 * The draft of a message a bot is still generating, as an account's client shows it in its private
 * chat with the bot.
 */
export interface MessageDraft {
  /**
   * The draft's 64-bit ID as the bot chose it, in Telegram's decimal text form, as the
   * `stopped_message_generation` update of the official Bot API server writes it.
   */
  readonly draft_id: string;
  /** The draft's text; empty while the client shows a "Thinking…" placeholder. */
  readonly text: string;
  /** Omitted when the text has no entities. */
  readonly entities?: readonly MessageEntity[];
  /** Whether the bot asked for a Stop button, which `stopMessageDraft` presses. */
  readonly can_stop: boolean;
  /** Whether the draft stays shown once the account presses Stop. */
  readonly keep_on_stop: boolean;
  /** Whether the account pressed Stop; the client then shows no Stop button. */
  readonly is_stopped: boolean;
}

/** The commands one bot of a supergroup suggests to an account. */
export interface SupergroupBotCommands {
  readonly bot_id: number;
  readonly commands: readonly BotCommand[];
}

export interface CallbackQueryAnswer {
  /** Omitted when the answer shows no notification. */
  readonly text?: string;
  readonly show_alert: boolean;
  /** The link that starts the bot, which the client opens; omitted when the answer has none. */
  readonly url?: string;
  readonly cache_time: number;
}

/** Whether the bot can still answer a callback query, and if not, why. */
export type CallbackQueryStatus = 'awaiting_answer' | 'answered' | 'expired';

/** A callback button press by an account, with the bot's answer once it has answered. */
export interface CallbackQuery {
  readonly id: string;
  readonly callback_data: string;
  readonly status: CallbackQueryStatus;
  /** The bot's answer when `status` is `answered`, and `null` otherwise. */
  readonly answer: CallbackQueryAnswer | null;
}

export interface SendInlineQueryInput {
  /** The inline bot, whose username the account types before the query. */
  readonly bot_id: number;
  /** The chat where the account types the query, to which a chosen result is sent. */
  readonly chat: MessageTarget;
  /** Up to 256 characters; omitted or empty when the account types only the bot's username. */
  readonly query?: string;
  /** The `next_offset` of an earlier answer, requesting more results; omitted for the first. */
  readonly offset?: string;
  /**
   * Where the account is, shared only with a bot created with `requests_inline_location`;
   * omitted to share no location.
   */
  readonly location?: LocationInput;
}

/** A point on Earth an account shares. */
export interface LocationInput {
  /** From -90 to 90 degrees. */
  readonly latitude: number;
  /** From -180 to 180 degrees. */
  readonly longitude: number;
  /** The radius of uncertainty, from 0 to 1500 meters; omitted or 0 when unknown. */
  readonly horizontal_accuracy?: number;
}

/** A point on Earth, as Telegram shows it. */
export interface Location {
  readonly latitude: number;
  readonly longitude: number;
  /** The radius of uncertainty in whole meters; omitted when unknown. */
  readonly horizontal_accuracy?: number;
}

/** A result of an answer as the account's client lists it. */
export interface InlineQueryResultListing {
  readonly type:
    | 'article'
    | 'contact'
    | 'location'
    | 'photo'
    | 'document'
    | 'video'
    | 'voice'
    | 'audio';
  readonly id: string;
  readonly title?: string;
  readonly description?: string;
  /** The URL an article shows. */
  readonly url?: string;
}

/** The button the account's client shows above the results. */
export type InlineQueryResultsButton =
  | { readonly text: string; readonly start_parameter: string }
  | { readonly text: string; readonly web_app: { readonly url: string } };

export interface InlineQueryAnswer {
  readonly results: readonly InlineQueryResultListing[];
  readonly cache_time: number;
  readonly is_personal: boolean;
  /** Empty when there are no more results. */
  readonly next_offset: string;
  readonly button?: InlineQueryResultsButton;
}

/** Whether the bot has answered an inline query. */
export type InlineQueryStatus = 'awaiting_answer' | 'answered';

/** An inline query an account sent, with the bot's answer once it has answered. */
export interface InlineQuery {
  readonly id: string;
  readonly bot_id: number;
  readonly chat: MessageTarget;
  readonly query: string;
  readonly offset: string;
  /** The location the account shared with the bot; omitted for none. */
  readonly location?: Location;
  readonly status: InlineQueryStatus;
  /** The bot's answer when `status` is `answered`, and `null` otherwise. */
  readonly answer: InlineQueryAnswer | null;
}

export interface ChooseInlineQueryResultInput {
  readonly inline_query_id: string;
  /** The identifier of a result of the bot's answer. */
  readonly result_id: string;
}

export interface VirtualAccountClient extends VirtualAccountProfile {
  /**
   * Sends a message as this virtual Telegram account, to a bot or to a supergroup this account is
   * a member of. In a supergroup, bots in privacy mode receive only commands, replies to their
   * messages, and mentions of them.
   */
  sendMessage<Target extends MessageTarget>(
    input: AccountSendMessageInput<Target>,
  ): Promise<MessageIn<Target>>;
  /**
   * Sends a photo, with an optional caption, as this account, as `sendMessage` sends text. The
   * emulator reads the image's dimensions and rejects content that is not an image.
   */
  sendPhoto<Target extends MessageTarget>(
    input: AccountSendPhotoInput<Target>,
  ): Promise<MessageIn<Target>>;
  /** Sends a file as a document, with an optional caption, as `sendMessage` sends text. */
  sendDocument<Target extends MessageTarget>(
    input: AccountSendDocumentInput<Target>,
  ): Promise<MessageIn<Target>>;
  /**
   * Sends a video, with an optional caption, as `sendMessage` sends text. Its duration and
   * dimensions are those the input defines; the emulator never reads the content.
   */
  sendVideo<Target extends MessageTarget>(
    input: AccountSendVideoInput<Target>,
  ): Promise<MessageIn<Target>>;
  /**
   * Sends a voice note, with an optional caption, as `sendMessage` sends text. Its duration is
   * the one the input defines; the emulator never reads the content.
   */
  sendVoice<Target extends MessageTarget>(
    input: AccountSendVoiceInput<Target>,
  ): Promise<MessageIn<Target>>;
  /**
   * Sends an audio file, such as a music track, with an optional caption, as `sendMessage` sends
   * text. Its duration, performer and title are those the input defines; the emulator never reads
   * the content or its tags.
   */
  sendAudio<Target extends MessageTarget>(
    input: AccountSendAudioInput<Target>,
  ): Promise<MessageIn<Target>>;
  /**
   * Sends a contact the account writes, as `sendMessage` sends text. Telegram cleans its texts,
   * as it cleans names, and shows no user for it.
   */
  sendContact<Target extends MessageTarget>(
    input: AccountSendContactInput<Target>,
  ): Promise<MessageIn<Target>>;
  /**
   * Shares the account's own contact, as `sendMessage` sends text: its phone number and profile
   * name, with the account as the contact's user. Fails for an account created without a phone
   * number.
   */
  shareOwnContact<Target extends MessageTarget>(
    input: AccountShareOwnContactInput<Target>,
  ): Promise<MessageIn<Target>>;
  /**
   * Shares a static location, as `sendMessage` sends text. Telegram keeps its accuracy in whole
   * meters, rounded up.
   */
  sendLocation<Target extends MessageTarget>(
    input: AccountSendLocationInput<Target>,
  ): Promise<MessageIn<Target>>;
  /**
   * Creates a poll that this account owns, as `sendMessage` sends text; a supergroup needs the
   * `can_send_polls` permission. Its question and options are checked as Telegram checks them.
   * Bots see the message, but receive no `poll` or `poll_answer` updates about the poll, which
   * only a bot's own polls send it.
   */
  sendPoll<Target extends MessageTarget>(
    input: AccountSendPollInput<Target>,
  ): Promise<MessageIn<Target>>;
  /**
   * Sends photos and videos, documents, or audio files, as an album, as `sendPhoto`, `sendVideo`,
   * `sendDocument` and `sendAudio` send one, and returns the album's messages in order, which share a
   * `media_group_id`. The chat's bots receive each message as a separate update, in the album's
   * order.
   */
  sendMediaGroup<Target extends MessageTarget>(
    input: AccountSendMediaGroupInput<Target>,
  ): Promise<readonly MessageIn<Target>[]>;
  /**
   * Forwards a message of one of this account's chats to a chat it can write to, as the account's
   * message, which shows who first sent it. The chat's bots receive it as `sendMessage` describes.
   * Messages protected from forwarding and service messages cannot be forwarded.
   */
  forwardMessage<Target extends MessageTarget>(
    input: AccountForwardMessageInput<Target>,
  ): Promise<MessageIn<Target>>;
  /**
   * Edits the text of a message this account sent, which sends the chat's bots an
   * `edited_message` update as they received the message. Returns the edited message.
   */
  editMessage<Target extends MessageTarget>(
    input: AccountEditMessageInput<Target>,
  ): Promise<MessageIn<Target>>;
  /**
   * Edits the caption of a photo, document, video, voice note, or audio file this account sent, as
   * `editMessage` edits text.
   */
  editMessageCaption<Target extends MessageTarget>(
    input: AccountEditMessageCaptionInput<Target>,
  ): Promise<MessageIn<Target>>;
  /**
   * Deletes a message for every participant of the chat, as Telegram's clients do; the chat's
   * bots receive no update for it. In a private chat, the account deletes either participant's
   * messages. In a supergroup, it deletes its own messages, and any message as the owner or as an
   * administrator with the `can_delete_messages` right.
   */
  deleteMessage(input: AccountDeleteMessageInput): Promise<void>;
  /** Creates a supergroup that this account owns. */
  createSupergroup(input: CreateSupergroupInput): Promise<Supergroup>;
  /**
   * Adds an account or a bot to a supergroup this account owns, which a `new_chat_members`
   * service message records. An added bot first receives a `my_chat_member` update. Adding a
   * removed member lifts its ban; adding a member again has no effect.
   */
  addChatMember(input: AddChatMemberInput): Promise<void>;
  /**
   * Removes an account or a bot from a supergroup this account owns, which bans it until it is
   * added again, and which a `left_chat_member` service message records. A removed bot receives a
   * `my_chat_member` update showing it as `kicked` and the service message, and its later
   * requests there fail with `403 Forbidden: bot was kicked from the supergroup chat`. Removing a
   * non-member has no effect.
   */
  removeChatMember(input: RemoveChatMemberInput): Promise<void>;
  /**
   * Leaves a supergroup, which a `left_chat_member` service message records. The owner cannot
   * leave. Leaving a supergroup this account is not a member of has no effect.
   */
  leaveChat(input: LeaveChatInput): Promise<void>;
  /**
   * Joins a public supergroup by itself, addressed by its chat ID, as Telegram's clients join one
   * they find by its username, which a `new_chat_members` service message from this account
   * records.
   * Administrator bots receive a `chat_member` update. A private supergroup, or one that banned
   * this account, refuses it; joining a supergroup this account is a member of has no effect.
   */
  joinChat(input: JoinChatInput): Promise<void>;
  /**
   * Joins the supergroup an invite link leads to, which a `new_chat_members` service message from
   * this account records. Administrator bots receive a `chat_member` update with the link, whole
   * only for the bot that created it. The link must not have expired, and its member limit must
   * leave a place; this account must be neither a member nor banned. A link that creates join
   * requests sends this account's request instead, which administrator bots with
   * `can_invite_users` receive as a `chat_join_request` update; this account stays outside until
   * one of them approves the request, and using such a link again while it is pending fails.
   */
  joinChatByInviteLink(input: JoinChatByInviteLinkInput): Promise<ChatJoin>;
  /**
   * Returns the invite links of a supergroup this account owns, in the order bots created them,
   * with how many members joined through each and still are.
   */
  getChatInviteLinks(input: AccountChatInviteLinksInput): Promise<readonly SupergroupInviteLink[]>;
  /**
   * Returns the pending requests to join a supergroup this account owns, in the order they were
   * sent. A request ends when an administrator bot or account approves or declines it, or when its
   * account joins another way or is banned.
   */
  getChatJoinRequests(input: AccountChatJoinRequestsInput): Promise<readonly ChatJoinRequest[]>;
  /**
   * Approves a pending request to join a supergroup, whichever bot created the link it was sent
   * through. This account must own the supergroup, or be an administrator holding
   * `can_invite_users` when it decides. The requester joins, restricted if it was, through the
   * request's link, which a `new_chat_members` service message from the requester records;
   * administrator bots receive the change from this account as a `chat_member` update with the
   * link. The request ends, and with it the bots' permission to write to the requester under it.
   * A request is decided once: deciding it again, or after a bot or another account did, fails
   * with an `EmulationClientError` whose `status` is `409` once the requester is a member, or
   * `404` once it has no pending request.
   */
  approveChatJoinRequest(input: AccountChatJoinRequestDecisionInput): Promise<void>;
  /**
   * Declines a pending request to join a supergroup, as `approveChatJoinRequest` decides it: the
   * requester stays outside, which no update reports, and may request again.
   */
  declineChatJoinRequest(input: AccountChatJoinRequestDecisionInput): Promise<void>;
  /**
   * Promotes a member of a supergroup to administrator with the given rights, which must include
   * at least one, or replaces an administrator's rights. This account must own the supergroup, or
   * be an administrator with `can_promote_members` that holds every right it grants; it changes
   * only administrators it may edit, as `can_be_edited` shows, and becomes their promoter. A
   * promoted bot receives a `my_chat_member` update from this account showing it as
   * `administrator`, receives every message of the supergroup, and uses its rights:
   * `can_delete_messages` lets it delete any message there, and `can_restrict_members` lets it
   * ban, unban, and restrict members. A refused promotion changes nothing.
   */
  promoteChatMember(input: PromoteChatMemberInput): Promise<void>;
  /**
   * Returns the owner, then the administrators in the order they joined, of a supergroup this
   * account is a member of, with who promoted each administrator and whether this account may edit
   * it, as bots see `can_be_edited`.
   */
  getChatAdministrators(
    input: AccountChatAdministratorsInput,
  ): Promise<readonly SupergroupAdministrator[]>;
  /**
   * Demotes an administrator of a supergroup to a member: one this account may edit, as
   * `can_be_edited` shows. A demoted bot receives a `my_chat_member` update from this account
   * showing it as `member`. Demoting a member that is no administrator has no effect.
   */
  demoteChatMember(input: DemoteChatMemberInput): Promise<void>;
  /**
   * Restricts what an account or a bot may do in a supergroup, member or not, as
   * `restrictChatMember` does for an administrator bot. This account must own the supergroup or
   * hold `can_restrict_members`, and restricts only administrators it promoted, directly or
   * indirectly; keeping an administrator every permission demotes it, which needs
   * `can_promote_members` instead. A restricted member that leaves stays restricted, and joins
   * again with its restriction; a restricted administrator loses its rights. Administrator bots
   * receive the change from this account as a `chat_member` update, and a restricted bot as
   * `my_chat_member`. Its sends that its permissions, or the supergroup's default permissions,
   * withhold fail with Telegram's errors, such as `Bad Request: not enough rights to send photos
   * to the chat`.
   */
  restrictChatMember(input: RestrictChatMemberInput): Promise<void>;
  /**
   * Lifts the restriction of a user of a supergroup, which leaves a member a plain member; this
   * account must own the supergroup or hold `can_restrict_members`. Lifting no restriction has no
   * effect.
   */
  liftChatMemberRestriction(input: LiftChatMemberRestrictionInput): Promise<void>;
  /**
   * Changes what the members of a supergroup may do by default, as `setChatPermissions` does for
   * an administrator bot; this account must own the supergroup or hold `can_restrict_members`.
   * Members, bots included, are then refused what the defaults withhold, while the owner and
   * administrators are exempt. Bots see the defaults as `permissions` in `getChat`.
   */
  setChatPermissions(input: SetChatPermissionsInput): Promise<void>;
  /**
   * Sets this account's own custom title in a supergroup it owns, or an administrator's, which
   * bots see as `custom_title` in its chat member. An administrator keeps its title when its
   * rights change, and loses it when demoted.
   */
  setCustomTitle(input: SetCustomTitleInput): Promise<void>;
  /**
   * Protects all content of a supergroup this account owns from forwarding and saving, as
   * Telegram's "Restrict saving content" setting does, or lifts that protection with
   * `hasProtectedContent: false`. Every message of the supergroup then shows
   * `has_protected_content`, and only bots can copy them.
   */
  setContentProtection(input: SetContentProtectionInput): Promise<void>;
  /**
   * Changes the title of a supergroup this account is a member of, which Telegram cleans. Bots of
   * the supergroup receive a service message with `new_chat_title`; a title the supergroup has
   * changes nothing.
   */
  changeSupergroupTitle(input: ChangeSupergroupTitleInput): Promise<void>;
  /**
   * Changes the description of a supergroup this account is a member of, which Telegram cleans;
   * no service message records it. Telegram refuses the description the supergroup has.
   */
  changeSupergroupDescription(input: ChangeSupergroupDescriptionInput): Promise<void>;
  /**
   * Blocks a bot, which Telegram calls stopping it. The bot receives a `my_chat_member` update
   * showing it as `kicked`, its messages to this account fail with `403 Forbidden: bot was
   * blocked by the user`, and this account cannot write to it until it unblocks the bot. Blocking
   * a blocked bot has no effect.
   */
  blockBot(input: BotBlockInput): Promise<void>;
  /**
   * Unblocks a bot, which receives a `my_chat_member` update showing it as a `member` again.
   * Unblocking a bot that is not blocked has no effect.
   */
  unblockBot(input: BotBlockInput): Promise<void>;
  /**
   * Returns the messages of a private conversation or of a supergroup this account is a member
   * of, whoever wrote them, oldest first.
   */
  getMessages<Target extends MessageTarget>(
    input: AccountMessageHistoryInput<Target>,
  ): Promise<readonly MessageIn<Target>[]>;
  /**
   * Pins a message of this account's private chat with a bot, or of a supergroup it is a member
   * of; a chat pins any number of messages, and `getChat` shows a bot the newest one. Either
   * participant of a private chat pins any of its messages; in a supergroup, this account needs
   * the `can_pin_messages` permission, which the owner holds, an administrator holds with that
   * right, and the default permissions grant other members unless withheld, except in a public
   * supergroup, which ignores them for pins. Service messages cannot be pinned, and pinning a
   * pinned message fails, as Telegram refuses it. The pin is recorded as this account's service
   * message with `pinned_message`, which the chat's bots receive.
   */
  pinMessage(input: AccountPinMessageInput): Promise<void>;
  /**
   * Unpins a pinned message, with the permission `pinMessage` needs; no service message records
   * it. Unpinning a message that is not pinned fails, as Telegram refuses it.
   */
  unpinMessage(input: AccountPinMessageInput): Promise<void>;
  /**
   * Returns the pinned messages of a private conversation or of a supergroup this account is a
   * member of, newest first by sending date. Deleting a message unpins it.
   */
  getPinnedMessages<Target extends MessageTarget>(
    input: AccountPinnedMessagesInput<Target>,
  ): Promise<readonly MessageIn<Target>[]>;
  /**
   * Returns the chat actions, such as typing, that this account's client shows in its private
   * chat with a bot or in a supergroup it is a member of, in the order the bots last sent them. A
   * bot's action shows until the bot cancels it or sends a message to the chat, and never expires
   * as time passes: see `expireChatAction`.
   */
  getChatActions(input: AccountChatActionsInput): Promise<readonly ChatAction[]>;
  /**
   * Stops showing a bot's chat action in this account's private chat with the bot, or one bot's
   * action in a supergroup this account is a member of, as Telegram's clients do 5.5 seconds after
   * the bot last sent it. In a supergroup the action ends for every member, as the timeout ends it
   * on every member's client, and other bots' actions stay. The bot is not told, and its next
   * action shows again. Fails when the bot shows no action.
   */
  expireChatAction(input: ExpireChatActionInput): Promise<void>;
  /**
   * Returns the draft of a message the bot is generating, which this account's client shows in
   * its private chat with the bot, or `null` for none. A `sendMessageDraft` with the shown draft's
   * ID changes it and one with another ID replaces it; any message from the bot removes it. Drafts
   * are never part of the chat's messages, and never expire as time passes: see
   * `expireMessageDraft`.
   */
  getMessageDraft(input: AccountMessageDraftInput): Promise<MessageDraft | null>;
  /**
   * Removes the draft this account's client shows in its private chat with a bot, as Telegram's
   * clients remove one 30 seconds after the bot's last write, or a stopped draft kept with
   * `keep_on_stop` after a short time. The bot is not told, and a later write shows a draft again.
   * With `draft_id`, fails unless the client shows that draft; fails when it shows none.
   */
  expireMessageDraft(input: ShownMessageDraftInput): Promise<void>;
  /**
   * Presses the Stop button of the draft this account's client shows in its private chat with a
   * bot, which sends the bot a `stopped_message_generation` update naming the draft. The draft
   * disappears, unless the bot kept it with `keep_on_stop`, which shows it without a Stop button
   * until it expires or the bot sends a message. Stopping the generation is the bot's: a later
   * write shows a draft again. With `draft_id`, fails unless the client shows that draft; fails
   * when it shows none, shows no Stop button, or was already stopped.
   */
  stopMessageDraft(input: ShownMessageDraftInput): Promise<void>;
  /**
   * Returns the notifications this account's client shows for the messages other participants
   * sent to its private chat with a bot or to a supergroup it is a member of, oldest first. A
   * notification is silent when a bot sent its message with `disable_notification`.
   */
  getNotifications(input: AccountNotificationsInput): Promise<readonly Notification[]>;
  /**
   * Presses a callback button on a bot's message, in a private chat or a supergroup, which sends
   * the bot a callback query. The bot answers asynchronously; read the answer with
   * `getCallbackQuery`.
   */
  pressCallbackButton(input: PressCallbackButtonInput): Promise<CallbackQuery>;
  /**
   * Presses the callback button a selector picks on a message as the account's history shows it
   * now, as `pressCallbackButton` presses it by its callback data. Throws a `ButtonSelectionError`
   * listing the candidates unless exactly one button matches and it is a callback button.
   */
  pressButton(input: PressButtonInput): Promise<CallbackQuery>;
  /** Returns a callback query this account created, with the bot's answer once given. */
  getCallbackQuery(callbackQueryId: string): Promise<CallbackQuery>;
  /**
   * Votes in the poll a message of a private chat or a supergroup shows, choosing options by
   * position, or changes this account's answer, as the poll allows. Choosing the options already
   * chosen changes nothing. A forward shows the same poll as the message it repeats, so a vote
   * through either counts once.
   */
  answerPoll<Target extends MessageTarget>(
    input: AnswerPollInput<Target>,
  ): Promise<AccountPollAnswer<Target>>;
  /** Returns this account's answer to the poll a message shows, with the message. */
  getPollAnswer<Target extends MessageTarget>(
    input: AccountPollMessageInput<Target>,
  ): Promise<AccountPollAnswer<Target>>;
  /**
   * Retracts this account's answer to the poll a message shows, which only a poll that allows
   * revoting accepts. Retracting without an answer changes nothing.
   */
  retractPollAnswer(input: AccountPollMessageInput): Promise<void>;
  /**
   * Stops the poll this account sent in a message, which then keeps its votes and accepts no more
   * answers, and returns the message. Fails for a poll another account or bot sent, for a forward
   * of the poll, and for a poll that is already closed.
   */
  stopPoll<Target extends MessageTarget>(
    input: AccountPollMessageInput<Target>,
  ): Promise<MessageIn<Target>>;
  /**
   * Reacts to a content message of a supergroup, or changes this account's reaction, with one
   * ordinary emoji. The supergroup's administrator bots whose `allowed_updates` include
   * `message_reaction` receive a `message_reaction` update with the old and new reactions.
   * Choosing the reaction already chosen changes nothing. A message of an album takes the reaction
   * on the album's first message that is not deleted.
   */
  setMessageReaction(input: SetMessageReactionInput): Promise<MessageReactions>;
  /** Returns the reactions to a supergroup message, the bots' included. */
  getMessageReactions(input: AccountReactionMessageInput): Promise<MessageReactions>;
  /**
   * Removes this account's reaction to a supergroup message, which the administrator bots that
   * subscribe to `message_reaction` observe as for a change. Removing without a reaction changes
   * nothing.
   */
  removeMessageReaction(input: AccountReactionMessageInput): Promise<void>;
  /**
   * Types an inline query for a bot with inline mode turned on, in a chat this account can write
   * to, which sends the bot an `inline_query` update. The bot answers asynchronously; read the
   * answer with `getInlineQuery`.
   */
  sendInlineQuery(input: SendInlineQueryInput): Promise<InlineQuery>;
  /** Returns an inline query this account sent, with the bot's answer once given. */
  getInlineQuery(inlineQueryId: string): Promise<InlineQuery>;
  /**
   * Sends a result of the bot's answer to the chat where the query was typed, as this account's
   * message with `via_bot`. The chat's bots receive it as any message of this account, and a bot
   * with inline feedback receives a `chosen_inline_result` update. Presses of the message's
   * callback buttons reach the inline bot, which edits the message by its `inline_message_id`.
   * Media the result names by URL and sends without `input_message_content` is downloaded from the
   * session's web resources each time it is sent. Sending fails with status 502 when no resource
   * serves the media, and with status 422 when the resource serves media that is not of the
   * result's kind.
   */
  chooseInlineQueryResult(
    input: ChooseInlineQueryResultInput,
  ): Promise<PrivateMessage | SupergroupMessage>;
  /**
   * Returns the commands this account's client suggests in its private chat with a bot: the
   * bot's list for the chat, for all private chats, or by default, in the account's language if
   * the bot has one.
   */
  getBotCommands(input: AccountBotCommandsInput): Promise<readonly BotCommand[]>;
  /**
   * Returns the menu button this account's client shows in its private chat with a bot: the
   * bot's button for this account, or else for all its private chats.
   */
  getMenuButton(input: AccountMenuButtonInput): Promise<MenuButton>;
  /**
   * Returns the commands this account's client suggests in a supergroup it is a member of, for
   * each bot of the supergroup that has any: the bot's list for the account as a member, for the
   * supergroup's administrators, for the supergroup, for all groups' administrators, for all
   * groups, or by default, where administrator lists apply only to administrators, in the
   * account's language if the bot has one.
   */
  getSupergroupBotCommands(
    input: AccountSupergroupBotCommandsInput,
  ): Promise<readonly SupergroupBotCommands[]>;
  /**
   * Returns the reply keyboard or forced reply this account's client shows in its private chat
   * with a bot or in a supergroup it is a member of, or `null` when it shows its usual input. In a
   * supergroup, a bot's selective markup reaches only the members its message mentions and the
   * sender of the message it replies to.
   */
  getReplyInterface(input: AccountReplyInterfaceInput): Promise<ReplyInterface | null>;
  /**
   * Presses a button of the reply keyboard the chat shows, which sends the button's text as this
   * account's message; in a supergroup, the message replies to the keyboard's message, as
   * Telegram's clients send it. A `request_contact` button, which only private chats show, shares
   * the account's own contact instead, in reply to the keyboard's message, and fails for an
   * account created without a phone number; a `request_location` button likewise shares the
   * location the input reports, which it requires and no other button takes. A `request_users` or
   * `request_chat` button shares the `shared_user_ids` or `shared_chat_id` the input chooses,
   * which it requires and no other button takes, as a `users_shared` or `chat_shared` service
   * message that replies to nothing. A `request_poll` button sends the `poll` the input creates,
   * which it requires and no other button takes, as `sendPoll` sends one, without a reply; the
   * poll must be of the type the button requests, if any. A `web_app` button sends the
   * `web_app_data` the input gives, which it requires and no other button takes, as a
   * `web_app_data` service message with the button's text that replies to nothing. Fails when the
   * chat shows no keyboard with such a button, for a choice the request's criteria refuse, or for
   * data a Web App cannot send.
   */
  pressReplyKeyboardButton<Target extends MessageTarget>(
    input: PressReplyKeyboardButtonInput<Target>,
  ): Promise<MessageIn<Target>>;
}

export interface AccountChatActionsInput {
  readonly chat: MessageTarget;
}

/** The chat action a test expires: the bot's in a private chat, or one bot's in a supergroup. */
export type ExpireChatActionInput =
  | { readonly chat: PrivateMessageTarget; readonly botId?: never }
  | { readonly chat: SupergroupMessageTarget; readonly botId: number };

export interface AccountNotificationsInput {
  readonly chat: MessageTarget;
}

export interface AccountMessageDraftInput {
  readonly chat: PrivateMessageTarget;
}

/** The draft an action applies to: the one a private chat shows. */
export interface ShownMessageDraftInput {
  readonly chat: PrivateMessageTarget;
  /** The ID of the draft the test expects the chat to show; omitted for whichever it shows. */
  readonly draft_id?: string;
}

export interface AccountBotCommandsInput {
  readonly chat: PrivateMessageTarget;
}

export interface AccountMenuButtonInput {
  readonly chat: PrivateMessageTarget;
}

export interface AccountSupergroupBotCommandsInput {
  readonly chat: SupergroupMessageTarget;
}

export interface CreatedVirtualAccount {
  readonly account: VirtualAccountClient;
}

export type BotActivityKind = BotActivityEntry['kind'];

/** A file a call uploaded, described without its content. */
export interface UploadedFileDescription {
  /** The multipart field that carried the file. */
  readonly field_name: string;
  readonly file_name: string;
  readonly size_bytes: number;
}

/** The Bot API answer a bot received to a call. */
export type BotApiCallAnswer =
  | { readonly ok: true; readonly result: unknown; readonly description?: string }
  | {
    readonly ok: false;
    readonly error_code: number;
    readonly description: string;
    readonly parameters?: { readonly retry_after: number };
  };

/**
 * A bot's call of a Bot API method, whether it ran, failed, or is not implemented. `getUpdates`
 * calls are not recorded; the updates they deliver and confirm are.
 */
export interface BotApiCallEntry {
  /** Where the entry stands in the session's log; each entry's is 1 greater than the last. */
  readonly position: number;
  readonly kind: 'bot_api_call';
  readonly bot_id: number;
  /**
   * The method's current name, whichever name the bot called it by; the name as called for a
   * method the emulator does not implement.
   */
  readonly method: string;
  /** The method name as the bot called it. */
  readonly requested_method: string;
  /** Whether the call was an HTTP request or a webhook's response to an update. */
  readonly via: 'http' | 'webhook_reply';
  /**
   * The parameters as the bot sent them, as text: `chat_id: 1` is recorded as `"1"`, and structured
   * parameters such as `reply_markup` as JSON text. Empty when the request could not be decoded.
   */
  readonly parameters: Readonly<Record<string, string>>;
  readonly uploaded_files: readonly UploadedFileDescription[];
  /** The chat `chat_id` names, with a public username resolved; omitted when it names none. */
  readonly chat_id?: number;
  readonly answer: BotApiCallAnswer;
}

/** A Bot API update, such as grammY's `Update` describes. */
export interface BotApiUpdate {
  readonly update_id: number;
  readonly [updateType: string]: unknown;
}

/**
 * An update handed to a bot, in a `getUpdates` answer or in a request to its webhook; an update
 * handed over again is recorded each time.
 */
export interface UpdateDeliveredEntry {
  readonly position: number;
  readonly kind: 'update_delivered';
  readonly bot_id: number;
  readonly via: 'polling' | 'webhook';
  readonly update: BotApiUpdate;
  /** The chat the update happened in, as grammY's `ctx.chat` finds it; omitted when it has none. */
  readonly chat_id?: number;
  /**
   * The user whose action caused the update, as grammY's `ctx.from` finds it; omitted for a
   * poll's new state and a stopped message generation, which name no user.
   */
  readonly user_id?: number;
  /** The webhook attempt that handed the update over; present exactly when `via` is `webhook`. */
  readonly webhook_attempt_id?: number;
}

/**
 * An update the bot confirmed: by a `getUpdates` offset beyond it, or by its webhook's successful
 * answer to it, after any method the answer names has run.
 */
export interface UpdateConfirmedEntry {
  readonly position: number;
  readonly kind: 'update_confirmed';
  readonly bot_id: number;
  readonly via: 'polling' | 'webhook';
  readonly update_id: number;
  readonly chat_id?: number;
  /** As `UpdateDeliveredEntry` describes it. */
  readonly user_id?: number;
  /** The webhook attempt the webhook accepted; present exactly when `via` is `webhook`. */
  readonly webhook_attempt_id?: number;
}

/**
 * A failed attempt to deliver an update to a webhook, which leaves the update pending until the
 * attempt's retry is released.
 */
export interface WebhookAttemptFailedEntry {
  readonly position: number;
  readonly kind: 'webhook_attempt_failed';
  readonly bot_id: number;
  readonly update_id: number;
  readonly chat_id?: number;
  /** As `UpdateDeliveredEntry` describes it. */
  readonly user_id?: number;
  readonly webhook_attempt_id: number;
  readonly failure: WebhookAttemptFailure;
  /** The wait before the update is sent again that `automatic` scheduling observes. */
  readonly retry_delay_seconds: number;
}

/**
 * An entry of a session's bot activity log. Entries are positioned in the order the emulator
 * decided each outcome, which agrees with every order a bot enforces.
 */
export type BotActivityEntry =
  | BotApiCallEntry
  | UpdateDeliveredEntry
  | UpdateConfirmedEntry
  | WebhookAttemptFailedEntry;

/** A position in the bot activity log, or an entry, which stands at its position. */
export type BotActivityPosition = number | { readonly position: number };

/**
 * Which entries to look for, which the server applies; an entry must satisfy every criterion
 * given. Criteria that only calls have, `method`, `ok` and `parameters`, match no update entry, and
 * criteria that only updates have, `user_id` and `update_id`, match no call.
 */
export interface BotActivityCriteria {
  readonly bot_id?: number;
  readonly kind?: BotActivityKind;
  /** A method name, compared without regard to case; an older name finds its calls too. */
  readonly method?: string;
  readonly chat_id?: number;
  readonly user_id?: number;
  /**
   * The ID of the update delivered, confirmed, or failed to be delivered. Each bot numbers its
   * updates independently, so an ID names one update only together with `bot_id`.
   */
  readonly update_id?: number;
  /** Whether the call's answer was successful. */
  readonly ok?: boolean;
  /**
   * Parameter text the call must have sent, by parameter name, compared exactly. An empty map
   * still matches only calls.
   */
  readonly parameters?: Readonly<Record<string, string>>;
}

/** Criteria, and a predicate the client checks on the entries that satisfy them. */
export interface BotActivityFilter<Entry extends BotActivityEntry = BotActivityEntry>
  extends BotActivityCriteria {
  readonly where?: (entry: Entry) => boolean;
}

/**
 * A filter whose `where` predicate receives only the entries its criteria can match, such as a
 * `BotApiCallEntry` for criteria that name a `method`.
 *
 * The criteria are spelled as a mapped type so that TypeScript infers them from an object literal
 * whose `where` predicate leaves its parameter untyped; it infers nothing from a plain intersection
 * with such a literal. It infers them from one filter only, so a union of different filters needs
 * a declared type, such as `BotActivityCriteria`.
 */
export type BotActivityFilterFor<Criteria extends BotActivityCriteria> =
  & { readonly [Name in keyof Criteria]: Criteria[Name] }
  & BotActivityFilter<BotActivityEntryMatching<NoInfer<Criteria>>>;

/** The entries criteria can match, judged from the criteria they give. */
export type BotActivityEntryMatching<Criteria extends BotActivityCriteria> = Criteria extends
  { readonly kind: infer Kind extends BotActivityKind } ? Extract<BotActivityEntry, { kind: Kind }>
  : Criteria extends
    | { readonly method: string }
    | { readonly ok: boolean }
    | { readonly parameters: Readonly<Record<string, string>> } ? BotApiCallEntry
  : Criteria extends { readonly user_id: number } | { readonly update_id: number }
    ? UpdateDeliveredEntry | UpdateConfirmedEntry | WebhookAttemptFailedEntry
  : BotActivityEntry;

export interface BotActivityLogOptions {
  /** How long `waitFor` and `next` wait for a matching entry by default. Defaults to 5000. */
  readonly timeoutMs?: number;
}

export interface WaitForBotActivityOptions {
  /** Only entries after this position match. */
  readonly after: BotActivityPosition;
  /** How long to wait for a matching entry; defaults to the log's timeout. */
  readonly timeoutMs?: number;
  /**
   * Cancels the wait when it aborts: its pending read is abandoned, and the wait rejects with the
   * signal's reason, as `fetch` does.
   */
  readonly signal?: AbortSignal;
}

export interface BotActivityRange {
  /** Only entries after this position are checked. */
  readonly after: BotActivityPosition;
  /** Only entries before this position are checked; it must already be recorded. */
  readonly before: BotActivityPosition;
}

/**
 * A view of a session's bot activity log, whose base filter applies to every read in addition to
 * the filter each read gives.
 *
 * Positions are values, so any number of waits can start from the same position: waiting for B
 * after A and for C after A asserts that both follow A, whichever of them comes first.
 */
export interface BotActivityLog {
  /** The position of the latest entry; 0 while the log is empty. */
  position(): Promise<number>;
  /**
   * Returns the first matching entry after `after`, waiting for one to be recorded, and fails
   * with `BotActivityTimeoutError` when none is recorded in time.
   *
   * The wait's deadline is `timeoutMs` after the call. A read that holds for an entry is abandoned
   * if the emulator has not answered it, body included, by the deadline, and an answer received
   * later never counts. Reads of entries already recorded, those after a page that filled the read
   * limit up to the head it reported and the single read of a wait of 0 ms, may take one more
   * second. No read counts that settles after its cutoff: the deadline for a holding read, that
   * second later for the others. With a transport that does not block the event loop, a wait
   * therefore settles within `timeoutMs` plus that second, and sooner when `signal` aborts; a
   * transport that blocks the event loop delays the wait until it yields.
   */
  waitFor<const Criteria extends BotActivityCriteria>(
    filter: BotActivityFilterFor<Criteria>,
    options: WaitForBotActivityOptions,
  ): Promise<BotActivityEntryMatching<Criteria>>;
  /**
   * Checks that no entry between the positions matches, without waiting, and fails with
   * `UnexpectedBotActivityError` listing the entries that do.
   */
  assertNone<const Criteria extends BotActivityCriteria>(
    filter: BotActivityFilterFor<Criteria>,
    range: BotActivityRange,
  ): Promise<void>;
  /** A cursor that starts after `after` and moves past each entry it finds. */
  cursor(options: { readonly after: BotActivityPosition }): BotActivityCursor;
}

/** A position that moves forward past each entry it finds; other cursors are unaffected. */
export interface BotActivityCursor {
  /** The position the next search starts after. */
  readonly position: number;
  /**
   * Waits for the first matching entry after the cursor, as `waitFor` does, and moves the cursor
   * to it. A wait that fails or is cancelled leaves the cursor where it was.
   */
  next<const Criteria extends BotActivityCriteria>(
    filter: BotActivityFilterFor<Criteria>,
    options?: Omit<WaitForBotActivityOptions, 'after'>,
  ): Promise<BotActivityEntryMatching<Criteria>>;
}

export type HttpMethod = 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT';

export interface RequestDetails {
  readonly method: HttpMethod;
  readonly url: string;
}
