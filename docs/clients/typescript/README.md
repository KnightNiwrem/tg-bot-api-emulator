# TypeScript client guide

[Project README](../../../README.md) · [Feature reference](../../features/README.md)

The TypeScript client, [`clients/typescript/mod.ts`](../../../clients/typescript/mod.ts), lets a
test act as Telegram users, wait for what a bot does, and inspect the result. The bot under test is
ordinary Bot API code: it talks to the emulator because its API root points at the session.

This guide teaches how to use the client, with complete, runnable tests. What the emulator does in
response, such as which parameters a method supports and where it differs from Telegram, is
described once, in the [feature reference](../../features/README.md), which each page links to.

## Core path

Read these in order. Together they take you from nothing to tests that synchronize with a bot
reliably.

1. [Getting started](getting-started.md): start the emulator, run a grammY bot against it, send a
   command and assert the bot's reply.
2. [Sessions and fixtures](sessions-and-fixtures.md): what a session, a bot and an account are, and
   the reusable fixture the other pages use.
3. [Observing bot behavior](observing-bot-behavior.md): waiting for the bot without sleeping,
   correlating waits with the right call, ordering, and asserting that something did not happen.
4. [Messages](messages.md): conversations with replies, edits, deletions, forwards, pins and
   blocking.

## Topics

Each topic page stands on its own once you know the core path.

| Page                                                        | Covers                                                                       |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [Buttons and menus](buttons-and-menus.md)                   | Inline keyboards, callback queries, reply keyboards, command menus           |
| [Rich messages](rich-messages.md)                           | Reading rich messages as text and pressing their buttons                     |
| [Media and files](media-and-files.md)                       | Photos, documents, videos, voice notes, audio, albums, captions, downloads   |
| [Polls](polls.md)                                           | Voting, retracting votes, poll updates and closing polls                     |
| [Reactions](reactions.md)                                   | Reacting to supergroup messages, reaction updates and bots' reactions        |
| [Contacts and locations](contacts-and-locations.md)         | Sharing contacts and locations, and the buttons that request them            |
| [Inline mode](inline-mode.md)                               | Inline queries, their answers, chosen results and inline messages            |
| [Supergroups](supergroups.md)                               | Creating groups, membership, privacy mode, bot-to-bot messages and settings  |
| [Permissions and moderation](permissions-and-moderation.md) | Administrators, rights, restrictions and default permissions                 |
| [Invite links](invite-links.md)                             | Links bots create, joining through them and join requests                    |
| [Test controls](test-controls.md)                           | Rate limits, server errors, webhook retries, expiries, emulated web, uploads |

## Reference

- [API index](api-index.md) lists every client operation and the page that shows it.
- [Troubleshooting](troubleshooting.md) explains common failures and how to read them.

## Running the examples

Every example is a complete Deno test whose imports are relative to this directory, where the
fixture, [`bot_fixture.ts`](bot_fixture.ts), already is. Start the emulator with `deno task start`
from the repository root, save an example here, and run it with
`deno test --allow-net --allow-env <file>`.
