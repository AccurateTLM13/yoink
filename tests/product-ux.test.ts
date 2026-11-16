import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function worker() {
  const data: Record<string, any> = {};
  const chrome = {
    runtime: { id: 'test', getURL: (s: string) => `chrome-extension://test/${s}`, onInstalled: { addListener() {} }, onMessage: { addListener() {} }, sendMessage: async () => ({}) },
    commands: { onCommand: { addListener() {} } }, alarms: { onAlarm: { addListener() {} } },
    tabs: { onRemoved: { addListener() {} }, query: async () => [] },
    storage: { local: { get: async (key: string) => ({ [key]: data[key] }), set: async (values: object) => Object.assign(data, values), remove: async (keys: string[]) => keys.forEach(k => delete data[k]) }, sync: { get: async () => ({}) } },
  };
  const ctx = vm.createContext({ chrome, console, URL, Promise, Map, Set, Date, Math, Object, Array, Number, String, setTimeout, clearTimeout });
  vm.runInContext(fs.readFileSync('public/background.js', 'utf8'), ctx);
  return { ctx, data };
}

test('background history retains all 101 captures and propagates write failures', async () => {
  const { ctx, data } = worker();
  for (let i = 0; i < 101; i++) {
    await ctx.saveHistoryItem({ id: `item${i}`, dataUrl: `original${i}` });
  }
  assert.equal(data.omnicapture_history.length, 101);
  assert.equal(data.yoink_full_item0, 'original0');
  ctx.chrome.storage.local.set = async () => { throw new Error('storage failed'); };
  await assert.rejects(ctx.saveHistoryItem({ id: 'fail', dataUrl: 'original' }), /storage failed/);
});

test('URL batch returns the individual failed target alongside successes', async () => {
  const { ctx } = worker();
  vm.runInContext(`
    requireAllUrls = async () => {};
    getSettings = async () => ({});
    waitForTabComplete = async () => {};
    sleep = async () => {};
    withJob = async (fn) => fn();
    captureAndEncode = async () => 'image';
    finishCapture = async (item) => { if (item.url.includes('bad')) throw new Error('storage failed'); return { id: item.url, ...item }; };
    chrome.windows = { create: async ({url}) => ({ id: 1, tabs: [{id: 2}], url }), remove: async () => {} };
  `, ctx);
  const result = await ctx.handleCaptureUrlList({ urls: ['https://good.example', 'https://bad.example'], settings: {}, delayMs: 0 });
  assert.equal(result.results.length, 1);
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0].target, /bad\.example/);
  assert.equal(result.failures[0].reason, 'storage failed');
});

test('responsive capture adjusts outer window and records measured CSS viewport', async () => {
  const { ctx } = worker();
  vm.runInContext(`
    requireAllUrls = async () => {};
    getSettings = async () => ({});
    waitForTabComplete = async () => {};
    sleep = async () => {};
    withJob = async (fn) => fn();
    captureAndEncode = async () => 'image';
    finishCapture = async (item) => ({ id: 'result', ...item, width: 780, height: 1688 });
    let outer = { width: 390, height: 844 };
    chrome.windows = {
      create: async () => ({ id: 1, tabs: [{id: 2}] }),
      get: async () => outer,
      update: async (_id, size) => { outer = size; },
      remove: async () => {}
    };
    chrome.scripting = { executeScript: async () => [{ result: { width: outer.width, height: outer.height - 144, dpr: 2 } }] };
  `, ctx);
  const result = await ctx.handleCaptureMultiSize({ url: 'https://example.com', resolutions: [{ name: 'Mobile', width: 390, height: 844 }], settings: {} });
  assert.equal(result.failures.length, 0);
  assert.equal(result.results[0].viewport.width, 390);
  assert.equal(result.results[0].viewport.height, 844);
  assert.equal(result.results[0].width, 780);
});
