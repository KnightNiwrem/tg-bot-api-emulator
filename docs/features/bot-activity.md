# Bot activity

[Feature index and comparison baseline](README.md) ·
[TypeScript client guide: Observing bot behavior](../clients/typescript/observing-bot-behavior.md)

A bot under test runs in its own process and answers updates in its own time. Each session keeps a
bot activity log so that tests can wait for what their bots do and assert the order it happened in.
The log records the Bot API calls the session's bots make, with the answers they receive, the
updates delivered to and confirmed by them, and the failed attempts to deliver updates to their
webhooks. Telegram has no such facility. The emulator provides it for tests.

## The ordering guarantee

Each entry has a position: the first entry is 1, and each later entry's position is 1 greater. An
entry is positioned when the emulator decides its outcome: when it answers a call, hands an update
over, sees one confirmed, or sees a webhook fail to accept one. Entries are final as soon as they
are readable.

**The log's order agrees with every order a bot enforces.** A bot that awaits one call's answer
before making another call cannot have the second recorded first. A call made while handling an
update is recorded after the update's delivery. Calls a bot makes concurrently may be recorded in
either order, as they may reach Telegram in either order.

The emulator does not know which orders a particular bot enforces, and it does not tie calls to the
updates that caused them. A test should assert only orders its bot guarantees by design. For
example, a grammY bot using `@grammyjs/runner` with `sequentialize` handles one chat's updates in
order, but calls from different chats can interleave.

## Entries

| Kind                     | Recorded when                                                                                            | Contents                                                                                                                                                                 |
| ------------------------ | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `bot_api_call`           | The emulator decides a call's answer, whether the method ran, failed or is not implemented               | Bot, method under its current name, method as called, `http` or `webhook_reply`, parameters as sent, uploaded file names and sizes, the chat `chat_id` names, the answer |
| `update_delivered`       | A `getUpdates` answer includes the update, or a webhook request carries it; every repeat is recorded too | Bot, `polling` or `webhook`, the update, its chat and user, and for a webhook the attempt's `webhook_attempt_id`                                                         |
| `update_confirmed`       | A `getUpdates` offset moves past the update, or the webhook's complete 2xx answer to it arrives          | Bot, `polling` or `webhook`, the update ID, its chat and user, and for a webhook the accepted attempt's `webhook_attempt_id`                                             |
| `webhook_attempt_failed` | A webhook attempt fails: an answer other than 2xx, no connection, a timeout or a cut-short response      | Bot, the update ID, its chat and user, `webhook_attempt_id`, the `failure`, and the `retry_delay_seconds` automatic scheduling observes                                  |

Parameters are recorded as text, as the Bot API reads them: `chat_id: 1` and `chat_id: "1"` are both
`"1"`, and structured parameters such as `reply_markup` are JSON text. A `chat_id` naming a public
username is recorded with the chat it names. An update's chat and user are found as grammY's
`ctx.chat` and `ctx.from` find them. Inline queries, chosen inline results, presses of buttons on
inline messages, polls and poll answers have no chat, and a poll's new state and a stopped message
generation have no user.

