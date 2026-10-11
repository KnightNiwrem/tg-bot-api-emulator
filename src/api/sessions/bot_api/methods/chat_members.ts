import { z } from 'zod';

import type { BotApiChatMember } from '../../../../types/bot_api.ts';
import {
  type ChatMemberStatus,
  getSupergroupNonMemberFailureReason,
  grantSupergroupAdministratorRights,
  SUPERGROUP_ADMINISTRATOR_RIGHTS,
  type SupergroupAdministratorRights,
} from '../../../../types/chat_membership.ts';
import { getBotApiChatAddress } from '../../../../types/virtual_chat.ts';
import {
  excludeMissingBotFailure,
  missingAuthenticatedBotError,
} from '../authenticated_bot_failures.ts';
import {
  findPrivateChatRefusal,
  isPrivateChatKnown,
  requireSpecifiedChatId,
} from '../chat_access.ts';
import { readChatMemberTargetStep, requireValidUserId } from '../chat_member_requests.ts';
import { readChatPermissionsParameter } from '../chat_permissions_parameter.ts';
import { presentChatMemberFailure } from '../errors/chat_member_failure_presenter.ts';
import { BOT_API_ERRORS } from '../errors/error_catalogue.ts';
import { presentFixedBotApiError } from '../errors/error_template.ts';
import { type BotApiFamilyContext, type BotApiMethod, botApiResult } from '../method_call.ts';
import {
  answerWith,
  answerWithBadRequest,
  type BotApiStepResult,
  commandMethodOfSteps,
  handledMethodOfSteps,
  proceedWith,
  startSteps,
} from '../method_steps.ts';
import { booleanParameter, integerParameter } from '../request_parameters.ts';

const leaveChatParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
});

const getChatMemberParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
  user_id: integerParameter(z.int()).optional(),
});

const getChatAdministratorsParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
  return_bots: booleanParameter().default(false),
});

const getChatMemberCountParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
});

// Telegram always revokes a removed member's access to a supergroup's messages, and the emulator
// shows no member a history it cannot read, so `revoke_messages` is validated and ignored.
const banChatMemberParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
  user_id: integerParameter(z.int()).optional(),
  until_date: integerParameter(z.int()).optional(),
  revoke_messages: booleanParameter().optional(),
});

const setChatAdministratorCustomTitleParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
  user_id: integerParameter(z.int()).optional(),
  custom_title: z.string().optional(),
});

// The official server also reads `can_manage_voice_chats`, the deprecated name of
// `can_manage_video_chats`. It reads the rights that apply only to channels, which TDLib's
// `AdministratorRights` drops in supergroups, and `is_anonymous`, whose administrators the emulator
// does not support.
const promoteChatMemberParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
  user_id: integerParameter(z.int()).optional(),
  is_anonymous: booleanParameter().optional(),
  can_manage_chat: booleanParameter().optional(),
  can_delete_messages: booleanParameter().optional(),
  can_manage_video_chats: booleanParameter().optional(),
  can_manage_voice_chats: booleanParameter().optional(),
  can_restrict_members: booleanParameter().optional(),
  can_promote_members: booleanParameter().optional(),
  can_change_info: booleanParameter().optional(),
  can_invite_users: booleanParameter().optional(),
  can_post_stories: booleanParameter().optional(),
  can_edit_stories: booleanParameter().optional(),
  can_delete_stories: booleanParameter().optional(),
  can_post_messages: booleanParameter().optional(),
  can_edit_messages: booleanParameter().optional(),
  can_pin_messages: booleanParameter().optional(),
  can_manage_topics: booleanParameter().optional(),
  can_manage_direct_messages: booleanParameter().optional(),
  can_manage_tags: booleanParameter().optional(),
  can_send_welcome_messages: booleanParameter().optional(),
});

type PromoteChatMemberParameters = z.output<typeof promoteChatMemberParametersSchema>;

