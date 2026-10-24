import { describe, expect, it } from 'vitest';
import { applyPromptAction, isBreakpoint, shouldPrompt, type GateContext } from './gate';
import { looksLikeError } from './detect';
import {
  breakMinutes,
  cancelBreak,
  contributionShares,
  endBreak,
  load,
  observe,
  splitText,
  startBreak,
  tick,
} from './model';
import { DEFAULT_PARAMS as P, ELEMENT_KEYS, type EngineState, initialState } from './types';

/** 作業し続ける: 毎分操作があり、重さに応じて出来事を足す */
function work(
  s: EngineState,
  minutes: number,
  opts: { decisionsPerMin?: number; verifPerMin?: number; switchEvery?: number; readMinPerMin?: number } = {},
): EngineState {
  for (let i = 0; i < minutes; i++) {
    s = observe(s, { kind: 'activity', t: s.minute }, P);
    if (opts.decisionsPerMin) s = observe(s, { kind: 'decision', t: s.minute, count: opts.decisionsPerMin }, P);
    if (opts.verifPerMin) s = observe(s, { kind: 'verification', t: s.minute, count: opts.verifPerMin, source: 'llm' }, P);
    if (opts.switchEvery && i % opts.switchEvery === 0) s = observe(s, { kind: 'switch', t: s.minute, source: 'llm' }, P);
    if (opts.readMinPerMin) s = { ...s, readBacklogMin: Math.max(s.readBacklogMin, opts.readMinPerMin + 1) };
    s = tick(s, P).state;
  }
  return s;
}

function minutesToThreshold(opts: Parameters<typeof work>[2]): number {
  let s = initialState();
  for (let m = 1; m <= 300; m++) {
    s = work(s, 1, opts);
    if (load(s) >= P.threshold) return m;
  }
  return Infinity;
}

const quietCtx: GateContext = {
  generating: false,
  typing: false,
  composerHasText: false,
  tabVisible: true,
  secondsSinceResponse: 30,
  quietSeconds: 10,
};

