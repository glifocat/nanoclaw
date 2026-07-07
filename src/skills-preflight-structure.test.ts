// Regression test for #2868 — per-channel `/add-*` skills must gate each
// section on its own state instead of a top-level "skip everything" directive.
// /update-skills replaces the install/code sections wholesale from upstream,
// so a wholesale Pre-flight skip causes Credentials to be skipped too once
// any install marker exists. Each section now self-gates.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SKILLS_ROOT = join(__dirname, '..', '.claude', 'skills');

type GateSection = 'Credentials' | 'Configuration' | 'Enable';

interface SkillCase {
  name: string;
  gateSection: GateSection;
  gateVars: string[];
}

const CASES: SkillCase[] = [
  {
    name: 'add-discord',
    gateSection: 'Credentials',
    gateVars: ['DISCORD_BOT_TOKEN', 'DISCORD_APPLICATION_ID', 'DISCORD_PUBLIC_KEY'],
  },
  { name: 'add-slack', gateSection: 'Credentials', gateVars: ['SLACK_BOT_TOKEN', 'SLACK_SIGNING_SECRET'] },
  { name: 'add-telegram', gateSection: 'Credentials', gateVars: ['TELEGRAM_BOT_TOKEN'] },
  { name: 'add-teams', gateSection: 'Credentials', gateVars: ['TEAMS_APP_ID', 'TEAMS_APP_PASSWORD'] },
  { name: 'add-whatsapp', gateSection: 'Credentials', gateVars: ['store/auth/creds.json'] },
  { name: 'add-opencode', gateSection: 'Configuration', gateVars: ['OPENCODE_PROVIDER', 'OPENCODE_MODEL'] },
  { name: 'add-deltachat', gateSection: 'Credentials', gateVars: ['DC_EMAIL', 'DC_PASSWORD'] },
  { name: 'add-emacs', gateSection: 'Enable', gateVars: ['EMACS_ENABLED'] },
  { name: 'add-gchat', gateSection: 'Credentials', gateVars: ['GCHAT_CREDENTIALS'] },
  {
    name: 'add-github',
    gateSection: 'Credentials',
    gateVars: ['GITHUB_TOKEN', 'GITHUB_WEBHOOK_SECRET', 'GITHUB_BOT_USERNAME'],
  },
  { name: 'add-imessage', gateSection: 'Credentials', gateVars: ['IMESSAGE_LOCAL'] },
  { name: 'add-linear', gateSection: 'Credentials', gateVars: ['LINEAR_WEBHOOK_SECRET', 'LINEAR_TEAM_KEY'] },
  { name: 'add-matrix', gateSection: 'Credentials', gateVars: ['MATRIX_BASE_URL', 'MATRIX_USER_ID'] },
  { name: 'add-resend', gateSection: 'Credentials', gateVars: ['RESEND_API_KEY', 'RESEND_WEBHOOK_SECRET'] },
  { name: 'add-signal', gateSection: 'Credentials', gateVars: ['SIGNAL_ACCOUNT'] },
  { name: 'add-webex', gateSection: 'Credentials', gateVars: ['WEBEX_BOT_TOKEN', 'WEBEX_WEBHOOK_SECRET'] },
  { name: 'add-wechat', gateSection: 'Credentials', gateVars: ['WECHAT_ENABLED'] },
  {
    name: 'add-whatsapp-cloud',
    gateSection: 'Credentials',
    gateVars: ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_APP_SECRET', 'WHATSAPP_VERIFY_TOKEN'],
  },
];

function readSkill(name: string): string {
  return readFileSync(join(SKILLS_ROOT, name, 'SKILL.md'), 'utf8');
}

function preflightBlock(body: string): string {
  const start = body.search(/^###\s+Pre-flight\b/m);
  if (start === -1) return '';
  const rest = body.slice(start);
  const next = rest.slice(1).search(/^###\s/m);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

function sectionGateText(body: string, section: GateSection): string {
  // Header band: from `## <section>` up to either the next `## ` or 1500
  // chars, whichever comes first. WhatsApp's gate lives in an opening
  // `### Check current state` subsection rather than the lead paragraph;
  // a header-band window covers both shapes without being permissive
  // enough to match gate-like prose later in the section.
  const re = new RegExp(String.raw`^##\s+${section}\b`, 'm');
  const start = body.search(re);
  if (start === -1) return '';
  const after = body.slice(start);
  const nextTopLevel = after.slice(1).search(/^##\s/m);
  const sectionText = nextTopLevel === -1 ? after : after.slice(0, nextTopLevel + 1);
  return sectionText.slice(0, 1500);
}

describe('add-* skills: per-section gates (#2868)', () => {
  for (const { name, gateSection, gateVars } of CASES) {
    describe(name, () => {
      const body = readSkill(name);

      it('Pre-flight block does not wholesale-skip later sections', () => {
        const block = preflightBlock(body);
        expect(block).not.toBe('');
        // No "Skip to <Section>" / "skip to <Section>" directive that jumps past install + creds.
        expect(block).not.toMatch(
          /skip to \*\*(Credentials|Configuration|Channel Info|Next Steps|Operational notes)\*\*/i,
        );
        expect(block).not.toMatch(/^If all of the following are already present, skip to/m);
      });

      it(`${gateSection} section opens with a self-gate`, () => {
        const gate = sectionGateText(body, gateSection);
        expect(gate).not.toBe('');
        // Gate phrasing must reference "skip" semantics so a reader knows the
        // section is conditional, and must mention each gate variable.
        expect(gate).toMatch(/skip to/i);
        for (const v of gateVars) {
          expect(gate).toContain(v);
        }
      });
    });
  }
});
