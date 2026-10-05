import type { z } from 'zod';

import { createBotActivityLog } from './bot_activity_log.ts';
import { HTTP_STATUS_CREATED, HTTP_STATUS_NO_CONTENT, HTTP_STATUS_OK } from './constants.ts';
import { ButtonSelectionError, findButton } from './message_buttons.ts';
import {
  botCommandsResponseSchema,
  callbackQueryResponseSchema,
  chatActionsResponseSchema,
  chatAdministratorsResponseSchema,
  chatJoinRequestsResponseSchema,
  chatJoinResponseSchema,
  chosenInlineResultResponseSchema,
  createdSupergroupResponseSchema,
  createdVirtualAccountSchema,
  createdVirtualBotSchema,
  expiredInviteLinkResponseSchema,
  expiredPollResponseSchema,
  expiredRequesterContactResponseSchema,
  expiredRestrictionResponseSchema,
  getMeResponseSchema,
  inlineQueryResponseSchema,
  menuButtonResponseSchema,
  messageHistoryResponseSchema,
  messageReactionsResponseSchema,
  notificationsResponseSchema,
  pollAnswerResponseSchema,
  rateLimitResponsesListSchema,
  rateLimitResponsesSchema,
  replyInterfaceResponseSchema,
  sentMediaGroupResponseSchema,
  sentMessageResponseSchema,
  sentSupergroupMediaGroupResponseSchema,
  sentSupergroupMessageResponseSchema,
  serverErrorResponsesListSchema,
  serverErrorResponsesSchema,
  supergroupBotCommandsResponseSchema,
  supergroupInviteLinksResponseSchema,
  supergroupMessageHistoryResponseSchema,
  supergroupPollAnswerResponseSchema,
  webhookAttemptListSchema,
  webhookAttemptSchema,
  webhookDeliverySchema,
  webResourceSchema,
} from './schemas.ts';
import type {
  AccountBotCommandsInput,
  AccountChatActionsInput,
  AccountChatAdministratorsInput,
  AccountChatInviteLinksInput,
  AccountChatJoinRequestsInput,
  AccountDeleteMessageInput,
  AccountEditMessageCaptionInput,
  AccountEditMessageInput,
  AccountForwardMessageInput,
  AccountMediaGroupItem,
  AccountMenuButtonInput,
  AccountMessageHistoryInput,
  AccountNotificationsInput,
  AccountPinMessageInput,
  AccountPinnedMessagesInput,
  AccountPollAnswer,
  AccountPollMessageInput,
  AccountReactionMessageInput,
  AccountReplyInterfaceInput,
  AccountSendAudioInput,
  AccountSendContactInput,
  AccountSendDocumentInput,
  AccountSendLocationInput,
  AccountSendMediaGroupInput,
  AccountSendMessageInput,
  AccountSendPhotoInput,
  AccountSendPollInput,
  AccountSendVideoInput,
  AccountSendVoiceInput,
  AccountShareOwnContactInput,
  AccountSupergroupBotCommandsInput,
  AddChatMemberInput,
  AnswerPollInput,
  BotActivityCriteria,
  BotActivityFilterFor,
  BotActivityLog,
  BotActivityLogOptions,
  BotBlockInput,
  BotCommand,
  CallbackQuery,
  ChangeSupergroupDescriptionInput,
  ChangeSupergroupTitleInput,
  ChatAction,
  ChatJoin,
  ChatJoinRequest,
  ChooseInlineQueryResultInput,
  CreatedVirtualAccount,
  CreatedVirtualBot,
  CreateSupergroupInput,
  CreateVirtualAccountInput,
  CreateVirtualBotInput,
  DemoteChatMemberInput,
  EmulationSession,
  ExpireChatInviteLinkInput,
  ExpireChatMemberRestrictionInput,
  ExpireJoinRequesterContactInput,
  InlineQuery,
  JoinChatByInviteLinkInput,
  JoinChatInput,
  LeaveChatInput,
  LiftChatMemberRestrictionInput,
  MenuButton,
  MessageIn,
  MessageReactions,
  MessageTarget,
  Notification,
  Poll,
  PressButtonInput,
  PressCallbackButtonInput,
  PressReplyKeyboardButtonInput,
  PrivateMessage,
  PromoteChatMemberInput,
  QueueRateLimitResponsesInput,
  QueueServerErrorResponsesInput,
  RateLimitResponses,
  RegisterWebResourceInput,
  RemoveChatMemberInput,
  ReplyInterface,
  RestrictChatMemberInput,
  SendInlineQueryInput,
  ServerErrorResponses,
  SetChatPermissionsInput,
  SetContentProtectionInput,
  SetCustomTitleInput,
  SetMessageReactionInput,
  SetWebhookDeliveryInput,
  Supergroup,
  SupergroupAdministrator,
  SupergroupBotCommands,
  SupergroupInviteLink,
  SupergroupMessage,
  UploadProfile,
  VirtualAccountClient,
  VirtualAccountProfile,
  VirtualBotProfile,
  WebhookAttempt,
  WebhookAttemptControlInput,
  WebhookDelivery,
  WebResource,
} from './types.ts';
import { normalizeUrlRoot, requestBytes, requestEmptyResponse, requestJson } from './utils.ts';

