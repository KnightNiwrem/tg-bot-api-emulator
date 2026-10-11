import { z } from 'zod';

import type { BotApiChatFullInfo } from '../../../../types/bot_api.ts';
import type { FormerSupergroupMemberFailureReason } from '../../../../types/chat_membership.ts';
import type { VirtualBotProfile } from '../../../../types/virtual_bot.ts';
import { getBotApiChatAddress } from '../../../../types/virtual_chat.ts';
import { excludeMissingBotFailure } from '../authenticated_bot_failures.ts';
import {
  botChatAccessFailureAnswer,
  findPrivateChatRefusal,
  isPrivateChatKnown,
  requireSpecifiedChatId,
} from '../chat_access.ts';
import { readChatPermissionsParameter } from '../chat_permissions_parameter.ts';
import { presentChatInfoChangeFailure } from '../errors/chat_info_failure_presenter.ts';
import { type BotApiFamilyContext, type BotApiMethod, botApiResult } from '../method_call.ts';
import {
  answerWithBadRequest,
  commandMethodOfSteps,
  handledMethodOfSteps,
  proceedWith,
  startSteps,
} from '../method_steps.ts';
import { booleanParameter, integerParameter } from '../request_parameters.ts';

// Telegram reads a missing title or description as empty text.
const setChatTitleParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
  title: z.string().default(''),
});

const setChatDescriptionParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
  description: z.string().default(''),
});

// As for restrictChatMember, the deprecated permissions given as separate parameters are refused.
const setChatPermissionsParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
  permissions: z.string().optional(),
  use_independent_chat_permissions: booleanParameter().default(false),
});

const getChatParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
});

/**
 * What the chat information methods use: the service that administers shared chats, the private
 * chats the bot knows, and, to show a chat, its newest pinned message, the bot's primary invite
 * link and the view of the chat.
 */
type ChatInfoContext = BotApiFamilyContext<
  | 'sharedChatAdministration'
  | 'privateMessaging'
  | 'messagePinning'
  | 'chatAdmission'
  | 'botMessageViews'
>;

/** Why `getChat` found no chat to show. */
export interface ChatLookupFailure {
  readonly found: false;
  readonly reason: 'chat_not_found' | FormerSupergroupMemberFailureReason;
}

/**
 * The methods that read a chat, or change its title, description or permissions. Each change is
 * executed as a command in its call's transaction; `getChat` changes nothing, and answers from its
 * handler.
 */
export const CHAT_INFO_METHODS: readonly BotApiMethod[] = [
  handledMethodOfSteps({
    name: 'getChat',
    recordsActivity: true,
    parameters: getChatParametersSchema,
    steps: ({ parameters }) => startSteps(parameters).andThen(requireSpecifiedChatId),
    execute: (context: ChatInfoContext, { chat_id: chatId }) => {
      const result = findChatFullInfo(context, chatId);
      return result.found ? botApiResult(result.chat) : botChatAccessFailureAnswer(result.reason);
    },
  }),
  commandMethodOfSteps({
    name: 'setChatDescription',
    recordsActivity: true,
    parameters: setChatDescriptionParametersSchema,
    steps: ({ parameters }) => startSteps(parameters).andThen(requireSpecifiedChatId),
    // As TDLib's `set_dialog_description` refuses, a private chat's description cannot be changed.
    execute: (context: ChatInfoContext, { chat_id: chatId, description }) => {
      const privateChatRefusal = findPrivateChatRefusal(
        context,
        chatId,
        'private_chat_info_unchangeable',
      );
      if (privateChatRefusal !== undefined) {
        return presentChatInfoChangeFailure('chat_description_change', {
          set: false,
          reason: privateChatRefusal,
        });
      }
      const result = context.session.sharedChatAdministration.changeSupergroupDescription({
        actor: { kind: 'bot', botId: context.bot.id },
        chatId,
        description,
      });
      return result.changed
        ? botApiResult(true)
        : presentChatInfoChangeFailure('chat_description_change', {
          set: false,
          reason: excludeAccountActorFailure(context.bot, chatId, result.reason),
        });
    },
  }),
  // Telegram reads the permissions before it looks at the chat.
  commandMethodOfSteps({
    name: 'setChatPermissions',
    recordsActivity: true,
    parameters: setChatPermissionsParametersSchema,
    steps: ({ parameters, invalidParametersDescription }) =>
      startSteps(parameters)
        .andThen(({ permissions, use_independent_chat_permissions, ...otherParameters }) => {
          const permissionsReading = readChatPermissionsParameter(permissions, {
            usesIndependentChatPermissions: use_independent_chat_permissions,
            invalidParametersDescription,
          });
          return permissionsReading.read
            ? proceedWith({ ...otherParameters, permissions: permissionsReading.permissions })
            : answerWithBadRequest(permissionsReading.description);
        })
        .andThen(requireSpecifiedChatId),
    // As TDLib's `set_dialog_permissions` refuses, a private chat's permissions cannot be changed.
    execute: (context: ChatInfoContext, { chat_id: chatId, permissions }) => {
      const privateChatRefusal = findPrivateChatRefusal(
        context,
        chatId,
        'private_chat_permissions_unchangeable',
      );
      if (privateChatRefusal !== undefined) {
        return presentChatInfoChangeFailure('chat_permissions_change', {
          set: false,
          reason: privateChatRefusal,
        });
      }
      const result = context.session.sharedChatAdministration.changeDefaultPermissions({
        actor: { kind: 'bot', botId: context.bot.id },
        chatId,
        permissions,
      });
      return result.changed
        ? botApiResult(true)
        : presentChatInfoChangeFailure('chat_permissions_change', {
          set: false,
          reason: excludeAccountActorFailure(context.bot, chatId, result.reason),
        });
    },
  }),
  commandMethodOfSteps({
    name: 'setChatTitle',
    recordsActivity: true,
    parameters: setChatTitleParametersSchema,
    steps: ({ parameters }) => startSteps(parameters).andThen(requireSpecifiedChatId),
    // The bot then receives its own service message. As TDLib's `set_dialog_title` refuses, a
    // private chat's title cannot be changed.
    execute: (context: ChatInfoContext, { chat_id: chatId, title }) => {
      const privateChatRefusal = findPrivateChatRefusal(
        context,
        chatId,
        'private_chat_info_unchangeable',
      );
      if (privateChatRefusal !== undefined) {
        return presentChatInfoChangeFailure('chat_title_change', {
          set: false,
          reason: privateChatRefusal,
        });
      }
      const result = context.session.sharedChatAdministration.changeSupergroupTitle({
        actor: { kind: 'bot', botId: context.bot.id },
        chatId,
        title,
      });
      return result.changed
        ? botApiResult(true)
        : presentChatInfoChangeFailure('chat_title_change', {
          set: false,
          reason: excludeAccountActorFailure(context.bot, chatId, result.reason),
        });
    },
  }),
];

