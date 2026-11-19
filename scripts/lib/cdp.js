// Launches a headless Chromium with the unpacked extension and exposes a tiny CDP client.
// Needs a browser that honours --load-extension (Brave, Chromium, Chrome for Testing; branded
// Google Chrome >= 137 ignores it). Override the binary with CHROME=/path/to/binary and add
// flags with CHROME_ARGS (e.g. "--no-sandbox" on CI runners without user namespaces).
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// The extension to load: the repository itself, or EXTENSION_DIR (an unpacked release zip).
const EXT_DIR = process.env.EXTENSION_DIR || REPO_DIR;
const EXT_NAME = JSON.parse(readFileSync(join(EXT_DIR, '_locales', 'en', 'messages.json'), 'utf8')).extName.message;

const CANDIDATES = [
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/brave-browser',
];

/**
 * JSON from the DevTools protocol; its shape depends on the method, and the protocol has no types here.
 * @typedef {Record<string, any>} CdpResult
 */

/** @param {unknown} error */
const messageOf = (error) => (error instanceof Error ? error.message : String(error));

/** @param {number} ms */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** @param {{ extraArgs?: string[] }} [options] */
export async function launchChromium({ extraArgs = [] } = {}) {
  const binary = process.env.CHROME || CANDIDATES.find(existsSync);
  if (!binary) throw new Error('No Chromium-based browser found; set CHROME=/path/to/binary');

  const profile = mkdtempSync(join(tmpdir(), 'fet-'));
  const child = spawn(binary, [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    `--load-extension=${EXT_DIR}`,
    `--disable-extensions-except=${EXT_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
    ...(process.env.CHROME_ARGS?.split(' ').filter(Boolean) ?? []),
    ...extraArgs,
  ]);
  /** @type {string} */
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = '';
    child.stderr.on('data', (d) => {
      buf += d;
      const m = /DevTools listening on (ws:\S+)/.exec(buf);
      if (m) resolve(m[1]);
    });
    child.on('exit', (c) => reject(new Error(`browser exited ${c}\n${buf}`)));
  });

  const ws = new WebSocket(wsUrl);
  await new Promise((r) => (ws.onopen = r));
  let seq = 0;
  /** @type {Map<number, { resolve: (result: CdpResult) => void, reject: (error: Error) => void }>} */
  const pending = new Map();
  /** @type {CdpResult[]} */
  const events = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    const call = msg.id && pending.get(msg.id);
    if (call) {
      pending.delete(msg.id);
      msg.error ? call.reject(new Error(JSON.stringify(msg.error))) : call.resolve(msg.result);
    } else events.push(msg);
  };
  /**
   * @param {string} method
   * @param {object} [params]
   * @param {string} [sessionId]
   * @returns {Promise<CdpResult>}
   */
  const cdp = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });

  /** @returns {Promise<{ targetId: string, type: string, url: string }[]>} */
  const targets = async () => (await cdp('Target.getTargets')).targetInfos;
  const pages = async () => (await targets()).filter((t) => t.type === 'page');
  /** @param {string} url @returns {Promise<string>} the new target's id */
  const open = async (url) => (await cdp('Target.createTarget', { url })).targetId;
  /** @param {string} targetId @returns {Promise<string>} the session id */
  const attach = async (targetId) => {
    const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
    await cdp('Runtime.enable', {}, sessionId);
    return sessionId;
  };
  /** @param {string} sessionId @param {string} expression @returns {Promise<any>} the value, as JSON from the page */
  const evaluate = async (sessionId, expression) => {
    const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'evaluate failed');
    return r.result.value;
  };

  // Built-in component extensions also ship a background.js: identify ours by manifest name.
  const findOurWorker = async () => {
    const workers = (await targets()).filter(
      (t) => t.type === 'service_worker' && t.url.endsWith('/src/background.js'),
    );
    for (const w of workers) {
      const sessionId = await attach(w.targetId);
      // A worker whose manifest cannot be read (another extension still starting) is not ours.
      const name = await evaluate(sessionId, 'chrome.runtime.getManifest().name').catch(() => null);
      if (name === EXT_NAME) return { extId: new URL(w.url).host, swSession: sessionId };
      await cdp('Target.detachFromTarget', { sessionId }).catch((e) =>
        console.warn(`could not detach from ${w.url}: ${messageOf(e)}`),
      );
    }
    return null;
  };
  let ours = null;
  for (let i = 0; i < 50 && !ours; i++) {
    ours = await findOurWorker();
    if (!ours) await sleep(100);
  }
  if (!ours) throw new Error('extension service worker not found');
  const { extId, swSession } = ours;

  const close = async () => {
    ws.close();
    const exited = new Promise((r) => child.on('exit', r));
    child.kill();
    await exited;
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
    } catch (e) {
      // A leftover temp profile is harmless; never let it mask the real failure.
      console.warn(`could not remove ${profile}: ${messageOf(e)}`);
    }
  };

  return { cdp, events, targets, pages, open, attach, evaluate, extId, swSession, close };
}
