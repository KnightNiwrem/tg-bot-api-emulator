/**
 * The reusable test setup of the TypeScript client guide, which
 * [Sessions and fixtures](sessions-and-fixtures.md) explains. Each test gets its own emulation
 * session with one grammY bot and one account, and the fixture stops the bot and ends the session
 * however the test finishes.
 */
import { Bot, type PollingOptions } from 'npm:grammy@1.46.0';
import {
  type BotActivityLog,
  type CreateVirtualAccountInput,
  type CreateVirtualBotInput,
  type EmulationSessionClient,
  type PrivateMessageTarget,
  TelegramEmulationClient,
  type VirtualAccountClient,
  type VirtualBotProfile,
} from '../../../clients/typescript/mod.ts';

/** Where `deno task start` serves the emulator by default. */
export const EMULATOR_URL = 'http://localhost:8081';

export interface BotFixtureOptions {
  /** Registers the bot's handlers; the fixture starts polling once they are in place. */
  readonly handlers: (bot: Bot) => void;
  /** Overrides the bot's registration, which defaults to `Test Bot` with username `test_bot`. */
  readonly bot?: Partial<CreateVirtualBotInput>;
  /** Overrides the account's registration, which defaults to `Ada`. */
  readonly account?: Partial<CreateVirtualAccountInput>;
  /**
   * The update types the bot polls for, such as `message_reaction`, which bots receive only when
   * they ask for it; omitted for Telegram's default subscription.
   */
  readonly allowedUpdates?: PollingOptions['allowed_updates'];
}

export interface BotFixture {
  /** The emulation session that owns the bot, the account, and everything they create. */
  readonly session: EmulationSessionClient;
  /** The bot as Telegram describes it, including its `id` and `username`. */
  readonly botProfile: VirtualBotProfile;
  /** The grammY bot under test, polling the session's Bot API root. */
  readonly bot: Bot;
  /** The virtual account that talks to the bot. */
  readonly account: VirtualAccountClient;
  /** The account's private chat with the bot. */
  readonly privateChat: PrivateMessageTarget;
  /** The bot's calls and updates, in the order the emulator decided them. */
  readonly activity: BotActivityLog;
}

/**
 * Runs `test` against a fresh session whose bot polls with the given handlers. The bot stops and
 * the session ends even when the test fails, and an error the bot's polling ends with fails the
 * test.
 */
export async function withBotFixture(
  options: BotFixtureOptions,
  test: (fixture: BotFixture) => Promise<void>,
): Promise<void> {
  const session = await new TelegramEmulationClient(EMULATOR_URL).createSession();
  try {
    const { token, bot: botProfile } = await session.createBot({
      first_name: 'Test Bot',
      username: 'test_bot',
      ...options.bot,
    });
    const { account } = await session.createAccount({ first_name: 'Ada', ...options.account });
    const bot = new Bot(token, { client: { apiRoot: session.botApiRoot } });
    options.handlers(bot);
    const pollingStarted = Promise.withResolvers<void>();
    const polling = bot.start({
      allowed_updates: options.allowedUpdates,
      onStart: () => pollingStarted.resolve(),
    });
    // `await polling` below reports an error the bot stops with; until then, it is not unhandled.
    polling.catch(() => {});
    try {
      // A bot stopped before it polls leaves grammY's startup retries rejecting unhandled.
      await Promise.race([pollingStarted.promise, polling]);
      await test({
        session,
        botProfile,
        bot,
        account,
        privateChat: { type: 'private', botId: botProfile.id },
        activity: session.botActivity({ bot_id: botProfile.id }),
      });
    } finally {
      await bot.stop();
      await polling;
    }
  } finally {
    await session.end();
  }
}