/**
 * Finds everything a bot may learn about a chat: the private chat with an account that started
 * it, or a supergroup the bot may read, which a public one is to bots that are not members. It
 * shows the chat's newest pinned message, as the official Bot API server's `getChat` asks TDLib's
 * `getChatPinnedMessage` for it, and a supergroup shows the bot's own primary invite link, as
 * `ChatAdmissionService.findPrimaryInviteLinkOfBot` finds it.
 */
function findChatFullInfo(
  context: ChatInfoContext,
  chatId: number,
): { readonly found: true; readonly chat: BotApiChatFullInfo } | ChatLookupFailure {
  const { session, bot } = context;
  const chat = getBotApiChatAddress(chatId);
  let fullInfo: BotApiChatFullInfo | undefined;
  if (chat.type === 'private') {
    if (!isPrivateChatKnown(context, chat)) {
      return { found: false, reason: 'chat_not_found' };
    }
    fullInfo = session.botMessageViews.viewPrivateChatFullInfo({
      accountId: chat.peerId,
      pinnedMessage: session.messagePinning.findNewestPinnedMessage({
        type: 'private',
        conversation: { accountId: chat.peerId, botId: bot.id },
      }),
    });
  } else {
    const result = session.sharedChatAdministration.getReadableSupergroup({
      observerBotId: bot.id,
      chatId,
    });
    if (!result.found) {
      return { found: false, reason: excludeMissingBotFailure(bot, result.reason) };
    }
    const primaryInviteLink = session.chatAdmission.findPrimaryInviteLinkOfBot({
      botId: bot.id,
      chatId,
    });
    fullInfo = session.botMessageViews.viewSupergroupChatFullInfo({
      chatId,
      observerBotId: bot.id,
      pinnedMessage: session.messagePinning.findNewestPinnedMessage({ type: 'supergroup', chatId }),
      primaryInviteLink,
    });
  }
  if (fullInfo === undefined) {
    throw new Error(`Chat ${chatId} was found but cannot be shown`);
  }
  return { found: true, chat: fullInfo };
}

/**
 * Leaves out the failures of a supergroup change that only an account meets, which an
 * authenticated bot never does: it exists, and a supergroup refuses it as a former member, not as a
 * non-member account.
 */
function excludeAccountActorFailure<Reason extends string>(
  authenticatedBot: VirtualBotProfile,
  chatId: number,
  reason: Reason | 'actor_not_found' | 'not_a_member',
): Reason {
  if (reason === 'actor_not_found' || reason === 'not_a_member') {
    throw new Error(`Bot ${authenticatedBot.id} could not act in chat ${chatId}: ${reason}`);
  }
  return reason;
}
