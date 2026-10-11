import { z } from 'zod';

import { excludeMissingBotFailure } from '../authenticated_bot_failures.ts';
import { findPrivateChatRefusal, requireSpecifiedChatId } from '../chat_access.ts';
import { presentChatInviteLinkFailure } from '../errors/chat_invite_link_failure_presenter.ts';
import { type BotApiFamilyContext, type BotApiMethod, botApiResult } from '../method_call.ts';
import { commandMethodOfSteps, startSteps } from '../method_steps.ts';
import { booleanParameter, integerParameter } from '../request_parameters.ts';

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
 * What the invite link methods use: the service that admits accounts to chats, the view of a link
 * as its creator sees it, and the private chats the bot knows, which have no invite links.
 */
type ChatInviteLinkContext = BotApiFamilyContext<
  'chatAdmission' | 'botMessageViews' | 'privateMessaging'
>;

/**
 * As TDLib's `can_manage_dialog_invite_links` refuses, a private chat has no invite links.
 */
const PRIVATE_CHAT_INVITE_LINK_REFUSAL = 'private_chat_has_no_invite_links';

/**
 * The methods that manage a chat's invite links, the bot's primary link and additional links, each
 * executed as a command in its call's transaction. Each first requires the chat its `chat_id`
 * names, as the official server's `check_chat` does; the command then checks the chat, the bot's
 * rights and the link.
 */
export const CHAT_INVITE_LINK_METHODS: readonly BotApiMethod[] = [
  // Answers with the bot's new primary link as a bare string, as the official server's
  // `TdOnReplacePrimaryChatInviteLinkCallback` answers it.
  commandMethodOfSteps({
    name: 'exportChatInviteLink',
    recordsActivity: true,
    parameters: exportChatInviteLinkParametersSchema,
    steps: ({ parameters }) => startSteps(parameters).andThen(requireSpecifiedChatId),
    execute: (context: ChatInviteLinkContext, { chat_id: chatId }) => {
      const privateChatRefusal = findPrivateChatRefusal(
        context,
        chatId,
        PRIVATE_CHAT_INVITE_LINK_REFUSAL,
      );
      if (privateChatRefusal !== undefined) {
        return presentChatInviteLinkFailure({ exported: false, reason: privateChatRefusal });
      }
      const result = context.session.chatAdmission.exportPrimaryInviteLinkAsBot({
        exporterBotId: context.bot.id,
        chatId,
      });
      return result.exported ? botApiResult(result.link.url) : presentChatInviteLinkFailure({
        exported: false,
        reason: excludeMissingBotFailure(context.bot, result.reason),
      });
    },
  }),
  // Answers with the new link as its creator sees it.
  commandMethodOfSteps({
    name: 'createChatInviteLink',
    recordsActivity: true,
    parameters: createChatInviteLinkParametersSchema,
    steps: ({ parameters }) => startSteps(parameters).andThen(requireSpecifiedChatId),
    execute: (context: ChatInviteLinkContext, { chat_id: chatId, ...settings }) => {
      const privateChatRefusal = findPrivateChatRefusal(
        context,
        chatId,
        PRIVATE_CHAT_INVITE_LINK_REFUSAL,
      );
      if (privateChatRefusal !== undefined) {
        return presentChatInviteLinkFailure({ created: false, reason: privateChatRefusal });
      }
      const result = context.session.chatAdmission.createInviteLinkAsBot({
        creatorBotId: context.bot.id,
        chatId,
        ...readInviteLinkSettingsParameters(settings),
      });
      return result.created
        ? botApiResult(viewInviteLinkForCreator(context, result.link))
        : presentChatInviteLinkFailure({
          created: false,
          reason: excludeMissingBotFailure(context.bot, result.reason),
        });
    },
  }),
  // Answers with the edited link as its creator sees it. As the official server's
  // `process_edit_chat_invite_link_query` passes every setting on to TDLib, which replaces them
  // all, an omitted setting becomes none.
  commandMethodOfSteps({
    name: 'editChatInviteLink',
    recordsActivity: true,
    parameters: editChatInviteLinkParametersSchema,
    steps: ({ parameters }) => startSteps(parameters).andThen(requireSpecifiedChatId),
    execute: (
      context: ChatInviteLinkContext,
      { chat_id: chatId, invite_link: inviteLink, ...settings },
    ) => {
      const privateChatRefusal = findPrivateChatRefusal(
        context,
        chatId,
        PRIVATE_CHAT_INVITE_LINK_REFUSAL,
      );
      if (privateChatRefusal !== undefined) {
        return presentChatInviteLinkFailure({ edited: false, reason: privateChatRefusal });
      }
      const result = context.session.chatAdmission.editInviteLinkAsBot({
        editorBotId: context.bot.id,
        chatId,
        inviteLinkUrl: inviteLink,
        ...readInviteLinkSettingsParameters(settings),
      });
      return result.edited
        ? botApiResult(viewInviteLinkForCreator(context, result.link))
        : presentChatInviteLinkFailure({
          edited: false,
          reason: excludeMissingBotFailure(context.bot, result.reason),
        });
    },
  }),
  // Answers with the revoked link as its creator sees it, as the official server's
  // `TdOnGetChatInviteLinkCallback` answers the first link TDLib returns, even when revoking a
  // primary link also returned its replacement.
  commandMethodOfSteps({
    name: 'revokeChatInviteLink',
    recordsActivity: true,
    parameters: revokeChatInviteLinkParametersSchema,
    steps: ({ parameters }) => startSteps(parameters).andThen(requireSpecifiedChatId),
    execute: (context: ChatInviteLinkContext, { chat_id: chatId, invite_link: inviteLink }) => {
      const privateChatRefusal = findPrivateChatRefusal(
        context,
        chatId,
        PRIVATE_CHAT_INVITE_LINK_REFUSAL,
      );
      if (privateChatRefusal !== undefined) {
        return presentChatInviteLinkFailure({ revoked: false, reason: privateChatRefusal });
      }
      const result = context.session.chatAdmission.revokeInviteLinkAsBot({
        revokerBotId: context.bot.id,
        chatId,
        inviteLinkUrl: inviteLink,
      });
      return result.revoked
        ? botApiResult(viewInviteLinkForCreator(context, result.link))
        : presentChatInviteLinkFailure({
          revoked: false,
          reason: excludeMissingBotFailure(context.bot, result.reason),
        });
    },
  }),
];

/** Shows an invite link that the bot created, edited or revoked, as its creator sees it. */
function viewInviteLinkForCreator(
  context: ChatInviteLinkContext,
  link: Parameters<ChatInviteLinkContext['session']['botMessageViews']['viewChatInviteLink']>[0],
) {
  return context.session.botMessageViews.viewChatInviteLink(link, context.bot.id);
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
