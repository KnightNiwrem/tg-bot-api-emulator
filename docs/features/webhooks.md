# Webhooks

[Feature index and comparison baseline](README.md) · [Update queues and polling](updates.md)

## Supported behavior

`setWebhook` registers or replaces a bot's webhook. The emulator posts updates as JSON and adds
`X-Telegram-Bot-Api-Secret-Token` when `secret_token` is set. URL credentials become HTTP Basic
authorization. Redirects are treated as delivery failures. A 2xx response confirms the update once
its whole body has arrived. Other statuses, connection failures and responses whose body fails or
misses the attempt deadline leave it pending for another attempt. As in
[`WebhookActor::handle`][webhook-response], a connection that closes mid-response is not reported as
a delivery error. The first retry is immediate, and later ones back off as described under
[intentional deviations](#intentional-deviations). A failed response's `Retry-After` header, in
whole seconds, sets the wait before the next attempt instead, up to one hour, as in
[`WebhookActor::on_update_error`][webhook-retry].

Updates wait in queues, as in the official server's [`WebhookActor`][webhook-queues]: messages and
their edits by chat, inline queries, chosen inline results and callback queries by the sending user,
`poll` and `poll_answer` updates by poll, `my_chat_member` or `chat_member` updates by chat or by
member, and `chat_join_request` updates by requester. The queue for each update is chosen by the
[`Client::add_update`][webhook-queue-ids] calls, and for messages in
[`process_new_message_queue`][message-queue-id]. Each queue sends one update at a time, in order,
and moves on only once that update is confirmed. Up to `max_connections` queues send at once, so a
failing update holds back only the later updates of its queue. Updates are therefore confirmed
individually, as [`TQueue::forget`][webhook-forget] does, and a bot that switches to `getUpdates`
receives the rest. The official server also opens connections gradually under flood control, which
the emulator does not reproduce.

`deleteWebhook`, or `setWebhook` with an empty URL, removes the registration. Both support
`drop_pending_updates`. `setWebhook` also accepts `allowed_updates`. `getWebhookInfo` reports the
URL, pending count, configured maximum connections, non-default subscription and most recent
delivery error. Ending a session aborts its webhook requests.

A webhook can answer with a Bot API method call in a JSON, URL-encoded or multipart 2xx response.
The emulator executes its `method` using the receiving bot's identity and discards the result.
Methods starting with `get`, plus `setWebhook`, `deleteWebhook`, `close` and `logOut`, are excluded,
following [`WebhookActor::handle`][webhook-response]. A failed or unimplemented method does not make
the delivered update pending again. This supports framework webhook replies, including those used by
grammY and Telegraf.

## Delivery controls

These are emulator test controls, not Telegram features. They let a test drive a real webhook
through failure, timeout and recovery without waiting for the backoff or the attempt deadline. They
do not reproduce Telegram's wall-clock scheduling; delivery itself, including queue order,
`Retry-After` handling, the backoff sequence and the descriptions `getWebhookInfo` reports, stays as
described above.

Each request that delivers an update is an attempt with an `id` that is unique in the session.
`GET /sessions/{sessionId}/bots/{botId}/webhook-attempts` lists a bot's attempts with their
`status`: `in_flight`, `accepted`, `failed`, or `cancelled` when the webhook was replaced or deleted
or the session ended before an outcome, which leaves the update pending. A failed attempt shows its
`failure` and its `retry`: the `delay_seconds` Telegram's backoff or the webhook's `Retry-After`
sets, and whether the retry is `waiting`, `released` or `cancelled`. The
[bot activity log](bot-activity.md#entries) records each attempt's delivery and confirmation with
its `webhook_attempt_id`, and each failure as a `webhook_attempt_failed` entry, so a test waits for
an outcome there.

`PUT /sessions/{sessionId}/bots/{botId}/webhook-delivery` with `{"scheduling":"manual"}` makes the
emulator end nothing by itself for that bot: an attempt waits for the webhook's answer without a
deadline, and a failed update waits for the test to release its retry, even the immediate first
retry. `automatic`, the default, restores the emulator's own timing for attempts that begin
afterward; an attempt and its retry keep the scheduling they began with. Two controls act on one
attempt of one bot, under either scheduling:

- `POST .../webhook-attempts/{webhookAttemptId}/retry-release` sends a failed attempt's update again
  at once. Later updates of its queue still wait behind it, and other queues are unaffected.
- `POST .../webhook-attempts/{webhookAttemptId}/expiry` makes the deadline of an attempt in flight
  arrive. The request is aborted and the attempt fails as `timed_out` with `Read timeout expired`,
  as its timeout passing would. An attempt whose webhook has already answered completely is still
  accepted.

Each control applies once: releasing a retry that is not waiting, or expiring an attempt that is no
longer in flight, is refused with `409`, so a repeated or concurrent control cannot send an update
twice or record a second outcome. An attempt of another bot or session is not found. Replacing or
deleting the webhook, or ending the session, cancels the bot's attempt in flight and its waiting
retry, along with their timers and requests. The TypeScript client's
[test controls](../clients/typescript/test-controls.md#webhook-delivery-controls) show a webhook
that fails twice and recovers.

## Intentional deviations

- **Local webhook servers.** HTTP and HTTPS are accepted on arbitrary ports, including localhost, so
  tests can use local servers. The official cloud service requires HTTPS on ports 80, 88, 443 or
  8443 and disallows reserved/non-IPv4 addresses; its `--local` mode relaxes these restrictions. See
  [upstream setup and address checks][webhook-network].
- **Total attempt deadline.** Each delivery attempt has a 60-second total deadline. Telegram uses a
  60-second connection read inactivity timeout, which can allow a longer attempt while data keeps
  arriving. The simpler deadline is retained because matching that distinction has no demonstrated
  testing value yet. See [TDLib's HTTP connection implementation][http-connection]. Tests can also
  end an attempt, or a retry wait, themselves through the [delivery controls](#delivery-controls).
- **Disposable configuration and retained updates.** Webhook configuration ends with the session and
  is not persisted across process restarts, keeping tests isolated. Unconfirmed updates do not
  expire, preserving events for test assertions. See
  [sessions](sessions-and-requests.md#intentional-deviations) and
  [update queues](updates.md#intentional-deviations).
- **No production rate thresholds.** Repeated `setWebhook` calls are not automatically throttled.
  Tests control rate-limit scenarios by
  [queuing rate limit answers](sessions-and-requests.md#rate-limit-answers). Upstream throttles
  registration in [`Client::process_set_webhook_query`][webhook-throttle].
- **Registration before server startup.** `setWebhook` validates URL/token syntax and returns
  without verifying DNS or connectivity, allowing tests to register before starting their webhook
  server. Upstream [resolves and verifies the connection during setup][webhook-network]. A
  successful emulated registration therefore does not establish that Telegram's cloud service could
  connect to the URL.
- **Atomic rejection of invalid replacements.** A rejected webhook configuration leaves the existing
  registration and queued updates intact, preventing invalid test setup from discarding state. In
  [`Client::do_set_webhook`][set-webhook], some URL/token validation happens after removing the
  previous webhook and dropping updates.
- **Fixed retry cap.** A failed update is retried at once, then after 2, 4, 8, … seconds, capped at
  60 seconds. Upstream draws the cap at random between 60 and 120 seconds for each retry; see
  [retry calculation][webhook-retry]. The fixed cap keeps retry timing reproducible in tests, and a
  test reaches it only after about a minute of consecutive failures.
- **No removal after sustained HTTP 410.** Failed deliveries keep retrying until the webhook is
  deleted or replaced or the session ends. Upstream closes the webhook once HTTP 410 responses have
  continued for [23 hours][webhook-drop-timeout]; see [response handling][webhook-response]. Test
  sessions do not run that long, so the rule could not be exercised.
- **Cloud `max_connections` range.** `max_connections` defaults to 40 and is clamped to 1–100, as in
  cloud mode. The official [limit][max-connections] rises to 100,000 in local mode, which tests do
  not need.
- **No fixed webhook addresses.** Tests register webhook servers of their own environment, which the
  emulator reaches through the URL's host as the platform resolves it. Upstream accepts `ip_address`
  in [`Client::do_set_webhook`][set-webhook] and connects to that address instead of resolving the
  host during [connection setup][webhook-network]; [`getWebhookInfo`][webhook-info] reports the
  fixed or resolved address. The address only chooses where Telegram's servers connect and has no
  effect on the bot. The emulator refuses `ip_address` with
  `Bad Request: webhook IP addresses are not supported` rather than accepting it without effect, so
  a test cannot appear to exercise it, and `getWebhookInfo` omits `ip_address`.
- **No custom certificate uploads.** Local HTTP or trusted TLS is sufficient for webhook tests, so
  `setWebhook` does not accept custom certificates and `getWebhookInfo` always reports
  `has_custom_certificate: false`. Upstream accepts certificate uploads in
  [`Client::do_set_webhook`][set-webhook].

There is no Telegram synchronization error state because sessions have no Telegram connection.

## Local evidence

[Webhook service](../../src/services/bot_webhook.ts),
[response method dispatcher](../../src/api/sessions/bot_api/webhook_reply.ts),
[attempt scheduler](../../src/services/webhook_attempt_scheduler.ts),
[webhook tests](../../tests/bot_webhook_service_test.ts),
[delivery control tests](../../tests/webhook_attempt_scheduler_test.ts),
[HTTP tests](../../tests/emulation_api_test.ts) and
[local webhook control tests](../../clients/typescript/webhook_delivery_client_test.ts).

[webhook-response]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/WebhookActor.cpp#L608-L680
[webhook-network]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/WebhookActor.cpp#L685-L790
[webhook-queues]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/WebhookActor.cpp#L400-L600
[webhook-queue-ids]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L18383-L18716
[message-queue-id]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L19351-L19412
[webhook-forget]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/WebhookActor.cpp#L457-L491
[webhook-retry]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/WebhookActor.cpp#L493-L520
[webhook-drop-timeout]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/WebhookActor.h#L75-L76
[max-connections]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L17215-L17225
[webhook-info]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L6641-L6643
[set-webhook]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L17227-L17340
[http-connection]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/tdnet/td/net/HttpConnectionBase.cpp#L39-L154
[webhook-throttle]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L16952-L16985
