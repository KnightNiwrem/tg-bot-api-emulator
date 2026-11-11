/** Why a session refuses an account a supergroup request: the account is not a member of it. */
type NotAMemberReason = 'not_a_member';

/** A supergroup request refused because the account is not a member. */
interface ForbiddenRefusal<Reason extends string> {
  readonly status: 403;
  readonly body: { readonly reason: Extract<Reason, NotAMemberReason> };
}

/** A request refused because an account, bot, chat or message it names does not exist. */
interface NotFoundRefusal<Reason extends string> {
  readonly status: 404;
  readonly body: { readonly reason: Exclude<Reason, NotAMemberReason> };
}

/**
 * Answers an account's supergroup request that the session refused: a supergroup the account is not
 * a member of is forbidden, and anything else the request names but the session lacks is not found.
 */
export function refuseSupergroupRequest<Reason extends string>(
  reason: Reason,
): ForbiddenRefusal<Reason> | NotFoundRefusal<Reason> {
  return isNotAMemberReason(reason) ? { status: 403, body: { reason } } : refuseAsNotFound(reason);
}

/**
 * Answers an account's private-chat request that the session refused as not found. Only a
 * supergroup has members, so a private chat never refuses an account as not being one.
 *
 * @param refusedRequest What the account asked for, such as "its pinned messages", for the error.
 * @throws {Error} when the session refused the account as not a member of the private chat.
 */
export function refusePrivateChatRequest<Reason extends string>(
  reason: Reason,
  refusedRequest: string,
): NotFoundRefusal<Reason> {
  if (isNotAMemberReason(reason)) {
    throw new Error(`A private chat refused ${refusedRequest} as ${reason}`);
  }
  return refuseAsNotFound(reason);
}

function isNotAMemberReason<Reason extends string>(
  reason: Reason,
): reason is Extract<Reason, NotAMemberReason> {
  return reason === 'not_a_member';
}

// TypeScript does not narrow a generic reason in the false branch of `isNotAMemberReason`, so the
// not-found reason has its own guard.
function isNotFoundReason<Reason extends string>(
  reason: Reason,
): reason is Exclude<Reason, NotAMemberReason> {
  return reason !== 'not_a_member';
}

/** @throws {Error} when the reason is `not_a_member`, which callers answer before this. */
function refuseAsNotFound<Reason extends string>(reason: Reason): NotFoundRefusal<Reason> {
  if (!isNotFoundReason(reason)) {
    throw new Error(`A refusal as ${reason} is not a missing resource`);
  }
  return { status: 404, body: { reason } };
}
