import { assertEquals } from '@std/assert';
import {
  checkLink,
  getCheckedLink,
  getLinkBotStart,
  getLinkCustomEmojiId,
  getLinkDateTime,
  getLinkUserId,
} from '../src/text_entities/telegram_link.ts';

Deno.test('getCheckedLink normalizes links as TDLib does', () => {
  // From the `check_link` test in TDLib's `test/link.cpp` at commit
  // ea97bcdd3a15523c58ddfe772b4547187cf5bbeb; an empty expectation marks an invalid link.
  const cases: ReadonlyArray<readonly [link: string, expected: string]> = [
    ['sftp://google.com', ''],
    ['tg://google_com', 'tg://google_com/'],
    ['tOn://google', 'ton://google/'],
    ['httP://google.com?1#tes', 'http://google.com/?1#tes'],
    ['httPs://google.com/?1#tes', 'https://google.com/?1#tes'],
    ['http://google.com:0', ''],
    ['http://google.com:0000000001', 'http://google.com:1/'],
    ['http://google.com:-1', ''],
    ['tg://google?1#tes', 'tg://google?1#tes'],
    ['tg://google/?1#tes', 'tg://google?1#tes'],
    ['TG:_', 'tg://_/'],
    ['http:google.com', ''],
    ['tg://http://google.com', ''],
    ['tg:http://google.com', ''],
    ['tg:https://google.com', ''],
    ['tg:test@google.com', ''],
    ['tg:google.com:80', ''],
    ['tg:google-com', 'tg://google-com/'],
    ['tg:google.com', ''],
    ['tg:google.com:0', ''],
    ['tg:google.com:a', ''],
    ['tg:[2001:db8:0:0:0:ff00:42:8329]', ''],
    ['tg:127.0.0.1', ''],
    ['http://[2001:db8:0:0:0:ff00:42:8329]', 'http://[2001:db8:0:0:0:ff00:42:8329]/'],
    ['http://localhost', ''],
    ['http://..', 'http://../'],
    ['..', 'http://../'],
    ['https://.', ''],
    ['tOnSiTe://google', 'tonsite://google/'],
    ['tOnSiTe://google.ton?t=1#we', 'tonsite://google.ton?t=1#we'],
  ];
  for (const [link, expected] of cases) {
    const checkedLink = getCheckedLink(link) ?? '';
    if (checkedLink !== expected) {
      throw new Error(
        `Expected ${JSON.stringify(link)} to check as ${JSON.stringify(expected)}, received ${
          JSON.stringify(checkedLink)
        }`,
      );
    }
  }
});

Deno.test('checkLink names the rejected link in its error', () => {
  const cases: ReadonlyArray<readonly [link: string, expectedError: string]> = [
    ['localhost', "URL 'localhost' is invalid: Wrong HTTP URL"],
    ['ftp://example.com', "URL 'ftp://example.com' is invalid: Unsupported URL protocol"],
    [
      'http://exa mple.com',
      "URL 'http://exa mple.com' is invalid: Disallowed character in URL host",
    ],
    ['http://user@', "URL 'http://user@' is invalid: URL host is empty"],
    [
      'http://example.com:99999',
      "URL 'http://example.com:99999' is invalid: Wrong port number specified in the URL",
    ],
  ];
  for (const [link, expectedError] of cases) {
    const check = checkLink(link);
    if (check.valid || check.error !== expectedError) {
      throw new Error(
        `Expected ${JSON.stringify(link)} to fail with ${expectedError}, received ${
          JSON.stringify(check)
        }`,
      );
    }
  }
  const check = checkLink('example.com/path with space');
  if (!check.valid || check.url !== 'http://example.com/path%20with%20space') {
    throw new Error(`Expected spaces in the path to be escaped, received ${JSON.stringify(check)}`);
  }
});

