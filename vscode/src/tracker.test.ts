import { expect, it } from 'vitest';
import { load } from '../../src/core/model';
import { DEFAULT_PARAMS } from '../../src/core/types';
import { BULK_CAP_CHARS, SWITCH_MIN_INTERVAL_MS, TYPING_QUIET_MS, Tracker, type TextChangeLike } from './tracker';

// VS Code の API をまねた形
const uri = (path: string, scheme = 'file') => ({ scheme, toString: () => `${scheme}://${path}` });
const change = (text: string, opts: { scheme?: string; isDirty?: boolean; reason?: number } = {}): TextChangeLike => ({
  document: { uri: uri('/a.ts', opts.scheme), isDirty: opts.isDirty ?? true },
  contentChanges: [{ text }],
  reason: opts.reason,
});

it('まとまった挿入は読む量になり、2,000 字で頭打ちにする', () => {
  const t = new Tracker();
  t.onTextChange(change('あ'.repeat(653)), 0);
  expect(t.state.readBacklogMin).toBeCloseTo(1);
  const capped = new Tracker();
  capped.onTextChange(change('あ'.repeat(10_000)), 0);
  expect(capped.state.readBacklogMin).toBeCloseTo(BULK_CAP_CHARS / DEFAULT_PARAMS.jaCharsPerMin);
});

it('打鍵は入力として扱い、読む量にしない', () => {
  const t = new Tracker();
  t.onTextChange(change('a'), 0);
  expect(t.state.readBacklogMin).toBe(0);
  expect(t.state.lastActivityAt).toBe(0);
  expect(t.gateContext(TYPING_QUIET_MS - 1).typing).toBe(true);
  expect(t.gateContext(TYPING_QUIET_MS).typing).toBe(false);
});

it('ディスクからの読み直し・元に戻す・出力パネル・空の変更は数えない', () => {
  const t = new Tracker();
  const big = 'x '.repeat(500);
  t.onTextChange(change(big, { isDirty: false }), 0);
  t.onTextChange(change(big, { reason: 1 }), 0);
  t.onTextChange(change(big, { scheme: 'output' }), 0);
  t.onTextChange({ document: { uri: uri('/a.ts'), isDirty: true }, contentChanges: [] }, 0);
  expect(t.state.readBacklogMin).toBe(0);
  expect(t.state.lastActivityAt).toBeNull();
});

it('失敗したコマンド・タスクだけを確認・検証に数える', () => {
  const t = new Tracker();
  t.onCommandEnd(1, 0);
  t.onCommandEnd(0, 0);
  t.onCommandEnd(undefined, 0);
  t.onCommandEnd(2, 0);
  expect(t.state.recent.verification).toHaveLength(2);
  expect(t.state.lastActivityAt).toBe(0);
});

it('ファイルの切替を数え、短い間の行き来と同じファイルは間引く', () => {
  const t = new Tracker();
  t.onActiveEditor(uri('/a.ts'), 0); // 起点
  t.onActiveEditor(uri('/b.ts'), 1000); // 切替
  t.onActiveEditor(uri('/a.ts'), 2000); // すぐ戻った → 数えない
  t.onActiveEditor(uri('/a.ts'), 20_000); // 同じファイル
  t.onActiveEditor(uri('/c.ts'), 1000 + SWITCH_MIN_INTERVAL_MS); // 間が空いた切替
  t.onActiveEditor(undefined, 30_000);
  t.onActiveEditor(uri('settings', 'vscode-userdata'), 40_000);
  expect(t.state.recent.switching).toHaveLength(2);
});

it('失敗が続くと器がたまり、区切りで 1 回だけ提案して、間を空ける', () => {
  const t = new Tracker(undefined, { ...DEFAULT_PARAMS, threshold: 20 });
  let now = 0;
  let prompts: string[] = [];
  for (let min = 0; min < 30; min++) {
    t.onCommandEnd(1, now);
    t.tick();
    now += 60_000;
    const m = t.checkPrompt(now, { taskRunning: false, debugging: false });
    if (m) prompts.push(m);
  }
  expect(load(t.state)).toBeGreaterThan(20);
  expect(prompts[0]).toContain('コマンドやテストの失敗');
  // 最初の提案の後は「今回は不要」と同じく 15 分空く
  expect(prompts.length).toBeGreaterThanOrEqual(1);
  expect(prompts.length).toBeLessThanOrEqual(2);
  expect(t.state.prompt.notBefore).toBeGreaterThan(t.state.minute - 15);
});

it('入力中・タスクの実行中・デバッグ中は提案しない', () => {
  const t = new Tracker(undefined, { ...DEFAULT_PARAMS, threshold: 0.5 });
  t.onCommandEnd(1, 0);
  t.tick();
  t.onTextChange(change('a'), 100);
  expect(t.checkPrompt(100 + TYPING_QUIET_MS - 1, { taskRunning: false, debugging: false })).toBeNull();
  const quiet = 100 + TYPING_QUIET_MS;
  expect(t.checkPrompt(quiet, { taskRunning: true, debugging: false })).toBeNull();
  expect(t.checkPrompt(quiet, { taskRunning: false, debugging: true })).toBeNull();
  expect(t.checkPrompt(quiet, { taskRunning: false, debugging: false })).not.toBeNull();
});

it('判断は取れないので、器は 5 要素の平均で遅めにたまる(判断の寄与は 0)', () => {
  const t = new Tracker();
  t.onCommandEnd(1, 0);
  t.tick();
  expect(t.state.contribSinceBreak.decision).toBe(0);
  expect(t.state.llmAvailable).toBe(false);
});
