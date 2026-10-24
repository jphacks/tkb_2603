// 設定画面の「記録を書き出す(JSON)」を集計する。
// 使い方: node scripts/analyze-log.ts <file.json>
import { readFileSync } from 'node:fs';
import type { StoredLogEntry } from '../src/shared/settings.ts';
import { DEFAULT_PARAMS } from '../src/core/types.ts';

type Entry<T extends StoredLogEntry['type']> = Extract<StoredLogEntry, { type: T }>;

const MIN = 60_000;
/** 30 分ごとのタイマーの間隔 */
export const TIMER_INTERVAL_MIN = 30;
/** この時間記録が無ければ別の作業の回とみなす(器を 0 に戻す時間と同じ) */
export const SESSION_GAP_MIN = DEFAULT_PARAMS.dayResetIdleMin;

function ofType<T extends StoredLogEntry['type']>(log: StoredLogEntry[], type: T): Entry<T>[] {
  return log.filter((e): e is Entry<T> => e.type === type);
}

function observations(log: StoredLogEntry[], kind: string): Entry<'observation'>[] {
  return ofType(log, 'observation').filter((e) => e.kind === kind);
}

function countBy<T extends string>(values: T[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export interface Summary {
  entries: number;
  from: number | null;
  to: number | null;
  promptsShown: number;
  promptActions: Record<string, number>;
  waitedSecMedian: number | null;
  waitedSecCount: number;
  breakStarts: number;
  breakCompleted: number;
  breakEndedEarly: number;
  breakCancelled: number;
  feedback: Record<string, number>;
  classifyCount: number;
  classifyOk: number;
  classifyAvgMs: number | null;
  promptsSent: number;
  responsesDone: number;
}

export function summarize(log: StoredLogEntry[]): Summary {
  const waited = ofType(log, 'prompt_shown')
    .map((e) => e.waitedSec)
    .filter((v): v is number => typeof v === 'number');
  const ends = ofType(log, 'break_end');
  const classify = ofType(log, 'classify');
  const times = log.map((e) => e.at);
  return {
    entries: log.length,
    from: times.length ? Math.min(...times) : null,
    to: times.length ? Math.max(...times) : null,
    promptsShown: ofType(log, 'prompt_shown').length,
    promptActions: countBy(ofType(log, 'prompt_action').map((e) => e.action)),
    waitedSecMedian: median(waited),
    waitedSecCount: waited.length,
    breakStarts: ofType(log, 'break_start').length,
    breakCompleted: ends.filter((e) => e.completed).length,
    breakEndedEarly: ends.filter((e) => !e.completed).length,
    breakCancelled: ofType(log, 'break_cancelled').length,
    feedback: countBy(ofType(log, 'feedback').map((e) => e.value)),
    classifyCount: classify.length,
    classifyOk: classify.filter((e) => e.ok).length,
    classifyAvgMs: classify.length ? classify.reduce((a, e) => a + e.ms, 0) / classify.length : null,
    promptsSent: observations(log, 'prompt_sent').length,
    responsesDone: observations(log, 'response_done').length,
  };
}

// ---- 30 分ごとのタイマーだったら ----

export interface Interval {
  start: number;
  end: number;
}

/** start の出来事から、次の end の出来事までを区間にする。end が来なかったものは数えない */
function pairIntervals(log: StoredLogEntry[], startKind: string, endKind: string): Interval[] {
  const out: Interval[] = [];
  let open: number | null = null;
  for (const e of log) {
    if (e.type !== 'observation') continue;
    if (e.kind === startKind && open === null) open = e.at;
    else if (e.kind === endKind && open !== null) {
      out.push({ start: open, end: e.at });
      open = null;
    }
  }
  return out;
}

/** 回答を読む時間: response_done から、日本語 653 字/分 + 英語 238 語/分(core と同じ速さ) */
function readingIntervals(log: StoredLogEntry[]): Interval[] {
  return observations(log, 'response_done').map((e) => {
    const min = num(e.detail?.jaChars) / DEFAULT_PARAMS.jaCharsPerMin + num(e.detail?.enWords) / DEFAULT_PARAMS.enWordsPerMin;
    return { start: e.at, end: e.at + min * MIN };
  });
}

/** 記録が SESSION_GAP_MIN 以上途切れたところで分け、各回の初めから 30 分ごとの時刻を作る */
export function timerTicks(log: StoredLogEntry[], intervalMin = TIMER_INTERVAL_MIN): number[] {
  const times = log.map((e) => e.at).sort((a, b) => a - b);
  const ticks: number[] = [];
  let i = 0;
  while (i < times.length) {
    const start = times[i]!;
    let end = start;
    while (i + 1 < times.length && times[i + 1]! - times[i]! < SESSION_GAP_MIN * MIN) end = times[++i]!;
    i++;
    for (let t = start + intervalMin * MIN; t <= end; t += intervalMin * MIN) ticks.push(t);
  }
  return ticks;
}

export interface TimerComparison {
  ticks: number;
  generating: number;
  typing: number;
  reading: number;
  /** どれか 1 つでも当たった数(重なりは 1 回と数える) */
  anyBusy: number;
  /** 記録にその出来事があったか(無いと 0 になるのは当然なので、表で区別する) */
  hasGeneration: boolean;
  hasTyping: boolean;
}

const inside = (t: number, xs: Interval[]) => xs.some((x) => x.start <= t && t < x.end);

export function compareTimer(log: StoredLogEntry[], intervalMin = TIMER_INTERVAL_MIN): TimerComparison {
  const sorted = [...log].sort((a, b) => a.at - b.at);
  const gen = pairIntervals(sorted, 'generation_start', 'response_done');
  const typ = pairIntervals(sorted, 'typing_start', 'typing_end');
  const read = readingIntervals(sorted);
  const ticks = timerTicks(sorted, intervalMin);
  let generating = 0;
  let typing = 0;
  let reading = 0;
  let anyBusy = 0;
  for (const t of ticks) {
    const g = inside(t, gen);
    const ty = inside(t, typ);
    const r = inside(t, read);
    if (g) generating++;
    if (ty) typing++;
    if (r) reading++;
    if (g || ty || r) anyBusy++;
  }
  return {
    ticks: ticks.length,
    generating,
    typing,
    reading,
    anyBusy,
    hasGeneration: observations(sorted, 'generation_start').length > 0,
    hasTyping: observations(sorted, 'typing_start').length > 0,
  };
}

// ---- 表にする ----

function table(rows: [string, string][]): string {
  return ['| 項目 | 値 |', '| --- | --- |', ...rows.map(([k, v]) => `| ${k} | ${v} |`)].join('\n');
}

const fmtTime = (ms: number | null) =>
  ms === null ? '-' : new Date(ms).toLocaleString('ja-JP', { hour12: false });
const pct = (n: number, d: number) => (d ? `${n} / ${d}(${Math.round((n / d) * 100)}%)` : `${n} / 0`);
const breakdown = (r: Record<string, number>, keys: string[]) =>
  [...new Set([...keys, ...Object.keys(r)])].map((k) => `${k} ${r[k] ?? 0}`).join('、');

export function report(log: StoredLogEntry[]): string {
  const s = summarize(log);
  const c = compareTimer(log);
  const noRecord = (has: boolean, n: number) => (has ? pct(n, c.ticks) : `${pct(n, c.ticks)}(記録なし)`);
  return [
    `## 記録の集計(${s.entries} 件、${fmtTime(s.from)} 〜 ${fmtTime(s.to)})`,
    '',
    table([
      ['提案の数(prompt_shown)', String(s.promptsShown)],
      ['押したボタン(prompt_action)', breakdown(s.promptActions, ['now', 'next_breakpoint', 'decline'])],
      ['提案までに待った秒数の中央値', s.waitedSecMedian === null ? '-' : `${s.waitedSecMedian} 秒(${s.waitedSecCount} 件)`],
      ['休憩の開始', String(s.breakStarts)],
      ['休憩の完了', String(s.breakCompleted)],
      ['休憩を途中で終えた', String(s.breakEndedEarly)],
      ['休憩の取り消し(break_cancelled)', String(s.breakCancelled)],
      ['「どうだった?」(feedback)', breakdown(s.feedback, ['good', 'ok', 'unneeded'])],
      ['分類の成功率', pct(s.classifyOk, s.classifyCount)],
      ['分類の平均時間', s.classifyAvgMs === null ? '-' : `${Math.round(s.classifyAvgMs)} ms`],
      ['送信の数(prompt_sent)', String(s.promptsSent)],
      ['回答の数(response_done)', String(s.responsesDone)],
    ]),
    '',
    `## ${TIMER_INTERVAL_MIN} 分ごとのタイマーだったら`,
    '',
    `記録が ${SESSION_GAP_MIN} 分以上途切れたところで回を分け、各回の初めから ${TIMER_INTERVAL_MIN} 分ごとに鳴らしたとする。`,
    '',
    table([
      ['鳴った回数', String(c.ticks)],
      ['(a) 生成中', noRecord(c.hasGeneration, c.generating)],
      ['(b) 入力中', noRecord(c.hasTyping, c.typing)],
      ['(c) 回答を読んでいる最中', pct(c.reading, c.ticks)],
      ['どれか(重なりは 1 回)', pct(c.anyBusy, c.ticks)],
    ]),
  ].join('\n');
}

export function parseLog(json: string): StoredLogEntry[] {
  const data: unknown = JSON.parse(json);
  if (!Array.isArray(data)) throw new Error('JSON の一番外が配列ではありません(StoredLogEntry[] を想定)');
  return data.filter(
    (e): e is StoredLogEntry => typeof e === 'object' && e !== null && typeof e.type === 'string' && typeof e.at === 'number',
  );
}

if (import.meta.main) {
  const file = process.argv[2];
  if (!file) {
    console.error('使い方: node scripts/analyze-log.ts <file.json>');
    process.exit(1);
  }
  console.log(report(parseLog(readFileSync(file, 'utf8'))));
}
