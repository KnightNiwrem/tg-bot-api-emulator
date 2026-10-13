# Payments

[Feature index and comparison baseline](README.md) · [Messages](messages.md) ·
[Keyboards and callbacks](keyboards-and-callbacks.md)

Payments are partially supported. Bots send one-off invoices in Telegram Stars to their private
chats with accounts. Accounts cannot check out yet, so no `pre_checkout_query` or
`successful_payment` reaches a bot: checkout with `answerPreCheckoutQuery`, then payment completion,
receipts and their inspection, are planned as the next steps of the same feature.

## Sending invoices

`sendInvoice` sends an invoice to the bot's private chat with an account that started it, as any
message is sent there. The invoice message shows its `invoice` in the fields of the official
server's [`JsonInvoice`][json-invoice]: `title`, `description`, `start_parameter`, `currency` and
`total_amount`. It never shows the bot's `payload`, which the invoice keeps exactly as sent for its
later checkout, nor a receipt. `start_parameter` is always present, empty for an invoice sent
without one. The bot receives no update for its own invoice, and the account's conversation history
shows it as the bot sees it.

Telegram's clients show a Pay button on an invoice sent without a keyboard. The emulator returns no
`reply_markup` for it: the Bot API documents the button that clients show, but not whether the
returned message carries it.

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

## Invoices among other messages

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

## Intentional deviations

- **No synthesized Pay button.** The returned message has no `reply_markup` for the Pay button
  Telegram's clients show; [#289][issue-289] tracks verifying the exact JSON.
- **Refused options.** Options of other payments, which Telegram supports, are refused rather than
  ignored, so a test does not pass with behavior the emulator cannot reproduce.

## Real gaps

- **Checkout and payment.** Accounts cannot submit a checkout, so bots receive no
  `pre_checkout_query`, `answerPreCheckoutQuery` is not implemented, and no `successful_payment`
  completes an invoice. These are the next stages of the payments feature.
- **Other payments.** Invoices in other currencies, payment providers, product photos, tips, invoice
  keyboards, invoices outside private chats, edits and forwards of invoices, invoice links, inline
  invoices, shipping, subscriptions, refunds, Star balances and paid media are not supported.

## Local evidence

[`sendInvoice`](../../src/api/sessions/bot_api/methods/payments.ts),
[its JSON parameters](../../src/api/sessions/bot_api/invoice_parameters.ts),
[invoice checks](../../src/services/domain/invoice_normalization.ts),
[the invoice model](../../src/types/invoice.ts), and [tests](../../tests/invoice_api_test.ts).

[json-invoice]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L2653-L2672
[input-invoice]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L13095-L13169
[process-invoice]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/InputInvoice.cpp#L105-L232
[price-parts]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/LabeledPricePart.cpp#L24-L54
[currency-amount]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/misc.cpp#L390-L393
[copy-invoice]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessageContent.cpp#L6483-L6510
[send-invoice]: https://core.telegram.org/bots/api#sendinvoice
[issue-289]: https://github.com/KnightNiwrem/tg-bot-api-emulator/issues/289
