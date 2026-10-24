import { expect, it } from 'vitest';
import { load } from '../../src/core/model';
import { DEFAULT_PARAMS } from '../../src/core/types';
import {
  BULK_CAP_CHARS,
  SWITCH_MIN_INTERVAL_MS,
  TYPING_QUIET_MS,
  Tracker,
  VSCODE_PARAMS,
  type TextChangeLike,
  stretchMessage,
  welcomeMessage,
} from './tracker';

const idle = { taskRunning: false, debugging: false, focused: true };

// VS Code の API をまねた形
const uri = (path: string, scheme = 'file') => ({ scheme, toString: () => `${scheme}://${path}` });
const change = (text: string, opts: { scheme?: string; isDirty?: boolean; reason?: number } = {}): TextChangeLike => ({
  document: { uri: uri('/a.ts', opts.scheme), isDirty: opts.isDirty ?? true },
  contentChanges: [{ text }],
  reason: opts.reason,
});

it('まとまった挿入は読む量になり、500 字で頭打ちにする', () => {
  const t = new Tracker();
  t.onTextChange(change('あ'.repeat(300)), 0);
  expect(t.state.readBacklogMin).toBeCloseTo(300 / 653);
  const capped = new Tracker();
  capped.onTextChange(change('あ'.repeat(10_000)), 0);
  expect(capped.state.readBacklogMin).toBeCloseTo(BULK_CAP_CHARS / DEFAULT_PARAMS.jaCharsPerMin);
});

it('補完を何回も受け入れても読む残りは 2 分で頭打ちになり、止まれば提案が出る', () => {
  const t = new Tracker(undefined, { ...VSCODE_PARAMS, threshold: 5 });
  let now = 0;
  for (let min = 0; min < 10; min++) {
    for (let k = 0; k < 5; k++) t.onTextChange(change('const x = 1;\n'.repeat(30)), now);
    t.onCommandEnd(1, now);
    t.tick();
    now += 60_000;
  }
  expect(t.state.readBacklogMin).toBeLessThanOrEqual(VSCODE_PARAMS.readBacklogCapMin);
  expect(t.checkPrompt(now, idle)).toBeNull(); // 読む残りがある間は区切りでない
  t.tick();
  t.tick();
  expect(t.checkPrompt(now, idle)).not.toBeNull();
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
  const t = new Tracker(undefined, { ...VSCODE_PARAMS, threshold: 20 });
  let now = 0;
  let prompts: string[] = [];
  for (let min = 0; min < 30; min++) {
    t.onCommandEnd(1, now);
    t.tick();
    now += 60_000;
    const m = t.checkPrompt(now, idle);
    if (m) prompts.push(m.message);
  }
  expect(load(t.state)).toBeGreaterThan(20);
  expect(prompts[0]).toBe('ひと息、休憩しませんか。確認や指示が続いています。');
  // 最初の提案の後は「今回は不要」と同じく 15 分空く
  expect(prompts.length).toBeGreaterThanOrEqual(1);
  expect(prompts.length).toBeLessThanOrEqual(2);
  expect(t.state.prompt.notBefore).toBeGreaterThan(t.state.minute - 15);
});

it('入力中・タスクの実行中・デバッグ中・VS Code が裏の時は提案しない', () => {
  const t = new Tracker(undefined, { ...VSCODE_PARAMS, threshold: 0.5 });
  t.onCommandEnd(1, 0);
  t.tick();
  t.onTextChange(change('a'), 100);
  expect(t.checkPrompt(100 + TYPING_QUIET_MS - 1, idle)).toBeNull();
  const quiet = 100 + TYPING_QUIET_MS;
  expect(t.checkPrompt(quiet, { ...idle, taskRunning: true })).toBeNull();
  expect(t.checkPrompt(quiet, { ...idle, debugging: true })).toBeNull();
  expect(t.checkPrompt(quiet, { ...idle, focused: false })).toBeNull();
  expect(t.checkPrompt(quiet, idle)).not.toBeNull();
});

it('判断は取れないので、器は 5 要素の平均で遅めにたまる(判断の寄与は 0)', () => {
  const t = new Tracker();
  t.onCommandEnd(1, 0);
  t.tick();
  expect(t.state.contribSinceBreak.decision).toBe(0);
  expect(t.state.llmAvailable).toBe(false);
});

/** 失敗を続けて、提案が出るところまで進めた Tracker */
function prompted(threshold = 20): Tracker {
  const t = new Tracker(undefined, { ...VSCODE_PARAMS, threshold });
  for (let min = 0; min < 60 && !t.state.prompt.declineStreak; min++) {
    t.onCommandEnd(1, 0);
    t.tick();
    t.checkPrompt(min * 60_000 + 10_000, idle);
  }
  expect(t.state.prompt.declineStreak).toBe(1);
  return t;
}

