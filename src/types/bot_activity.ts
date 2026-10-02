import type { BotApiUpdate } from './bot_api.ts';

/**
 * What passes between the emulator and a session's bots, in the order the emulator decided each
 * outcome: when it answered a call, or handed an update over or saw it confirmed.
 *
 * That order agrees with every order a bot enforces. A bot that awaits the answer to one call
 * before it makes another cannot make the second before the first is answered, and it cannot
 * handle an update before the update is delivered. Calls a bot makes concurrently may be recorded
 * in either order, as they may reach Telegram in either order.
 */
export type BotActivityEntry = BotApiCallEntry | UpdateDeliveredEntry | UpdateConfirmedEntry;

export type BotActivityKind = BotActivityEntry['kind'];

export const BOT_ACTIVITY_KINDS = [
  'bot_api_call',
  'update_delivered',
  'update_confirmed',
] as const satisfies readonly BotActivityKind[];

/** How a bot's call reached the emulator: as an HTTP request, or in a webhook's response. */
export type BotApiCallTransport = 'http' | 'webhook_reply';

/** How updates reach a bot: by its `getUpdates` requests, or by requests to its webhook. */
export type BotUpdateTransport = 'polling' | 'webhook';

/** A file a call uploaded, described without its content. */
export interface UploadedFileDescription {
  /** The multipart field that carried the file. */
  readonly fieldName: string;
  readonly fileName: string;
  readonly sizeBytes: number;
}

/** Telegram's JSON answer to a call, as the bot received it. */
export type BotApiCallAnswer =
  | {
    readonly ok: true;
    readonly result: unknown;
    readonly description?: string;
  }
  | {
    readonly ok: false;
    readonly error_code: number;
    readonly description: string;
    readonly parameters?: { readonly retry_after: number };
  };

/**
 * A bot's call of a Bot API method, whether it ran, failed, or named no method the emulator
 * implements. `getUpdates` calls are not recorded; the updates they deliver and confirm are.
 */
export interface BotApiCallEntry {
  /** Where the entry stands in the session's log; each entry's is 1 greater than the last. */
  readonly position: number;
  readonly kind: 'bot_api_call';
  readonly botId: number;
  /**
   * The method's current name, whichever name the bot called it by; the name as called for a
   * method the emulator does not implement.
   */
  readonly method: string;
  /** The method name as the bot called it. */
  readonly requestedMethod: string;
  readonly via: BotApiCallTransport;
  /** The parameters as the bot sent them, as text; empty when the request could not be decoded. */
  readonly parameters: Readonly<Record<string, string>>;
  readonly uploadedFiles: readonly UploadedFileDescription[];
  /** The chat `chat_id` names, with a public username resolved; omitted when it names none. */
  readonly chatId?: number;
  readonly answer: BotApiCallAnswer;
}

/**
 * An update handed to a bot: in a `getUpdates` answer, or in a request to its webhook. An update
 * that is handed over again, because the bot did not confirm it, is recorded each time.
 */
export interface UpdateDeliveredEntry {
  readonly position: number;
  readonly kind: 'update_delivered';
  readonly botId: number;
  readonly via: BotUpdateTransport;
  readonly update: BotApiUpdate;
  /** The chat the update happened in; omitted for updates without one, such as inline queries. */
  readonly chatId?: number;
  /** The user whose action caused the update; omitted for a poll's new state, which names none. */
  readonly userId?: number;
}

/**
 * An update the bot confirmed: by a `getUpdates` offset beyond it, or by a webhook's successful
 * answer to it, after any method the answer names has run.
 */
export interface UpdateConfirmedEntry {
  readonly position: number;
  readonly kind: 'update_confirmed';
  readonly botId: number;
  readonly via: BotUpdateTransport;
  readonly updateId: number;
  readonly chatId?: number;
  /** As `UpdateDeliveredEntry` describes it. */
  readonly userId?: number;
}

/** An entry as it is recorded, before the log assigns its position. */
export type UnpositionedBotActivityEntry =
  | Omit<BotApiCallEntry, 'position'>
  | Omit<UpdateDeliveredEntry, 'position'>
  | Omit<UpdateConfirmedEntry, 'position'>;

/**
 * Which entries a reader looks for; an entry must satisfy every criterion given. Criteria that
 * only calls have, `method`, `ok` and `parameters`, match no update entry, and criteria that only
 * updates have, `userId` and `updateId`, match no call.
 */
export interface BotActivityFilter {
  readonly botId?: number;
  readonly kind?: BotActivityKind;
  /** Compared with the recorded method name without regard to letter case. */
  readonly method?: string;
  readonly chatId?: number;
  readonly userId?: number;
  /** The ID of the update delivered or confirmed; bots number their updates independently. */
  readonly updateId?: number;
  /** Whether the call's answer was successful. */
  readonly ok?: boolean;
  /** Parameter text the call must have sent, by parameter name, compared exactly. */
  readonly parameters?: Readonly<Record<string, string>>;
}

export function matchesBotActivityFilter(
  entry: BotActivityEntry,
  filter: BotActivityFilter,
): boolean {
  if (filter.botId !== undefined && entry.botId !== filter.botId) {
    return false;
  }
  if (filter.kind !== undefined && entry.kind !== filter.kind) {
    return false;
  }
  if (filter.chatId !== undefined && entry.chatId !== filter.chatId) {
    return false;
  }
  if (entry.kind === 'bot_api_call') {
    return filter.userId === undefined && filter.updateId === undefined &&
      matchesBotApiCallCriteria(entry, filter);
  }
  const updateId = entry.kind === 'update_delivered' ? entry.update.update_id : entry.updateId;
  return (
    filter.method === undefined && filter.ok === undefined && filter.parameters === undefined &&
    (filter.userId === undefined || entry.userId === filter.userId) &&
    (filter.updateId === undefined || updateId === filter.updateId)
  );
}

function matchesBotApiCallCriteria(entry: BotApiCallEntry, filter: BotActivityFilter): boolean {
  if (
    filter.method !== undefined && entry.method.toLowerCase() !== filter.method.toLowerCase()
  ) {
    return false;
  }
  if (filter.ok !== undefined && entry.answer.ok !== filter.ok) {
    return false;
  }
  return Object.entries(filter.parameters ?? {}).every(([name, text]) =>
    Object.hasOwn(entry.parameters, name) && entry.parameters[name] === text
  );
}
