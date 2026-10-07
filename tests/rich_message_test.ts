import { projectRichMessage } from '../src/projections/bot_api_rich_message.ts';
import { normalizeRichMessage } from '../src/services/rich_message_normalization.ts';
import type { BotApiRichMessage } from '../src/types/bot_api_rich_message.ts';
import {
  EMPTY_RICH_TEXT,
  type OrderedListItemLabelType,
  repeatRichMessage,
  type RichBlock,
  type RichMessage,
  richMessageMentionsUser,
  type RichText,
} from '../src/types/rich_message.ts';
import { mentionsUser } from '../src/types/virtual_message.ts';

const MENTIONABLE_USER_ID = 7;
const MENTIONABLE_USER = {
  id: MENTIONABLE_USER_ID,
  is_bot: false as const,
  first_name: 'Ada',
  username: 'ada_writer',
};

function plain(text: string): RichText {
  return { kind: 'plain', text };
}

function project(richMessage: RichMessage): BotApiRichMessage {
  return projectRichMessage(richMessage, {
    mentionedUsers: new Map([[MENTIONABLE_USER_ID, MENTIONABLE_USER]]),
    files: new Map(),
  });
}

/** Normalizes a rich message of one block, which must succeed, and returns the block. */
function normalizeBlock(block: RichBlock, detectsEntities = true): RichBlock {
  const normalization = normalizeRichMessage(
    { blocks: [block], isRightToLeft: false },
    detectsEntities,
    { isMentionableUser: (userId) => userId === MENTIONABLE_USER_ID },
  );
  if (!normalization.normalized) {
    throw new Error(`Expected the block to be normalized, received ${normalization.textError}`);
  }
  return normalization.richMessage.blocks[0];
}

function expectJson(actual: unknown, expected: unknown, description: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${description}: ${JSON.stringify(actual)}`);
  }
}

Deno.test('rich messages link to anchors and references by their raw or URL-decoded names', () => {
  const link = (url: string): RichText => ({ kind: 'link', text: plain('go'), url });
  const richMessage: RichMessage = {
    blocks: [
      { kind: 'anchor', name: 'top part' },
      {
        kind: 'paragraph',
        text: {
          kind: 'concatenation',
          texts: [
            { kind: 'reference', name: 'a%20b', text: plain('Note') },
            // A later target of the same name does not replace the first.
            { kind: 'reference', name: 'top part', text: plain('Shadowed') },
            { kind: 'anchor_link', targetName: 'top part', text: plain('up') },
            link('#a%20b'),
            link('#a%2520b'),
            link('#'),
            link('#nowhere'),
            link('https://grammy.dev/#top'),
          ],
        },
      },
    ],
    isRightToLeft: false,
  };

  expectJson(project(richMessage).blocks[1], {
    type: 'paragraph',
    text: [
      { type: 'reference', text: 'Note', name: 'a%20b' },
      { type: 'reference', text: 'Shadowed', name: 'top part' },
      { type: 'anchor_link', text: 'up', anchor_name: 'top part' },
      { type: 'reference_link', text: 'go', reference_name: 'a%20b' },
      { type: 'reference_link', text: 'go', reference_name: 'a%20b' },
      { type: 'anchor_link', text: 'go', anchor_name: '' },
      { type: 'url', text: 'go', url: '#nowhere' },
      { type: 'url', text: 'go', url: 'https://grammy.dev/#top' },
    ],
  }, 'links resolved in the order TDLib resolves them');
});

/**
 * Projects the blocks followed by a paragraph that links to each name, and returns how the links
 * are shown.
 */
function projectLinksAfter(blocks: readonly RichBlock[], names: readonly string[]): unknown {
  const links: RichText[] = names.map((name) => ({
    kind: 'link',
    text: plain('go'),
    url: `#${name}`,
  }));
  const projected = project({
    blocks: [...blocks, { kind: 'paragraph', text: { kind: 'concatenation', texts: links } }],
    isRightToLeft: false,
  });
  const linkParagraph = projected.blocks[projected.blocks.length - 1];
  return linkParagraph.type === 'paragraph' ? linkParagraph.text : undefined;
}

function reference(name: string): RichText {
  return { kind: 'reference', name, text: plain('Note') };
}

function paragraph(text: RichText): RichBlock {
  return { kind: 'paragraph', text };
}

function listItem(blocks: readonly RichBlock[]) {
  return { blocks, hasCheckbox: false, isChecked: false };
}

function tableCell(text: RichText) {
  return {
    text,
    isHeader: false,
    columnSpan: 1,
    rowSpan: 1,
    alignment: 'left',
    verticalAlignment: 'top',
  } as const;
}

