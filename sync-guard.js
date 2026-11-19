'use strict';

const crypto = require('crypto');
const fs = require('fs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function stableFile(file, wait = 4000) {
  const before = fs.statSync(file);
  await delay(wait);
  const after = fs.statSync(file);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('Excel write is still in progress');
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function createGuard() {
  let busy = false, lastHash = null;
  return async (file, work) => {
    if (busy) return { skipped: 'sync_in_progress' };
    busy = true;
    try {
      const hash = await stableFile(file);
      if (hash === lastHash) return { skipped: 'unchanged_content' };
      const result = await work();
      lastHash = hash; // Only mark verified content after its upsert succeeds.
      return result;
    } finally { busy = false; }
  };
}
function watchExcel(file, onStableChange, { debounceMs = 4500 } = {}) {
  let timer = null;
  const schedule = () => { clearTimeout(timer); timer = setTimeout(() => { void onStableChange(); }, debounceMs); };
  const watcher = fs.watch(file, { persistent: true }, schedule);
  return () => { clearTimeout(timer); watcher.close(); };
}
module.exports = { stableFile, createGuard, watchExcel, delay };
