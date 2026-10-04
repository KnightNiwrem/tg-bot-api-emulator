# Supergroups and administration

[Feature index and comparison baseline](README.md) · [Messages](messages.md) · [Updates](updates.md)
· [TypeScript client guide: Supergroups](../clients/typescript/supergroups.md) ·
[TypeScript client guide: Permissions and moderation](../clients/typescript/permissions-and-moderation.md)

## Membership and messages

An account creates a supergroup and becomes its owner. The owner adds accounts and bots, removes
members, and promotes/demotes administrators through the emulation API; administrator bots promote
and demote with `promoteChatMember`. Accounts also join by themselves, through an administrator
bot's [invite link](invite-links.md), or a public supergroup by its username. Members can leave;
bots leave through `leaveChat`. Removed members are banned until unbanned or added back by the
owner.

Text, photos, documents, replies, inline keyboards, callbacks, forwarding and edits use the same Bot
API methods as private chats, with a negative supergroup chat ID. Message IDs belong to the
supergroup and are shared by all observers.

Additions and departures create membership service messages containing `new_chat_members` or
`left_chat_member` and legacy aliases. Bots receive these despite privacy mode, subject to their
`message` subscription. An affected bot also receives `my_chat_member` when subscribed. A removed
bot receives its removal service message and the `kicked` membership change; subsequent chat access
fails with `403 Forbidden: bot was kicked from the supergroup chat`. A bot that left instead gets
`403 Forbidden: bot is not a member of the supergroup chat`.

## Privacy mode

