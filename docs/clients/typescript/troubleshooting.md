# Troubleshooting

[Guide index](README.md) · [API index](api-index.md)

Common failures of tests written with the TypeScript client, what they mean, and how to find the
cause.

## The test cannot reach the emulator

`createSession` rejects with an `EmulationClientError` such as
`POST http://localhost:8081/sessions failed`, whose `cause` is the network error. The emulator is
not running, or runs at another address. Start it with `deno task start` from the repository root,
and check that the URL given to `TelegramEmulationClient` matches the `DOMAIN` and `PORT` it was
started with.

## Deno asks for permissions

- `Requires net access`: run the test with `--allow-net`.
- `Requires env access`: grammY's npm package reads environment variables when it loads; add
  `--allow-env`.

## A wait times out

`waitFor` rejects with a `BotActivityTimeoutError` when no entry matches before its timeout. The
error names the filter and the position the wait started after. The usual causes are:

- **The bot is not polling the session.** Its API root must be `session.botApiRoot` and its token
  the one `createBot` returned in the same session. A bot that calls Telegram itself never shows up
  in the log.
- **The bot failed.** A handler that throws stops a grammY bot that has no error handler; the
  [fixture](sessions-and-fixtures.md#a-reusable-fixture) reports that error when the test ends. A
  call Telegram would refuse is recorded with `ok: false`, so a wait for `ok: true` does not match
  it: wait for the same call with `ok: false` to see its `answer.description`.
- **The criteria do not describe the call the bot made.** Parameters are compared exactly, as the
  text the bot sent: a different text, an extra field in `reply_parameters`, or a `parse_mode` the
  test did not expect each prevent a match. Loosen the criteria to the method and chat, and inspect
  the entry the wait then finds.
- **The position was taken too late.** A position taken after the account acted can already be past
  the bot's call. Take it immediately before the action that triggers the call.
- **The bot is slow.** A bot that legitimately needs more than 5 seconds needs a longer `timeoutMs`,
  on the wait or on the activity view.

To see everything the bot did, read the session's log directly while the test is paused or before it
ends, for example with `curl`:

```sh
curl 'http://localhost:8081/sessions/<session.id>/bot-activity?after=0&wait_ms=0'
```

The [bot activity reference](../../features/bot-activity.md#reading-the-log) lists the filters this
read takes.

## The bot's calls fail

A failed call is recorded with its answer, as Telegram would send it:

- `404 Not Found: method not found`: the emulator does not implement the method. The
  [feature reference](../../features/README.md#implemented-bot-api-methods) lists the methods it
  implements.
- `400 Bad Request: invalid <method> parameters`: the call sent a parameter the emulator does not
  support, or a value it does not accept. The emulator validates strictly, as the
  [sessions reference](../../features/sessions-and-requests.md#strict-request-validation) describes,
  and each feature page lists the parameters its methods take.
- `400 Bad Request: chat not found`: the bot wrote to an account that has never written to it.
  Telegram lets a bot write to a user only after the user has started a chat with it, so the account
  sends the bot a message first. A bot that received the account's pending join request may also
  send it messages until the request is decided or its contact window ends; see
  [Invite links](invite-links.md#prompting-requesters-before-a-decision).
- `403 Forbidden: bot was blocked by the user`: the account blocked the bot. See
  [Messages](messages.md).
- `429 Too Many Requests`: the test queued rate limit answers for the bot. See
  [Test controls](test-controls.md).
- `500 Internal Server Error` or `503 Service Unavailable`: the test queued server error answers for
  the bot. See [Test controls](test-controls.md#server-error-answers).

## An account's action is refused

The account's operation rejects with an `EmulationClientError` whose `status` gives the reason:

- `404`: the session has ended, or the chat, message or user the input names does not exist in it.
  Using a session after `session.end()` is the usual cause.
- `409`: the action is not allowed in the current state, such as writing to a bot the account has
  blocked, or voting again in a poll that does not allow it.
- `400`: the input is malformed, such as a username Telegram's syntax does not allow.

Each operation's documentation comment states when it fails, and the
[OpenAPI description](../../../openapi/openapi.yaml) lists every status of every route.

## The wrong message is selected

A test that picks the chat's latest message, or the first message with some text, can pick the
account's own message, an earlier reply, or another participant's message. Wait for the bot's call
first, then select the message by its sender and by what ties it to the scenario, such as the
message it replies to.
[Observing bot behavior](observing-bot-behavior.md#selecting-the-resulting-message) explains the
pattern.

## A button cannot be pressed

`pressButton` rejects with a `ButtonSelectionError` when its selector matches no button or more than
one, or when the button it matches is not a callback button. The error lists the candidates. Narrow
a repeated label with `within`, or select with a predicate, as
[Buttons and menus](buttons-and-menus.md) shows.

## `assertNone` fails

`assertNone` rejects with an `UnexpectedBotActivityError` that lists the entries it found. Either
the bot did what the test says it must not, or the range ends at a fence that does not come after
the work in question, so work the test meant to exclude falls inside it.
[Observing bot behavior](observing-bot-behavior.md#asserting-that-something-did-not-happen) explains
how to choose a fence.

## Deno reports leaking resources or an uncaught error

A bot that is still polling, or a session that was not ended, when a test finishes leaks its
requests. Stop the bot and end the session in `finally` blocks, as the
[fixture](sessions-and-fixtures.md#a-reusable-fixture) does, so they run however the test ends.