export interface EmulationSessionClient extends EmulationSession {
  /** Ends the session and discards all state owned by it. */
  end(): Promise<void>;
  createBot(input: CreateVirtualBotInput): Promise<CreatedVirtualBot>;
  createAccount(input: CreateVirtualAccountInput): Promise<CreatedVirtualAccount>;
  /** Calls the emulated Bot API getMe method with a virtual bot token. */
  getMe(botToken: string): Promise<VirtualBotProfile>;
  /**
   * Makes a bot's next calls of a method, or of every method, fail with `429 Too Many Requests`,
   * for testing how the bot handles Telegram's rate limits.
   */
  queueRateLimitResponses(input: QueueRateLimitResponsesInput): Promise<RateLimitResponses>;
  /** Lists the rate limit answers still queued for a bot, earliest first. */
  getRateLimitResponses(botId: number): Promise<readonly RateLimitResponses[]>;
  /**
   * Makes a bot's next calls of a method, or of every method, fail with `500 Internal Server
   * Error` or `503 Service Unavailable` before they run, for testing how the bot retries or falls
   * back. Queued rate limit answers apply first.
   */
  queueServerErrorResponses(input: QueueServerErrorResponsesInput): Promise<ServerErrorResponses>;
  /** Lists the server error answers still queued for a bot, earliest first. */
  getServerErrorResponses(botId: number): Promise<readonly ServerErrorResponses[]>;
  /**
   * Chooses who ends a bot's webhook delivery attempts and retry waits from now on: the emulator
   * by its own timing (`automatic`, the default), or only the test (`manual`), through
   * `expireWebhookAttempt` and `releaseWebhookRetry`. These are emulator controls, not Telegram's
   * timing.
   */
  setWebhookDelivery(input: SetWebhookDeliveryInput): Promise<WebhookDelivery>;
  getWebhookDelivery(botId: number): Promise<WebhookDelivery>;
  /** Lists every attempt to deliver an update to a bot's webhook, earliest first. */
  getWebhookAttempts(botId: number): Promise<readonly WebhookAttempt[]>;
  /**
   * Sends a failed attempt's update again without waiting for its retry delay, and returns the
   * attempt. Fails with status `409` when the retry is not waiting.
   */
  releaseWebhookRetry(input: WebhookAttemptControlInput): Promise<WebhookAttempt>;
  /**
   * Makes the deadline of an attempt in flight arrive, as its timeout passing does, and returns
   * the attempt once its outcome is decided. Fails with status `409` when the attempt is no longer
   * in flight.
   */
  expireWebhookAttempt(input: WebhookAttemptControlInput): Promise<WebhookAttempt>;
  /**
   * Returns the content of a file of the session's messages, such as a photo, by its
   * `file_unique_id`, which, unlike `file_id`, is the same for every user.
   */
  downloadFile(fileUniqueId: string): Promise<Uint8Array>;
  /**
   * Registers what a URL of the session's emulated web serves, replacing what it served before.
   * Telegram downloads the files bots send by URL; the emulator downloads them from these
   * resources, and a URL without one is unreachable.
   */
  registerWebResource(input: RegisterWebResourceInput): Promise<WebResource>;
  /**
   * Closes a poll as its `close_date` arriving does, and returns it as the bot that sent it sees
   * it. The emulator does not close polls as time passes, so tests choose when a poll sent with
   * `open_period` or `close_date` closes; the bot receives a `poll` update with the closed poll.
   */
  expirePoll(pollId: string): Promise<Poll>;
  /**
   * Ends a user's temporary restriction in a supergroup as its `until_date` arriving does, and
   * returns the user's standing after it: `member`, or `left` for a user that is not a member. The
   * emulator does not lift restrictions as time passes, so tests choose when one ends; no bot
   * receives an update for it.
   */
  expireChatMemberRestriction(input: ExpireChatMemberRestrictionInput): Promise<'member' | 'left'>;
  /**
   * Makes an invite link's `expire_date` arrive, and returns the link as the supergroup's owner
   * sees it. The emulator does not let time pass by itself, so tests choose when a link created
   * with `expire_date` stops admitting users; the members that joined through it stay.
   */
  expireChatInviteLink(input: ExpireChatInviteLinkInput): Promise<SupergroupInviteLink>;
  /**
   * Ends a pending join request's contact window as its five minutes passing does, and returns the
   * request as the supergroup's owner sees it. The emulator does not let time pass by itself, so
   * tests choose when the bots that received the request stop being able to write to a user that
   * never started them; bots the user started keep writing to it, and the request stays pending.
   */
  expireJoinRequesterContact(input: ExpireJoinRequesterContactInput): Promise<ChatJoinRequest>;
  /**
   * A view of the session's bot activity log: the Bot API calls its bots make, with their answers,
   * and the updates delivered to and confirmed by them. `filter` applies to every read of the
   * view, such as `{ bot_id }` for one bot's activity.
   */
  botActivity<const Criteria extends BotActivityCriteria>(
    filter?: BotActivityFilterFor<Criteria>,
    options?: BotActivityLogOptions,
  ): BotActivityLog;
}

export function createEmulationSessionClient(
  serverRoot: URL,
  session: EmulationSession,
  fetchImplementation: typeof globalThis.fetch,
): EmulationSessionClient {
  return new HttpEmulationSessionClient(serverRoot, session, fetchImplementation);
}

class HttpEmulationSessionClient implements EmulationSessionClient {
  readonly id: string;
  readonly botApiRoot: string;
  readonly uploadProfile: UploadProfile;
  readonly #sessionUrl: string;
  readonly #botApiRoot: URL;
  readonly #fetch: typeof globalThis.fetch;

  constructor(
    serverRoot: URL,
    session: EmulationSession,
    fetchImplementation: typeof globalThis.fetch,
  ) {
    this.id = session.id;
    this.botApiRoot = session.botApiRoot;
    this.uploadProfile = session.uploadProfile;
    this.#sessionUrl = new URL(`sessions/${encodeURIComponent(session.id)}`, serverRoot).href;
    this.#botApiRoot = normalizeUrlRoot(session.botApiRoot, 'botApiRoot');
    this.#fetch = fetchImplementation;
  }

