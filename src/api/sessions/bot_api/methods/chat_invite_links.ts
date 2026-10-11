import { z } from 'zod';

import { CHAT_ID_EMPTY_DESCRIPTION } from '../chat_access.ts';
import { presentChatInviteLinkFailure } from '../errors/chat_invite_link_failure_presenter.ts';
import {
  botApiError,
  type BotApiMethod,
  type BotApiMethodAnswer,
  type BotApiMethodContext,
  botApiResult,
} from '../method_call.ts';
import {
  booleanParameter,
  type BotApiRequestParameters,
  integerParameter,
} from '../request_parameters.ts';

/** The methods that manage a chat's invite links: the bot's primary link and additional links. */
export const CHAT_INVITE_LINK_METHODS: readonly BotApiMethod[] = [
  { name: 'exportChatInviteLink', recordsActivity: true, handler: handleExportChatInviteLink },
  { name: 'createChatInviteLink', recordsActivity: true, handler: handleCreateChatInviteLink },
  { name: 'editChatInviteLink', recordsActivity: true, handler: handleEditChatInviteLink },
  { name: 'revokeChatInviteLink', recordsActivity: true, handler: handleRevokeChatInviteLink },
];

// Telegram reads a missing name as empty, and a missing or zero `expire_date` or `member_limit` as
// none; it clamps a negative one to zero, which the emulator rejects to surface the bot's mistake.
const inviteLinkSettingsParametersShape = {
  name: z.string().default(''),
  expire_date: integerParameter(z.int().nonnegative()).optional(),
  member_limit: integerParameter(z.int().nonnegative()).optional(),
  creates_join_request: booleanParameter().default(false),
};

const exportChatInviteLinkParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
});

const createChatInviteLinkParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
  ...inviteLinkSettingsParametersShape,
});

// The official server reads a missing `invite_link` as empty, which TDLib then refuses.
const editChatInviteLinkParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
  invite_link: z.string().default(''),
  ...inviteLinkSettingsParametersShape,
});

const revokeChatInviteLinkParametersSchema = z.strictObject({
  chat_id: integerParameter(z.int()).optional(),
  invite_link: z.string().default(''),
});

/**
 * Answers `exportChatInviteLink` with the bot's new primary link as a bare string, as the official
 * server's `TdOnReplacePrimaryChatInviteLinkCallback` answers it.
 */
function handleExportChatInviteLink(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = exportChatInviteLinkParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid exportChatInviteLink parameters');
  }
  const { data } = parsedParameters;
  if (data.chat_id === undefined) {
    return botApiError(400, CHAT_ID_EMPTY_DESCRIPTION);
  }

  const result = context.session.botApi.exportChatInviteLink(context.bot, {
    chatId: data.chat_id,
  });
  return result.exported ? botApiResult(result.inviteLink) : presentChatInviteLinkFailure(result);
}

/** Answers `createChatInviteLink` with the new link as its creator sees it. */
function handleCreateChatInviteLink(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = createChatInviteLinkParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid createChatInviteLink parameters');
  }
  const { data } = parsedParameters;
  if (data.chat_id === undefined) {
    return botApiError(400, CHAT_ID_EMPTY_DESCRIPTION);
  }

  const result = context.session.botApi.createChatInviteLink(context.bot, {
    chatId: data.chat_id,
    ...readInviteLinkSettingsParameters(data),
  });
  return result.created ? botApiResult(result.inviteLink) : presentChatInviteLinkFailure(result);
}

/**
 * Answers `editChatInviteLink` with the edited link as its creator sees it. As the official
 * server's `process_edit_chat_invite_link_query` passes every setting on to TDLib, which replaces
 * them all, an omitted setting becomes none.
 */
function handleEditChatInviteLink(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = editChatInviteLinkParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid editChatInviteLink parameters');
  }
  const { data } = parsedParameters;
  if (data.chat_id === undefined) {
    return botApiError(400, CHAT_ID_EMPTY_DESCRIPTION);
  }

  const result = context.session.botApi.editChatInviteLink(context.bot, {
    chatId: data.chat_id,
    inviteLink: data.invite_link,
    ...readInviteLinkSettingsParameters(data),
  });
  return result.edited ? botApiResult(result.inviteLink) : presentChatInviteLinkFailure(result);
}

/**
 * Answers `revokeChatInviteLink` with the revoked link as its creator sees it, as the official
 * server's `TdOnGetChatInviteLinkCallback` answers the first link TDLib returns, even when
 * revoking a primary link also returned its replacement.
 */
function handleRevokeChatInviteLink(
  context: BotApiMethodContext,
  parameters: BotApiRequestParameters,
): BotApiMethodAnswer {
  const parsedParameters = revokeChatInviteLinkParametersSchema.safeParse(parameters);
  if (!parsedParameters.success) {
    return botApiError(400, 'Bad Request: invalid revokeChatInviteLink parameters');
  }
  const { data } = parsedParameters;
  if (data.chat_id === undefined) {
    return botApiError(400, CHAT_ID_EMPTY_DESCRIPTION);
  }

  const result = context.session.botApi.revokeChatInviteLink(context.bot, {
    chatId: data.chat_id,
    inviteLink: data.invite_link,
  });
  return result.revoked ? botApiResult(result.inviteLink) : presentChatInviteLinkFailure(result);
}

/**
 * Reads the settings `createChatInviteLink` and `editChatInviteLink` give a link. As the official
 * server's `process_create_chat_invite_link_query` and `process_edit_chat_invite_link_query` read
 * them, a zero `expire_date` or `member_limit` means none.
 */
function readInviteLinkSettingsParameters(
  parameters: z.infer<z.ZodObject<typeof inviteLinkSettingsParametersShape>>,
) {
  const { name, expire_date, member_limit, creates_join_request } = parameters;
  return {
    name,
    ...(expire_date === undefined || expire_date === 0
      ? {}
      : { expiresAtUnixSeconds: expire_date }),
    ...(member_limit === undefined || member_limit === 0 ? {} : { memberLimit: member_limit }),
    createsJoinRequest: creates_join_request,
  };
}