describe('器の計算', () => {
  it('T1: RF ≥ 0、器は 0〜100 におさまる', () => {
    let s = work(initialState(), 200, { decisionsPerMin: 3, verifPerMin: 3, switchEvery: 1, readMinPerMin: 2 });
    expect(s.rf).toBeGreaterThanOrEqual(0);
    expect(load(s)).toBeLessThanOrEqual(100);
    s = startBreak(s, 15, '');
    for (let i = 0; i < 60; i++) s = tick(s, P).state;
    expect(s.rf).toBe(0);
  });

  it('T2: 休憩中は RF だけが減り、UF は変わらない', () => {
    let s = work(initialState(), 40, { readMinPerMin: 1 });
    const uf = s.uf;
    const rf = s.rf;
    s = startBreak(s, 10, '');
    s = tick(s, P).state;
    expect(s.uf).toBe(uf);
    expect(s.rf).toBeCloseTo(Math.max(0, rf - P.r));
  });

  it('T3: 中身が重いほど、しきい値に早く届く(時間だけでは決まらない)', () => {
    const light = minutesToThreshold({});
    const normal = minutesToThreshold({ readMinPerMin: 1, verifPerMin: 1 });
    const heavy = minutesToThreshold({ readMinPerMin: 1, decisionsPerMin: 2, verifPerMin: 2, switchEvery: 1 });
    expect(heavy).toBeLessThan(normal);
    expect(normal).toBeLessThan(light);
  });

  it('T4: 操作が無い時間はたまらない(最後の操作から 5 分は作業中とみなす)', () => {
    let s = work(initialState(), 10);
    for (let i = 0; i < P.activeWindowMin; i++) s = tick(s, P).state;
    const before = load(s);
    for (let i = 0; i < 30; i++) s = tick(s, P).state;
    expect(load(s)).toBeCloseTo(before, 5);
  });

  it('T5: 目盛り — 重い 25 分 / ふつう 50 分 / 軽い 100 分前後(g=3.2)', () => {
    // e = 1(全部最大)
    expect(minutesToThreshold({ readMinPerMin: 1, decisionsPerMin: 2, verifPerMin: 2, switchEvery: 1 })).toBeGreaterThanOrEqual(24);
    expect(minutesToThreshold({ readMinPerMin: 1, decisionsPerMin: 2, verifPerMin: 2, switchEvery: 1 })).toBeLessThanOrEqual(27);
    // 時間だけ(e = 0.2)は 125 分前後
    const timeOnly = minutesToThreshold({});
    expect(timeOnly).toBeGreaterThanOrEqual(120);
    expect(timeOnly).toBeLessThanOrEqual(130);
  });

  it('T6: しきい値から 10 分休むと RF がほぼ 0。休憩の長さは 1〜15 分', () => {
    let s = initialState();
    s = { ...s, rf: 80, uf: 0 };
    s = startBreak(s, 10, '');
    for (let i = 0; i < 10; i++) s = tick(s, P).state;
    expect(s.rf).toBe(0);
    expect(breakMinutes(80)).toBe(10);
    expect(breakMinutes(100)).toBe(15);
    expect(breakMinutes(100, 2)).toBe(15);
    expect(breakMinutes(80, 0.01)).toBe(1);
  });

  it('T7: 断り続けても通知の間隔が縮まない・RF は 100−UF を超えない', () => {
    let s = work(initialState(), 60, { readMinPerMin: 1, decisionsPerMin: 2, verifPerMin: 2 });
    const gaps: number[] = [];
    for (let n = 0; n < 4; n++) {
      const before = s.minute;
      s = applyPromptAction(s, 'decline');
      gaps.push(s.prompt.notBefore - before);
      s = work(s, 5, { readMinPerMin: 1, decisionsPerMin: 2 });
    }
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]!).toBeGreaterThanOrEqual(gaps[i - 1]!);
    expect(s.rf).toBeLessThanOrEqual(100 - s.uf + 1e-9);
    // 15 分休めば必ず 80 を下回る
    s = startBreak(s, 15, '');
    for (let i = 0; i < 15; i++) s = tick(s, P).state;
    expect(load(s)).toBeLessThan(P.threshold);
  });

  it('T8: 要素ごとの寄与の合計 = 器の増え方(上限にかからない範囲)', () => {
    let s = initialState();
    const r = tick(observe(observe(s, { kind: 'activity', t: 0 }, P), { kind: 'decision', t: 0, count: 1 }, P), P);
    const sum = ELEMENT_KEYS.reduce((a, k) => a + r.added[k], 0);
    expect(sum).toBeCloseTo(r.state.rf + r.state.uf - (s.rf + s.uf), 6);
    expect(contributionShares(r.state)).not.toBeNull();
  });

  it('T10: 3 時間作業が無ければ器を 0 に戻す。負の値にならない', () => {
    let s = work(initialState(), 30, { readMinPerMin: 1 });
    for (let i = 0; i < 200; i++) s = tick(s, P).state;
    expect(s.rf).toBe(0);
    expect(s.uf).toBe(0);
  });

  it('LLM が使えない間も ÷5 のまま(判断が 0 で遅めにたまる)', () => {
    const withDecision = minutesToThreshold({ readMinPerMin: 1, decisionsPerMin: 2 });
    const without = minutesToThreshold({ readMinPerMin: 1 });
    expect(without).toBeGreaterThan(withDecision);
  });

  it('休憩を終えると寄与がリセットされる', () => {
    let s = work(initialState(), 20, { readMinPerMin: 1 });
    s = endBreak(startBreak(s, 5, 'テストを直す'));
    expect(contributionShares(s)).toBeNull();
  });
});