Deno.test('getLinkUserId reads user links as TDLib does', () => {
  const cases: ReadonlyArray<readonly [link: string, expected: number | undefined]> = [
    ['tg://user?id=123456', 123456],
    ['TG:USER?ID=42', 42],
    ['tg:user/?x=1&id=7#fragment', 7],
    ['tg://user?id=007', undefined],
    ['tg://user?id=0', undefined],
    ['tg://user?id=-5', undefined],
    [`tg://user?id=${2 ** 40}`, undefined],
    ['tg://users?id=1', undefined],
    ['tg://user#id=1', undefined],
    ['https://t.me/user?id=1', undefined],
  ];
  for (const [link, expected] of cases) {
    const userId = getLinkUserId(link);
    if (userId !== expected) {
      throw new Error(
        `Expected ${JSON.stringify(link)} to mention ${expected}, received ${userId}`,
      );
    }
  }
});

Deno.test('getLinkCustomEmojiId and getLinkDateTime read tg:// entity links', () => {
  const emoji = getLinkCustomEmojiId('TG://EMoJI/?test=1231&id=25#id=32');
  if (emoji.kind !== 'custom_emoji' || emoji.customEmojiId !== '25') {
    throw new Error(`Expected custom emoji 25, received ${JSON.stringify(emoji)}`);
  }
  const invalidEmoji = getLinkCustomEmojiId('tg://emoji?test=1231&id=025');
  if (invalidEmoji.kind !== 'invalid') {
    throw new Error(
      `Expected an invalid custom emoji ID, received ${JSON.stringify(invalidEmoji)}`,
    );
  }

  const dateTimes = [
    ['tg://time?unix=25', { unixTime: 25 }],
    [
      'TG://TiME/?test=1&format=Wt&unix=25#unix=32',
      {
        unixTime: 25,
        format: { kind: 'absolute', timePrecision: 'short', showsDayOfWeek: true },
      },
    ],
    // Given both ways, a part is shown short.
    [
      'tg://time?unix=25&format=TtDd',
      {
        unixTime: 25,
        format: {
          kind: 'absolute',
          timePrecision: 'short',
          datePrecision: 'short',
          showsDayOfWeek: false,
        },
      },
    ],
  ] as const;
  for (const [link, expected] of dateTimes) {
    const dateTime = getLinkDateTime(link);
    assertEquals(dateTime, expected, `Expected ${link} to show ${JSON.stringify(expected)}`);
  }
  for (const link of ['tg://time?format=r', 'tg://time?unix=0', 'tg://time?unix=5&format=rt']) {
    if (getLinkDateTime(link) !== undefined) {
      throw new Error(`Expected ${link} to be an invalid time link`);
    }
  }
});

Deno.test('getLinkBotStart reads links that start a bot with a parameter', () => {
  const cases: ReadonlyArray<readonly [link: string, expected: string | undefined]> = [
    ['t.me/test_bot?start=order-42', 'test_bot:order-42'],
    ['https://www.T.ME/Test_Bot?start=a_b#top', 'Test_Bot:a_b'],
    ['http://telegram.me/test_bot?ref=x&start=', 'test_bot:'],
    ['https://telegram.dog/test_bot/?start=1', undefined],
    ['tg://resolve?domain=test_bot&start=go', 'test_bot:go'],
    ['tg:resolve?start=go&domain=test_bot', 'test_bot:go'],
    ['https://t.me/test_bot', undefined],
    ['https://t.me/test_bot?start=a+b', undefined],
    [`https://t.me/test_bot?start=${'a'.repeat(65)}`, undefined],
    ['https://example.com/test_bot?start=go', undefined],
    ['tg://resolve?start=go', undefined],
  ];
  for (const [link, expected] of cases) {
    const startLink = getLinkBotStart(link);
    const received = startLink === undefined
      ? undefined
      : `${startLink.username}:${startLink.startParameter}`;
    if (received !== expected) {
      throw new Error(`Expected ${JSON.stringify(link)} to read ${expected}, received ${received}`);
    }
  }
});
