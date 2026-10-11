import type { z } from 'zod';

import {
  deleteAccountMessageContract,
  editAccountMessageContract,
  getPrivateMessageHistoryContract,
} from '../../src/api/contracts/account_messages.ts';
import { createAccountContract } from '../../src/api/contracts/accounts.ts';
import { blockBotContract, unblockBotContract } from '../../src/api/contracts/blocked_bots.ts';
import { createBotContract } from '../../src/api/contracts/bots.ts';
import {
  getCallbackQueryContract,
  pressCallbackButtonContract,
} from '../../src/api/contracts/callback_queries.ts';
import {
  chatActionsResponseSchema,
  expirePrivateChatActionContract,
  getPrivateChatActionsContract,
} from '../../src/api/contracts/chat_actions.ts';
import {
  getPrivateChatBotCommandsContract,
  getPrivateChatMenuButtonContract,
  getPrivateChatNotificationsContract,
  getPrivateChatReplyInterfaceContract,
  notificationsResponseSchema,
  replyInterfaceResponseSchema,
} from '../../src/api/contracts/conversation_reads.ts';
import { downloadFileContract } from '../../src/api/contracts/files.ts';
import {
  expireInlineAnswerCacheContract,
  getInlineQueryContract,
  sendInlineQueryContract,
} from '../../src/api/contracts/inline_queries.ts';
import {
  listRateLimitResponsesContract,
  listServerErrorResponsesContract,
  queueRateLimitResponsesContract,
  queueServerErrorResponsesContract,
} from '../../src/api/contracts/queued_bot_api_answers.ts';
import {
  expirePrivateMessageDraftContract,
  getPrivateMessageDraftContract,
  stopPrivateMessageDraftContract,
} from '../../src/api/contracts/message_drafts.ts';
import type { ControlOperationRequest } from '../../src/api/contracts/operation_contract.ts';
import {
  getPrivatePinnedMessagesContract,
  pinPrivateMessageContract,
  unpinPrivateMessageContract,
} from '../../src/api/contracts/pinned_messages.ts';
import {
  answerAccountPollContract,
  getAccountPollAnswerContract,
  retractAccountPollAnswerContract,
  retractSupergroupAccountPollAnswerContract,
  stopAccountPollContract,
} from '../../src/api/contracts/poll_answers.ts';
import { expirePollContract } from '../../src/api/contracts/polls.ts';
import { deleteSessionContract } from '../../src/api/contracts/sessions.ts';
import {
  changeSupergroupDescriptionContract,
  changeSupergroupTitleContract,
  demoteSupergroupMemberContract,
  expireSupergroupMemberRestrictionContract,
  getSupergroupAdministratorsContract,
  liftSupergroupMemberRestrictionContract,
  promoteSupergroupMemberContract,
  protectSupergroupContentContract,
  restrictSupergroupMemberContract,
  setSupergroupCustomTitleContract,
  setSupergroupDefaultPermissionsContract,
  unprotectSupergroupContentContract,
} from '../../src/api/contracts/supergroup_administration.ts';
import {
  addSupergroupMemberContract,
  createSupergroupContract,
  decideSupergroupJoinRequestContract,
  expireChatInviteLinkContract,
  expireJoinRequesterContactContract,
  getSupergroupInviteLinksContract,
  getSupergroupJoinRequestsContract,
  joinChatByInviteLinkContract,
  removeSupergroupMemberContract,
} from '../../src/api/contracts/supergroups.ts';
import {
  expireWebhookAttemptContract,
  getWebhookDeliveryContract,
  listWebhookAttemptsContract,
  releaseWebhookRetryContract,
  setWebhookDeliveryContract,
} from '../../src/api/contracts/webhook_attempts.ts';
import { registerWebResourceContract } from '../../src/api/contracts/web_resources.ts';
import { createHttpBotActivityPageReader } from './bot_activity_http_page_reader.ts';
import { createBotActivityLog } from './bot_activity_log.ts';
import { HTTP_STATUS_CREATED, HTTP_STATUS_NO_CONTENT, HTTP_STATUS_OK } from './constants.ts';
import {
  callBytesOperation,
  callEmptyAction,
  callEmptyOperation,
  callJsonAction,
  callJsonOperation,
  type ControlOperationTransport,
} from './control_operation_caller.ts';
import { ButtonSelectionError, findButton } from './message_buttons.ts';
import {
  chosenInlineResultResponseSchema,
  getMeResponseSchema,
  messageReactionsResponseSchema,
  sentMediaGroupResponseSchema,
  sentMessageResponseSchema,
  sentSupergroupMediaGroupResponseSchema,
  sentSupergroupMessageResponseSchema,
  supergroupBotCommandsResponseSchema,
  supergroupMessageHistoryResponseSchema,
  supergroupPollAnswerResponseSchema,
} from './schemas.ts';
import type {
  AccountBotCommandsInput,
  AccountChatActionsInput,
  AccountChatAdministratorsInput,
  AccountChatInviteLinksInput,
  AccountChatJoinRequestDecisionInput,
  AccountChatJoinRequestsInput,
  AccountDeleteMessageInput,
  AccountEditMessageCaptionInput,
  AccountEditMessageInput,
  AccountForwardMessageInput,
  AccountMediaGroupItem,
  AccountMenuButtonInput,
  AccountMessageDraftInput,
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
  ActionOutcome,
  ActionReceipt,
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
  ExpireChatActionInput,
  ExpireChatInviteLinkInput,
  ExpireChatMemberRestrictionInput,
  ExpireJoinRequesterContactInput,
  InlineQuery,
  JoinChatByInviteLinkInput,
  JoinChatInput,
  LeaveChatInput,
  LiftChatMemberRestrictionInput,
  MenuButton,
  MessageDraft,
  MessageEntityInput,
  MessageIn,
  MessageReactions,
  MessageTarget,
  Notification,
  Poll,
  PressButtonInput,
  PressCallbackButtonInput,
  PressReplyKeyboardButtonInput,
  PrivateMessage,
  PrivateMessageTarget,
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
  ShownMessageDraftInput,
  Supergroup,
  SupergroupAdministrator,
  SupergroupBotCommands,
  SupergroupInviteLink,
  SupergroupMessage,
  SupergroupMessageTarget,
  UploadProfile,
  VirtualAccountClient,
  VirtualAccountProfile,
  VirtualBotProfile,
  WebhookAttempt,
  WebhookAttemptControlInput,
  WebhookDelivery,
  WebResource,
} from './types.ts';
import { normalizeUrlRoot, requestEmptyAction, requestJson, requestJsonAction } from './utils.ts';

