// npm run photon2:telegram [-- --fresh] [-- --wait]: start Photon 2.0's free managed Telegram bot connection and print
// what the human does next (setup link, status, bot details). No BotFather token is needed: the request body is empty.
// --fresh: new Idempotency-Key (after a failed/cancelled setup). --wait: poll the operation until it ends (10 min max).

import { existsSync } from 'node:fs';
import { parsePhoton2 } from '../config.js';
import { loadPhoton2Api } from '../channels/photon2.js';
import { connectTelegram, describeApiError, telegramConnectKey, telegramNextSteps, waitForTelegram } from '../channels/photon2-setup.js';

async function main(): Promise<number> {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const args = new Set(process.argv.slice(2));
  const cfg = parsePhoton2(process.env, ['photon2'], (m) => process.stderr.write(`[photon2] ${m}\n`));
  if (!cfg.apiKey || !cfg.projectId) {
    process.stderr.write('photon2:telegram: set PHOTON2_API_KEY and PHOTON2_PROJECT_ID in .env first (then run photon2:check).\n');
    return 2;
  }
  const api = await loadPhoton2Api(cfg.apiKey);
  try {
    const r = await connectTelegram(api, cfg.projectId, telegramConnectKey(cfg.projectId, args.has('--fresh')));
    process.stdout.write(telegramNextSteps(r).join('\n') + '\n');
    if (args.has('--wait') && r.operationId && r.state !== 'succeeded' && r.state !== 'failed' && r.state !== 'cancelled') {
      process.stdout.write('Waiting for the setup to finish (Ctrl+C to stop)...\n');
      const done = await waitForTelegram(api, cfg.projectId, r.operationId, { onState: (s) => process.stdout.write(`  state: ${s}\n`) });
      process.stdout.write(telegramNextSteps(done).join('\n') + '\n');
    }
    return 0;
  } catch (err) {
    process.stderr.write(`photon2:telegram FAILED: ${describeApiError(err)}\n`);
    process.stderr.write('  403: the key needs platforms:write. 422 IDEMPOTENCY_KEY_REUSED: re-run with -- --fresh.\n');
    return 1;
  }
}

main().then((code) => process.exit(code));
