import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

export const MATRIX_CRYPTO_VERSION = '0.6.1';

// SHA-256 digests published in the GitHub release asset metadata for v0.6.1.
const EXPECTED_DIGESTS: Record<string, string> = {
  'matrix-sdk-crypto.darwin-arm64.node': 'cc534f379f9a7209faa6d62bee9a411f68249f9b3238b969de795e4f333e0401',
  'matrix-sdk-crypto.darwin-x64.node': 'cd53ed4d9e82903bcd8fd5622458dc382aaa2cddc97d7bb5bcc4cd997d9209d8',
  'matrix-sdk-crypto.linux-arm-gnueabihf.node': '0541a29066b21d0f0db0ef39a071e1e2b7a26be0f4629ec9c3d2c6024d4071a5',
  'matrix-sdk-crypto.linux-arm64-gnu.node': '0f998ffaae0603bb544c7187e383576a1cf4974becde348b6d5e81554d2ed290',
  'matrix-sdk-crypto.linux-ia32-gnu.node': '23252253f2e112f517e570d701a2a19e6fd4719af2d9731f9281178555edcb22',
  'matrix-sdk-crypto.linux-s390x-gnu.node': '54ed1a179b2304ec379840e0ef76ede5d71f402df2e0b1b81bbbb257d99ec26a',
  'matrix-sdk-crypto.linux-x64-gnu.node': 'cb0d2a86bd6721f82d988ae6b0c54cc3c5d364ff59a06f95934eb587dc35c9f4',
  'matrix-sdk-crypto.linux-x64-musl.node': 'eb32d323470395fcd694356828b603d51fddfa11cc73ee89af7be2ce990c87e0',
  'matrix-sdk-crypto.win32-arm64-msvc.node': '963c5f6f376ed436f530d7dd98b0745ac7e1fc600f6955e3dc9fac6de635fbb2',
  'matrix-sdk-crypto.win32-ia32-msvc.node': '5752f51d9b72c495176b9c5c88262149a8a98282f7d2d1b19533d3eb86a4371d',
  'matrix-sdk-crypto.win32-x64-msvc.node': '194f3223e6b68e689e1602ea623dafb27f6c5cc664904be209a498fcd3ea5138',
};

export function verifyFileSha256(filename: string, expected: string): string {
  const actual = createHash('sha256').update(readFileSync(filename)).digest('hex');
  if (actual !== expected) {
    throw new Error(`Checksum mismatch for ${path.basename(filename)}: expected ${expected}, got ${actual}`);
  }
  return actual;
}

export function verifyMatrixCryptoBinary(): { binary: string; version: string; digest: string } {
  const require = createRequire(import.meta.url);
  const sdkPackagePath = require.resolve('matrix-bot-sdk/package.json');
  const cryptoPackagePath = require.resolve('@matrix-org/matrix-sdk-crypto-nodejs/package.json', {
    paths: [path.dirname(sdkPackagePath)],
  });
  const cryptoDirectory = path.dirname(cryptoPackagePath);
  const packageJson = JSON.parse(readFileSync(cryptoPackagePath, 'utf8')) as { version?: string };

  if (packageJson.version !== MATRIX_CRYPTO_VERSION) {
    throw new Error(`Expected Matrix crypto ${MATRIX_CRYPTO_VERSION}, found ${packageJson.version ?? 'unknown'}`);
  }

  const binaries = readdirSync(cryptoDirectory).filter((name) => name.endsWith('.node'));
  if (binaries.length !== 1) {
    throw new Error(`Expected exactly one downloaded Matrix crypto binary, found ${binaries.length}`);
  }

  const binary = binaries[0]!;
  const expected = EXPECTED_DIGESTS[binary];
  if (!expected) throw new Error(`No reviewed digest is pinned for ${binary}`);
  const digest = verifyFileSha256(path.join(cryptoDirectory, binary), expected);
  return { binary, version: MATRIX_CRYPTO_VERSION, digest };
}