/**
 * A session's client. Each action resolves to its result, which its description says it returns,
 * with the action's receipt; an action without a result resolves to its receipt. Reads, and ending
 * the session, which answers with no receipt, resolve to what they read or to nothing.
 */
export interface EmulationSessionClient extends EmulationSession {
  /** Ends the session and discards all state owned by it. */
  end(): Promise<void>;
  createBot(input: CreateVirtualBotInput): Promise<ActionOutcome<CreatedVirtualBot>>;
  createAccount(input: CreateVirtualAccountInput): Promise<ActionOutcome<CreatedVirtualAccount>>;
  /** Calls the emulated Bot API getMe method with a virtual bot token. */
  getMe(botToken: string): Promise<VirtualBotProfile>;
  /**
   * Makes a bot's next calls of a method, or of every method, fail with `429 Too Many Requests`,
   * for testing how the bot handles Telegram's rate limits.
   */
  queueRateLimitResponses(
    input: QueueRateLimitResponsesInput,
  ): Promise<ActionOutcome<RateLimitResponses>>;
  /** Lists the rate limit answers still queued for a bot, earliest first. */
  getRateLimitResponses(botId: number): Promise<readonly RateLimitResponses[]>;
  /**
   * Makes a bot's next calls of a method, or of every method, fail with `500 Internal Server
   * Error` or `503 Service Unavailable` before they run, for testing how the bot retries or falls
   * back. Queued rate limit answers apply first.
   */
  queueServerErrorResponses(
    input: QueueServerErrorResponsesInput,
  ): Promise<ActionOutcome<ServerErrorResponses>>;
  /** Lists the server error answers still queued for a bot, earliest first. */
  getServerErrorResponses(botId: number): Promise<readonly ServerErrorResponses[]>;
  /**
   * Chooses who ends a bot's webhook delivery attempts and retry waits from now on: the emulator
   * by its own timing (`automatic`, the default), or only the test (`manual`), through
   * `expireWebhookAttempt` and `releaseWebhookRetry`. These are emulator controls, not Telegram's
   * timing.
   */
  setWebhookDelivery(input: SetWebhookDeliveryInput): Promise<ActionOutcome<WebhookDelivery>>;
  getWebhookDelivery(botId: number): Promise<WebhookDelivery>;
  /** Lists every attempt to deliver an update to a bot's webhook, earliest first. */
  getWebhookAttempts(botId: number): Promise<readonly WebhookAttempt[]>;
  /**
   * Sends a failed attempt's update again without waiting for its retry delay, and returns the
   * attempt. Fails with status `409` when the retry is not waiting.
   */
  releaseWebhookRetry(input: WebhookAttemptControlInput): Promise<ActionOutcome<WebhookAttempt>>;
  /**
   * Makes the deadline of an attempt in flight arrive, as its timeout passing does, and returns
   * the attempt once its outcome is decided. Fails with status `409` when the attempt is no longer
   * in flight.
   */
  expireWebhookAttempt(input: WebhookAttemptControlInput): Promise<ActionOutcome<WebhookAttempt>>;
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
  registerWebResource(input: RegisterWebResourceInput): Promise<ActionOutcome<WebResource>>;
  /**
   * Closes a poll as its `close_date` arriving does, and returns it as the bot that sent it sees
   * it. The emulator does not close polls as time passes, so tests choose when a poll sent with
   * `open_period` or `close_date` closes; the bot receives a `poll` update with the closed poll.
   */
  expirePoll(pollId: string): Promise<ActionOutcome<Poll>>;
  /**
   * Ends a user's temporary restriction in a supergroup as its `until_date` arriving does, and
   * returns the user's standing after it: `member`, or `left` for a user that is not a member. The
   * emulator does not lift restrictions as time passes, so tests choose when one ends; no bot
   * receives an update for it.
   */
  expireChatMemberRestriction(
    input: ExpireChatMemberRestrictionInput,
  ): Promise<ActionOutcome<'member' | 'left'>>;
  /**
   * Makes an invite link's `expire_date` arrive, and returns the link as the supergroup's owner
   * sees it. The emulator does not let time pass by itself, so tests choose when a link created
   * with `expire_date` stops admitting users; the members that joined through it stay.
   */
  expireChatInviteLink(
    input: ExpireChatInviteLinkInput,
  ): Promise<ActionOutcome<SupergroupInviteLink>>;
  /**
   * Ends a pending join request's contact window as its five minutes passing does, and returns the
   * request as the supergroup's owner sees it. The emulator does not let time pass by itself, so
   * tests choose when the bots that received the request stop being able to write to a user that
   * never started them; bots the user started keep writing to it, and the request stays pending.
   */
  expireJoinRequesterContact(
    input: ExpireJoinRequesterContactInput,
  ): Promise<ActionOutcome<ChatJoinRequest>>;
  /**
   * Expires the answers the inline answer cache holds for the request of the inline query with
   * this ID, as their `cache_time` passing does, so the next such query reaches the bot. The
   * emulator reuses an answer with a positive `cache_time` until a test expires it. The answers
   * expire for every account, and each query keeps its answer; the bot is not told. Fails with
   * status `409` when the cache holds no answer for the request.
   */
  expireInlineAnswerCache(inlineQueryId: string): Promise<ActionReceipt>;
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
  readonly #transport: ControlOperationTransport;

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
    this.#transport = { serverRoot, fetch: fetchImplementation };
  }

  end(): Promise<void> {
    return callEmptyOperation(this.#transport, deleteSessionContract, {
      params: { sessionId: this.id },
    });
  }

  createBot(input: CreateVirtualBotInput): Promise<ActionOutcome<CreatedVirtualBot>> {
    return callJsonAction(this.#transport, createBotContract, {
      params: { sessionId: this.id },
      body: input,
    });
  }

  async createAccount(
    input: CreateVirtualAccountInput,
  ): Promise<ActionOutcome<CreatedVirtualAccount>> {
    const creation = await callJsonAction(this.#transport, createAccountContract, {
      params: { sessionId: this.id },
      body: input,
    });
    return selectResult(creation, ({ account }) => ({
      account: createVirtualAccountClient(
        account,
        { transport: this.#transport, sessionId: this.id },
        `${this.#sessionUrl}/accounts/${account.id}`,
        this.#fetch,
      ),
    }));
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
    { bot_id: botId, ...body }: QueueRateLimitResponsesInput,
  ): Promise<ActionOutcome<RateLimitResponses>> {
    return callJsonAction(this.#transport, queueRateLimitResponsesContract, {
      params: { sessionId: this.id, botId },
      body,
    });
  }

  async getRateLimitResponses(botId: number): Promise<readonly RateLimitResponses[]> {
    const response = await callJsonOperation(this.#transport, listRateLimitResponsesContract, {
      params: { sessionId: this.id, botId },
    });
    return response.rate_limit_responses;
  }

  queueServerErrorResponses(
    { bot_id: botId, ...body }: QueueServerErrorResponsesInput,
  ): Promise<ActionOutcome<ServerErrorResponses>> {
    return callJsonAction(this.#transport, queueServerErrorResponsesContract, {
      params: { sessionId: this.id, botId },
      body,
    });
  }

  async getServerErrorResponses(botId: number): Promise<readonly ServerErrorResponses[]> {
    const response = await callJsonOperation(this.#transport, listServerErrorResponsesContract, {
      params: { sessionId: this.id, botId },
    });
    return response.server_error_responses;
  }

  setWebhookDelivery(
    { bot_id: botId, ...body }: SetWebhookDeliveryInput,
  ): Promise<ActionOutcome<WebhookDelivery>> {
    return callJsonAction(this.#transport, setWebhookDeliveryContract, {
      params: { sessionId: this.id, botId },
      body,
    });
  }

  getWebhookDelivery(botId: number): Promise<WebhookDelivery> {
    return callJsonOperation(this.#transport, getWebhookDeliveryContract, {
      params: { sessionId: this.id, botId },
    });
  }

  async getWebhookAttempts(botId: number): Promise<readonly WebhookAttempt[]> {
    const response = await callJsonOperation(this.#transport, listWebhookAttemptsContract, {
      params: { sessionId: this.id, botId },
    });
    return response.webhook_attempts;
  }

  releaseWebhookRetry(
    { botId, attemptId }: WebhookAttemptControlInput,
  ): Promise<ActionOutcome<WebhookAttempt>> {
    return callJsonAction(this.#transport, releaseWebhookRetryContract, {
      params: { sessionId: this.id, botId, webhookAttemptId: attemptId },
    });
  }

  expireWebhookAttempt(
    { botId, attemptId }: WebhookAttemptControlInput,
  ): Promise<ActionOutcome<WebhookAttempt>> {
    return callJsonAction(this.#transport, expireWebhookAttemptContract, {
      params: { sessionId: this.id, botId, webhookAttemptId: attemptId },
    });
  }

  downloadFile(fileUniqueId: string): Promise<Uint8Array> {
    return callBytesOperation(this.#transport, downloadFileContract, {
      params: { sessionId: this.id, fileUniqueId },
    });
  }

  async expirePoll(pollId: string): Promise<ActionOutcome<Poll>> {
    const expiry = await callJsonAction(this.#transport, expirePollContract, {
      params: { sessionId: this.id, pollId },
    });
    return selectResult(expiry, ({ poll }) => poll);
  }

  async expireChatMemberRestriction(
    { chatId, userId }: ExpireChatMemberRestrictionInput,
  ): Promise<ActionOutcome<'member' | 'left'>> {
    const expiry = await callJsonAction(
      this.#transport,
      expireSupergroupMemberRestrictionContract,
      { params: { sessionId: this.id, chatId, userId } },
    );
    return selectResult(expiry, ({ chat_member }) => chat_member.status);
  }

  async expireChatInviteLink(
    { chatId, inviteLink }: ExpireChatInviteLinkInput,
  ): Promise<ActionOutcome<SupergroupInviteLink>> {
    const expiry = await callJsonAction(this.#transport, expireChatInviteLinkContract, {
      params: { sessionId: this.id, chatId, inviteLinkHash: getInviteLinkHash(inviteLink) },
    });
    return selectResult(expiry, ({ invite_link }) => invite_link);
  }

  async expireJoinRequesterContact(
    { chatId, userId }: ExpireJoinRequesterContactInput,
  ): Promise<ActionOutcome<ChatJoinRequest>> {
    const expiry = await callJsonAction(this.#transport, expireJoinRequesterContactContract, {
      params: { sessionId: this.id, chatId, userId },
    });
    return selectResult(expiry, ({ join_request }) => join_request);
  }

  expireInlineAnswerCache(inlineQueryId: string): Promise<ActionReceipt> {
    return callEmptyAction(this.#transport, expireInlineAnswerCacheContract, {
      params: { sessionId: this.id, inlineQueryId },
    });
  }

  registerWebResource(
    { content, ...input }: RegisterWebResourceInput,
  ): Promise<ActionOutcome<WebResource>> {
    return callJsonAction(this.#transport, registerWebResourceContract, {
      params: { sessionId: this.id },
      body: { ...input, ...(content === undefined ? {} : { content_base64: content.toBase64() }) },
    });
  }

  botActivity<const Criteria extends BotActivityCriteria>(
    filter?: BotActivityFilterFor<Criteria>,
    options: BotActivityLogOptions = {},
  ): BotActivityLog {
    const pageReader = createHttpBotActivityPageReader(this.#transport, this.id);
    return createBotActivityLog(pageReader, filter, options);
  }
}

