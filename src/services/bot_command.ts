import { cleanInputString, trimTdlibSpaces } from '../text_entities/input_string.ts';
import {
  type BotCommand,
  type BotCommandScope,
  MAX_BOT_COMMAND_COUNT,
  MAX_BOT_COMMAND_DESCRIPTION_LENGTH,
  MAX_BOT_COMMAND_LENGTH,
} from '../types/bot_command.ts';
import { type BotLanguageCode, isBotLanguageCode } from '../types/bot_language_code.ts';
import {
  isChatAdministrator,
  resolveSupergroupBotMembership,
  type SupergroupBotAccessFailureReason,
  type SupergroupMembershipLookup,
} from '../types/chat_membership.ts';
import { isUserId } from '../types/telegram_identity.ts';
import type { VirtualAccount } from '../types/virtual_account.ts';
import type { VirtualBot } from '../types/virtual_bot.ts';
import type { PrivateConversation, PrivateConversationKey } from '../types/virtual_chat.ts';

/** A command as a bot specified it, before Telegram cleans and checks it. */
export interface SpecifiedBotCommand {
  readonly command: string;
  readonly description: string;
  readonly isEphemeral: boolean;
}

/** Addresses one command list of the bot: a scope and a language. */
export interface BotCommandListTarget {
  readonly botId: number;
  readonly scope: BotCommandScope;
  readonly languageCode: BotLanguageCode;
}

export interface SetBotCommandsInput extends BotCommandListTarget {
  readonly commands: readonly SpecifiedBotCommand[];
}

/** Why a scope or language cannot address a command list, in the order Telegram checks them. */
export type BotCommandListTargetFailureReason =
  | 'bot_not_found'
  | SupergroupBotAccessFailureReason
  | 'scope_not_allowed_in_private_chats'
  | 'language_code_invalid';

/** Why a command is rejected, in the order Telegram checks each command. */
export type BotCommandFailureReason =
  | 'command_not_utf8'
  | 'command_description_not_utf8'
  | 'command_empty'
  | 'command_too_long'
  | 'command_description_empty'
  | 'command_description_too_long'
  | 'too_many_commands'
  | 'command_invalid';

export type SetBotCommandsResult =
  | { readonly set: true }
  | {
    readonly set: false;
    readonly reason: BotCommandListTargetFailureReason | BotCommandFailureReason;
  };

export type GetBotCommandsResult =
  | { readonly found: true; readonly commands: readonly BotCommand[] }
  | { readonly found: false; readonly reason: BotCommandListTargetFailureReason };

export type DeleteBotCommandsResult =
  | { readonly deleted: true }
  | { readonly deleted: false; readonly reason: BotCommandListTargetFailureReason };

export type GetPrivateChatCommandsResult =
  | { readonly found: true; readonly commands: readonly BotCommand[] }
  | { readonly found: false; readonly reason: 'account_not_found' | 'bot_not_found' };

/** The commands one bot of a supergroup suggests to a member. */
export interface SupergroupBotCommands {
  readonly botId: number;
  readonly commands: readonly BotCommand[];
}

export type GetSupergroupCommandsResult =
  | { readonly found: true; readonly botCommands: readonly SupergroupBotCommands[] }
  | {
    readonly found: false;
    readonly reason: 'account_not_found' | 'chat_not_found' | 'not_a_member';
  };

/** Identifies a supergroup as one of its members sees it. */
export interface SupergroupMemberKey {
  readonly accountId: number;
  readonly chatId: number;
}

interface AccountLookup {
  getById(accountId: number): VirtualAccount | undefined;
}

interface BotLookup {
  getById(botId: number): VirtualBot | undefined;
}

interface PrivateConversationLookup {
  getPrivateConversation(key: PrivateConversationKey): PrivateConversation | undefined;
}

interface SupergroupMemberLookup extends SupergroupMembershipLookup {
  getChatMemberIds(chatId: number): readonly number[];
}

interface BotCommandStore {
  setCommands(key: BotCommandListTarget, commands: readonly BotCommand[]): void;
  getCommands(key: BotCommandListTarget): readonly BotCommand[] | undefined;
}

interface BotCommandServiceDependencies {
  readonly accounts: AccountLookup;
  readonly bots: BotLookup;
  readonly privateConversations: PrivateConversationLookup;
  readonly supergroupMembers: SupergroupMemberLookup;
  readonly botCommands: BotCommandStore;
}

/** Characters Telegram allows in a bot command. */
const BOT_COMMAND_PATTERN = /^[a-z0-9_]+$/;

/**
 * Keeps each bot's command lists by scope and language, as `setMyCommands`, `getMyCommands`, and
 * `deleteMyCommands` manage them, and resolves the lists an account's client shows in its private
 * chat with the bot and in its supergroups.
 *
 * Chat scopes address private chats an account has started with the bot and supergroups the bot is
 * a member of.
 */
