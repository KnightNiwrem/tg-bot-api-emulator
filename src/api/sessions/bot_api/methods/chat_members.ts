import { z } from 'zod';

import {
  grantSupergroupAdministratorRights,
  SUPERGROUP_ADMINISTRATOR_RIGHTS,
  type SupergroupAdministratorRights,
} from '../../../../types/chat_membership.ts';
import { CHAT_ID_EMPTY_DESCRIPTION, supergroupBotAccessFailureAnswer } from '../chat_access.ts';
import {
  chatMemberFailureAnswer,
  readChatMemberTarget,
  USER_ID_INVALID_DESCRIPTION,
} from '../chat_member_requests.ts';
import { readChatPermissionsParameter } from '../chat_permissions_parameter.ts';
import {
  badRequestDescription,
  botApiError,
  type BotApiMethod,
  type BotApiMethodAnswer,
  type BotApiMethodContext,
  botApiResult,
  STRINGS_NOT_UTF8_DESCRIPTION,
} from '../method_call.ts';
import {
  booleanParameter,
  type BotApiRequestParameters,
  integerParameter,
} from '../request_parameters.ts';

/** The methods that read a chat's members, moderate or promote them, or make the bot leave. */
export const CHAT_MEMBER_METHODS: readonly BotApiMethod[] = [
  { name: 'banChatMember', handler: handleBanChatMember },
  { name: 'getChatAdministrators', handler: handleGetChatAdministrators },
  { name: 'getChatMember', handler: handleGetChatMember },
  { name: 'getChatMemberCount', handler: handleGetChatMemberCount },
  { name: 'leaveChat', handler: handleLeaveChat },
  { name: 'promoteChatMember', handler: handlePromoteChatMember },
  { name: 'restrictChatMember', handler: handleRestrictChatMember },
  { name: 'setChatAdministratorCustomTitle', handler: handleSetChatAdministratorCustomTitle },
  { name: 'unbanChatMember', handler: handleUnbanChatMember },
];

/** Telegram's descriptions for rejected requests about chat members. */
const METHOD_UNAVAILABLE_OUTSIDE_GROUPS_DESCRIPTION =
  'Bad Request: method is available only in groups and supergroups';
const OWNER_CUSTOM_TITLE_DESCRIPTION = 'Bad Request: only the owner can edit their custom title';
const MEMBER_IS_NOT_ADMINISTRATOR_DESCRIPTION = 'Bad Request: user is not an administrator';
const CUSTOM_TITLE_NOT_EDITABLE_DESCRIPTION =
  'Bad Request: not enough rights to change custom title of the user';
/**
 * Telegram's servers refuse titles as `RANK_INVALID` and `RANK_EMOJI_NOT_ALLOWED`, which the
 * official server reports under these names.
 */
const CUSTOM_TITLE_INVALID_DESCRIPTION = 'Bad Request: CUSTOM_TITLE_INVALID';
const CUSTOM_TITLE_EMOJI_NOT_ALLOWED_DESCRIPTION = 'Bad Request: CUSTOM_TITLE_EMOJI_NOT_ALLOWED';

/** Telegram's description for a bot that tries to promote itself. */
const CANNOT_PROMOTE_SELF_DESCRIPTION = "Bad Request: can't promote self";
/** Telegram's servers' errors for promotions, which the official server passes on. */
const MEMBER_NOT_IN_CHAT_DESCRIPTION = 'Bad Request: USER_NOT_MUTUAL_CONTACT';
const MEMBER_KICKED_DESCRIPTION = 'Bad Request: USER_KICKED';
const RIGHTS_NOT_HELD_DESCRIPTION = 'Bad Request: RIGHT_FORBIDDEN';
const BOTS_CANNOT_ADD_MEMBERS_DESCRIPTION = "Bad Request: bots can't add new chat members";
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