  async end(): Promise<void> {
    await requestEmptyResponse(this.#fetch, {
      method: 'DELETE',
      url: this.#sessionUrl,
      expectedStatus: HTTP_STATUS_NO_CONTENT,
    });
  }

  createBot(input: CreateVirtualBotInput): Promise<CreatedVirtualBot> {
    return requestJson(this.#fetch, {
      method: 'POST',
      url: `${this.#sessionUrl}/bots`,
      expectedStatus: HTTP_STATUS_CREATED,
      responseSchema: createdVirtualBotSchema,
      body: input,
    });
  }

  async createAccount(input: CreateVirtualAccountInput): Promise<CreatedVirtualAccount> {
    const response = await requestJson(this.#fetch, {
      method: 'POST',
      url: `${this.#sessionUrl}/accounts`,
      expectedStatus: HTTP_STATUS_CREATED,
      responseSchema: createdVirtualAccountSchema,
      body: input,
    });
    return {
      account: createVirtualAccountClient(
        response.account,
        `${this.#sessionUrl}/accounts/${response.account.id}`,
        this.#fetch,
      ),
    };
  }

  async getMe(botToken: string): Promise<VirtualBotProfile> {
    validateBotToken(botToken);

    const response = await requestJson(this.#fetch, {
      method: 'POST',
      url: new URL(`bot${encodeURIComponent(botToken)}/getMe`, this.#botApiRoot).href,
      expectedStatus: HTTP_STATUS_OK,
      responseSchema: getMeResponseSchema,
    });
    return response.result;
  }

  queueRateLimitResponses(
    { bot_id: botId, ...request }: QueueRateLimitResponsesInput,
  ): Promise<RateLimitResponses> {
    return requestJson(this.#fetch, {
      method: 'POST',
      url: `${this.#sessionUrl}/bots/${botId}/rate-limit-responses`,
      expectedStatus: HTTP_STATUS_CREATED,
      responseSchema: rateLimitResponsesSchema,
      body: request,
    });
  }

  async getRateLimitResponses(botId: number): Promise<readonly RateLimitResponses[]> {
    const response = await requestJson(this.#fetch, {
      method: 'GET',
      url: `${this.#sessionUrl}/bots/${botId}/rate-limit-responses`,
      expectedStatus: HTTP_STATUS_OK,
      responseSchema: rateLimitResponsesListSchema,
    });
    return response.rate_limit_responses;
  }

  queueServerErrorResponses(
    { bot_id: botId, ...request }: QueueServerErrorResponsesInput,
  ): Promise<ServerErrorResponses> {
    return requestJson(this.#fetch, {
      method: 'POST',
      url: `${this.#sessionUrl}/bots/${botId}/server-error-responses`,
      expectedStatus: HTTP_STATUS_CREATED,
      responseSchema: serverErrorResponsesSchema,
      body: request,
    });
  }

  async getServerErrorResponses(botId: number): Promise<readonly ServerErrorResponses[]> {
    const response = await requestJson(this.#fetch, {
      method: 'GET',
      url: `${this.#sessionUrl}/bots/${botId}/server-error-responses`,
      expectedStatus: HTTP_STATUS_OK,
      responseSchema: serverErrorResponsesListSchema,
    });
    return response.server_error_responses;
  }

  setWebhookDelivery(
    { bot_id: botId, ...request }: SetWebhookDeliveryInput,
  ): Promise<WebhookDelivery> {
    return requestJson(this.#fetch, {
      method: 'PUT',
      url: `${this.#sessionUrl}/bots/${botId}/webhook-delivery`,
      expectedStatus: HTTP_STATUS_OK,
      responseSchema: webhookDeliverySchema,
      body: request,
    });
  }

  getWebhookDelivery(botId: number): Promise<WebhookDelivery> {
    return requestJson(this.#fetch, {
      method: 'GET',
      url: `${this.#sessionUrl}/bots/${botId}/webhook-delivery`,
      expectedStatus: HTTP_STATUS_OK,
      responseSchema: webhookDeliverySchema,
    });
  }

  async getWebhookAttempts(botId: number): Promise<readonly WebhookAttempt[]> {
    const response = await requestJson(this.#fetch, {
      method: 'GET',
      url: `${this.#sessionUrl}/bots/${botId}/webhook-attempts`,
      expectedStatus: HTTP_STATUS_OK,
      responseSchema: webhookAttemptListSchema,
    });
    return response.webhook_attempts;
  }

  releaseWebhookRetry({ botId, attemptId }: WebhookAttemptControlInput): Promise<WebhookAttempt> {
    return requestJson(this.#fetch, {
      method: 'POST',
      url: `${this.#sessionUrl}/bots/${botId}/webhook-attempts/${attemptId}/retry-release`,
      expectedStatus: HTTP_STATUS_OK,
      responseSchema: webhookAttemptSchema,
    });
  }

  expireWebhookAttempt({ botId, attemptId }: WebhookAttemptControlInput): Promise<WebhookAttempt> {
    return requestJson(this.#fetch, {
      method: 'POST',
      url: `${this.#sessionUrl}/bots/${botId}/webhook-attempts/${attemptId}/expiry`,
      expectedStatus: HTTP_STATUS_OK,
      responseSchema: webhookAttemptSchema,
    });
  }

  downloadFile(fileUniqueId: string): Promise<Uint8Array> {
    return requestBytes(this.#fetch, {
      method: 'GET',
      url: `${this.#sessionUrl}/files/${encodeURIComponent(fileUniqueId)}`,
      expectedStatus: HTTP_STATUS_OK,
    });
  }

  async expirePoll(pollId: string): Promise<Poll> {
    const response = await requestJson(this.#fetch, {
      method: 'POST',
      url: `${this.#sessionUrl}/polls/${encodeURIComponent(pollId)}/expiry`,
      expectedStatus: HTTP_STATUS_OK,
      responseSchema: expiredPollResponseSchema,
    });
    return response.poll;
  }

  async expireChatMemberRestriction(
    { chatId, userId }: ExpireChatMemberRestrictionInput,
  ): Promise<'member' | 'left'> {
    const response = await requestJson(this.#fetch, {
      method: 'POST',
      url: `${this.#sessionUrl}/supergroups/${encodeURIComponent(chatId)}/restrictions/${
        encodeURIComponent(userId)
      }/expiry`,
      expectedStatus: HTTP_STATUS_OK,
      responseSchema: expiredRestrictionResponseSchema,
    });
    return response.chat_member.status;
  }

  async expireChatInviteLink(
    { chatId, inviteLink }: ExpireChatInviteLinkInput,
  ): Promise<SupergroupInviteLink> {
    const response = await requestJson(this.#fetch, {
      method: 'POST',
      url: `${this.#sessionUrl}/supergroups/${encodeURIComponent(chatId)}/invite-links/${
        encodeURIComponent(getInviteLinkHash(inviteLink))
      }/expiry`,
      expectedStatus: HTTP_STATUS_OK,
      responseSchema: expiredInviteLinkResponseSchema,
    });
    return response.invite_link;
  }

  async expireJoinRequesterContact(
    { chatId, userId }: ExpireJoinRequesterContactInput,
  ): Promise<ChatJoinRequest> {
    const response = await requestJson(this.#fetch, {
      method: 'POST',
      url: `${this.#sessionUrl}/supergroups/${encodeURIComponent(chatId)}/join-requests/${
        encodeURIComponent(userId)
      }/requester-contact/expiry`,
      expectedStatus: HTTP_STATUS_OK,
      responseSchema: expiredRequesterContactResponseSchema,
    });
    return response.join_request;
  }

  registerWebResource({ content, ...input }: RegisterWebResourceInput): Promise<WebResource> {
    return requestJson(this.#fetch, {
      method: 'POST',
      url: `${this.#sessionUrl}/web-resources`,
      expectedStatus: HTTP_STATUS_CREATED,
      responseSchema: webResourceSchema,
      body: { ...input, ...(content === undefined ? {} : { content_base64: content.toBase64() }) },
    });
  }

  botActivity<const Criteria extends BotActivityCriteria>(
    filter?: BotActivityFilterFor<Criteria>,
    options: BotActivityLogOptions = {},
  ): BotActivityLog {
    return createBotActivityLog(`${this.#sessionUrl}/bot-activity`, this.#fetch, filter, options);
  }
}