Administrator bots and bots created with `can_read_all_group_messages: true` receive all account
messages. A bot never receives its own messages. Nor does it receive other bots' messages: the
emulator behaves as if no bot enabled Telegram's opt-in [bot-to-bot communication][bot-to-bot],
which is a [real gap](#real-gaps). Privacy mode is enabled by default for other bots.

For an account message, the emulator first resolves an explicit recipient: replies to a bot's
message or to a message meant for it, then `via_bot`, then a leading command naming a bot. Such a
message goes only to that recipient among privacy-enabled bots. A reply to bot A's message that
commands bot B therefore goes to A. Without an explicit recipient, a mention or an unqualified
leading command can cause delivery. A message mentions a bot through a text mention of it, or a
[detected](text-formatting.md#detected-entities) `mention` entity of its username, ignoring letter
case. As TDLib's [`match_mentions`][mention-matching] decides, an `@username` that runs into further
letters or digits of any script is no mention, nor is one inside code, a link or a URL.

As Telegram's [Bot FAQ][privacy-faq] describes, an unqualified command such as `/start` reaches only
the bot that last sent a message to the group. Only bots' own messages count: not an account's
message sent through an inline bot, nor a service message a bot causes. When that bot already
receives all messages, as an administrator or with privacy mode disabled, no privacy-enabled bot
receives the command. Before any bot has sent a message, every privacy-enabled bot receives it, an
[intentional routing rule](#intentional-deviations).

Multiple-recipient mention routing is a [real gap](#real-gaps). Ranking `via_bot` before an
addressed command is also an intentional routing rule.

Changing subscriptions does not change which bot a message is addressed to. This prevents an
unsubscribed recipient from redirecting a reply to another privacy-enabled bot.

## Administrator operations

Owners, and administrator bots with `can_promote_members`, grant administrator rights by their Bot
API names. Promotion and demotion update an affected bot's `my_chat_member` status, and
administrator status bypasses privacy mode. The implemented rights with behavioral effects are:

| Right                  | Effect                                                                                                               |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `can_change_info`      | Call `setChatTitle` and `setChatDescription`                                                                         |
| `can_delete_messages`  | Delete other members' content and service messages                                                                   |
| `can_invite_users`     | Call `createChatInviteLink`, decide join requests, and receive `chat_join_request` updates when subscribed           |
| `can_restrict_members` | Call `banChatMember`, `unbanChatMember`, `restrictChatMember` and `setChatPermissions`                               |
| `can_pin_messages`     | Call `pinChatMessage` and `unpinChatMessage`, under the [pinning rules](pinned-messages.md#pinning-with-the-bot-api) |
| `can_promote_members`  | Call `promoteChatMember`, granting the rights the bot holds, and `setChatAdministratorCustomTitle`                   |

### Administrator delegation

Each administrator records who last set its rights, as Telegram records `promoted_by` in its
[`channelParticipantAdmin`][participant-admin]; the owner's promotions record the owner. Bots see
`can_be_edited` in `getChatMember`, `getChatAdministrators`, `chat_member` and `my_chat_member` as
the Bot API documents `can_promote_members`: a bot may edit an administrator when it holds
`can_promote_members`, which TDLib's [`promote_channel_participant`][promote-participant] requires
of any change, and promoted the administrator, directly or through administrators it promoted. No
member may edit itself. The owner edits every administrator.

A promotion counts for editing only while the promoter's tenure as an administrator lasts. Once a
promoter is demoted or leaves, the administrators it promoted are left to the owner, and stay so
even if it is promoted again, which starts a new tenure; `promoted_by_user_id` still names it. So an
administrator that its own appointee promotes back may be edited by that appointee, but edits
neither it nor the others it promoted before.

Members inspect the owner and administrators with
`GET /sessions/{sessionId}/accounts/{accountId}/conversations/supergroup/{chatId}/administrators`,
or the TypeScript client's `getChatAdministrators`: each administrator shows its rights, custom
title, `promoted_by_user_id`, and `can_be_edited` as decided for the inspecting account.

### Bot promotion

An administrator bot promotes a member with `promoteChatMember`, changes an administrator's rights,
or demotes one by passing every right as false, as the Bot API documents. As the official server's
[`process_promote_chat_member_query`][promote-method] reads them, each right is a separate parameter
and a missing one is false; `can_manage_voice_chats` names `can_manage_video_chats`. As TDLib's
[`AdministratorRights`][administrator-rights] makes them for a supergroup, any right includes
`can_manage_chat`, the rights that apply only to channels are dropped, and no right leaves a member.
The bot becomes the administrator's promoter. An administrator keeps its custom title while its
rights change and loses it when demoted. Administrator bots receive the change as `chat_member`, and
a promoted bot as `my_chat_member`; no service message records it.

Checks follow TDLib's [`set_channel_participant_status_impl`][participant-status] and
`promote_channel_participant`, then the errors Telegram's servers give for
[`channels.editAdmin`][edit-admin], which the official server passes on:

1. Nobody changes the owner (`Bad Request: can't remove chat owner`). A promotion that changes
   nothing succeeds without rights; for an administrator, only one the bot may edit counts as
   unchanged, as TDLib compares `can_be_edited` too.
2. A bot does not promote itself or change its own rights (`Bad Request: can't promote self`),
   though it may demote itself, as TDLib allows.
3. For anyone else, the bot needs `can_promote_members` (`Bad Request: not enough rights`).
4. The user must be a member (`Bad Request: USER_NOT_MUTUAL_CONTACT`), and not banned
   (`Bad Request: USER_KICKED`).
5. An administrator must be one the bot promoted, directly or indirectly
   (`Bad Request: user is an administrator of the chat`).
6. The bot grants only rights it holds (`Bad Request: RIGHT_FORBIDDEN`), as the Bot API documents an
   administrator adding others "with a subset of their own privileges".

Demoting a user that is no administrator lifts a member's restriction, as `restrictChatMember` does
with every permission. A user that is not a member would have to be added, which TDLib's
[`add_channel_participant`][add-participant] refuses to bots
(`Bad Request: bots can't add new chat members`); lifting its ban or restriction first needs
`can_restrict_members`. `is_anonymous: true` is refused
(`Bad Request: anonymous administrators are not supported`). A refused request changes nothing.

`banChatMember` removes a current member and records a service message authored by the bot.
`unbanChatMember` lifts a ban; unless `only_if_banned` is true, it also removes a current member.
Checks include self-targeting, owner protection, required rights and administrator targets. The
ordering follows the relevant TDLib [participant status checks][participant-checks].

Removed members lose access to history; their prior messages remain visible to other members.
`revoke_messages` has no separate effect in the emulator's supergroups. TDLib's
[`ban_dialog_participant`][ban-member] passes that flag to its basic-group removal path, while its
supergroup path changes participant status. The public client code does not establish additional
remote history processing.

The owner can also protect all of the supergroup's content, as Telegram's "Restrict saving content"
setting does, and lift that protection. As TDLib's
[`get_message_has_protected_content`][protected-content] decides, every message of the supergroup,
including earlier ones, is then protected while the setting lasts: bots see `has_protected_content`,
neither bots nor accounts can forward the messages, and a bot's reply to one from another chat is
sent without the reply, though bots may still copy them. As TDLib's
[`toggle_dialog_has_protected_content`][protection-toggle] requires, only the owner may change the
setting. The official server hides the service message for the change from bots, so they receive
none.

The owner sets its own custom title or an administrator's through the emulation API, and a bot sets
the title of an administrator it may edit with `setChatAdministratorCustomTitle`; an empty or
missing title removes it. Bots see it as `custom_title` of the owner and administrators, in the
field order of the official server's [`JsonChatMember`][chat-member-json], and members in the list
of administrators. An administrator keeps its title when its rights change and loses it when
demoted, as member tags are not supported.

A title is read as Telegram reads it: TDLib's `clean_input_string` cleans it
(`Bad Request: strings must be encoded in UTF-8` for text that is not well-formed Unicode);
Telegram's servers refuse more than 16 characters, counted by code point, or emoji, as the Bot API
documents "0-16 characters, emoji are not allowed"; and TDLib keeps it as
[`strip_empty_characters`][rank-strip] strips it, without surrounding spaces. The official server
reports the servers' `RANK_INVALID` and `RANK_EMOJI_NOT_ALLOWED` as
[`Bad Request: CUSTOM_TITLE_INVALID` and `Bad Request: CUSTOM_TITLE_EMOJI_NOT_ALLOWED`][rank-errors];
the emulation API answers `400`. Setting the title a user has changes nothing.

Telegram does not publish which characters its servers count as emoji in a title, so the emulator
refuses those that Telegram Desktop [strips from a title][desktop-title-emoji]: characters with
Unicode's `Emoji` property, except digits, `#` and `*` outside a keycap, and ©, ® and ™ without the
emoji presentation selector U+FE0F. Pictographic code points that the runtime's Unicode data leaves
unassigned are refused too, as Unicode reserves them for emoji, so emoji newer than the runtime are
caught. Symbols such as ★ and ♪, which lack the `Emoji` property, are accepted. A lone regional
indicator letter is refused, although Telegram Desktop keeps it.

Before the title, [`process_set_chat_administrator_custom_title_query`][custom-title-method] checks
that the owner alone sets its own title (`Bad Request: only the owner can edit their custom title`),
that the user is an administrator (`Bad Request: user is not an administrator`), and that the bot
may edit it (`Bad Request: not enough rights to change custom title of the user`). The server then
sets the title as the member's tag with TDLib's `setChatMemberTag`. Telegram announces tag changes
only in basic groups, as its [member tag documentation][member-tags] says, so no update reports a
bot's title change. The owner's change, which Telegram's clients make with `channels.editAdmin`,
reaches administrator bots as `chat_member`, and the titled bot as `my_chat_member`.

`getChatMember`, `getChatAdministrators` and `getChatMemberCount` expose stored membership.
`getChatAdministrators` excludes bot administrators by default and accepts `return_bots: true`, as
the pinned official [response callback][administrator-list] does. Administrator bots subscribed to
`chat_member` receive changes to other members, including additions, removals, promotions,
demotions, bans and unbans.

`getChat` shows a supergroup, or the private chat with an account that has written to the bot, with
the fields and field order of the official server's full [`JsonChat`][json-chat]. As its
[`check_chat_access`][chat-read-access] requires for reading, a bot that is not a member may read a
public supergroup, but not one it was removed from. It shows the newest
[pinned message](pinned-messages.md#pinned-message-in-getchat). Fields for data the emulator does
not model, such as photos, bios and invite links, are omitted. The remaining fields show what a chat
nobody configured further shows:

- `accent_color_id` is TDLib's default [`AccentColorId`][accent-color] of the user or channel ID,
  modulo 7, and `max_reaction_count` is TDLib's default of 11.
- Accounts accept every kind of gift, and supergroups none.
- A supergroup has `has_visible_history`, since new members see earlier messages, and
  `join_to_send_messages`, which TDLib documents as false only for discussion groups.
- A supergroup's `permissions` are its [default permissions](#default-permissions).

### Title and description

Bots change a supergroup's title with `setChatTitle` and its description with `setChatDescription`,
and members through the emulation API, as Telegram's clients do through TDLib's
[`set_dialog_title`][set-title] and [`set_channel_description`][set-description]. A title is cleaned
as TDLib's `clean_name` cleans it: unusual spaces become spaces, each run of spaces and line breaks
becomes one space, and at most 128 characters are kept; one that cleans to nothing fails with
`Bad Request: title must be non-empty`. A description keeps at most 255 characters, and an empty one
removes it. Bots and members then see the change in `getChat` and in the supergroup's messages.

As TDLib's [`apply_restrictions`][apply-restrictions] decides, a bot needs to be an administrator
with `can_change_info`: default permissions never extend to bots. Otherwise the change fails with
`Bad Request: not enough rights to change chat title` or
`Bad Request: not enough rights to set chat description`. Accounts also get `can_change_info` from
the supergroup's default permissions, as far as a [restriction](#member-restrictions) lets them, so
by default any member may change them. A private chat has neither:
`Bad Request: can't change private chat title`, or
`Bad Request: can't change private chat description`.

A new title is recorded as the changer's service message with `new_chat_title`, which, like a
membership service message, every bot of the supergroup receives. As the official server's
[`need_skip_update_message`][skip-update] lets it, that includes a bot that changed the title
itself. Setting the title the supergroup has changes nothing. Telegram's servers refuse the
description the supergroup has, which the official server reports as
`Bad Request: chat description is not modified`, and no service message records a description.

## Member restrictions

What a member may do follows TDLib's [`apply_restrictions`][apply-restrictions], from its standing
and the supergroup's default permissions, by the Bot API's `ChatPermissions` names:

- The owner may do everything.
- An administrator sends anything. It holds each of `can_change_info`, `can_invite_users`,
  `can_pin_messages` and `can_manage_topics` when it holds the administrator right of that name, or,
  if it is an account, when the default permissions grant it.
- Any other member holds the default permissions, as far as its restriction, if any, lets it. A bot
  never gets those four permissions from the default permissions.

The default permissions grant everything until they are [changed](#default-permissions). Both
accounts and bots are refused what they may not send, as TDLib's
[`can_send_message_content`][send-permission] checks each message after reading its content:

| Content                                         | Permission needed                                           | Bot API error, after `Bad Request:`                      |
| ----------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------- |
| Text, including a pressed reply keyboard button | `can_send_messages`                                         | `not enough rights to send text messages to the chat`    |
| Photo                                           | `can_send_photos`                                           | `not enough rights to send photos to the chat`           |
| Document                                        | `can_send_documents`                                        | `not enough rights to send documents to the chat`        |
| Video                                           | `can_send_videos`                                           | `not enough rights to send videos to the chat`           |
| Voice note                                      | `can_send_voice_notes`                                      | `not enough rights to send voice notes to the chat`      |
| Poll                                            | `can_send_polls`                                            | `not enough rights to send polls to the chat`            |
| Contact                                         | `can_send_messages`                                         | `not enough rights to send contacts to the chat`         |
| Location                                        | `can_send_messages`                                         | `not enough rights to send locations to the chat`        |
| Rich message                                    | `can_send_messages`, and each photo's and file's permission | `not enough rights to send the rich message to the chat` |

An album fails for its first item that may not be sent. As TDLib's `edit_message_media` and
`edit_message_text` check new media and rich messages, a bot's edit that puts such content into a
message of the supergroup fails the same way; new text is not checked, nor is an edit addressed by
`inline_message_id`. `forwardMessage` and `copyMessage` report such content as
`Bad Request: the message can't be forwarded` or `Bad Request: the message can't be copied`, as
TDLib's [`forward_message`][forward-message] does once [`forward_messages_impl`][forward-messages]
skips it; `forwardMessages` and `copyMessages` skip it and fail only when nothing is left. An
account's inline query result needs `can_send_other_messages`, as
[`send_inline_query_result_message`][inline-result-permission] requires for using inline bots, and
then the permission of its content. The emulation API answers an account's refused message, album,
forward, button press or inline result with `403`. `can_change_info` decides
[title and description](#title-and-description) changes, and `can_pin_messages` decides
[pins](pinned-messages.md), except that a public supergroup ignores its default permissions for
them, so only the owner and administrators with the right pin there.

The other permissions are stored and shown but enforce nothing, because the emulator lacks what they
govern: `can_send_audios` and `can_send_video_notes` (audio and video notes),
`can_send_other_messages` beyond inline results (stickers, GIFs, games), `can_add_web_page_previews`
(link previews), `can_react_to_messages` (reactions), `can_edit_tag` (member tags),
`can_invite_users` (invitations by members) and `can_manage_topics` (topics).

### Default permissions

An administrator bot with `can_restrict_members` changes what members may do by default with
`setChatPermissions`, which reads `permissions` as [`restrictChatMember`](#restricting-users) does;
as there, a missing object withholds every permission. Bots then see them as `permissions` in
`getChat`. As TDLib's [`set_dialog_permissions`][set-permissions] checks, a bot without the right is
refused, even for the permissions the supergroup has
(`Bad Request: not enough rights to change chat permissions`), and a private chat has none to change
(`Bad Request: can't change private chat permissions`). Setting the default permissions the
supergroup already has succeeds without effect. No service message records the change, and no bot
receives an update for it, as the Bot API has no update for it.

Accounts change them through the emulation API with
`PUT /sessions/{sessionId}/accounts/{accountId}/conversations/supergroup/{chatId}/permissions`, or
the TypeScript client's `setChatPermissions`, as the owner or an administrator with
`can_restrict_members`; the request lists the granted permissions, none implying another.

### Restricting users

An administrator bot with `can_restrict_members` restricts a user with `restrictChatMember`, member
or not, and keeps it the permissions `permissions` grants, as the official server's
[`get_chat_permissions`][read-permissions] reads them:

- A missing object or field grants nothing; `can_manage_topics` and `can_edit_tag` default to
  `can_pin_messages`.
- Without any media field, `can_send_media_messages` grants or withholds every media permission.
- `can_react_to_messages` defaults to `can_send_messages` as granted so far.
- Unless `use_independent_chat_permissions` is true, `can_send_media_messages` also grants
  `can_send_messages`, `can_send_polls` grants `can_send_messages`, and `can_send_other_messages` or
  `can_add_web_page_previews` grants every media permission and `can_send_messages`.

As the emulator is stricter, `can_send_media_messages` must be a boolean even when media fields make
Telegram ignore it.

Granting every permission lifts the restriction: as TDLib's
[`DialogParticipantStatus::Restricted`][restricted-status] decides, such a user is a plain member,
or has left. A restricted member that leaves stays restricted, as TDLib's
[`leave_dialog`][leave-dialog] asks, and joins again restricted, which
[`set_channel_participant_status_impl`][participant-status] relies on when it only adds a user whose
restriction stays as it is. A ban replaces a restriction, and so does a promotion.

Checks follow `set_channel_participant_status_impl` and
[`restrict_channel_participant`][restrict-participant]: a restriction that changes nothing succeeds
without rights; nobody restricts the owner (`Bad Request: can't remove chat owner`); a bot neither
restricts itself (`Bad Request: can't restrict self`) nor lifts its own restriction
(`Bad Request: can't unrestrict self`); granting an administrator every permission makes it a
member, which needs `can_promote_members` (`Bad Request: not enough rights`); otherwise the bot
needs `can_restrict_members`; and, as for a ban, Telegram lets a bot restrict or demote only
administrators it promoted, directly or indirectly
(`Bad Request: user is an administrator of the chat`). A private chat has no members to restrict
(`Bad Request: method is available only in supergroups`). As TDLib's `promote_channel_participant`
allows, an administrator bot that grants itself every permission becomes a member.

No service message records a restriction. A change reaches administrator bots subscribed to
`chat_member`, and a restricted bot subscribed to `my_chat_member`, with its old and new standing;
`getChatMember` shows a `restricted` user with `until_date`, every permission, and `is_member`.

The owner restricts users through the emulation API with
`PUT /sessions/{sessionId}/accounts/{accountId}/conversations/supergroup/{chatId}/restrictions/{userId}`
and lifts a restriction with `DELETE` on the same path, or the TypeScript client's
`restrictChatMember` and `liftChatMemberRestriction`. The request lists the kept permissions, none
implying another, and an optional `until_date`. As Telegram lets an owner do, a restricted
administrator loses its rights and custom title.

### Restriction ends

As TDLib's [`get_dialog_participant_status`][participant-status-input] decides, a restriction
shorter than 30 seconds or longer than 366 days lasts until it is lifted, and `getChatMember` shows
its `until_date` as 0. The emulator never ends a restriction as time passes. A test makes a
temporary restriction's end arrive with
`POST /sessions/{sessionId}/supergroups/{chatId}/restrictions/{userId}/expiry`, or the TypeScript
client's `session.expireChatMemberRestriction`: as TDLib's [`update_restrictions`][ban-expiry]
clears an elapsed restriction, a member becomes a plain member and a non-member has left. No bot
receives an update: TDLib clears the restriction locally, and the public source shows no update
Telegram's servers send for it, which is a [comparison limit](#comparison-limits). A user that is
not restricted, or whose restriction lasts until it is lifted, answers `409`.

## Intentional deviations

**No automatic message deletion.** Message fixtures remain available until explicitly deleted or the
session ends, as described under [messages](messages.md#intentional-deviations).

**Documented routing precedence.** The emulator intentionally prioritizes `via_bot` over a command
addressed to another bot, giving tests a deterministic rule. Public Bot API/TDLib source inspection
does not establish Telegram's ordering, so this is a deliberate emulator contract rather than a
confirmed difference from Telegram.

**Unqualified commands before any bot writes.** Telegram's documentation names no recipient for an
unqualified command in a group where no bot has sent a message yet, and its servers decide it, not
the public Bot API or TDLib source. The emulator delivers such a command to every privacy-enabled
bot, so a test of a newly added bot receives `/start` without first making the bot speak.

**Explicit ban and restriction removal.** Membership changes remain under explicit test control.
`until_date` is normalized using the less-than-30-seconds / more-than-366-days permanent rule, but a
ban or restriction remains in effect after its date passes. TDLib also normalizes the date and later
clears elapsed restrictions in [`DialogParticipantStatus::update_restrictions`][ban-expiry]. Tests
end a temporary restriction with its [expiry route](#restriction-ends); bans have none.

**Strict permission parameters.** `restrictChatMember` and `setChatPermissions` refuse a
`permissions` field that Telegram does not know, and the deprecated permissions given as separate
parameters, such as `can_send_messages`, which the official server ignores or still reads; refusing
them surfaces the bot's mistake in tests.

**Explicit permissions in the emulation API.** Its restrictions and default permissions grant
exactly the listed permissions, without the Bot API's implications, so that tests state each
permission they rely on.

**An owner remains in the chat.** The owner cannot leave, retaining a member who can administer test
fixtures. TDLib's [creator status transitions][owner-leave] support an owner who is no longer a
member.

**No slow-mode pacing.** Slow mode is unsupported because tests should not wait for production
message pacing.

**Complete membership view.** Within the supported chat-access checks, membership queries use the
complete session state so tests have a complete membership view. Hidden member lists and Telegram's
remote access/cache restrictions are not modeled. A successful emulated query does not establish all
production read permissions.

## Real gaps

- **Single recipient for mentions.** Mention matching can deliver one message to several
  privacy-enabled bots. Telegram's [Bot FAQ][privacy-faq] describes at most one such recipient and
  gives replies highest priority. Tests need single-recipient routing; the FAQ does not specify
  every tie-break, so the exact selection among competing mentions requires further verification.
- **Bot-to-bot communication.** Telegram delivers a bot's group message to another bot that enabled
  Bot-to-Bot Communication Mode in BotFather when it is a command addressed to that bot or a reply
  to one of its messages, and every bot message to such a bot that is an administrator with privacy
  mode disabled. Bots have no such setting in the emulator, which never delivers messages of bots to
  other bots. Tests of cooperating bots need the setting and its routing. Telegram's servers apply
  these rules; the Bot API and TDLib source at the comparison baseline show no trace of the setting.

- **Administrator rights enforcement.** Rights that the
  [administrator operations](#administrator-operations) table does not list, such as
  `can_manage_video_chats` and the story rights, are stored without corresponding enforcement. Tests
  need their behavioral effects as the associated features are supported.

- **Restrictions by administrator accounts.** Only the owner restricts users through the emulation
  API; an administrator account with `can_restrict_members` cannot.
- **Promotions by administrator accounts.** Only the owner promotes and demotes through the
  emulation API; an administrator account with `can_promote_members` cannot.
- **Anonymous administrators.** Anonymous administration and its message attribution are absent.
- **The invite link lifecycle.** [Invite links](invite-links.md#real-gaps) cannot be edited, revoked
  or exported.
- **Additional service messages.** Only membership, title and [pin](pinned-messages.md) service
  messages are produced. Other service events, such as photo changes, need corresponding messages as
  their features are supported.

- **Basic groups and channels.** Internal representations exist, but there is no usable HTTP
  messaging workflow for these chat kinds. See the
  [feature inventory](README.md#unimplemented-areas).

- **Topics.** Forum topics and channel direct-message topics are unsupported.
- **Chat migration.** Basic-group-to-supergroup migration and its API effects are unsupported.

## Comparison limits

TDLib passes restrictions to Telegram's servers, whose checks and updates the open-source code does
not show. The emulator chooses where they are not visible:

- No bot receives an update when a restriction ends by itself.
- A restricted user that the owner adds again keeps its restriction, as
  `set_channel_participant_status_impl` expects when it only adds such a user.
- A bot's promotion of a user that is not a member fails with `USER_NOT_MUTUAL_CONTACT`, or
  `USER_KICKED` for a banned one, the errors `channels.editAdmin` documents for these users;
  Telegram may add a user an administrator promotes, which the emulator does not support. The
  servers' order of their checks is not public; the emulator checks the membership first, then
  whether the bot may edit an administrator, then the rights it grants.
- A bot acts on an administrator it promoted indirectly, through administrators it promoted, as the
  Bot API documents for `can_promote_members`; bans and restrictions follow the same chain.
- Demoting a user that is not a member fails without effect, where TDLib may first lift its ban.
- Telegram's servers' definition of an emoji in a title is not public: the emulator refuses
  pictographs, flag letters, skin tone modifiers and the keycap mark, and checks a title's length
  before its emoji.
- An administrator bot that grants itself every permission becomes a member, as TDLib asks the
  servers to make it.
- Whoever sets an administrator's rights becomes its `promoted_by`, and setting the rights it holds
  changes nothing, as TDLib skips such a change. The chain of promoters that decides `can_be_edited`
  counts a promotion only while the promoter's administrator tenure that made it lasts: a promoter
  that is demoted or leaves no longer stands above the administrators it promoted, which only the
  owner then edits, even after the promoter is promoted again. `promoted_by` is all Telegram exposes
  of a promotion; tying it to the tenure keeps a promoter that its old appointee promotes back from
  editing that appointee, which would let two administrators edit each other.

## Local evidence

[Administration service](../../src/services/shared_chat_administration.ts),
[permission evaluator and administrator delegation](../../src/types/chat_membership.ts),
[permissions parameter](../../src/api/sessions/bot_api/chat_permissions_parameter.ts),
[restriction tests](../../tests/chat_member_restriction_api_test.ts),
[delegation tests](../../tests/administrator_delegation_test.ts),
[promotion tests](../../tests/chat_administrator_promotion_api_test.ts),
[default permission tests](../../tests/chat_default_permissions_api_test.ts),
[permission tests](../../tests/chat_permissions_test.ts),
[privacy filtering](../../src/services/bot_update_delivery.ts),
[administration tests](../../tests/shared_chat_administration_service_test.ts),
[delivery tests](../../tests/bot_update_delivery_service_test.ts) and
[supergroup messaging tests](../../tests/supergroup_messaging_service_test.ts).

[privacy-faq]: https://core.telegram.org/bots/faq#what-messages-will-my-bot-get
[json-chat]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L1554-L1847
[chat-read-access]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L8796-L8866
[accent-color]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/AccentColorId.h#L32-L39
[bot-to-bot]: https://core.telegram.org/api/bots/bot-to-bot
[mention-matching]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessageEntity.cpp#L267-L310
[protected-content]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessagesManager.cpp#L8145-L8148
[protection-toggle]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/DialogManager.cpp#L2721-L2745
[chat-member-json]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L5802-L5872
[custom-title-method]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L16451-L16482
[participant-checks]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/DialogParticipantManager.cpp#L2820-L3065
[administrator-list]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L7925-L7995
[participant-admin]: https://core.telegram.org/constructor/channelParticipantAdmin
[rank-strip]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/DialogParticipant.cpp#L389-L390
[rank-errors]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L154-L162
[desktop-title-emoji]: https://github.com/telegramdesktop/tdesktop/blob/d8594c011756265de4385408540bd9f7c787a003/Telegram/SourceFiles/boxes/peers/edit_tag_control.cpp#L378-L386
[member-tags]: https://core.telegram.org/api/rank
[promote-method]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L16397-L16449
[administrator-rights]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/DialogParticipant.cpp#L69-L115
[edit-admin]: https://core.telegram.org/method/channels.editAdmin
[add-participant]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/DialogParticipantManager.cpp#L2670-L2676
[promote-participant]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/DialogParticipantManager.cpp#L2937-L2965
[ban-expiry]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/DialogParticipant.cpp#L595-L715
[ban-member]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/DialogParticipantManager.cpp#L2385-L2413
[owner-leave]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/DialogParticipantManager.cpp#L2860-L2890
[set-title]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/DialogManager.cpp#L2341-L2383
[set-description]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/ChatManager.cpp#L3678-L3689
[apply-restrictions]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/DialogParticipant.cpp#L558-L591
[send-permission]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessageContent.cpp#L6207-L6481
[forward-message]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessagesManager.cpp#L24477-L24495
[forward-messages]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessagesManager.cpp#L24700-L24742
[inline-result-permission]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessagesManager.cpp#L23025-L23063
[read-permissions]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L12536-L12673
[set-permissions]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/DialogManager.cpp#L2648-L2694
[restricted-status]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/DialogParticipant.cpp#L426-L435
[leave-dialog]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/DialogParticipantManager.cpp#L2414-L2439
[participant-status]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/DialogParticipantManager.cpp#L2844-L2965
[restrict-participant]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/DialogParticipantManager.cpp#L2967-L3090
[participant-status-input]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/DialogParticipant.cpp#L676-L720
[skip-update]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L18833-L18878
