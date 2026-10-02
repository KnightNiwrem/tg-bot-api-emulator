import {
  type FormattedText,
  getContentText,
  isCaptionedMediaContent,
  type SupergroupMessageContent,
} from '../src/types/virtual_message.ts';

const CAPTION: FormattedText = {
  text: 'Receipt',
  entities: [{ type: 'bold', offset: 0, length: 7 }],
};
const NO_TEXT: FormattedText = { text: '', entities: [] };

/** Each kind of content, whether it is captioned media, and the text it carries. */
const CONTENT_CASES: readonly {
  readonly content: SupergroupMessageContent;
  readonly isCaptionedMedia: boolean;
  readonly contentText: FormattedText;
}[] = [
  {
    content: { kind: 'text', text: 'Hello', entities: [] },
    isCaptionedMedia: false,
    contentText: { text: 'Hello', entities: [] },
  },
  {
    content: {
      kind: 'photo',
      fileId: 'photo',
      caption: CAPTION,
      hasSpoiler: false,
      showsCaptionAboveMedia: false,
    },
    isCaptionedMedia: true,
    contentText: CAPTION,
  },
  {
    content: { kind: 'document', fileId: 'document', caption: CAPTION },
    isCaptionedMedia: true,
    contentText: CAPTION,
  },
  {
    content: {
      kind: 'video',
      fileId: 'video',
      caption: CAPTION,
      hasSpoiler: false,
      showsCaptionAboveMedia: false,
      startTimestampSeconds: 0,
    },
    isCaptionedMedia: true,
    contentText: CAPTION,
  },
  {
    content: { kind: 'rich_message', blocks: [], isRightToLeft: false },
    isCaptionedMedia: false,
    contentText: NO_TEXT,
  },
  {
    content: { kind: 'members_joined', memberIds: [1] },
    isCaptionedMedia: false,
    contentText: NO_TEXT,
  },
  { content: { kind: 'member_left', memberId: 1 }, isCaptionedMedia: false, contentText: NO_TEXT },
  {
    content: { kind: 'title_changed', title: 'Renamed' },
    isCaptionedMedia: false,
    contentText: NO_TEXT,
  },
];

Deno.test('isCaptionedMediaContent accepts only media shown with a caption', () => {
  for (const { content, isCaptionedMedia } of CONTENT_CASES) {
    if (isCaptionedMediaContent(content) !== isCaptionedMedia) {
      throw new Error(`Expected ${content.kind} to be captioned media: ${isCaptionedMedia}`);
    }
  }
});

Deno.test('getContentText reads text and captions, and no text of other content', () => {
  for (const { content, contentText } of CONTENT_CASES) {
    const { text, entities } = getContentText(content);
    const actualText = { text, entities };
    if (JSON.stringify(actualText) !== JSON.stringify(contentText)) {
      throw new Error(
        `Expected ${content.kind} to carry ${JSON.stringify(contentText)}, ` +
          `received ${JSON.stringify(actualText)}`,
      );
    }
  }
});
