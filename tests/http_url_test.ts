import { getHttpUrlFileName, parseHttpUrl } from '../src/types/http_url.ts';

Deno.test('parseHttpUrl reads URLs into TDLib canonical form', () => {
  const cases = [
    [
      'https://Example.COM/Files/Report.pdf?x=1#top',
      'https://example.com/Files/Report.pdf?x=1#top',
    ],
    ['example.com/a.png', 'http://example.com/a.png'],
    ['HTTP://example.com', 'http://example.com/'],
    [
      'https://user:secret@example.com:0443/a b.pdf  ',
      'https://user:secret@example.com:443/a%20b.pdf',
    ],
    ['https://[::1]:8443/x', 'https://[::1]:8443/x'],
    // TDLib trims only its own spaces, among them NUL, and keeps a form feed, which it encodes.
    ['https://example.com/a.pdf\0\v', 'https://example.com/a.pdf'],
    ['https://example.com/a.pdf\f', 'https://example.com/a.pdf%0C'],
    ['https://пример.рф/файл.pdf', 'https://пример.рф/файл.pdf'],
  ];
  for (const [text, expectedUrl] of cases) {
    const parsing = parseHttpUrl(text);
    if (!parsing.parsed || parsing.url !== expectedUrl) {
      throw new Error(
        `Expected ${text} to read as ${expectedUrl}, received ${JSON.stringify(parsing)}`,
      );
    }
  }
});

Deno.test('parseHttpUrl refuses URLs with TDLib descriptions', () => {
  const cases = [
    ['ftp://example.com/a.pdf', 'Unsupported URL protocol'],
    ['https://example.com:0/a.pdf', 'Wrong port number specified in the URL'],
    ['https://example.com:65536/a.pdf', 'Wrong port number specified in the URL'],
    ['https://example.com:/a.pdf', 'Wrong port number specified in the URL'],
    ['https://[not-ipv6]/a.pdf', 'Wrong IPv6 address specified in the URL'],
    ['https:///a.pdf', 'URL host is empty'],
    ['.', 'Host is invalid'],
    ['https://exa mple.com/a.pdf', 'Disallowed character in URL host'],
    ['https://exa%2.com/a.pdf', 'Wrong percent-encoded symbol in URL host'],
    ['https://us"er@example.com/a.pdf', 'Disallowed character in URL userinfo'],
  ];
  for (const [text, expectedError] of cases) {
    const parsing = parseHttpUrl(text);
    if (parsing.parsed || parsing.error !== expectedError) {
      throw new Error(
        `Expected ${text} to fail with ${expectedError}, received ${JSON.stringify(parsing)}`,
      );
    }
  }
});

Deno.test('getHttpUrlFileName takes the last path segment without query or fragment', () => {
  const cases = [
    ['/files/report.pdf?download=1', 'report.pdf'],
    ['/files/archive.zip#part', 'archive.zip'],
    ['/files/', ''],
    ['/', ''],
  ];
  for (const [query, expectedFileName] of cases) {
    if (getHttpUrlFileName(query) !== expectedFileName) {
      throw new Error(`Expected ${query} to name ${expectedFileName}`);
    }
  }
});