// Telegram also reads the deprecated permissions given as separate parameters, such as
// `can_send_messages`; rejecting them instead surfaces the bot's mistake in tests.
const restrictChatMemberParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
  user_id: integerParameter(z.int()).optional(),
  permissions: z.string().optional(),
  use_independent_chat_permissions: booleanParameter().default(false),
  until_date: integerParameter(z.int()).optional(),
});

const unbanChatMemberParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
  user_id: integerParameter(z.int()).optional(),
  only_if_banned: booleanParameter().default(false),
});

/**
 * What the chat member methods use: the service that administers shared chats, the view of a
 * chat's members, and the private chats the bot knows.
 */
type ChatMemberContext = BotApiFamilyContext<
  'sharedChatAdministration' | 'botMessageViews' | 'privateMessaging'
>;

/**
 * The methods that read a chat's members, moderate or promote them, or make the bot leave. Each
 * method that changes the chat is executed as a command in its call's transaction; the reads
 * change nothing, and answer from their handlers.
 */
export const CHAT_MEMBER_METHODS: readonly BotApiMethod[] = [
  commandMethodOfSteps({
    name: 'banChatMember',
    recordsActivity: true,
    parameters: banChatMemberParametersSchema,
    steps: ({ parameters }) =>
      startSteps(parameters).andThen((ban) => {
        const targetReading = readChatMemberTargetStep(ban);
        return targetReading.proceeds
          ? proceedWith({ ...targetReading.value, untilUnixSeconds: ban.until_date })
          : targetReading;
      }),
    // A private chat has no members to ban.
    execute: (context: ChatMemberContext, { chatId, userId, untilUnixSeconds }) => {
      const privateChatRefusal = findPrivateChatRefusal(
        context,
        chatId,
        'private_chat_members_not_bannable',
      );
      if (privateChatRefusal !== undefined) {
        return presentChatMemberFailure('member_moderation', {
          banned: false,
          reason: privateChatRefusal,
        });
      }
      const result = context.session.sharedChatAdministration.banChatMember({
        actorBotId: context.bot.id,
        chatId,
        memberId: userId,
        requestedBanEndUnixSeconds: untilUnixSeconds,
      });
      return result.banned ? botApiResult(true) : presentChatMemberFailure('member_moderation', {
        banned: false,
        reason: excludeMissingBotFailure(context.bot, result.reason),
      });
    },
  }),
  handledMethodOfSteps({
    name: 'getChatAdministrators',
    recordsActivity: true,
    parameters: getChatAdministratorsParametersSchema,
    steps: ({ parameters }) => startSteps(parameters).andThen(requireSpecifiedChatId),
    // As on Telegram, administrators that are other bots are left out unless requested; a private
    // chat has none.
    execute: (context: ChatMemberContext, { chat_id: chatId, return_bots: includesOtherBots }) => {
      const privateChatRefusal = findPrivateChatRefusal(
        context,
        chatId,
        'private_chat_has_no_administrators',
      );
      if (privateChatRefusal !== undefined) {
        return presentChatMemberFailure('member_lookup', {
          found: false,
          reason: privateChatRefusal,
        });
      }
      const result = context.session.sharedChatAdministration.getChatAdministrators({
        observerBotId: context.bot.id,
        chatId,
      });
      if (!result.found) {
        return presentChatMemberFailure('member_lookup', {
          found: false,
          reason: excludeMissingBotFailure(context.bot, result.reason),
        });
      }
      const administrators = result.administrators
        .map(({ userId, status }) => viewChatMember(context, { chatId, userId, status }))
        .filter(({ user }) => includesOtherBots || !user.is_bot || user.id === context.bot.id);
      return botApiResult(administrators);
    },
  }),
  handledMethodOfSteps({
    name: 'getChatMember',
    recordsActivity: true,
    parameters: getChatMemberParametersSchema,
    steps: ({ parameters }) => startSteps(parameters).andThen(readChatMemberTargetStep),
    // In a private chat, either participant is a member; in a supergroup, the bot must be a
    // member, and a user of the session that never joined has `left`.
    execute: (context: ChatMemberContext, { chatId, userId }) => {
      const chat = getBotApiChatAddress(chatId);
      if (chat.type === 'private') {
        if (!isPrivateChatKnown(context, chat)) {
          return presentChatMemberFailure('member_lookup', {
            found: false,
            reason: 'chat_not_found',
          });
        }
        return userId === context.bot.id || userId === chat.peerId
          ? botApiResult(viewChatMember(context, { chatId, userId, status: { status: 'member' } }))
          : presentChatMemberFailure('member_lookup', {
            found: false,
            reason: 'member_not_found',
          });
      }
      const result = context.session.sharedChatAdministration.getChatMemberStatus({
        observerBotId: context.bot.id,
        chatId,
        userId,
      });
      return result.found
        ? botApiResult(viewChatMember(context, { chatId, userId, status: result.status }))
        : presentChatMemberFailure('member_lookup', {
          found: false,
          reason: excludeMissingBotFailure(context.bot, result.reason),
        });
    },
  }),
  handledMethodOfSteps({
    name: 'getChatMemberCount',
    recordsActivity: true,
    parameters: getChatMemberCountParametersSchema,
    steps: ({ parameters }) => startSteps(parameters).andThen(requireSpecifiedChatId),
    // A private chat has both its participants; a supergroup counts its members.
    execute: (context: ChatMemberContext, { chat_id: chatId }) => {
      const chat = getBotApiChatAddress(chatId);
      if (chat.type === 'private') {
        return isPrivateChatKnown(context, chat)
          ? botApiResult(PRIVATE_CHAT_MEMBER_COUNT)
          : presentChatMemberFailure('member_lookup', { found: false, reason: 'chat_not_found' });
      }
      const result = context.session.sharedChatAdministration.getChatMemberCount({
        observerBotId: context.bot.id,
        chatId,
      });
      return result.found
        ? botApiResult(result.memberCount)
        : presentChatMemberFailure('member_lookup', {
          found: false,
          reason: excludeMissingBotFailure(context.bot, result.reason),
        });
    },
  }),
  commandMethodOfSteps({
    name: 'leaveChat',
    recordsActivity: true,
    parameters: leaveChatParametersSchema,
    steps: ({ parameters }) => startSteps(parameters).andThen(requireSpecifiedChatId),
    execute: (context: ChatMemberContext, { chat_id: chatId }) => leaveChat(context, chatId),
  }),
  // As the official server's `process_promote_chat_member_query` reads them, each right is a
  // separate parameter, a missing one is false, and passing none demotes an administrator.
  commandMethodOfSteps({
    name: 'promoteChatMember',
    recordsActivity: true,
    parameters: promoteChatMemberParametersSchema,
    steps: ({ parameters }) =>
      startSteps(parameters)
        .andThen((promotion) => {
          const targetReading = readChatMemberTargetStep(promotion);
          return targetReading.proceeds
            ? proceedWith({ target: targetReading.value, promotion })
            : targetReading;
        })
        .andThen(({ target, promotion }) => {
          const anonymityReading = refuseAnonymousAdministrator(promotion);
          return anonymityReading.proceeds
            ? proceedWith({ ...target, rights: readPromotedSupergroupRights(promotion) })
            : anonymityReading;
        }),
    // As the official server's `process_promote_chat_member_query` refuses, a private chat has no
    // members to promote.
    execute: (context: ChatMemberContext, { chatId, userId, rights }) => {
      const privateChatRefusal = findPrivateChatRefusal(
        context,
        chatId,
        'method_unavailable_in_private_chats',
      );
      if (privateChatRefusal !== undefined) {
        return presentChatMemberFailure('member_promotion', {
          promoted: false,
          reason: privateChatRefusal,
        });
      }
      const result = context.session.sharedChatAdministration.promoteChatMemberAsBot({
        actorBotId: context.bot.id,
        chatId,
        memberId: userId,
        rights,
      });
      return result.promoted ? botApiResult(true) : presentChatMemberFailure('member_promotion', {
        promoted: false,
        reason: excludeMissingBotFailure(context.bot, result.reason),
      });
    },
  }),
  // Telegram reads the user, then the permissions, before it looks at the chat.
  commandMethodOfSteps({
    name: 'restrictChatMember',
    recordsActivity: true,
    parameters: restrictChatMemberParametersSchema,
    steps: ({ parameters, invalidParametersDescription }) =>
      startSteps(parameters)
        .andThen(requireValidUserId)
        .andThen((restriction) => {
          const permissionsReading = readChatPermissionsParameter(restriction.permissions, {
            usesIndependentChatPermissions: restriction.use_independent_chat_permissions,
            invalidParametersDescription,
          });
          return permissionsReading.read
            ? proceedWith({ restriction, permissions: permissionsReading.permissions })
            : answerWithBadRequest(permissionsReading.description);
        })
        .andThen(({ restriction, permissions }) => {
          const targetReading = readChatMemberTargetStep(restriction);
          return targetReading.proceeds
            ? proceedWith({
              ...targetReading.value,
              permissions,
              untilUnixSeconds: restriction.until_date,
            })
            : targetReading;
        }),
    // As the official server's `process_restrict_chat_member_query` refuses, a private chat has no
    // members to restrict.
    execute: (context: ChatMemberContext, { chatId, userId, permissions, untilUnixSeconds }) => {
      const privateChatRefusal = findPrivateChatRefusal(
        context,
        chatId,
        'method_unavailable_outside_supergroups',
      );
      if (privateChatRefusal !== undefined) {
        return presentChatMemberFailure('member_moderation', {
          restricted: false,
          reason: privateChatRefusal,
        });
      }
      const result = context.session.sharedChatAdministration.restrictChatMember({
        actorBotId: context.bot.id,
        chatId,
        memberId: userId,
        permissions,
        requestedRestrictionEndUnixSeconds: untilUnixSeconds,
      });
      return result.restricted
        ? botApiResult(true)
        : presentChatMemberFailure('member_moderation', {
          restricted: false,
          reason: excludeMissingBotFailure(context.bot, result.reason),
        });
    },
  }),
  // As the official server reads it, a missing `custom_title` is empty, which removes the title.
  commandMethodOfSteps({
    name: 'setChatAdministratorCustomTitle',
    recordsActivity: true,
    parameters: setChatAdministratorCustomTitleParametersSchema,
    steps: ({ parameters }) =>
      startSteps(parameters).andThen((titleChange) => {
        const targetReading = readChatMemberTargetStep(titleChange);
        return targetReading.proceeds
          ? proceedWith({ ...targetReading.value, customTitle: titleChange.custom_title ?? '' })
          : targetReading;
      }),
    // As the official server's `process_set_chat_administrator_custom_title_query` refuses, a
    // private chat has none.
    execute: (context: ChatMemberContext, { chatId, userId, customTitle }) => {
      const privateChatRefusal = findPrivateChatRefusal(
        context,
        chatId,
        'method_unavailable_outside_groups',
      );
      if (privateChatRefusal !== undefined) {
        return presentChatMemberFailure('custom_title_change', {
          set: false,
          reason: privateChatRefusal,
        });
      }
      const result = context.session.sharedChatAdministration.setCustomTitleAsBot({
        actorBotId: context.bot.id,
        chatId,
        memberId: userId,
        customTitle,
      });
      return result.set ? botApiResult(true) : presentChatMemberFailure('custom_title_change', {
        set: false,
        reason: excludeMissingBotFailure(context.bot, result.reason),
      });
    },
  }),
  commandMethodOfSteps({
    name: 'unbanChatMember',
    recordsActivity: true,
    parameters: unbanChatMemberParametersSchema,
    steps: ({ parameters }) =>
      startSteps(parameters).andThen((unban) => {
        const targetReading = readChatMemberTargetStep(unban);
        return targetReading.proceeds
          ? proceedWith({ ...targetReading.value, onlyIfBanned: unban.only_if_banned })
          : targetReading;
      }),
    // Unless only a ban is to be lifted, this removes a member, as on Telegram; a private chat has
    // no members to unban.
    execute: (context: ChatMemberContext, { chatId, userId, onlyIfBanned }) => {
      const privateChatRefusal = findPrivateChatRefusal(
        context,
        chatId,
        'method_unavailable_in_private_chats',
      );
      if (privateChatRefusal !== undefined) {
        return presentChatMemberFailure('member_moderation', {
          unbanned: false,
          reason: privateChatRefusal,
        });
      }
      const result = context.session.sharedChatAdministration.unbanChatMember({
        actorBotId: context.bot.id,
        chatId,
        memberId: userId,
        onlyIfBanned,
      });
      return result.unbanned ? botApiResult(true) : presentChatMemberFailure('member_moderation', {
        unbanned: false,
        reason: excludeMissingBotFailure(context.bot, result.reason),
      });
    },
  }),
];

