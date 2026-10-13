# Payments

[Guide index](README.md) · [Feature reference: Payments](../../features/payments.md)

This page shows how an account checks out and pays an invoice a bot sends in Telegram Stars, how a
test reads the bot's answer to the checkout, and how it checks that only the payment unlocks what
the bot sells. The examples use the [shared fixture](sessions-and-fixtures.md) and the
[waiting pattern](observing-bot-behavior.md).

## Checking out an invoice

`account.submitCheckout` confirms the payment of an invoice message in the account's private chat
with the bot, as the payment form's final confirmation does, and returns the pending
`CheckoutAttempt` it starts. The payment's details all come from the invoice. The bot receives a
`pre_checkout_query` whose `id` is the attempt's, and answers it asynchronously with
`answerPreCheckoutQuery`, so the test waits for that call before reading the answer with
`account.getCheckoutAttempt`. A refused attempt carries the bot's `error_message`.

An approval does not pay the invoice: it only lets the checkout proceed. A bot that grants access
must wait for a `successful_payment` message, which arrives only once the account completes the
approved attempt. `account.abandonCheckoutAttempt` ends a pending or approved attempt unpaid, as
closing the payment form does, and `account.expireCheckoutAttempt` ends a pending one, as the bot's
time to answer passing would. The bot is told of neither, and the invoice can then be checked out
again with a new query. [Checkout](../../features/payments.md#checkout) describes the rules a
checkout follows.

## Paying an invoice

`account.completeCheckoutAttempt` pays the invoice of an approved attempt. The bot receives the
account's `successful_payment` service message in an ordinary `message` update, with the invoice's
currency, total and payload, and charge identifiers whose format is the emulator's own. The
completed attempt shows its `payment`, whose `receipt_message_id` is that message, so a test waits
for the bot's reaction to it, here a reply. A paid invoice can never be checked out again.
[Completion](../../features/payments.md#completion) describes the rules a payment follows.

```ts
import { withBotFixture } from './bot_fixture.ts';
import { assertEquals, assertExists } from 'jsr:@std/assert@^1';

Deno.test('only the payment of an approved checkout grants access', async () => {
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
        return ctx.reply('Premium unlocked', {
          reply_parameters: { message_id: ctx.message.message_id },
        });
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

    // A checkout the bot approves grants nothing, and the account abandons it unpaid.
    const checkOut = async () => {
      const { result: attempt, receipt } = await account.submitCheckout({
        chat: privateChat,
        message_id: invoice.message_id,
      });
      await activity.waitFor({
        method: 'answerPreCheckoutQuery',
        ok: true,
        parameters: { pre_checkout_query_id: attempt.id },
      }, { after: receipt });
      return await account.getCheckoutAttempt(attempt.id);
    };
    const abandoned = await checkOut();
    assertEquals(abandoned.status, 'approved');
    await account.abandonCheckoutAttempt(abandoned.id);
    assertEquals(premiumUsers.has(account.id), false);

    // Only the payment of the next approved checkout does.
    const approved = await checkOut();
    const { result: paid, receipt } = await account.completeCheckoutAttempt(approved.id);
    assertEquals(paid.invoice.total_amount, 50);
    await activity.waitFor({
      method: 'sendMessage',
      ok: true,
      parameters_json: { reply_parameters: { message_id: paid.payment.receipt_message_id } },
    }, { after: receipt });
    assertEquals(premiumUsers.has(account.id), true);
  });
});
```
