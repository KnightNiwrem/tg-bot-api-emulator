import type { EmulationSession } from '../../../types/emulation_session.ts';

/**
 * Why an account's message, sent directly or by pressing a reply keyboard button, or its album
 * failed.
 */
type AccountMessageFailureReason =
  | Extract<
    ReturnType<EmulationSession['privateMessaging']['pressReplyKeyboardButton']>,
    { readonly sent: false }
  >['reason']
  | Extract<
    ReturnType<EmulationSession['privateMessaging']['sendAccountAlbum']>,
    { readonly sent: false }
  >['reason'];

/**
 * A missing participant, or a missing user or supergroup to share, is not found; a supergroup the
 * account is not a member of is forbidden to share; a block conflicts with writing to the bot, and
 * an account without a phone number conflicts with sharing its own contact.
 */
export function accountMessageFailureStatus(
  reason: AccountMessageFailureReason,
): 400 | 403 | 404 | 409 {
  switch (reason) {
    case 'account_not_found':
    case 'bot_not_found':
    case 'shared_user_not_found':
    case 'shared_chat_not_found':
      return 404;
    case 'shared_chat_not_joined':
      return 403;
    case 'bot_blocked':
    case 'account_phone_number_missing':
      return 409;
    default:
      return 400;
  }
}

type SupergroupMessaging = EmulationSession['supergroupMessaging'];

/** Why an account's message, album, edit, or history request in a supergroup failed. */
type SupergroupAccountFailureReason =
  | Extract<ReturnType<SupergroupMessaging['sendAccountMessage']>, { sent: false }>['reason']
  | Extract<ReturnType<SupergroupMessaging['sendAccountAlbum']>, { sent: false }>['reason']
  | Extract<
    ReturnType<SupergroupMessaging['pressReplyKeyboardButton']>,
    { sent: false }
  >['reason']
  | Extract<ReturnType<SupergroupMessaging['editAccountMessage']>, { edited: false }>['reason']
  | Extract<ReturnType<SupergroupMessaging['getMessageHistory']>, { found: false }>['reason'];

/**
 * A missing account, supergroup, or message is not found, and an account that is not a member of
 * the supergroup, or may not send the content, is forbidden from it; an account without a phone
 * number conflicts with sharing its own contact; other failures reject the request.
 */
export function supergroupMemberFailureStatus(
  reason: SupergroupAccountFailureReason,
): 400 | 403 | 404 | 409 {
  switch (reason) {
    case 'account_not_found':
    case 'chat_not_found':
    case 'message_not_found':
      return 404;
    case 'not_a_member':
    case 'send_permission_missing':
      return 403;
    case 'account_phone_number_missing':
      return 409;
    default:
      return 400;
  }
}
