// Side panel (desktop) / ⚙️ sheet (phones): play the scripted demo, fast-forward, reset, the fake clock,
// Homi's private messages, and "try saying" suggestions.

import { esc, inline, nameOf, timeOf } from './format.js';

const $ = (id) => document.getElementById(id);

export function initControls({ api, report, toast, fill }) {
  const self = { onAction: () => undefined };
  let playing = false;
  let zone = 'America/New_York';

  const busy = async (btn, fn) => {
    btn.disabled = true;
    try {
      await fn();
    } catch (err) {
      report(err);
    } finally {
      btn.disabled = false;
    }
  };

  $('playBtn').onclick = (ev) =>
    busy(ev.currentTarget, async () => {
      if (playing) {
        await api('/api/script/stop');
        toast('Demo stopped. The chat stays; keep playing by hand.');
        return;
      }
      self.onAction();
      const r = await api('/api/script/play');
      toast(`Playing the full demo (${r.total} lines) from Sat Oct 17, 10:00 AM`);
    });

  for (const b of document.querySelectorAll('[data-ff]')) {
    b.onclick = (ev) =>
      busy(ev.currentTarget, async () => {
        const v = b.dataset.ff;
        const r = await api('/api/ff', v === 'next' ? { nextDay: true } : { duration: v });
        if (r.paused) toast('Clock paused: Homi is calling. Answer the call to continue.');
      });
  }

  $('resetBtn').onclick = (ev) =>
    busy(ev.currentTarget, async () => {
      if (!confirm('Start a fresh "the crew" chat? Everyone connected sees the reset.')) return;
      const start = new URLSearchParams(location.search).get('start') || undefined;
      await api('/api/reset', start ? { start } : {});
      self.onAction();
      toast('Fresh chat. Try "@homi dinner next week?"');
    });

  document.querySelector('.try').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-say]');
    if (!b) return;
    fill(b.dataset.say);
    self.onAction();
  });

  self.setClock = (now, tz) => {
    zone = tz;
    $('clockBig').textContent = `${new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(new Date(now))} ${timeOf(now, tz)}`;
    $('clockSub').textContent = `${new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(now))} · ${tz}`;
  };

  self.setScript = (s) => {
    playing = !!s.playing;
    const btn = $('playBtn');
    btn.classList.toggle('stop', playing);
    btn.innerHTML = playing ? '<span class="ic">■</span> Stop the demo' : '<span class="ic">▶</span> Play the full demo';
    const pct = s.total ? Math.round((s.index / s.total) * 100) : 0;
    $('progBar').style.width = `${playing || s.done ? pct : 0}%`;
    $('playHint').textContent = playing
      ? `Line ${s.index} of ${s.total} · you can still type, react and fast-forward`
      : s.done
        ? `Finished all ${s.total} lines${s.errors ? ` (${s.errors} skipped)` : ''}. Keep playing, or reset.`
        : 'Resets the chat and replays the story (docs/DEMO.md) from Sat Oct 17, 10:00 AM. About 90 seconds.';
    document.body.classList.toggle('playing', playing);
  };

  self.reset = (snap) => {
    $('dmList').innerHTML = '<p class="empty">Homi\'s private messages to one member show up here (DMs are never shown in the group).</p>';
    self.setScript(snap.script);
    self.setClock(snap.now, snap.tz);
    updateDmBadge(0);
  };

  let dms = 0;
  const updateDmBadge = (n) => {
    dms = n;
    $('gearBtn').dataset.badge = n ? String(n) : '';
  };
  self.addDm = (e) => {
    const list = $('dmList');
    list.querySelector('.empty')?.remove();
    list.insertAdjacentHTML(
      'afterbegin',
      `<div class="dm"><div class="dm-h">🔒 Homi → <b>${esc(nameOf(e.to))}</b><span>${esc(timeOf(e.at, zone))}</span></div><div class="dm-t">${inline(e.text)}</div></div>`,
    );
    updateDmBadge(dms + 1);
  };

  return self;
}