export class BotCommandService {
  readonly #accounts: AccountLookup;
  readonly #bots: BotLookup;
  readonly #privateConversations: PrivateConversationLookup;
  readonly #supergroupMembers: SupergroupMemberLookup;
  readonly #botCommands: BotCommandStore;

  constructor(
    { accounts, bots, privateConversations, supergroupMembers, botCommands }:
      BotCommandServiceDependencies,
  ) {
    this.#accounts = accounts;
    this.#bots = bots;
    this.#privateConversations = privateConversations;
    this.#supergroupMembers = supergroupMembers;
    this.#botCommands = botCommands;
  }

  /**
   * Replaces the bot's command list for a scope and language; an empty list deletes it. Commands
   * are cleaned, trimmed, and stripped of a leading slash, then checked in TDLib's order, as
   * `set_commands` in `td/telegram/BotCommand.cpp` does. Telegram's server then limits their
   * number and characters.
   */
  setBotCommands(input: SetBotCommandsInput): SetBotCommandsResult {
    const targetFailure = this.#checkListTarget(input);
    if (targetFailure !== undefined) {
      return { set: false, reason: targetFailure };
    }

    const commands: BotCommand[] = [];
    for (const specifiedCommand of input.commands) {
      const normalization = normalizeBotCommand(specifiedCommand);
      if (!normalization.normalized) {
        return { set: false, reason: normalization.reason };
      }
      commands.push(normalization.command);
    }
    if (commands.length > MAX_BOT_COMMAND_COUNT) {
      return { set: false, reason: 'too_many_commands' };
    }
    if (commands.some(({ command }) => !BOT_COMMAND_PATTERN.test(command))) {
      return { set: false, reason: 'command_invalid' };
    }

    this.#botCommands.setCommands(input, commands);
    return { set: true };
  }

  /** Returns the bot's command list for exactly this scope and language, without fallback. */
  getBotCommands(target: BotCommandListTarget): GetBotCommandsResult {
    const targetFailure = this.#checkListTarget(target);
    if (targetFailure !== undefined) {
      return { found: false, reason: targetFailure };
    }
    return { found: true, commands: this.#botCommands.getCommands(target) ?? [] };
  }

  /** Deletes the bot's command list for a scope and language. */
  deleteBotCommands(target: BotCommandListTarget): DeleteBotCommandsResult {
    const targetFailure = this.#checkListTarget(target);
    if (targetFailure !== undefined) {
      return { deleted: false, reason: targetFailure };
    }
    this.#botCommands.setCommands(target, []);
    return { deleted: true };
  }

  /**
   * Returns the commands an account's client suggests in its private chat with the bot: the first
   * list found for the chat, then all private chats, then the default scope, each preferring the
   * account's language over the list without one, as the Bot API documents.
   */
  getPrivateChatCommands(
    { accountId, botId }: PrivateConversationKey,
  ): GetPrivateChatCommandsResult {
    const account = this.#accounts.getById(accountId);
    if (account === undefined) {
      return { found: false, reason: 'account_not_found' };
    }
    if (this.#bots.getById(botId) === undefined) {
      return { found: false, reason: 'bot_not_found' };
    }
    return {
      found: true,
      commands: this.#findFirstCommandList(botId, account, [
        { type: 'chat', chatId: accountId },
        { type: 'all_private_chats' },
        { type: 'default' },
      ]),
    };
  }

  /**
   * Returns the commands an account's client suggests in a supergroup it is a member of, for each
   * bot of the supergroup that has any. Each bot's list is the first one found for the account as
   * a member, for the supergroup's administrators if the account is one, for the supergroup, for
   * all groups' administrators if the account is one, for all groups, and then the default scope,
   * each preferring the account's language over the list without one, as the Bot API documents.
   * As in TDLib's `BotCommands` lists, a bot without commands is left out.
   */
  getSupergroupCommands({ accountId, chatId }: SupergroupMemberKey): GetSupergroupCommandsResult {
    const account = this.#accounts.getById(accountId);
    if (account === undefined) {
      return { found: false, reason: 'account_not_found' };
    }
    if (this.#supergroupMembers.getSharedChat(chatId)?.kind !== 'supergroup') {
      return { found: false, reason: 'chat_not_found' };
    }
    const membership = this.#supergroupMembers.getChatMembership(chatId, accountId);
    if (membership === undefined) {
      return { found: false, reason: 'not_a_member' };
    }

    const isAdministrator = isChatAdministrator(membership);
    const scopes: readonly BotCommandScope[] = [
      { type: 'chat_member', chatId, userId: accountId },
      ...(isAdministrator ? [{ type: 'chat_administrators', chatId } as const] : []),
      { type: 'chat', chatId },
      ...(isAdministrator ? [{ type: 'all_chat_administrators' } as const] : []),
      { type: 'all_group_chats' },
      { type: 'default' },
    ];
    const botCommands = this.#supergroupMembers.getChatMemberIds(chatId).flatMap((memberId) => {
      if (this.#bots.getById(memberId) === undefined) {
        return [];
      }
      const commands = this.#findFirstCommandList(memberId, account, scopes);
      return commands.length === 0 ? [] : [{ botId: memberId, commands }];
    });
    return { found: true, botCommands };
  }

  /**
   * Returns the first of the bot's lists for the scopes, in order, each preferring the account's
   * language over the list without one; no commands if none of them has a list.
   */
  #findFirstCommandList(
    botId: number,
    account: VirtualAccount,
    scopes: readonly BotCommandScope[],
  ): readonly BotCommand[] {
    const accountLanguageCode = getCommandListLanguageCode(account.profile.language_code);
    for (const scope of scopes) {
      for (const languageCode of new Set([accountLanguageCode, ''])) {
        const commands = this.#botCommands.getCommands({ botId, scope, languageCode });
        if (commands !== undefined) {
          return commands;
        }
      }
    }
    return [];
  }

  /**
   * Checks that a scope and language can address a command list, as the Bot API server's
   * `check_bot_command_scope` and TDLib's `BotCommandScope::get_bot_command_scope` do.
   */
  #checkListTarget(
    { botId, scope, languageCode }: BotCommandListTarget,
  ): BotCommandListTargetFailureReason | undefined {
    if (this.#bots.getById(botId) === undefined) {
      return 'bot_not_found';
    }
    switch (scope.type) {
      case 'default':
      case 'all_private_chats':
      case 'all_group_chats':
      case 'all_chat_administrators':
        break;
      case 'chat':
      case 'chat_administrators':
      case 'chat_member': {
        if (!isUserId(scope.chatId)) {
          const access = resolveSupergroupBotMembership(
            this.#supergroupMembers,
            botId,
            scope.chatId,
          );
          if (!access.resolved) {
            return access.reason;
          }
          break;
        }
        const conversation = this.#privateConversations.getPrivateConversation({
          accountId: scope.chatId,
          botId,
        });
        if (conversation === undefined) {
          return 'chat_not_found';
        }
        if (scope.type !== 'chat') {
          return 'scope_not_allowed_in_private_chats';
        }
        break;
      }
      default: {
        const unhandledScope: never = scope;
        throw new Error(`Unhandled bot command scope: ${JSON.stringify(unhandledScope)}`);
      }
    }
    return isBotLanguageCode(languageCode) ? undefined : 'language_code_invalid';
  }
}

