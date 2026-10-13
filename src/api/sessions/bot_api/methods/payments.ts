import { z } from 'zod';

import type { PreCheckoutQueryAnswer } from '../../../../types/checkout.ts';
import {
  isCurrencyAmountInRange,
  type LabeledPrice,
  TELEGRAM_STARS_CURRENCY,
} from '../../../../types/invoice.ts';
import { BOT_API_ERRORS } from '../errors/error_catalogue.ts';
import { presentBotApiError, presentFixedBotApiError } from '../errors/error_template.ts';
import { presentMessageSendingFailure } from '../errors/message_sending_failure_presenter.ts';
import {
  readMaxTipAmountParameter,
  readPricesParameter,
  readSuggestedTipAmountsParameter,
  type UnsupportedInvoiceOption,
} from '../invoice_parameters.ts';
import {
  type BotApiFamilyContext,
  type BotApiMethod,
  type BotApiMethodAnswer,
  botApiResult,
} from '../method_call.ts';
import {
  answerWith,
  answerWithBadRequest,
  type BotApiStepCall,
  type BotApiStepResult,
  commandMethodOfSteps,
  proceedWith,
  startSteps,
} from '../method_steps.ts';
import { booleanParameter, integerParameter } from '../request_parameters.ts';
import {
  readSendOptions,
  replyMarkupParametersShape,
  sendOptionsParametersShape,
  type SendRequestOptions,
} from '../send_options.ts';

/**
 * What the payment methods use: the sender of the bot's messages, which sends its invoices, and the
 * checkouts, whose pre-checkout queries the bot answers.
 */
type PaymentContext = BotApiFamilyContext<'botMessageSending' | 'checkouts'>;

// As for sendMessage, topics, business connections, paid broadcasts, and suggested posts are not
// supported. The fields that the Bot API documents as ignored for payments in Telegram Stars, which
// ask for the payer's details or shipping, are read and ignored; the emulator creates no shipping
// queries or order information. Options of other payments are refused with the emulator's own
// descriptions, as `readUnsupportedInvoiceOption` finds them.
const sendInvoiceParametersSchema = z.strictObject({
  ...sendOptionsParametersShape,
  ...replyMarkupParametersShape,
  title: z.string().default(''),
  description: z.string().default(''),
  payload: z.string().default(''),
  provider_token: z.string().default(''),
  currency: z.string().default(''),
  prices: z.string().default(''),
  max_tip_amount: z.string().optional(),
  suggested_tip_amounts: z.string().optional(),
  start_parameter: z.string().default(''),
  provider_data: z.string().default(''),
  photo_url: z.string().default(''),
  photo_size: integerParameter(z.int()).default(0),
  photo_width: integerParameter(z.int()).default(0),
  photo_height: integerParameter(z.int()).default(0),
  need_name: booleanParameter().optional(),
  need_phone_number: booleanParameter().optional(),
  need_email: booleanParameter().optional(),
  need_shipping_address: booleanParameter().optional(),
  send_phone_number_to_provider: booleanParameter().optional(),
  send_email_to_provider: booleanParameter().optional(),
  is_flexible: booleanParameter().optional(),
});

type SendInvoiceParameters = z.output<typeof sendInvoiceParametersSchema>;

// As the official server's `process_answer_pre_checkout_query_query` reads them, `ok` is false
// unless given, and only a refusal reads `error_message`.
const answerPreCheckoutQueryParametersSchema = z.strictObject({
  pre_checkout_query_id: z.string().default(''),
  ok: booleanParameter().default(false),
  error_message: z.string().default(''),
});

type AnswerPreCheckoutQueryParameters = z.output<typeof answerPreCheckoutQueryParametersSchema>;

/** The invoice and tips `sendInvoice` read, before its send options. */
interface InvoiceReading {
  readonly parameters: SendInvoiceParameters;
  readonly prices: readonly LabeledPrice[];
  readonly maxTipAmount: number;
  readonly suggestsTips: boolean;
}

/**
 * The payment methods, each executed as a command in its call's transaction. `sendInvoice` sends
 * one-off invoices in Telegram Stars to the bot's private chats, and `answerPreCheckoutQuery`
 * approves or refuses an account's checkout of one.
 */
