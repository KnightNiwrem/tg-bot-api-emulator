# Payments

[Guide index](README.md) · [Feature reference: Payments](../../features/payments.md)

This page shows how an account checks out an invoice a bot sends in Telegram Stars, how a test reads
the bot's answer to the checkout, and how it ends a checkout the bot approved. The examples use the
[shared fixture](sessions-and-fixtures.md) and the [waiting pattern](observing-bot-behavior.md).

## Checking out an invoice

`account.submitCheckout` confirms the payment of an invoice message in the account's private chat
with the bot, as the payment form's final confirmation does, and returns the pending
`CheckoutAttempt` it starts. The payment's details all come from the invoice. The bot receives a
`pre_checkout_query` whose `id` is the attempt's, and answers it asynchronously with
`answerPreCheckoutQuery`, so the test waits for that call before reading the answer with
`account.getCheckoutAttempt`. A refused attempt carries the bot's `error_message`.

An approval does not pay the invoice: it only lets the checkout proceed, and the emulator does not
complete payments yet. A bot that grants access must wait for a `successful_payment` message, which
the test below shows never arrives after an approval. `account.abandonCheckoutAttempt` ends a
pending or approved attempt, as closing the payment form does, and `account.expireCheckoutAttempt`
ends a pending one, as the bot's time to answer passing would. The bot is told of neither, and the
invoice can then be checked out again with a new query.
[Checkout](../../features/payments.md#checkout) describes the rules a checkout follows.

```ts
import { withBotFixture } from './bot_fixture.ts';
import { assertEquals, assertExists } from 'jsr:@std/assert@^1';

Deno.test('an approved checkout grants nothing until it is paid', async () => {
  const premiumUsers = new Set<number>();
  await withBotFixture({
    handlers: (bot) => {
      bot.command(
        'buy',
        (ctx) =>
          ctx.replyWithInvoice('Premium', 'Every premium chapter', 'premium', 'XTR', [
            { label: 'Premium', amount: 50 },
          ]),
      );
      bot.on('pre_checkout_query', (ctx) => ctx.answerPreCheckoutQuery(true));
      bot.on('message:successful_payment', (ctx) => {
        premiumUsers.add(ctx.from.id);
      });
    },
  }, async ({ account, activity, botProfile, privateChat }) => {
    const beforeCommand = await activity.position();
    await account.sendMessage({ to: privateChat, text: '/buy' });
    await activity.waitFor(
      { method: 'sendInvoice', chat_id: account.id, ok: true },
      { after: beforeCommand },
    );
    const invoice = (await account.getMessages({ chat: privateChat })).find((message) =>
      message.from.id === botProfile.id && message.invoice !== undefined
    );
    assertExists(invoice);

    const { result: attempt, receipt } = await account.submitCheckout({
      chat: privateChat,
      message_id: invoice.message_id,
    });
    assertEquals(attempt.invoice.total_amount, 50);
    await activity.waitFor({
      method: 'answerPreCheckoutQuery',
      ok: true,
      parameters: { pre_checkout_query_id: attempt.id },
    }, { after: receipt });

    const answered = await account.getCheckoutAttempt(attempt.id);
    assertEquals(answered.status, 'approved');
    assertEquals(premiumUsers.has(account.id), false);

    const { result: abandoned } = await account.abandonCheckoutAttempt(attempt.id);
    assertEquals(abandoned.status, 'abandoned');
    assertEquals(premiumUsers.has(account.id), false);
  });
});
```
