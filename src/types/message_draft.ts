import type { FormattedText } from './virtual_message.ts';

/**
 * The preview of a message a bot is still generating, which an account's client shows in its
 * private chat with the bot, as TDLib's `updatePendingMessage` describes it. A write with the same
 * draft ID changes the preview, and one with another ID replaces it; any message from the bot
 * removes it.
 *
 * Telegram's clients also remove a preview 30 seconds after the bot's last write, TDLib's
 * `pending_text_message_period`. The emulator never removes one because time passes: a test
 * expires it explicitly.
 */
export interface MessageDraft {
  /** Telegram's decimal text form of the draft's nonzero 64-bit identifier. */
  readonly draftId: string;
  /** The preview's text; empty text shows a "Thinking…" placeholder. */
  readonly text: FormattedText;
}
