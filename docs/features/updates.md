# Updates and polling

[Feature index and comparison baseline](README.md) · [Webhook delivery](webhooks.md)

## Supported behavior

The emulator generates `message`, `edited_message`, `callback_query`, `inline_query`,
`chosen_inline_result`, `poll`, `poll_answer`, `my_chat_member`, `chat_member`, `chat_join_request`,
`message_reaction` and [`stopped_message_generation`](messages.md#message-drafts) updates. Only the
bot that sent a poll receives its [`poll` and `poll_answer` updates](polls.md#poll-updates).
`chat_member` and [`message_reaction`](reactions.md#reaction-updates) require the observing bot to
be a supergroup administrator and explicitly subscribe to them, and
[`chat_join_request`](invite-links.md#join-requests) requires the observing bot to be an
administrator with `can_invite_users`. Inline feedback also requires the bot's
`receives_chosen_inline_results` creation setting.

`getUpdates` supports `offset`, `limit` (1–100, default 100), `timeout` (0–50 seconds, default 0),
and `allowed_updates`. A positive offset confirms earlier updates; reading without advancing the
offset can return them again. A negative offset keeps the requested number of updates from the tail
and forgets earlier ones. An offset more than ten beyond the next update ID is ignored, following
the official [`TQueue::get`][queue-get] and [`Client::do_get_updates`][get-updates] fallback.

The subscription applies when updates are created, so changing it does not remove already queued
updates. Omitting `allowed_updates` keeps the previous subscription. Names are matched without case;
unknown names are ignored, and a list with no recognized names restores the default subscription.
The default excludes `chat_member`, `message_reaction` and `message_reaction_count`. Recognizing a
subscription name does not mean the emulator generates that update type. The official parser works
the same way in [`Client::get_allowed_update_types`][allowed-updates].

A bot has at most one waiting long poll. A newer request that must wait ends the earlier one with
`409 Conflict: terminated by other getUpdates request; make sure that only one bot instance is
running`.
A request answered immediately does not displace a waiting poll. Setting a webhook ends a waiting
poll with a conflict, and polling while a webhook is active also fails with `409`. Ending a session
releases waiting polls without updates. Together with `getMe` and `deleteWebhook`, these methods
support grammY's `bot.start()` and `bot.stop()` lifecycle.

## Intentional deviations

- **No update expiry.** Updates remain pending until confirmed, dropped, or the session ends. Tests
  retain every unconfirmed event for inspection, without elapsed time removing evidence. Upstream
  gives message updates a remaining lifetime based on their message/edit date plus one day; `TQueue`
  removes expired events. Some other update types have shorter lifetimes, so "all updates live for
  24 hours" would also be inaccurate. See [`Client::add_message_update`][message-expiry] and
  [`TQueue` expiry handling][queue-expiry].
- **Predictable IDs.** Each bot starts at `update_id: 1` and increments. Upstream's
  [`TQueue::push`][queue-push] can initialize a queue with a randomized ID. Do not hard-code the
  emulator's starting value in production bot logic. Predictable sequences simplify test fixtures
  and assertions.
- **No polling throttling.** The emulator honors an immediate poll as immediate. Upstream's
  [`process_get_updates_query`][poll-throttle] can increase repeated short polls to a three-second
  wait and reduce the limit to one for rapid requests with the same offset. Its conflict responses
  also have [timing controls][poll-conflict]. Omitting this production pacing keeps tests fast.
- **No durable delivery queue.** Process restarts lose pending updates and settings. Upstream uses
  `TQueue` with persistence; the emulator has no recovery or replay facility across sessions.
  Disposable sessions intentionally prevent state from leaking between tests.

## Real gaps

Channel posts, reaction counts (`message_reaction_count`), business, payment, boost and other
unsupported features cannot be exercised by subscribing to their names. Their coverage follows the
corresponding [feature gaps](README.md#unimplemented-areas).

[Supergroup privacy filtering](supergroups.md#real-gaps) has separate gaps.
[Callback expiry](keyboards-and-callbacks.md#intentional-deviations) and
[strict request validation](sessions-and-requests.md#strict-request-validation) are intentional
differences.

## Local evidence

[Polling service](../../src/services/bot_update_polling.ts),
[queue](../../src/repositories/bot_update.ts),
[delivery/subscription filtering](../../src/services/bot_update_delivery.ts),
[polling tests](../../tests/bot_update_polling_service_test.ts) and
[queue tests](../../tests/bot_update_repository_test.ts).

[queue-get]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/tddb/td/db/TQueue.cpp#L285-L310
[get-updates]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L17588-L17630
[allowed-updates]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L18310-L18364
[message-expiry]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L18444-L18479
[queue-expiry]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/tddb/td/db/TQueue.cpp#L320-L350
[queue-push]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/tddb/td/db/TQueue.cpp#L137-L184
[poll-throttle]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L16926-L16949
[poll-conflict]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L17493-L17518