function createVirtualAccountClient(
  profile: VirtualAccountProfile,
  accountUrl: string,
  fetchImplementation: typeof globalThis.fetch,
): VirtualAccountClient {
  async function getMessages<Target extends MessageTarget>(
    input: AccountMessageHistoryInput<Target>,
  ): Promise<readonly MessageIn<Target>[]> {
    const response = await requestJson(fetchImplementation, {
      method: 'GET',
      url: `${conversationUrl(accountUrl, input.chat)}/messages`,
      expectedStatus: HTTP_STATUS_OK,
      responseSchema: messageResponseSchemasFor(input.chat).history,
    });
    return response.messages;
  }

  async function pressCallbackButton(input: PressCallbackButtonInput): Promise<CallbackQuery> {
    const response = await requestJson(fetchImplementation, {
      method: 'POST',
      url: `${accountUrl}/callback-queries`,
      expectedStatus: HTTP_STATUS_CREATED,
      responseSchema: callbackQueryResponseSchema,
      body: input,
    });
    return response.callback_query;
  }

  return Object.freeze({
    ...profile,
    async sendMessage<Target extends MessageTarget>(
      input: AccountSendMessageInput<Target>,
    ): Promise<MessageIn<Target>> {
      const response = await requestJson(fetchImplementation, {
        method: 'POST',
        url: `${accountUrl}/messages`,
        expectedStatus: HTTP_STATUS_CREATED,
        responseSchema: messageResponseSchemasFor(input.to).sent,
        body: input,
      });
      return response.message;
    },
    async sendPhoto<Target extends MessageTarget>(
      { to, photo, caption, caption_entities, reply_to_message_id }: AccountSendPhotoInput<Target>,
    ): Promise<MessageIn<Target>> {
      const response = await requestJson(fetchImplementation, {
        method: 'POST',
        url: `${accountUrl}/messages`,
        expectedStatus: HTTP_STATUS_CREATED,
        responseSchema: messageResponseSchemasFor(to).sent,
        body: {
          to,
          photo: { content_base64: photo.toBase64() },
          caption,
          caption_entities,
          reply_to_message_id,
        },
      });
      return response.message;
    },
    async sendDocument<Target extends MessageTarget>(
      {
        to,
        document,
        file_name,
        caption,
        caption_entities,
        reply_to_message_id,
      }: AccountSendDocumentInput<Target>,
    ): Promise<MessageIn<Target>> {
      const response = await requestJson(fetchImplementation, {
        method: 'POST',
        url: `${accountUrl}/messages`,
        expectedStatus: HTTP_STATUS_CREATED,
        responseSchema: messageResponseSchemasFor(to).sent,
        body: {
          to,
          document: { content_base64: document.toBase64(), file_name },
          caption,
          caption_entities,
          reply_to_message_id,
        },
      });
      return response.message;
    },
    async sendVideo<Target extends MessageTarget>(
      {
        to,
        video,
        file_name,
        duration,
        width,
        height,
        caption,
        caption_entities,
        reply_to_message_id,
      }: AccountSendVideoInput<Target>,
    ): Promise<MessageIn<Target>> {
      const response = await requestJson(fetchImplementation, {
        method: 'POST',
        url: `${accountUrl}/messages`,
        expectedStatus: HTTP_STATUS_CREATED,
        responseSchema: messageResponseSchemasFor(to).sent,
        body: {
          to,
          video: toAccountVideoUpload({ video, file_name, duration, width, height }),
          caption,
          caption_entities,
          reply_to_message_id,
        },
      });
      return response.message;
    },
    async sendVoice<Target extends MessageTarget>(
      { to, voice, duration, caption, caption_entities, reply_to_message_id }:
        AccountSendVoiceInput<
          Target
        >,
    ): Promise<MessageIn<Target>> {
      const response = await requestJson(fetchImplementation, {
        method: 'POST',
        url: `${accountUrl}/messages`,
        expectedStatus: HTTP_STATUS_CREATED,
        responseSchema: messageResponseSchemasFor(to).sent,
        body: {
          to,
          voice: { content_base64: voice.toBase64(), duration },
          caption,
          caption_entities,
          reply_to_message_id,
        },
      });
      return response.message;
    },
    async sendAudio<Target extends MessageTarget>(
      {
        to,
        audio,
        file_name,
        duration,
        performer,
        title,
        caption,
        caption_entities,
        reply_to_message_id,
      }: AccountSendAudioInput<Target>,
    ): Promise<MessageIn<Target>> {
      const response = await requestJson(fetchImplementation, {
        method: 'POST',
        url: `${accountUrl}/messages`,
        expectedStatus: HTTP_STATUS_CREATED,
        responseSchema: messageResponseSchemasFor(to).sent,
        body: {
          to,
          audio: toAccountAudioUpload({ audio, file_name, duration, performer, title }),
          caption,
          caption_entities,
          reply_to_message_id,
        },
      });
      return response.message;
    },
    async sendContact<Target extends MessageTarget>(
      input: AccountSendContactInput<Target>,
    ): Promise<MessageIn<Target>> {
      const response = await requestJson(fetchImplementation, {
        method: 'POST',
        url: `${accountUrl}/messages`,
        expectedStatus: HTTP_STATUS_CREATED,
        responseSchema: messageResponseSchemasFor(input.to).sent,
        body: input,
      });
      return response.message;
    },
    async shareOwnContact<Target extends MessageTarget>(
      { to, reply_to_message_id }: AccountShareOwnContactInput<Target>,
    ): Promise<MessageIn<Target>> {
      const response = await requestJson(fetchImplementation, {
        method: 'POST',
        url: `${accountUrl}/messages`,
        expectedStatus: HTTP_STATUS_CREATED,
        responseSchema: messageResponseSchemasFor(to).sent,
        body: { to, own_contact: true, reply_to_message_id },
      });
      return response.message;
    },
    async sendLocation<Target extends MessageTarget>(
      input: AccountSendLocationInput<Target>,
    ): Promise<MessageIn<Target>> {
      const response = await requestJson(fetchImplementation, {
        method: 'POST',
        url: `${accountUrl}/messages`,
        expectedStatus: HTTP_STATUS_CREATED,
        responseSchema: messageResponseSchemasFor(input.to).sent,
        body: input,
      });
      return response.message;
    },
    async sendPoll<Target extends MessageTarget>(
      input: AccountSendPollInput<Target>,
    ): Promise<MessageIn<Target>> {
      const response = await requestJson(fetchImplementation, {
        method: 'POST',
        url: `${accountUrl}/messages`,
        expectedStatus: HTTP_STATUS_CREATED,
        responseSchema: messageResponseSchemasFor(input.to).sent,
        body: input,
      });
      return response.message;
    },
    async sendMediaGroup<Target extends MessageTarget>(
      { to, media, reply_to_message_id }: AccountSendMediaGroupInput<Target>,
    ): Promise<readonly MessageIn<Target>[]> {
      const response = await requestJson(fetchImplementation, {
        method: 'POST',
        url: `${accountUrl}/media-groups`,
        expectedStatus: HTTP_STATUS_CREATED,
        responseSchema: messageResponseSchemasFor(to).sentAlbum,
        body: {
          to,
          media: media.map((item) => ({
            ...toAccountMediaGroupFile(item),
            caption: item.caption,
            caption_entities: item.caption_entities,
          })),
          reply_to_message_id,
        },
      });
      return response.messages;
    },
    async forwardMessage<Target extends MessageTarget>(
      { from, message_id, to }: AccountForwardMessageInput<Target>,
    ): Promise<MessageIn<Target>> {
      const response = await requestJson(fetchImplementation, {
        method: 'POST',
        url: `${accountUrl}/messages`,
        expectedStatus: HTTP_STATUS_CREATED,
        responseSchema: messageResponseSchemasFor(to).sent,
        body: { to, forward: { chat: from, message_id } },
      });
      return response.message;
    },
    async editMessage<Target extends MessageTarget>(
      input: AccountEditMessageInput<Target>,
    ): Promise<MessageIn<Target>> {
      const messageId = encodeURIComponent(input.message_id);
      const response = await requestJson(fetchImplementation, {
        method: 'PATCH',
        url: `${conversationUrl(accountUrl, input.chat)}/messages/${messageId}`,
        expectedStatus: HTTP_STATUS_OK,
        responseSchema: messageResponseSchemasFor(input.chat).sent,
        body: { text: input.text, entities: input.entities },
      });
      return response.message;
    },
    async editMessageCaption<Target extends MessageTarget>(
      input: AccountEditMessageCaptionInput<Target>,
    ): Promise<MessageIn<Target>> {
      const messageId = encodeURIComponent(input.message_id);
      const response = await requestJson(fetchImplementation, {
        method: 'PATCH',
        url: `${conversationUrl(accountUrl, input.chat)}/messages/${messageId}`,
        expectedStatus: HTTP_STATUS_OK,
        responseSchema: messageResponseSchemasFor(input.chat).sent,
        body: { caption: input.caption, caption_entities: input.caption_entities },
      });
      return response.message;
    },
    async deleteMessage(input: AccountDeleteMessageInput): Promise<void> {
      const messageId = encodeURIComponent(input.message_id);
      await requestEmptyResponse(fetchImplementation, {
        method: 'DELETE',
        url: `${conversationUrl(accountUrl, input.chat)}/messages/${messageId}`,
        expectedStatus: HTTP_STATUS_NO_CONTENT,
      });
    },
    async createSupergroup(input: CreateSupergroupInput): Promise<Supergroup> {
      const response = await requestJson(fetchImplementation, {
        method: 'POST',
        url: `${accountUrl}/supergroups`,
        expectedStatus: HTTP_STATUS_CREATED,
        responseSchema: createdSupergroupResponseSchema,
        body: input,
      });
      return response.supergroup;
    },
    async addChatMember(input: AddChatMemberInput): Promise<void> {
      await requestEmptyResponse(fetchImplementation, {
        method: 'PUT',
        url: `${conversationUrl(accountUrl, input.chat)}/members/${
          encodeURIComponent(input.userId)
        }`,
        expectedStatus: HTTP_STATUS_NO_CONTENT,
      });
    },
    async removeChatMember(input: RemoveChatMemberInput): Promise<void> {
      await requestEmptyResponse(fetchImplementation, {
        method: 'DELETE',
        url: `${conversationUrl(accountUrl, input.chat)}/members/${
          encodeURIComponent(input.userId)
        }`,
        expectedStatus: HTTP_STATUS_NO_CONTENT,
      });
    },
    async leaveChat(input: LeaveChatInput): Promise<void> {
      await requestEmptyResponse(fetchImplementation, {
        method: 'DELETE',
        url: `${conversationUrl(accountUrl, input.chat)}/members/${encodeURIComponent(profile.id)}`,
        expectedStatus: HTTP_STATUS_NO_CONTENT,
      });
    },
    async joinChat(input: JoinChatInput): Promise<void> {
      await requestEmptyResponse(fetchImplementation, {
        method: 'PUT',
        url: `${conversationUrl(accountUrl, input.chat)}/members/${encodeURIComponent(profile.id)}`,
        expectedStatus: HTTP_STATUS_NO_CONTENT,
      });
    },
    joinChatByInviteLink(input: JoinChatByInviteLinkInput): Promise<ChatJoin> {
      return requestJson(fetchImplementation, {
        method: 'POST',
        url: `${accountUrl}/chat-joins`,
        expectedStatus: HTTP_STATUS_OK,
        responseSchema: chatJoinResponseSchema,
        body: { invite_link: input.inviteLink },
      });
    },
    async getChatInviteLinks(
      input: AccountChatInviteLinksInput,
    ): Promise<readonly SupergroupInviteLink[]> {
      const response = await requestJson(fetchImplementation, {
        method: 'GET',
        url: `${conversationUrl(accountUrl, input.chat)}/invite-links`,
        expectedStatus: HTTP_STATUS_OK,
        responseSchema: supergroupInviteLinksResponseSchema,
      });
      return response.invite_links;
    },
    async getChatJoinRequests(
      input: AccountChatJoinRequestsInput,
    ): Promise<readonly ChatJoinRequest[]> {
      const response = await requestJson(fetchImplementation, {
        method: 'GET',
        url: `${conversationUrl(accountUrl, input.chat)}/join-requests`,
        expectedStatus: HTTP_STATUS_OK,
        responseSchema: chatJoinRequestsResponseSchema,
      });
      return response.join_requests;
    },
    async promoteChatMember(input: PromoteChatMemberInput): Promise<void> {
      await requestEmptyResponse(fetchImplementation, {
        method: 'PUT',
        url: `${conversationUrl(accountUrl, input.chat)}/administrators/${
          encodeURIComponent(input.userId)
        }`,
        expectedStatus: HTTP_STATUS_NO_CONTENT,
        body: input.rights,
      });
    },
    async getChatAdministrators(
      input: AccountChatAdministratorsInput,
    ): Promise<readonly SupergroupAdministrator[]> {
      const response = await requestJson(fetchImplementation, {
        method: 'GET',
        url: `${conversationUrl(accountUrl, input.chat)}/administrators`,
        expectedStatus: HTTP_STATUS_OK,
        responseSchema: chatAdministratorsResponseSchema,
      });
      return response.administrators;
    },
    async demoteChatMember(input: DemoteChatMemberInput): Promise<void> {
      await requestEmptyResponse(fetchImplementation, {
        method: 'DELETE',
        url: `${conversationUrl(accountUrl, input.chat)}/administrators/${
          encodeURIComponent(input.userId)
        }`,
        expectedStatus: HTTP_STATUS_NO_CONTENT,
      });
    },
    async restrictChatMember(input: RestrictChatMemberInput): Promise<void> {
      await requestEmptyResponse(fetchImplementation, {
        method: 'PUT',
        url: `${conversationUrl(accountUrl, input.chat)}/restrictions/${
          encodeURIComponent(input.userId)
        }`,
        expectedStatus: HTTP_STATUS_NO_CONTENT,
        body: {
          permissions: input.permissions,
          ...(input.untilDate === undefined ? {} : { until_date: input.untilDate }),
        },
      });
    },
    async liftChatMemberRestriction(input: LiftChatMemberRestrictionInput): Promise<void> {
      await requestEmptyResponse(fetchImplementation, {
        method: 'DELETE',
        url: `${conversationUrl(accountUrl, input.chat)}/restrictions/${
          encodeURIComponent(input.userId)
        }`,
        expectedStatus: HTTP_STATUS_NO_CONTENT,
      });
    },
    async setChatPermissions(input: SetChatPermissionsInput): Promise<void> {
      await requestEmptyResponse(fetchImplementation, {
        method: 'PUT',
        url: `${conversationUrl(accountUrl, input.chat)}/permissions`,
        expectedStatus: HTTP_STATUS_NO_CONTENT,
        body: { permissions: input.permissions },
      });
    },
    async setCustomTitle(input: SetCustomTitleInput): Promise<void> {
      await requestEmptyResponse(fetchImplementation, {
        method: 'PUT',
        url: `${conversationUrl(accountUrl, input.chat)}/administrators/${
          encodeURIComponent(input.userId)
        }/custom-title`,
        expectedStatus: HTTP_STATUS_NO_CONTENT,
        body: { custom_title: input.customTitle },
      });
    },
    async setContentProtection(input: SetContentProtectionInput): Promise<void> {
      await requestEmptyResponse(fetchImplementation, {
        method: input.hasProtectedContent ? 'PUT' : 'DELETE',
        url: `${conversationUrl(accountUrl, input.chat)}/content-protection`,
        expectedStatus: HTTP_STATUS_NO_CONTENT,
      });
    },
    async changeSupergroupTitle(input: ChangeSupergroupTitleInput): Promise<void> {
      await requestEmptyResponse(fetchImplementation, {
        method: 'PUT',
        url: `${conversationUrl(accountUrl, input.chat)}/title`,
        expectedStatus: HTTP_STATUS_NO_CONTENT,
        body: { title: input.title },
      });
    },
    async changeSupergroupDescription(input: ChangeSupergroupDescriptionInput): Promise<void> {
      await requestEmptyResponse(fetchImplementation, {
        method: 'PUT',
        url: `${conversationUrl(accountUrl, input.chat)}/description`,
        expectedStatus: HTTP_STATUS_NO_CONTENT,
        body: { description: input.description },
      });
    },
    async blockBot(input: BotBlockInput): Promise<void> {
      await requestEmptyResponse(fetchImplementation, {
        method: 'PUT',
        url: `${accountUrl}/blocked-bots/${encodeURIComponent(input.botId)}`,
        expectedStatus: HTTP_STATUS_NO_CONTENT,
      });
    },
    async unblockBot(input: BotBlockInput): Promise<void> {
      await requestEmptyResponse(fetchImplementation, {
        method: 'DELETE',
        url: `${accountUrl}/blocked-bots/${encodeURIComponent(input.botId)}`,
        expectedStatus: HTTP_STATUS_NO_CONTENT,
      });
    },
    getMessages,
    async pinMessage(input: AccountPinMessageInput): Promise<void> {
      await requestEmptyResponse(fetchImplementation, {
        method: 'PUT',
        url: pinnedMessageUrl(accountUrl, input),
        expectedStatus: HTTP_STATUS_NO_CONTENT,
      });
    },
    async unpinMessage(input: AccountPinMessageInput): Promise<void> {
      await requestEmptyResponse(fetchImplementation, {
        method: 'DELETE',
        url: pinnedMessageUrl(accountUrl, input),
        expectedStatus: HTTP_STATUS_NO_CONTENT,
      });
    },
    async getPinnedMessages<Target extends MessageTarget>(
      input: AccountPinnedMessagesInput<Target>,
    ): Promise<readonly MessageIn<Target>[]> {
      const response = await requestJson(fetchImplementation, {
        method: 'GET',
        url: `${conversationUrl(accountUrl, input.chat)}/pinned-messages`,
        expectedStatus: HTTP_STATUS_OK,
        responseSchema: messageResponseSchemasFor(input.chat).history,
      });
      return response.messages;
    },
    async getChatActions(input: AccountChatActionsInput): Promise<readonly ChatAction[]> {
      const response = await requestJson(fetchImplementation, {
        method: 'GET',
        url: `${conversationUrl(accountUrl, input.chat)}/chat-actions`,
        expectedStatus: HTTP_STATUS_OK,
        responseSchema: chatActionsResponseSchema,
      });
      return response.chat_actions;
    },
    async getNotifications(input: AccountNotificationsInput): Promise<readonly Notification[]> {
      const response = await requestJson(fetchImplementation, {
        method: 'GET',
        url: `${conversationUrl(accountUrl, input.chat)}/notifications`,
        expectedStatus: HTTP_STATUS_OK,
        responseSchema: notificationsResponseSchema,
      });
      return response.notifications;
    },
    pressCallbackButton,
    async pressButton(
      { chat, message_id, button, expired }: PressButtonInput,
    ): Promise<CallbackQuery> {
      const message = (await getMessages({ chat })).find((shown) =>
        shown.message_id === message_id
      );
      if (message === undefined) {
        throw new ButtonSelectionError(
          `Message ${message_id} is not in the account's history of the chat`,
          [],
        );
      }
      const selected = findButton(message, button);
      if (!('callback_data' in selected.button)) {
        throw new ButtonSelectionError(
          `Button ${
            JSON.stringify(selected.label)
          } at ${selected.path} is not a callback button, so pressing it sends the bot nothing`,
          [selected],
        );
      }
      return await pressCallbackButton({
        chat,
        message_id,
        callback_data: selected.button.callback_data,
        expired,
      });
    },
    async getCallbackQuery(callbackQueryId: string): Promise<CallbackQuery> {
      const response = await requestJson(fetchImplementation, {
        method: 'GET',
        url: `${accountUrl}/callback-queries/${encodeURIComponent(callbackQueryId)}`,
        expectedStatus: HTTP_STATUS_OK,
        responseSchema: callbackQueryResponseSchema,
      });
      return response.callback_query;
    },
    answerPoll<Target extends MessageTarget>(
      { chat, message_id, option_ids }: AnswerPollInput<Target>,
    ): Promise<AccountPollAnswer<Target>> {
      return requestJson(fetchImplementation, {
        method: 'PUT',
        url: pollAnswerUrl(accountUrl, { chat, message_id }),
        expectedStatus: HTTP_STATUS_OK,
        responseSchema: messageResponseSchemasFor(chat).pollAnswer,
        body: { option_ids },
      });
    },
    getPollAnswer<Target extends MessageTarget>(
      input: AccountPollMessageInput<Target>,
    ): Promise<AccountPollAnswer<Target>> {
      return requestJson(fetchImplementation, {
        method: 'GET',
        url: pollAnswerUrl(accountUrl, input),
        expectedStatus: HTTP_STATUS_OK,
        responseSchema: messageResponseSchemasFor(input.chat).pollAnswer,
      });
    },
    async retractPollAnswer(input: AccountPollMessageInput): Promise<void> {
      await requestEmptyResponse(fetchImplementation, {
        method: 'DELETE',
        url: pollAnswerUrl(accountUrl, input),
        expectedStatus: HTTP_STATUS_NO_CONTENT,
      });
    },
    async stopPoll<Target extends MessageTarget>(
      input: AccountPollMessageInput<Target>,
    ): Promise<MessageIn<Target>> {
      const response = await requestJson(fetchImplementation, {
        method: 'POST',
        url: `${pollMessageUrl(accountUrl, input)}/poll-closure`,
        expectedStatus: HTTP_STATUS_OK,
        responseSchema: messageResponseSchemasFor(input.chat).sent,
      });
      return response.message;
    },
    setMessageReaction(
      { chat, message_id, reaction }: SetMessageReactionInput,
    ): Promise<MessageReactions> {
      return requestJson(fetchImplementation, {
        method: 'PUT',
        url: messageReactionsUrl(accountUrl, { chat, message_id }),
        expectedStatus: HTTP_STATUS_OK,
        responseSchema: messageReactionsResponseSchema,
        body: { reaction },
      });
    },
    getMessageReactions(input: AccountReactionMessageInput): Promise<MessageReactions> {
      return requestJson(fetchImplementation, {
        method: 'GET',
        url: messageReactionsUrl(accountUrl, input),
        expectedStatus: HTTP_STATUS_OK,
        responseSchema: messageReactionsResponseSchema,
      });
    },
    async removeMessageReaction(input: AccountReactionMessageInput): Promise<void> {
      await requestEmptyResponse(fetchImplementation, {
        method: 'DELETE',
        url: messageReactionsUrl(accountUrl, input),
        expectedStatus: HTTP_STATUS_NO_CONTENT,
      });
    },
    async sendInlineQuery(input: SendInlineQueryInput): Promise<InlineQuery> {
      const response = await requestJson(fetchImplementation, {
        method: 'POST',
        url: `${accountUrl}/inline-queries`,
        expectedStatus: HTTP_STATUS_CREATED,
        responseSchema: inlineQueryResponseSchema,
        body: input,
      });
      return response.inline_query;
    },
    async getInlineQuery(inlineQueryId: string): Promise<InlineQuery> {
      const response = await requestJson(fetchImplementation, {
        method: 'GET',
        url: `${accountUrl}/inline-queries/${encodeURIComponent(inlineQueryId)}`,
        expectedStatus: HTTP_STATUS_OK,
        responseSchema: inlineQueryResponseSchema,
      });
      return response.inline_query;
    },
    async chooseInlineQueryResult(
      input: ChooseInlineQueryResultInput,
    ): Promise<PrivateMessage | SupergroupMessage> {
      const inlineQueryId = encodeURIComponent(input.inline_query_id);
      const response = await requestJson(fetchImplementation, {
        method: 'POST',
        url: `${accountUrl}/inline-queries/${inlineQueryId}/chosen-results`,
        expectedStatus: HTTP_STATUS_CREATED,
        responseSchema: chosenInlineResultResponseSchema,
        body: { result_id: input.result_id },
      });
      return response.message;
    },
    async getBotCommands(input: AccountBotCommandsInput): Promise<readonly BotCommand[]> {
      const botId = encodeURIComponent(input.chat.botId);
      const response = await requestJson(fetchImplementation, {
        method: 'GET',
        url: `${accountUrl}/conversations/private/${botId}/commands`,
        expectedStatus: HTTP_STATUS_OK,
        responseSchema: botCommandsResponseSchema,
      });
      return response.commands;
    },
    async getMenuButton(input: AccountMenuButtonInput): Promise<MenuButton> {
      const botId = encodeURIComponent(input.chat.botId);
      const response = await requestJson(fetchImplementation, {
        method: 'GET',
        url: `${accountUrl}/conversations/private/${botId}/menu-button`,
        expectedStatus: HTTP_STATUS_OK,
        responseSchema: menuButtonResponseSchema,
      });
      return response.menu_button;
    },
    async getSupergroupBotCommands(
      input: AccountSupergroupBotCommandsInput,
    ): Promise<readonly SupergroupBotCommands[]> {
      const chatId = encodeURIComponent(input.chat.chatId);
      const response = await requestJson(fetchImplementation, {
        method: 'GET',
        url: `${accountUrl}/conversations/supergroup/${chatId}/commands`,
        expectedStatus: HTTP_STATUS_OK,
        responseSchema: supergroupBotCommandsResponseSchema,
      });
      return response.bot_commands;
    },
    async getReplyInterface(input: AccountReplyInterfaceInput): Promise<ReplyInterface | null> {
      const response = await requestJson(fetchImplementation, {
        method: 'GET',
        url: `${conversationUrl(accountUrl, input.chat)}/reply-interface`,
        expectedStatus: HTTP_STATUS_OK,
        responseSchema: replyInterfaceResponseSchema,
      });
      return response.reply_interface;
    },
    async pressReplyKeyboardButton<Target extends MessageTarget>(
      input: PressReplyKeyboardButtonInput<Target>,
    ): Promise<MessageIn<Target>> {
      const response = await requestJson(fetchImplementation, {
        method: 'POST',
        url: `${accountUrl}/reply-keyboard-presses`,
        expectedStatus: HTTP_STATUS_CREATED,
        responseSchema: messageResponseSchemasFor(input.chat).sent,
        body: input,
      });
      return response.message;
    },
  });
}

