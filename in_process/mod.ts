/**
 * The in-process emulator: the emulator and its TypeScript client in the test's own process, for
 * tests that run the bot under test in that process too.
 */
export {
  createInProcessEmulator,
  type InProcessEmulator,
  type InProcessEmulatorOptions,
} from './in_process_emulator.ts';