/** The members of a private chat: the bot and the account it talks to. */
const PRIVATE_CHAT_MEMBER_COUNT = 2;

/**
 * Makes the bot leave a supergroup, which the bot's own `my_chat_member` update and a service
 * message record. As on Telegram, a private chat cannot be left, and a supergroup the bot already
 * left or was removed from turns it away.
 */
function leaveChat(context: ChatMemberContext, chatId: number) {
  const privateChatRefusal = findPrivateChatRefusal(context, chatId, 'private_chat_not_leavable');
  if (privateChatRefusal !== undefined) {
    return presentChatMemberFailure('chat_leave', { left: false, reason: privateChatRefusal });
  }
  const result = context.session.sharedChatAdministration.leaveChat({
    memberId: context.bot.id,
    chatId,
  });
  if (result.left) {
    return botApiResult(true);
  }
  switch (result.reason) {
    case 'chat_not_found':
      return presentChatMemberFailure('chat_leave', { left: false, reason: 'chat_not_found' });
    case 'not_a_member':
      return presentChatMemberFailure('chat_leave', {
        left: false,
        reason: getSupergroupNonMemberFailureReason(result.formerStatus),
      });
    case 'member_not_found':
      throw missingAuthenticatedBotError(context.bot);
    case 'owner_cannot_leave':
      throw new Error(`Bot ${context.bot.id} owns chat ${chatId}`);
    default: {
      const unhandledReason: never = result.reason;
      throw new Error(`Unhandled leaveChat failure: ${unhandledReason}`);
    }
  }
}

