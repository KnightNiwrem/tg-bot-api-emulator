# Polls

[Feature index and comparison baseline](README.md) · [Messages](messages.md) ·
[Text formatting](text-formatting.md) · [Supergroups](supergroups.md) ·
[TypeScript client guide: Polls](../clients/typescript/polls.md)

## Capability matrix

| Area                  | Supported                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Not supported                                                                                                                                                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `sendPoll` parameters | `chat_id`, `question`, `question_parse_mode`, `question_entities`, `options` (text with `text_parse_mode` or `text_entities`), `is_anonymous`, `type`, `allows_multiple_answers`, `allows_revoting`, `correct_option_ids`, `correct_option_id`, `explanation`, `explanation_parse_mode`, `explanation_entities`, `open_period`, `close_date`, `is_closed`, `disable_notification`, `protect_content`, `message_effect_id`, `reply_parameters`, `reply_to_message_id`, `allow_sending_without_reply`, `reply_markup` | `business_connection_id`, `message_thread_id`, `allow_adding_options`, `shuffle_options`, `hide_results_until_closes`, `members_only`, `country_codes`, `description` and its formatting, `media`, option media, `explanation_media`, `allow_paid_broadcast` |
| `stopPoll` parameters | `chat_id`, `message_id`, `reply_markup`                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `business_connection_id`                                                                                                                                                                                                                                     |
| `Poll` fields         | `id`, `question`, `question_entities`, `options` (`persistent_id`, `text`, `text_entities`, `voter_count`), `total_voter_count`, `open_period`, `close_date`, `is_closed`, `is_anonymous`, `allows_multiple_answers`, `allows_revoting`, `members_only` (always false), `type`, `correct_option_id`, `correct_option_ids`, `explanation`, `explanation_entities`                                                                                                                                                    | `country_codes`, `explanation_media`, `description`, `description_entities`, `media`, an option's `media`, `added_by_user`, `added_by_chat`, `addition_date`                                                                                                 |
| Updates               | `poll` and `poll_answer` for the bot that sent the poll                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Updates for other bots about polls they did not send, including accounts' polls; service messages about added or deleted options                                                                                                                             |
| Account actions       | [Sending](#accounts-polls) regular polls and quizzes, directly or for a `request_poll` button, and stopping them; answering, changing and retracting an answer; forwarding and replying                                                                                                                                                                                                                                                                                                                             | Closing times and closed previews of accounts' polls; adding or deleting options                                                                                                                                                                             |
| Chats                 | Private chats with bots, supergroups                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Basic groups, channels, forum topics, business chats                                                                                                                                                                                                         |
| Time                  | Closing times shown as Telegram shows them, and closed when a test [makes them arrive](#closing-times)                                                                                                                                                                                                                                                                                                                                                                                                              | Closing by elapsed time                                                                                                                                                                                                                                      |

## Sending polls

Bots send regular polls and [quizzes](#quizzes) with [`sendPoll`][bot-api-send-poll] to private
chats and supergroups, and accounts [send their own](#accounts-polls). The account or bot that sends
a poll owns it; accounts of the chat vote in it. The other parameters work as for `sendMessage`:
replies, reply markup, `protect_content`, `disable_notification` and, in private chats,
`message_effect_id`.

The request is read as the official server's [`process_send_poll_query`][send-poll-query] reads it:
the question with `question_parse_mode` or `question_entities`, then `options`, a JSON array of
`InputPollOption` read as [`get_input_poll_options`][input-poll-options] reads it. An option is a
string, its text, or an object with `text` and its `text_parse_mode` or `text_entities`. An option
that cannot be read fails with the server's prefix, such as
`Bad Request: can't parse InputPollOption: Expected InputPollOption to be an Object`. `options` that
is not JSON fails with `Bad Request: can't parse options JSON object`, and `null` holds no options.
`is_anonymous` defaults to true, `allows_multiple_answers` to false, and `allows_revoting` to true
for a regular poll and to false for a quiz, as the server sets it. `is_closed` sends the poll
already closed, as a preview, which TDLib allows only bots.

Once the chat and the replied message are found, the poll is checked as TDLib's
[`create_input_message_content`][create-poll-content] and [`PollOption`][poll-option] check it:

| Check                                         | Error                                                    |
| --------------------------------------------- | -------------------------------------------------------- |
| Question empty after normalization            | `Bad Request: text must be non-empty`                    |
| Question longer than 300 characters           | `Bad Request: poll question length must not exceed 300`  |
| No options                                    | `Bad Request: poll must have at least one answer option` |
| More than 12 options                          | `Bad Request: poll can't have more than 12 options`      |
| Option empty after normalization              | `Bad Request: text must be non-empty`                    |
| Option longer than 100 characters             | `Bad Request: poll options length must not exceed 100`   |
| A button's callback data longer than 64 bytes | `Bad Request: BUTTON_DATA_INVALID`                       |

The question and options are normalized as message text is, and, as TDLib's
[`create_poll`][create-poll] and `PollOption` keep them, only their custom emoji remain of their
entities. A refused poll stores no message and no poll.

The sent message, and the same message in account history, shows the poll in `poll`, as the official
server's [`JsonPoll`][json-poll] shows it to bots: its `id`, question, options with their
`persistent_id` and `voter_count`, `total_voter_count`, `is_closed`, `is_anonymous`,
`allows_multiple_answers`, `allows_revoting`, `members_only` and `type`. Bots see every option's
count, as TDLib's [`get_poll_object`][poll-object] shows them to bots. Telegram's servers choose
`persistent_id`; the emulator uses the decimal text of the option's position. The poll's message has
no text, as TDLib's [`get_message_content_text`][content-text] reads only a poll's description,
which the emulator does not support.

`editMessageReplyMarkup` replaces a poll message's inline keyboard. `editMessageText` and
`editMessageCaption` find no text or caption in it, and `editMessageMedia` fails as TDLib's
[`can_edit_message_media`][edit-media] decides: `Bad Request: message media can't be edited`.

## Quizzes

`type: quiz` sends a quiz. Its correct options are `correct_option_ids`, a JSON array the server
reads with its own descriptions, such as
`Bad Request: correct option identifier must be of type Number`, or the legacy `correct_option_id`.
Its `explanation`, with `explanation_parse_mode` or `explanation_entities`, is read before them and
normalized as text that may be empty, keeping all its entities. After the options, TDLib's
[`check_quiz_correct_option_ids`][check-quiz] checks the correct options, then Telegram's servers
check the explanation's documented limits:

| Check                                                | Error                                                            |
| ---------------------------------------------------- | ---------------------------------------------------------------- |
| No correct option                                    | `Bad Request: correct quiz option list must be non-empty`        |
| Correct options not in increasing order, or repeated | `Bad Request: correct quiz option list must be increasing`       |
| A correct option the poll lacks                      | `Bad Request: wrong quiz correct_option_id`                      |
| An explanation longer than 200 characters            | `Bad Request: quiz explanation must have at most 200 characters` |
| An explanation with more than 2 line feeds           | `Bad Request: quiz explanation must have at most 2 line feeds`   |

A quiz may have several correct options and allow several answers. Its solution, the
`correct_option_ids`, `correct_option_id` when it has one correct option, and its explanation with
`explanation_entities`, shows, as the Bot API documents for [`Poll`][bot-api-poll] and TDLib's
[`get_poll_object`][poll-object] gives it, only to the account or bot that sent the quiz, to an
account that answered it, to everyone once it is closed, and to a bot through the message that sent
the quiz, not a forward, to its private chat: the Bot API makes it available for quizzes
`sent (not forwarded) by the bot or to the private chat with the bot`. Other bots and accounts see
`type: quiz` without the solution. Account history of a private chat shows the bot's view, which
includes the solution. Answers to a quiz count as for a regular poll: the emulator records whether
they are correct only through the options chosen.

## Voting

Accounts vote through the emulation API, as TDLib's [`setPollAnswer`][set-poll-answer] does for a
user: `PUT .../messages/{messageId}/poll-answer` with `option_ids`, the chosen options' positions
counted from 0, on a message of the account's private chat with a bot or of a supergroup it is a
member of. `DELETE` on the same path retracts the account's answer and `GET` reads it. The
TypeScript client's `answerPoll`, `retractPollAnswer` and `getPollAnswer` call these routes. Each
answers with the account's `option_ids` and `option_persistent_ids`, empty without an answer, and,
apart from `DELETE`, with the message showing the poll and its counts.

As `setPollAnswer` does, repeated positions count once, and the poll's checks run in its order:

| Answer                                                           | Result    |
| ---------------------------------------------------------------- | --------- |
| Any answer to a closed poll                                      | `409`     |
| Several options of a poll without multiple answers               | `400`     |
| Retraction from a poll that disallows revoting                   | `409`     |
| A position the poll lacks                                        | `400`     |
| A new answer from a voter of a poll that disallows revoting      | `409`     |
| The options the account already chose, where revoting is allowed | No change |

A poll that disallows revoting refuses a retraction even from an account without an answer, as TDLib
checks it before looking at the account's answer. A message without a poll, or one the account
cannot find, is `404`; a supergroup the account is no member of is `403`. Accounts never learn who
else voted: the routes show only the account's own answer.

## Stopping polls

The bot that sent a poll stops it with [`stopPoll`][bot-api-stop-poll], which answers with the
closed poll, as the official server's [`process_stop_poll_query`][stop-poll-query] does. The poll
keeps its votes, accepts no more answers (`409` for an account), and shows `is_closed` through its
message and every forward. The message shows the new `reply_markup`, or none when it is omitted, as
an edit does; its `edit_date` does not change, and no bot receives an `edited_message` update, as
bots receive none for their own messages.

The server's [`check_message`][check-message] finds the message, and TDLib's
[`get_message_poll_id`][message-poll-id] and [`stop_poll`][stop-poll] check the poll:

| Check                                                        | Error                                              |
| ------------------------------------------------------------ | -------------------------------------------------- |
| No such message, or `message_id` not positive                | `Bad Request: message with poll to stop not found` |
| The message shows no poll                                    | `Bad Request: message is not a poll`               |
| The bot cannot edit the message: another bot's, or a forward | `Bad Request: poll can't be stopped`               |
| The poll is closed, so a second `stopPoll` fails too         | `Bad Request: poll has already been closed`        |
| A Web App button in a supergroup                             | `Bad Request: BUTTON_TYPE_INVALID`                 |
| Callback data longer than 64 bytes                           | `Bad Request: BUTTON_DATA_INVALID`                 |

The keyboard is read before the chat, as for `editMessageReplyMarkup`, and the chat is found as for
an edit. A refused stop changes nothing.

## Accounts' polls

Accounts create polls through the emulation API, as TDLib's `sendMessage` with `inputMessagePoll`
does for a user: `POST .../messages` with `poll`, which the TypeScript client's `sendPoll` sends, to
the account's private chat with a bot or to a supergroup it is a member of. The account owns the
poll, which takes the settings and defaults of `sendPoll` without its closing times:

| Field                                                       | Default                                       |
| ----------------------------------------------------------- | --------------------------------------------- |
| `question`, `question_entities`                             | Required                                      |
| `options`, each `text` with `text_entities`                 | Required                                      |
| `is_anonymous`                                              | `true`                                        |
| `type`                                                      | `regular`                                     |
| `allows_multiple_answers`                                   | `false`                                       |
| `allows_revoting`                                           | `true` for a regular poll, `false` for quiz   |
| `correct_option_ids`, `explanation`, `explanation_entities` | Only for a quiz, which needs a correct option |

The poll is checked as a bot's, with the same reasons and order, except that, as TDLib's
[`create_input_message_content`][create-poll-content] limits a user's question, the question has at
most 255 characters. TDLib creates a user's poll open, so an account cannot send a closed preview. A
refused poll is `400` and stores no message, no poll and no update. In a supergroup, the account
then needs `can_send_polls`, as TDLib's [`can_send_message_content`][send-poll-rights] checks it, or
the send is `403`; a private chat with a bot always accepts polls, and an account that blocks the
bot is refused with `409`, as for any message. The bot receives an ordinary `message` with the poll,
from the account, as it receives other messages of the chat.

A [`request_poll` button](keyboards-and-callbacks.md#answering-poll-requests) of a private chat
sends the same poll, of the type the button requests, as the TypeScript client's
`pressReplyKeyboardButton` with `poll` does.

The account that sent a poll stops it with `POST .../messages/{messageId}/poll-closure`, or the
TypeScript client's `stopPoll`, as TDLib's `stopPoll` does for a user. TDLib's
[`can_edit_message`][can-edit-message] lets a user edit only its own messages, and no forward, so
another account, a supergroup administrator, or the owner through a forward is refused with `403`,
and a bot's `stopPoll` fails with `Bad Request: poll can't be stopped`. A closed poll is `409`. The
stopped poll keeps its votes and refuses further answers through every message showing it, whose
content stays as it was without an edit date. Accounts cannot stop a bot's poll either.

No bot receives a `poll` or `poll_answer` update about an account's poll, whoever votes and however
it closes. The Bot API documents for [`Update`][bot-api-update] that bots receive votes only in
polls they sent, and poll states only about those polls and manually stopped polls. The official
server relays every `updatePoll` TDLib gives it, as [`add_update_poll`][add-update-poll] shows, and
TDLib gives a bot one for each change Telegram's servers report, as [`on_get_poll`][on-get-poll]
shows; which bots those servers tell about a stopped poll is not in the open-source code, so the
emulator tells none, as for [other bots' stopped polls](#real-gaps). Votes, forwards and copies work
as for a bot's poll; a bot that copies an account's poll owns the copy.

## Closing times

`open_period`, 5 to 2628000 seconds, or `close_date`, a Unix time 5 to 2628000 seconds from now,
sets when a poll closes by itself. The poll shows both `open_period` and `close_date` while it is
open, as TDLib's `get_poll_object` completes one from the other, and neither once it is closed.

The emulator does not close polls as time passes. A test makes a poll's closing time arrive with
`POST /sessions/{sessionId}/polls/{pollId}/expiry`, or the TypeScript client's
`session.expirePoll(pollId)`: the poll closes as if stopped, without a change of its message's
keyboard, and the bot that sent it receives a `poll` update, as Telegram's servers report a poll
that closed by itself; TDLib does not close it locally for bots, as
[`on_close_poll_timeout`][close-poll-timeout] shows. A poll without a closing time, or one already
closed, answers `409`.

## Poll updates

The emulator delivers a poll's updates only to the bot that sent it, wherever the poll is shown,
including forwards in chats the bot is not in. The Bot API documents for [`Update`][bot-api-update]
that Telegram also sends other bots updates about polls stopped manually, which the emulator does
not, as its [real gaps](#real-gaps) explain:

| Event                                               | Updates the bot receives                                                     |
| --------------------------------------------------- | ---------------------------------------------------------------------------- |
| An account answers, changes or retracts its answer  | `poll_answer`, for a poll that is not anonymous, then `poll` with new counts |
| The bot stops the poll, or its closing time arrives | `poll` with the closed poll                                                  |
| An answer that changes nothing, or a refused one    | None                                                                         |
| Any vote in or closure of an account's poll         | None                                                                         |
| A refused or repeated `stopPoll`                    | None                                                                         |

`poll_answer` shows the voter in `user`, the chosen `option_ids` and `option_persistent_ids`, both
empty for a retraction, as the server's [`JsonPollAnswer`][json-poll-answer] does. Bots never learn
who voted in an anonymous poll. TDLib sends the bot `updatePoll` when the poll changes and after it
stops it, as [`on_get_poll`][on-get-poll] does, and `updatePollAnswer` for the votes Telegram's
servers report, as [`on_get_poll_vote`][on-get-poll-vote] does. Each update needs the bot's
subscription to its type; both are in the default subscription. They have no chat, and a `poll`
update has no user, as the bot activity log records them. A webhook sends a poll's updates in one
queue, as the server's [`add_update_poll`][add-update-poll] chooses it.

## Forwards, copies and replies

A forward of a poll's message, by a bot or an account, shows the same poll: its votes count once,
whichever message an account votes through, and every message showing it shows the same counts. As
TDLib's [`dup_message_content`][dup-content] and [`dup_poll`][dup-poll] do, a copy by `copyMessage`
or `copyMessages` shows a new poll that the copying bot owns, with the original's question, options,
settings and quiz solution, open and without votes, even when the original is closed; its open
period counts from the copy. A `caption` of `copyMessage` is ignored. As TDLib's
[`has_input_media`][has-input-media] and the Bot API require, a bot copies a quiz only when it sees
its solution: `Bad Request: the message can't be copied`, and `copyMessages` skips it. A reply from
another chat to a poll's message shows the poll in `external_reply.poll`, as it is now.

## Intentional deviations

- **Strict input.** The official server ignores unknown parameters and unknown fields of an option,
  reads fields of the wrong JSON type leniently, ignores the quiz parameters of a regular poll, and
  ignores `close_date` beside `open_period`. The emulator rejects them with
  `Bad Request: invalid sendPoll parameters`, to surface the bot's mistake in tests, rejects options
  with media with a description of its own, and rejects `open_period` with `close_date` with
  `Bad Request: open_period and close_date can't be used together`.
- **Closing times without elapsed time.** Telegram closes a poll when its closing time passes. The
  emulator closes it only when a test makes its closing time arrive, so tests decide the moment
  without waiting for real time.
- **Documented limits with the emulator's descriptions.** Telegram's servers check what the Bot API
  documents but TDLib does not: an explanation's length and line feeds, and the range of
  `open_period` and `close_date`, which the server clamps or forwards as given
  ([`get_integer_arg`][integer-arg]). The emulator refuses values outside the documented ranges with
  descriptions of its own, such as `Bad Request: open_period must be from 5 to 2628000 seconds`, and
  checks a closing time before the chat.

## Real gaps

- **Other bots' stopped polls.** The Bot API documents that bots also receive updates about manually
  stopped polls they did not send. Which bots Telegram's servers tell is not in the open-source
  code, so a bot that has only a forward of a poll receives no update when it stops, and no bot
  receives one when an account stops its own poll.
- **Telegram 10.x poll features.** Options added after creation (`allow_adding_options`),
  restrictions on who may vote (`members_only`, `country_codes`), `shuffle_options`,
  `hide_results_until_closes`, descriptions (`description` and its formatting), and media (`media`,
  option media and `explanation_media`) are rejected as unsupported.
- **Accounts' closing times.** Accounts send polls without `open_period` or `close_date`, which only
  bots set here.
- **Replies to options.** `reply_parameters.poll_option_id` is not supported, as for
  [messages](messages.md#real-gaps).

## Comparison limits

TDLib sends votes and polls to Telegram's servers, whose storage and checks the open-source code
does not show, such as how they assign `persistent_id` and poll identifiers, whether they refuse an
unchanged answer, and the order in which they send a vote's `poll_answer` and `poll` updates. The
emulator keeps every account's answer itself and counts votes from them, so counts always agree with
the answers, and sends `poll_answer` first. Whether Telegram's servers give an account the solution
of a quiz it has not answered in a private chat with the quiz's bot is not visible either; account
history shows the bot's view there. Whether stopping an account's poll gives its message an edit
date, or sends the chat's bots an `edited_message`, is decided by those servers too; the emulator
does neither, as for a bot's stop.

## Local evidence

[Parameter reading](../../src/api/sessions/bot_api/input_poll_option_parameter.ts) and
[quiz parameters](../../src/api/sessions/bot_api/quiz_parameters.ts),
[domain model](../../src/types/poll.ts), [normalization](../../src/services/poll_normalization.ts),
[voting and stopping](../../src/services/poll.ts), [storage](../../src/repositories/poll.ts),
[account poll requests](../../src/api/sessions/accounts/request_fields.ts) and
[closure routes](../../src/api/sessions/accounts/poll_closures.ts),
[update delivery](../../src/services/bot_update_delivery.ts),
[projection](../../src/projections/bot_api_message.ts), [unit tests](../../tests/poll_test.ts),
[HTTP tests](../../tests/poll_api_test.ts) and
[account poll tests](../../tests/account_poll_api_test.ts).

[bot-api-send-poll]: https://core.telegram.org/bots/api#sendpoll
[bot-api-stop-poll]: https://core.telegram.org/bots/api#stoppoll
[bot-api-update]: https://core.telegram.org/bots/api#update
[bot-api-poll]: https://core.telegram.org/bots/api#poll
[send-poll-rights]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessageContent.cpp#L6318-L6337
[can-edit-message]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessagesManager.cpp#L23183-L23292
[stop-poll-query]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L14326-L14357
[check-message]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L9084-L9104
[json-poll-answer]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L2843-L2861
[add-update-poll]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L18481-L18489
[message-poll-id]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessagesManager.cpp#L36619-L36638
[stop-poll]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/PollManager.cpp#L1717-L1746
[check-quiz]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/PollManager.cpp#L453-L469
[close-poll-timeout]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/PollManager.cpp#L1869-L1894
[has-input-media]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/PollManager.cpp#L2065-L2072
[integer-arg]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L13457-L13462
[on-get-poll]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/PollManager.cpp#L2547-L2567
[on-get-poll-vote]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/PollManager.cpp#L2587-L2628
[send-poll-query]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L14254-L14324
[input-poll-options]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L13173-L13206
[json-poll]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L2742-L2841
[create-poll-content]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessageContent.cpp#L5058-L5126
[poll-option]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/PollOption.cpp#L56-L91
[create-poll]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/PollManager.cpp#L923-L959
[poll-object]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/PollManager.cpp#L784-L921
[set-poll-answer]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/PollManager.cpp#L1238-L1287
[dup-poll]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/PollManager.cpp#L2040-L2063
[dup-content]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessageContent.cpp#L10286-L10298
[content-text]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessageContent.cpp#L12268-L12286
[edit-media]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessagesManager.cpp#L23294-L23310
