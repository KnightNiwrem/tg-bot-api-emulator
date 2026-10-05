# Invite links and join requests

[Feature index and comparison baseline](README.md) · [Supergroups](supergroups.md) ·
[Updates](updates.md) ·
[TypeScript client guide: Invite links](../clients/typescript/invite-links.md)

## Capability matrix

| Area                   | Supported                                                                                                                           | Not supported                                                                                  |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `createChatInviteLink` | `chat_id`, `name`, `expire_date`, `member_limit`, `creates_join_request`, in supergroups                                            | Basic groups, channels                                                                         |
| Other Bot API          | `approveChatJoinRequest`, `declineChatJoinRequest`, `invite_link` in `chat_member` updates, `chat_join_request` updates             | `editChatInviteLink`, `revokeChatInviteLink`, `exportChatInviteLink`, subscription links, bios |
| Account actions        | Joining or requesting to join through an invite link, joining a public supergroup by itself, inspecting a chat's links and requests | Creating, editing and revoking links as an account, primary links                              |
| Join requests          | One pending request per account and chat, decided once by any administrator bot with `can_invite_users`                             | Decisions by accounts, requests without a link, join request queries                           |
| Requester contact      | Messages from the bots that received a request to its requester [before a decision](#contacting-requesters)                         | Edits, deletions, chat actions and other uses of the chat under the grant                      |
| Time                   | Expiry dates and contact windows that a test [makes end](#expiry-dates)                                                             | Expiry by elapsed time                                                                         |

## Creating invite links

An administrator bot creates an additional invite link of a supergroup with `createChatInviteLink`,
which answers the new link as a `ChatInviteLink` in the field order of the official server's
[`JsonChatInviteLink`][json-chat-invite-link]: `invite_link`, `name`, `creator`, `expire_date`,
`member_limit`, `creates_join_request`, `is_primary` and `is_revoked`. A link is `https://t.me/+`
followed by a random 16-character hash, as TDLib's [`get_dialog_invite_link`][dialog-invite-link]
writes it, and is unique in its session. The emulator creates no primary link, and links are never
revoked, so `is_primary` and `is_revoked` are false. A link keeps its creator, its name, its expiry
date, its member limit, and whether it creates join requests.

As the official server's [`process_create_chat_invite_link_query`][create-query] reads them, a
missing name is empty, and a missing or zero `expire_date` or `member_limit` means none; the
emulator rejects a negative one, which the server reads as zero. As TDLib's
[`export_dialog_invite_link`][export-link] does, the name is cleaned as a chat title is, keeping at
most 32 characters, its server-side limit.

A request is checked in this order:

| Check                                                    | Error, after `Bad Request:`                                                  |
| -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `chat_id` is missing                                     | `chat_id is empty`                                                           |
| The bot cannot address the chat, as for `sendMessage`    | `chat not found`, or `403` for a supergroup it left or was removed from      |
| The chat is a private chat                               | `can't invite members to a private chat`                                     |
| The name is not well-formed Unicode                      | `strings must be encoded in UTF-8`                                           |
| The link creates join requests and has a member limit    | `member limit can't be specified for links requiring administrator approval` |
| The bot lacks the `can_invite_users` administrator right | `not enough rights to manage chat invite link`                               |
| The expiry date is not in the future                     | `EXPIRE_DATE_INVALID` (see [comparison limits](#comparison-limits))          |
| The member limit exceeds 99999                           | `USAGE_LIMIT_INVALID` (see [comparison limits](#comparison-limits))          |

The rights check follows TDLib's [`can_manage_dialog_invite_links`][manage-links-check], whose
[`can_manage_invite_links`][manage-links-right] requires the administrator right "explicitly
granted": a bot never creates links through default permissions. The join request and member limit
check comes before it, as `export_dialog_invite_link` makes it before
`export_dialog_invite_link_impl` checks rights. A refused request creates no link.

## Joining through a link

An account joins the supergroup a link leads to with
`POST /sessions/{sessionId}/accounts/{accountId}/chat-joins` and `{ "invite_link": "..." }`, or the
TypeScript client's `joinChatByInviteLink`, which answer the supergroup's `chat_id` and the outcome
`joined`. The whole link must be given as the bot received it. A refused use changes nothing:

| Case                                                                              | Status |
| --------------------------------------------------------------------------------- | ------ |
| The account or the link is unknown, including a link of another session           | `404`  |
| A test made the link's expiry date arrive, or its member limit is reached         | `410`  |
| The account is a member already, or its [join request](#join-requests) is pending | `409`  |
| The account is banned from the supergroup                                         | `403`  |

A restricted user that is not a member joins with its restriction, as when the owner adds it. As the
official server shows TDLib's `messageChatJoinByLink`, the join is the account's own service message
with `new_chat_members`, which every bot of the supergroup receives, privacy mode notwithstanding.
Administrator bots subscribed to `chat_member` receive the change from `left` to `member`, from the
account itself, with `invite_link`, after `new_chat_member` as the official server's
[`JsonChatMemberUpdated`][json-chat-member-updated] places it. As the Bot API documents for
`ChatInviteLink.invite_link`, "if the link was created by another chat administrator, then the
second part of the link will be replaced": only the creator sees the whole link, and other
administrator bots see the first half of its hash followed by `...`, the truncation TDLib's
[`is_valid_invite_link`][truncated-link] accepts in these updates. `getChatMember`,
`getChatMemberCount` and the account's history then show the new member.

### Member limits

As the Bot API documents `member_limit`, "the maximum number of users that can be members of the
chat simultaneously after joining the chat via this invite link", a link's limit counts the members
that joined through it and still are. A member that leaves, or is removed or banned, frees its
place; joining again through the link takes a place again; and a user the owner adds takes none,
even one that once joined through the link. A link whose places are taken refuses further users with
`410`, as an expired link does.

### Expiry dates

The emulator never lets an expiry date arrive by itself, as it never closes polls or ends
restrictions as time passes: a link keeps admitting users until a test makes its expiry date arrive
with `POST /sessions/{sessionId}/supergroups/{chatId}/invite-links/{inviteLinkHash}/expiry`, or the
TypeScript client's `session.expireChatInviteLink`. The link then admits nobody; the members that
joined through it stay. No bot receives an update for it. A link without an expiry date, or one that
already expired, answers `409`, and an unknown supergroup or link `404`. The route makes the date
arrive whatever the session's clock reads; the clock only decides, when a bot creates a link, that
its expiry date lies in the future.

## Join requests

A link that creates join requests leaves an account that uses it outside the supergroup and stores
its pending request, as Telegram answers `INVITE_REQUEST_SENT` instead of joining; the outcome is
`join_request_sent`. As [`messages.hideChatJoinRequest`][hide-join-request] addresses a request by
its chat and user, an account has one pending request per supergroup: using a request link again
while its request is pending answers `409` and changes nothing, keeping the first request with its
link and date, and sending no update. The expiry and standing checks of
[joining through a link](#joining-through-a-link) come first. A request ends when its account joins,
whichever way, is banned, or a bot [approves or declines](#approving-and-declining-requests) it; a
restriction leaves it pending, as a restricted account may still join.

The supergroup's administrator bots that hold `can_invite_users` receive the request as a
`chat_join_request` update, as the Bot API documents: "The bot must have the can_invite_users
administrator right in the chat to receive these updates". Other bots, and bots whose
`allowed_updates` exclude `chat_join_request`, receive nothing. The update has the fields of the
official server's [`JsonChatJoinRequest`][json-chat-join-request] in its order: `chat`, `from`, the
requester, `user_chat_id`, `date` and `invite_link`, which, as in `chat_member` updates, only the
link's creator sees whole, and whose `pending_join_request_count` includes the new request. Bios are
not modeled, so `bio` is omitted, and so is `query_id`, as join request queries are not supported. A
webhook receives join requests in a queue per requester, as the official server's
[`add_update_chat_join_request`][join-request-queue] chooses it.

`user_chat_id` is the requester's ID, which names its private chat with the bot, where the bots that
received the request may [contact the requester](#contacting-requesters) before a decision.

The owner inspects the pending requests with
`GET /sessions/{sessionId}/accounts/{accountId}/conversations/supergroup/{chatId}/join-requests`, or
the TypeScript client's `getChatJoinRequests`: each request's `user_id`, the whole `invite_link` it
was sent through, its `date` and its `requester_contact`, in the order they were sent; any other
account is answered `403`. The supergroup's links show their `pending_join_request_count`, and the
Bot API's `ChatInviteLink` shows it too when it is not 0.

### Contacting requesters

The Bot API documents that a bot "can use this identifier for 5 minutes to send messages until the
join request is processed, assuming no other administrator contacted the user". The emulator grants
this to the bots that received the request, the administrator bots holding `can_invite_users` when
it was sent, whether or not their `allowed_updates` include `chat_join_request`:

- While the contact is `open`, each of these bots may send messages to the requester, although the
  account never started it: `sendMessage`, the other send methods, `sendMediaGroup`, and forwards
  and copies into the chat. The account sees them in its private chat with the bot, presses their
  buttons and answers polls.
- The first of them to send a message claims the contact: it is then `claimed`, and only that bot
  may write under it. A message the bot sends to a requester that already started it is ordinary,
  and claims nothing.
- A bot must still hold `can_invite_users` when it writes, as deciding the request takes. A bot that
  gains the right after the request, or administers without it, may not write.
- The permission ends with the request: when a bot approves or declines it, or the account joins
  otherwise or is banned. A test ends it earlier, as five minutes passing does, with
  `POST /sessions/{sessionId}/supergroups/{chatId}/join-requests/{userId}/requester-contact/expiry`,
  or the TypeScript client's `session.expireJoinRequesterContact`, which answers the request with
  its contact `expired`, and leaves it pending. An expired contact answers `409`, and an unknown
  supergroup or a user without a pending request `404`. An invite link's expiry leaves its pending
  requests and their contacts alone.
- A bot's message under the grant starts no conversation: once the grant ends, the bot's sends fail
  with `Bad Request: chat not found` again. The account's own message to the bot, such as its answer
  to the prompt, starts the conversation as any account message does, and the bot then writes to it
  as to any account that started it.
- The grant covers sending messages only. Editing, deleting and pinning the bot's messages there,
  chat actions, `getChat` and the chat's command scopes need the account to have started the bot.

A refused message is not stored, claims nothing and sends no update; an account that blocked the bot
refuses it with `Forbidden: bot was blocked by the user`, as for any message. Each request has its
own contact, so one that a bot claimed does not carry over to the account's next request after a
decline. A bot that writes to an account with pending requests in several supergroups claims the
contact of each request it may write under.

## Approving and declining requests

An administrator bot approves a pending request with `approveChatJoinRequest`, or declines it with
`declineChatJoinRequest`, naming the supergroup and the account by `chat_id` and `user_id`; both
answer `True`. As TDLib's [`can_manage_dialog_join_requests`][manage-join-requests] checks only the
`can_invite_users` administrator right, any administrator bot holding it decides any request,
whoever created the link it was sent through.

Approval lets the account in as if it had joined through the link: it joins restricted if it was,
its membership counts for the link's `member_count` while it lasts, and its join is its own service
message with `new_chat_members`, as the official server shows TDLib's `messageChatJoinByRequest`.
Administrator bots subscribed to `chat_member` receive the change from the approving bot, with the
request's `invite_link`. `via_join_request` stays absent, as TDLib [sets it][via-join-request] only
for requests sent without an invite link, which are not supported. Declining ends the request and
leaves the account outside, which no update reports; the account may request again.

A decision consumes its request, so a session decides each request once, even when bots decide at
the same time: the session handles one call after another, and a later approval or decline finds the
account a member, or the request gone. Nothing adds a member twice. The bot activity log records
each call with its answer. Requests are checked in this order, after a `chat_id` given as
`@username` is [resolved](sessions-and-requests.md#chat-usernames):

| Check                                                          | Error, after `Bad Request:`                                             |
| -------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `user_id` is missing or not positive                           | `invalid user_id specified`                                             |
| `chat_id` is missing                                           | `chat_id is empty`                                                      |
| The bot cannot address the chat, as for `sendMessage`          | `chat not found`, or `403` for a supergroup it left or was removed from |
| The chat is a private chat                                     | `the chat can't have join requests`                                     |
| The bot lacks the `can_invite_users` administrator right       | `not enough rights to manage chat join requests`                        |
| The account is a member, also once a request was approved      | `USER_ALREADY_PARTICIPANT`                                              |
| The account has no pending request, also once one was declined | `HIDE_REQUESTER_MISSING`                                                |

The last two are errors [`messages.hideChatJoinRequest`][hide-join-request] documents, which the
official server passes on; a refused call changes nothing.

## Joining public supergroups

An account joins a public supergroup by itself with
`PUT /sessions/{sessionId}/accounts/{accountId}/conversations/supergroup/{chatId}/members/{accountId}`,
naming itself, or the TypeScript client's `joinChat`, both addressing the supergroup by its chat ID,
as Telegram's clients join one they find by its username with TDLib's `join_channel`. The join is
recorded and delivered as through a link, without `invite_link`. A member's join changes nothing, in
any supergroup. A supergroup without a username answers `403`, as only an invite link or its owner
lets users in, and so does one that bans the account.

## Inspecting links

The owner inspects a supergroup's links with
`GET /sessions/{sessionId}/accounts/{accountId}/conversations/supergroup/{chatId}/invite-links`, or
the TypeScript client's `getChatInviteLinks`: each whole link, in the order bots created them, with
its settings by the Bot API's names, `creator_user_id`, `member_count`, the members that joined
through it and still are, `pending_join_request_count`, and `is_expired`. As TDLib's
`getChatInviteLinks` requires the owner for links that other administrators created, and only bots
create links, any other account is answered `403`.

## Intentional deviations

- **Expiry without elapsed time.** Telegram stops a link when its expiry date passes, and ends a
  requester contact five minutes after the request. The emulator ends each only when a test makes it
  end, so tests decide the moment deterministically.
- **Strict parameters.** A negative `expire_date` or `member_limit`, which the official server's
  `get_integer_arg` clamps to zero, is rejected as
  `Bad Request: invalid createChatInviteLink parameters` to surface the bot's mistake.
- **Exact links.** Accounts use a link exactly as the bot received it; the `t.me/joinchat/` and
  `tg://join` forms that Telegram's clients also accept are unknown links.

## Real gaps

- **Link lifecycle.** `editChatInviteLink`, `revokeChatInviteLink`, `exportChatInviteLink`, primary
  links and subscription links are not implemented.
- **Requests without a link.** Public supergroups that require approval to join, and the join
  request queries of guard bots, are not supported.
- **Account administrators.** Accounts cannot create links or decide join requests, even as the
  owner or administrators with `can_invite_users`.
- **Other chat kinds.** Basic groups and channels have no invite links.

## Comparison limits

Telegram's servers create links and decide who may use them, which the open-source code shows only
in part:

- **Server errors.** [`messages.exportChatInvite`][export-chat-invite] documents
  `EXPIRE_DATE_INVALID` and `USAGE_LIMIT_INVALID`, and the official server passes such uppercase
  errors on; when the servers raise them is not public. The emulator refuses an expiry date that is
  not after the current time and a member limit above 99999, the limit TDLib documents.
- **Refused uses.** The emulation API answers with statuses rather than Telegram's errors. Which of
  [`messages.importChatInvite`][import-chat-invite]'s errors a used-up link raises is not public;
  the emulator answers it as an expired link, and checks the link before the account's standing.
- **Hidden links.** How much of a link Telegram's servers hide from other administrators is not
  public; the emulator keeps the first half of the hash.
- **Creator's tenure.** A link keeps working when its creator leaves or loses its rights.
- **Repeated and ended requests.** Whether Telegram's servers send bots another update for a
  repeated request, and what becomes of a request when its user joins otherwise or is banned, is not
  public. The emulator keeps one request per account and chat, sends one update for it, and ends it
  when the account joins or is banned.
- **Requester contact.** TDLib only opens the private chat when a bot receives a request; Telegram's
  servers decide who may write there. Which bots receive the permission, what counts as another
  administrator contacting the user, whether rights are checked again when the bot writes, which
  uses besides sending messages it allows, and whether a request in one supergroup lets a message
  claim the contact of another are not public. The emulator applies the
  [policy above](#contacting-requesters). Whether the requester's answer lets the bot keep writing
  after the decision is not public either; the emulator treats it as any account message, which
  starts the conversation.
- **Decision errors.** The order of the servers' `USER_ALREADY_PARTICIPANT` and
  `HIDE_REQUESTER_MISSING` checks is not public; the emulator checks membership first, and answers a
  user unknown to the session as one without a request.

## Local evidence

[Domain model](../../src/types/chat_invite_link.ts),
[admission service](../../src/services/chat_admission.ts),
[storage](../../src/repositories/chat_invite_link.ts),
[membership and request storage](../../src/repositories/shared_chat.ts),
[update delivery](../../src/services/bot_update_delivery.ts),
[Bot API handlers](../../src/api/sessions/bot_api/mod.ts),
[projection](../../src/projections/bot_api_chat_invite_link.ts),
[account routes](../../src/api/sessions/accounts/mod.ts),
[expiry routes](../../src/api/sessions/supergroups/mod.ts),
[private messaging](../../src/services/private_messaging.ts),
[service tests](../../tests/chat_admission_service_test.ts),
[link HTTP tests](../../tests/chat_invite_link_api_test.ts) and
[join request HTTP tests](../../tests/chat_join_request_api_test.ts).

[json-chat-invite-link]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L1401-L1434
[json-chat-member-updated]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L5926-L5953
[create-query]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L15595-L15610
[dialog-invite-link]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/LinkManager.cpp#L4275-L4284
[export-link]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/DialogInviteLinkManager.cpp#L970-L1010
[manage-links-check]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/DialogInviteLinkManager.cpp#L918-L953
[manage-links-right]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/DialogParticipant.h#L469-L472
[truncated-link]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/DialogInviteLink.cpp#L97-L102
[export-chat-invite]: https://core.telegram.org/method/messages.exportChatInvite
[import-chat-invite]: https://core.telegram.org/method/messages.importChatInvite
[hide-join-request]: https://core.telegram.org/method/messages.hideChatJoinRequest
[manage-join-requests]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/DialogParticipantManager.cpp#L1256-L1284
[via-join-request]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/UpdatesManager.cpp#L3244-L3262
[json-chat-join-request]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L5955-L5980
[join-request-queue]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L18722-L18733