function handleLeaveChat(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = leaveChatParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid leaveChat parameters');
  }
  const { chat_id: chatId } = parsedParameters.data;
  if (chatId === undefined) {
    return botApiError(400, CHAT_ID_EMPTY_DESCRIPTION);
  }

  const result = context.session.botApi.leaveChat(
    context.bot,
    { chatId },
  );
  if (result.left) {
    return botApiResult(true);
  }
  switch (result.reason) {
    case 'chat_not_found':
    case 'bot_not_a_member':
    case 'bot_kicked':
      return supergroupBotAccessFailureAnswer(result.reason);
    case 'private_chat_not_leavable':
      return botApiError(400, badRequestDescription("Can't leave private chats"));
    default: {
      const unhandledReason: never = result.reason;
      throw new Error(`Unhandled leaveChat failure: ${unhandledReason}`);
    }
  }
}

function handleGetChatMember(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = getChatMemberParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid getChatMember parameters');
  }
  const targetReading = readChatMemberTarget(parsedParameters.data);
  if (!targetReading.read) {
    return targetReading.errorAnswer;
  }

  const result = context.session.botApi.getChatMember(
    context.bot,
    targetReading.target,
  );
  return result.found ? botApiResult(result.member) : chatMemberFailureAnswer(result.reason);
}

function handleGetChatAdministrators(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = getChatAdministratorsParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid getChatAdministrators parameters');
  }
  const { chat_id: chatId, return_bots: includesOtherBots } = parsedParameters.data;
  if (chatId === undefined) {
    return botApiError(400, CHAT_ID_EMPTY_DESCRIPTION);
  }

  const result = context.session.botApi.getChatAdministrators(
    context.bot,
    { chatId, includesOtherBots },
  );
  return result.found
    ? botApiResult(result.administrators)
    : chatMemberFailureAnswer(result.reason);
}

function handleGetChatMemberCount(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = getChatMemberCountParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid getChatMemberCount parameters');
  }
  const { chat_id: chatId } = parsedParameters.data;
  if (chatId === undefined) {
    return botApiError(400, CHAT_ID_EMPTY_DESCRIPTION);
  }

  const result = context.session.botApi.getChatMemberCount(
    context.bot,
    { chatId },
  );
  return result.found ? botApiResult(result.memberCount) : chatMemberFailureAnswer(result.reason);
}

function handleBanChatMember(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = banChatMemberParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid banChatMember parameters');
  }
  const targetReading = readChatMemberTarget(parsedParameters.data);
  if (!targetReading.read) {
    return targetReading.errorAnswer;
  }

  const result = context.session.botApi.banChatMember(
    context.bot,
    { ...targetReading.target, untilUnixSeconds: parsedParameters.data.until_date },
  );
  return result.banned ? botApiResult(true) : chatMemberFailureAnswer(result.reason);
}

function handleRestrictChatMember(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const invalidParametersDescription = 'Bad Request: invalid restrictChatMember parameters';
  const parsedParameters = restrictChatMemberParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, invalidParametersDescription);
  }
  const { data } = parsedParameters;
  // Telegram reads the user, then the permissions, before it looks at the chat.
  if (data.user_id === undefined || data.user_id <= 0) {
    return botApiError(400, USER_ID_INVALID_DESCRIPTION);
  }
  const permissionsReading = readChatPermissionsParameter(data.permissions, {
    usesIndependentChatPermissions: data.use_independent_chat_permissions,
    invalidParametersDescription,
  });
  if (!permissionsReading.read) {
    return botApiError(400, permissionsReading.description);
  }
  const targetReading = readChatMemberTarget(data);
  if (!targetReading.read) {
    return targetReading.errorAnswer;
  }

  const result = context.session.botApi.restrictChatMember(context.bot, {
    ...targetReading.target,
    permissions: permissionsReading.permissions,
    untilUnixSeconds: data.until_date,
  });
  return result.restricted ? botApiResult(true) : chatMemberFailureAnswer(result.reason);
}

/**
 * Answers `promoteChatMember`. As the official server's `process_promote_chat_member_query` reads
 * them, each right is a separate parameter, a missing one is false, and passing none demotes an
 * administrator.
 */
