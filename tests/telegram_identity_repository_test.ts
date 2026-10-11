import { assertEquals } from '@std/assert';

import {
  type IdentityReservationInput,
  type TelegramIdentity,
  TelegramIdentityRepository,
} from '../src/repositories/telegram_identity.ts';
import { SessionChangeJournal } from '../src/transactions/staging/change_staging.ts';
import { MAX_TELEGRAM_USER_ID, MIN_TELEGRAM_USER_ID } from '../src/types/telegram_identity.ts';

Deno.test('Telegram user IDs use the official MTProto user range', () => {
  if (MIN_TELEGRAM_USER_ID !== 1 || MAX_TELEGRAM_USER_ID !== 1_099_511_627_775) {
    throw new Error('Expected the Telegram user ID range to match the Bot API contract');
  }
});

Deno.test('TelegramIdentityRepository reserves usernames globally without consuming rejected IDs', () => {
  const identities = new TelegramIdentityRepository();

  const botIdentity = reserveIdentity(identities, { kind: 'bot', username: 'TestBot' });

  for (const kind of ['account', 'supergroup'] as const) {
    const duplicateUsername = identities.reserveIdentity({ kind, username: 'testbot' });
    if (duplicateUsername.reserved || duplicateUsername.reason !== 'username_taken') {
      throw new Error(`Expected a bot username to be unavailable to a ${kind}, in any case`);
    }
  }

  const nextIdentity = reserveIdentity(identities, { kind: 'account' });
  const channelIdentity = reserveIdentity(identities, { kind: 'channel' });
  if (
    botIdentity.kind !== 'bot' || botIdentity.id !== 1 || nextIdentity.id !== 2 ||
    channelIdentity.id !== -1_000_000_000_001
  ) {
    throw new Error('Expected rejected usernames not to consume user or shared-chat IDs');
  }
});

Deno.test('TelegramIdentityRepository resolves identities by ID and normalized username', () => {
  const identities = new TelegramIdentityRepository();
  const botIdentity = reserveIdentity(identities, { kind: 'bot', username: 'TestBot' });

  if (identities.getById(botIdentity.id) !== botIdentity) {
    throw new Error('Expected identity lookup by ID to return the reservation');
  }
  if (
    identities.getByUsername('TESTBOT') !== botIdentity ||
    identities.getByUsername('unknown') !== undefined
  ) {
    throw new Error('Expected username lookup to be case-insensitive');
  }
});

Deno.test('TelegramIdentityRepository allocates shared-chat IDs from Telegram ranges', () => {
  const identities = new TelegramIdentityRepository();

  const firstGroup = reserveIdentity(identities, { kind: 'basic_group' });
  const secondGroup = reserveIdentity(identities, { kind: 'basic_group' });
  const supergroup = reserveIdentity(identities, { kind: 'supergroup' });
  const channel = reserveIdentity(identities, { kind: 'channel' });
  if (firstGroup.id !== -1 || secondGroup.id !== -2) {
    throw new Error('Expected basic groups to consume their own descending ID sequence');
  }
  if (
    supergroup.id !== -1_000_000_000_001 ||
    channel.id !== -1_000_000_000_002
  ) {
    throw new Error('Expected supergroups and channels to consume one shared ID sequence');
  }
});

function reserveIdentity(
  identities: TelegramIdentityRepository,
  input: IdentityReservationInput,
): TelegramIdentity {
  const result = identities.reserveIdentity(input);
  if (!result.reserved) {
    throw new Error(`Expected identity reservation to succeed, received ${result.reason}`);
  }
  return result.identity;
}

Deno.test('a reservation that its transaction aborts frees its ID and its username', () => {
  const journal = new SessionChangeJournal({
    reportNotificationFailure: (error) => {
      throw error;
    },
  });
  const identities = new TelegramIdentityRepository(journal);
  const reserveAll = () =>
    (['account', 'basic_group', 'supergroup'] as const).map((kind) =>
      identities.reserveIdentity(
        kind === 'basic_group' ? { kind } : { kind, username: `${kind}_name` },
      )
    );

  journal.begin();
  const abortedReservations = reserveAll();
  journal.abort();
  const reservations = reserveAll();

  assertEquals(reservations, abortedReservations);
  assertEquals(reservations.every((reservation) => reservation.reserved), true);
  assertEquals(identities.getByUsername('ACCOUNT_NAME'), identities.getById(MIN_TELEGRAM_USER_ID));
});