Deno.test('an anchor block shadows a later reference of the same name, nested or not', () => {
  const shown = projectLinksAfter([
    { kind: 'anchor', name: 'top' },
    paragraph(reference('top')),
    // A blockquote shows its blocks before its credit.
    {
      kind: 'blockquote',
      blocks: [{
        kind: 'list',
        items: [listItem([{ kind: 'anchor', name: 'quoted' }])],
      }],
      credit: reference('quoted'),
    },
    // A list shows its items in order.
    {
      kind: 'list',
      items: [
        listItem([{ kind: 'anchor', name: 'listed' }]),
        listItem([paragraph(reference('listed'))]),
      ],
    },
    // A details block shows its blocks before the blocks after it.
    {
      kind: 'details',
      summary: plain('More'),
      blocks: [{ kind: 'anchor', name: 'detailed' }],
      isOpen: true,
    },
    paragraph(reference('detailed')),
  ], ['top', 'quoted', 'listed', 'detailed']);

  expectJson(
    shown,
    ['top', 'quoted', 'listed', 'detailed'].map((name) => ({
      type: 'anchor_link',
      text: 'go',
      anchor_name: name,
    })),
    'links to the anchor blocks that come first',
  );
});

Deno.test('a reference shadows a later anchor block of the same name, nested or not', () => {
  const shown = projectLinksAfter([
    paragraph(reference('top')),
    { kind: 'anchor', name: 'top' },
    // A details block shows its summary before its blocks.
    {
      kind: 'details',
      summary: reference('summarized'),
      blocks: [{ kind: 'anchor', name: 'summarized' }],
      isOpen: false,
    },
    // A list shows its items in order, and a blockquote its blocks before its credit.
    {
      kind: 'list',
      items: [
        listItem([{
          kind: 'blockquote',
          blocks: [paragraph(reference('quoted'))],
          credit: { kind: 'anchor', name: 'quoted' },
        }]),
        listItem([{ kind: 'anchor', name: 'quoted' }]),
      ],
    },
    // A table shows its cells, row by row, before its caption.
    {
      kind: 'table',
      rows: [[tableCell(plain('Name'))], [tableCell(reference('tabled'))]],
      caption: { kind: 'anchor', name: 'tabled' },
      isBordered: false,
      isStriped: false,
      isCompact: false,
    },
    { kind: 'anchor', name: 'tabled' },
  ], ['top', 'summarized', 'quoted', 'tabled']);

  expectJson(
    shown,
    ['top', 'summarized', 'quoted', 'tabled'].map((name) => ({
      type: 'reference_link',
      text: 'go',
      reference_name: name,
    })),
    'links to the references that come first',
  );
});

Deno.test('rich message list items show the labels TDLib gives them', () => {
  const labels: Array<readonly [OrderedListItemLabelType, number, string]> = [
    ['1', 3, '3.'],
    ['a', 1, 'a.'],
    ['a', 26, 'z.'],
    ['A', 27, 'AA.'],
    ['A', 0, '0.'],
    ['i', 1994, 'mcmxciv.'],
    ['I', 3999, 'MMMCMXCIX.'],
    ['I', 4000, '4000.'],
    ['i', -2, '-2.'],
  ];
  const projected = project({
    blocks: [{
      kind: 'list',
      items: labels.map(([labelType, value]) => ({
        blocks: [{ kind: 'paragraph', text: EMPTY_RICH_TEXT }],
        hasCheckbox: false,
        isChecked: false,
        number: { value, labelType },
      })),
    }, {
      kind: 'list',
      items: [{
        blocks: [{ kind: 'divider' }],
        hasCheckbox: true,
        isChecked: false,
      }],
    }],
    isRightToLeft: false,
  });
  const [orderedList, unorderedList] = projected.blocks;
  const shownLabels = orderedList.type === 'list'
    ? orderedList.items.map((item) => item.label)
    : [];
  expectJson(shownLabels, labels.map(([, , label]) => label), 'TDLib ordered list labels');
  expectJson(unorderedList, {
    type: 'list',
    items: [{ label: '•', blocks: [{ type: 'divider' }], has_checkbox: true }],
  }, 'an unordered item with an unchecked checkbox');
});

Deno.test('Telegram detects entities in the plain text of rich messages, not in code or buttons', () => {
  const button = {
    text: plain('@ada_writer'),
    action: { kind: 'callback', callbackData: 'go' },
  } as const;
  const paragraph = normalizeBlock({
    kind: 'paragraph',
    text: {
      kind: 'concatenation',
      texts: [
        plain('Mail ada@example.com about #plans'),
        { kind: 'styled', style: 'bold', text: plain('@ada_writer') },
        { kind: 'styled', style: 'code', text: plain('@ada_writer') },
        { kind: 'link', text: plain('@ada_writer'), url: 'https://grammy.dev' },
        { kind: 'button', button },
      ],
    },
  });
  expectJson(paragraph, {
    kind: 'paragraph',
    text: {
      kind: 'concatenation',
      texts: [
        plain('Mail '),
        { kind: 'detected_entity', entityType: 'email_address', text: plain('ada@example.com') },
        plain(' about '),
        { kind: 'detected_entity', entityType: 'hashtag', text: plain('#plans') },
        {
          kind: 'styled',
          style: 'bold',
          text: { kind: 'detected_entity', entityType: 'mention', text: plain('@ada_writer') },
        },
        { kind: 'styled', style: 'code', text: plain('@ada_writer') },
        { kind: 'link', text: plain('@ada_writer'), url: 'https://grammy.dev' },
        { kind: 'button', button },
      ],
    },
  }, 'entities detected only in plain text outside code, links, and buttons');

  const preformatted: RichBlock = { kind: 'preformatted', text: plain('/start @ada_writer') };
  const buttonRow: RichBlock = { kind: 'buttons', buttons: [button] };
  expectJson(
    [normalizeBlock(preformatted), normalizeBlock(buttonRow)],
    [preformatted, buttonRow],
    'no entities detected in preformatted blocks or rows of buttons',
  );
  expectJson(
    normalizeBlock({ kind: 'heading', text: plain('/start'), size: 1 }, false),
    { kind: 'heading', text: plain('/start'), size: 1 },
    'no entities detected when the bot skips detection',
  );
});

