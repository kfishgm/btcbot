#!/usr/bin/env node
/**
 * Detects which agent is currently running based on the working directory
 * Returns: architect|tester|implementer|main
 */

const cwd = process.cwd();

if (cwd.includes('btcbot-arch')) {
  console.log('architect');
} else if (cwd.includes('btcbot-test')) {
  console.log('tester');
} else if (cwd.includes('btcbot-impl')) {
  console.log('implementer');
} else {
  console.log('main');
}