// npm run photon2:check: verify PHOTON2_API_KEY / PHOTON2_PROJECT_ID with harmless reads.
// Prints OK plus counts only (spaces, per-platform spaces, platform types). Never prints the key or any ids.

import { existsSync } from 'node:fs';
import { parsePhoton2 } from '../config.js';
import { loadPhoton2Api } from '../channels/photon2.js';
import { checkPhoton2, describeApiError } from '../channels/photon2-setup.js';

async function main(): Promise<number> {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const cfg = parsePhoton2(process.env, ['photon2'], (m) => process.stderr.write(`[photon2] ${m}\n`));
  if (!cfg.apiKey || !cfg.projectId) {
    process.stderr.write('photon2:check: set PHOTON2_API_KEY and PHOTON2_PROJECT_ID in .env (see docs/CHANNELS.md).\n');
    return 2;
  }
  try {
    const r = await checkPhoton2(await loadPhoton2Api(cfg.apiKey), cfg.projectId, cfg.platforms);
    process.stdout.write('photon2:check OK (key accepted for this project)\n');
    process.stdout.write(`  spaces: ${r.spaces}\n`);
    for (const [p, n] of Object.entries(r.spacesByPlatform)) process.stdout.write(`  spaces on ${p}: ${n ?? 'n/a'}\n`);
    process.stdout.write(`  platform types available: ${r.platformTypes ?? 'n/a (key lacks platforms:read)'}\n`);
    return 0;
  } catch (err) {
    process.stderr.write(`photon2:check FAILED: ${describeApiError(err)}\n`);
    process.stderr.write('  401/403: wrong key, a key from another project, or missing permissions. 404: wrong PHOTON2_PROJECT_ID.\n');
    return 1;
  }
}

main().then((code) => process.exit(code));
