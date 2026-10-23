// 設定と保存。chrome.storage.local に置く(自分たちだけで使う前提。キーは暗号化されない)。
import type { NotifyMode } from '../core/gate';
import { DEFAULT_PARAMS, type EngineState, initialState, type ModelParams, type Observation } from '../core/types';

export const CLASSIFIER_MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5(既定)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5(安い・速い)' },
] as const;

export interface Settings {
  /** 計測するか(止めると何も記録しない) */
  enabled: boolean;
  mode: NotifyMode;
  /** 通知のしきい値 */
  threshold: number;
  /** 休憩の長さの調整(0.5 短め / 1 標準 / 1.5 長め) */
  breakScale: number;
  /** たまる速さ(g)。各自で調整できる */
  g: number;
  /** デモ用: 時計を何倍速にするか(1 = 等倍) */
  speed: number;
  /** LLM で会話を分類するか(本文を API に送る) */
  llmEnabled: boolean;
  apiKey: string;
  model: string;
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  mode: 'notify',
  threshold: DEFAULT_PARAMS.threshold,
  breakScale: 1,
  g: DEFAULT_PARAMS.g,
  speed: 1,
  llmEnabled: true,
  apiKey: '',
  model: 'claude-opus-5-5',
};

export function paramsFrom(settings: Settings): ModelParams {
  return { ...DEFAULT_PARAMS, threshold: settings.threshold, g: settings.g };
}

const KEYS = {
  settings: 'hitoiki:settings',
  engine: 'hitoiki:engine',
  log: 'hitoiki:log',
  inbox: 'hitoiki:inbox',
} as const;

export async function loadSettings(): Promise<Settings> {
  const got = await browser.storage.local.get(KEYS.settings);
  return { ...DEFAULT_SETTINGS, ...(got[KEYS.settings] as Partial<Settings> | undefined) };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await loadSettings()), ...patch };
  await browser.storage.local.set({ [KEYS.settings]: next });
  return next;
}

export function onSettingsChanged(cb: (s: Settings) => void): () => void {
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    const change = changes[KEYS.settings];
    if (area === 'local' && change) {
      cb({ ...DEFAULT_SETTINGS, ...(change.newValue as Partial<Settings>) });
    }
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}

/** 器の状態。realSavedAt は保存した実時刻(ms)。開き直した時に経過時間を計算するため */
export interface SavedEngine {
  state: EngineState;
  realSavedAt: number;
  /** 保存したタブ(ほかのタブの保存を取り込むため) */
  writer?: string;
  /** 最後に計算上の 1 分を進めた実時刻(ms)。タブをまたいで壁時計で進めるため */
  lastTickReal?: number;
}

export async function loadEngine(): Promise<SavedEngine> {
  const got = await browser.storage.local.get(KEYS.engine);
  const saved = got[KEYS.engine] as SavedEngine | undefined;
  return saved ?? { state: initialState(), realSavedAt: Date.now() };
}

export async function saveEngine(state: EngineState, writer?: string, lastTickReal?: number): Promise<void> {
  await browser.storage.local.set({
    [KEYS.engine]: { state, realSavedAt: Date.now(), writer, lastTickReal } satisfies SavedEngine,
  });
}

/** ほかのタブが器を保存したら知らせる。「記録を消す」で消えたら null */
export function onEngineChanged(cb: (saved: SavedEngine | null) => void): () => void {
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    const change = changes[KEYS.engine];
    if (area !== 'local' || !change) return;
    cb((change.newValue as SavedEngine | undefined) ?? null);
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}

// ---- 裏のタブで起きた出来事の受け箱 ----
// 器を進めるのは表のタブだけ。裏のタブは出来事をここに足し、表のタブが取り込む(上書きで消えないように)

export async function appendInbox(obs: Observation): Promise<void> {
  const got = await browser.storage.local.get(KEYS.inbox);
  const box = (got[KEYS.inbox] as Observation[] | undefined) ?? [];
  box.push(obs);
  await browser.storage.local.set({ [KEYS.inbox]: box.slice(-500) });
}

export async function drainInbox(): Promise<Observation[]> {
  const got = await browser.storage.local.get(KEYS.inbox);
  const box = (got[KEYS.inbox] as Observation[] | undefined) ?? [];
  if (box.length) await browser.storage.local.remove(KEYS.inbox);
  return box;
}

export function onInboxChanged(cb: () => void): () => void {
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === 'local' && changes[KEYS.inbox]?.newValue) cb();
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}

// ---- 評価のログ(本文は残さない。件数・時刻・操作だけ) ----

export type LogEntry =
  | { type: 'prompt_shown'; load: number; mode: NotifyMode; waitedSec: number | null; top: string | null }
  | { type: 'prompt_action'; action: 'now' | 'next_breakpoint' | 'decline' }
  | { type: 'break_start'; plannedMin: number; hasMemo: boolean; load: number }
  | { type: 'break_end'; plannedMin: number; actualMin: number; completed: boolean }
  | { type: 'break_cancelled' }
  | { type: 'feedback'; value: 'good' | 'ok' | 'unneeded' }
  | { type: 'observation'; kind: string; detail?: Record<string, number | string | boolean> }
  | { type: 'classify'; ok: boolean; model: string; ms: number; error?: string }
  | { type: 'day_reset' };

export type StoredLogEntry = LogEntry & { at: number; minute: number };

const LOG_CAP = 5000;

export async function appendLog(entry: LogEntry, minute: number): Promise<void> {
  const got = await browser.storage.local.get(KEYS.log);
  const log = (got[KEYS.log] as StoredLogEntry[] | undefined) ?? [];
  log.push({ ...entry, at: Date.now(), minute });
  await browser.storage.local.set({ [KEYS.log]: log.slice(-LOG_CAP) });
}

export async function loadLog(): Promise<StoredLogEntry[]> {
  const got = await browser.storage.local.get(KEYS.log);
  return (got[KEYS.log] as StoredLogEntry[] | undefined) ?? [];
}

/** 計測データを消す(設定は残す) */
export async function clearData(): Promise<void> {
  await browser.storage.local.remove([KEYS.engine, KEYS.log, KEYS.inbox]);
}
