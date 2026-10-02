/**
 * TDLib's reading of HTTP URLs, `parse_url` and `HttpUrl::get_url` in
 * `tdutils/td/utils/HttpUrl.cpp`, which both link checks and files sent by URL rely on. Failures
 * carry TDLib's own error message.
 */

/** An HTTP URL as TDLib's `parse_url` reads it. */
export interface HttpUrl {
  readonly protocol: 'http' | 'https';
  readonly userinfo: string;
  /** Lowercased in ASCII. */
  readonly host: string;
  readonly isIpv6: boolean;
  /** 0 when the URL names no port. */
  readonly specifiedPort: number;
  /** The path, query, and fragment; always begins with `/`. */
  readonly query: string;
}

export type HttpUrlParsing =
  | { readonly parsed: true; readonly url: HttpUrl }
  | { readonly parsed: false; readonly error: string };

/** Characters that end the protocol part of a URL in TDLib's `parse_url`. */
const PROTOCOL_TERMINATORS = ':/?#@[]';
/** Characters that end the user information, host, and port part of a URL. */
const AUTHORITY_TERMINATORS = '/?#';
/** Punctuation that RFC 7230 and RFC 3986 allow in a URL host or user information. */
const URL_PART_PUNCTUATION = ".-_!$,~*'();&+=";

const MAX_PORT = 65_535;

/**
 * Mirrors TDLib's `parse_url` with HTTP as the default protocol: `[http[s]://][userinfo@]host
 * [:port][/query]`, where the host is lowercased in ASCII and control characters and spaces in the
 * query are percent-encoded. As in TDLib, the user information of an IPv6 host is not checked.
 */
export function parseHttpUrl(url: string): HttpUrlParsing {
  let position = 0;
  const protocolText = toAsciiLowerCase(readUntil(url, position, PROTOCOL_TERMINATORS));
  let protocol: HttpUrl['protocol'] = 'http';
  if (url.startsWith('://', protocolText.length)) {
    if (protocolText !== 'http' && protocolText !== 'https') {
      return { parsed: false, error: 'Unsupported URL protocol' };
    }
    protocol = protocolText;
    position = protocolText.length + '://'.length;
  }

  const authority = readUntil(url, position, AUTHORITY_TERMINATORS);
  position += authority.length;

  let colonIndex = authority.length - 1;
  while (colonIndex > 0 && !':]@'.includes(authority[colonIndex])) {
    colonIndex--;
  }
  let port = 0;
  let userinfoAndHost = authority;
  if (colonIndex > 0 && authority[colonIndex] === ':') {
    let portText = authority.slice(colonIndex + 1);
    while (portText.length > 1 && portText[0] === '0') {
      portText = portText.slice(1);
    }
    const parsedPort = /^\d+$/.test(portText) && String(Number(portText)) === portText
      ? Number(portText)
      : 0;
    port = parsedPort === 0 ? -1 : parsedPort;
    userinfoAndHost = authority.slice(0, colonIndex);
  }
  if (port < 0 || port > MAX_PORT) {
    return { parsed: false, error: 'Wrong port number specified in the URL' };
  }

  const atIndex = userinfoAndHost.lastIndexOf('@');
  const userinfo = atIndex === -1 ? '' : userinfoAndHost.slice(0, atIndex);
  const host = userinfoAndHost.slice(atIndex + 1);

  const isIpv6 = host.length > 0 && host[0] === '[' && host.endsWith(']');
  if (isIpv6 && !URL.canParse(`http://${host}/`)) {
    return { parsed: false, error: 'Wrong IPv6 address specified in the URL' };
  }
  if (host.length === 0) {
    return { parsed: false, error: 'URL host is empty' };
  }
  if (host === '.') {
    return { parsed: false, error: 'Host is invalid' };
  }

  let rawQuery = url.slice(position);
  while (rawQuery.length > 0 && isTdlibSpace(rawQuery[rawQuery.length - 1])) {
    rawQuery = rawQuery.slice(0, -1);
  }
  if (rawQuery.length === 0) {
    rawQuery = '/';
  }
  let query = rawQuery[0] === '/' ? '' : '/';
  for (const character of rawQuery) {
    const codePoint = character.codePointAt(0) ?? 0;
    query += codePoint <= 0x20
      ? `%${codePoint.toString(16).toUpperCase().padStart(2, '0')}`
      : character;
  }

  const lowerCasedHost = toAsciiLowerCase(host);
  if (isIpv6) {
    if (!/^[:0-9a-f.]*$/.test(lowerCasedHost.slice(1, -1))) {
      return { parsed: false, error: 'Wrong IPv6 URL host' };
    }
  } else {
    const partError = checkUrlPart(lowerCasedHost, 'host', false) ??
      checkUrlPart(userinfo, 'userinfo', true);
    if (partError !== undefined) {
      return { parsed: false, error: partError };
    }
  }

  return {
    parsed: true,
    url: { protocol, userinfo, host: lowerCasedHost, isIpv6, specifiedPort: port, query },
  };
}

/** Writes a URL in TDLib's canonical form, as `HttpUrl::get_url` does. */
export function formatHttpUrl(
  { protocol, userinfo, host, specifiedPort, query }: HttpUrl,
): string {
  const userinfoPart = userinfo.length === 0 ? '' : `${userinfo}@`;
  const portPart = specifiedPort > 0 ? `:${specifiedPort}` : '';
  return `${protocol}://${userinfoPart}${host}${portPart}${query}`;
}

/**
 * Returns the file name a URL gives a file, as TDLib's `get_url_query_file_name` does: the last
 * segment of its path, without the query and fragment.
 */
export function getHttpUrlFileName({ query }: HttpUrl): string {
  const path = query.split(/[?#]/, 1)[0];
  return path.slice(path.lastIndexOf('/') + 1);
}

/** Lowercases ASCII letters only, as TDLib's `to_lower` does. */
export function toAsciiLowerCase(text: string): string {
  return text.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

/** Returns TDLib's error for a character a URL host or user information may not contain. */
function checkUrlPart(part: string, name: string, allowColon: boolean): string | undefined {
  for (let index = 0; index < part.length; index++) {
    const character = part[index];
    if (
      /^[A-Za-z0-9]$/.test(character) || URL_PART_PUNCTUATION.includes(character) ||
      (allowColon && character === ':')
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
    // Plain Unicode characters are allowed.
    if (character.charCodeAt(0) >= 0x80) {
      continue;
    }
    return `Disallowed character in URL ${name}`;
  }
  return undefined;
}

function readUntil(text: string, start: number, terminators: string): string {
  let end = start;
  while (end < text.length && !terminators.includes(text[end])) {
    end++;
  }
  return text.slice(start, end);
}

/** TDLib's `is_space`, which also counts NUL and vertical tab. */
function isTdlibSpace(character: string): boolean {
  return ' \t\r\n\0\v'.includes(character);
}
