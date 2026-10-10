import { parse as parseYaml } from '@std/yaml';

import { CONTROL_REFUSAL_REASONS } from './control_refusal_reasons.ts';

Deno.test('The client knows exactly the refusal reasons the OpenAPI document lists', async () => {
  const documentedReasons = new Set<string>(['route_not_found']);
  for await (const entry of Deno.readDir('openapi/paths')) {
    if (entry.isFile && !entry.name.includes('bot-api')) {
      const pathItem = parseYaml(await Deno.readTextFile(`openapi/paths/${entry.name}`));
      collectReasonEnums(pathItem, documentedReasons);
    }
  }
  const clientReasons = new Set<string>(CONTROL_REFUSAL_REASONS);

  const missing = [...documentedReasons].filter((reason) => !clientReasons.has(reason));
  const undocumented = [...clientReasons].filter((reason) => !documentedReasons.has(reason));
  if (missing.length > 0 || undocumented.length > 0) {
    throw new Error(
      `Expected CONTROL_REFUSAL_REASONS to list the documented reasons: missing ${
        JSON.stringify(missing)
      }, undocumented ${JSON.stringify(undocumented)}`,
    );
  }
});

/** Adds every `enum` of a `reason` property within `value` to `reasons`. */
function collectReasonEnums(value: unknown, reasons: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectReasonEnums(item, reasons);
    return;
  }
  if (typeof value !== 'object' || value === null) {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === 'reason' && typeof child === 'object' && child !== null && 'enum' in child) {
      const { enum: values } = child;
      if (!Array.isArray(values)) {
        throw new TypeError(`Expected a reason enum to be a list, received ${values}`);
      }
      for (const reason of values) {
        if (typeof reason !== 'string') {
          throw new TypeError(`Expected a reason to be text, received ${JSON.stringify(reason)}`);
        }
        reasons.add(reason);
      }
    }
    collectReasonEnums(child, reasons);
  }
}