/** A video an account uploads, as the emulation API reads it. */
function toAccountVideoUpload(
  { video, file_name, duration, width, height }: Pick<
    AccountSendVideoInput,
    'video' | 'file_name' | 'duration' | 'width' | 'height'
  >,
) {
  return { content_base64: video.toBase64(), file_name, duration, width, height };
}

/** An audio file an account uploads, as the emulation API reads it. */
function toAccountAudioUpload(
  { audio, file_name, duration, performer, title }: Pick<
    AccountSendAudioInput,
    'audio' | 'file_name' | 'duration' | 'performer' | 'title'
  >,
) {
  return { content_base64: audio.toBase64(), file_name, duration, performer, title };
}

/** The file of an album's photo, document, video, or audio file, as the emulation API reads it. */
function toAccountMediaGroupFile(item: AccountMediaGroupItem) {
  if (item.photo !== undefined) {
    return { photo: { content_base64: item.photo.toBase64() } };
  }
  if (item.document !== undefined) {
    return { document: { content_base64: item.document.toBase64(), file_name: item.file_name } };
  }
  if (item.audio !== undefined) {
    return { audio: toAccountAudioUpload(item) };
  }
  return { video: toAccountVideoUpload(item) };
}

/** The account's view of a chat, under which its messages and members are addressed. */
function conversationUrl(accountUrl: string, chat: MessageTarget): string {
  return chat.type === 'private'
    ? `${accountUrl}/conversations/private/${encodeURIComponent(chat.botId)}`
    : `${accountUrl}/conversations/supergroup/${encodeURIComponent(chat.chatId)}`;
}

