# tg-bot-api-emulator

An HTTP server for emulating the Telegram Bot API in end-to-end tests. Create isolated sessions,
register virtual bots and accounts, drive user actions, wait for the bots' calls in the order they
make them, and inspect the resulting conversations. Bots connect through their usual Bot API clients
using a session-specific API root.

The emulator supports private chats and supergroups, polling and webhooks, text, photos, documents,
videos, albums of photos and videos or of documents, rich messages, keyboards, inline queries, and
selected moderation methods. See the [feature documentation](docs/features/README.md) for the
complete method inventory, missing features, and known differences from the official Bot API server
and TDLib.

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
[client walkthrough](docs/typescript-client.md) covers driving more involved interactions.
[openapi/openapi.yaml](openapi/openapi.yaml) describes the HTTP interface; entries marked
`x-implementation-status: unimplemented` are placeholders. Each path item lives in `openapi/paths/`,
named after its URL path with `/` replaced by `_`, and each reusable schema, parameter, and response
lives in `openapi/components/`, named after the component.

## Commands

- `deno task start` — start the server using the environment described below
- `deno task dev` — start the server with file watching
- `deno task test` — run tests
- `deno task lint` — lint files
- `deno task fmt` — format files
- `deno task fmt:check` — check formatting
- `deno task check` — type-check source and test files
- `deno task openapi:lint` — lint the OpenAPI description with Redocly's recommended rules
- `deno task architecture:check` — check that imports respect the layer boundaries set in
  `.fallowrc.json`

## Environment

- `DOMAIN` — domain advertised to clients; defaults to `localhost`
- `PORT` — listening and advertised port; defaults to `8081`

## License

The project is almost entirely AI-generated. [COPYRIGHT.md](COPYRIGHT.md) records its provenance and
dedicates any rights the maintainer holds under [CC0 1.0 Universal](LICENSE).
