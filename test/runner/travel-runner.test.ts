// DEMO Act 5 through the real runner + engine + travel handler, and the egress check: what leaves for a
// travel provider is trip details only (no names, handles, phone numbers or member keys).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEvent, detectAddressed, newGroupState } from '../../src/engine/index.js';
import type { TravelQuery, TravelResult } from '../../src/engine/types.js';
import { CAPS } from '../../src/channels/types.js';
import { Sealer } from '../../src/privacy/crypto.js';
import { Ids } from '../../src/privacy/ids.js';
import { createLogger } from '../../src/privacy/logger.js';
import { FakeClock } from '../../src/runner/clock.js';
import { Runner } from '../../src/runner/runner.js';
import { createTravelHandler } from '../../src/runner/handlers/travel.js';
import { openDatabase } from '../../src/store/db.js';
import { Repo } from '../../src/store/repo.js';
import { TravelService } from '../../src/travel/service.js';
import { RecordingAdapter, SALT, textIn } from './helpers.js';

class SpyService extends TravelService {
  readonly queries: TravelQuery[] = [];
  override async search(q: TravelQuery, now: number): Promise<TravelResult> {
    this.queries.push(structuredClone(q));
    return super.search(q, now);
  }
}

function env() {
  const clock = new FakeClock(Date.UTC(2026, 9, 24, 14, 0));
  const logger = createLogger({ level: 'silent', sink: () => {} });
  const repo = new Repo(openDatabase(':memory:'), new Sealer(Buffer.alloc(32, 7)), { now: () => clock.now(), logger });
  const adapter = new RecordingAdapter(CAPS.sim);
  const spy = new SpyService();
  let n = 0;
  const runner = new Runner({
    engine: { applyEvent, newGroupState, detectAddressed },
    repo,
    ids: new Ids(SALT),
    clock,
    logger,
    config: { retentionHours: 24, quietHours: [23, 9], defaultTz: 'America/New_York' },
    adapters: [adapter],
    newId: () => `id-${++n}`,
    handlers: [createTravelHandler({ dataDir: '.', now: () => clock.now() }, spy)],
  });
  return { runner, adapter, spy, clock };
}

test('DEMO Act 5 end to end through the runner: cards in order, comfort saved', async () => {
  const { runner, adapter, spy, clock } = env();
  const say = async (who: string, text: string) => {
    await clock.advance(60_000);
    await runner.handleInbound(textIn('crew', `persona:${who}`, text));
  };
  await say('maya', 'my number is 617-555-0134 btw, text me');
  await say('ana', "homi let's plan Japan for 2030");
  await say('ana', 'boston, late march for cherry blossoms, 10 nights');
  await say('ben', '5 of us, ~$3,000 each all in');
  await say('maya', 'food, temples, one onsen night');
  await say('ben', 'comfortable please');
  const sends = adapter.sends();
  const at = (prefix: string) => sends.findIndex((s) => s.startsWith(prefix));
  const order = [
    at('Japan 2030, love it ✈️ Where are you flying from'),
    at('Japan · late Mar 2030 · 10 nights · 5 from Boston. Too far ahead to book'),
    at('Want it more comfortable? 4★ hotels plus one ryokan night with dinner runs ≈ $3,620 per person (+$950'),
    at('Less obvious savings:'),
    at('Comfort plan saved: ≈ $3,620 per person, all estimates.'),
  ];
  assert.ok(order.every((i) => i >= 0), JSON.stringify(sends, null, 1));
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'cards arrive in DEMO order');
  assert.ok(sends.join('\n').includes('Example listing · estimated price'));

  // Egress: two queries, trip details only.
  assert.equal(spy.queries.length, 2);
  const blob = JSON.stringify(spy.queries);
  assert.doesNotMatch(blob, /\b(?:ana|ben|maya|jo|sam|you)\b/i, 'no member names');
  assert.doesNotMatch(blob, /persona|617|555|0134|crew/i, 'no handles, numbers or chat ids');
  for (const q of spy.queries) {
    assert.deepEqual(Object.keys(q).sort(), ['budgetPerPersonUsd', 'destination', 'interests', 'month', 'nights', 'origin', 'tier', 'travelers', 'year']);
  }
});