export const PAYMENT_METHODS: readonly BotApiMethod[] = [
  // As the official server's `get_input_message_invoice` reads them, before the chat: the title,
  // the description, and the payload, each required, the payload's encoding, the currency, and
  // the prices, then the tips. The emulator then refuses the options it does not support, before
  // the send options. TDLib and Telegram's servers check the invoice itself once the chat is
  // reached, as the sending of the invoice does.
  commandMethodOfSteps({
    name: 'sendInvoice',
    recordsActivity: true,
    parameters: sendInvoiceParametersSchema,
    steps: (call) =>
      startSteps(call.parameters)
        .andThen(requireInvoiceTexts)
        .andThen((parameters) => readInvoicePrices(call, parameters))
        .andThen(readTips)
        .andThen(refuseUnsupportedInvoiceOptions)
        .andThen((invoice) => readSendOptions(call, invoice))
        .andThen(refuseInvoiceReplyMarkup),
    execute: (context: PaymentContext, { parameters, prices, options }) =>
      sendInvoiceAnswer(context, {
        title: parameters.title,
        description: parameters.description,
        startParameter: parameters.start_parameter,
        prices,
        payload: parameters.payload,
      }, options),
  }),
  commandMethodOfSteps({
    name: 'answerPreCheckoutQuery',
    recordsActivity: true,
    parameters: answerPreCheckoutQueryParametersSchema,
    steps: ({ parameters }) => startSteps(parameters).andThen(readPreCheckoutQueryAnswer),
    execute: (context: PaymentContext, { preCheckoutQueryId, answer }) => {
      const result = context.session.checkouts.answerPreCheckoutQuery({
        fromBotId: context.bot.id,
        preCheckoutQueryId,
        answer,
      });
      return result.answered
        ? botApiResult(true)
        : presentFixedBotApiError(BOT_API_ERRORS.preCheckoutQueryNotAnswerable);
    },
  }),
];

/**
 * The step that reads the bot's answer to a pre-checkout query: an approval, whose
 * `error_message` the official server never reads, or a refusal, which requires one.
 */
function readPreCheckoutQueryAnswer(
  parameters: AnswerPreCheckoutQueryParameters,
): BotApiStepResult<{
  readonly preCheckoutQueryId: string;
  readonly answer: PreCheckoutQueryAnswer;
}> {
  const preCheckoutQueryId = parameters.pre_checkout_query_id;
  if (parameters.ok) {
    return proceedWith({ preCheckoutQueryId, answer: { status: 'approved' } });
  }
  return parameters.error_message.length === 0
    ? answerWith(presentBotApiError(BOT_API_ERRORS.requiredParameterMissing, {
      parameterName: 'error_message',
    }))
    : proceedWith({
      preCheckoutQueryId,
      answer: { status: 'refused', errorMessage: parameters.error_message },
    });
}

/**
 * The step that refuses an invoice without a title, a description, or a payload, which the official
 * server reads with `get_required_string_arg`, in that order, then a payload that is not
 * well-formed Unicode, and an invoice without a currency.
 */
function requireInvoiceTexts(
  parameters: SendInvoiceParameters,
): BotApiStepResult<SendInvoiceParameters> {
  for (const parameterName of ['title', 'description', 'payload'] as const) {
    if (parameters[parameterName].length === 0) {
      return answerWith(presentBotApiError(BOT_API_ERRORS.requiredParameterMissing, {
        parameterName,
      }));
    }
  }
  if (!parameters.payload.isWellFormed()) {
    return answerWith(presentFixedBotApiError(BOT_API_ERRORS.invoicePayloadEncodingInvalid));
  }
  return parameters.currency.length === 0
    ? answerWith(presentBotApiError(BOT_API_ERRORS.requiredParameterMissing, {
      parameterName: 'currency',
    }))
    : proceedWith(parameters);
}

/** The step that reads the required `prices`, as `readPricesParameter` reads them. */
function readInvoicePrices(
  { invalidParametersDescription }: BotApiStepCall<unknown>,
  parameters: SendInvoiceParameters,
): BotApiStepResult<{
  readonly parameters: SendInvoiceParameters;
  readonly prices: readonly LabeledPrice[];
}> {
  if (parameters.prices.length === 0) {
    return answerWith(presentBotApiError(BOT_API_ERRORS.requiredParameterMissing, {
      parameterName: 'prices',
    }));
  }
  const pricesReading = readPricesParameter(parameters.prices, invalidParametersDescription);
  return pricesReading.read
    ? proceedWith({ parameters, prices: pricesReading.prices })
    : answerWithBadRequest(pricesReading.description);
}

