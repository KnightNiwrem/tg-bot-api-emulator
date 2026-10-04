import { parse as parseYaml } from '@std/yaml';
import { z } from 'zod';
import inlineQueryResultsButtonYaml from '../openapi/components/schemas/InlineQueryResultsButton.yaml' with {
  type: 'text',
};
import { inlineQueryResultsButtonParameter } from '../src/api/sessions/bot_api/inline_query_answer_parameters.ts';

/**
 * The parts of the `InlineQueryResultsButton` OpenAPI schema these tests rely on. The Web App URL
 * must keep `format: uri`, because its pattern constrains only the scheme.
 */
const webAppUrlSchemaShape = z.object({
  type: z.literal('string'),
  format: z.literal('uri'),
  pattern: z.string(),
  examples: z.array(z.string()).nonempty(),
});

const buttonSchemaShape = z.object({
  oneOf: z.array(z.object({ properties: z.record(z.string(), z.unknown()) })),
});

const webAppButtonPropertiesShape = z.object({
  web_app: z.object({ properties: z.object({ url: webAppUrlSchemaShape }) }),
});

/** Reads the Web App URL schema from the OpenAPI document, failing on an unexpected shape. */
function readWebAppUrlSchema(): z.infer<typeof webAppUrlSchemaShape> {
  const buttonSchema = buttonSchemaShape.parse(parseYaml(inlineQueryResultsButtonYaml));
  const webAppButton = buttonSchema.oneOf.find(({ properties }) => 'web_app' in properties);
  if (webAppButton === undefined) {
    throw new Error('Expected InlineQueryResultsButton to have a Web App variant');
  }
  return webAppButtonPropertiesShape.parse(webAppButton.properties).web_app.properties.url;
}

/** Compiles a JSON Schema `pattern`: an ECMA-262 regular expression, unanchored and without flags. */
function compileSchemaPattern(pattern: string): RegExp {
  return new RegExp(pattern, 'u');
}

function runtimeAcceptsWebAppUrl(url: string): boolean {
  return inlineQueryResultsButtonParameter()
    .safeParse(JSON.stringify({ text: 'Open', web_app: { url } })).success;
}

Deno.test('InlineQueryResultsButton schema documents Web App URLs that the runtime accepts', () => {
  const webAppUrlSchema = readWebAppUrlSchema();
  const pattern = compileSchemaPattern(webAppUrlSchema.pattern);
  for (const example of webAppUrlSchema.examples) {
    if (!pattern.test(example) || !runtimeAcceptsWebAppUrl(example)) {
      throw new Error(`Expected the schema and runtime to accept the example ${example}`);
    }
  }
});

Deno.test('InlineQueryResultsButton schema and runtime agree on the Web App URL scheme', () => {
  const pattern = compileSchemaPattern(readWebAppUrlSchema().pattern);
  const cases: [string, boolean][] = [
    ['https://example.com/app', true],
    ['HTTPS://example.com/app', true],
    ['HtTpS://example.com/app', true],
    ['http://example.com/app', false],
    ['HTTP://example.com/app', false],
    ['ftp://example.com/app', false],
    ['example.com/app', false],
  ];
  for (const [url, expectedAccepted] of cases) {
    const schemaAccepts = pattern.test(url);
    const runtimeAccepts = runtimeAcceptsWebAppUrl(url);
    if (schemaAccepts !== expectedAccepted || runtimeAccepts !== expectedAccepted) {
      throw new Error(
        `Expected ${url} to be ${expectedAccepted ? 'accepted' : 'rejected'}, but the schema ${
          schemaAccepts ? 'accepts' : 'rejects'
        } and the runtime ${runtimeAccepts ? 'accepts' : 'rejects'} it`,
      );
    }
  }
});

Deno.test('InlineQueryResultsButton runtime rejects a malformed HTTPS Web App URL', () => {
  // The schema's pattern matches only the scheme; `format: uri`, which `readWebAppUrlSchema`
  // requires, is what rejects this URL for schema consumers that assert formats.
  readWebAppUrlSchema();
  if (runtimeAcceptsWebAppUrl('https://bad space')) {
    throw new Error('Expected the runtime to reject a URL with a space in its host');
  }
});
