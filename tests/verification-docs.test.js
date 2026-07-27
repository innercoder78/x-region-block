import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const runbookSections = [
  'Automated verification', 'Installation and startup', 'X surfaces and dynamic behavior',
  'Location outcomes', 'Filtering and precedence', 'Settings and migration',
  'Privacy and lifecycle', 'Completion rules',
];
const reportSections = [
  'Test identity', 'Automated command results', 'Per-surface results',
  'Location-outcome results', 'Filter-precedence results', 'Settings/migration results',
  'Privacy/lifecycle results', 'Sanitized defects found', 'Explicit unresolved risks',
  'Final status',
];

export function validateVerificationDocuments(runbook, report) {
  for (const section of runbookSections) {
    if (!runbook.includes(`## ${section}`)) throw new Error(`runbook missing section: ${section}`);
  }
  for (const section of reportSections) {
    if (!report.includes(`## ${section}`)) throw new Error(`report missing section: ${section}`);
  }
  const finalStatus = report.match(/## Final status\s+\*\*(.+?)\*\*/)?.[1];
  if (finalStatus !== 'Not run') throw new Error('verification report must default to Not run');
}

describe('verification documentation contract', () => {
  it('keeps the committed runbook and report complete and unclaimed', async () => {
    const [runbook, report] = await Promise.all([
      readFile('docs/live-browser-verification.md', 'utf8'),
      readFile('docs/verification-report-template.md', 'utf8'),
    ]);
    expect(() => validateVerificationDocuments(runbook, report)).not.toThrow();
  });

  it('rejects a missing runbook section', () => {
    const runbook = runbookSections.slice(1).map((section) => `## ${section}`).join('\n');
    const report = `${reportSections.map((section) => `## ${section}`).join('\n')}\n**Not run**`;
    expect(() => validateVerificationDocuments(runbook, report)).toThrow(/missing section/);
  });

  it('rejects a report which defaults to a passing state', () => {
    const runbook = runbookSections.map((section) => `## ${section}`).join('\n');
    const report = `${reportSections.map((section) => `## ${section}`).join('\n')}\n**Passed with limitations**`;
    expect(() => validateVerificationDocuments(runbook, report)).toThrow(/default to Not run/);
  });
});
