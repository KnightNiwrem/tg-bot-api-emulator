import { z } from 'zod';

import {
  grantSupergroupAdministratorRights,
  SUPERGROUP_ADMINISTRATOR_RIGHTS,
  type SupergroupAdministratorRights,
} from '../../../../types/chat_membership.ts';
import { requireSpecifiedChatId } from '../chat_access.ts';
import { readChatMemberTargetStep, requireValidUserId } from '../chat_member_requests.ts';
import { readChatPermissionsParameter } from '../chat_permissions_parameter.ts';
import { presentChatMemberFailure } from '../errors/chat_member_failure_presenter.ts';
import { type BotApiMethod, botApiResult } from '../method_call.ts';
import {
  answerWithBadRequest,
  type BotApiStepResult,
  commandMethodOfSteps,
  handledMethodOfSteps,
  proceedWith,
  startSteps,
} from '../method_steps.ts';
import { booleanParameter, integerParameter } from '../request_parameters.ts';

/** The emulator's description for a promotion to an anonymous administrator, which it lacks. */
const ANONYMOUS_ADMINISTRATORS_UNSUPPORTED_DESCRIPTION =
  'Bad Request: anonymous administrators are not supported';

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
    execute: (context, request) => {
      const result = context.session.botApi.banChatMember(context.bot, request);
      return result.banned
        ? botApiResult(true)
        : presentChatMemberFailure('member_moderation', result);
    },
  }),
  handledMethodOfSteps({
    name: 'getChatAdministrators',
    recordsActivity: true,
    parameters: getChatAdministratorsParametersSchema,
    steps: ({ parameters }) => startSteps(parameters).andThen(requireSpecifiedChatId),
    execute: (context, { chat_id: chatId, return_bots: includesOtherBots }) => {
      const result = context.session.botApi.getChatAdministrators(context.bot, {
        chatId,
        includesOtherBots,
      });
      return result.found
        ? botApiResult(result.administrators)
        : presentChatMemberFailure('member_lookup', result);
    },
  }),
  handledMethodOfSteps({
    name: 'getChatMember',
    recordsActivity: true,
    parameters: getChatMemberParametersSchema,
    steps: ({ parameters }) => startSteps(parameters).andThen(readChatMemberTargetStep),
    execute: (context, target) => {
      const result = context.session.botApi.getChatMember(context.bot, target);
      return result.found
        ? botApiResult(result.member)
        : presentChatMemberFailure('member_lookup', result);
    },
  }),
  handledMethodOfSteps({
    name: 'getChatMemberCount',
    recordsActivity: true,
    parameters: getChatMemberCountParametersSchema,
    steps: ({ parameters }) => startSteps(parameters).andThen(requireSpecifiedChatId),
    execute: (context, { chat_id: chatId }) => {
      const result = context.session.botApi.getChatMemberCount(context.bot, { chatId });
      return result.found
        ? botApiResult(result.memberCount)
        : presentChatMemberFailure('member_lookup', result);
    },
  }),
  commandMethodOfSteps({
    name: 'leaveChat',
    recordsActivity: true,
    parameters: leaveChatParametersSchema,
    steps: ({ parameters }) => startSteps(parameters).andThen(requireSpecifiedChatId),
    execute: (context, { chat_id: chatId }) => {
      const result = context.session.botApi.leaveChat(context.bot, { chatId });
      return result.left ? botApiResult(true) : presentChatMemberFailure('chat_leave', result);
    },
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
    execute: (context, request) => {
      const result = context.session.botApi.promoteChatMember(context.bot, request);
      return result.promoted
        ? botApiResult(true)
        : presentChatMemberFailure('member_promotion', result);
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
    execute: (context, request) => {
      const result = context.session.botApi.restrictChatMember(context.bot, request);
      return result.restricted
        ? botApiResult(true)
        : presentChatMemberFailure('member_moderation', result);
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
    execute: (context, request) => {
      const result = context.session.botApi.setChatAdministratorCustomTitle(context.bot, request);
      return result.set
        ? botApiResult(true)
        : presentChatMemberFailure('custom_title_change', result);
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
    execute: (context, request) => {
      const result = context.session.botApi.unbanChatMember(context.bot, request);
      return result.unbanned
        ? botApiResult(true)
        : presentChatMemberFailure('member_moderation', result);
    },
  }),
];

/**
 * The step that refuses a promotion to an anonymous administrator, which the emulator does not
 * support: granting the right alone would misrepresent such an administrator.
 */
function refuseAnonymousAdministrator(
  promotion: PromoteChatMemberParameters,
): BotApiStepResult<PromoteChatMemberParameters> {
  return promotion.is_anonymous === true
    ? answerWithBadRequest(ANONYMOUS_ADMINISTRATORS_UNSUPPORTED_DESCRIPTION)
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
