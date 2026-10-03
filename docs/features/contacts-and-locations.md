# Contacts and locations

[Feature index and comparison baseline](README.md) · [Messages](messages.md) ·
[Keyboards and callbacks](keyboards-and-callbacks.md) · [Supergroups](supergroups.md)

## Contacts

Bots send phone contacts with `sendContact`, and accounts send them through the messages route, in
private chats and supergroups. A contact message shows its `contact` in the fields of the official
server's [`JsonContact`][json-contact]: `phone_number`, `first_name`, and `last_name`, `vcard` and
`user_id` when present. It carries no text or caption, so it has nothing to quote and no text or
caption to edit; as TDLib's [`can_edit_message_media`][edit-media] refuses it, its media cannot be
replaced either, while a bot may still edit its inline keyboard.

As the official server's [`process_send_contact_query`][send-contact] does, `sendContact` requires a
nonempty `phone_number` and `first_name`, with `Bad Request: parameter "phone_number" is required`
or `Bad Request: parameter "first_name" is required`, before it looks at the chat. TDLib's
[`Contact::validate`][contact-validate] cleans each text with `clean_input_string`, which turns
control characters other than line feeds into spaces and removes carriage returns and a few
formatting characters, and refuses text that is not well-formed Unicode with an error naming it,
such as `Bad Request: phone number must be encoded in UTF-8` or
`Bad Request: vCard must be encoded in UTF-8`. A phone number or first name that cleaning empties,
such as one of only carriage returns, is refused with `Bad Request: phone number must be non-empty`
or `Bad Request: first name must be non-empty`, where TDLib would pass it on to Telegram's servers.
Nothing else of a contact is read: the phone number keeps any form its sender wrote, such as
`+1 (555) 010-0200`, and the vCard is never parsed, as Telegram does not parse it. TDLib's
[`contact`][td-contact] object documents first names of 1–64 characters and last names of 0–64, and
the Bot API documents vCards of at most 2048 bytes; the emulator refuses longer names and vCards
with the method's invalid-parameters error, because the open-source code does not show how
Telegram's servers refuse them. In supergroups a contact needs `can_send_messages`, as
[`can_send_message_content`][send-permission] requires.

### Whose contact it is

Telegram's servers, not TDLib, attach a contact's `user_id`, and the emulator never looks a user up
by phone number. So `user_id` appears only on an account's own contact, whose phone number the
emulator knows to be the account's:

- **Own contact.** An account created with `phone_number`, the digits of an E.164 number without its
  `+` as Telegram's `user.phone` holds them, shares its own contact with `own_contact: true` or the
  TypeScript client's `shareOwnContact`. The contact shows that number, the account's first and last
  name, which account creation limits to 64 characters as Telegram's servers limit a user's names,
  and the account's ID as its `user_id`, so a bot can compare `contact.user_id` with `from.id`. An
  account created without a phone number has no contact of its own; sharing it fails with `409` and
  sends nothing.
- **Written contact.** Any other contact an account sends, with `contact` or the TypeScript client's
  `sendContact`, shows no `user_id`, even when it carries the account's own number or another
  account's.
- **Bot contact.** A bot names no user, as `process_send_contact_query` passes none, so its contacts
  show no `user_id` either.

### Answering contact requests

A reply keyboard button with `request_contact` asks the client for the user's phone number. Pressing
it through `reply-keyboard-presses`, or the TypeScript client's `pressReplyKeyboardButton`, shares
the account's own contact in reply to the keyboard's message, as Telegram Desktop's
[`ActivateBotCommand`][desktop-request-phone] and Telegram for Android's
[`shareMyContact`][android-share-contact] do once the user confirms. Nothing else ties the message
to the keyboard: the bot receives an ordinary contact message, and accounts share contacts without
any keyboard just as well. As TDLib's [`KeyboardButton::get_keyboard_button`][td-keyboard-button]
allows request buttons only in private chats, only private chats show such buttons. An account
without a phone number gets `409`, and nothing is sent.

## Locations

