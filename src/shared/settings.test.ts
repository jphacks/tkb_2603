// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { loadSettings, saveSettings } from './settings';

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
