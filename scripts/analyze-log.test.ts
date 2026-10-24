import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { classifyCost, compareTimer, median, parseLog, report, summarize, timerTicks } from './analyze-log';

const load = (name: string) => parseLog(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

it('提案・休憩・分類・送信の数を集計する', () => {
  const s = summarize(load('sample-log.json'));
  expect(s.promptsShown).toBe(3);
  expect(s.promptActions).toEqual({ next_breakpoint: 1, now: 1, decline: 1 });
  expect(s.waitedSecMedian).toBe(30);
  expect([s.breakStarts, s.breakCompleted, s.breakEndedEarly]).toEqual([2, 1, 1]);
  expect(s.feedback).toEqual({ good: 1, unneeded: 1 });
  expect([s.classifyOk, s.classifyCount]).toEqual([2, 3]);
  expect(s.classifyAvgMs).toBeCloseTo(34000 / 3);
  expect([s.promptsSent, s.responsesDone]).toEqual([3, 3]);
});

it('30 分ごとの時刻に、生成中・入力中・読んでいる最中だったかを数える', () => {
  const c = compareTimer(load('sample-log.json'));
  // 30 分: 生成中(29〜31 分)。60 分: 入力中(59〜61 分)と読んでいる最中(58 分 + 1959 字 ÷ 653 = 61 分まで)
  expect(c).toMatchObject({ ticks: 2, generating: 1, typing: 1, reading: 1, anyBusy: 2 });
});

it('対になっていない区間は捨て、そのことを出力に書く', () => {
  const m = 60_000;
  const o = (min: number, kind: string) => ({ type: 'observation' as const, kind, at: min * m, minute: min });
  // 30 分の時点で typing_start / generation_start だけが残っている
  const log = [o(0, 'prompt_sent'), o(25, 'typing_start'), o(28, 'generation_start'), o(40, 'prompt_sent')];
  expect(compareTimer(log)).toMatchObject({ ticks: 1, typing: 0, generating: 0 });
  expect(report(log)).toContain('対になっていない区間');
});

it('入力・生成の記録が無い古いログでも動く', () => {
  const log = load('sample-log-old.json');
  expect(compareTimer(log)).toMatchObject({ ticks: 2, generating: 0, typing: 0, reading: 1, hasTyping: false });
  expect(report(log)).toContain('(記録なし)');
});

it('記録が長く途切れたら回を分けて、間の時間には鳴らさない', () => {
  const m = 60_000;
  const at = (min: number) => ({ type: 'day_reset' as const, at: min * m, minute: 0 });
  expect(timerTicks([at(0), at(40), at(300), at(365)]).map((t) => t / m)).toEqual([30, 330, 360]);
});

it('送信・回答・提案をサイト別に数え、site の無い記録は「不明」にする', () => {
  expect(summarize(load('sample-log.json')).bySite).toEqual({
    chatgpt: { sent: 2, responses: 2, prompts: 2 },
    claude: { sent: 1, responses: 1, prompts: 0 },
    不明: { sent: 0, responses: 0, prompts: 1 },
  });
  expect(Object.keys(summarize(load('sample-log-old.json')).bySite)).toEqual(['不明']);
});

it('分類の費用をモデル別の単価で出し、トークンの無い記録は数えない', () => {
  const c = classifyCost(load('sample-log.json'));
  // opus: 2000 × $4 + 500 × $20、haiku: 3000 × $0.10 + 1000 × $0.50(100 万トークンあたり)
  expect(c).toMatchObject({ counted: 2, pricedCount: 2, inputTokens: 5000, outputTokens: 1500 });
  expect(c.usd).toBeCloseTo(0.018 + 0.0008, 10);
  expect(c.byModel['claude-opus-5-5']?.usd).toBeCloseTo(0.018, 10);
  expect(classifyCost(load('sample-log-old.json')).counted).toBe(0);
  expect(report(load('sample-log-old.json'))).toContain('トークンの記録がある分類はありません');
});

it('単価の分からないモデルは費用に入れず、そう書く', () => {
  const log = parseLog(JSON.stringify([
    { type: 'classify', ok: true, model: 'claude-x', ms: 1, at: 0, minute: 0, inputTokens: 1000, outputTokens: 1000 },
    { type: 'classify', ok: true, model: 'claude-opus-5-5', ms: 1, at: 1, minute: 0, inputTokens: 1_000_000, outputTokens: 0 },
  ]));
  const c = classifyCost(log);
  expect([c.counted, c.pricedCount, c.usd]).toEqual([2, 1, 4]);
  expect(c.unknownModels).toEqual(['claude-x']);
  expect(report(log)).toContain('単価の分からないモデルは費用に入れていない: claude-x');
});

it('中央値', () => {
  expect(median([])).toBeNull();
  expect(median([5, 1, 3])).toBe(3);
  expect(median([4, 1, 3, 2])).toBe(2.5);
});