type BotCommandNormalization =
  | { readonly normalized: true; readonly command: BotCommand }
  | { readonly normalized: false; readonly reason: BotCommandFailureReason };

function normalizeBotCommand(
  { command, description, isEphemeral }: SpecifiedBotCommand,
): BotCommandNormalization {
  const cleanedCommand = cleanInputString(command);
  if (cleanedCommand === undefined) {
    return { normalized: false, reason: 'command_not_utf8' };
  }
  const cleanedDescription = cleanInputString(description);
  if (cleanedDescription === undefined) {
    return { normalized: false, reason: 'command_description_not_utf8' };
  }

  let normalizedCommand = trimTdlibSpaces(cleanedCommand);
  if (normalizedCommand.startsWith('/')) {
    normalizedCommand = normalizedCommand.slice(1);
  }
  if (normalizedCommand.length === 0) {
    return { normalized: false, reason: 'command_empty' };
  }
  if ([...normalizedCommand].length > MAX_BOT_COMMAND_LENGTH) {
    return { normalized: false, reason: 'command_too_long' };
  }
  const normalizedDescription = trimTdlibSpaces(cleanedDescription);
  if (normalizedDescription.length === 0) {
    return { normalized: false, reason: 'command_description_empty' };
  }
  if ([...normalizedDescription].length > MAX_BOT_COMMAND_DESCRIPTION_LENGTH) {
    return { normalized: false, reason: 'command_description_too_long' };
  }
  return {
    normalized: true,
    command: { command: normalizedCommand, description: normalizedDescription, isEphemeral },
  };
}

/**
 * The command list language for a user's language: the primary subtag of an IETF language tag,
 * such as `en` for `en-US`.
 */
function getCommandListLanguageCode(userLanguageCode: string | undefined): BotLanguageCode {
  const primarySubtag = userLanguageCode?.split('-')[0].toLowerCase() ?? '';
  return isBotLanguageCode(primarySubtag) ? primarySubtag : '';
}
