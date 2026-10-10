/**
 * Reports which documented operations and statuses a test run exercised, from the exchange records
 * that `deno task openapi:coverage` collects, and fails when any exchange departed from the
 * document.
 *
 * Usage: `deno run --allow-read=. tests/support/openapi_conformance/coverage_report.ts <records>`
 */
import {
  type ApiSurface,
  apiSurfaceOf,
  type ExchangeRecord,
  exchangeRecordSchema,
} from './exchange_record.ts';
import { type DocumentedOperation, readOpenApiDocument } from './openapi_document.ts';

/** What the run exercised of one documented operation. */
interface OperationCoverage {
  readonly operation: DocumentedOperation;
  /** How many exchanges answered with each documented status key. */
  readonly exchangesByStatusKey: Map<string, number>;
  readonly requestCountsByValidity: Map<string, number>;
  /**
   * How many requests the document allows were refused as malformed, with a 400: refusals that
   * rules beyond the schemas decide, or that show a schema allows too much.
   */
  refusedValidRequestCount: number;
  /** Requests the document does not allow that succeeded, with the reasons it gives. */
  readonly acceptedInvalidRequests: string[];
}

const SURFACE_TITLES: Readonly<Record<ApiSurface, string>> = {
  control: 'Control API',
  'bot-api': 'Bot API',
};

if (import.meta.main) {
  const [recordsPath] = Deno.args;
  if (recordsPath === undefined) {
    console.error('Usage: coverage_report.ts <exchange records file>');
    Deno.exit(2);
  }
  const coverage = collectRunCoverage(readExchangeRecords(recordsPath));
  console.log(formatCoverageReport(coverage));
  if (coverage.departures.length > 0) Deno.exit(1);
}

function readExchangeRecords(recordsPath: string): ExchangeRecord[] {
  return Deno.readTextFileSync(recordsPath)
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line, index) => {
      const parsed = exchangeRecordSchema.safeParse(parseJsonLine(line));
      if (!parsed.success) {
        throw new Error(`Line ${index + 1} of ${recordsPath} is not an exchange record`);
      }
      return parsed.data;
    });
}

function parseJsonLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

/** What a run exercised of the whole document. */
interface RunCoverage {
  readonly exchangeCount: number;
  readonly operationCoverages: readonly OperationCoverage[];
  /** How many requests to undocumented routes each allowance let through. */
  readonly allowedUndocumentedCountsByReason: ReadonlyMap<string, number>;
  readonly departures: readonly string[];
}

function collectRunCoverage(records: readonly ExchangeRecord[]): RunCoverage {
  const coverageByOperationId = new Map(
    readOpenApiDocument().operations.map((operation) => [
      operation.operationId,
      emptyCoverage(operation),
    ]),
  );
  const allowedUndocumentedCountsByReason = new Map<string, number>();
  const departures: string[] = [];
  for (const record of records) {
    const { request, route, status } = record;
    departures.push(
      ...record.violations.map((violation) =>
        `${request.method} ${request.path} ${status}: ${violation}`
      ),
    );
    if (route.kind === 'allowed-undocumented') {
      increment(allowedUndocumentedCountsByReason, route.allowanceReason);
      continue;
    }
    if (route.kind === 'undocumented') continue;
    const coverage = coverageByOperationId.get(route.operationId);
    if (coverage === undefined) {
      throw new Error(`The records name ${route.operationId}, which the document does not have`);
    }
    if (route.statusKey !== undefined) increment(coverage.exchangesByStatusKey, route.statusKey);
    const classification = route.requestClassification;
    increment(coverage.requestCountsByValidity, classification.validity);
    if (classification.validity === 'valid' && status === 400) {
      coverage.refusedValidRequestCount++;
    } else if (classification.validity === 'invalid' && status >= 200 && status < 300) {
      coverage.acceptedInvalidRequests.push(
        `${request.method} ${request.path}${request.query} ${status}: ${
          classification.reasons.join('; ')
        }`,
      );
    }
  }
  return {
    exchangeCount: records.length,
    operationCoverages: [...coverageByOperationId.values()],
    allowedUndocumentedCountsByReason,
    departures,
  };
}

