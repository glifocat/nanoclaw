import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { verifyFileSha256 } from './matrix-crypto-integrity.js';

const temporaryPaths: string[] = [];

afterEach(() => {
  for (const filename of temporaryPaths.splice(0)) fs.rmSync(filename, { force: true });
});

describe('Matrix native crypto integrity', () => {
  it('accepts an exact digest and fails closed after tampering', () => {
    const filename = path.join(os.tmpdir(), `matrix-crypto-integrity-${process.pid}-${Date.now()}`);
    temporaryPaths.push(filename);
    fs.writeFileSync(filename, 'reviewed binary');
    const expected = 'ead9809cc701ba4abc21771fe02645341e7941781e4cff1a7047f2e782bd9ab9';
    expect(verifyFileSha256(filename, expected)).toBe(expected);
    fs.appendFileSync(filename, 'tampered');
    expect(() => verifyFileSha256(filename, expected)).toThrow(/Checksum mismatch/);
  });
});
