import { defineConfig } from 'vitest/config';
import { BaseSequencer, type TestSpecification } from 'vitest/node';

/**
 * Files share one database, so their order matters: the contract (parity) tests read the demo data as loaded,
 * so they run first; then the invariant tests, which change records; then security. Alphabetical by path does it.
 */
class ByPath extends BaseSequencer {
  async sort(files: TestSpecification[]) {
    return [...files].sort((a, b) => a.moduleId.localeCompare(b.moduleId));
  }
}

export default defineConfig({
  test: {
    // Point the app at the test database before any module reads the config.
    setupFiles: ['test/helpers/env.ts'],
    // Reset, migrate and load the demo data once per run.
    globalSetup: ['test/helpers/global-setup.ts'],
    // Files share one database; run them one after another.
    fileParallelism: false,
    sequence: { sequencer: ByPath },
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});