# Feature coverage and compatibility

[Project README](../../README.md) · [TypeScript client guide](../clients/typescript/README.md)

These pages describe the standalone HTTP server. A supported method implements the behavior and
parameters described on its feature page; it does not imply support for every Telegram option.
Internal types for additional chat kinds do not make those kinds available through HTTP.

## Intentional deviations and real gaps

**Intentional deviations** are differences retained for the emulator's testing purpose. Their
documented reasons explain which behavior tests should expect instead of Telegram's behavior.

**Real gaps** are missing or incorrect behavior the emulator should support. Listing a gap does not
make the behavior available or establish an implementation schedule.

An area can contain both. For example, sessions intentionally omit Telegram's production traffic
thresholds, which tests replace with
[queued rate limit answers](sessions-and-requests.md#rate-limit-answers), while changing
[BotFather-style settings](sessions-and-requests.md#real-gaps) after creation is a real gap.

## Feature guide

| Feature                                               | Coverage                                                                    |
| ----------------------------------------------------- | --------------------------------------------------------------------------- |
| [Sessions and requests](sessions-and-requests.md)     | Test isolation, virtual identities, request formats, validation and errors  |
| [Bot activity](bot-activity.md)                       | Recorded calls and updates, waiting for them and asserting their order      |
| [Updates and polling](updates.md)                     | Generated update types, subscriptions, offsets, long polling and retention  |
| [Webhooks](webhooks.md)                               | Delivery, replies, retry behavior, delivery controls and connection limits  |
| [Messages](messages.md)                               | Sending, drafts, replies, edits, deletion, blocking, forwarding and copying |
| [Text formatting](text-formatting.md)                 | Parse modes, entities, normalization and limits                             |
| [Rich messages](rich-messages.md)                     | Blocks, rich text, buttons, media and edits of rich messages                |
| [Polls](polls.md)                                     | Polls, quizzes, votes, stopping, closing times, updates, forwards, copies   |
| [Contacts and locations](contacts-and-locations.md)   | Contacts, static locations, requests, forwards, copies, replies             |
| [Pinned messages](pinned-messages.md)                 | Multiple pins per chat, pinning rights, service messages and `getChat`      |
| [Reactions](reactions.md)                             | Emoji reactions in supergroups, `message_reaction` updates, albums          |
| [Keyboards and callbacks](keyboards-and-callbacks.md) | Inline buttons, reply interfaces and callback answers                       |
| [Media and files](media-and-files.md)                 | Photos, documents, videos, voice notes, audio, albums, file IDs, downloads  |
| [Inline mode](inline-mode.md)                         | Queries, results, feedback and inline message editing                       |
| [Supergroups](supergroups.md)                         | Privacy mode, membership, restrictions, service messages and administration |
| [Invite links](invite-links.md)                       | Bots' invite links, edits, revocation, expiry, joining, join requests       |
| [Command menus](command-menus.md)                     | Commands, menu buttons, descriptions and default administrator rights       |

## Implemented Bot API methods

This is the complete inventory from the
[method catalogue](../../src/api/sessions/bot_api/method_catalogue.ts). Method names are
case-insensitive. The two legacy aliases below are also accepted.

| Area             | Methods                                                                                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity         | `getMe`                                                                                                                                                                                     |
| Updates          | `getUpdates`, `setWebhook`, `deleteWebhook`, `getWebhookInfo`                                                                                                                               |
| Sending          | `sendMessage`, `sendRichMessage`, `sendPhoto`, `sendDocument`, `sendVideo`, `sendVoice`, `sendAudio`, `sendMediaGroup`, `sendContact`, `sendLocation`, `sendChatAction`, `sendMessageDraft` |
| Reusing messages | `forwardMessage`, `forwardMessages`, `copyMessage`, `copyMessages`                                                                                                                          |
| Editing          | `editMessageText`, `editMessageCaption`, `editMessageMedia`, `editMessageReplyMarkup`                                                                                                       |
| Deletion         | `deleteMessage`, `deleteMessages`                                                                                                                                                           |
| Pins             | `pinChatMessage`, `unpinChatMessage`, `unpinAllChatMessages`                                                                                                                                |
| Reactions        | `setMessageReaction`                                                                                                                                                                        |
| Files            | `getFile`, plus HTTP file downloads                                                                                                                                                         |
| Interaction      | `answerCallbackQuery`, `answerInlineQuery`                                                                                                                                                  |
| Polls            | `sendPoll`, `stopPoll`                                                                                                                                                                      |
| Commands         | `setMyCommands`, `getMyCommands`, `deleteMyCommands`                                                                                                                                        |
| Bot profile      | `setMyDescription`, `getMyDescription`, `setMyShortDescription`, `getMyShortDescription`                                                                                                    |
| Bot settings     | `setChatMenuButton`, `getChatMenuButton`, `setMyDefaultAdministratorRights`, `getMyDefaultAdministratorRights`                                                                              |
| Chat information | `getChat`                                                                                                                                                                                   |
| Chat settings    | `setChatTitle`, `setChatDescription`, `setChatPermissions`                                                                                                                                  |
| Membership       | `leaveChat`, `getChatMember`, `getChatAdministrators`, `getChatMemberCount`, `banChatMember`, `unbanChatMember`, `restrictChatMember`, `setChatAdministratorCustomTitle`                    |
| Administration   | `promoteChatMember`                                                                                                                                                                         |
| Invitations      | `exportChatInviteLink`, `createChatInviteLink`, `editChatInviteLink`, `revokeChatInviteLink`, `approveChatJoinRequest`, `declineChatJoinRequest`                                            |
| Legacy aliases   | `getChatMembersCount` → `getChatMemberCount`, `kickChatMember` → `banChatMember`                                                                                                            |

Methods outside this inventory return `404` with a Bot API error body. For supported methods,
unknown parameters usually produce `400`, including parameters that the official method supports but
the emulator has not implemented.

## Unimplemented areas

### Real gaps

The official [method registry][upstream-methods] includes these broader areas absent from the
emulator. They are real gaps in the intended testing coverage. This list groups them; the inventory
above determines whether an individual method is available.

- Basic groups, channels, forum topics, direct messages of channels, and chat migration. Supergroups
  are the only shared chat kind exposed by the HTTP server.
- Media other than photos, documents, videos, voice notes and audio files, stickers and sticker
  sets, dice, live locations, venues, games, checklists, ephemeral messages and stories. Drafts lack
  [topics](messages.md#real-gaps), rich messages lack
  [drafts and some blocks](rich-messages.md#real-gaps), and polls lack
  [Telegram's newest poll options](polls.md#real-gaps).
- [Reactions outside supergroups, custom emoji and paid reactions, and removing other members'
  reactions](reactions.md#real-gaps), [unpinning all messages](pinned-messages.md#real-gaps), chat
  photos and other chat settings, and [subscription invite links](invite-links.md#real-gaps).
- Payments, invoices, shipping, Telegram Stars, gifts, paid broadcasts and paid media.
- Business connections, managed bots, Mini Apps other than the data a
  [keyboard button's Web App sends](keyboards-and-callbacks.md#sending-web-app-data), login
  authorization, Passport and boosts.
- Other bot profile methods, such as names and profile photos, plus `getUserProfilePhotos`.

### Intentional exclusions

`close` and `logOut` are intentionally unsupported:
[session teardown](sessions-and-requests.md#intentional-deviations) is sufficient for emulator
lifecycle control.

Other intentional choices include
[in-memory sessions and strict request validation](sessions-and-requests.md#intentional-deviations),
[retaining unconfirmed updates](updates.md#intentional-deviations), and omitting production rate
thresholds in favor of [queued rate limit answers](sessions-and-requests.md#rate-limit-answers), and
failing calls with server errors only as
[queued server error answers](sessions-and-requests.md#server-error-answers). The feature pages
explain their testing rationale and distinguish them from
[missing functionality](sessions-and-requests.md#real-gaps).

## Comparison baseline and evidence

The implementation comparison was reviewed on **2026-09-25** against:

- Official C++ Bot API server at [`e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1`][bot-api-revision]
  (2026-08-25).
- TDLib at [`bc9c263e2bfee06aaab41e82db51a103376030bc`][tdlib-revision], the
  [submodule revision used by that Bot API server][tdlib-submodule].

Upstream implementation links on these pages use these immutable revisions and name the relevant
functions. Local implementation and test links point into this repository. Telegram's public API
reference and FAQ supplement the code where they describe server-side behavior.

This is a source comparison, not a claim of complete conformance or a live differential test against
Telegram. The open-source Bot API server delegates work to TDLib, which in turn calls Telegram's
remote servers. Their code can establish parsing, local checks and serialization, but does not
expose every remote validation rule, privacy decision or media transformation. Where that boundary
matters, the feature page identifies the limitation rather than treating a local check as proof of
parity.

Unless a page says otherwise, cloud restrictions refer to the official server without `--local`. The
official [local mode][local-mode] relaxes webhook and file restrictions. The emulator has its own
combination of constraints and is not an implementation of either deployment mode in full; a
session's [upload profile](media-and-files.md#upload-profiles) chooses between the two modes' upload
limits only.

[upstream-methods]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L200-L410
[bot-api-revision]: https://github.com/tdlib/telegram-bot-api/commit/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1
[tdlib-revision]: https://github.com/tdlib/td/commit/bc9c263e2bfee06aaab41e82db51a103376030bc
[tdlib-submodule]: https://github.com/tdlib/telegram-bot-api/tree/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/td
[local-mode]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/README.md#usage
