import type {
  RichBlock,
  RichBlockCaption,
  RichBlockListItem,
  RichBlockTableCell,
  RichMessage,
  RichMessageButton,
  RichText,
} from './types.ts';

/** Separates the texts of the cells or buttons of one row. */
export const ROW_ITEM_SEPARATOR = ' | ';

/** Returns rich text as the plain text a client shows, with buttons shown by their labels. */
export function richTextToPlainText(text: RichText): string {
  if (typeof text === 'string') return text;
  if (isRichTextSequence(text)) return text.map(richTextToPlainText).join('');
  switch (text.type) {
    case 'custom_emoji':
      return text.alternative_text;
    case 'mathematical_expression':
      return text.expression;
    case 'anchor':
      return '';
    case 'button':
      return richTextToPlainText(text.button.text);
    default:
      return richTextToPlainText(text.text);
  }
}

/**
 * Returns everything a rich message shows as plain text, for assertions about its content rather
 * than its layout. Each block starts a line, and a block with several parts, such as a caption or
 * a `details` summary, puts each part on its own line; blocks that show no text add none. A list
 * item starts with its label, such as `•` or `iv.`, and the cells of a table row and the buttons of
 * a row are separated by ` | `. The content of `details` and expandable blockquotes is included
 * whether or not they are open.
 */
export function richMessageToPlainText(message: RichMessage): string {
  return richBlockListText(message.blocks);
}

/**
 * A part of a rich block that holds text, blocks, list items, table rows, or buttons, with its
 * path relative to the block.
 */
export type RichBlockPart =
  | { readonly type: 'text'; readonly path: string; readonly text: RichText }
  | { readonly type: 'blocks'; readonly path: string; readonly blocks: readonly RichBlock[] }
  | {
    readonly type: 'list_items';
    readonly path: string;
    readonly items: readonly RichBlockListItem[];
  }
  | {
    readonly type: 'table_rows';
    readonly path: string;
    readonly rows: readonly (readonly RichBlockTableCell[])[];
  }
  | {
    readonly type: 'buttons';
    readonly path: string;
    readonly buttons: readonly RichMessageButton[];
  };

/** The parts of a block that show something, in the order a client shows them. */
export function richBlockParts(block: RichBlock): readonly RichBlockPart[] {
  switch (block.type) {
    case 'paragraph':
    case 'footer':
    case 'heading':
    case 'pre':
      return [{ type: 'text', path: '.text', text: block.text }];
    case 'mathematical_expression':
      return [{ type: 'text', path: '.expression', text: block.expression }];
    case 'divider':
    case 'anchor':
      return [];
    case 'list':
      return [{ type: 'list_items', path: '.items', items: block.items }];
    case 'blockquote':
      return [
        { type: 'blocks', path: '.blocks', blocks: block.blocks },
        ...optionalTextPart('.credit', block.credit),
      ];
    case 'expandable_blockquote':
    case 'pullquote':
      return [
        { type: 'text', path: '.text', text: block.text },
        ...optionalTextPart('.credit', block.credit),
      ];
    case 'collage':
    case 'slideshow':
      return [
        { type: 'blocks', path: '.blocks', blocks: block.blocks },
        ...captionParts(block.caption),
      ];
    case 'table':
      return [
        { type: 'table_rows', path: '.cells', rows: block.cells },
        ...optionalTextPart('.caption', block.caption),
      ];
    case 'details':
      return [
        { type: 'text', path: '.summary', text: block.summary },
        { type: 'blocks', path: '.blocks', blocks: block.blocks },
      ];
    case 'buttons':
      return [{ type: 'buttons', path: '.buttons', buttons: block.buttons }];
    case 'map':
    case 'photo':
    case 'document':
    case 'video':
    case 'voice_note':
      return captionParts(block.caption);
  }
}

function optionalTextPart(path: string, text: RichText | undefined): readonly RichBlockPart[] {
  return text === undefined ? [] : [{ type: 'text', path, text }];
}

function captionParts(caption: RichBlockCaption | undefined): readonly RichBlockPart[] {
  return caption === undefined ? [] : [
    { type: 'text', path: '.caption.text', text: caption.text },
    ...optionalTextPart('.caption.credit', caption.credit),
  ];
}

export function richBlockText(block: RichBlock): string {
  return joinLines(richBlockParts(block).map(richBlockPartText));
}

export function listItemText(item: RichBlockListItem): string {
  const content = richBlockListText(item.blocks);
  return content === '' ? item.label : `${item.label} ${content}`;
}

export function tableRowText(row: readonly RichBlockTableCell[]): string {
  return row.map((cell) => cell.text === undefined ? '' : richTextToPlainText(cell.text)).join(
    ROW_ITEM_SEPARATOR,
  );
}

export function isRichTextSequence(text: RichText): text is readonly RichText[] {
  return Array.isArray(text);
}

function richBlockListText(blocks: readonly RichBlock[]): string {
  return joinLines(blocks.map(richBlockText));
}

function richBlockPartText(part: RichBlockPart): string {
  switch (part.type) {
    case 'text':
      return richTextToPlainText(part.text);
    case 'blocks':
      return richBlockListText(part.blocks);
    case 'list_items':
      return joinLines(part.items.map(listItemText));
    case 'table_rows':
      return joinLines(part.rows.map(tableRowText));
    case 'buttons':
      return part.buttons.map((button) => richTextToPlainText(button.text)).join(
        ROW_ITEM_SEPARATOR,
      );
  }
}

/** Joins texts as lines, leaving out the empty texts of parts that show nothing. */
function joinLines(texts: readonly string[]): string {
  return texts.filter((text) => text !== '').join('\n');
}
