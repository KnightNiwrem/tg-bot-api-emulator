import type { EmulationSession } from '../../../types/emulation_session.ts';
import { CHAT_ID_EMPTY_DESCRIPTION, supergroupBotAccessFailureAnswer } from './chat_access.ts';
import { botApiError, type BotApiMethodAnswer } from './method_call.ts';

/** Telegram's descriptions for rejected requests about chat members. */
export const USER_ID_INVALID_DESCRIPTION = 'Bad Request: invalid user_id specified';
const MEMBER_NOT_FOUND_DESCRIPTION = 'Bad Request: member not found';
const PRIVATE_CHAT_HAS_NO_ADMINISTRATORS_DESCRIPTION =
  'Bad Request: there are no administrators in the private chat';
const PRIVATE_CHAT_MEMBERS_NOT_BANNABLE_DESCRIPTION =
  "Bad Request: can't ban members in private chats";
const METHOD_UNAVAILABLE_IN_PRIVATE_CHATS_DESCRIPTION =
  'Bad Request: method is available only in supergroup and channel chats';
const CANNOT_RESTRICT_SELF_DESCRIPTION = "Bad Request: can't restrict self";
const CANNOT_UNRESTRICT_SELF_DESCRIPTION = "Bad Request: can't unrestrict self";
const METHOD_UNAVAILABLE_OUTSIDE_SUPERGROUPS_DESCRIPTION =
  'Bad Request: method is available only in supergroups';
const NOT_ENOUGH_RIGHTS_DESCRIPTION = 'Bad Request: not enough rights';
const MEMBER_IS_OWNER_DESCRIPTION = "Bad Request: can't remove chat owner";
const NOT_ENOUGH_RIGHTS_TO_RESTRICT_DESCRIPTION =
  'Bad Request: not enough rights to restrict/unrestrict chat member';
const MEMBER_IS_ADMINISTRATOR_DESCRIPTION = 'Bad Request: user is an administrator of the chat';

/** Why a request about a chat's members, or a moderation of them, can fail. */
type ChatMemberFailureReason =
  | Extract<
    ReturnType<EmulationSession['botApi']['getChatMember']>,
    { readonly found: false }
  >['reason']
  | Extract<
    ReturnType<EmulationSession['botApi']['getChatAdministrators']>,
    { readonly found: false }
  >['reason']
  | Extract<
    ReturnType<EmulationSession['botApi']['banChatMember']>,
    { readonly banned: false }
  >['reason']
  | Extract<
    ReturnType<EmulationSession['botApi']['unbanChatMember']>,
    { readonly unbanned: false }
  >['reason']
  | Extract<
    ReturnType<EmulationSession['botApi']['restrictChatMember']>,
    { readonly restricted: false }
  >['reason']
  | Exclude<
    Extract<
      ReturnType<EmulationSession['botApi']['promoteChatMember']>,
      { readonly promoted: false }
    >['reason'],
    | 'cannot_promote_self'
    | 'member_not_in_chat'
    | 'member_kicked'
    | 'rights_not_held'
    | 'bots_cannot_add_members'
  >;

export function readChatMemberTarget(
  { chat_id: chatId, user_id: userId }: { readonly chat_id?: number; readonly user_id?: number },
):
  | { readonly read: true; readonly target: { readonly chatId: number; readonly userId: number } }
  | { readonly read: false; readonly errorAnswer: BotApiMethodAnswer } {
  if (userId === undefined || userId <= 0) {
    return { read: false, errorAnswer: botApiError(400, USER_ID_INVALID_DESCRIPTION) };
  }
  if (chatId === undefined) {
    return { read: false, errorAnswer: botApiError(400, CHAT_ID_EMPTY_DESCRIPTION) };
  }
  return { read: true, target: { chatId, userId } };
}

export function chatMemberFailureAnswer(reason: ChatMemberFailureReason): BotApiMethodAnswer {
  switch (reason) {
    case 'chat_not_found':
    case 'bot_not_a_member':
    case 'bot_kicked':
      return supergroupBotAccessFailureAnswer(reason);
    case 'member_not_found':
      return botApiError(400, MEMBER_NOT_FOUND_DESCRIPTION);
    case 'private_chat_has_no_administrators':
      return botApiError(400, PRIVATE_CHAT_HAS_NO_ADMINISTRATORS_DESCRIPTION);
    case 'private_chat_members_not_bannable':
      return botApiError(400, PRIVATE_CHAT_MEMBERS_NOT_BANNABLE_DESCRIPTION);
    case 'method_unavailable_in_private_chats':
      return botApiError(400, METHOD_UNAVAILABLE_IN_PRIVATE_CHATS_DESCRIPTION);
    case 'cannot_restrict_self':
      return botApiError(400, CANNOT_RESTRICT_SELF_DESCRIPTION);
    case 'cannot_unrestrict_self':
      return botApiError(400, CANNOT_UNRESTRICT_SELF_DESCRIPTION);
    case 'method_unavailable_outside_supergroups':
      return botApiError(400, METHOD_UNAVAILABLE_OUTSIDE_SUPERGROUPS_DESCRIPTION);
    case 'not_enough_rights_to_promote':
      return botApiError(400, NOT_ENOUGH_RIGHTS_DESCRIPTION);
    case 'member_is_owner':
      return botApiError(400, MEMBER_IS_OWNER_DESCRIPTION);
    case 'not_enough_rights':
      return botApiError(400, NOT_ENOUGH_RIGHTS_TO_RESTRICT_DESCRIPTION);
    case 'member_is_administrator':
      return botApiError(400, MEMBER_IS_ADMINISTRATOR_DESCRIPTION);
    default: {
      const unhandledReason: never = reason;
      throw new Error(`Unhandled chat member failure: ${unhandledReason}`);
    }
  }
}
