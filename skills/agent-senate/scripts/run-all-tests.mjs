/**
 * In-process test runner for all agent-senate test suites.
 * Executes all tests cleanly in a single process without subprocess spawn issues.
 */

import './analyze.test.mjs';
import './validate.test.mjs';
import './ledger.test.mjs';
import './report.test.mjs';
import './audit.test.mjs';
import './statistical-calibration.test.mjs';