A webhook attempt is recorded as an `update_delivered` entry when it starts, and as an
`update_confirmed` or a `webhook_attempt_failed` entry when it ends, all naming the same
`webhook_attempt_id`. A failure's `reason` is `http_error`, with the webhook's `status_code`,
`connection_failed`, `timed_out` or `response_interrupted`, and its `error_message` is the
description `getWebhookInfo` reports. The failure is recorded once its retry is scheduled, so a test
that finds it can release the retry at once; see
[webhook delivery controls](webhooks.md#delivery-controls). An attempt cut short because the webhook
was replaced or deleted or the session ended is recorded as neither confirmed nor failed.

A webhook's complete 2xx answer confirms its update when it arrives, as the official server's
[`WebhookActor`][webhook-actor-answer] acknowledges it. A method the answer names runs afterwards,
apart from the delivery, and its `bot_api_call` entry, `via` `webhook_reply`, comes after the
confirmation. Nothing waits for that method: the update's queue sends its next update at once, so
the next update's `update_delivered` and even `update_confirmed` entries can come before the earlier
reply's call, for example while the call downloads a file. Replacing or deleting the webhook, or
expiring the attempt, does not stop the method; ending the session does, before it changes anything.

The log does not record:

- `getUpdates` calls, whose updates are recorded instead
- calls whose token authenticates no bot of the session
- webhook responses that name no method, name one a webhook cannot run, or cannot be decoded

Entries are kept until the session ends.

## Reading the log

`GET /sessions/{sessionId}/bot-activity` answers with the earliest entries after `after`, and before
`before` if given, that match every filter given, with `head_position`, the latest position. The
filters are `bot_id`, `kind`, `method`, `chat_id`, `user_id`, `update_id`, `ok`, `parameters` and
`parameters_json`. A method matches without regard to case, and an older name finds its calls too.
Filters that only calls have, `method`, `ok`, `parameters` and `parameters_json`, match no update
entry, and filters that only updates have, `user_id` and `update_id`, match no call. Each bot
numbers its updates independently, so an `update_id` names one update only together with `bot_id`.

### Matching parameters

A call's parameters are recorded as the text the bot sent, as Telegram reads every parameter as
text. A JSON body's string is recorded as it is, and any other JSON value as its JSON text.

`parameters[name]=text` compares that text exactly, as in `parameters[callback_query_id]=123`. Text
that happens to be JSON is still compared as text, so
`parameters[reply_parameters]={"message_id":5}` finds only calls that sent exactly those characters,
not those that ordered the members differently, spaced them, or sent another member as well.

`parameters_json` compares JSON by its structure. Its value is one URL-encoded JSON object holding a
pattern for each parameter it names, such as
`parameters_json={"reply_parameters":{"message_id":5}}`. Each pattern must be a JSON object or
array, the shapes of the parameters Telegram reads as JSON, such as `reply_parameters`,
`reply_markup` or `entities`. A call matches when it sent every named parameter, the parameter's
text is JSON nested at most 100 levels, and that JSON matches the pattern:

- a string, number or boolean matches the same value of the same type, so `5` matches neither `"5"`
  nor `true`
- numbers compare by the exact decimal value their text spells, not as the nearest floating-point
  number: `1` matches `1.0` and `1e0`, and `-0` matches `0`, but `9007199254740993` does not match
  `9007199254740992`, `0.30000000000000001` does not match `0.3`, and `1e400` does not match
  `1e500`, though JavaScript reads each of those pairs as one number
- `null` matches only `null`, not a missing member
- an object matches an object that has every member the pattern names, each with a matching value;
  other members and member order do not matter, so no pattern can require a member to be missing
- an array matches an array of the same length whose elements match the pattern's elements in order;
  the objects in it may have members the pattern does not name

So `{"reply_markup":{"inline_keyboard":[[{"text":"Yes"},{"text":"No"}]]}}` finds a keyboard of one
row with those two buttons, whatever their callback data. A parameter sent as a JSON body's object
matches just as one sent as form text holding the same JSON. The emulator records such an object as
it writes it again after reading it, so a number in it that JavaScript cannot hold exactly is
recorded as JavaScript holds it: `9007199254740993` as `9007199254740992`, and `1e500` as `null`.
Form text, and a JSON body's string, are recorded exactly. Only the parameters `parameters_json`
names are read as JSON, and both filters can be given together.

A `parameters_json` value that is not JSON is an `invalid_json` issue, one that nests objects and
arrays more than 100 levels deep, its own object included, is a `too_big` issue, one that is not an
object, or has a pattern that is not an object or array, is an `invalid_type` issue, and a member
that an object in it names twice is a `duplicate_field` issue. No Bot API parameter's JSON nests
nearly as deep as the limit allows. Each issue's path continues into the JSON, as in
`["parameters_json", "reply_markup", "inline_keyboard"]`.

A read without `before` that finds nothing is held for up to `wait_ms` milliseconds, at most 10
minutes, until a matching entry is recorded or the session ends. A read with `before` covers a range
that is already complete, so it is answered at once. Positions beyond the head, repeated or unknown
parameters, and `wait_ms` together with `before` are rejected with `400`.
[The OpenAPI description](../../openapi/paths/sessions_{sessionId}_bot-activity.yaml) lists every
parameter.

## TypeScript client

`session.botActivity(filter?, options?)` returns a view of the log. The view's filter applies to
every read in addition to the read's own filter. Filters use the entries' field names, such as
`bot_id` and `chat_id`. `parameters` takes the exact text of each parameter, and `parameters_json`
the patterns for parameters that hold JSON, as plain values, such as
`{ parameters_json: { reply_parameters: { message_id: command.message_id } } }`; the client sends
them as one JSON query parameter. It writes that JSON itself from the values it checks, reading each
once, and refuses with a `TypeError` a pattern that JSON cannot carry unchanged: one holding
`undefined`, `NaN`, a `Date` or another class's object, or an object or array with a `toJSON`
property or a getter, whose code would decide what `JSON.stringify` sends. An empty `parameters` or
`parameters_json` map matches only calls, like any criteria only calls have; as an empty
`parameters` map puts nothing in the query, the client sends `kind=bot_api_call` for it. A view and
a read whose criteria together can match no entry are rejected with a `TypeError`: different values
for one criterion, or a call's criteria or `kind` together with an update's. Patterns for one
parameter differ when they differ other than in member order. Methods differ only when the server
would read them differently, ignoring case and resolving older names, so a view of `kickChatMember`
accepts a read of `banChatMember` and finds its calls. A `where` predicate checks the entries that
match the other criteria, on the client, and receives only the kinds of entry those criteria can
match: a `BotApiCallEntry` when they name a `method`, an `UpdateDeliveredEntry` when they name that
`kind`. A list of different filters needs a declared type, such as `BotActivityCriteria[]`, as
TypeScript infers the narrowed type from a single filter only.

- `position()` returns the head position.
- `waitFor(filter, { after })` returns the first matching entry after a position. It holds one
  request until an entry is recorded, and sends another only when `where` rejects an entry. It fails
  with `BotActivityTimeoutError` after 5 seconds by default. The view's `timeoutMs` option and each
  call's `timeoutMs` change the wait.
- `assertNone(filter, { after, before })` checks a range that is already recorded, without waiting.
  It fails with `UnexpectedBotActivityError`, which lists the matching entries.
- `cursor({ after })` returns a cursor whose `next(filter)` waits after the cursor's position and
  moves the cursor to the entry it finds.

A wait's deadline is `timeoutMs` after the call, measured by the client. A read that holds for an
entry must be answered, response body included, by the deadline. Otherwise the client abandons it,
aborting the request through the fetch signal and cancelling the body, and the wait fails with
`BotActivityTimeoutError`, whose `cause` is an `EmulationClientError` naming the abandoned read, as
it is for such a read that fails after the deadline. An answer that arrives later never counts, so a
slow transport cannot pass off an entry recorded after the deadline as found in time; an entry
recorded just before the deadline whose answer arrives after it is not found either. A page that
fills the read limit reports the head position when it was answered, and the entries after the page
are read up to that position, even after the deadline. A wait of `timeoutMs: 0` makes one read of
what is recorded when the emulator answers. These reads of entries already recorded get one more
second after the deadline. No read counts that settles after its cutoff: the deadline for a holding
read, that second later for the others. With a transport that does not block the event loop, a wait
therefore settles within `timeoutMs`, plus that second when it reads recorded entries. A transport
that blocks the event loop, such as a custom `fetch` that works synchronously, delays the wait until
it yields, but cannot make a late read count. The emulator holds a read for at most 10 minutes, so a
wait with a longer `timeoutMs` fails at its first read with an `EmulationClientError` for the `400`
answer.

`waitFor` and `next` also take a `signal`. When it aborts, even from within `where`, the wait
abandons its read, checks no further entry, and rejects with the signal's reason, as `fetch` does,
and a cursor stays where it was. Other failed requests, and answers that break the read contract,
still reject with `EmulationClientError`.

Every `after` and `before` takes a position or an entry. `latest(...)` picks the latest of several.
Positions are values, so independent waits can start from the same position. The waits below assert
that B and C both follow A, in whichever order they come, and that D follows both:

```ts
const activity = session.botActivity({ bot_id: bot.id });
const start = await activity.position();
await account.sendMessage({ to: { type: 'private', botId: bot.id }, text: '/pair' });

const reply = (text: string) =>
  ({ method: 'sendMessage', chat_id: account.id, parameters: { text } }) as const;
const a = await activity.waitFor(reply('A'), { after: start });
const [b, c] = await Promise.all([
  activity.waitFor(reply('B'), { after: a }),
  activity.waitFor(reply('C'), { after: a }),
]);
await activity.waitFor(reply('D'), { after: latest(b, c) });
```

A filter that names a `kind`, or criteria only calls or only updates have, returns a correspondingly
narrowed entry type, so `reply('A')` finds a `BotApiCallEntry` whose `answer` can be read directly.

An account's action returns before the bot handles it, so the chat's latest message may still be the
account's own. A test that reads the bot's reply takes the position before acting, waits for the
reply's successful call with criteria that only that reply meets, and then selects the message by
what identifies it, such as the message it replies to. The
[client guide](../clients/typescript/media-and-files.md#replying-to-a-photo-with-a-document) does
this for a photo and the document the bot replies with.

A delivery's `update_id` finds that update's confirmation. The wait below asserts that the bot
received the account's message, then that it confirmed it:

```ts
const delivered = await activity.waitFor(
  {
    kind: 'update_delivered',
    chat_id: account.id,
    where: (entry) => (entry.update.message as { text?: string } | undefined)?.text === '/pair',
  },
  { after: start },
);
await activity.waitFor(
  { kind: 'update_confirmed', update_id: delivered.update.update_id },
  { after: delivered },
);
```

## Asserting that something did not happen

A range check needs a later entry that the bot guarantees comes after the work in question: a fence.
Which entries are fences depends on the bot. For example, a grammY runner with
`sequentialize((ctx) => ctx.chat?.id.toString())` starts a chat's next update only after the
previous one was handled. A reply to that next update therefore fences everything the previous
handler awaited:

```ts
// `shipped` is the entry of the /order handler's last reply; /status was sent after /order.
const status = await activity.waitFor(
  { method: 'sendMessage', chat_id: account.id, parameters: { text: 'Status: shipped' } },
  { after: shipped },
);
await activity.assertNone(
  { method: 'deleteMessage', chat_id: account.id },
  { after: start, before: status },
);
```

A bot handling updates one at a time confirms each update only after handling it, so its
`update_confirmed` entries are fences too, as are a webhook's confirmations when its answer waits
for the handler. Work that a handler starts without awaiting it falls outside every fence, and so
does a method a webhook's answer names, which runs after the confirmation.

## Local evidence

[Log entries](../../src/types/bot_activity.ts),
[recording and reading](../../src/services/bot_activity.ts),
[call recording](../../src/api/sessions/bot_api/call_recording.ts),
[HTTP reads](../../src/api/sessions/bot_activity/mod.ts),
[client waits](../../clients/typescript/bot_activity_log.ts),
[client HTTP reads](../../clients/typescript/bot_activity_http_page_reader.ts),
[service tests](../../tests/bot_activity_service_test.ts),
[HTTP tests](../../tests/bot_activity_api_test.ts),
[call recording tests](../../tests/bot_api_call_recording_test.ts),
[client tests](../../clients/typescript/bot_activity_log_test.ts),
[client wait tests](../../clients/typescript/bot_activity_wait_deadline_test.ts) and
[grammY runner tests](../../tests/grammy_runner_bot_activity_test.ts).

[webhook-actor-answer]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/WebhookActor.cpp#L619-L672