/** Formats what a run exercised of the repository's OpenAPI document as plain text. */
function formatCoverageReport(coverage: RunCoverage): string {
  const lines = [
    'OpenAPI conformance coverage of openapi/openapi.yaml',
    '',
    `${coverage.exchangeCount} exchanges checked, ${coverage.departures.length} departures from ` +
    'the document.',
  ];
  for (const surface of ['control', 'bot-api'] as const) {
    lines.push('', ...formatSurfaceCoverage(surface, coverage.operationCoverages));
  }
  lines.push('', 'Requests to undocumented routes that tests send on purpose:');
  if (coverage.allowedUndocumentedCountsByReason.size === 0) lines.push('  none');
  for (const [reason, count] of coverage.allowedUndocumentedCountsByReason) {
    lines.push(`  ${count} × ${reason}`);
  }
  lines.push('', 'Departures from the document:');
  if (coverage.departures.length === 0) lines.push('  none');
  lines.push(...coverage.departures.map((departure) => `  ${departure}`));
  return lines.join('\n');
}

function emptyCoverage(operation: DocumentedOperation): OperationCoverage {
  return {
    operation,
    exchangesByStatusKey: new Map(),
    requestCountsByValidity: new Map(),
    refusedValidRequestCount: 0,
    acceptedInvalidRequests: [],
  };
}

function formatSurfaceCoverage(
  surface: ApiSurface,
  coverages: readonly OperationCoverage[],
): string[] {
  const surfaceCoverages = coverages.filter((coverage) =>
    apiSurfaceOf(coverage.operation.pathTemplate) === surface
  );
  const exercised = surfaceCoverages.filter((coverage) => coverage.exchangesByStatusKey.size > 0);
  const documentedStatusCount = sum(
    surfaceCoverages.map((coverage) => coverage.operation.responses.size),
  );
  const exercisedStatusCount = sum(
    surfaceCoverages.map((coverage) => coverage.exchangesByStatusKey.size),
  );
  const lines = [
    `${
      SURFACE_TITLES[surface]
    }: ${exercised.length} of ${surfaceCoverages.length} operations and ` +
    `${exercisedStatusCount} of ${documentedStatusCount} documented statuses exercised.`,
  ];
  for (const coverage of surfaceCoverages) {
    const { operation } = coverage;
    const unexercised = [...operation.responses.keys()].filter((statusKey) =>
      !coverage.exchangesByStatusKey.has(statusKey)
    );
    lines.push(
      `  ${operation.operationId} (${operation.method.toUpperCase()} ${operation.pathTemplate})`,
      `    exercised: ${formatCounts(coverage.exchangesByStatusKey)}`,
      `    not exercised: ${unexercised.length === 0 ? 'none' : unexercised.join(', ')}`,
    );
    if (surface === 'control' && coverage.requestCountsByValidity.size > 0) {
      lines.push(`    requests: ${formatCounts(coverage.requestCountsByValidity)}`);
    }
    if (coverage.refusedValidRequestCount > 0) {
      lines.push(
        `    requests the schemas allow, refused with 400: ${coverage.refusedValidRequestCount}`,
      );
    }
    for (const acceptedInvalidRequest of coverage.acceptedInvalidRequests) {
      lines.push(`    request the document does not allow, accepted: ${acceptedInvalidRequest}`);
    }
  }
  return lines;
}

function formatCounts(counts: ReadonlyMap<string, number>): string {
  if (counts.size === 0) return 'none';
  return [...counts].sort(([left], [right]) => left.localeCompare(right))
    .map(([key, count]) => `${key} ×${count}`).join(', ');
}

function increment<Key>(counts: Map<Key, number>, key: Key): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