function handlePromoteChatMember(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = promoteChatMemberParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid promoteChatMember parameters');
  }
  const { data } = parsedParameters;
  const targetReading = readChatMemberTarget(data);
  if (!targetReading.read) {
    return targetReading.errorAnswer;
  }
  // Anonymous administrators are not supported; granting the right alone would misrepresent them.
  if (data.is_anonymous === true) {
    return botApiError(400, ANONYMOUS_ADMINISTRATORS_UNSUPPORTED_DESCRIPTION);
  }

  const result = context.session.botApi.promoteChatMember(context.bot, {
    ...targetReading.target,
    rights: readPromotedSupergroupRights(data),
  });
  if (result.promoted) {
    return botApiResult(true);
  }
  switch (result.reason) {
    case 'cannot_promote_self':
      return botApiError(400, CANNOT_PROMOTE_SELF_DESCRIPTION);
    case 'member_not_in_chat':
      return botApiError(400, MEMBER_NOT_IN_CHAT_DESCRIPTION);
    case 'member_kicked':
      return botApiError(400, MEMBER_KICKED_DESCRIPTION);
    case 'rights_not_held':
      return botApiError(400, RIGHTS_NOT_HELD_DESCRIPTION);
    case 'bots_cannot_add_members':
      return botApiError(400, BOTS_CANNOT_ADD_MEMBERS_DESCRIPTION);
    default:
      return chatMemberFailureAnswer(result.reason);
  }
}

/**
 * The supergroup rights a `promoteChatMember` request grants: those it passes as true, with
 * `can_manage_voice_chats` naming `can_manage_video_chats`, and with `can_manage_chat` once any is
 * granted, as TDLib's `AdministratorRights` makes them for a supergroup.
 */
function readPromotedSupergroupRights(
  requestedRights: z.infer<typeof promoteChatMemberParametersSchema>,
): SupergroupAdministratorRights {
  return grantSupergroupAdministratorRights(
    SUPERGROUP_ADMINISTRATOR_RIGHTS.filter((right) =>
      requestedRights[right] === true ||
      (right === 'can_manage_video_chats' && requestedRights.can_manage_voice_chats === true)
    ),
  );
}

function handleUnbanChatMember(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = unbanChatMemberParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid unbanChatMember parameters');
  }
  const targetReading = readChatMemberTarget(parsedParameters.data);
  if (!targetReading.read) {
    return targetReading.errorAnswer;
  }

  const result = context.session.botApi.unbanChatMember(
    context.bot,
    { ...targetReading.target, onlyIfBanned: parsedParameters.data.only_if_banned },
  );
  return result.unbanned ? botApiResult(true) : chatMemberFailureAnswer(result.reason);
}

/**
 * Answers `setChatAdministratorCustomTitle`. As the official server reads it, a missing
 * `custom_title` is empty, which removes the title.
 */
function handleSetChatAdministratorCustomTitle(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = setChatAdministratorCustomTitleParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid setChatAdministratorCustomTitle parameters');
  }
  const targetReading = readChatMemberTarget(parsedParameters.data);
  if (!targetReading.read) {
    return targetReading.errorAnswer;
  }

  const result = context.session.botApi.setChatAdministratorCustomTitle(context.bot, {
    ...targetReading.target,
    customTitle: parsedParameters.data.custom_title ?? '',
  });
  if (result.set) {
    return botApiResult(true);
  }
  switch (result.reason) {
    case 'method_unavailable_outside_groups':
      return botApiError(400, METHOD_UNAVAILABLE_OUTSIDE_GROUPS_DESCRIPTION);
    case 'member_is_owner':
      return botApiError(400, OWNER_CUSTOM_TITLE_DESCRIPTION);
    case 'member_is_not_administrator':
      return botApiError(400, MEMBER_IS_NOT_ADMINISTRATOR_DESCRIPTION);
    case 'custom_title_not_editable':
      return botApiError(400, CUSTOM_TITLE_NOT_EDITABLE_DESCRIPTION);
    case 'text_encoding_invalid':
      return botApiError(400, STRINGS_NOT_UTF8_DESCRIPTION);
    case 'custom_title_too_long':
      return botApiError(400, CUSTOM_TITLE_INVALID_DESCRIPTION);
    case 'custom_title_contains_emoji':
      return botApiError(400, CUSTOM_TITLE_EMOJI_NOT_ALLOWED_DESCRIPTION);
    default:
      return chatMemberFailureAnswer(result.reason);
  }
}