/** The URL by which an account pins or unpins a message of its chat. */
function pinnedMessageUrl(
  accountUrl: string,
  { chat, message_id }: AccountPinMessageInput,
): string {
  return `${conversationUrl(accountUrl, chat)}/pinned-messages/${encodeURIComponent(message_id)}`;
}

/** The URL of a message of an account's chat that shows a poll. */
function pollMessageUrl(accountUrl: string, { chat, message_id }: AccountPollMessageInput): string {
  return `${conversationUrl(accountUrl, chat)}/messages/${encodeURIComponent(message_id)}`;
}

/** The URL of an account's answer to the poll a message of its chat shows. */
function pollAnswerUrl(accountUrl: string, input: AccountPollMessageInput): string {
  return `${pollMessageUrl(accountUrl, input)}/poll-answer`;
}

/** The URL of the reactions to a message of a supergroup the account is a member of. */
function messageReactionsUrl(
  accountUrl: string,
  { chat, message_id }: AccountReactionMessageInput,
): string {
  return `${conversationUrl(accountUrl, chat)}/messages/${
    encodeURIComponent(message_id)
  }/reactions`;
}

interface MessageResponseSchemas<Target extends MessageTarget> {
  readonly sent: z.ZodType<{ readonly message: MessageIn<Target> }>;
  readonly sentAlbum: z.ZodType<{ readonly messages: readonly MessageIn<Target>[] }>;
  readonly history: z.ZodType<{ readonly messages: readonly MessageIn<Target>[] }>;
  readonly pollAnswer: z.ZodType<AccountPollAnswer<Target>>;
}