/** The step that reads `max_tip_amount`, then `suggested_tip_amounts`, as the official server does. */
function readTips(
  invoice: { readonly parameters: SendInvoiceParameters; readonly prices: readonly LabeledPrice[] },
): BotApiStepResult<InvoiceReading> {
  const maxTipReading = readMaxTipAmountParameter(invoice.parameters.max_tip_amount);
  if (!maxTipReading.read) {
    return answerWithBadRequest(maxTipReading.description);
  }
  const suggestedTipsReading = readSuggestedTipAmountsParameter(
    invoice.parameters.suggested_tip_amounts,
  );
  if (!suggestedTipsReading.read) {
    return answerWithBadRequest(suggestedTipsReading.description);
  }
  return proceedWith({
    ...invoice,
    maxTipAmount: maxTipReading.maxTipAmount,
    suggestsTips: suggestedTipsReading.suggestsTips,
  });
}

/**
 * The step that refuses what the emulator does not support of an invoice, which Telegram does, as
 * `findUnsupportedInvoiceOption` finds it, then tips: a maximum tip that TDLib refuses, being
 * negative or beyond its range, is refused as TDLib refuses it, and any other but the defaults that
 * enable no tips, a maximum of 0 and no suggested amounts, as the emulator's.
 */
function refuseUnsupportedInvoiceOptions(
  invoice: InvoiceReading,
): BotApiStepResult<InvoiceReading> {
  const option = findUnsupportedInvoiceOption(invoice);
  if (option !== undefined) {
    return answerWith(presentBotApiError(BOT_API_ERRORS.invoiceOptionUnsupported, { option }));
  }
  const { maxTipAmount, suggestsTips } = invoice;
  if (maxTipAmount < 0 || !isCurrencyAmountInRange(maxTipAmount)) {
    return answerWith(presentFixedBotApiError(BOT_API_ERRORS.maxTipAmountInvalid));
  }
  return maxTipAmount === 0 && !suggestsTips ? proceedWith(invoice) : answerWith(
    presentBotApiError(BOT_API_ERRORS.invoiceOptionUnsupported, { option: 'tips' }),
  );
}

/**
 * The first option of an invoice other than tips that the emulator does not support, in this
 * order: a currency other than Telegram Stars, a payment provider's token or data, and a product
 * photo.
 */
function findUnsupportedInvoiceOption(
  { parameters }: InvoiceReading,
): Exclude<UnsupportedInvoiceOption, 'tips' | 'reply_markup'> | undefined {
  if (parameters.currency !== TELEGRAM_STARS_CURRENCY) {
    return 'currency';
  }
  if (parameters.provider_token.length > 0) {
    return 'payment_provider';
  }
  if (parameters.provider_data.length > 0) {
    return 'provider_data';
  }
  if (
    parameters.photo_url.length > 0 || parameters.photo_size !== 0 ||
    parameters.photo_width !== 0 || parameters.photo_height !== 0
  ) {
    return 'product_photo';
  }
  return undefined;
}

/**
 * The step that refuses an invoice with a keyboard, which the emulator does not support: Telegram's
 * clients then show the bot's keyboard, whose first button must be a Pay button, in place of their
 * own Pay button.
 */
function refuseInvoiceReplyMarkup<Send extends { readonly options: SendRequestOptions }>(
  send: Send,
): BotApiStepResult<Send> {
  const { inlineKeyboard, replyInterfaceMarkup } = send.options;
  return inlineKeyboard === undefined && replyInterfaceMarkup === undefined
    ? proceedWith(send)
    : answerWith(
      presentBotApiError(BOT_API_ERRORS.invoiceOptionUnsupported, { option: 'reply_markup' }),
    );
}

/** Sends the invoice, and answers with its message as the bot sees it, or why it was not sent. */
function sendInvoiceAnswer(
  context: PaymentContext,
  invoice: Parameters<PaymentContext['session']['botMessageSending']['sender']['sendInvoice']>[1],
  { replyTo, chatId, isContentProtected, isSilent, messageEffectId }: SendRequestOptions,
): BotApiMethodAnswer {
  const result = context.session.botMessageSending.sender.sendInvoice(context.bot.id, invoice, {
    chatId,
    replyTo,
    isContentProtected,
    isSilent,
    messageEffectId,
  });
  return result.sent
    ? botApiResult(result.message)
    : presentMessageSendingFailure('message_send', result);
}
