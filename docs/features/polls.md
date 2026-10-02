# Polls

[Feature index and comparison baseline](README.md) · [Messages](messages.md) ·
[Text formatting](text-formatting.md) · [Supergroups](supergroups.md)

## Sending polls

Bots send regular polls with [`sendPoll`][bot-api-send-poll] to private chats and supergroups. The
bot that sends a poll owns it; accounts of the chat vote in it. The other parameters work as for
`sendMessage`: replies, reply markup, `protect_content`, `disable_notification` and, in private
chats, `message_effect_id`.

The request is read as the official server's [`process_send_poll_query`][send-poll-query] reads it:
the question with `question_parse_mode` or `question_entities`, then `options`, a JSON array of
`InputPollOption` read as [`get_input_poll_options`][input-poll-options] reads it. An option is a
string, its text, or an object with `text` and its `text_parse_mode` or `text_entities`. An option
that cannot be read fails with the server's prefix, such as
`Bad Request: can't parse InputPollOption: Expected InputPollOption to be an Object`. `options` that
is not JSON fails with `Bad Request: can't parse options JSON object`, and `null` holds no options.
`is_anonymous` defaults to true, `allows_multiple_answers` to false, and `allows_revoting` to true,
as for a regular poll. `is_closed` sends the poll already closed, as a preview, which TDLib allows
only bots.

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

## Poll updates

The emulator delivers a poll's updates only to the bot that sent it, wherever the poll is shown,
including forwards in chats the bot is not in. The Bot API documents for [`Update`][bot-api-update]
that Telegram also sends other bots updates about polls stopped manually, which the emulator does
not, as its [real gaps](#real-gaps) explain:

| Event                                              | Updates the bot receives                                                     |
| -------------------------------------------------- | ---------------------------------------------------------------------------- |
| An account answers, changes or retracts its answer | `poll_answer`, for a poll that is not anonymous, then `poll` with new counts |
| The bot stops the poll                             | `poll` with the closed poll                                                  |
| An answer that changes nothing, or a refused one   | None                                                                         |
| A refused or repeated `stopPoll`                   | None                                                                         |

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
or `copyMessages` shows a new poll that the copying bot owns, with the original's question, options
and settings, open and without votes, even when the original is closed; a `caption` of `copyMessage`
is ignored. A reply from another chat to a poll's message shows the poll in `external_reply.poll`,
as it is now.

## Intentional deviations

- **Strict input.** The official server ignores unknown parameters and unknown fields of an option,
  and reads fields of the wrong JSON type leniently. The emulator rejects them with
  `Bad Request: invalid sendPoll parameters`, to surface the bot's mistake in tests, and rejects
  options with media with a description of its own.

## Real gaps

- **Quizzes.** `type` `quiz` fails with `Bad Request: quiz polls are not supported`, and the quiz
  parameters `correct_option_id`, `correct_option_ids`, `explanation` and their formatting are
  rejected as unknown parameters.
- **Closing times.** `open_period` and `close_date` are missing; polls close only when stopped or
  sent closed.
- **Other bots' stopped polls.** The Bot API documents that bots also receive updates about manually
  stopped polls they did not send. Which bots Telegram's servers tell is not in the open-source
  code, so a bot that has only a forward of a poll receives no update when it stops.
- **Telegram 10.x poll features.** Options added after creation (`allow_adding_options`),
  restrictions on who may vote (`members_only`, `country_codes`), `shuffle_options`,
  `hide_results_until_closes`, descriptions (`description` and its formatting), and media (`media`,
  option media and `explanation_media`) are rejected as unsupported.
- **Accounts' polls.** Accounts cannot send polls, which Telegram allows them in groups and in
  private chats with bots; they vote, forward and reply.
- **Replies to options.** `reply_parameters.poll_option_id` is not supported, as for
  [messages](messages.md#real-gaps).

## Comparison limits

TDLib sends votes and polls to Telegram's servers, whose storage and checks the open-source code
does not show, such as how they assign `persistent_id` and poll identifiers, whether they refuse an
unchanged answer, and the order in which they send a vote's `poll_answer` and `poll` updates. The
emulator keeps every account's answer itself and counts votes from them, so counts always agree with
the answers, and sends `poll_answer` first.

## Local evidence

[Parameter reading](../../src/api/sessions/bot_api/input_poll_option_parameter.ts),
[domain model](../../src/types/poll.ts), [normalization](../../src/services/poll_normalization.ts),
[voting and stopping](../../src/services/poll.ts), [storage](../../src/repositories/poll.ts),
[update delivery](../../src/services/bot_update_delivery.ts),
[projection](../../src/projections/bot_api_message.ts), [unit tests](../../tests/poll_test.ts) and
[HTTP tests](../../tests/poll_api_test.ts).

[bot-api-send-poll]: https://core.telegram.org/bots/api#sendpoll
[bot-api-stop-poll]: https://core.telegram.org/bots/api#stoppoll
[bot-api-update]: https://core.telegram.org/bots/api#update
[stop-poll-query]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L14326-L14357
[check-message]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L9084-L9104
[json-poll-answer]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L2843-L2861
[add-update-poll]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L18481-L18489
[message-poll-id]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessagesManager.cpp#L36619-L36638
[stop-poll]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/PollManager.cpp#L1717-L1746
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
