import { assertEquals } from '@std/assert';
import { ButtonSelectionError, findButton, listButtons } from './mod.ts';
import type { ButtonSelector, MessageWithButtons, RichBlockTableCell, RichText } from './mod.ts';

const shop: MessageWithButtons = {
  rich_message: {
    blocks: [
      { type: 'heading', text: 'Shop', size: 1 },
      {
        type: 'table',
        cells: [
          [cell('Potion'), cell('10g'), cell({ type: 'button', button: details('potion') })],
          [cell('Ether'), cell('20g'), cell({ type: 'button', button: details('ether') })],
        ],
      },
      {
        type: 'list',
        items: [{
          label: '•',
          blocks: [{
            type: 'paragraph',
            text: ['Iron armor ', { type: 'button', button: details('armor') }],
          }],
        }],
      },
      {
        type: 'details',
        summary: 'Crafting',
        blocks: [
          { type: 'paragraph', text: 'Potion needs herbs' },
          {
            type: 'buttons',
            buttons: [{ text: { type: 'bold', text: 'Make one batch' }, callback_data: 'craft' }],
          },
        ],
      },
    ],
  },
  reply_markup: {
    inline_keyboard: [[
      { text: 'Equip', callback_data: 'equip' },
      { text: 'Equipment', callback_data: 'equipment' },
      { text: 'Guide', url: 'https://example.com/' },
    ]],
  },
};

Deno.test('listButtons lists rich message buttons, then the inline keyboard, with their paths', () => {
  const buttons = listButtons(shop).map(({ label, path }) => `${label} ${path}`);
  const expected = [
    'Details rich_message.blocks[1].cells[0][2].text.button',
    'Details rich_message.blocks[1].cells[1][2].text.button',
    'Details rich_message.blocks[2].items[0].blocks[0].text[1].button',
    'Make one batch rich_message.blocks[3].blocks[1].buttons[0]',
    'Equip reply_markup.inline_keyboard[0][0]',
    'Equipment reply_markup.inline_keyboard[0][1]',
    'Guide reply_markup.inline_keyboard[0][2]',
  ];
  assertEquals(buttons, expected, 'Unexpected buttons');

  const [potionDetails] = listButtons(shop);
  const containers = potionDetails?.containers.map((container) =>
    `${container.kind} ${container.text}`
  );
  assertEquals(containers, [
    'block Potion | 10g | Details\nEther | 20g | Details',
    'table_row Potion | 10g | Details',
  ], 'Unexpected containers');
});

Deno.test('findButton matches the whole label, or a pattern', () => {
  const equip = findButton(shop, { label: 'Equip' });
  if (!('callback_data' in equip.button) || equip.button.callback_data !== 'equip') {
    throw new Error('Expected "Equip" to select Equip rather than Equipment');
  }

  const globalPattern = /^Make/g;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (findButton(shop, { label: globalPattern }).label !== 'Make one batch') {
      throw new Error('Expected a global pattern to select the same button on every use');
    }
  }
});

Deno.test('findButton scopes a label to the innermost parts that mention the text', () => {
  const cases: readonly [ButtonSelector, string][] = [
    [{ label: 'Details', within: 'Potion' }, 'potion'],
    [{ label: 'Details', within: /^Ether/ }, 'ether'],
    [{ label: 'Details', within: 'Iron armor' }, 'armor'],
    [{ label: 'Make one batch', within: 'Potion' }, 'craft'],
  ];
  for (const [selector, callbackData] of cases) {
    const { button } = findButton(shop, selector);
    if (!('callback_data' in button) || button.callback_data !== callbackData) {
      throw new Error(`Expected ${JSON.stringify(selector)} to select ${callbackData}`);
    }
  }
});