Deno.test('rich messages clean their strings and mention only known users', () => {
  expectJson(
    normalizeBlock({
      kind: 'preformatted',
      text: {
        kind: 'link',
        text: plain('a\u0000b\r\nc'),
        url: 'https://grammy.dev/ ',
      },
      language: '\r',
    }),
    {
      kind: 'preformatted',
      text: { kind: 'link', text: plain('a b\nc'), url: 'https://grammy.dev/' },
    },
    'control characters replaced, removed characters dropped, and an empty language left out',
  );

  const failures = [
    { kind: 'paragraph', text: { kind: 'anchor', name: '\uD800' } },
    { kind: 'mathematical_expression', expression: 'x\uDC00' },
    {
      kind: 'paragraph',
      text: { kind: 'text_mention', text: plain('Grace'), userId: MENTIONABLE_USER_ID + 1 },
    },
  ] as const satisfies readonly RichBlock[];
  const errors = failures.map((block) => {
    const normalization = normalizeRichMessage({ blocks: [block], isRightToLeft: false }, true, {
      isMentionableUser: (userId) => userId === MENTIONABLE_USER_ID,
    });
    return normalization.normalized ? undefined : normalization.textError;
  });
  expectJson(errors, [
    'Anchor name must be encoded in UTF-8',
    'Mathematical expression must be encoded in UTF-8',
    'User not found',
  ], "TDLib's errors");
});

Deno.test('rich messages mention users by text mentions and detected usernames', () => {
  const richMessage = (text: RichText) => ({
    kind: 'rich_message' as const,
    blocks: [{ kind: 'paragraph' as const, text }],
    isRightToLeft: false,
  });
  const detectedMention = richMessage({
    kind: 'detected_entity',
    entityType: 'mention',
    text: plain('@Ada_Writer'),
  });
  const textMention = richMessage({ kind: 'text_mention', text: plain('Ada'), userId: 7 });
  if (
    !mentionsUser(detectedMention, { id: 1, username: 'ada_writer' }) ||
    !richMessageMentionsUser(textMention, { id: 7 }) ||
    mentionsUser(richMessage(plain('@ada_writer')), { id: 1, username: 'ada_writer' })
  ) {
    throw new Error('Expected only detected and text mentions to mention their users');
  }
});

Deno.test('repeated rich messages keep URL, copy-text and login buttons and disable the others', () => {
  const richMessage: RichMessage = {
    blocks: [{
      kind: 'buttons',
      buttons: [
        { text: plain('Go'), style: 'primary', action: { kind: 'callback', callbackData: 'go' } },
        { text: plain('Docs'), action: { kind: 'url', url: 'https://grammy.dev/' } },
        { text: plain('Copy'), action: { kind: 'copy_text', copiedText: 'code' } },
        {
          text: plain('Share'),
          action: { kind: 'switch_inline_query', query: '', target: { kind: 'current_chat' } },
        },
        { text: plain('Open'), action: { kind: 'web_app', url: 'https://grammy.dev/app' } },
        {
          text: plain('Log in'),
          action: {
            kind: 'login_url',
            url: 'https://grammy.dev/login',
            forwardText: 'Log in to grammY',
            requestsWriteAccess: true,
          },
        },
      ],
    }],
    isRightToLeft: false,
  };
  const unchangedButtons = [
    { text: plain('Go'), style: 'primary', action: { kind: 'disabled' } },
    { text: plain('Docs'), action: { kind: 'url', url: 'https://grammy.dev/' } },
    { text: plain('Copy'), action: { kind: 'copy_text', copiedText: 'code' } },
    { text: plain('Share'), action: { kind: 'disabled' } },
    { text: plain('Open'), action: { kind: 'disabled' } },
  ];
  expectJson(repeatRichMessage(richMessage, 'forward').blocks, [{
    kind: 'buttons',
    buttons: [
      ...unchangedButtons,
      {
        text: plain('Log in to grammY'),
        action: { kind: 'login_url', url: 'https://grammy.dev/login', requestsWriteAccess: true },
      },
    ],
  }], 'the buttons of a forward');
  expectJson(repeatRichMessage(richMessage, 'copy').blocks, [{
    kind: 'buttons',
    buttons: [
      ...unchangedButtons,
      { text: plain('Log in'), action: { kind: 'url', url: 'https://grammy.dev/login' } },
    ],
  }], 'the buttons of a copy');
});
