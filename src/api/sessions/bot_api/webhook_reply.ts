import type { BotApiCallContext } from './method_call.ts';
import { findBotApiMethod } from './method_catalogue.ts';
import { callBotApiMethod, rejectUnknownBotApiMethod } from './method_invocation.ts';
import { decodeBotApiBodyParameters } from './request_parameters.ts';

/** The parameter naming the method that a webhook's response asks Telegram to run. */
const METHOD_PARAMETER = 'method';

/**
 * Methods, by lowercase name, that change the webhook or end the bot's session, which a webhook's
 * response cannot run.
 */
const WEBHOOK_REPLY_EXCLUDED_METHOD_NAMES: ReadonlySet<string> = new Set([
  'deletewebhook',
  'setwebhook',
  'close',
  'logout',
]);

/** The lowercase prefix of the names of methods whose result no one would receive. */
const WEBHOOK_REPLY_EXCLUDED_METHOD_NAME_PREFIX = 'get';

/**
 * Whether a webhook's response that names a method runs nothing, as the official Bot API server's
 * `WebhookActor` ignores it: a method that changes the webhook or ends the bot's session, or one
 * whose name starts with `get`, in any letter case.
 *
 * The rule reads the name as the response gives it, before the method is looked up, so it covers
 * methods the emulator does not implement too, such as `close` and `logOut`, and nothing a method's
 * record declares can let a response run a method it excludes.
 */
function isExcludedFromWebhookReply(methodName: string): boolean {
  const lowercaseMethodName = methodName.toLowerCase();
  return WEBHOOK_REPLY_EXCLUDED_METHOD_NAMES.has(lowercaseMethodName) ||
    lowercaseMethodName.startsWith(WEBHOOK_REPLY_EXCLUDED_METHOD_NAME_PREFIX);
}

/**
 * Runs the Bot API method that a webhook names in its successful response to an update, with the
 * other parameters of the response, as Telegram does. Nothing receives the method's answer, since
 * the response ends the webhook's exchange with Telegram, so a failing method changes nothing;
 * the call and its answer are recorded as bot activity, as a call of a method the emulator does
 * not implement is. A response that names no method, names one that cannot run this way, or
 * cannot be decoded, runs nothing.
 */
export async function runWebhookReply(
  context: BotApiCallContext,
  reply: Response,
): Promise<void> {
  const decoding = await decodeBotApiBodyParameters(reply);
  if (!decoding.decoded) {
    return;
  }
  const { [METHOD_PARAMETER]: methodName = '', ...parameters } = decoding.parameters;
  if (methodName.length === 0 || isExcludedFromWebhookReply(methodName)) {
    return;
  }
  const method = findBotApiMethod(methodName);
  if (method === undefined) {
    rejectUnknownBotApiMethod(context, methodName, parameters, decoding.uploadedFiles);
    return;
  }
  await callBotApiMethod(context, {
    method,
    requestedMethodName: methodName,
    parameters,
    uploadedFiles: decoding.uploadedFiles,
  });
}
