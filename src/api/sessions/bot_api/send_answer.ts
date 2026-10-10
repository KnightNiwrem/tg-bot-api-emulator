import type { EmulationSession } from '../../../types/emulation_session.ts';
import { presentMessageSendingFailure } from './errors/message_sending_failure_presenter.ts';
import { type BotApiMethodAnswer, botApiResult } from './method_call.ts';

type SendResult = ReturnType<EmulationSession['botApi']['sendMessage']>;

/** Why a send method sent no message. */
type SendFailure = Extract<SendResult, { readonly sent: false }>;

/** Telegram's answer to a send method: the message it sent, or its error for why none was sent. */
export function sendMethodAnswer(result: SendResult | SendFailure): BotApiMethodAnswer {
  return result.sent
    ? botApiResult(result.message)
    : presentMessageSendingFailure('message_send', result);
}
