import { MAX_START_PARAMETER_LENGTH } from '../types/inline_query.ts';
import { MAX_TELEGRAM_USER_ID, MIN_TELEGRAM_USER_ID } from '../types/telegram_identity.ts';
import type { DateTimeFormat } from '../types/virtual_message.ts';
import { formatHttpUrl, parseHttpUrl, toAsciiLowerCase } from '../types/http_url.ts';
import { readMarkupDateTimeFormat } from './date_time_format.ts';

/**
 * Link rules that Telegram applies to text links and bot start links, mirroring
 * `LinkManager::check_link`, `LinkManager::get_link_user_id`,
 * `LinkManager::get_link_custom_emoji_id`, `LinkManager::get_link_formatted_date`, and the parsing
 * of bot start links in TDLib's `td/telegram/LinkManager.cpp`; URLs are read as `parseHttpUrl`
 * reads them.
 *
 * Failures carry TDLib's own error message, which callers wrap as Telegram does.
 */

export type LinkCheck =
  | { readonly valid: true; readonly url: string }
  | { readonly valid: false; readonly error: string };

type LinkScheme = 'tg' | 'ton' | 'tonsite';

const LINK_SCHEMES: readonly LinkScheme[] = ['tg', 'ton', 'tonsite'];

const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;
const INT32_MAX = 2n ** 31n - 1n;

/**
 * Checks and normalizes a link as TDLib's `LinkManager::check_link` does: by default as for a text
 * link given as an entity, or, with `httpsOnly`, allowing only HTTPS links, as for a Web App. An
 * error names the link, as in `URL 'example' is invalid: Wrong HTTP URL`.
 */
export function checkLink(
  link: string,
  { httpsOnly = false }: { readonly httpsOnly?: boolean } = {},
): LinkCheck {
  const check = checkLinkWithoutContext(link, httpsOnly);
  return check.valid ? check : { valid: false, error: `URL '${link}' is invalid: ${check.error}` };
}

/**
 * Normalizes a link as TDLib does for a link written in markup, or returns `undefined` for an
 * invalid link, which markup drops silently.
 */
export function getCheckedLink(link: string): string | undefined {
  const check = checkLinkWithoutContext(link, false);
  return check.valid ? check.url : undefined;
}

/** Returns the user a `tg://user?id=` link mentions, or `undefined` for any other link. */
export function getLinkUserId(link: string): number | undefined {
  let rest = toAsciiLowerCase(link);
  if (!rest.startsWith('tg:')) {
    return undefined;
  }
  rest = removePrefix(rest.slice('tg:'.length), '//');

  const host = 'user';
  if (!rest.startsWith(host) || (rest.length > host.length && !'/?#'.includes(rest[host.length]))) {
    return undefined;
  }
  rest = removePrefix(rest.slice(host.length), '/');
  if (!rest.startsWith('?')) {
    return undefined;
  }

  const userIdText = findQueryParameter(truncateAt(rest.slice(1), '#'), 'id');
  const userId = userIdText === undefined ? undefined : parseInt64(userIdText);
  if (
    userId === undefined || userId < BigInt(MIN_TELEGRAM_USER_ID) ||
    userId > BigInt(MAX_TELEGRAM_USER_ID)
  ) {
    return undefined;
  }
  return Number(userId);
}

export type CustomEmojiLinkReading =
  | { readonly kind: 'custom_emoji'; readonly customEmojiId: string }
  | { readonly kind: 'invalid'; readonly error: string };

/**
 * Reads the custom emoji identifier from a `tg://emoji?id=` link, as TDLib's
 * `get_link_custom_emoji_id` does.
 */
export function getLinkCustomEmojiId(link: string): CustomEmojiLinkReading {
  const query = getTgLinkQuery(link, 'emoji');
  if (!query.found) {
    return { kind: 'invalid', error: query.error };
  }
  const customEmojiIdText = findQueryParameter(query.query, 'id');
  if (customEmojiIdText === undefined) {
    return { kind: 'invalid', error: 'Custom emoji URL must have an emoji identifier' };
  }
  const customEmojiId = parseCustomEmojiId(customEmojiIdText);
  return customEmojiId === undefined
    ? { kind: 'invalid', error: 'Invalid custom emoji identifier specified' }
    : { kind: 'custom_emoji', customEmojiId };
}

