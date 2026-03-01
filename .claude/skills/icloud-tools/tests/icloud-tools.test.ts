import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';

const SKILL_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

describe('icloud-tools skill package', () => {
  describe('SKILL.md', () => {
    let content: string;

    beforeAll(() => {
      content = fs.readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf-8');
    });

    it('exists', () => {
      expect(fs.existsSync(path.join(SKILL_DIR, 'SKILL.md'))).toBe(true);
    });

    it('has correct frontmatter', () => {
      expect(content).toContain('name: icloud-tools');
      expect(content).toContain('description: iCloud productivity tools');
    });

    it('documents all five modules', () => {
      expect(content).toContain('`reminders`');
      expect(content).toContain('`calendar`');
      expect(content).toContain('`contacts`');
      expect(content).toContain('`mail`');
      expect(content).toContain('`notes`');
    });

    it('documents environment variables', () => {
      expect(content).toContain('ICLOUD_EMAIL');
      expect(content).toContain('ICLOUD_APP_PASSWORD');
      expect(content).toContain('ICLOUD_MODULES');
    });

    it('documents MCP server configuration', () => {
      expect(content).toContain('/opt/icloud-tools/dist/server.js');
      expect(content).toContain('.mcp.json');
    });
  });

  describe('manifest.yaml', () => {
    let content: string;

    beforeAll(() => {
      content = fs.readFileSync(path.join(SKILL_DIR, 'manifest.yaml'), 'utf-8');
    });

    it('has a valid manifest.yaml', () => {
      expect(fs.existsSync(path.join(SKILL_DIR, 'manifest.yaml'))).toBe(true);
      expect(content).toContain('skill: icloud-tools');
      expect(content).toContain('version: 1.0.0');
    });

    it('has correct description', () => {
      expect(content).toContain('iCloud productivity tools via CalDAV/CardDAV/IMAP/SMTP');
    });

    it('declares env_additions', () => {
      expect(content).toContain('ICLOUD_EMAIL');
      expect(content).toContain('ICLOUD_APP_PASSWORD');
    });

    it('conflicts with apple-reminders', () => {
      expect(content).toContain('apple-reminders');
    });

    it('has a test command', () => {
      expect(content).toContain('test: "npx vitest run --config vitest.skills.config.ts .claude/skills/icloud-tools/tests/icloud-tools.test.ts"');
    });

    it('has no dependencies', () => {
      expect(content).toContain('depends: []');
    });

    it('lists all added files', () => {
      expect(content).toContain('container/icloud-tools/package.json');
      expect(content).toContain('container/icloud-tools/tsconfig.json');
      expect(content).toContain('container/icloud-tools/src/server.ts');
      expect(content).toContain('container/icloud-tools/src/auth.ts');
      expect(content).toContain('container/icloud-tools/src/types.ts');
      expect(content).toContain('container/icloud-tools/src/modules/reminders.ts');
      expect(content).toContain('container/icloud-tools/src/modules/calendar.ts');
      expect(content).toContain('container/icloud-tools/src/modules/contacts.ts');
      expect(content).toContain('container/icloud-tools/src/modules/mail.ts');
      expect(content).toContain('container/icloud-tools/src/modules/notes.ts');
    });

    it('lists all modified files', () => {
      expect(content).toContain('container/Dockerfile');
      expect(content).toContain('src/container-runner.ts');
      expect(content).toContain('container/agent-runner/src/index.ts');
      expect(content).toContain('src/ipc.ts');
      expect(content).toContain('container/agent-runner/src/ipc-mcp-stdio.ts');
    });

    it('lists all removed files', () => {
      expect(content).toContain('src/reminders.ts');
      expect(content).toContain('src/reminders-ipc.ts');
      expect(content).toContain('src/reminders.test.ts');
    });
  });

  describe('repo state: added files exist', () => {
    const addedFiles = [
      'container/icloud-tools/package.json',
      'container/icloud-tools/tsconfig.json',
      'container/icloud-tools/src/server.ts',
      'container/icloud-tools/src/auth.ts',
      'container/icloud-tools/src/types.ts',
      'container/icloud-tools/src/modules/reminders.ts',
      'container/icloud-tools/src/modules/calendar.ts',
      'container/icloud-tools/src/modules/contacts.ts',
      'container/icloud-tools/src/modules/mail.ts',
      'container/icloud-tools/src/modules/notes.ts',
    ];

    for (const file of addedFiles) {
      it(`${file} exists`, () => {
        expect(fs.existsSync(path.join(REPO_ROOT, file))).toBe(true);
      });
    }
  });

  describe('manifest declares correct removals', () => {
    let manifestContent: string;

    beforeAll(() => {
      manifestContent = fs.readFileSync(path.join(SKILL_DIR, 'manifest.yaml'), 'utf-8');
    });

    const removedFiles = [
      'src/reminders.ts',
      'src/reminders-ipc.ts',
      'src/reminders.test.ts',
    ];

    for (const file of removedFiles) {
      it(`manifest removes: lists ${file}`, () => {
        expect(manifestContent).toContain(file);
      });
    }
  });

  describe('add/ files', () => {
    const addFiles = [
      'container/icloud-tools/package.json',
      'container/icloud-tools/tsconfig.json',
      'container/icloud-tools/src/server.ts',
      'container/icloud-tools/src/auth.ts',
      'container/icloud-tools/src/types.ts',
      'container/icloud-tools/src/modules/reminders.ts',
      'container/icloud-tools/src/modules/calendar.ts',
      'container/icloud-tools/src/modules/contacts.ts',
      'container/icloud-tools/src/modules/mail.ts',
      'container/icloud-tools/src/modules/notes.ts',
    ];

    for (const file of addFiles) {
      it(`includes add/${file}`, () => {
        expect(fs.existsSync(path.join(SKILL_DIR, 'add', file))).toBe(true);
      });
    }
  });

  describe('modify/ files', () => {
    const modifyFiles = [
      'container/Dockerfile',
      'src/container-runner.ts',
      'container/agent-runner/src/index.ts',
      'src/ipc.ts',
      'container/agent-runner/src/ipc-mcp-stdio.ts',
    ];

    for (const file of modifyFiles) {
      it(`includes modify/${file}`, () => {
        expect(fs.existsSync(path.join(SKILL_DIR, 'modify', file))).toBe(true);
      });
    }
  });

  describe('intent files', () => {
    const intentFiles = [
      'container/Dockerfile.intent.md',
      'src/container-runner.ts.intent.md',
      'container/agent-runner/src/index.ts.intent.md',
      'src/ipc.ts.intent.md',
      'container/agent-runner/src/ipc-mcp-stdio.ts.intent.md',
    ];

    for (const file of intentFiles) {
      it(`includes modify/${file}`, () => {
        expect(fs.existsSync(path.join(SKILL_DIR, 'modify', file))).toBe(true);
      });
    }
  });

  describe('modify/ templates contain expected changes', () => {
    it('Dockerfile template contains icloud-tools build steps', () => {
      const content = fs.readFileSync(
        path.join(SKILL_DIR, 'modify', 'container', 'Dockerfile'),
        'utf-8',
      );
      expect(content).toContain('icloud-tools');
      expect(content).toContain('/opt/icloud-tools');
    });

    it('allowedTools template includes icloud-tools wildcard', () => {
      const content = fs.readFileSync(
        path.join(SKILL_DIR, 'modify', 'container', 'agent-runner', 'src', 'index.ts'),
        'utf-8',
      );
      expect(content).toContain("'mcp__icloud-tools__*'");
    });

    it('container-runner template includes ICLOUD_EMAIL', () => {
      const content = fs.readFileSync(
        path.join(SKILL_DIR, 'modify', 'src', 'container-runner.ts'),
        'utf-8',
      );
      expect(content).toContain("'ICLOUD_EMAIL'");
    });

    it('ipc.ts template does not import reminders-ipc', () => {
      const content = fs.readFileSync(
        path.join(SKILL_DIR, 'modify', 'src', 'ipc.ts'),
        'utf-8',
      );
      expect(content).not.toContain('reminders-ipc');
    });
  });
});
