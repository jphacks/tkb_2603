// ひといきの計算で使う型。計算は純粋な関数で行い、ブラウザの API には依存しない。

/** 計算に入れる 5 つの要素(等重みで平均する) */
export const ELEMENT_KEYS = ['reading', 'decision', 'verification', 'switching', 'time'] as const;
export type ElementKey = (typeof ELEMENT_KEYS)[number];

export const ELEMENT_LABELS: Record<ElementKey, string> = {
  reading: '読む量',
  decision: '判断',
  verification: '確認・検証',
  switching: '切替',
  time: '作業時間',
};

/** 1 分ごとの要素の値(各 0〜1) */
export type ElementValues = Record<ElementKey, number>;

/** 計算のパラメータ。値はすべて仮置き(計画 v2.2 §2-4) */
export interface ModelParams {
  /** たまる速さ(器の点 / 分。e=1 のとき) */
  g: number;
  /** 回復しにくい負担の割合 */
  rho: number;
  /** 休憩タイマー中に RF が減る速さ(点 / 分) */
  r: number;
  /** 通知のしきい値 */
  threshold: number;
  /** 件数の頭打ち(直近 windowMin 分で k 件で 1.0) */
  k: number;
  /** 件数を数える窓(分) */
  windowMin: number;
  /** 読む速さ(日本語、字 / 分) */
  jaCharsPerMin: number;
  /** 読む速さ(英語、語 / 分) */
  enWordsPerMin: number;
  /** 読む残り時間の上限(分) */
  readBacklogCapMin: number;
  /** 作業中とみなす、最後の操作からの時間(分) */
  activeWindowMin: number;
  /** この時間作業が無ければ 1 日の区切りとして器を 0 に戻す(分) */
  dayResetIdleMin: number;
}

export const DEFAULT_PARAMS: ModelParams = {
  g: 3.2,
  rho: 0.02,
  r: 8,
  threshold: 80,
  k: 2,
  windowMin: 5,
  jaCharsPerMin: 653,
  enWordsPerMin: 238,
  readBacklogCapMin: 15,
  activeWindowMin: 5,
  dayResetIdleMin: 180,
};

/** 観察した出来事。時刻 t は「計算上の分」(デモの倍速でも同じ単位) */
export type Observation =
  | { kind: 'prompt_sent'; t: number; chars: number }
  | { kind: 'response_done'; t: number; chars: number; enWords: number }
  | { kind: 'activity'; t: number }
  | { kind: 'decision'; t: number; count: number }
  | { kind: 'verification'; t: number; count: number; source: 'paste' | 'llm' }
  | { kind: 'switch'; t: number; source: 'url' | 'llm' };

export type StretchId = 'reach' | 'shoulder' | 'sway';

export interface BreakState {
  /** 休憩を始めた時刻(計算上の分) */
  startedAt: number;
  /** 予定の長さ(分) */
  plannedMin: number;
  /** 戻ったら何をするかのメモ */
  memo: string;
  /** この休憩で案内する運動。旧データには無い */
  stretch?: StretchId;
}

export interface PromptState {
  /** 「区切りがついたら休む」を選び、開始ボタンを押すのを待っている。旧データは未設定 */
  waitingForUser?: boolean;
  /** これより前は提案しない(計算上の分) */
  notBefore: number;
  /** 「今回は不要」を続けて押した回数 */
  declineStreak: number;
}

/** 器の状態。chrome.storage にそのまま保存できる形にする */
export interface EngineState {
  /** 計算上の現在時刻(分) */
  minute: number;
  rf: number;
  uf: number;
  /** 読む残り時間(分) */
  readBacklogMin: number;
  /** 最後に操作があった時刻(分)。null は記録なし */
  lastActivityAt: number | null;
  /** 最後に作業中だった時刻(分) */
  lastWorkAt: number | null;
  /** 直近の件数(時刻つき) */
  recent: { decision: number[]; verification: number[]; switching: number[] };
  /** 最後の休憩からの、要素ごとの寄与の合計(理由の表示用) */
  contribSinceBreak: ElementValues;
  /** 直近 30 分の器の推移 */
  history: { t: number; load: number }[];
  breakState: BreakState | null;
  prompt: PromptState;
  /** LLM の分類が使えているか(使えない間、判断は「未計測」) */
  llmAvailable: boolean;
}

export function zeroElements(): ElementValues {
  return { reading: 0, decision: 0, verification: 0, switching: 0, time: 0 };
}

export function initialState(): EngineState {
  return {
    minute: 0,
    rf: 0,
    uf: 0,
    readBacklogMin: 0,
    lastActivityAt: null,
    lastWorkAt: null,
    recent: { decision: [], verification: [], switching: [] },
    contribSinceBreak: zeroElements(),
    history: [],
    breakState: null,
    prompt: { notBefore: 0, declineStreak: 0, waitingForUser: false },
    llmAvailable: false,
  };
}
