import {
  deleteAccountMessageContract,
  deleteSupergroupAccountMessageContract,
  editAccountMessageContract,
  editSupergroupAccountMessageContract,
  getPrivateMessageHistoryContract,
  getSupergroupMessageHistoryContract,
} from '../../src/api/contracts/account_messages.ts';
import { createAccountContract } from '../../src/api/contracts/accounts.ts';
import { blockBotContract, unblockBotContract } from '../../src/api/contracts/blocked_bots.ts';
import { createBotContract } from '../../src/api/contracts/bots.ts';
import {
  getCallbackQueryContract,
  pressCallbackButtonContract,
} from '../../src/api/contracts/callback_queries.ts';
import {
  expirePrivateChatActionContract,
  expireSupergroupChatActionContract,
  getPrivateChatActionsContract,
  getSupergroupChatActionsContract,
} from '../../src/api/contracts/chat_actions.ts';
import {
  getPrivateChatBotCommandsContract,
  getPrivateChatMenuButtonContract,
  getPrivateChatNotificationsContract,
  getPrivateChatReplyInterfaceContract,
  getSupergroupBotCommandsContract,
  getSupergroupNotificationsContract,
  getSupergroupReplyInterfaceContract,
} from '../../src/api/contracts/conversation_reads.ts';
import { downloadFileContract } from '../../src/api/contracts/files.ts';
import {
  chooseInlineQueryResultContract,
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
import {
  getSupergroupMessageReactionsContract,
  removeSupergroupAccountMessageReactionContract,
  setSupergroupAccountMessageReactionContract,
} from '../../src/api/contracts/message_reactions.ts';
import {
  sendAccountMediaGroupContract,
  sendAccountMessageContract,
} from '../../src/api/contracts/message_sending.ts';
import type { ControlOperationRequest } from '../../src/api/contracts/operation_contract.ts';
import {
  getPrivatePinnedMessagesContract,
  getSupergroupPinnedMessagesContract,
  pinPrivateMessageContract,
  pinSupergroupMessageContract,
  unpinPrivateMessageContract,
  unpinSupergroupMessageContract,
} from '../../src/api/contracts/pinned_messages.ts';
import {
  answerAccountPollContract,
  answerSupergroupAccountPollContract,
  getAccountPollAnswerContract,
  getSupergroupAccountPollAnswerContract,
  retractAccountPollAnswerContract,
  retractSupergroupAccountPollAnswerContract,
  stopAccountPollContract,
  stopSupergroupAccountPollContract,
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
import { pressReplyKeyboardButtonContract } from '../../src/api/contracts/reply_keyboard_presses.ts';
import { registerWebResourceContract } from '../../src/api/contracts/web_resources.ts';
import { createHttpBotActivityPageReader } from './bot_activity_http_page_reader.ts';
import { createBotActivityLog } from './bot_activity_log.ts';
import { HTTP_STATUS_OK } from './constants.ts';
import {
  callBytesOperation,
  callEmptyAction,
  callEmptyOperation,
  callJsonAction,
  callJsonOperation,
  type ControlOperationTransport,
  describeOperationCall,
} from './control_operation_caller.ts';
import { ButtonSelectionError, findButton } from './message_buttons.ts';
import { EmulationClientError } from './emulation_client_error.ts';
import { getMeResponseSchema } from './schemas.ts';
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
  AccountPollInput,
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
  RequestDetails,
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
import { normalizeUrlRoot, requestJson } from './utils.ts';

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
      account: createVirtualAccountClient(account, {
        transport: this.#transport,
        sessionId: this.id,
      }),
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
      answerPoll(messageId, body) {
        return callJsonAction(transport, answerAccountPollContract, {
          params: { ...params, messageId },
          body,
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
    const params = supergroupParams(chat);
    return {
      async readMessages() {
        const response = await callJsonOperation(transport, getSupergroupMessageHistoryContract, {
          params,
        });
        return response.messages;
      },
      async readPinnedMessages() {
        const response = await callJsonOperation(transport, getSupergroupPinnedMessagesContract, {
          params,
        });
        return response.messages;
      },
      async editMessage(messageId, body) {
        const edit = await callJsonAction(transport, editSupergroupAccountMessageContract, {
          params: { ...params, messageId },
          body,
        });
        return selectResult(edit, ({ message }) => message);
      },
      readPollAnswer(messageId) {
        return callJsonOperation(transport, getSupergroupAccountPollAnswerContract, {
          params: { ...params, messageId },
        });
      },
      answerPoll(messageId, body) {
        return callJsonAction(transport, answerSupergroupAccountPollContract, {
          params: { ...params, messageId },
          body,
        });
      },
      async stopPoll(messageId) {
        const closure = await callJsonAction(transport, stopSupergroupAccountPollContract, {
          params: { ...params, messageId },
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

  /** Sends a message as the account to `to`, which the message shows as its chat. */
  async function sendMessageTo<Target extends MessageTarget>(
    to: Target,
    body: SendAccountMessageBody,
  ): Promise<ActionOutcome<MessageIn<Target>>> {
    const request = { params: accountParams, body };
    const sending = await callJsonAction(transport, sendAccountMessageContract, request);
    const call = describeOperationCall(transport, sendAccountMessageContract, request);
    return selectResult(sending, ({ message }) => messageInChat(to, message, call));
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
    sendMessage<Target extends MessageTarget>(
      input: AccountSendMessageInput<Target>,
    ): Promise<ActionOutcome<MessageIn<Target>>> {
      return sendMessageTo(input.to, { ...input, entities: copyEntities(input.entities) });
    },
    sendPhoto<Target extends MessageTarget>(
      { photo, caption_entities, ...message }: AccountSendPhotoInput<Target>,
    ): Promise<ActionOutcome<MessageIn<Target>>> {
      return sendMessageTo(message.to, {
        ...message,
        photo: { content_base64: photo.toBase64() },
        caption_entities: copyEntities(caption_entities),
      });
    },
    sendDocument<Target extends MessageTarget>(
      { document, file_name, caption_entities, ...message }: AccountSendDocumentInput<Target>,
    ): Promise<ActionOutcome<MessageIn<Target>>> {
      return sendMessageTo(message.to, {
        ...message,
        document: { content_base64: document.toBase64(), file_name },
        caption_entities: copyEntities(caption_entities),
      });
    },
    sendVideo<Target extends MessageTarget>(
      { video, file_name, duration, width, height, caption_entities, ...message }:
        AccountSendVideoInput<Target>,
    ): Promise<ActionOutcome<MessageIn<Target>>> {
      return sendMessageTo(message.to, {
        ...message,
        video: toAccountVideoUpload({ video, file_name, duration, width, height }),
        caption_entities: copyEntities(caption_entities),
      });
    },
    sendVoice<Target extends MessageTarget>(
      { voice, duration, caption_entities, ...message }: AccountSendVoiceInput<Target>,
    ): Promise<ActionOutcome<MessageIn<Target>>> {
      return sendMessageTo(message.to, {
        ...message,
        voice: { content_base64: voice.toBase64(), duration },
        caption_entities: copyEntities(caption_entities),
      });
    },
    sendAudio<Target extends MessageTarget>(
      { audio, file_name, duration, performer, title, caption_entities, ...message }:
        AccountSendAudioInput<Target>,
    ): Promise<ActionOutcome<MessageIn<Target>>> {
      return sendMessageTo(message.to, {
        ...message,
        audio: toAccountAudioUpload({ audio, file_name, duration, performer, title }),
        caption_entities: copyEntities(caption_entities),
      });
    },
    sendContact<Target extends MessageTarget>(
      input: AccountSendContactInput<Target>,
    ): Promise<ActionOutcome<MessageIn<Target>>> {
      return sendMessageTo(input.to, input);
    },
    shareOwnContact<Target extends MessageTarget>(
      input: AccountShareOwnContactInput<Target>,
    ): Promise<ActionOutcome<MessageIn<Target>>> {
      return sendMessageTo(input.to, { ...input, own_contact: true });
    },
    sendLocation<Target extends MessageTarget>(
      input: AccountSendLocationInput<Target>,
    ): Promise<ActionOutcome<MessageIn<Target>>> {
      return sendMessageTo(input.to, input);
    },
    sendPoll<Target extends MessageTarget>(
      input: AccountSendPollInput<Target>,
    ): Promise<ActionOutcome<MessageIn<Target>>> {
      return sendMessageTo(input.to, { ...input, poll: toAccountPollBody(input.poll) });
    },
    async sendMediaGroup<Target extends MessageTarget>(
      { media, ...album }: AccountSendMediaGroupInput<Target>,
    ): Promise<ActionOutcome<readonly MessageIn<Target>[]>> {
      const { to } = album;
      const request = {
        params: accountParams,
        body: {
          ...album,
          media: media.map((item) => ({
            ...toAccountMediaGroupFile(item),
            caption: item.caption,
            caption_entities: copyEntities(item.caption_entities),
          })),
        },
      };
      const sending = await callJsonAction(transport, sendAccountMediaGroupContract, request);
      const call = describeOperationCall(transport, sendAccountMediaGroupContract, request);
      return selectResult(
        sending,
        ({ messages }) => messages.map((message) => messageInChat(to, message, call)),
      );
    },
    forwardMessage<Target extends MessageTarget>(
      { from, message_id, ...message }: AccountForwardMessageInput<Target>,
    ): Promise<ActionOutcome<MessageIn<Target>>> {
      return sendMessageTo(message.to, { ...message, forward: { chat: from, message_id } });
    },
    editMessage<Target extends MessageTarget>(
      { chat, message_id, entities, ...edit }: AccountEditMessageInput<Target>,
    ): Promise<ActionOutcome<MessageIn<Target>>> {
      return chatMessageOperationsFor(chat).editMessage(message_id, {
        ...edit,
        entities: copyEntities(entities),
      });
    },
    editMessageCaption<Target extends MessageTarget>(
      { chat, message_id, caption_entities, ...edit }: AccountEditMessageCaptionInput<Target>,
    ): Promise<ActionOutcome<MessageIn<Target>>> {
      return chatMessageOperationsFor(chat).editMessage(message_id, {
        ...edit,
        caption_entities: copyEntities(caption_entities),
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
      return callEmptyAction(transport, deleteSupergroupAccountMessageContract, {
        params: { ...supergroupParams(chat), messageId },
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
      return callEmptyAction(transport, pinSupergroupMessageContract, {
        params: { ...supergroupParams(chat), messageId },
      });
    },
    unpinMessage({ chat, message_id: messageId }: AccountPinMessageInput): Promise<ActionReceipt> {
      if (chat.type === 'private') {
        return callEmptyAction(transport, unpinPrivateMessageContract, {
          params: { ...privateChatParams(chat), messageId },
        });
      }
      return callEmptyAction(transport, unpinSupergroupMessageContract, {
        params: { ...supergroupParams(chat), messageId },
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
        : await callJsonOperation(transport, getSupergroupChatActionsContract, {
          params: supergroupParams(chat),
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
      return callEmptyAction(transport, expireSupergroupChatActionContract, {
        params: { ...supergroupParams(input.chat), botId: input.botId },
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
        : await callJsonOperation(transport, getSupergroupNotificationsContract, {
          params: supergroupParams(chat),
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
      { chat, message_id, option_ids, ...answer }: AnswerPollInput<Target>,
    ): Promise<ActionOutcome<AccountPollAnswer<Target>>> {
      return chatMessageOperationsFor(chat).answerPoll(message_id, {
        ...answer,
        option_ids: [...option_ids],
      });
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
      { chat, message_id: messageId, reaction, ...choice }: SetMessageReactionInput,
    ): Promise<ActionOutcome<MessageReactions>> {
      return callJsonAction(transport, setSupergroupAccountMessageReactionContract, {
        params: { ...supergroupParams(chat), messageId },
        body: { ...choice, reaction: [...reaction] },
      });
    },
    getMessageReactions(
      { chat, message_id: messageId }: AccountReactionMessageInput,
    ): Promise<MessageReactions> {
      return callJsonOperation(transport, getSupergroupMessageReactionsContract, {
        params: { ...supergroupParams(chat), messageId },
      });
    },
    removeMessageReaction(
      { chat, message_id: messageId }: AccountReactionMessageInput,
    ): Promise<ActionReceipt> {
      return callEmptyAction(transport, removeSupergroupAccountMessageReactionContract, {
        params: { ...supergroupParams(chat), messageId },
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
      { inline_query_id: inlineQueryId, ...choice }: ChooseInlineQueryResultInput,
    ): Promise<ActionOutcome<PrivateMessage | SupergroupMessage>> {
      const sending = await callJsonAction(transport, chooseInlineQueryResultContract, {
        params: { ...accountParams, inlineQueryId },
        body: choice,
      });
      return selectResult(sending, ({ message }) => message);
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
      { chat }: AccountSupergroupBotCommandsInput,
    ): Promise<readonly SupergroupBotCommands[]> {
      const response = await callJsonOperation(transport, getSupergroupBotCommandsContract, {
        params: supergroupParams(chat),
      });
      return response.bot_commands;
    },
    async getReplyInterface({ chat }: AccountReplyInterfaceInput): Promise<ReplyInterface | null> {
      const response = chat.type === 'private'
        ? await callJsonOperation(transport, getPrivateChatReplyInterfaceContract, {
          params: privateChatParams(chat),
        })
        : await callJsonOperation(transport, getSupergroupReplyInterfaceContract, {
          params: supergroupParams(chat),
        });
      return response.reply_interface;
    },
    async pressReplyKeyboardButton<Target extends MessageTarget>(
      { chat, shared_user_ids, poll, ...answer }: PressReplyKeyboardButtonInput<Target>,
    ): Promise<ActionOutcome<MessageIn<Target>>> {
      const request = {
        params: accountParams,
        body: {
          chat,
          ...answer,
          ...(shared_user_ids === undefined ? {} : { shared_user_ids: [...shared_user_ids] }),
          ...(poll === undefined ? {} : { poll: toAccountPollBody(poll) }),
        },
      };
      const press = await callJsonAction(transport, pressReplyKeyboardButtonContract, request);
      const call = describeOperationCall(transport, pressReplyKeyboardButtonContract, request);
      return selectResult(press, ({ message }) => messageInChat(chat, message, call));
    },
  });
}

/** The body of a message an account sends. */
type SendAccountMessageBody = ControlOperationRequest<typeof sendAccountMessageContract>['body'];

/**
 * A poll an account creates, as a request body takes it: with lists of its own, and every field
 * the input gives, which the emulator checks.
 */
function toAccountPollBody(poll: AccountPollInput) {
  const lists = {
    question_entities: copyEntities(poll.question_entities),
    options: poll.options.map((option) => ({
      ...option,
      text_entities: copyEntities(option.text_entities),
    })),
  };
  return poll.type === 'quiz'
    ? {
      ...poll,
      ...lists,
      correct_option_ids: [...poll.correct_option_ids],
      explanation_entities: copyEntities(poll.explanation_entities),
    }
    : { ...poll, ...lists };
}

/** The body of an account's answer to a poll: the options it chooses. */
type AnswerPollBody = ControlOperationRequest<typeof answerAccountPollContract>['body'];

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
    body: AnswerPollBody,
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

/**
 * A message an action sent to `chat`, as a message of the chat's type. The action's contract
 * answers with a private or a supergroup message; one of the other chat's type breaks what the
 * action promises, so the client refuses it, as it refuses a response that breaks its contract.
 *
 * @throws {EmulationClientError} when the message is not of the chat's type.
 */
function messageInChat<Target extends MessageTarget>(
  chat: Target,
  message: PrivateMessage | SupergroupMessage,
  call: RequestDetails,
): MessageIn<Target> {
  if (message.chat.type !== chat.type) {
    throw new EmulationClientError(
      `${call.method} ${call.url} returned a message of a ${message.chat.type} chat for a ${chat.type} chat`,
      call,
    );
  }
  // The check above tells that the message is of the chat's type, which TypeScript cannot relate
  // to the generic target.
  return message as MessageIn<Target>;
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
