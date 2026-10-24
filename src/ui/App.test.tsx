// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Runner, UiSnapshot } from '../content/runner';
import { initialState } from '../core/types';
import { DEFAULT_SETTINGS } from '../shared/settings';
import { App } from './App';

let root: Root;
let container: HTMLDivElement;
let update: (snapshot: UiSnapshot) => void;
let snap: UiSnapshot;

const runner = {
  subscribe: vi.fn((listener: (snapshot: UiSnapshot) => void) => { update = listener; listener(snap); return () => {}; }),
  respondToPrompt: vi.fn(), startManualBreak: vi.fn(), startDeferredBreak: vi.fn(), openOptions: vi.fn(),
  setMemo: vi.fn(), askEndBreak: vi.fn(), cancelEndBreak: vi.fn(), endBreakEarly: vi.fn(),
  sendFeedback: vi.fn(), dismissFinished: vi.fn(),
};
const button = (label: string) => {
  const found = [...container.querySelectorAll('button')].find((element) => element.getAttribute('aria-label') === label || element.textContent === label);
  if (!found) throw new Error(`Button missing: ${label}`);
  return found;
};
const click = async (label: string) => { await act(async () => button(label).click()); };
const publish = async () => { await act(async () => update(snap)); };

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-24T03:00:00Z'));
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  document.documentElement.className = 'light';
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  const { apiKey: _, ...settings } = DEFAULT_SETTINGS;
  snap = {
    state: initialState(), settings: { ...settings, hasApiKey: false }, load: 0,
    clock: { minute: 0, sampledAt: Date.now() }, prompt: null, finishedBreak: null,
    confirmEndBreak: false, lastClassify: null,
    diagnostics: { matched: {}, assistantCount: 0, userCount: 0, generating: false, lastResponseChars: 0, lastResponseHead: '', completionMethod: null },
  };
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<App runner={runner as unknown as Runner} />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.documentElement.className = '';
  vi.useRealTimers();
});

describe('画像に合わせたUIの操作', () => {
  it('詳細の開閉、設定、手動休憩をつなぎ、閉じたらページ幅を戻す', async () => {
    await click('作業モニターを開く');
    expect(container.querySelectorAll('[role="meter"]')).toHaveLength(6);
    expect(container.querySelector('.hi-load-heading')?.textContent).toContain('0%');
    expect(container.querySelector<HTMLDetailsElement>('.hi-history')?.open).toBe(false);
    expect(container.textContent).toContain('未計測');
    expect(document.head.textContent).toContain('384px');
    await click('設定を開く');
    expect(runner.openOptions).toHaveBeenCalledOnce();
    await act(async () => container.querySelector('aside')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.head.textContent).not.toContain('384px');
    expect(container.querySelector('aside')).toBeNull();
    await click('作業モニターを開く');
    await click('休憩する');
    expect(runner.startManualBreak).toHaveBeenCalledWith('');
  });

  it('通知は今休むか開始待ちの2択。待っている間も％と開始ボタンを表示する', async () => {
    snap = { ...snap, load: 85, prompt: { load: 85, minutes: 11, top: 'verification' } };
    await publish();
    await click('今11分休む');
    expect(runner.respondToPrompt).toHaveBeenLastCalledWith('now');
    await click('区切りがついたら休む');
    expect(runner.respondToPrompt).toHaveBeenLastCalledWith('next_breakpoint');
    snap = { ...snap, prompt: null, load: 95, state: { ...snap.state, prompt: { ...snap.state.prompt, waitingForUser: true } } };
    await publish();
    expect(container.querySelector('.hi-pill-percent')?.textContent).toBe('95%');
    expect(container.firstElementChild?.getAttribute('data-load-level')).toBe('warning');
    await act(async () => container.querySelector<HTMLButtonElement>('.hi-ready')!.click());
    expect(runner.startDeferredBreak).toHaveBeenCalledOnce();
    snap = { ...snap, load: 100 };
    await publish();
    expect(container.firstElementChild?.getAttribute('data-load-level')).toBe('critical');
    expect(container.querySelector('.hi-ready')?.textContent).toContain('15分休む');
  });

  it('秒表示は操作による再描画で戻らず、倍速と新しい時計に追従する', async () => {
    snap = { ...snap, settings: { ...snap.settings, speed: 10 }, clock: { minute: 2.5, sampledAt: Date.now() }, state: { ...snap.state, minute: 2, breakState: { startedAt: 0, plannedMin: 10, memo: '' } } };
    await publish();
    expect(container.querySelector('[role="timer"]')?.textContent).toBe('07:30');
    await act(async () => vi.advanceTimersByTime(1000));
    expect(container.querySelector('[role="timer"]')?.textContent).toBe('07:20');
    snap = { ...snap, state: { ...snap.state, breakState: { ...snap.state.breakState!, memo: 'テストを確認' } } };
    await publish();
    expect(container.querySelector('[role="timer"]')?.textContent).toBe('07:20');
    snap = { ...snap, clock: { minute: 2 + 40 / 60, sampledAt: Date.now() } };
    await publish();
    expect(container.querySelector('[role="timer"]')?.textContent).toBe('07:20');
    await click('休憩を終える');
    expect(runner.askEndBreak).toHaveBeenCalledOnce();
    snap = { ...snap, confirmEndBreak: true };
    await publish();
    await click('続ける');
    expect(runner.cancelEndBreak).toHaveBeenCalledOnce();
    await click('終える');
    expect(runner.endBreakEarly).toHaveBeenCalledOnce();
  });

  it('休憩では1種類の運動を案内し、再描画で変えず、復帰メモと評価を扱える', async () => {
    snap = { ...snap, state: { ...snap.state, breakState: { startedAt: 0, plannedMin: 10, memo: 'テストを確認', stretch: 'shoulder' } } };
    await publish();
    expect(container.querySelector('input')?.value).toBe('テストを確認');
    expect(container.textContent).toContain('肩を回しましょう');
    expect(container.querySelector('.hi-tabs')).toBeNull();
    expect(container.querySelector('.hi-picto-shoulder')).not.toBeNull();
    snap = { ...snap, clock: { ...snap.clock, minute: 1 } };
    await publish();
    expect(container.querySelector('.hi-picto-shoulder')).not.toBeNull();
    snap = { ...snap, prompt: null, state: { ...snap.state, breakState: null }, finishedBreak: { memo: 'テストを確認', plannedMin: 10, top: 'reading' } };
    await publish();
    expect(container.textContent).toContain('テストを確認');
    await click('よかった');
    expect(runner.sendFeedback).toHaveBeenCalledWith('good');
  });

  it('ChatGPTのテーマ変更に追従し、計測停止時はパネルの領域も解除する', async () => {
    expect(container.firstElementChild?.getAttribute('data-theme')).toBe('light');
    await act(async () => { document.documentElement.className = 'dark'; });
    expect(container.firstElementChild?.getAttribute('data-theme')).toBe('dark');
    await click('作業モニターを開く');
    snap = { ...snap, settings: { ...snap.settings, enabled: false } };
    await publish();
    expect(container.innerHTML).toBe('');
    expect(document.head.textContent).not.toContain('384px');
  });
});