/** The date and time that a `tg://time` link describes. */
export interface LinkDateTime {
  /** The positive Unix time of the link's `unix` parameter. */
  readonly unixTime: number;
  /** Omitted when the link chooses no format. */
  readonly format?: DateTimeFormat;
}

/**
 * Reads a `tg://time` link, which Telegram uses for date and time entities: it needs a positive
 * `unix` time and accepts a `format`, as `readMarkupDateTimeFormat` reads it. Mirrors TDLib's
 * `get_link_formatted_date`; returns `undefined` for any other link.
 */
export function getLinkDateTime(link: string): LinkDateTime | undefined {
  const query = getTgLinkQuery(link, 'time');
  if (!query.found) {
    return undefined;
  }
  let unixTime = 0;
  let format = '';
  for (const parameter of query.query.split('&')) {
    const separatorIndex = parameter.indexOf('=');
    const key = separatorIndex === -1 ? parameter : parameter.slice(0, separatorIndex);
    const value = separatorIndex === -1 ? '' : parameter.slice(separatorIndex + 1);
    if (key === 'unix') {
      const parsedUnixTime = parseInt64(value);
      if (parsedUnixTime === undefined || parsedUnixTime <= 0n || parsedUnixTime > INT32_MAX) {
        return undefined;
      }
      unixTime = Number(parsedUnixTime);
    }
    if (key === 'format') {
      format = value;
    }
  }
  if (unixTime === 0) {
    return undefined;
  }
  const formatReading = readMarkupDateTimeFormat(format);
  if (!formatReading.valid) {
    return undefined;
  }
  return formatReading.format === undefined
    ? { unixTime }
    : { unixTime, format: formatReading.format };
}

/** A link that opens a bot's private chat to start the bot with a parameter. */
export interface BotStartLink {
  /** The bot's username, as the link writes it. */
  readonly username: string;
  readonly startParameter: string;
}

/** The domains of Telegram's t.me links, as TDLib's `LinkManager::get_link_info` lists them. */
const T_ME_HOSTS: readonly string[] = ['t.me', 'telegram.me', 'telegram.dog'];

/** Characters of a start parameter, as TDLib's `is_valid_start_parameter` allows them. */
const START_PARAMETER_PATTERN = /^[A-Za-z0-9_-]*$/;

/**
 * Reads a link that starts a bot with a parameter, as TDLib's `LinkManager` parses
 * `t.me/<username>?start=<parameter>` on Telegram's t.me domains and
 * `tg://resolve?domain=<username>&start=<parameter>`. Returns `undefined` for any other link,
 * including forms TDLib also recognizes, such as `<username>.t.me` subdomains, which the emulator
 * does not read.
 */
export function getLinkBotStart(link: string): BotStartLink | undefined {
  let username: string | undefined;
  let query: string;
  const tgLink = getTgLinkQuery(link, 'resolve');
  if (tgLink.found) {
    username = findQueryParameter(tgLink.query, 'domain');
    query = tgLink.query;
  } else {
    const parsing = parseHttpUrl(link);
    if (!parsing.parsed || !T_ME_HOSTS.includes(removePrefix(parsing.url.host, 'www.'))) {
      return undefined;
    }
    const pathAndQuery = truncateAt(parsing.url.query, '#');
    const queryIndex = pathAndQuery.indexOf('?');
    const path = queryIndex === -1 ? pathAndQuery : pathAndQuery.slice(0, queryIndex);
    username = removePrefix(path, '/');
    query = queryIndex === -1 ? '' : pathAndQuery.slice(queryIndex + 1);
  }
  const startParameter = findQueryParameter(query, 'start');
  if (
    username === undefined || username.length === 0 || username.includes('/') ||
    startParameter === undefined || startParameter.length > MAX_START_PARAMETER_LENGTH ||
    !START_PARAMETER_PATTERN.test(startParameter)
  ) {
    return undefined;
  }
  return { username, startParameter };
}

/**
 * Reads a custom emoji identifier: a nonzero signed 64-bit integer written without a sign or
 * leading zeros that would change its value.
 */
export function parseCustomEmojiId(text: string): string | undefined {
  const customEmojiId = parseInt64(text);
  return customEmojiId === undefined || customEmojiId === 0n ? undefined : customEmojiId.toString();
}

