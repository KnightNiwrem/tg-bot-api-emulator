# Invite links and joining

[Feature index and comparison baseline](README.md) · [Supergroups](supergroups.md) ·
[Updates](updates.md)

## Capability matrix

| Area                   | Supported                                                                                        | Not supported                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `createChatInviteLink` | `chat_id`, `name`, `expire_date`, `member_limit`, `creates_join_request`, in supergroups         | Basic groups, channels                                                                                  |
| Other Bot API          | `invite_link` in `chat_member` updates                                                           | `editChatInviteLink`, `revokeChatInviteLink`, `exportChatInviteLink`, subscription links, join requests |
| Account actions        | Joining through an invite link, joining a public supergroup by itself, inspecting a chat's links | Creating, editing and revoking links as an account, primary links                                       |
| Time                   | Expiry dates that a test [makes arrive](#expiry-dates)                                           | Expiry by elapsed time                                                                                  |

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

| Case                                                                      | Status |
| ------------------------------------------------------------------------- | ------ |
| The account or the link is unknown, including a link of another session   | `404`  |
| A test made the link's expiry date arrive, or its member limit is reached | `410`  |
| The account is a member already                                           | `409`  |
| The account is banned from the supergroup                                 | `403`  |
| The link creates join requests                                            | `501`  |

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
through it and still are, and `is_expired`. As TDLib's `getChatInviteLinks` requires the owner for
links that other administrators created, and only bots create links, any other account is answered
`403`.

## Intentional deviations

- **Expiry without elapsed time.** Telegram stops a link when its expiry date passes. The emulator
  stops it only when a test makes the date arrive, so tests decide the moment deterministically.
- **Strict parameters.** A negative `expire_date` or `member_limit`, which the official server's
  `get_integer_arg` clamps to zero, is rejected as
  `Bad Request: invalid createChatInviteLink parameters` to surface the bot's mistake.
- **Exact links.** Accounts use a link exactly as the bot received it; the `t.me/joinchat/` and
  `tg://join` forms that Telegram's clients also accept are unknown links.

## Real gaps

- **Link lifecycle.** `editChatInviteLink`, `revokeChatInviteLink`, `exportChatInviteLink`, primary
  links and subscription links are not implemented.
- **Join requests.** A link that creates join requests admits nobody, and bots receive no
  `chat_join_request` update.
- **Account administrators.** Accounts cannot create links, even as administrators with
  `can_invite_users`.
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

## Local evidence

[Domain model](../../src/types/chat_invite_link.ts),
[admission service](../../src/services/chat_admission.ts),
[storage](../../src/repositories/chat_invite_link.ts),
[membership storage](../../src/repositories/shared_chat.ts),
[Bot API handlers](../../src/api/sessions/bot_api/mod.ts),
[projection](../../src/projections/bot_api_chat_invite_link.ts),
[account routes](../../src/api/sessions/accounts/mod.ts),
[expiry route](../../src/api/sessions/supergroups/mod.ts),
[service tests](../../tests/chat_admission_service_test.ts) and
[HTTP tests](../../tests/chat_invite_link_api_test.ts).

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
