// npm run sim: the offline demo. This tiny entry silences Node's ExperimentalWarning for node:sqlite (CLI only)
// before the app (which loads node:sqlite) is imported.

process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (w.name === 'ExperimentalWarning' && /SQLite/i.test(w.message)) return;
  process.stderr.write(`${w.name}: ${w.message}\n`);
});

await import('./sim-app.js');