Deno.test('findButton accepts a predicate that inspects neighboring blocks', () => {
  const selected = findButton(shop, (button) => {
    const block = button.containers.findLast((container) => container.kind === 'block');
    const previousBlock = block?.kind === 'block'
      ? block.siblingBlocks[block.index - 1]
      : undefined;
    return previousBlock?.type === 'paragraph' && previousBlock.text === 'Potion needs herbs';
  });
  if (selected.label !== 'Make one batch') {
    throw new Error(`Expected the button after the paragraph, got ${selected.label}`);
  }
});

Deno.test('findButton lists the candidates when a selector is ambiguous or matches nothing', () => {
  const ambiguous = selectionError({ label: 'Details' });
  if (
    ambiguous.matches.length !== 3 ||
    !ambiguous.message.startsWith('3 buttons match label "Details":') ||
    !ambiguous.message.includes(
      '- "Details" at rich_message.blocks[1].cells[1][2].text.button in table ',
    ) ||
    !ambiguous.message.includes('table_row "Ether | 20g | Details"')
  ) {
    throw new Error(`Unexpected ambiguity error: ${ambiguous.message}`);
  }

  const missing = selectionError({ label: 'Details', within: 'Elixir' });
  if (
    missing.matches.length !== 0 ||
    !missing.message.startsWith(
      'No button matches label "Details" within "Elixir". The message shows these buttons:',
    ) ||
    !missing.message.includes('- "Guide" at reply_markup.inline_keyboard[0][2]')
  ) {
    throw new Error(`Unexpected missing-button error: ${missing.message}`);
  }

  const empty = selectionError({ label: 'Details' }, {});
  if (empty.message !== 'No button matches label "Details". The message shows no buttons') {
    throw new Error(`Unexpected error for a message without buttons: ${empty.message}`);
  }
});

function selectionError(
  selector: ButtonSelector,
  message: MessageWithButtons = shop,
): ButtonSelectionError {
  try {
    findButton(message, selector);
  } catch (error) {
    if (error instanceof ButtonSelectionError) return error;
    throw error;
  }
  throw new Error(`Expected ${JSON.stringify(selector)} to fail`);
}

function cell(text: RichText): RichBlockTableCell {
  return { text, align: 'left', valign: 'middle' };
}

function details(callbackData: string) {
  return { text: 'Details', callback_data: callbackData };
}

Deno.test('listButtons finds buttons in quotes, credits, and captions', () => {
  const button = (label: string): RichText => ({
    type: 'button',
    button: { text: label, callback_data: label },
  });
  const message: MessageWithButtons = {
    rich_message: {
      blocks: [
        {
          type: 'blockquote',
          blocks: [{ type: 'paragraph', text: button('quoted') }],
          credit: button('credit'),
        },
        { type: 'pullquote', text: button('pulled') },
        {
          type: 'collage',
          blocks: [],
          caption: { text: button('caption'), credit: button('caption credit') },
        },
        { type: 'table', cells: [], caption: button('table caption') },
        { type: 'mathematical_expression', expression: 'e^{i\\pi}' },
        { type: 'divider' },
      ],
    },
  };
  const buttons = listButtons(message).map(({ label, path }) => `${label} ${path}`);
  const expected = [
    'quoted rich_message.blocks[0].blocks[0].text.button',
    'credit rich_message.blocks[0].credit.button',
    'pulled rich_message.blocks[1].text.button',
    'caption rich_message.blocks[2].caption.text.button',
    'caption credit rich_message.blocks[2].caption.credit.button',
    'table caption rich_message.blocks[3].caption.button',
  ];
  assertEquals(buttons, expected, 'Unexpected buttons');
});

Deno.test('listButtons keeps disabled buttons, which tests can tell apart', () => {
  const buttons = listButtons({
    rich_message: {
      blocks: [{
        type: 'buttons',
        buttons: [
          { text: 'Buy', callback_data: 'buy' },
          { text: 'Sold out', disabled: {} },
        ],
      }],
    },
  });
  const disabled = buttons.filter(({ button }) => 'disabled' in button).map(({ label }) => label);
  assertEquals(disabled, ['Sold out'], 'Expected the disabled button to be listed');
});
