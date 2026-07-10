#!/usr/bin/env tsx

import { verifyMatrixCryptoBinary } from '../src/channels/matrix-crypto-integrity.js';

const verified = verifyMatrixCryptoBinary();
console.log(`Verified ${verified.binary} (${verified.version}) sha256:${verified.digest}`);