it('「今休む」で休憩を始め、休憩中だけ器が下がり、予定の時間でおかえりになる', () => {
  const t = prompted();
  t.random = () => 0.5; // 肩回し
  const before = load(t.state);
  expect(t.respondToPrompt(t.latestPromptId, 'now', 'テストを確認')).toBe(true);
  const b = t.state.breakState!;
  expect(b.memo).toBe('テストを確認');
  expect(b.stretch).toBe('shoulder');
  expect(b.plannedMin).toBe(10); // 器 80 前後は 10 分(breakMinutes)
  // 答えた時は「出した時の今回は不要」を取り消す
  expect(t.state.prompt.declineStreak).toBe(0);
  expect(t.checkPrompt(1e9, idle)).toBeNull(); // 休憩中は提案しない

  let finished = null;
  for (let i = 0; i < b.plannedMin && !finished; i++) finished = t.tick().finished;
  expect(finished).toMatchObject({ memo: 'テストを確認', plannedMin: 10, completed: true, top: 'verification' });
  expect(t.state.breakState).toBeNull();
  expect(load(t.state)).toBeLessThan(before / 2); // RF が 1 分 8 ずつ下がる(UF は残る)
  const msg = welcomeMessage(finished!, t.state.uf);
  expect(msg).toContain('おかえりなさい。確認の続きは、ひとつずつ進めましょう。');
  expect(msg).toContain('戻ったらやること: テストを確認');
});

it('「次の区切りで」は自分で始めるまで待ち、「今回は不要」と押さずに消えたのは出した時の扱いのまま', () => {
  const later = prompted();
  later.respondToPrompt(later.latestPromptId, 'next_breakpoint');
  expect(later.state.prompt.waitingForUser).toBe(true);
  expect(later.state.breakState).toBeNull();
  expect(later.startDeferredBreak('')).toBe(true);
  expect(later.state.breakState).not.toBeNull();

  for (const action of ['decline', undefined] as const) {
    const t = prompted();
    const prompt = structuredClone(t.state.prompt);
    expect(t.respondToPrompt(t.latestPromptId, action)).toBe(true);
    expect(t.state.prompt).toEqual(prompt);
    expect(t.state.breakState).toBeNull();
    // 2 回目の答えは無視する
    expect(t.respondToPrompt(t.latestPromptId, 'now')).toBe(false);
  }
});

it('提案を待たずに休める(器が低くても 80 の時の長さ)・途中で終えると completed が false', () => {
  const t = new Tracker();
  expect(t.startManualBreak('')).toBe(true);
  expect(t.state.breakState?.plannedMin).toBe(10);
  expect(t.startManualBreak('')).toBe(false);
  t.tick();
  expect(t.finishBreak(false)).toMatchObject({ completed: false, plannedMin: 10 });
  expect(t.state.breakState).toBeNull();
});

it('休憩の長さの調整(breakScale)を使う', () => {
  const t = new Tracker();
  t.breakScale = 0.5;
  t.startManualBreak('');
  expect(t.state.breakState?.plannedMin).toBe(5);
});

it('ストレッチの文は Chrome 版と同じ', () => {
  expect(stretchMessage('reach')).toContain('背伸び: 両腕を上げて、ゆっくり背伸びしましょう');
  expect(stretchMessage(undefined)).toContain('背伸び');
});

it('休憩中に閉じて開き直すと、閉じていた間も休憩のタイマーが進む', () => {
  const t = new Tracker();
  t.startManualBreak('続き');
  t.tick();
  t.tick();
  // 保存した状態から作り直す(globalState に入れて出したのと同じ)
  const reopened = new Tracker(structuredClone(t.state));
  reopened.breakTopAtStart = t.breakTopAtStart;
  expect(reopened.catchUp(3)).toBeNull();
  expect(reopened.breakRemainingMin()).toBe(5);
  expect(reopened.catchUp(30)).toMatchObject({ memo: '続き', completed: true });
  expect(reopened.state.breakState).toBeNull();
});

it('古い通知のボタンを後から押しても、何もしない(最後の提案のボタンだけ受け付ける)', () => {
  const t = prompted();
  const first = t.latestPromptId;
  // 1 回目に答えないまま 2 回目の提案が出る
  for (let min = 0; min < 60 && t.latestPromptId === first; min++) {
    t.onCommandEnd(1, 0);
    t.tick();
    t.checkPrompt(1e9 + min * 60_000, idle);
  }
  expect(t.latestPromptId).toBe(first + 1);
  const prompt = structuredClone(t.state.prompt);
  expect(t.respondToPrompt(first, 'now', '古い')).toBe(false);
  expect(t.state.breakState).toBeNull();
  expect(t.state.prompt).toEqual(prompt);
  expect(t.respondToPrompt(first + 1, 'now', '新しい')).toBe(true);
  expect(t.state.breakState?.memo).toBe('新しい');
});

it('今日の積み重ねが多いと、提案の文が変わる(Chrome 版と同じ)', () => {
  const t = prompted();
  t.state.uf = 30;
  t.state.prompt.notBefore = 0;
  t.state.prompt.declineStreak = 0;
  expect(t.checkPrompt(1e9, idle)?.message).toBe('ひと息、休憩しませんか。今日は作業が積み重なっています。');
});