/**
 * Selects the response schemas for a chat's messages. TypeScript cannot relate the checked chat
 * type to the generic target, so the result is asserted; each schema validates the response at
 * run time as the messages of exactly that chat type.
 */
function messageResponseSchemasFor<Target extends MessageTarget>(
  target: Target,
): MessageResponseSchemas<Target> {
  const schemas: MessageResponseSchemas<MessageTarget> = target.type === 'supergroup'
    ? {
      sent: sentSupergroupMessageResponseSchema,
      sentAlbum: sentSupergroupMediaGroupResponseSchema,
      history: supergroupMessageHistoryResponseSchema,
      pollAnswer: supergroupPollAnswerResponseSchema,
    }
    : {
      sent: sentMessageResponseSchema,
      sentAlbum: sentMediaGroupResponseSchema,
      history: messageHistoryResponseSchema,
      pollAnswer: pollAnswerResponseSchema,
    };
  return schemas as MessageResponseSchemas<Target>;
}

/** The prefix of every invite link, after which its hash follows. */
const INVITE_LINK_PREFIX = 'https://t.me/+';

/** The hash that names an invite link in the emulation API. */
function getInviteLinkHash(inviteLink: string): string {
  if (typeof inviteLink !== 'string' || !inviteLink.startsWith(INVITE_LINK_PREFIX)) {
    throw new TypeError(`inviteLink must start with ${INVITE_LINK_PREFIX}`);
  }
  return inviteLink.slice(INVITE_LINK_PREFIX.length);
}

function validateBotToken(botToken: string): void {
  if (typeof botToken !== 'string' || botToken.length === 0) {
    throw new TypeError('botToken must be a non-empty string');
  }
}