describe('自動タイマーで断る', () => {
  it('休憩を取り消しても、断るたびに 15 → 30 → 60 分あく', () => {
    let s = { ...initialState(), rf: 85 };
    const gaps: number[] = [];
    for (let n = 0; n < 3; n++) {
      s = startBreak(s, 10, '');
      s = cancelBreak(s);
      const before = s.minute;
      s = applyPromptAction(s, 'decline');
      gaps.push(s.prompt.notBefore - before);
      s = { ...s, minute: s.prompt.notBefore };
    }
    expect(gaps).toEqual([15, 30, 60]);
    expect(s.breakState).toBeNull();
  });

  it('閉じていた間に休憩が終わっても、誰もいない時間はたまらない', () => {
    let s = startBreak({ ...initialState(), rf: 80 }, 10, '');
    for (let i = 0; i < 10; i++) s = tick(s, P).state;
    s = endBreak(s, false);
    for (let i = 0; i < 10; i++) s = tick(s, P).state;
    expect(load(s)).toBe(0);
  });
});

describe('区切りの判定', () => {
  it('生成中・入力中・長い回答を読んでいる最中・タブが裏は区切りではない', () => {
    const s = initialState();
    expect(isBreakpoint(s, quietCtx)).toBe(true);
    expect(isBreakpoint(s, { ...quietCtx, generating: true })).toBe(false);
    expect(isBreakpoint(s, { ...quietCtx, typing: true })).toBe(false);
    expect(isBreakpoint(s, { ...quietCtx, composerHasText: true })).toBe(false);
    expect(isBreakpoint(s, { ...quietCtx, tabVisible: false })).toBe(false);
    expect(isBreakpoint(s, { ...quietCtx, secondsSinceResponse: 3 })).toBe(false);
    expect(isBreakpoint({ ...s, readBacklogMin: 3 }, quietCtx)).toBe(false);
  });

  it('通知は作業の区切りを待ち、ユーザーが開始する', () => {
    const s = { ...initialState(), rf: 85 };
    const busy = { ...quietCtx, typing: true };
    expect(shouldPrompt(s, P, busy)).toBe(false);
    expect(shouldPrompt(s, P, quietCtx)).toBe(true);
    expect(s.breakState).toBeNull();
  });

  it('「区切りがついたら休む」は開始操作まで通知を重ねず、計測を続ける', () => {
    let s = { ...initialState(), rf: 85 };
    s = applyPromptAction(s, 'next_breakpoint');
    expect(s.prompt.waitingForUser).toBe(true);
    expect(shouldPrompt(s, P, quietCtx)).toBe(false);
    s = work(s, 20, { readMinPerMin: 2, decisionsPerMin: 2, verifPerMin: 2, switchEvery: 1 });
    expect(load(s)).toBe(100);
    expect(s.breakState).toBeNull();
    expect(shouldPrompt(s, P, quietCtx)).toBe(false);
    s = startBreak(s, breakMinutes(load(s)), '', 'shoulder');
    expect(s.prompt.waitingForUser).toBe(false);
    expect(s.breakState?.plannedMin).toBe(15);
    expect(s.breakState?.stretch).toBe('shoulder');
  });

  it('3時間の区切りでは開始待ちも解除する', () => {
    let s = applyPromptAction(work(initialState(), 10), 'next_breakpoint');
    for (let i = 0; i < 200; i++) s = tick(s, P).state;
    expect(load(s)).toBe(0);
    expect(s.prompt.waitingForUser).toBe(false);
  });
});

describe('手がかりの検出', () => {
  it('エラー文らしい貼り付けを見分ける', () => {
    expect(looksLikeError('Traceback (most recent call last):\n  File "a.py", line 3')).toBe(true);
    expect(looksLikeError("TypeError: Cannot read properties of undefined (reading 'x')")).toBe(true);
    expect(looksLikeError('    at foo (app.js:10:5)')).toBe(true);
    expect(looksLikeError('React でフォームを作りたいです')).toBe(false);
  });

  it('日本語の字数と英語の語数を分ける', () => {
    const r = splitText('これはテストです const value = 1;');
    expect(r.jaChars).toBe(8);
    expect(r.enWords).toBeGreaterThanOrEqual(3);
  });
});
