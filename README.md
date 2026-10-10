# tg-bot-api-emulator

An HTTP server for emulating the Telegram Bot API in end-to-end tests. Create isolated sessions,
register virtual bots and accounts, drive user actions, wait for the bots' calls in the order they
make them, and inspect the resulting conversations. Bots connect through their usual Bot API clients
using a session-specific API root.

The emulator supports private chats and supergroups, polling and webhooks, text, photos, documents,
videos, voice notes, audio files, albums of photos and videos, of documents or of audio files, rich
messages, polls, contacts, static locations, pinned messages, emoji reactions in supergroups, invite
links, keyboards, inline queries, and selected moderation methods. See the
[feature documentation](docs/features/README.md) for the complete method inventory, missing
features, and known differences from the official Bot API server and TDLib.

## Getting started

With Deno installed, run the server from the repository root:

```sh
deno task start
```

The default address is `http://localhost:8081`. Tests can use the bundled
[TypeScript client](clients/typescript/mod.ts) to create their fixtures:

```ts
import { TelegramEmulationClient } from './clients/typescript/mod.ts';

const emulator = new TelegramEmulationClient('http://localhost:8081');
const session = await emulator.createSession();

try {
  const { token, bot } = await session.createBot({
    first_name: 'Test Bot',
    username: 'test_bot',
  });
  const { account } = await session.createAccount({ first_name: 'Ada' });
  await account.sendMessage({
    to: { type: 'private', botId: bot.id },
    text: '/start',
  });

  // A bot framework can use token and session.botApiRoot as its apiRoot.
  // This example reads the bot's pending updates directly.
  const response = await fetch(`${session.botApiRoot}/bot${token}/getUpdates`);
  if (!response.ok) throw new Error(await response.text());
  console.log(await response.json());
} finally {
  await session.end();
}
```

Save the example at the repository root and run it with `deno run --allow-net <filename>.ts`. The
[TypeScript client guide](docs/clients/typescript/README.md) goes from there to complete tests: its
[getting started](docs/clients/typescript/getting-started.md) page runs a grammY bot against the
emulator and asserts its reply, and its topic pages cover more involved interactions.
[openapi/openapi.yaml](openapi/openapi.yaml) describes the HTTP interface; entries marked
`x-implementation-status: unimplemented` are placeholders. Each path item lives in `openapi/paths/`,
named after its URL path with `/` replaced by `_`, and each reusable schema, parameter, and response
lives in `openapi/components/`, named after the component.

Tests hold the server to that description: every response an in-process test API gives is checked
against the operation and status the description documents for it, its headers, media type, and
body, and a departure fails the test. Requests are only classified as valid or invalid, because
tests send invalid ones on purpose; Bot API requests stay unclassified, because Telegram's parameter
conventions are more than the schemas model. A request to an undocumented route fails too, unless
`tests/support/openapi_conformance/undocumented_route_allowances.ts` lists it as one tests send on
purpose.

## Commands

- `deno task start` — start the server using the environment described below
- `deno task dev` — start the server with file watching
- `deno task test` — run tests
- `deno task lint` — lint files
- `deno task fmt` — format files
- `deno task fmt:check` — check formatting
- `deno task check` — type-check source and test files, and the TypeScript examples of this README
  and the [TypeScript client guide](docs/clients/typescript/README.md). This includes
  [checking the emitted Bot API objects' types](tests/bot_api_type_conformance_test.ts) against
  grammY's types at a pinned version, with the known deviations listed there.
- `deno task openapi:lint` — lint the OpenAPI description with Redocly's recommended rules
- `deno task openapi:coverage` — run the tests and report which documented operations and statuses
  they exercised
- `deno task architecture:check` — check that imports respect the layer boundaries set in
  `.fallowrc.json`
- `deno task lock:update` — resolve `deno.lock` again after a dependency changes in `deno.json`

## Dependencies

CI runs the Deno version in `.dvmrc`. The import map in `deno.json` pins every external dependency,
including the Redocly and fallow tools, at an exact version, and `deno.lock` records what each one
resolved to, with integrity hashes. Every task uses the lockfile frozen, so a dependency that is
missing from it or whose content changed fails the task instead of resolving anew.

Source, test and client code import external packages only through import map aliases such as
`grammy`. grammY and its runner and auto-retry plugins map to grammY's Deno source modules at exact
release tags: the npm build passes Node-specific request options, such as `abort-controller`
signals, to a custom `fetch`, which the tests' in-process `fetch` cannot accept. The guide's
examples are meant to be copied, so they name registry packages in full, such as
`npm:grammy@1.46.0`, at the versions the import map pins.
[`tests/dependency_specifiers_test.ts`](tests/dependency_specifiers_test.ts) checks these rules.

To add or bump a dependency, set its exact version in `deno.json` and in any guide examples that
name it, run `deno task lock:update`, and commit the `deno.lock` diff with the change. The task
resolves the whole graph again, so review the diff for transitive changes too.

## Environment

- `DOMAIN` — domain advertised to clients; defaults to `localhost`
- `PORT` — listening and advertised port; defaults to `8081`

## License

The project is almost entirely AI-generated. [COPYRIGHT.md](COPYRIGHT.md) records its provenance and
dedicates any rights the maintainer holds under [CC0 1.0 Universal](LICENSE).
