// npm run telegram:check: verify the @BotFather token for SURFACES=telegram-direct with harmless reads
// (getMe, getWebhookInfo). Prints the bot username and flags only: never the token or the webhook URL.

import { existsSync } from 'node:fs';
import { telegramDirectToken } from '../config.js';
import { TelegramApiError, checkTelegramBot, telegramApi } from '../channels/telegram-direct.js';

const yesNo = (v: boolean | undefined) => (v === undefined ? 'unknown' : v ? 'yes' : 'no');

async function main(): Promise<number> {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const token = telegramDirectToken(process.env);
  if (!token) {
    process.stderr.write('telegram:check: set TELEGRAM_BOT_TOKEN in .env (the @BotFather token; see docs/CHANNELS.md "Direct Telegram").\n');
    return 2;
  }
  try {
    const r = await checkTelegramBot(telegramApi(token));
    const out = (s: string) => process.stdout.write(`${s}\n`);
    out('telegram:check OK (token accepted)');
    out(`  bot username: ${r.username ? `@${r.username}` : 'unknown'}`);
    out(`  can_join_groups: ${yesNo(r.canJoinGroups)}`);
    out(`  can_read_all_group_messages: ${yesNo(r.canReadAllGroupMessages)}${r.canReadAllGroupMessages === false ? '  (privacy mode ON: @BotFather /setprivacy -> Disable, then remove and re-add the bot; or make it a group admin)' : r.canReadAllGroupMessages ? '  (privacy mode off)' : ''}`);
    out(`  webhook set: ${yesNo(r.webhookSet)}${r.webhookSet ? '  (telegram-direct removes it at start so long polling works)' : ''}`);
    if (r.pendingUpdates !== undefined) out(`  pending updates: ${r.pendingUpdates}`);
    if (r.canJoinGroups === false) out('  note: @BotFather /setjoingroups -> Enable, or the bot cannot be added to groups');
    const user = process.env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, '');
    if (user && r.username && user.toLowerCase() !== r.username.toLowerCase()) out('  note: TELEGRAM_BOT_USERNAME does not match this token\'s bot (Homi uses the token\'s username)');
    return 0;
  } catch (err) {
    const status = err instanceof TelegramApiError ? `${err.status ?? 'no response'} ${err.reason}` : 'unexpected error';
    process.stderr.write(`telegram:check FAILED (${status})\n`);
    process.stderr.write('  401: wrong or revoked token (@BotFather /token). No response: network or proxy problem.\n');
    return 1;
  }
}

main().then((code) => process.exit(code));
