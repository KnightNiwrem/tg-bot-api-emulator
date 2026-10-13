/**
 * A session for checkout tests: an account's private chat with a shop bot that sent it an invoice,
 * the bot called through the Bot API, and the controls' refusals and a grammY bot's polling.
 */
import { assertEquals, assertRejects } from '@std/assert';
import type { Bot } from 'https://cdn.jsdelivr.net/gh/grammyjs/grammY@^1.46.0/src/bot.ts';

import { EmulationControlError } from '../../clients/typescript/emulation_client_error.ts';
import type { EmulationSessionClient } from '../../clients/typescript/emulation_session_client.ts';
import { createTestInProcessEmulator, type TestInProcessEmulator } from './emulation_api.ts';

export interface BotApiAnswer {
  readonly ok: boolean;
  readonly result?: unknown;
  readonly error_code?: number;
  readonly description?: string;
}

/** The parameters of a valid invoice, without a start parameter, as typical Stars bots send it. */
export const VALID_INVOICE = {
  title: 'Premium access',
  description: 'Unlocks every premium chapter',
  payload: 'order-42',
  currency: 'XTR',
  prices: [{ label: 'Access', amount: 50 }],
} as const;

/** The invoice as the account's checkout attempt shows it. */
export const SHOWN_INVOICE = {
  title: 'Premium access',
  description: 'Unlocks every premium chapter',
  start_parameter: '',
  currency: 'XTR',
  total_amount: 50,
} as const;

export const QUERY_INVALID = {
  ok: false,
  error_code: 400,
  description: 'Bad Request: query is too old and response timeout expired or query ID is invalid',
} as const;

/** A bot of a session, which a test calls through the Bot API by its token. */
export interface FixtureBot {
  readonly id: number;
  readonly token: string;
  call(method: string, parameters?: Record<string, unknown>): Promise<BotApiAnswer>;
  /** Reads the bot's updates since the last read, without their IDs, confirming earlier ones. */
  readUpdates(): Promise<readonly Record<string, unknown>[]>;
}

/**
 * A session where Ada and Ben have started their private chats with Shop, whose updates are read,
 * and Ada's chat holds an invoice from Shop. Ben's chat holds a text message.
 */
export async function createCheckoutFixture() {
  await using disposalOnFailure = new AsyncDisposableStack();
  const emulator = disposalOnFailure.use(createTestInProcessEmulator());
  const { result: session } = await emulator.client.createSession();
  const shop = await createFixtureBot(emulator, session, 'shop_bot');
  const { result: { account: ada } } = await session.createAccount({ first_name: 'Ada' });
  const { result: { account: ben } } = await session.createAccount({ first_name: 'Ben' });
  const shopChat = { type: 'private', botId: shop.id } as const;
  await ada.sendMessage({ to: shopChat, text: '/start' });
  await ben.sendMessage({ to: shopChat, text: '/start' });
  const invoice = await shop.call('sendInvoice', { chat_id: ada.id, ...VALID_INVOICE });
  if (!invoice.ok) {
    throw new Error(`Expected the invoice to be sent, received ${invoice.description}`);
  }
  const invoiceMessageId = (invoice.result as { readonly message_id: number }).message_id;
  await shop.readUpdates();

  const emulatorDisposal = disposalOnFailure.move();
  return {
    emulator,
    session,
    shop,
    ada,
    ben,
    shopChat,
    invoiceMessageId,
    submitAdaCheckout: async () =>
      (await ada.submitCheckout({ chat: shopChat, message_id: invoiceMessageId })).result,
    answer: (preCheckoutQueryId: string, answer: Record<string, unknown>) =>
      shop.call('answerPreCheckoutQuery', { pre_checkout_query_id: preCheckoutQueryId, ...answer }),
    [Symbol.asyncDispose]: () => emulatorDisposal.disposeAsync(),
  };
}

export async function createFixtureBot(
  emulator: TestInProcessEmulator,
  session: EmulationSessionClient,
  username: string,
): Promise<FixtureBot> {
  const { result: { token, bot } } = await session.createBot({ first_name: 'Shop', username });
  const call = async (method: string, parameters: Record<string, unknown> = {}) => {
    const response = await emulator.fetch(`${session.botApiRoot}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parameters),
    });
    return await response.json() as BotApiAnswer;
  };
  let nextOffset = 0;
  return {
    id: bot.id,
    token,
    call,
    readUpdates: async () => {
      const { result } = await call('getUpdates', { offset: nextOffset });
      const updates = result as readonly { readonly update_id: number }[];
      nextOffset = (updates.at(-1)?.update_id ?? nextOffset - 1) + 1;
      return updates.map(({ update_id: _updateId, ...update }) => update);
    },
  };
}

/** Expects a control call to be refused with the status and reason. */
export async function expectRefusal(
  call: () => Promise<unknown>,
  status: number,
  reason: string,
): Promise<void> {
  const error = await assertRejects(call, EmulationControlError);
  assertEquals([error.status, error.body.reason], [status, reason]);
}

/** Starts a grammY bot's polling, which `stop` ends and awaits. */
export function startPolling(bot: Bot) {
  const started = Promise.withResolvers<void>();
  const polling = bot.start({ onStart: () => started.resolve() });
  // `stop` reports an error the bot stops with; until then, it is not unhandled.
  polling.catch(() => {});
  return {
    started: Promise.race([started.promise, polling]),
    stop: async () => {
      await bot.stop();
      await polling;
    },
  };
}
