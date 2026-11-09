// Crown Browser — Production Unit Test Runner
// Runs on `npm run build` and displays exact pass/fail rates across all features and settings.
import './setup.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const unitDir = path.join(__dirname, 'unit');

export class TestRegistry {
  constructor() {
    this.categories = new Map(); // categoryName -> { total: 0, passed: 0, failed: 0, errors: [] }
    this.currentCategory = 'General';
  }

  suite(categoryName, fn) {
    this.currentCategory = categoryName;
    if (!this.categories.has(categoryName)) {
      this.categories.set(categoryName, { total: 0, passed: 0, failed: 0, tests: [] });
    }
    fn();
  }

  test(testName, fn) {
    const cat = this.categories.get(this.currentCategory) || { total: 0, passed: 0, failed: 0, tests: [] };
    cat.total++;
    try {
      fn();
      cat.passed++;
      cat.tests.push({ name: testName, status: 'PASS' });
    } catch (err) {
      cat.failed++;
      cat.tests.push({ name: testName, status: 'FAIL', error: err });
    }
  }

  async testAsync(testName, fn) {
    const cat = this.categories.get(this.currentCategory) || { total: 0, passed: 0, failed: 0, tests: [] };
    cat.total++;
    try {
      await fn();
      cat.passed++;
      cat.tests.push({ name: testName, status: 'PASS' });
    } catch (err) {
      cat.failed++;
      cat.tests.push({ name: testName, status: 'FAIL', error: err });
    }
  }
}

export const registry = new TestRegistry();
export const suite = (name, fn) => registry.suite(name, fn);
export const test = (name, fn) => registry.test(name, fn);
export const testAsync = (name, fn) => registry.testAsync(name, fn);

export function assert(condition, message = 'Assertion failed') {
  if (!condition) {
    throw new Error(message);
  }
}

export function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message || 'Values not equal'} — Expected: ${JSON.stringify(expected)}, Actual: ${JSON.stringify(actual)}`);
  }
}

export function assertDeepEqual(actual, expected, message) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${message || 'Deep equality failed'} — Expected: ${expectedJson}, Actual: ${actualJson}`);
  }
}

export function assertTrue(actual, message) {
  assertEqual(Boolean(actual), true, message || 'Expected true');
}

export function assertFalse(actual, message) {
  assertEqual(Boolean(actual), false, message || 'Expected false');
}

// ANSI formatting helpers
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';

async function run() {
  console.log(`\n${BOLD}${CYAN}========================================================================${RESET}`);
  console.log(`${BOLD}${CYAN}   CROWN BROWSER — PRODUCTION FEATURE & SETTINGS UNIT TEST SUITE${RESET}`);
  console.log(`${BOLD}${CYAN}========================================================================${RESET}\n`);

  const startTime = Date.now();
  const testFiles = fs.readdirSync(unitDir).filter(f => f.endsWith('.test.js')).sort();

  for (const file of testFiles) {
    const fullPath = path.join(unitDir, file);
    await import(`file://${fullPath}`);
  }

  let grandTotal = 0;
  let grandPassed = 0;
  let grandFailed = 0;

  console.log(`${BOLD}${'Feature / Setting Category'.padEnd(42)} ${'Total'.padStart(8)} ${'Passed'.padStart(8)} ${'Failed'.padStart(8)} ${'Pass Rate'.padStart(12)}${RESET}`);
  console.log(`${DIM}${''.padEnd(80, '-')}${RESET}`);

  const failures = [];

  for (const [category, data] of registry.categories.entries()) {
    grandTotal += data.total;
    grandPassed += data.passed;
    grandFailed += data.failed;

    const rate = data.total > 0 ? ((data.passed / data.total) * 100).toFixed(1) : '100.0';
    const rateColor = data.failed === 0 ? GREEN : RED;
    const catName = category.length > 40 ? category.slice(0, 37) + '...' : category;

    console.log(
      `${catName.padEnd(42)} ${String(data.total).padStart(8)} ${GREEN}${String(data.passed).padStart(8)}${RESET} ${data.failed > 0 ? RED : DIM}${String(data.failed).padStart(8)}${RESET} ${rateColor}${BOLD}${rate.padStart(10)}%${RESET}`
    );

    data.tests.forEach(t => {
      if (t.status === 'FAIL') {
        failures.push({ category, name: t.name, error: t.error });
      }
    });
  }

  const overallRate = grandTotal > 0 ? ((grandPassed / grandTotal) * 100).toFixed(1) : '100.0';
  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log(`${DIM}${''.padEnd(80, '=')}${RESET}`);
  console.log(
    `${BOLD}${'OVERALL PRODUCTION SUITE TOTALS'.padEnd(42)} ${String(grandTotal).padStart(8)} ${GREEN}${String(grandPassed).padStart(8)}${RESET} ${grandFailed > 0 ? RED : DIM}${String(grandFailed).padStart(8)}${RESET} ${grandFailed === 0 ? GREEN : RED}${BOLD}${overallRate.padStart(10)}%${RESET}`
  );
  console.log(`\n${DIM}Executed ${grandTotal} unit tests across ${registry.categories.size} feature domains in ${elapsedSec}s.${RESET}\n`);

  if (failures.length > 0) {
    console.error(`${BOLD}${RED}FAILED TESTS DETECTED (${failures.length}):${RESET}`);
    failures.forEach((f, idx) => {
      console.error(`  ${idx + 1}. [${f.category}] ${f.name}`);
      console.error(`     ${RED}${f.error?.stack || f.error?.message || f.error}${RESET}`);
    });
    console.error(`\n${BOLD}${RED}Production Build Aborted: 100% pass rate is mandatory.${RESET}\n`);
    process.exit(1);
  } else {
    console.log(`${BOLD}${GREEN}✔ 100% PASS RATE ACHIEVED — ALL CROWN FEATURES & SETTINGS VERIFIED PRODUCTION READY.${RESET}\n`);
    process.exit(0);
  }
}

// Run if main entry
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch(err => {
    console.error('Fatal Test Runner Error:', err);
    process.exit(1);
  });
}

