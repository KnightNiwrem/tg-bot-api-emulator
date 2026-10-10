/**
 * Appends checked exchanges to the file a coverage run names, so that one report can cover every
 * test module: each module runs in its own isolate and cannot share memory with the others.
 *
 * An ordinary test run grants no access to the variable, so nothing is written.
 */
import type { ExchangeRecord } from './exchange_record.ts';

/** Names the JSON Lines file a coverage run collects exchange records in. */
const EXCHANGE_RECORD_FILE_VARIABLE = 'OPENAPI_CONFORMANCE_RECORD_FILE';

let recordFilePath: string | undefined | null = null;

/** Appends `record` to the coverage run's record file, when this run is one. */
export function appendExchangeRecord(record: ExchangeRecord): void {
  const path = configuredRecordFilePath();
  if (path === undefined) return;
  Deno.writeTextFileSync(path, `${JSON.stringify(record)}\n`, { append: true });
}

function configuredRecordFilePath(): string | undefined {
  if (recordFilePath === null) {
    const permission = Deno.permissions.querySync({
      name: 'env',
      variable: EXCHANGE_RECORD_FILE_VARIABLE,
    });
    recordFilePath = permission.state === 'granted'
      ? Deno.env.get(EXCHANGE_RECORD_FILE_VARIABLE)
      : undefined;
  }
  return recordFilePath;
}