/** Where an account client sends the requests that contracts describe: its session's operations. */
interface AccountOperationTarget {
  readonly transport: ControlOperationTransport;
  readonly sessionId: string;
}

function createVirtualAccountClient(
  profile: VirtualAccountProfile,
  { transport, sessionId }: AccountOperationTarget,
  accountUrl: string,
  fetchImplementation: typeof globalThis.fetch,
): VirtualAccountClient {
  const accountParams = { sessionId, accountId: profile.id };
  const privateChatParams = ({ botId }: PrivateMessageTarget) => ({ ...accountParams, botId });
  const supergroupParams = ({ chatId }: SupergroupMessageTarget) => ({ ...accountParams, chatId });

  function privateChatMessageOperations(
    chat: PrivateMessageTarget,
  ): ChatMessageOperations<PrivateMessageTarget> {
    const params = privateChatParams(chat);
    return {
      async readMessages() {
        const response = await callJsonOperation(transport, getPrivateMessageHistoryContract, {
          params,
        });
        return response.messages;
      },
      async readPinnedMessages() {
        const response = await callJsonOperation(transport, getPrivatePinnedMessagesContract, {
          params,
        });
        return response.messages;
      },
      async editMessage(messageId, body) {
        const edit = await callJsonAction(transport, editAccountMessageContract, {
          params: { ...params, messageId },
          body,
        });
        return selectResult(edit, ({ message }) => message);
      },
      readPollAnswer(messageId) {
        return callJsonOperation(transport, getAccountPollAnswerContract, {
          params: { ...params, messageId },
        });
      },
      answerPoll(messageId, optionIds) {
        return callJsonAction(transport, answerAccountPollContract, {
          params: { ...params, messageId },
          body: { option_ids: [...optionIds] },
        });
      },
      async stopPoll(messageId) {
        const closure = await callJsonAction(transport, stopAccountPollContract, {
          params: { ...params, messageId },
        });
        return selectResult(closure, ({ message }) => message);
      },
    };
  }

  function supergroupMessageOperations(
    chat: SupergroupMessageTarget,
  ): ChatMessageOperations<SupergroupMessageTarget> {
    const chatUrl = conversationUrl(accountUrl, chat);
    const messageUrl = (messageId: number) =>
      `${chatUrl}/messages/${encodeURIComponent(messageId)}`;
    return {
      async readMessages() {
        const response = await requestJson(fetchImplementation, {
          method: 'GET',
          url: `${chatUrl}/messages`,
          expectedStatus: HTTP_STATUS_OK,
          responseSchema: supergroupMessageHistoryResponseSchema,
        });
        return response.messages;
      },
      async readPinnedMessages() {
        const response = await requestJson(fetchImplementation, {
          method: 'GET',
          url: `${chatUrl}/pinned-messages`,
          expectedStatus: HTTP_STATUS_OK,
          responseSchema: supergroupMessageHistoryResponseSchema,
        });
        return response.messages;
      },
      async editMessage(messageId, body) {
        const edit = await requestJsonAction(fetchImplementation, {
          method: 'PATCH',
          url: messageUrl(messageId),
          expectedStatus: HTTP_STATUS_OK,
          responseSchema: sentSupergroupMessageResponseSchema,
          body,
        });
        return selectResult(edit, ({ message }) => message);
      },
      readPollAnswer(messageId) {
        return requestJson(fetchImplementation, {
          method: 'GET',
          url: `${messageUrl(messageId)}/poll-answer`,
          expectedStatus: HTTP_STATUS_OK,
          responseSchema: supergroupPollAnswerResponseSchema,
        });
      },
      answerPoll(messageId, optionIds) {
        return requestJsonAction(fetchImplementation, {
          method: 'PUT',
          url: `${messageUrl(messageId)}/poll-answer`,
          expectedStatus: HTTP_STATUS_OK,
          responseSchema: supergroupPollAnswerResponseSchema,
          body: { option_ids: optionIds },
        });
      },
      async stopPoll(messageId) {
        const closure = await requestJsonAction(fetchImplementation, {
          method: 'POST',
          url: `${messageUrl(messageId)}/poll-closure`,
          expectedStatus: HTTP_STATUS_OK,
          responseSchema: sentSupergroupMessageResponseSchema,
        });
        return selectResult(closure, ({ message }) => message);
      },
    };
  }

  /**
   * The operations on the messages of a chat of the account, for the chat's type. TypeScript
   * cannot relate the checked chat type to the generic target, so the result is asserted; each
   * operation validates its response at run time as the messages of exactly that chat type.
   */
  function chatMessageOperationsFor<Target extends MessageTarget>(
    chat: Target,
  ): ChatMessageOperations<Target> {
    const operations: ChatMessageOperations<MessageTarget> = chat.type === 'private'
      ? privateChatMessageOperations(chat)
      : supergroupMessageOperations(chat);
    return operations as ChatMessageOperations<Target>;
  }

  function getMessages<Target extends MessageTarget>(
    input: AccountMessageHistoryInput<Target>,
  ): Promise<readonly MessageIn<Target>[]> {
    return chatMessageOperationsFor(input.chat).readMessages();
  }

  async function pressCallbackButton(
    input: PressCallbackButtonInput,
  ): Promise<ActionOutcome<CallbackQuery>> {
    const press = await callJsonAction(transport, pressCallbackButtonContract, {
      params: accountParams,
      body: input,
    });
    return selectResult(press, ({ callback_query }) => callback_query);
  }

  return Object.freeze({
    ...profile,
    async sendMessage<Target extends MessageTarget>(
      input: AccountSendMessageInput<Target>,
    ): Promise<ActionOutcome<MessageIn<Target>>> {
      const sending = await requestJsonAction(fetchImplementation, {
        method: 'POST',
        url: `${accountUrl}/messages`,
        expectedStatus: HTTP_STATUS_CREATED,
        responseSchema: messageResponseSchemasFor(input.to).sent,
        body: input,
      });
      return selectResult(sending, ({ message }) => message);
    },
    async sendPhoto<Target extends MessageTarget>(
      { to, photo, caption, caption_entities, reply_to_message_id }: AccountSendPhotoInput<Target>,
    ): Promise<ActionOutcome<MessageIn<Target>>> {
      const sending = await requestJsonAction(fetchImplementation, {
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
      return selectResult(sending, ({ message }) => message);
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
    ): Promise<ActionOutcome<MessageIn<Target>>> {
      const sending = await requestJsonAction(fetchImplementation, {
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
      return selectResult(sending, ({ message }) => message);
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
    ): Promise<ActionOutcome<MessageIn<Target>>> {
      const sending = await requestJsonAction(fetchImplementation, {
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
      return selectResult(sending, ({ message }) => message);
    },
    async sendVoice<Target extends MessageTarget>(
      { to, voice, duration, caption, caption_entities, reply_to_message_id }:
        AccountSendVoiceInput<
          Target
        >,
    ): Promise<ActionOutcome<MessageIn<Target>>> {
      const sending = await requestJsonAction(fetchImplementation, {
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
      return selectResult(sending, ({ message }) => message);
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
    ): Promise<ActionOutcome<MessageIn<Target>>> {
      const sending = await requestJsonAction(fetchImplementation, {
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
      return selectResult(sending, ({ message }) => message);
    },
    async sendContact<Target extends MessageTarget>(
      input: AccountSendContactInput<Target>,
    ): Promise<ActionOutcome<MessageIn<Target>>> {
      const sending = await requestJsonAction(fetchImplementation, {
        method: 'POST',
        url: `${accountUrl}/messages`,
        expectedStatus: HTTP_STATUS_CREATED,
        responseSchema: messageResponseSchemasFor(input.to).sent,
        body: input,
      });
      return selectResult(sending, ({ message }) => message);
    },
    async shareOwnContact<Target extends MessageTarget>(
      { to, reply_to_message_id }: AccountShareOwnContactInput<Target>,
    ): Promise<ActionOutcome<MessageIn<Target>>> {
      const sending = await requestJsonAction(fetchImplementation, {
        method: 'POST',
        url: `${accountUrl}/messages`,
        expectedStatus: HTTP_STATUS_CREATED,
        responseSchema: messageResponseSchemasFor(to).sent,
        body: { to, own_contact: true, reply_to_message_id },
      });
      return selectResult(sending, ({ message }) => message);
    },
    async sendLocation<Target extends MessageTarget>(
      input: AccountSendLocationInput<Target>,
    ): Promise<ActionOutcome<MessageIn<Target>>> {
      const sending = await requestJsonAction(fetchImplementation, {
        method: 'POST',
        url: `${accountUrl}/messages`,
        expectedStatus: HTTP_STATUS_CREATED,
        responseSchema: messageResponseSchemasFor(input.to).sent,
        body: input,
      });
      return selectResult(sending, ({ message }) => message);
    },
    async sendPoll<Target extends MessageTarget>(
      input: AccountSendPollInput<Target>,
    ): Promise<ActionOutcome<MessageIn<Target>>> {
      const sending = await requestJsonAction(fetchImplementation, {
        method: 'POST',
        url: `${accountUrl}/messages`,
        expectedStatus: HTTP_STATUS_CREATED,
        responseSchema: messageResponseSchemasFor(input.to).sent,
        body: input,
      });
      return selectResult(sending, ({ message }) => message);
    },
    async sendMediaGroup<Target extends MessageTarget>(
      { to, media, reply_to_message_id }: AccountSendMediaGroupInput<Target>,
    ): Promise<ActionOutcome<readonly MessageIn<Target>[]>> {
      const sending = await requestJsonAction(fetchImplementation, {
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
      return selectResult(sending, ({ messages }) => messages);
    },
    async forwardMessage<Target extends MessageTarget>(
      { from, message_id, to }: AccountForwardMessageInput<Target>,
    ): Promise<ActionOutcome<MessageIn<Target>>> {
      const sending = await requestJsonAction(fetchImplementation, {
        method: 'POST',
        url: `${accountUrl}/messages`,
        expectedStatus: HTTP_STATUS_CREATED,
        responseSchema: messageResponseSchemasFor(to).sent,
        body: { to, forward: { chat: from, message_id } },
      });
      return selectResult(sending, ({ message }) => message);
    },
    editMessage<Target extends MessageTarget>(
      input: AccountEditMessageInput<Target>,
    ): Promise<ActionOutcome<MessageIn<Target>>> {
      return chatMessageOperationsFor(input.chat).editMessage(input.message_id, {
        text: input.text,
        entities: copyEntities(input.entities),
      });
    },
    editMessageCaption<Target extends MessageTarget>(
      input: AccountEditMessageCaptionInput<Target>,
    ): Promise<ActionOutcome<MessageIn<Target>>> {
      return chatMessageOperationsFor(input.chat).editMessage(input.message_id, {
        caption: input.caption,
        caption_entities: copyEntities(input.caption_entities),
      });
    },
    deleteMessage(
      { chat, message_id: messageId }: AccountDeleteMessageInput,
    ): Promise<ActionReceipt> {
      if (chat.type === 'private') {
        return callEmptyAction(transport, deleteAccountMessageContract, {
          params: { ...privateChatParams(chat), messageId },
        });
      }
      return requestEmptyAction(fetchImplementation, {
        method: 'DELETE',
        url: `${conversationUrl(accountUrl, chat)}/messages/${encodeURIComponent(messageId)}`,
        expectedStatus: HTTP_STATUS_NO_CONTENT,
      });
    },
    async createSupergroup(input: CreateSupergroupInput): Promise<ActionOutcome<Supergroup>> {
      const creation = await callJsonAction(transport, createSupergroupContract, {
        params: accountParams,
        body: input,
      });
      return selectResult(creation, ({ supergroup }) => supergroup);
    },
    addChatMember(input: AddChatMemberInput): Promise<ActionReceipt> {
      return callEmptyAction(transport, addSupergroupMemberContract, {
        params: { ...supergroupParams(input.chat), userId: input.userId },
      });
    },
    removeChatMember(input: RemoveChatMemberInput): Promise<ActionReceipt> {
      return callEmptyAction(transport, removeSupergroupMemberContract, {
        params: { ...supergroupParams(input.chat), userId: input.userId },
      });
    },
    leaveChat(input: LeaveChatInput): Promise<ActionReceipt> {
      return callEmptyAction(transport, removeSupergroupMemberContract, {
        params: { ...supergroupParams(input.chat), userId: profile.id },
      });
    },
    joinChat(input: JoinChatInput): Promise<ActionReceipt> {
      return callEmptyAction(transport, addSupergroupMemberContract, {
        params: { ...supergroupParams(input.chat), userId: profile.id },
      });
    },
    joinChatByInviteLink(input: JoinChatByInviteLinkInput): Promise<ActionOutcome<ChatJoin>> {
      return callJsonAction(transport, joinChatByInviteLinkContract, {
        params: accountParams,
        body: { invite_link: input.inviteLink },
      });
    },
    async getChatInviteLinks(
      input: AccountChatInviteLinksInput,
    ): Promise<readonly SupergroupInviteLink[]> {
      const response = await callJsonOperation(transport, getSupergroupInviteLinksContract, {
        params: supergroupParams(input.chat),
      });
      return response.invite_links;
    },
    async getChatJoinRequests(
      input: AccountChatJoinRequestsInput,
    ): Promise<readonly ChatJoinRequest[]> {
      const response = await callJsonOperation(transport, getSupergroupJoinRequestsContract, {
        params: supergroupParams(input.chat),
      });
      return response.join_requests;
    },
    approveChatJoinRequest(input: AccountChatJoinRequestDecisionInput): Promise<ActionReceipt> {
      return callEmptyAction(transport, decideSupergroupJoinRequestContract, {
        params: { ...supergroupParams(input.chat), userId: input.userId },
        body: { decision: 'approve' },
      });
    },
    declineChatJoinRequest(input: AccountChatJoinRequestDecisionInput): Promise<ActionReceipt> {
      return callEmptyAction(transport, decideSupergroupJoinRequestContract, {
        params: { ...supergroupParams(input.chat), userId: input.userId },
        body: { decision: 'decline' },
      });
    },
    promoteChatMember(input: PromoteChatMemberInput): Promise<ActionReceipt> {
      return callEmptyAction(transport, promoteSupergroupMemberContract, {
        params: { ...supergroupParams(input.chat), userId: input.userId },
        body: input.rights,
      });
    },
    async getChatAdministrators(
      input: AccountChatAdministratorsInput,
    ): Promise<readonly SupergroupAdministrator[]> {
      const response = await callJsonOperation(transport, getSupergroupAdministratorsContract, {
        params: supergroupParams(input.chat),
      });
      return response.administrators;
    },
    demoteChatMember(input: DemoteChatMemberInput): Promise<ActionReceipt> {
      return callEmptyAction(transport, demoteSupergroupMemberContract, {
        params: { ...supergroupParams(input.chat), userId: input.userId },
      });
    },
    restrictChatMember(input: RestrictChatMemberInput): Promise<ActionReceipt> {
      return callEmptyAction(transport, restrictSupergroupMemberContract, {
        params: { ...supergroupParams(input.chat), userId: input.userId },
        body: {
          permissions: input.permissions,
          ...(input.untilDate === undefined ? {} : { until_date: input.untilDate }),
        },
      });
    },
    liftChatMemberRestriction(input: LiftChatMemberRestrictionInput): Promise<ActionReceipt> {
      return callEmptyAction(transport, liftSupergroupMemberRestrictionContract, {
        params: { ...supergroupParams(input.chat), userId: input.userId },
      });
    },
    setChatPermissions(input: SetChatPermissionsInput): Promise<ActionReceipt> {
      return callEmptyAction(transport, setSupergroupDefaultPermissionsContract, {
        params: supergroupParams(input.chat),
        body: { permissions: input.permissions },
      });
    },
    setCustomTitle(input: SetCustomTitleInput): Promise<ActionReceipt> {
      return callEmptyAction(transport, setSupergroupCustomTitleContract, {
        params: { ...supergroupParams(input.chat), userId: input.userId },
        body: { custom_title: input.customTitle },
      });
    },
    setContentProtection(input: SetContentProtectionInput): Promise<ActionReceipt> {
      return callEmptyAction(
        transport,
        input.hasProtectedContent
          ? protectSupergroupContentContract
          : unprotectSupergroupContentContract,
        { params: supergroupParams(input.chat) },
      );
    },
    changeSupergroupTitle(input: ChangeSupergroupTitleInput): Promise<ActionReceipt> {
      return callEmptyAction(transport, changeSupergroupTitleContract, {
        params: supergroupParams(input.chat),
        body: { title: input.title },
      });
    },
    changeSupergroupDescription(input: ChangeSupergroupDescriptionInput): Promise<ActionReceipt> {
      return callEmptyAction(transport, changeSupergroupDescriptionContract, {
        params: supergroupParams(input.chat),
        body: { description: input.description },
      });
    },
    blockBot({ botId }: BotBlockInput): Promise<ActionReceipt> {
      return callEmptyAction(transport, blockBotContract, {
        params: { ...accountParams, botId },
      });
    },
    unblockBot({ botId }: BotBlockInput): Promise<ActionReceipt> {
      return callEmptyAction(transport, unblockBotContract, {
        params: { ...accountParams, botId },
      });
    },
    getMessages,
    pinMessage({ chat, message_id: messageId }: AccountPinMessageInput): Promise<ActionReceipt> {
      if (chat.type === 'private') {
        return callEmptyAction(transport, pinPrivateMessageContract, {
          params: { ...privateChatParams(chat), messageId },
        });
      }
      return requestEmptyAction(fetchImplementation, {
        method: 'PUT',
        url: pinnedMessageUrl(accountUrl, chat, messageId),
        expectedStatus: HTTP_STATUS_NO_CONTENT,
      });
    },
    unpinMessage({ chat, message_id: messageId }: AccountPinMessageInput): Promise<ActionReceipt> {
      if (chat.type === 'private') {
        return callEmptyAction(transport, unpinPrivateMessageContract, {
          params: { ...privateChatParams(chat), messageId },
        });
      }
      return requestEmptyAction(fetchImplementation, {
        method: 'DELETE',
        url: pinnedMessageUrl(accountUrl, chat, messageId),
        expectedStatus: HTTP_STATUS_NO_CONTENT,
      });
    },
    getPinnedMessages<Target extends MessageTarget>(
      input: AccountPinnedMessagesInput<Target>,
    ): Promise<readonly MessageIn<Target>[]> {
      return chatMessageOperationsFor(input.chat).readPinnedMessages();
    },
    async getChatActions({ chat }: AccountChatActionsInput): Promise<readonly ChatAction[]> {
      const response = chat.type === 'private'
        ? await callJsonOperation(transport, getPrivateChatActionsContract, {
          params: privateChatParams(chat),
        })
        : await requestJson(fetchImplementation, {
          method: 'GET',
          url: `${conversationUrl(accountUrl, chat)}/chat-actions`,
          expectedStatus: HTTP_STATUS_OK,
          responseSchema: chatActionsResponseSchema,
        });
      return response.chat_actions;
    },
    expireChatAction(input: ExpireChatActionInput): Promise<ActionReceipt> {
      if (input.chat.type === 'private') {
        if (input.botId !== undefined) {
          throw new TypeError(
            'expireChatAction takes no botId for a private chat, which names its bot',
          );
        }
        return callEmptyAction(transport, expirePrivateChatActionContract, {
          params: privateChatParams(input.chat),
        });
      }
      if (input.botId === undefined) {
        throw new TypeError(
          'expireChatAction needs the botId whose supergroup chat action expires',
        );
      }
      return requestEmptyAction(fetchImplementation, {
        method: 'POST',
        url: `${conversationUrl(accountUrl, input.chat)}/chat-actions/${
          encodeURIComponent(input.botId)
        }/expiry`,
        expectedStatus: HTTP_STATUS_NO_CONTENT,
      });
    },
    async getMessageDraft({ chat }: AccountMessageDraftInput): Promise<MessageDraft | null> {
      const response = await callJsonOperation(transport, getPrivateMessageDraftContract, {
        params: { ...accountParams, botId: chat.botId },
      });
      return response.message_draft;
    },
    expireMessageDraft({ chat, ...body }: ShownMessageDraftInput): Promise<ActionReceipt> {
      return callEmptyAction(transport, expirePrivateMessageDraftContract, {
        params: { ...accountParams, botId: chat.botId },
        body,
      });
    },
    stopMessageDraft({ chat, ...body }: ShownMessageDraftInput): Promise<ActionReceipt> {
      return callEmptyAction(transport, stopPrivateMessageDraftContract, {
        params: { ...accountParams, botId: chat.botId },
        body,
      });
    },
    async getNotifications({ chat }: AccountNotificationsInput): Promise<readonly Notification[]> {
      const response = chat.type === 'private'
        ? await callJsonOperation(transport, getPrivateChatNotificationsContract, {
          params: privateChatParams(chat),
        })
        : await requestJson(fetchImplementation, {
          method: 'GET',
          url: `${conversationUrl(accountUrl, chat)}/notifications`,
          expectedStatus: HTTP_STATUS_OK,
          responseSchema: notificationsResponseSchema,
        });
      return response.notifications;
    },
    pressCallbackButton,
    async pressButton(
      { chat, message_id, button, expired }: PressButtonInput,
    ): Promise<ActionOutcome<CallbackQuery>> {
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
      const response = await callJsonOperation(transport, getCallbackQueryContract, {
        params: { ...accountParams, callbackQueryId },
      });
      return response.callback_query;
    },
    answerPoll<Target extends MessageTarget>(
      { chat, message_id, option_ids }: AnswerPollInput<Target>,
    ): Promise<ActionOutcome<AccountPollAnswer<Target>>> {
      return chatMessageOperationsFor(chat).answerPoll(message_id, option_ids);
    },
    getPollAnswer<Target extends MessageTarget>(
      input: AccountPollMessageInput<Target>,
    ): Promise<AccountPollAnswer<Target>> {
      return chatMessageOperationsFor(input.chat).readPollAnswer(input.message_id);
    },
    retractPollAnswer(
      { chat, message_id: messageId }: AccountPollMessageInput,
    ): Promise<ActionReceipt> {
      return chat.type === 'private'
        ? callEmptyAction(transport, retractAccountPollAnswerContract, {
          params: { ...accountParams, botId: chat.botId, messageId },
        })
        : callEmptyAction(transport, retractSupergroupAccountPollAnswerContract, {
          params: { ...supergroupParams(chat), messageId },
        });
    },
    stopPoll<Target extends MessageTarget>(
      input: AccountPollMessageInput<Target>,
    ): Promise<ActionOutcome<MessageIn<Target>>> {
      return chatMessageOperationsFor(input.chat).stopPoll(input.message_id);
    },
    setMessageReaction(
      { chat, message_id, reaction }: SetMessageReactionInput,
    ): Promise<ActionOutcome<MessageReactions>> {
      return requestJsonAction(fetchImplementation, {
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
    removeMessageReaction(input: AccountReactionMessageInput): Promise<ActionReceipt> {
      return requestEmptyAction(fetchImplementation, {
        method: 'DELETE',
        url: messageReactionsUrl(accountUrl, input),
        expectedStatus: HTTP_STATUS_NO_CONTENT,
      });
    },
    async sendInlineQuery(input: SendInlineQueryInput): Promise<ActionOutcome<InlineQuery>> {
      const sending = await callJsonAction(transport, sendInlineQueryContract, {
        params: accountParams,
        body: input,
      });
      return selectResult(sending, ({ inline_query }) => inline_query);
    },
    async getInlineQuery(inlineQueryId: string): Promise<InlineQuery> {
      const response = await callJsonOperation(transport, getInlineQueryContract, {
        params: { ...accountParams, inlineQueryId },
      });
      return response.inline_query;
    },
    async chooseInlineQueryResult(
      input: ChooseInlineQueryResultInput,
    ): Promise<ActionOutcome<PrivateMessage | SupergroupMessage>> {
      const inlineQueryId = encodeURIComponent(input.inline_query_id);
      const choice = await requestJsonAction(fetchImplementation, {
        method: 'POST',
        url: `${accountUrl}/inline-queries/${inlineQueryId}/chosen-results`,
        expectedStatus: HTTP_STATUS_CREATED,
        responseSchema: chosenInlineResultResponseSchema,
        body: { result_id: input.result_id },
      });
      return selectResult(choice, ({ message }) => message);
    },
    async getBotCommands({ chat }: AccountBotCommandsInput): Promise<readonly BotCommand[]> {
      const response = await callJsonOperation(transport, getPrivateChatBotCommandsContract, {
        params: privateChatParams(chat),
      });
      return response.commands;
    },
    async getMenuButton({ chat }: AccountMenuButtonInput): Promise<MenuButton> {
      const response = await callJsonOperation(transport, getPrivateChatMenuButtonContract, {
        params: privateChatParams(chat),
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
    async getReplyInterface({ chat }: AccountReplyInterfaceInput): Promise<ReplyInterface | null> {
      const response = chat.type === 'private'
        ? await callJsonOperation(transport, getPrivateChatReplyInterfaceContract, {
          params: privateChatParams(chat),
        })
        : await requestJson(fetchImplementation, {
          method: 'GET',
          url: `${conversationUrl(accountUrl, chat)}/reply-interface`,
          expectedStatus: HTTP_STATUS_OK,
          responseSchema: replyInterfaceResponseSchema,
        });
      return response.reply_interface;
    },
    async pressReplyKeyboardButton<Target extends MessageTarget>(
      input: PressReplyKeyboardButtonInput<Target>,
    ): Promise<ActionOutcome<MessageIn<Target>>> {
      const press = await requestJsonAction(fetchImplementation, {
        method: 'POST',
        url: `${accountUrl}/reply-keyboard-presses`,
        expectedStatus: HTTP_STATUS_CREATED,
        responseSchema: messageResponseSchemasFor(input.chat).sent,
        body: input,
      });
      return selectResult(press, ({ message }) => message);
    },
  });
}

/** The body of an edit of an account's message: new text, or a new caption. */
type AccountMessageEditBody = ControlOperationRequest<typeof editAccountMessageContract>['body'];

/**
 * What an account does with the messages of one of its chats, each operation answering with the
 * messages of the chat's type.
 */
interface ChatMessageOperations<Target extends MessageTarget> {
  readMessages(): Promise<readonly MessageIn<Target>[]>;
  readPinnedMessages(): Promise<readonly MessageIn<Target>[]>;
  editMessage(
    messageId: number,
    body: AccountMessageEditBody,
  ): Promise<ActionOutcome<MessageIn<Target>>>;
  readPollAnswer(messageId: number): Promise<AccountPollAnswer<Target>>;
  answerPoll(
    messageId: number,
    optionIds: readonly number[],
  ): Promise<ActionOutcome<AccountPollAnswer<Target>>>;
  stopPoll(messageId: number): Promise<ActionOutcome<MessageIn<Target>>>;
}

/** Entities as a request body takes them: a list of its own, or none. */
function copyEntities(
  entities: readonly MessageEntityInput[] | undefined,
): MessageEntityInput[] | undefined {
  return entities === undefined ? undefined : [...entities];
}

/** An action's outcome with its result replaced by what `select` takes from it. */
function selectResult<Body, Result>(
  { result, receipt }: ActionOutcome<Body>,
  select: (body: Body) => Result,
): ActionOutcome<Result> {
  return { result: select(result), receipt };
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

/** The URL by which an account pins or unpins a message of a supergroup it is a member of. */
function pinnedMessageUrl(
  accountUrl: string,
  chat: SupergroupMessageTarget,
  messageId: number,
): string {
  return `${conversationUrl(accountUrl, chat)}/pinned-messages/${encodeURIComponent(messageId)}`;
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
    }
    : { sent: sentMessageResponseSchema, sentAlbum: sentMediaGroupResponseSchema };
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