/**
 * Shows a user of the session, which the caller found, in its standing in a chat, as the
 * authenticated bot observes it.
 */
function viewChatMember(
  context: ChatMemberContext,
  { chatId, userId, status }: {
    readonly chatId: number;
    readonly userId: number;
    readonly status: ChatMemberStatus;
  },
): BotApiChatMember {
  const member = context.session.botMessageViews.viewChatMember({
    chatId,
    userId,
    status,
    observerBotId: context.bot.id,
  });
  if (member === undefined) {
    throw new Error(`Chat member ${userId} does not exist`);
  }
  return member;
}

/**
 * The step that refuses a promotion to an anonymous administrator, which the emulator does not
 * support: granting the right alone would misrepresent such an administrator.
 */
function refuseAnonymousAdministrator(
  promotion: PromoteChatMemberParameters,
): BotApiStepResult<PromoteChatMemberParameters> {
  return promotion.is_anonymous === true
    ? answerWith(presentFixedBotApiError(BOT_API_ERRORS.anonymousAdministratorsUnsupported))
    : proceedWith(promotion);
}

/**
 * The supergroup rights a `promoteChatMember` request grants: those it passes as true, with
 * `can_manage_voice_chats` naming `can_manage_video_chats`, and with `can_manage_chat` once any is
 * granted, as TDLib's `AdministratorRights` makes them for a supergroup.
 */
function readPromotedSupergroupRights(
  requestedRights: PromoteChatMemberParameters,
): SupergroupAdministratorRights {
  return grantSupergroupAdministratorRights(
    SUPERGROUP_ADMINISTRATOR_RIGHTS.filter((right) =>
      requestedRights[right] === true ||
      (right === 'can_manage_video_chats' && requestedRights.can_manage_voice_chats === true)
    ),
  );
}
