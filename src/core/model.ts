// 負担の計算(計画 v2.2 §2)。
// 2 層の器: 回復できる負担 RF + 回復しにくい負担 UF。要素は等重みで平均し、時間は 5 つのうちの 1 つ。
import {
  ELEMENT_KEYS,
  type ElementValues,
  type EngineState,
  type ModelParams,
  type Observation,
  type StretchId,
  zeroElements,
} from './types';

export function load(state: EngineState): number {
  return state.rf + state.uf;
}

/** 読む残り時間(分)を回答の量から求める。日本語 653 字/分、英語 238 語/分(DR04) */
export function readingMinutes(jaChars: number, enWords: number, p: ModelParams): number {
  return jaChars / p.jaCharsPerMin + enWords / p.enWordsPerMin;
}

/** 回答の文字列を、日本語の字数と英語の語数に分ける(コードも文字として数える) */
export function splitText(text: string): { jaChars: number; enWords: number } {
  const ja = text.match(/[぀-ヿ㐀-鿿ｦ-ﾟ]/g)?.length ?? 0;
  const latin = text.replace(/[぀-ヿ㐀-鿿ｦ-ﾟ]/g, ' ');
  const enWords = latin.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
  return { jaChars: ja, enWords };
}

/** 出来事を状態に取り込む(器はまだ動かさない。動かすのは tick) */
export function observe(state: EngineState, obs: Observation, p: ModelParams): EngineState {
  const s = structuredClone(state);
  switch (obs.kind) {
    case 'prompt_sent':
      // 送った = 前の回答は読み終えた、とみなす(仮置き)
      s.readBacklogMin = 0;
      s.lastActivityAt = obs.t;
      break;
    case 'response_done': {
      const add = readingMinutes(obs.chars, obs.enWords, p);
      s.readBacklogMin = Math.min(p.readBacklogCapMin, s.readBacklogMin + add);
      s.lastActivityAt = obs.t;
      break;
    }
    case 'activity':
      s.lastActivityAt = obs.t;
      break;
    case 'decision':
      for (let i = 0; i < obs.count; i++) s.recent.decision.push(obs.t);
      break;
    case 'verification':
      for (let i = 0; i < obs.count; i++) s.recent.verification.push(obs.t);
      s.lastActivityAt = obs.t;
      break;
    case 'switch':
      s.recent.switching.push(obs.t);
      s.lastActivityAt = obs.t;
      break;
  }
  return s;
}

/** いま作業中か: 直近 activeWindowMin 分に操作があった */
export function isWorking(state: EngineState, p: ModelParams): boolean {
  return state.lastActivityAt !== null && state.minute - state.lastActivityAt < p.activeWindowMin;
}

/** 1 分ぶんの要素の値(各 0〜1) */
export function elementValues(state: EngineState, p: ModelParams): ElementValues {
  const from = state.minute - p.windowMin;
  const countIn = (ts: number[]) => ts.filter((t) => t > from && t <= state.minute).length;
  const sat = (n: number) => Math.min(1, n / p.k);
  return {
    reading: state.readBacklogMin > 0 ? 1 : 0,
    decision: sat(countIn(state.recent.decision)),
    verification: sat(countIn(state.recent.verification)),
    switching: sat(countIn(state.recent.switching)),
    time: 1,
  };
}

/** 5 要素の平均(等重み)。LLM が使えなくても ÷5 のまま(判断が 0 になり、遅めにたまる) */
export function intensity(v: ElementValues): number {
  return ELEMENT_KEYS.reduce((sum, k) => sum + v[k], 0) / ELEMENT_KEYS.length;
}

export interface TickResult {
  state: EngineState;
  /** この 1 分の要素の値(作業していなければ null) */
  values: ElementValues | null;
  /** この 1 分で器に入った量(要素ごと)。合計 = 器の増分 */
  added: ElementValues;
  /** 1 日の区切りで器を 0 に戻したか */
  dayReset: boolean;
}

