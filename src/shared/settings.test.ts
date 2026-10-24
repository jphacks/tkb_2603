// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { appendLog, loadSettings, saveSettings } from './settings';

afterEach(() => vi.unstubAllGlobals());
it('以前の自動タイマー設定も、ほかの設定を保って通知方式に移行する', async () => {
  const set = vi.fn();
  vi.stubGlobal('browser', { storage: { local: {
    get: vi.fn().mockResolvedValue({ 'hitoiki:settings': { mode: 'auto_timer', threshold: 90, breakScale: 0.5, llmEnabled: false } }),
    set,
  } } });
  const settings = await loadSettings();
  expect(settings.mode).toBe('notify');
  expect(settings.threshold).toBe(90);
  expect(settings.breakScale).toBe(0.5);
  expect(settings.llmEnabled).toBe(false);
  await saveSettings({ speed: 30 });
  expect(set).toHaveBeenCalledWith({ 'hitoiki:settings': { ...settings, speed: 30 } });
});

it('記録を同時にいくつ足しても消えない(書き込みを順番に流す)', async () => {
  const store: Record<string, unknown> = {};
  vi.stubGlobal('browser', { storage: { local: {
    get: vi.fn(async (key: string) => {
      await new Promise((r) => setTimeout(r, 5)); // 読むのに時間がかかる
      return { [key]: store[key] };
    }),
    set: vi.fn(async (obj: Record<string, unknown>) => { Object.assign(store, obj); }),
  } } });
  await Promise.all([
    appendLog({ type: 'observation', kind: 'typing_end' }, 1, 'claude'),
    appendLog({ type: 'observation', kind: 'generation_start' }, 1, 'claude'),
    appendLog({ type: 'observation', kind: 'prompt_sent' }, 1, 'claude'),
  ]);
  const log = store['hitoiki:log'] as { kind: string; site: string }[];
  expect(log.map((e) => e.kind)).toEqual(['typing_end', 'generation_start', 'prompt_sent']);
  expect(log.every((e) => e.site === 'claude')).toBe(true);
});
