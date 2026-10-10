/**
 * Finds the documented operation an HTTP request addresses, as an OpenAPI router would: by its path
 * template, preferring a concrete path over a templated one, and by its HTTP method.
 */
import {
  DOCUMENTED_HTTP_METHODS,
  type DocumentedHttpMethod,
  type DocumentedOperation,
  type OpenApiDocument,
} from './openapi_document.ts';

/**
 * Where the document's Bot API method paths start. The document states Telegram's request
 * conventions for them: each listed POST operation also accepts GET, and the method name, the
 * segment after the token, matches case-insensitively.
 */
const BOT_API_METHOD_PATH_PREFIX = '/sessions/{sessionId}/bot-api/bot{token}/';

/**
 * Telegram's older Bot API method names, lowercased, that still call the methods of their current
 * names, as the descriptions of those methods' operations state.
 */
const CURRENT_BOT_API_METHOD_NAMES_BY_OLDER_NAME: ReadonlyMap<string, string> = new Map([
  ['kickchatmember', 'banChatMember'],
  ['getchatmemberscount', 'getChatMemberCount'],
]);

export type OperationMatch =
  | {
    readonly kind: 'operation';
    readonly operation: DocumentedOperation;
    /** Percent-decoded, by parameter name. */
    readonly pathParameters: ReadonlyMap<string, string>;
  }
  /** The document lists the path but describes no operation for the request's method on it. */
  | { readonly kind: 'undocumented-operation'; readonly pathTemplate: string }
  | { readonly kind: 'undocumented-path' };

interface CompiledPathTemplate {
  readonly pathTemplate: string;
  readonly segments: readonly CompiledSegment[];
  /** How many characters of the template are literal; the more, the more concrete the path. */
  readonly literalLength: number;
  readonly followsBotApiConventions: boolean;
  readonly operationsByMethod: ReadonlyMap<DocumentedHttpMethod, DocumentedOperation>;
}

type CompiledSegment =
  | { readonly kind: 'literal'; readonly text: string; readonly ignoresCase: boolean }
  | {
    readonly kind: 'templated';
    readonly pattern: RegExp;
    readonly parameterNames: readonly string[];
  };

export class OperationMatcher {
  readonly #pathTemplates: readonly CompiledPathTemplate[];

  constructor(document: OpenApiDocument) {
    this.#pathTemplates = document.pathTemplates
      .map((pathTemplate) => compilePathTemplate(pathTemplate, document.operations))
      .sort((left, right) => right.literalLength - left.literalLength);
  }

  /** `path` is the request URL's path, still percent-encoded. */
  match(method: string, path: string): OperationMatch {
    const requestSegments = path.split('/');
    for (const pathTemplate of this.#pathTemplates) {
      const pathParameters = matchSegments(
        pathTemplate.segments,
        pathTemplate.followsBotApiConventions
          ? withCurrentBotApiMethodName(requestSegments)
          : requestSegments,
      );
      if (pathParameters === undefined) continue;
      const operation = findOperation(pathTemplate, method.toLowerCase());
      return operation === undefined
        ? { kind: 'undocumented-operation', pathTemplate: pathTemplate.pathTemplate }
        : { kind: 'operation', operation, pathParameters };
    }
    return { kind: 'undocumented-path' };
  }
}

/** `requestSegments` with a final older Bot API method name replaced by its current name. */
function withCurrentBotApiMethodName(requestSegments: readonly string[]): readonly string[] {
  const methodName = requestSegments.at(-1);
  const currentName = methodName === undefined
    ? undefined
    : CURRENT_BOT_API_METHOD_NAMES_BY_OLDER_NAME.get(methodName.toLowerCase());
  return currentName === undefined
    ? requestSegments
    : [...requestSegments.slice(0, -1), currentName];
}

function findOperation(
  pathTemplate: CompiledPathTemplate,
  requestMethod: string,
): DocumentedOperation | undefined {
  const documentedMethod = DOCUMENTED_HTTP_METHODS.find((method) => method === requestMethod);
  if (documentedMethod === undefined) return undefined;
  return pathTemplate.operationsByMethod.get(documentedMethod) ??
    (pathTemplate.followsBotApiConventions && documentedMethod === 'get'
      ? pathTemplate.operationsByMethod.get('post')
      : undefined);
}

function compilePathTemplate(
  pathTemplate: string,
  operations: readonly DocumentedOperation[],
): CompiledPathTemplate {
  const followsBotApiConventions = pathTemplate.startsWith(BOT_API_METHOD_PATH_PREFIX);
  const templateSegments = pathTemplate.split('/');
  const segments = templateSegments.map((segment, index): CompiledSegment => {
    if (!segment.includes('{')) {
      const isBotApiMethodName = followsBotApiConventions && index === templateSegments.length - 1;
      return { kind: 'literal', text: segment, ignoresCase: isBotApiMethodName };
    }
    const parameterNames: string[] = [];
    const source = segment.split(/(\{[^}]+\})/).map((part) => {
      const parameterName = /^\{([^}]+)\}$/.exec(part)?.[1];
      if (parameterName === undefined) return escapeRegExp(part);
      parameterNames.push(parameterName);
      return '(.+)';
    }).join('');
    return { kind: 'templated', pattern: new RegExp(`^${source}$`), parameterNames };
  });
  return {
    pathTemplate,
    segments,
    literalLength: pathTemplate.replaceAll(/\{[^}]+\}/g, '').length,
    followsBotApiConventions,
    operationsByMethod: new Map(
      operations
        .filter((operation) => operation.pathTemplate === pathTemplate)
        .map((operation) => [operation.method, operation]),
    ),
  };
}

function matchSegments(
  templateSegments: readonly CompiledSegment[],
  requestSegments: readonly string[],
): Map<string, string> | undefined {
  if (templateSegments.length !== requestSegments.length) return undefined;
  const pathParameters = new Map<string, string>();
  for (const [index, templateSegment] of templateSegments.entries()) {
    const requestSegment = requestSegments[index];
    if (templateSegment.kind === 'literal') {
      const matches = templateSegment.ignoresCase
        ? templateSegment.text.toLowerCase() === requestSegment.toLowerCase()
        : templateSegment.text === requestSegment;
      if (!matches) return undefined;
      continue;
    }
    const captured = templateSegment.pattern.exec(requestSegment);
    if (captured === null) return undefined;
    for (const [parameterIndex, parameterName] of templateSegment.parameterNames.entries()) {
      const encodedValue = captured[parameterIndex + 1];
      const decodedValue = decodePathParameter(encodedValue);
      if (decodedValue === undefined) return undefined;
      pathParameters.set(parameterName, decodedValue);
    }
  }
  return pathParameters;
}

function decodePathParameter(encodedValue: string): string | undefined {
  try {
    return decodeURIComponent(encodedValue);
  } catch {
    return undefined;
  }
}

function escapeRegExp(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