/**
 * Reads a signed 64-bit integer that `to_integer_safe` accepts: its decimal text must round-trip,
 * so a plus sign, leading zeros, and `-0` are rejected.
 */
function parseInt64(text: string): bigint | undefined {
  if (!/^-?\d+$/.test(text)) {
    return undefined;
  }
  const value = BigInt(text);
  if (value < INT64_MIN || value > INT64_MAX || value.toString() !== text) {
    return undefined;
  }
  return value;
}

type TgLinkQuery =
  | { readonly found: true; readonly query: string }
  | { readonly found: false; readonly error: string };

/** Mirrors TDLib's `check_tg_url_host`: returns the query of a `tg://<host>?…` link. */
function getTgLinkQuery(link: string, host: string): TgLinkQuery {
  const lowerCasedLink = toAsciiLowerCase(link);
  if (!lowerCasedLink.startsWith('tg:')) {
    return { found: false, error: 'URL must have scheme tg' };
  }
  let rest = link.slice('tg:'.length);
  let lowerCasedRest = lowerCasedLink.slice('tg:'.length);
  if (rest.startsWith('//')) {
    rest = rest.slice(2);
    lowerCasedRest = lowerCasedRest.slice(2);
  }
  if (
    !lowerCasedRest.startsWith(host) ||
    (rest.length > host.length && !'/?#'.includes(rest[host.length]))
  ) {
    return { found: false, error: `URL must have host "${host}"` };
  }
  rest = removePrefix(rest.slice(host.length), '/');
  if (!rest.startsWith('?')) {
    return { found: false, error: 'URL must have parameters' };
  }
  return { found: true, query: truncateAt(rest.slice(1), '#') };
}

function findQueryParameter(query: string, name: string): string | undefined {
  for (const parameter of query.split('&')) {
    const separatorIndex = parameter.indexOf('=');
    const key = separatorIndex === -1 ? parameter : parameter.slice(0, separatorIndex);
    if (key === name) {
      return separatorIndex === -1 ? '' : parameter.slice(separatorIndex + 1);
    }
  }
  return undefined;
}

/** Mirrors TDLib's `check_link_impl` for links that may use any scheme Telegram accepts. */
function checkLinkWithoutContext(link: string, httpsOnly: boolean): LinkCheck {
  let rest = link;
  const scheme = LINK_SCHEMES.find((candidate) =>
    toAsciiLowerCase(rest).startsWith(`${candidate}:`)
  );
  if (scheme !== undefined) {
    rest = removePrefix(rest.slice(scheme.length + 1), '//');
  }

  const parsing = parseHttpUrl(rest);
  if (!parsing.parsed) {
    return { valid: false, error: parsing.error };
  }
  const url = parsing.url;
  if (httpsOnly && (url.protocol !== 'https' || scheme !== undefined)) {
    return { valid: false, error: 'Only HTTPS links are allowed' };
  }

  if (scheme !== undefined) {
    if (
      toAsciiLowerCase(rest).startsWith('http://') || url.protocol === 'https' ||
      url.userinfo.length > 0 || url.specifiedPort !== 0 || url.isIpv6
    ) {
      return { valid: false, error: scheme === 'tg' ? 'Wrong tg URL' : 'Wrong ton URL' };
    }
    const query = url.query.length > 1 && url.query[1] === '?' ? url.query.slice(1) : url.query;
    for (const character of url.host) {
      if (
        !isAsciiAlphanumeric(character) && character !== '-' && character !== '_' &&
        !(scheme === 'tonsite' && character === '.')
      ) {
        return { valid: false, error: 'Unallowed characters in URL host' };
      }
    }
    return { valid: true, url: `${scheme}://${url.host}${query}` };
  }

  if (!url.host.includes('.') && !url.isIpv6) {
    return { valid: false, error: 'Wrong HTTP URL' };
  }
  return { valid: true, url: formatHttpUrl(url) };
}

function removePrefix(text: string, prefix: string): string {
  return text.startsWith(prefix) ? text.slice(prefix.length) : text;
}

function truncateAt(text: string, terminator: string): string {
  const index = text.indexOf(terminator);
  return index === -1 ? text : text.slice(0, index);
}

function isAsciiAlphanumeric(character: string | undefined): boolean {
  return character !== undefined && /^[A-Za-z0-9]$/.test(character);
}
