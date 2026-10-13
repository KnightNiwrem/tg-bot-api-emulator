# Payments

[Feature index and comparison baseline](README.md) · [Messages](messages.md) ·
[Keyboards and callbacks](keyboards-and-callbacks.md)

One-off payments in Telegram Stars in private chats are supported, from the invoice to the receipt.
A bot sends an invoice to its private chat with an account, and the account checks it out: the bot
receives a `pre_checkout_query`, which it approves or refuses with `answerPreCheckoutQuery`. The
account then completes the approved checkout, which pays the invoice and sends the bot a
`successful_payment` message. Other kinds of payment are [not supported](#real-gaps).

## Sending invoices

`sendInvoice` sends an invoice to the bot's private chat with an account that started it, as any
message is sent there. The invoice message shows its `invoice` in the fields of the official
server's [`JsonInvoice`][json-invoice]: `title`, `description`, `start_parameter`, `currency` and
`total_amount`. It never shows the bot's `payload`, which the invoice keeps exactly as sent for its
later checkout, nor a receipt. `start_parameter` is always present, empty for an invoice sent
without one. The bot receives no update for its own invoice, and the account's conversation history
shows it as the bot sees it.

Telegram's clients show a Pay button on an invoice sent without a keyboard, which accounts press
through the [checkout control](#checkout). The emulator returns no `reply_markup` for it: the Bot
API documents the button that clients show, but not whether the returned message carries it.

### What an invoice is checked for

As the official server's [`get_input_message_invoice`][input-invoice] reads it, before the chat:

1. `title`, `description` and `payload` are each required
   (`Bad Request: parameter "title" is
   required`, and alike), and the payload must be well-formed
   Unicode (`Bad Request: the payload must be encoded in UTF-8`). Its bytes are otherwise kept as
   sent.
2. `currency` and `prices` are required. `prices` is a JSON array of `LabeledPrice` objects, each
   with a nonempty `label` and an integer `amount`, refused as the server words it, such as
   `Bad Request: can't parse LabeledPrice: Field "amount" must be a valid Number`. The emulator also
   refuses a label written as a number and an amount written as a string, which Telegram reads.
3. `max_tip_amount` must be an integer and `suggested_tip_amounts` a JSON array.

The emulator then refuses what it does not support, as [described below](#unsupported-options), and
reads the other parameters as `sendMessage` reads them. Once the chat is reached, the replied
message found and the message effect accepted, TDLib's
[`process_input_message_invoice`][process-invoice] cleans the title, the description and
`start_parameter` as it cleans every input string, turning control characters other than line feeds
into spaces and removing carriage returns, and refuses text that is not well-formed Unicode, such as
`Bad Request: invoice bot start parameter must be encoded in UTF-8`. Its
[`get_labeled_price_parts`][price-parts] checks the prices: there is at least one, each label is
well-formed, each amount is within 999999999999 of zero
(`Bad Request: too big amount of the
currency specified`), and the total is positive
(`Bad Request: total price must be positive`). That bound is TDLib's
[`check_currency_amount`][currency-amount] for any currency; it does not establish that Telegram
accepts every amount of Stars below it.

Last come the limits the Bot API documents for [`sendInvoice`][send-invoice], whose refusals
Telegram does not document, so the emulator words them: exactly one price, as payments in Telegram
Stars take (`Bad Request: invoices in Telegram Stars must have exactly one price`), a title of 1–32
and a description of 1–255 characters, counted by code point once cleaned, and a payload of 1–128
bytes in UTF-8. An account that blocks the bot refuses the invoice as it refuses any message
(`Forbidden: bot was blocked by the user`).

Every refused invoice stores nothing, allocates no message ID and produces no update; the call is
recorded in [bot activity](bot-activity.md) with its answer.

### Accepted options

- `start_parameter` may be omitted, empty or nonempty. It is cleaned as described above and stored
  apart from the payload; the emulator neither invents nor requires one.
- `provider_token` may be omitted or empty, as payments in Telegram Stars take.
- `need_name`, `need_phone_number`, `need_email`, `need_shipping_address`,
  `send_phone_number_to_provider`, `send_email_to_provider` and `is_flexible`, which the Bot API
  documents as ignored for payments in Telegram Stars, are read and ignored. No shipping query or
  order information follows.
- The defaults of tips, a `max_tip_amount` of 0 and an empty or omitted `suggested_tip_amounts`,
  enable none and are accepted.
- An empty inline keyboard, `{"inline_keyboard": []}`, attaches none, as an omitted `reply_markup`
  does.
- `disable_notification`, `protect_content`, `message_effect_id`, `reply_parameters` and the older
  `reply_to_message_id` and `allow_sending_without_reply` work as for `sendMessage`. Topics,
  business connections, paid broadcasts and suggested posts are refused as for `sendMessage`.

### Unsupported options

These are refused with the emulator's own descriptions, which make no claim about Telegram's answer:

| Option                                                                  | Refusal                                                                                                          |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `currency` other than `XTR`                                             | `Bad Request: only invoices in Telegram Stars are supported; currency must be XTR`                               |
| A nonempty `provider_token`                                             | `Bad Request: payment providers are not supported; invoices in Telegram Stars take an empty provider_token`      |
| A nonempty `provider_data`                                              | `Bad Request: payment provider data is not supported`                                                            |
| `photo_url`, or a nonzero `photo_size`, `photo_width` or `photo_height` | `Bad Request: invoice product photos are not supported`                                                          |
| A positive `max_tip_amount`, or suggested tip amounts                   | `Bad Request: tips are not supported for payments in Telegram Stars`                                             |
| Any keyboard but an empty inline keyboard                               | `Bad Request: invoice keyboards are not supported; send the invoice without reply_markup to show its Pay button` |
| A supergroup's `chat_id`                                                | `Bad Request: invoices outside private chats are not supported`                                                  |

A negative `max_tip_amount`, or one beyond TDLib's bound, is refused as TDLib refuses it:
`Bad Request: invalid max_tip_amount of the currency specified`. The Bot API documents that tips are
not supported for payments in Telegram Stars; the emulator refuses them before the send options.

Invoice links (`createInvoiceLink`), shipping answers, refunds, Star balances and transactions,
subscriptions and paid media are other methods, which the emulator does not implement; like every
method outside the [inventory](README.md#implemented-bot-api-methods), they return `404`.

## Checkout

An account checks out an invoice with
`POST /sessions/{sessionId}/accounts/{accountId}/checkout-attempts` (`submitCheckout` in the
TypeScript client), naming the invoice by its private chat and message ID. This is the final
confirmation of the payment form, as [Telegram's checkout][stars-checkout] describes it; opening the
form is not modeled. The request carries no payment details: the payer, the bot, the currency, the
amount and the payload all come from the stored invoice.

The checkout starts a **checkout attempt** with a fresh identifier, which is also the identifier of
its pre-checkout query, and which keeps the invoice as it was confirmed. Unless its subscription
leaves them out, the bot that sent the invoice receives a `pre_checkout_query` update through
polling or its webhook, in the fields of the official server's
[`JsonPreCheckoutQuery`][json-pre-checkout-query]: `id`, `from`, the payer, `currency`,
`total_amount` and the `invoice_payload` the bot sent, unchanged. An invoice in Telegram Stars has
no shipping option or order information, so those fields never appear. The update names no chat, and
a webhook delivers pre-checkout queries in a queue of their own for each payer, as the official
server does.

The bot answers with `answerPreCheckoutQuery`, as the official server's
[handler][answer-pre-checkout-query] reads it: `ok` true approves the checkout and ignores any
`error_message`; any other answer refuses it and requires a nonempty `error_message`
(`Bad Request: parameter "error_message" is required`), an omitted `ok` included. An accepted answer
returns `true`, and an answer in a webhook's response works as any other. **Answering creates no
payment**: an approved checkout still awaits [completion](#completion), and the account may abandon
it instead, so a bot must not grant access until a `successful_payment` arrives, as
[Telegram documents][stars-checkout].

The account reads its attempt, with the bot's answer, at
`GET /sessions/{sessionId}/accounts/{accountId}/checkout-attempts/{checkoutAttemptId}`
(`getCheckoutAttempt`). It shows the attempt's `id`, the invoice's chat and `message_id`, the
`invoice` as confirmed, without the payload, and its `status`:

| Status      | Meaning                                                                        |
| ----------- | ------------------------------------------------------------------------------ |
| `pending`   | The bot has not answered yet.                                                  |
| `approved`  | The bot approved the checkout; it awaits completion.                           |
| `completed` | The account completed it, which paid the invoice; `payment` holds the receipt. |
| `refused`   | The bot refused it; `error_message` holds the explanation the account sees.    |
| `abandoned` | The account abandoned it while it was pending or approved.                     |
| `expired`   | A test expired it while it was pending.                                        |

A completed, refused, abandoned or expired attempt has ended for good. Two controls end an attempt
unpaid, and neither sends the bot an update, since the Bot API has none for a checkout that ends
unpaid:

- `POST …/checkout-attempts/{checkoutAttemptId}/abandonment` (`abandonCheckoutAttempt`) abandons a
  pending or approved attempt, as closing the payment form does. An attempt that has ended, a
  completed one included, is refused with `409` and the reason `checkout_attempt_ended`.
- `POST …/checkout-attempts/{checkoutAttemptId}/expiry` (`expireCheckoutAttempt`) expires a pending
  attempt, as the passing of the bot's time to answer would. The emulator expires no checkout by
  time; the bot's queued `pre_checkout_query` stays queued. An attempt that is not pending is
  refused with `409` and the reason `checkout_attempt_not_pending`.

An attempt belongs to its payer: other accounts' reads and controls of it are answered `404` with
the reason `checkout_attempt_not_found`.

## Completion

The account completes an approved attempt with
`POST …/checkout-attempts/{checkoutAttemptId}/completion` (`completeCheckoutAttempt`), as the
payment of the invoice does. Completion is one step: it checks the attempt and the invoice, marks
the invoice paid, and sends the bot the payment's receipt, a service message from the account in
their private chat. Should any part of it fail, nothing is paid and no message ID is used. The bot
receives the receipt in an ordinary `message` update, through polling or its webhook, unless its
subscription leaves messages out; there is no update of its own for payments. The message replies to
nothing and shows `successful_payment` in the fields of the official server's
[`JsonSuccessfulPaymentBot`][json-successful-payment]:

| Field                        | Value                                                        |
| ---------------------------- | ------------------------------------------------------------ |
| `currency`                   | `XTR`                                                        |
| `total_amount`               | The invoice's total, as the account confirmed it             |
| `invoice_payload`            | The payload the bot sent with the invoice, unchanged         |
| `telegram_payment_charge_id` | A synthetic identifier, such as `emulator_telegram_charge_3` |
| `provider_payment_charge_id` | A synthetic identifier, such as `emulator_provider_charge_3` |

Its `from` is the account that paid. A one-off payment in Telegram Stars has no shipping option,
order information or subscription, so those fields never appear. The charge identifiers are made up
from the attempt's ID: stable, and unique within the session. **Their format is the emulator's
own**; it makes no claim about the identifiers Telegram issues, nor about whether Telegram leaves
`provider_payment_charge_id` empty for payments in Telegram Stars. A test should treat them as
opaque strings.

The completed attempt shows the payment apart from its `invoice`, which keeps the Bot API's
`Invoice` fields and never shows a receipt:

```json
{
  "id": "3",
  "chat": { "type": "private", "botId": 2 },
  "message_id": 4,
  "invoice": {
    "title": "Premium access",
    "description": "Unlocks every premium chapter",
    "start_parameter": "",
    "currency": "XTR",
    "total_amount": 50
  },
  "status": "completed",
  "payment": {
    "receipt_message_id": 7,
    "telegram_payment_charge_id": "emulator_telegram_charge_3",
    "provider_payment_charge_id": "emulator_provider_charge_3"
  }
}
```

`message_id` is the paid invoice and `payment.receipt_message_id` its receipt, both as the private
chat's history shows them. The attempt keeps both once either message is deleted.

Only an approved attempt completes. A pending attempt, which the bot has not answered yet, a
refused, abandoned or expired one, and one already completed are refused with `409` and the reason
`checkout_attempt_not_approved`, and change nothing.

## Checkout and payment policies

Telegram does not document how these cases behave, and [#289][issue-289] tracks verifying them. The
emulator applies these rules as its own policies:

- **One active attempt per invoice.** While an invoice has a pending or approved attempt, another
  checkout of it is refused with `409` and the reason `checkout_attempt_active`. Once the attempt
  has ended unpaid, the invoice can be checked out again, which starts a new attempt with a fresh
  query ID.
- **One payment per invoice.** A paid invoice can never be checked out again, whether or not it has
  a start parameter: its checkout is refused with `409` and the reason `invoice_already_paid`. The
  emulator remembers the payment by the invoice, so deleting the receipt does not make the invoice
  payable again.
- **An available invoice in an unblocked chat.** A checkout of a message that is no invoice is
  refused with `400` and the reason `message_not_invoice`, one of a deleted or unknown message with
  `404` and `message_not_found`, and one while the account blocks the bot with `409` and
  `bot_blocked`. A refused checkout starts no attempt, uses no query ID and sends no update.
- **Completion needs them again.** Completion of an attempt whose invoice message was deleted is
  refused with `409` and the reason `invoice_message_deleted`, and one while the account blocks the
  bot with `409` and `bot_blocked`. The attempt stays approved: the account can read it, abandon it,
  or, once it unblocks the bot, complete it.
- **One accepted answer per query.** An answer to a query that does not exist, was sent to another
  bot, was already answered, or whose attempt was abandoned or expired, changes nothing and is
  answered `Bad Request: query is too old and response timeout expired or query ID is invalid`. The
  official server words Telegram's `QUERY_ID_INVALID` so, but which states of a pre-checkout query
  Telegram refuses, and with which error, is not established, so the emulator's
  [error catalogue](../../src/api/sessions/bot_api/errors/error_catalogue.ts) records this answer as
  its own inference.
- **The answer reads the attempt.** The bot answers from the attempt, without looking at the invoice
  message or the chat again, so an invoice deleted or a bot blocked after the checkout does not
  change the answer. A deleted invoice can no longer be checked out.

## Invoices and receipts among other messages

An invoice is a message of its private chat like any other:

- **Replies.** The bot and the account reply to it, and the replied message shows the `invoice`. A
  reply from another chat shows it in `external_reply.invoice`, as TDLib's `RepliedMessageInfo`
  keeps invoices.
- **Pins.** It is pinned as any message of the chat is, and the pin's service message and `getChat`
  show it.
- **Deletion.** It is deleted as any message of the chat is, and leaves the conversation.
- **Edits.** Every edit of an invoice is refused with
  `Bad Request: editing invoice messages is not supported`, though Telegram lets its bot replace its
  inline keyboard. `stopPoll` answers `Bad Request: message is not a poll`, as for any message that
  is not a poll.
- **Forwards.** Telegram forwards invoices, but the emulator refuses `forwardMessage`, and
  `forwardMessages` with an invoice among its messages, with
  `Bad Request: forwarding invoice messages is not supported`. An account's forward of an invoice is
  refused with `400` and the reason `invoice_forwarding_unsupported`.
- **Copies.** As TDLib's [`can_forward_message_content`][copy-invoice] copies no invoice,
  `copyMessage` answers `Bad Request: the message can't be copied`, and `copyMessages` skips the
  invoice as it skips any message it cannot copy.

A receipt is a service message of the account, which the chat's history shows as the bot sees it:

- **Replies.** The bot and the account reply to it, and the replied message shows the
  `successful_payment`.
- **Deletion.** It is deleted as any message of the chat is, and leaves the conversation; the
  invoice stays paid.
- **Edits, forwards and copies.** As for any service message, the bot's edits answer
  `Bad Request: message can't be edited`, `forwardMessage` answers
  `Bad Request: the message can't be forwarded`, `copyMessage` answers
  `Bad Request: the message can't be copied`, and the account's edit and forward are refused with
  `400` and the reasons `message_not_editable` and `message_not_forwardable`. Nothing is sent in its
  place.

## Intentional deviations

- **Explicit checkout endings.** Completion, abandonment and expiry are controls a test calls; no
  checkout ends as time passes, and only completion sends the bot an update.
- **Synthetic charge identifiers.** The receipt's charge identifiers are the emulator's own; no Star
  balance is charged and no payment provider is called.

- **No synthesized Pay button.** The returned message has no `reply_markup` for the Pay button
  Telegram's clients show; [#289][issue-289] tracks verifying the exact JSON.
- **Refused options.** Options of other payments, which Telegram supports, are refused rather than
  ignored, so a test does not pass with behavior the emulator cannot reproduce.

## Real gaps

- **Other payments.** Invoices in other currencies, payment providers, product photos, tips, invoice
  keyboards, invoices outside private chats, edits and forwards of invoices, invoice links, inline
  invoices, shipping, subscriptions, refunds, Star balances and paid media are not supported.

## Local evidence

[`sendInvoice` and `answerPreCheckoutQuery`](../../src/api/sessions/bot_api/methods/payments.ts),
[their JSON parameters](../../src/api/sessions/bot_api/invoice_parameters.ts),
[invoice checks](../../src/services/domain/invoice_normalization.ts),
[the invoice model](../../src/types/invoice.ts), [the checkout model](../../src/types/checkout.ts),
[checkout service](../../src/services/domain/checkout.ts),
[account checkout controls](../../src/api/sessions/accounts/checkouts.ts), and tests of
[invoices](../../tests/invoice_api_test.ts), [checkouts](../../tests/checkout_api_test.ts) and
[payments](../../tests/payment_completion_api_test.ts).

[json-invoice]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L2653-L2672
[input-invoice]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L13095-L13169
[process-invoice]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/InputInvoice.cpp#L105-L232
[price-parts]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/LabeledPricePart.cpp#L24-L54
[currency-amount]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/misc.cpp#L390-L393
[copy-invoice]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessageContent.cpp#L6483-L6510
[send-invoice]: https://core.telegram.org/bots/api#sendinvoice
[stars-checkout]: https://core.telegram.org/bots/payments-stars#4-checkout
[json-pre-checkout-query]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L5633-L5661
[json-successful-payment]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L3423-L3459
[answer-pre-checkout-query]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L15572-L15583
[issue-289]: https://github.com/KnightNiwrem/tg-bot-api-emulator/issues/289
