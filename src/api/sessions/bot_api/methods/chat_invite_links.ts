import { z } from 'zod';

import type { EmulationSession } from '../../../../types/emulation_session.ts';
import { CHAT_ID_EMPTY_DESCRIPTION, supergroupBotAccessFailureAnswer } from '../chat_access.ts';
import {
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

/** The methods that manage a chat's invite links: the bot's primary link and additional links. */
export const CHAT_INVITE_LINK_METHODS: readonly BotApiMethod[] = [
  { name: 'exportChatInviteLink', handler: handleExportChatInviteLink },
  { name: 'createChatInviteLink', handler: handleCreateChatInviteLink },
  { name: 'editChatInviteLink', handler: handleEditChatInviteLink },
  { name: 'revokeChatInviteLink', handler: handleRevokeChatInviteLink },
];

const PRIVATE_CHAT_HAS_NO_INVITE_LINKS_DESCRIPTION =
  "Bad Request: can't invite members to a private chat";
const MEMBER_LIMIT_WITH_JOIN_REQUEST_DESCRIPTION =
  "Bad Request: member limit can't be specified for links requiring administrator approval";
const NOT_ENOUGH_RIGHTS_TO_MANAGE_INVITE_LINKS_DESCRIPTION =
  'Bad Request: not enough rights to manage chat invite link';

/** Telegram's servers' errors for invite links, which the official server passes on. */
const INVITE_LINK_EXPIRY_DATE_INVALID_DESCRIPTION = 'Bad Request: EXPIRE_DATE_INVALID';
const INVITE_LINK_MEMBER_LIMIT_INVALID_DESCRIPTION = 'Bad Request: USAGE_LIMIT_INVALID';
const INVITE_LINK_EMPTY_DESCRIPTION = 'Bad Request: invite link must be non-empty';
/**
 * The errors `messages.editExportedChatInvite` documents for a link the bot cannot edit or revoke:
 * one that no longer works, which the emulator also answers for a link unknown to the chat, and
 * one that only the chat's owner could manage, as another administrator created it.
 */
const INVITE_LINK_UNAVAILABLE_DESCRIPTION = 'Bad Request: INVITE_HASH_EXPIRED';
const INVITE_LINK_OF_ANOTHER_ADMINISTRATOR_DESCRIPTION = 'Bad Request: CHAT_ADMIN_REQUIRED';
/**
 * The error Telegram's servers answer for a change to a permanent link, a primary link, which
 * TDLib's `edit_dialog_invite_link` passes on unchecked. The emulator answers it for every edit of
 * a primary link, which the Bot API documents `editChatInviteLink` not to edit.
 */
const PRIMARY_INVITE_LINK_NOT_EDITABLE_DESCRIPTION = 'Bad Request: CHAT_INVITE_PERMANENT';

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
  return result.exported
    ? botApiResult(result.inviteLink)
    : inviteLinkMethodFailureAnswer('exportChatInviteLink', result.reason);
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
  return result.created
    ? botApiResult(result.inviteLink)
    : inviteLinkMethodFailureAnswer('createChatInviteLink', result.reason);
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
  return result.edited
    ? botApiResult(result.inviteLink)
    : inviteLinkMethodFailureAnswer('editChatInviteLink', result.reason);
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
  return result.revoked
    ? botApiResult(result.inviteLink)
    : inviteLinkMethodFailureAnswer('revokeChatInviteLink', result.reason);
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

/** Why a bot cannot export, create, edit or revoke an invite link. */
type InviteLinkMethodFailureReason =
  | Extract<
    ReturnType<EmulationSession['botApi']['exportChatInviteLink']>,
    { readonly exported: false }
  >['reason']
  | Extract<
    ReturnType<EmulationSession['botApi']['createChatInviteLink']>,
    { readonly created: false }
  >['reason']
  | Extract<
    ReturnType<EmulationSession['botApi']['editChatInviteLink']>,
    { readonly edited: false }
  >['reason']
  | Extract<
    ReturnType<EmulationSession['botApi']['revokeChatInviteLink']>,
    { readonly revoked: false }
  >['reason'];

/** Answers a refused invite link method with the error the official server answers for it. */
function inviteLinkMethodFailureAnswer(
  methodName:
    | 'exportChatInviteLink'
    | 'createChatInviteLink'
    | 'editChatInviteLink'
    | 'revokeChatInviteLink',
  reason: InviteLinkMethodFailureReason,
): BotApiMethodAnswer {
  switch (reason) {
    case 'chat_not_found':
    case 'bot_not_a_member':
    case 'bot_kicked':
      return supergroupBotAccessFailureAnswer(reason);
    case 'private_chat_has_no_invite_links':
      return botApiError(400, PRIVATE_CHAT_HAS_NO_INVITE_LINKS_DESCRIPTION);
    case 'text_encoding_invalid':
      return botApiError(400, STRINGS_NOT_UTF8_DESCRIPTION);
    case 'member_limit_with_join_request':
      return botApiError(400, MEMBER_LIMIT_WITH_JOIN_REQUEST_DESCRIPTION);
    case 'not_enough_rights':
      return botApiError(400, NOT_ENOUGH_RIGHTS_TO_MANAGE_INVITE_LINKS_DESCRIPTION);
    case 'invite_link_empty':
      return botApiError(400, INVITE_LINK_EMPTY_DESCRIPTION);
    case 'invite_link_not_found':
    case 'invite_link_revoked':
      return botApiError(400, INVITE_LINK_UNAVAILABLE_DESCRIPTION);
    case 'not_the_link_creator':
      return botApiError(400, INVITE_LINK_OF_ANOTHER_ADMINISTRATOR_DESCRIPTION);
    case 'primary_invite_link_not_editable':
      return botApiError(400, PRIMARY_INVITE_LINK_NOT_EDITABLE_DESCRIPTION);
    case 'expiry_date_invalid':
      return botApiError(400, INVITE_LINK_EXPIRY_DATE_INVALID_DESCRIPTION);
    case 'member_limit_invalid':
      return botApiError(400, INVITE_LINK_MEMBER_LIMIT_INVALID_DESCRIPTION);
    default: {
      const unhandledReason: never = reason;
      throw new Error(`Unhandled ${methodName} failure: ${unhandledReason}`);
    }
  }
}
