/**
 * Keeps the hand-grouped inventory of implemented Bot API methods in the feature guide's index in
 * step with the method catalogue and Telegram's legacy method names, which decide what the
 * emulator answers. The inventory's grouping into areas is authored and is not checked.
 */
import { assertEquals } from 'jsr:@std/assert@^1.0.19';
import {
  findBotApiMethod,
  listBotApiMethodNames,
} from '../src/api/sessions/bot_api/method_catalogue.ts';
import {
  type LegacyBotApiMethodName,
  listLegacyBotApiMethodNames,
} from '../src/types/bot_api_method_name.ts';

const FEATURE_INDEX_URL = new URL('../docs/features/README.md', import.meta.url);
const INVENTORY_HEADING = '## Implemented Bot API methods';

/** What the inventory table names: implemented methods, and legacy names with their targets. */
interface DocumentedInventory {
  readonly methodNames: readonly string[];
  readonly legacyNames: readonly LegacyBotApiMethodName[];
}

Deno.test('the method inventory names every implemented method exactly once', async () => {
  const inventory = readDocumentedInventory(await Deno.readTextFile(FEATURE_INDEX_URL));
  // Sorted lists rather than sets, so that a method listed twice fails too.
  assertEquals(
    [...inventory.methodNames].sort(),
    [...listBotApiMethodNames()].sort(),
    'docs/features/README.md lists different methods from the method catalogue',
  );
});

Deno.test('the method inventory lists every legacy method name with its current name', async () => {
  const inventory = readDocumentedInventory(await Deno.readTextFile(FEATURE_INDEX_URL));
  const describe = ({ legacyName, currentName }: LegacyBotApiMethodName) =>
    `${legacyName} → ${currentName}`;
  assertEquals(
    inventory.legacyNames.map(describe).sort(),
    listLegacyBotApiMethodNames().map(describe).sort(),
    'docs/features/README.md lists different legacy names from the legacy name map',
  );
  for (const { legacyName, currentName } of inventory.legacyNames) {
    assertEquals(
      findBotApiMethod(legacyName)?.name,
      currentName,
      `Expected the legacy name ${legacyName} to call ${currentName}`,
    );
  }
});

/**
 * Reads the method column of the inventory table: a `` `legacyName` → `currentName` `` pair names
 * a legacy name, and every other code span names an implemented method.
 */
function readDocumentedInventory(markdown: string): DocumentedInventory {
  const sectionStart = markdown.indexOf(`\n${INVENTORY_HEADING}\n`);
  if (sectionStart === -1) {
    throw new Error(`No "${INVENTORY_HEADING}" section in the feature index`);
  }
  const sectionBody = markdown.slice(sectionStart + INVENTORY_HEADING.length + 2);
  const nextSectionStart = sectionBody.search(/^## /m);
  const section = nextSectionStart === -1 ? sectionBody : sectionBody.slice(0, nextSectionStart);

  const tableRows = section.split('\n').filter((line) => line.startsWith('|'));
  // The first two rows are the header and the delimiter row.
  const methodCells = tableRows.slice(2).map((row) => {
    const cells = row.split('|').map((cell) => cell.trim());
    // A row `| Area | Methods |` splits into ['', area, methods, ''].
    if (cells.length !== 4) throw new Error(`Expected two columns in inventory row: ${row}`);
    return cells[2];
  });
  if (methodCells.length === 0) throw new Error('The method inventory table has no rows');

  const methodNames: string[] = [];
  const legacyNames: LegacyBotApiMethodName[] = [];
  const legacyNamePair = /`([^`]+)` → `([^`]+)`/g;
  for (const cell of methodCells) {
    for (const [, legacyName, currentName] of cell.matchAll(legacyNamePair)) {
      legacyNames.push({ legacyName, currentName });
    }
    const cellWithoutLegacyNames = cell.replace(legacyNamePair, '');
    for (const [, methodName] of cellWithoutLegacyNames.matchAll(/`([^`]+)`/g)) {
      methodNames.push(methodName);
    }
  }
  return { methodNames, legacyNames };
}
