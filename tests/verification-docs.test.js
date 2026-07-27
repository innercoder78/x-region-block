import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const runbookRequirements = {
  'Automated verification': [/npm run verify:release/i],
  'Installation and startup': [
    /chrome:\s.*load\s+unpacked/is,
    /firefox:\s.*load temporary\s+add-on/is,
    /active but not\s+ready/i,
    /eligible `?AboutAccountQuery`?/i,
  ],
  'X surfaces and dynamic behavior': [
    /home timeline/i, /explore/i, /profile posts/i, /profile replies/i, /profile media/i,
    /status\/reply pages/i, /search results/i, /notifications/i,
    /dynamically loaded timeline/i, /pushState/i, /replaceState/i, /back and forward/i,
    /removal and replacement of account surfaces/i,
  ],
  'Location outcomes': [
    /known country/i, /known region enrichment/i, /hidden location/i, /missing location/i,
    /unavailable location/i, /unknown\/unrecognized location/i, /not\s+observed/i,
  ],
  'Filtering and precedence': [
    /country hide/i, /country\s+highlight/i, /region hide/i, /region highlight/i,
    /always-show/i, /account\s+allowlist/i, /show\/highlight\/hide precedence/i,
  ],
  'Settings and migration': [/persist after a browser restart/i, /propagate to active X pages/i,
    /schema migration/i, /storage inspection/i],
  'Privacy and lifecycle': [/stop clears metadata/i, /back-forward-cache/i,
    /wrappers are restored/i, /no duplicate wrappers/i],
};
const reportRequirements = {
  'Test identity': [/commit SHA tested/i, /browser name and exact version/i, /operating system/i,
    /extension build directory/i, /date tested/i, /release\/tag name/i, /downloaded filename/i,
    /SHA-256 verification result/i, /package origin/i],
  'Automated command results': [/npm run verify:release/i],
  'Per-surface results': [/home timeline/i, /notifications/i, /pushState/i],
  'Location-outcome results': [/known country/i, /unknown\/unrecognized location/i],
  'Filter-precedence results': [/country hide\/highlight/i, /always-show/i, /allowlist/i],
  'Settings/migration results': [/restart persistence/i, /active-page propagation/i, /migration/i,
    /storage privacy/i],
  'Privacy/lifecycle results': [/stop cleanup/i, /unload\/BFCache/i, /wrapper restoration/i],
  'Sanitized defects found': [/testing has not run/i],
  'Explicit unresolved risks': [/unverified/i],
  'Inferences and items not tested': [/inferences/i, /items not tested/i],
  'Final status': [/\*\*Not run\*\*/i,
    /Allowed values:\s*\*\*Not run\*\*,\s*\*\*Incomplete\*\*,\s*\*\*Passed with limitations\*\*,\s*or\s*\*\*Failed\*\*/i],
};

function sections(document) {
  const found = new Map();
  const matches = [...document.matchAll(/^## (.+)$/gm)];
  for (let index = 0; index < matches.length; index += 1) {
    const start = matches[index].index + matches[index][0].length;
    const end = matches[index + 1]?.index ?? document.length;
    found.set(matches[index][1], document.slice(start, end));
  }
  return found;
}

function requireContent(document, requirements, label) {
  const contentBySection = sections(document);
  for (const [section, markers] of Object.entries(requirements)) {
    const content = contentBySection.get(section);
    if (content === undefined) throw new Error(`${label} missing section: ${section}`);
    for (const marker of markers) {
      if (!marker.test(content)) throw new Error(`${label} section ${section} is incomplete`);
    }
  }
}

export function validateVerificationDocuments(runbook, report) {
  requireContent(runbook, runbookRequirements, 'runbook');
  requireContent(report, reportRequirements, 'report');
  const warnings = [/authorization headers/i, /CSRF tokens/i, /cookies/i,
    /complete request URLs/i, /private account information/i];
  for (const warning of warnings) {
    if (!warning.test(runbook)) throw new Error('runbook sanitization warning is incomplete');
  }
  const finalStatus = sections(report).get('Final status')
    ?.match(/^\s*\*\*(.+?)\*\*/)?.[1];
  if (finalStatus !== 'Not run') throw new Error('verification report must default to exactly Not run');
}

async function committedDocuments() {
  return Promise.all([
    readFile('docs/live-browser-verification.md', 'utf8'),
    readFile('docs/verification-report-template.md', 'utf8'),
  ]);
}

describe('verification documentation contract', () => {
  it('keeps the committed runbook and report complete and unclaimed', async () => {
    const [runbook, report] = await committedDocuments();
    expect(() => validateVerificationDocuments(runbook, report)).not.toThrow();
  });

  it('rejects missing runbook content even when its heading remains', async () => {
    const [runbook, report] = await committedDocuments();
    expect(() => validateVerificationDocuments(runbook.replace('Home timeline', 'First surface'), report))
      .toThrow(/runbook section.*incomplete/);
  });

  it('rejects missing report content even when its heading remains', async () => {
    const [runbook, report] = await committedDocuments();
    expect(() => validateVerificationDocuments(runbook, report.replace('Commit SHA tested', 'Revision')))
      .toThrow(/report section.*incomplete/);
  });

  it('rejects a missing required report section', async () => {
    const [runbook, report] = await committedDocuments();
    const withoutRisks = report.replace(/## Explicit unresolved risks[\s\S]*?(?=\n## )/, '');
    expect(() => validateVerificationDocuments(runbook, withoutRisks)).toThrow(/missing section/);
  });

  it('rejects a report which defaults to a passing state', async () => {
    const [runbook, report] = await committedDocuments();
    const passing = report.replace(/^\*\*Not run\*\*$/m, '**Passed with limitations**');
    expect(() => validateVerificationDocuments(runbook, passing)).toThrow(/default to exactly Not run/);
  });
});
