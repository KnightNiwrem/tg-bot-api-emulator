import { z } from 'zod';

import { type ChatIdentifier, chatIdentifierSchema, jsonParameter } from './request_parameters.ts';

/** A quote as a bot specified it in `reply_parameters`, before its formatting is read. */
export interface UnreadQuote {
  /** The Bot API `quote`. */
  readonly text: string;
  /** The Bot API `quote_parse_mode`; omitted for none. */
  readonly parseMode?: string;
  /** The Bot API `quote_entities`, still to be read; omitted for none. */
  readonly entities?: readonly unknown[];
  /** The Bot API `quote_position`, in UTF-16 code units. */
  readonly position: number;
}

/** A reply target as a bot specified it, before its chat is checked. */
export interface SpecifiedReplyTarget {
  /** The replied message's ID in the bot's chat. */
  readonly messageId: number;
  /** The replied message's chat, by ID or public username; omitted for the chat sent to. */
  readonly chatId?: ChatIdentifier;
  readonly allowSendingWithoutReply: boolean;
  /** The part of the replied message the bot quotes; omitted for none. */
  readonly quote?: UnreadQuote;
}

/** A parsed `reply_parameters` parameter, which may specify no reply. */
interface ReplyParameters {
  readonly replyTarget: SpecifiedReplyTarget | undefined;
}

/** The parameters from which Telegram reads the message a sent message replies to. */
export interface ReplyTargetParameters {
  readonly reply_parameters?: ReplyParameters;
  readonly reply_to_message_id?: number;
  readonly allow_sending_without_reply: boolean;
}

/**
 * A `reply_parameters` parameter: a JSON `ReplyParameters` object, read as the official Bot API
 * server's `get_reply_parameters` reads it. Empty text, an empty object or a non-positive message
 * ID specifies no reply, which the older `reply_to_message_id` cannot then specify either, and
 * text the server cannot read as JSON is refused with its description.
 *
 * Checklist tasks and poll options are not supported, so those fields are rejected.
 */
export function replyParametersParameter() {
  return jsonParameter(
    z.strictObject({
      message_id: z.int().optional(),
      chat_id: chatIdentifierSchema.optional(),
      allow_sending_without_reply: z.boolean().default(false),
      quote: z.string().optional(),
      quote_parse_mode: z.string().optional(),
      quote_entities: z.array(z.unknown()).optional(),
      quote_position: z.int().default(0),
    }),
    {
      unparsableJsonDescription: "Bad Request: can't parse reply parameters JSON object",
      emptyText: { readAs: {} },
    },
  ).transform((parameters): ReplyParameters => {
    const { message_id, chat_id, allow_sending_without_reply, quote } = parameters;
    return {
      replyTarget: message_id === undefined || message_id <= 0 ? undefined : {
        messageId: message_id,
        ...(chat_id === undefined ? {} : { chatId: chat_id }),
        allowSendingWithoutReply: allow_sending_without_reply,
        ...(quote === undefined ? {} : {
          quote: {
            text: quote,
            ...(parameters.quote_parse_mode === undefined
              ? {}
              : { parseMode: parameters.quote_parse_mode }),
            ...(parameters.quote_entities === undefined
              ? {}
              : { entities: parameters.quote_entities }),
            position: parameters.quote_position,
          },
        }),
      },
    };
  });
}

/**
 * Selects the reply target as the official Bot API server's `get_reply_parameters` does:
 * `reply_parameters` when present, and otherwise the older `reply_to_message_id` with
 * `allow_sending_without_reply`, which Telegram still accepts. A non-positive message ID specifies
 * no reply.
 */
export function selectSpecifiedReplyTarget(
  { reply_parameters, reply_to_message_id, allow_sending_without_reply }: ReplyTargetParameters,
): SpecifiedReplyTarget | undefined {
  if (reply_parameters !== undefined) {
    return reply_parameters.replyTarget;
  }
  return reply_to_message_id === undefined || reply_to_message_id <= 0 ? undefined : {
    messageId: reply_to_message_id,
    allowSendingWithoutReply: allow_sending_without_reply,
  };
}
