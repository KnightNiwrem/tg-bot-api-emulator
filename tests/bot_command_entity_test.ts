import { assertEquals } from '@std/assert';
import { findBotCommandEntities } from '../src/text_entities/bot_command.ts';
import type { TextEntity } from '../src/types/virtual_message.ts';

// Expected results follow TDLib's `match_bot_commands` in `td/telegram/MessageEntity.cpp`.

Deno.test('findBotCommandEntities marks commands with optional bot addresses', () => {
  assertBotCommands('/start', [[0, 6]]);
  assertBotCommands('/start@TestBot hello', [[0, 14]]);
  assertBotCommands('hello /help', [[6, 5]]);
  assertBotCommands('/start.', [[0, 6]]);
  assertBotCommands('/a /b', [[0, 2], [3, 2]]);
  assertBotCommands(`/${'a'.repeat(64)}`, [[0, 65]]);
  assertBotCommands(`/start@${'b'.repeat(32)}`, [[0, 39]]);
  // Offsets count UTF-16 code units: the emoji is one code point but two code units.
  assertBotCommands('😀 /start', [[3, 6]]);
});

Deno.test('findBotCommandEntities rejects commands touching word characters or markup', () => {
  assertBotCommands('a/start', []);
  assertBotCommands('é/start', []);
  assertBotCommands('/é', []);
  assertBotCommands('/start/x', []);
  assertBotCommands('</start>', []);
  assertBotCommands('/', []);
  assertBotCommands('hello', []);
});

Deno.test('findBotCommandEntities rejects out-of-range command names and addresses', () => {
  assertBotCommands(`/${'a'.repeat(65)}`, []);
  assertBotCommands('/start@ab', []);
  assertBotCommands('/start@', []);
  assertBotCommands(`/start@${'b'.repeat(33)}`, []);
});

function assertBotCommands(
  text: string,
  expectedSpans: readonly (readonly [offset: number, length: number])[],
): void {
  const expected: TextEntity[] = expectedSpans.map(([offset, length]) => ({
    type: 'bot_command',
    offset,
    length,
  }));
  assertEquals(
    findBotCommandEntities(text),
    expected,
    `Expected the bot commands of ${JSON.stringify(text)}`,
  );
}
