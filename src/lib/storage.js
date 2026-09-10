// Thin wrapper over chrome.storage. Config lives in `sync` (one `config` item),
// the counter in `local` (frequent writes, no need to sync).
import { normalizeConfig } from './config.js';

export const CONFIG_KEY = 'config';
export const STATS_KEY = 'stats';

export async function loadConfig() {
  const { [CONFIG_KEY]: raw } = await chrome.storage.sync.get(CONFIG_KEY);
  return normalizeConfig(raw).config;
}

export async function saveConfig(config) {
  await chrome.storage.sync.set({ [CONFIG_KEY]: config });
}

export async function updateConfig(patch) {
  const config = { ...(await loadConfig()), ...patch };
  await saveConfig(config);
  return config;
}

export function onConfigChange(callback) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes[CONFIG_KEY]) callback(normalizeConfig(changes[CONFIG_KEY].newValue).config);
  });
}

/** @typedef {{ avoided: number }} Stats */

/** @param {unknown} raw @returns {Stats} */
const toStats = (raw) => ({ avoided: 0, ...(typeof raw === 'object' && raw ? raw : {}) });

/** @returns {Promise<Stats>} */
export async function loadStats() {
  const { [STATS_KEY]: stats } = await chrome.storage.local.get(STATS_KEY);
  return toStats(stats);
}

export async function addAvoided(count = 1) {
  const stats = await loadStats();
  stats.avoided += count;
  await chrome.storage.local.set({ [STATS_KEY]: stats });
  return stats;
}

export async function resetStats() {
  const stats = { avoided: 0 };
  await chrome.storage.local.set({ [STATS_KEY]: stats });
  return stats;
}

export function onStatsChange(callback) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[STATS_KEY]) callback(toStats(changes[STATS_KEY].newValue));
  });
}