/** 計算上の 1 分を進める */
export function tick(state: EngineState, p: ModelParams): TickResult {
  const s = structuredClone(state);
  s.minute += 1;
  const added = zeroElements();
  let values: ElementValues | null = null;
  let dayReset = false;

  // 古い件数を捨てる
  const from = s.minute - p.windowMin;
  s.recent.decision = s.recent.decision.filter((t) => t > from);
  s.recent.verification = s.recent.verification.filter((t) => t > from);
  s.recent.switching = s.recent.switching.filter((t) => t > from);

  if (s.breakState) {
    // 休憩タイマー中だけ RF が減る(決定)
    s.rf = Math.max(0, s.rf - p.r);
  } else if (isWorking(s, p)) {
    values = elementValues(s, p);
    const e = intensity(values);
    const gain = p.g * e;
    // 100%を超えても蓄積を続ける。バーの描画だけを100%で止める。
    s.uf += p.rho * gain;
    s.rf += (1 - p.rho) * gain;
    for (const k of Object.keys(values) as (keyof ElementValues)[]) {
      added[k] = (p.g * values[k]) / 5;
      s.contribSinceBreak[k] += added[k];
    }
    s.readBacklogMin = Math.max(0, s.readBacklogMin - 1);
    s.lastWorkAt = s.minute;
  } else if (s.lastWorkAt !== null && s.minute - s.lastWorkAt >= p.dayResetIdleMin) {
    // 3 時間作業が無ければ 1 日の区切りとして 0 に戻す
    if (s.rf > 0 || s.uf > 0) dayReset = true;
    s.rf = 0;
    s.uf = 0;
    s.contribSinceBreak = zeroElements();
    s.lastWorkAt = null;
    s.prompt = { notBefore: 0, declineStreak: 0, waitingForUser: false };
  }

  s.history.push({ t: s.minute, load: load(s) });
  s.history = s.history.filter((h) => h.t > s.minute - 30);
  return { state: s, values, added, dayReset };
}

/** 休憩の長さ: 器 80 なら 10 分 〜 100 なら 15 分(端は厚労省。間は仮置き)。scale は各自の調整(0.5〜1.5) */
export function breakMinutes(loadValue: number, scale = 1): number {
  const base = 10 + (5 * (Math.min(100, Math.max(80, loadValue)) - 80)) / 20;
  return Math.max(1, Math.min(15, Math.round(base * scale)));
}

export function startBreak(state: EngineState, plannedMin: number, memo: string, stretch: StretchId = 'reach'): EngineState {
  const s = structuredClone(state);
  s.breakState = { startedAt: s.minute, plannedMin, memo, stretch };
  s.prompt.waitingForUser = false;
  return s;
}

/** markActive: 休憩から戻った人が目の前にいるとき true(閉じていた間の補正では false) */
export function endBreak(state: EngineState, markActive = true): EngineState {
  const s = structuredClone(state);
  s.breakState = null;
  s.contribSinceBreak = zeroElements();
  s.prompt.declineStreak = 0;
  s.prompt.waitingForUser = false;
  if (markActive) s.lastActivityAt = s.minute;
  return s;
}

/** 自動タイマーで断ったとき: 休憩を取り消す(休憩したことにしない。断った回数は保つ) */
export function cancelBreak(state: EngineState): EngineState {
  const s = structuredClone(state);
  s.breakState = null;
  return s;
}

/** 要素ごとの寄与の割合(理由の表示用)。合計 1。何も無ければ null */
export function contributionShares(state: EngineState): ElementValues | null {
  const total = ELEMENT_KEYS.reduce((sum, k) => sum + state.contribSinceBreak[k], 0);
  if (total <= 0) return null;
  const out = zeroElements();
  for (const k of ELEMENT_KEYS) out[k] = state.contribSinceBreak[k] / total;
  return out;
}

/** 時間以外で一番効いた要素(声かけの文を選ぶため) */
export function topContributor(state: EngineState): keyof ElementValues | null {
  const shares = contributionShares(state);
  if (!shares) return null;
  let best: keyof ElementValues | null = null;
  for (const k of ELEMENT_KEYS) {
    if (k === 'time') continue;
    if (shares[k] > 0 && (best === null || shares[k] > shares[best])) best = k;
  }
  return best ?? 'time';
}
