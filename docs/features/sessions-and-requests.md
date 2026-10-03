# Sessions and Bot API requests

[Feature index and comparison baseline](README.md)

## Supported behavior

Create a session with `POST /sessions`, then create its bots and accounts through the emulation API
or [TypeScript client](../typescript-client.md). The response supplies `botApiRoot`; a virtual bot's
token authenticates calls under `<botApiRoot>/bot<token>/<method>`. `getMe` returns its profile.

`POST /sessions` takes an optional JSON body. Its `upload_profile` chooses the official Bot API
server deployment whose upload limits the session's bots meet: `cloud`, the default, for the server
Telegram hosts at `api.telegram.org`, or `local` for a self-hosted server started with `--local`.
The response reports the profile as `uploadProfile`, and it stays fixed for the session's lifetime.
The TypeScript client takes it as `createSession({ upload_profile: 'local' })`.
[Media and files](media-and-files.md#upload-profiles) describes what each profile changes.

Sessions isolate users, chats, messages, files, update queues and bot settings. Bot creation accepts
`can_read_all_group_messages`, `supports_inline_queries`, `receives_chosen_inline_results` and
`requests_inline_location`, all false by default. These stand in for selected BotFather settings.
Account profiles can include a username and language code. A first or last name has at most 64
characters, the server-side limit of TDLib's `UserManager::MAX_NAME_LENGTH`, and must be well-formed
Unicode; a first name must also keep a character once Telegram cleans it, so that the account's
[own contact](contacts-and-locations.md#whose-contact-it-is) can be shared. Usernames are unique
within a session, compared without case. Account creation also accepts `has_private_forwards`, false
by default, which stands in for the
["Forwarded messages" privacy setting](messages.md#forwarding-and-copying), and `phone_number`,
which the account shares as its [own contact](contacts-and-locations.md#whose-contact-it-is).

`DELETE /sessions/{sessionId}` or `session.end()` discards the session and stops webhook delivery
and waiting long polls. State lives in memory and is lost on process restart. There is no account
login, Telegram connection, persistence, clock advancement API, or snapshot/restore facility.
Individual bot/account resource paths marked unimplemented in
[the OpenAPI description](../../openapi/openapi.yaml) have no profile read, update or deletion
operations; use the profiles returned at creation.

Bot API requests support GET and POST, case-insensitive method names, query parameters, and JSON,
URL-encoded or multipart bodies. The first value of a parameter wins, with the query string before
the body. Top-level JSON values are converted to parameter text: `chat_id: 123` and `chat_id: "123"`
work alike, and structured parameters may be JSON values or JSON-encoded strings. This follows
TDLib's [HTTP parameter reader][http-reader] and the Bot API's [query handling][query-source].

### Chat usernames

A supergroup created with a `username` is public. Wherever a method takes a chat, in `chat_id`,
`from_chat_id`, `reply_parameters` or a command scope, a bot can name it as `@username`, compared
without case. As the official server's [`Client::check_chat`][check-chat] finds a username with
`searchPublicChat`, a username names a public supergroup or the private chat with a bot; an
account's username, or one that nobody has, fails with `Bad Request: chat not found`. Supergroup
usernames share the session's username namespace with accounts and bots, and chats of public
supergroups show `username`, as the server's [`JsonChat`][json-chat] does. Telegram resolves a
username when it checks the chat; the emulator resolves `chat_id` and `from_chat_id` before reading
the method's other parameters, so a request with another fault may fail for the username instead.

Responses use Telegram's `ok`/`result` or `ok`/`error_code`/`description` envelope. An unknown
virtual token gives `401 Unauthorized`; an unimplemented method gives
`404 Not Found: method not found`. Requests under an absent session use the emulation API's plain
`404`, not a Bot API envelope.

### Rate limit answers

Tests make a bot's next calls fail with `429 Too Many Requests` by queuing answers with
`POST /sessions/{sessionId}/bots/{botId}/rate-limit-responses` or the TypeScript client's
`queueRateLimitResponses`. A request names the `retry_after` in seconds, optionally a `method` and a
`count` of calls, which defaults to 1; `GET` on the same path lists the answers still queued. Each
call of the bot takes one answer from the earliest queued answers for its method, or for every
method, instead of running, whatever its parameters. A method is matched by any name Telegram
accepts for it, so answers queued for `kickChatMember` also limit `banChatMember`. Webhook replies
that call methods take answers too.

The answer is written as the official server's [`Query::set_retry_after_error`][retry-after-error]
writes it: HTTP status 429, a `Retry-After` header, and
`{"ok":false,"error_code":429,"description":"Too Many Requests: retry after 3","parameters":{"retry_after":3}}`.
The emulator does not reject calls that arrive before the wait ends; a test that needs a longer
limit queues more answers.

## Intentional deviations

- **Virtual identities and no Telegram connection.** Accounts and bot tokens belong to the test
  session. Tests must run independently of Telegram, without real account login or remote service
  availability.
- **Disposable in-memory state.** Session data is not persisted across restarts. Fresh, disposable
  sessions keep tests isolated and prevent state from leaking between runs.
- **Ordinary time and fresh fixtures.** The emulation API intentionally has no clock-advance or
  snapshot/restore facility. Ordinary time and fresh fixtures are sufficient for the intended tests.
- **Session lifecycle control.** `close` and `logOut` are intentionally unsupported. Session
  teardown is sufficient for emulator lifecycle control.
- **Strict request fields and types.** Unknown parameters and nested fields, integer parameters with
  trailing text, unrecognized boolean spellings, and wrongly typed nested JSON fields are rejected.
  These checks expose accidental or unsupported input and malformed values in tests, even when
  Telegram would ignore or coerce them. The comparison below describes the parsing differences.
- **No production rate thresholds.** Telegram's traffic limits are not reproduced automatically.
  Tests [queue rate limit answers](#rate-limit-answers) instead, so bot developers can exercise
  error handling without generating production-scale traffic or depending on Telegram's limit
  figures.
- **No link previews or preview metadata.** Tests should not depend on fetching third-party websites
  to generate previews. Returned messages also omit `link_preview_options`, whose value Telegram
  derives from the generated preview; see
  [text formatting](text-formatting.md#intentional-deviations).

### Strict request validation

The emulator deliberately rejects several requests the C++ implementation reads leniently. Rejecting
malformed bodies, subscriptions and out-of-range polling options exposes mistakes that Telegram's
fallbacks or clamping could hide. This strictness can also reject requests Telegram accepts.

| Input                                                        | Emulator                                                                       | Official implementation                                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Unknown method parameters or fields in most nested objects   | `400`, usually `invalid <method> parameters`                                   | Handlers read recognized fields without a general unknown-field rejection                |
| Integer parameter containing trailing text                   | Rejected                                                                       | Integer conversion reads the leading numeric portion                                     |
| Boolean parameter                                            | Accepts `true`, `false`, `yes`, `no`, `1`, `0`, after trimming and lowercasing | Only the true spellings yield true; other text yields false                              |
| Wrongly typed fields inside a JSON parameter                 | Usually rejected, e.g. an entity offset written as a string                    | Some JSON field readers coerce numbers and strings                                       |
| Invalid JSON body or unrecognized nonempty body content type | `400`                                                                          | Some parsing errors are logged and ignored; undecoded bodies supply no method parameters |
| Malformed `allowed_updates`                                  | `400`                                                                          | Keeps the previous subscription                                                          |
| `getUpdates` limit outside 1–100 or timeout outside 0–50     | `400`                                                                          | Values are clamped                                                                       |

The corresponding upstream paths are [`HttpReader::read_next`][http-reader],
[`Client::to_bool`][booleans], [`Client::get_integer_arg`][integers], TDLib's
[`JsonObject` field readers][json-fields], [`Client::get_allowed_update_types`][subscriptions] and
[`Client::process_get_updates_query`][polling]. This does not imply that all malformed requests are
accepted upstream; low-level HTTP errors and size limits can still fail there.

## Accepted options without their Telegram effects

| Option or method                                   | Emulator behavior                            | Classification and details                                         |
| -------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------ |
| `link_preview_options`, `disable_web_page_preview` | Validated; no preview or returned options    | [Intentional](#intentional-deviations)                             |
| `disable_content_type_detection`                   | Documents always remain documents, as if set | [Real gap](media-and-files.md#document-classification)             |
| Callback `cache_time`                              | Recorded; no cache reuse                     | [Intentional](keyboards-and-callbacks.md#intentional-deviations)   |
| Ban `until_date`                                   | Normalized and reported; no automatic unban  | [Intentional](supergroups.md#intentional-deviations)               |
| Ban `revoke_messages`                              | Validated; no separate effect in supergroups | [Upstream evidence limit](supergroups.md#administrator-operations) |

The linked feature pages describe these differences in context.

## Real gaps

**Additional feature parameters.** Options for unimplemented features, including
`business_connection_id`, `message_thread_id`, `direct_messages_topic_id`, ephemeral parameters and
`allow_paid_broadcast`, are rejected. These belong to the
[broader feature gaps](README.md#unimplemented-areas).

**Mutable settings.** Supported BotFather-style settings and account privacy settings can only be
chosen at creation. Tests need to change these settings during a session.

**Individual profile management.** The emulation API has no individual bot/account profile read,
update or deletion operations. Tests currently rely on creation responses and session teardown;
managing individual profiles is missing.

## Local evidence

[Session lifecycle](../../src/services/session_lifecycle.ts),
[request decoding](../../src/api/sessions/bot_api/request_parameters.ts),
[method schemas](../../src/api/sessions/bot_api/mod.ts),
[rate limit answers](../../src/services/bot_rate_limit.ts),
[request decoding tests](../../tests/bot_api_request_parameters_test.ts) and
[HTTP tests](../../tests/emulation_api_test.ts).

[http-reader]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/tdnet/td/net/HttpReader.cpp#L110-L233
[query-source]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Query.cpp
[booleans]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L10051-L10057
[integers]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L13457-L13462
[json-fields]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/tdutils/td/utils/JsonBuilder.cpp#L625-L740
[subscriptions]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L18310-L18364
[polling]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L16926-L16949
[check-chat]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L8869-L8895
[json-chat]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L1554-L1700
[retry-after-error]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Query.cpp#L120-L127
