/** An HTTP URL as TDLib's `parse_url` reads it, or TDLib's description of why it cannot. */
export type HttpUrlParsing =
  | {
    readonly parsed: true;
    /** The URL in TDLib's canonical form, as `HttpUrl::get_url` writes it. */
    readonly url: string;
    /** The path and query, which always begin with `/`. */
    readonly query: string;
  }
  | { readonly parsed: false; readonly error: string };

/** Characters that end a URL's protocol, as TDLib's parser reads it. */
const PROTOCOL_TERMINATORS = /[:/?#@[\]]/;

/** Trailing characters that TDLib's `is_space` reads as spaces, which it trims from a query. */
const TRAILING_TDLIB_SPACES = /[ \t\r\n\0\v]+$/;

/** Characters, besides letters and digits, that RFC 3986 allows in a URL's host and userinfo. */
const URL_PART_SYMBOLS = ".-_!$,~*'();&+=";

/**
 * Reads an HTTP URL as TDLib's `parse_url` does: `[http[s]://][userinfo@]host[:port][/query]`, where
 * a URL without a protocol is an HTTP one, the host is lowercased, and control characters and
 * spaces in the query are percent-encoded. The descriptions of URLs it refuses are TDLib's.
 */
export function parseHttpUrl(text: string): HttpUrlParsing {
  const protocolEnd = text.search(PROTOCOL_TERMINATORS);
  let protocol: 'http' | 'https' = 'http';
  let rest = text;
  if (protocolEnd !== -1 && text.startsWith('://', protocolEnd)) {
    const protocolText = text.slice(0, protocolEnd).toLowerCase();
    if (protocolText !== 'http' && protocolText !== 'https') {
      return { parsed: false, error: 'Unsupported URL protocol' };
    }
    protocol = protocolText;
    rest = text.slice(protocolEnd + 3);
  }

  const authorityEnd = rest.search(/[/?#]/);
  const authority = authorityEnd === -1 ? rest : rest.slice(0, authorityEnd);
  const rawQuery = authorityEnd === -1 ? '' : rest.slice(authorityEnd);

  const portReading = readPort(authority);
  if (portReading === undefined) {
    return { parsed: false, error: 'Wrong port number specified in the URL' };
  }
  const { userinfoAndHost, specifiedPort } = portReading;
  const atIndex = userinfoAndHost.lastIndexOf('@');
  const userinfo = atIndex === -1 ? '' : userinfoAndHost.slice(0, atIndex);
  const host = userinfoAndHost.slice(atIndex + 1).toLowerCase();

  const isIpv6 = host.startsWith('[') && host.endsWith(']');
  if (isIpv6 && !URL.canParse(`http://${host}/`)) {
    return { parsed: false, error: 'Wrong IPv6 address specified in the URL' };
  }
  if (host.length === 0) {
    return { parsed: false, error: 'URL host is empty' };
  }
  if (host === '.') {
    return { parsed: false, error: 'Host is invalid' };
  }
  const partError = isIpv6
    ? undefined
    : checkUrlPart(host, 'host', false) ?? checkUrlPart(userinfo, 'userinfo', true);
  if (partError !== undefined) {
    return { parsed: false, error: partError };
  }

  const query = normalizeQuery(rawQuery);
  const url = `${protocol}://${userinfo.length === 0 ? '' : `${userinfo}@`}${host}${
    specifiedPort === undefined ? '' : `:${specifiedPort}`
  }${query}`;
  return { parsed: true, url, query };
}

/**
 * Splits a port off a URL's authority as TDLib does: after the last colon that follows any `]` or
 * `@`, with leading zeros ignored. Returns `undefined` for a port that is not a number from 1 to
 * 65535.
 */
function readPort(
  authority: string,
): { readonly userinfoAndHost: string; readonly specifiedPort?: number } | undefined {
  let colonIndex = authority.length - 1;
  while (colonIndex > 0 && !':]@'.includes(authority[colonIndex])) {
    colonIndex--;
  }
  if (colonIndex <= 0 || authority[colonIndex] !== ':') {
    return { userinfoAndHost: authority };
  }
  const portText = authority.slice(colonIndex + 1).replace(/^0+(?=.)/, '');
  const port = /^\d{1,5}$/.test(portText) ? Number(portText) : 0;
  return port === 0 || port > 65_535
    ? undefined
    : { userinfoAndHost: authority.slice(0, colonIndex), specifiedPort: port };
}

/** Checks a URL's host or userinfo as TDLib does, returning its description of a fault. */
function checkUrlPart(part: string, name: string, allowsColon: boolean): string | undefined {
  for (let index = 0; index < part.length; index++) {
    const character = part[index];
    if (
      /[A-Za-z0-9]/.test(character) || URL_PART_SYMBOLS.includes(character) ||
      (allowsColon && character === ':') || character.charCodeAt(0) >= 128
    ) {
      continue;
    }
    if (character === '%') {
      if (/^[0-9A-Fa-f]{2}$/.test(part.slice(index + 1, index + 3))) {
        index += 2;
        continue;
      }
      return `Wrong percent-encoded symbol in URL ${name}`;
    }
    return `Disallowed character in URL ${name}`;
  }
  return undefined;
}

/**
 * Normalizes a URL's path and query as TDLib does: trailing whitespace is dropped, the query
 * begins with `/`, and control characters and spaces are percent-encoded.
 */
function normalizeQuery(rawQuery: string): string {
  const trimmedQuery = rawQuery.replace(TRAILING_TDLIB_SPACES, '');
  const query = trimmedQuery.length === 0 ? '/' : trimmedQuery;
  let normalizedQuery = query.startsWith('/') ? '' : '/';
  for (const character of query) {
    const codePoint = character.codePointAt(0) ?? 0;
    normalizedQuery += codePoint <= 0x20
      ? `%${codePoint.toString(16).toUpperCase().padStart(2, '0')}`
      : character;
  }
  return normalizedQuery;
}

/**
 * Returns the file name a URL gives a file, as TDLib's `get_url_query_file_name` does: the last
 * segment of its path, without the query and fragment.
 */
export function getHttpUrlFileName(query: string): string {
  const path = query.split(/[?#]/, 1)[0];
  return path.slice(path.lastIndexOf('/') + 1);
}
