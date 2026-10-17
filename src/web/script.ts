// Plays demo/demo.sim.txt into a DemoSession, line by line, with human-ish gaps (1.2-2.5 s, scaled by speed).
// /ff and /answer lines run instantly; /react, /reply and /photo use the sim's syntax (src/cli/sim-app.ts).

import { readFileSync } from 'node:fs';
import { parseDuration } from '../runner/clock.js';
import type { DemoSession } from './session.js';

export type ScriptLine =
  | { kind: 'say'; persona: string; text: string; raw: string }
  | { kind: 'react'; persona: string; emoji: string; target: string; raw: string }
  | { kind: 'reply'; persona: string; target: string; text: string; raw: string }
  | { kind: 'photo'; persona: string; caption?: string; raw: string }
  | { kind: 'answer'; persona: string; text: string; raw: string }
  | { kind: 'ff'; ms: number; raw: string };

export interface ScriptStatus {
  playing: boolean;
  index: number;
  total: number;
  errors: number;
  done: boolean;
}

/** The canonical story starts Sat Oct 17, 2026, 10:00am America/New_York (docs/DEMO.md). */
export const DEMO_START = '2026-10-17T10:00:00-04:00';

export function parseScript(text: string, personas: readonly string[]): ScriptLine[] {
  const out: ScriptLine[] = [];
  for (const l of text.split(/\r?\n/)) {
    const raw = l.trim();
    if (!raw || raw.startsWith('#')) continue;
    if (raw.startsWith('/')) {
      const [cmd, ...rest] = raw.split(/\s+/);
      const p = (rest[0] ?? '').toLowerCase();
      switch (cmd.toLowerCase()) {
        case '/ff':
          out.push({ kind: 'ff', ms: parseDuration(rest.join('')), raw });
          break;
        case '/react':
          out.push({ kind: 'react', persona: p, emoji: rest[1] ?? '', target: rest[2] ?? 'last', raw });
          break;
        case '/reply':
          out.push({ kind: 'reply', persona: p, target: rest[1] ?? 'last', text: rest.slice(2).join(' '), raw });
          break;
        case '/photo':
          out.push({ kind: 'photo', persona: p, caption: rest.slice(1).join(' ') || undefined, raw });
          break;
        case '/answer':
          out.push({ kind: 'answer', persona: p, text: rest.slice(1).join(' '), raw });
          break;
        default:
          throw new Error(`script: unsupported command ${cmd}`);
      }
      continue;
    }
    const m = /^([A-Za-z]+):\s+([\s\S]+)$/.exec(raw);
    if (m && personas.includes(m[1].toLowerCase())) out.push({ kind: 'say', persona: m[1].toLowerCase(), text: m[2], raw });
    else out.push({ kind: 'say', persona: 'you', text: raw, raw });
  }
  return out;
}

export function loadScript(path: string, personas: readonly string[]): ScriptLine[] {
  return parseScript(readFileSync(path, 'utf8'), personas);
}

/** Gap before a chat line: 1.2 s plus reading time, capped at 2.5 s. */
export function gapFor(line: ScriptLine): number {
  if (line.kind === 'ff' || line.kind === 'answer') return 0;
  const len = line.kind === 'say' || line.kind === 'reply' ? line.text.length : 12;
  return Math.min(2500, 1200 + len * 18);
}

export class ScriptPlayer {
  readonly #session: DemoSession;
  readonly #lines: ScriptLine[];
  readonly #speed: number;
  readonly #onStatus: (s: ScriptStatus) => void;
  #stopped = false;
  #wake?: () => void;
  #status: ScriptStatus;
  done: Promise<ScriptStatus>;

  constructor(session: DemoSession, lines: ScriptLine[], opts: { speed?: number; onStatus?: (s: ScriptStatus) => void } = {}) {
    this.#session = session;
    this.#lines = lines;
    this.#speed = opts.speed && opts.speed > 0 ? opts.speed : 1;
    this.#onStatus = opts.onStatus ?? (() => undefined);
    this.#status = { playing: false, index: 0, total: lines.length, errors: 0, done: false };
    this.done = Promise.resolve(this.#status);
  }

  get status(): ScriptStatus {
    return { ...this.#status };
  }

  /** Starts playing; resolves `done` when the script ends or is stopped. */
  start(): void {
    this.#status.playing = true;
    this.#publish();
    this.done = this.#loop();
  }

  stop(): void {
    this.#stopped = true;
    this.#wake?.();
  }

  async #loop(): Promise<ScriptStatus> {
    for (let i = 0; i < this.#lines.length && !this.#stopped; i++) {
      const line = this.#lines[i];
      const gap = gapFor(line) / this.#speed;
      if (gap > 0) await this.#sleep(gap);
      if (this.#stopped) break;
      try {
        await this.#play(line);
        await this.#session.waitForCalls(); // a REAL call (WEB_REAL_CALLS) pauses the story until it's answered
      } catch {
        this.#status.errors++; // the line text is never logged
      }
      this.#status.index = i + 1;
      this.#publish();
    }
    await this.#session.idle();
    this.#status.playing = false;
    this.#status.done = !this.#stopped;
    this.#publish();
    return this.status;
  }

  async #play(l: ScriptLine): Promise<void> {
    const s = this.#session;
    switch (l.kind) {
      case 'say':
        await s.say(l.persona, l.text);
        return;
      case 'reply':
        await s.say(l.persona, l.text, l.target);
        return;
      case 'react':
        await s.react(l.persona, l.emoji, l.target);
        return;
      case 'photo':
        await s.photo(l.persona, l.caption);
        return;
      case 'answer':
        await s.answer(l.persona, l.text);
        return;
      case 'ff':
        await s.fastForward(l.ms);
        return;
    }
  }

  #sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const t = setTimeout(done, ms);
      function done() {
        clearTimeout(t);
        resolve();
      }
      this.#wake = done;
    });
  }

  #publish(): void {
    try {
      this.#onStatus(this.status);
    } catch {
      /* ignore */
    }
  }
}
