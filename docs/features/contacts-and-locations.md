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
[`Contact::validate`][contact-validate] cleans each text as it cleans names, turning control
characters into spaces, and refuses text that is not well-formed Unicode with an error naming it,
such as `Bad Request: phone number must be encoded in UTF-8` or
`Bad Request: vCard must be encoded in UTF-8`. Nothing else of a contact is read: the phone number
keeps any form its sender wrote, such as `+1 (555) 010-0200`, and the vCard is never parsed, as
Telegram does not parse it. TDLib's [`contact`][td-contact] object documents names of 1–64
characters, and the Bot API documents vCards of at most 2048 bytes; the emulator refuses longer
names and vCards with the method's invalid-parameters error, because the open-source code does not
show how Telegram's servers refuse them. In supergroups a contact needs `can_send_messages`, as
[`can_send_message_content`][send-permission] requires.

### Whose contact it is

Telegram's servers, not TDLib, attach a contact's `user_id`, and the emulator never looks a user up
by phone number. So `user_id` appears only on an account's own contact, whose phone number the
emulator knows to be the account's:

- **Own contact.** An account created with `phone_number`, the digits of an E.164 number without its
  `+` as Telegram's `user.phone` holds them, shares its own contact with `own_contact: true` or the
  TypeScript client's `shareOwnContact`. The contact shows that number, the account's first and last
  name, and the account's ID as its `user_id`, so a bot can compare `contact.user_id` with
  `from.id`. An account created without a phone number has no contact of its own; sharing it fails
  with `409` and sends nothing.
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

## Intentional deviations

- **Explicit phone numbers.** Accounts have no phone number unless a test gives one, because
  inventing numbers would hide which contact a test expects. The emulator shows the number only in
  the account's own contact.
- **Refusing over-long names and vCards.** Names longer than TDLib documents and vCards longer than
  the Bot API documents are refused rather than passed on to an unknown server-side outcome.

## Real gaps

- **Address books.** Telegram's servers attach the `user_id` of a written contact whose number
  belongs to a user, which depends on phone number privacy and the sender's contacts. The emulator
  models no address book or phone number lookup, so written and bot contacts never show a user.
- **Locations.** Location messages and `request_location` buttons are not supported yet.

## Local evidence

[Contact type](../../src/types/contact.ts),
[content normalization](../../src/services/message_content.ts),
[Bot API handler](../../src/api/sessions/bot_api/mod.ts),
[account routes](../../src/api/sessions/accounts/mod.ts) and
[contact tests](../../tests/contact_api_test.ts).

[json-contact]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L2589-L2610
[send-contact]: https://github.com/tdlib/telegram-bot-api/blob/e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1/telegram-bot-api/Client.cpp#L14243-L14252
[contact-validate]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/Contact.cpp#L40-L54
[td-contact]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/generate/scheme/td_api.tl#L634-L640
[edit-media]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessagesManager.cpp#L23294-L23310
[send-permission]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/MessageContent.cpp#L6247-L6251
[td-keyboard-button]: https://github.com/tdlib/td/blob/bc9c263e2bfee06aaab41e82db51a103376030bc/td/telegram/KeyboardButton.cpp#L82-L179
[desktop-request-phone]: https://github.com/telegramdesktop/tdesktop/blob/64ca5475f24dde7331a388176d3fe60c0849b965/Telegram/SourceFiles/api/api_bot.cpp#L385-L409
[android-share-contact]: https://github.com/DrKLO/Telegram/blob/f2908b14133bbffbf7ab04f641ecb5bfaf533242/TMessagesProj/src/main/java/org/telegram/ui/ChatActivity.java#L12989-L13023