Bots send static locations with `sendLocation`, and accounts share them through the messages route,
in private chats and supergroups. A location message shows its `location` in the fields of the
official server's [`JsonLocation`][json-location]: `latitude`, `longitude`, and
`horizontal_accuracy` when known. Like a contact, it carries no text or caption, its media cannot be
replaced, and a bot may still edit its inline keyboard. In supergroups a location needs
`can_send_messages`, as [`can_send_message_content`][location-permission] requires and the
[permission rules](supergroups.md#member-restrictions) give it to owners, administrators and other
members. A bot without it gets `Bad Request: not enough rights to send locations to the chat`, and
an account `403`.

As the official server's [`get_location`][get-location] reads them, `sendLocation` requires a
`latitude` and a `longitude`, which it trims, with `Bad Request: latitude is empty` or
`Bad Request: longitude is empty`. The emulator reads each as a decimal number, possibly with an
exponent; other text, such as `NaN`, is refused with the method's invalid-parameters error, where
the official server would read it as 0. As TDLib's [`Location::init`][location-init] decides,
coordinates that are not finite or lie outside -90–90 and -180–180 degrees name no location:
`Bad Request: invalid location specified`, as [`process_input_message_location`][input-location]
reports it. TDLib checks that once it has found the chat; the emulator checks it before the chat.

The accuracy is the radius of uncertainty in meters, which the Bot API documents as 0–1500. TDLib's
[`get_input_geo_point`][geo-point] sends it to Telegram rounded up to whole meters, so a location
shows `12.2` as `13`, and 0 means unknown and is omitted. TDLib's [`fix_accuracy`][fix-accuracy]
clamps an accuracy outside 0–1500 meters; the emulator refuses it instead. Accounts report the same
coordinates and accuracy, which the emulation API checks against the same ranges.

### Static locations only

Live locations are [not supported](#real-gaps). The official server's
[`process_send_location_query`][send-location] sends a live location for any nonzero `live_period`
and passes `heading` and `proximity_alert_radius` with it. The emulator rejects all three parameters
as unknown, with `Bad Request: invalid sendLocation parameters`, even a `live_period` of 0 or a
`heading` without a live period, which send a static location on Telegram. Accounts' locations take
none of them either, and `editMessageLiveLocation` and `stopMessageLiveLocation` answer `404` like
every other unimplemented method.

### Answering location requests

A reply keyboard button with `request_location` asks the client for the user's current location. The
emulator has no device location, so the press reports one: `reply-keyboard-presses` takes it as
`location`, and the TypeScript client's `pressReplyKeyboardButton` as its `location` input. The
press shares it in reply to the keyboard's message, as Telegram for Android's
[`sendLocation`][android-send-location] replies with the device's location; Telegram Desktop cannot
share a location. As for contacts, nothing else ties the message to the keyboard, and accounts share
locations without any keyboard just as well. A location button pressed without a location, a
location given for any other button, or one given in a supergroup, where no button requests
anything, answers `400`, and nothing is sent.

## Forwards, copies and replies

Contacts and locations travel like other content. A forward, by a bot or an account, and a copy
repeat the contact or location unchanged, and a copy ignores a replacement caption, which neither
has. TDLib's `dup_message_content` copies both whole, the [contact][dup-contact] and the
[location][dup-location], so a copy of an account's own contact still shows that account as its
`user_id`; the emulator keeps it, as the number still belongs to that account, rather than looking
the user up again. In a supergroup, forwarding or copying either needs `can_send_messages`, as
sending does. A reply from another chat shows the replied contact or location in `external_reply`,
as TDLib's [`is_supported_reply_message_content`][reply-content] keeps both, and neither gives the
reply a quote, as neither has text.

Both reach bots as ordinary `message` updates, through polling or webhooks, subject to the bot's
`allowed_updates`, to [privacy mode](supergroups.md#privacy-mode) in supergroups, and to
[bot activity](bot-activity.md) recording. No bot receives an update for its own contact or
location, and account histories show both, as bots see them.

## Intentional deviations

- **Explicit phone numbers.** Accounts have no phone number unless a test gives one, because
  inventing numbers would hide which contact a test expects. The emulator shows the number only in
  the account's own contact.
- **Refusing over-long names and vCards, and emptied required texts.** Names longer than TDLib
  documents, vCards longer than the Bot API documents, and phone numbers and first names that
  cleaning empties are refused rather than passed on to an unknown server-side outcome.
- **Strict location parameters.** Coordinates that are not decimal numbers, accuracies outside the
  documented 0–1500 meters, and every live location parameter are refused, where Telegram reads them
  as 0, clamps them, or ignores them, so that a bot's mistake surfaces in tests.

## Real gaps

- **Address books.** Telegram's servers attach the `user_id` of a written contact whose number
  belongs to a user, which depends on phone number privacy and the sender's contacts. The emulator
  models no address book or phone number lookup, so written and bot contacts never show a user.
- **Live locations.** Live periods, headings, proximity alerts, and editing or stopping a live
  location are missing, as are venues.

## Local evidence

[Contact type](../../src/types/contact.ts), [location type](../../src/types/geo_location.ts),
[content normalization](../../src/services/message_content.ts),
[Bot API handler](../../src/api/sessions/bot_api/mod.ts),
[account routes](../../src/api/sessions/accounts/mod.ts) and
[contact tests](../../tests/contact_api_test.ts), [location tests](../../tests/location_api_test.ts)
and [forward, copy, reply and delivery tests](../../tests/contact_location_reuse_api_test.ts).

[json-contact]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L2589-L2610
[send-contact]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L14243-L14252
[contact-validate]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/Contact.cpp#L40-L54
[td-contact]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/generate/scheme/td_api.tl#L634-L640
[edit-media]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessagesManager.cpp#L23294-L23310
[send-permission]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessageContent.cpp#L6247-L6251
[td-keyboard-button]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/KeyboardButton.cpp#L82-L179
[desktop-request-phone]: https://github.com/telegramdesktop/tdesktop/blob/64ca5475f24dde7331a388176d3fe60c0849b965/Telegram/SourceFiles/api/api_bot.cpp#L385-L409
[json-location]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L1164-L1178
[get-location]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L12488-L12501
[send-location]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L14197-L14211
[location-init]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/Location.cpp#L27-L38
[fix-accuracy]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/Location.cpp#L17-L25
[geo-point]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/Location.cpp#L90-L102
[input-location]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/Location.cpp#L158-L177
[location-permission]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessageContent.cpp#L6296-L6300
[android-send-location]: https://github.com/DrKLO/Telegram/blob/f2908b14133bbffbf7ab04f641ecb5bfaf533242/TMessagesProj/src/main/java/org/telegram/messenger/SendMessagesHelper.java#L3636-L3645
[dup-contact]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessageContent.cpp#L10193-L10194
[dup-location]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessageContent.cpp#L10257-L10258
[reply-content]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessageContentType.cpp#L848-L884
[android-share-contact]: https://github.com/DrKLO/Telegram/blob/f2908b14133bbffbf7ab04f641ecb5bfaf533242/TMessagesProj/src/main/java/org/telegram/ui/ChatActivity.java#L12989-L13023
