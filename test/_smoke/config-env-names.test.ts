import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../../src/config.js';

const base = { SURFACES: 'sim' } as NodeJS.ProcessEnv;

test('Photon project credentials load from the scaffolder names (PROJECT_ID / PROJECT_SECRET)', () => {
  const c = loadConfig({ env: { ...base, PROJECT_ID: 'p-cli', PROJECT_SECRET: 's-cli' }, loadDotEnv: false, warn: () => {} });
  assert.equal(c.spectrum.projectId, 'p-cli');
  assert.equal(c.spectrum.projectSecret, 's-cli');
});

test('SPECTRUM_PROJECT_* wins when both names are set', () => {
  const env = { ...base, PROJECT_ID: 'p-cli', PROJECT_SECRET: 's-cli', SPECTRUM_PROJECT_ID: 'p-x', SPECTRUM_PROJECT_SECRET: 's-x' };
  const c = loadConfig({ env, loadDotEnv: false, warn: () => {} });
  assert.equal(c.spectrum.projectId, 'p-x');
  assert.equal(c.spectrum.projectSecret, 's-x');
});
