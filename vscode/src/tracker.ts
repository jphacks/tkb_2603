// VS Code の出来事を core の Observation に変えて、器を動かす。
// vscode モジュールには依存しない(テストで VS Code の API をまねた形を渡せるように)。
import { type GateContext, type PromptAction, applyPromptAction, shouldPrompt } from '../../src/core/gate';
import { breakMinutes, endBreak, load, observe, splitText, startBreak, tick, topContributor, type TickResult } from '../../src/core/model';
import {
  DEFAULT_PARAMS,
  type ElementKey,
  type EngineState,
  type ModelParams,
  type Observation,
  type PromptState,
  type StretchId,
  initialState,
} from '../../src/core/types';
// 休憩の文は Chrome 版と同じものを使う(どちらも純粋な定数・関数)
import { endCopy, promptCopy, STRETCHES } from '../../src/ui/copy';

/** これ以上の文字数が 1 回の変更で入ったら「まとまった挿入」(読む量)とみなす。それ未満は入力 */
export const BULK_MIN_CHARS = 100;
/** 読む量に入れる、1 回の挿入の上限(字)。補完を続けて受け入れても、読む残りが積み上がりすぎないように */
export const BULK_CAP_CHARS = 500;
/**
 * VS Code 用のパラメータ。読む残りの上限を小さくする(core の区切りは「読む残り < 1 分」が条件で、
 * VS Code には送信のように読む残りを 0 に戻す出来事が無いため。止まれば 2 分で区切りになる)
 */
export const VSCODE_PARAMS: ModelParams = { ...DEFAULT_PARAMS, readBacklogCapMin: 2 };
/** この間隔より短いファイルの切替は数えない(行き来の間引き、実時間 ms) */
export const SWITCH_MIN_INTERVAL_MS = 5000;
/** 入力がこの時間止まっていれば区切りとみなす(実時間 ms) */
export const TYPING_QUIET_MS = 3000;
/** 入力の activity を器に渡す間隔(毎打鍵で状態を複製しないように、実時間 ms) */
const ACTIVITY_THROTTLE_MS = 10_000;

/** 器に入れる対象のドキュメント(出力パネルや設定画面などは除く) */
const TRACKED_SCHEMES = new Set(['file', 'untitled', 'vscode-notebook-cell']);

// VS Code の型のうち使う所だけ(テストでまねるため)
export interface UriLike {
  scheme: string;
  toString(): string;
}
export interface TextChangeLike {
  document: { uri: UriLike; isDirty: boolean };
  contentChanges: readonly { text: string }[];
  /** TextDocumentChangeReason: 1 = 元に戻す、2 = やり直し */
  reason?: number;
}

export interface GateInfo {
  /** 実行中のタスクがあるか(tsc --watch のような終わらないタスクは除く) */
  taskRunning: boolean;
  /** VS Code の窓が前にあるか */
  focused: boolean;
  /** デバッグ中か */
  debugging: boolean;
}

/** 今日の積み重ね(UF)がこれ以上なら、おかえりの文を変える(Chrome 版の App.tsx の HIGH_UF と同じ値) */
export const HIGH_UF = 30;

export interface FinishedBreak {
  memo: string;
  plannedMin: number;
  /** 休憩を始めた時に一番効いていた要素 */
  top: ElementKey | null;
  /** 予定の時間まで休んだか(途中で終えたら false) */
  completed: boolean;
}

/** 提案の通知の文(Chrome 版の提案と同じ文) */
export function promptMessage(top: ElementKey | null, uf: number): string {
  const c = promptCopy(top, uf >= HIGH_UF);
  return `${c.title}。${c.body}`;
}

/** 休憩中に出す、ストレッチの文 */
export function stretchMessage(id: StretchId | undefined): string {
  const s = STRETCHES.find((item) => item.id === (id ?? 'reach')) ?? STRETCHES[0];
  return `${s.name}: ${s.line}。そのまま休んでもOK。無理のない範囲で。`;
}

/** おかえりの通知の文(Chrome 版のおかえりの画面と同じ文) */
export function welcomeMessage(f: FinishedBreak, uf: number): string {
  const line = endCopy({ top: f.top, plannedMin: f.plannedMin, highUf: uf >= HIGH_UF });
  return `おかえりなさい。${line}${f.memo ? `\n戻ったらやること: ${f.memo}` : ''}`;
}

export class Tracker {
  state: EngineState;
  params: ModelParams;
  /** 休憩の長さの調整(0.5 短め / 1 標準 / 1.5 長め。Chrome 版の breakScale と同じ) */
  breakScale = 1;
  /** 休憩を始めた時に一番効いていた要素(おかえりの文に使う。保存する) */
  breakTopAtStart: ElementKey | null = null;
  /** ストレッチを選ぶ乱数(テストで差し替える) */
  random: () => number = Math.random;
  /** 最後に出した提案の番号。古い通知のボタンを後から押しても受け付けないため */
  latestPromptId = 0;
  /** 出した提案に、まだ答えていない間の「出す前の提案の状態」。答えが来たらこれに戻してから操作を当てる */
  private pendingPrompt: PromptState | null = null;
  private lastTypingAt = -Infinity;
  private lastActivityPushAt = -Infinity;
  private lastSwitchAt = -Infinity;
  private activeUri: string | null = null;

  constructor(state: EngineState = initialState(), params: ModelParams = VSCODE_PARAMS) {
    this.state = state;
    this.params = params;
  }

  private push(obs: Observation): void {
    this.state = observe(this.state, obs, this.params);
  }

  /** onDidChangeTextDocument */
  onTextChange(e: TextChangeLike, nowMs: number): void {
    if (!TRACKED_SCHEMES.has(e.document.uri.scheme)) return;
    // ディスクから読み直した変更は、変更の後も保存済みのまま(isDirty = false)
    if (!e.document.isDirty) return;
    if (e.reason === 1 || e.reason === 2) return;
    // 保存などで変更済みの印だけが変わった時は、中身の変更が空で届く
    if (e.contentChanges.length === 0) return;
    const inserted = e.contentChanges.reduce((n, c) => n + c.text.length, 0);
    const t = this.state.minute;
    if (inserted >= BULK_MIN_CHARS) {
      const text = e.contentChanges
        .map((c) => c.text)
        .join('\n')
        .slice(0, BULK_CAP_CHARS);
      const { jaChars, enWords } = splitText(text);
      this.push({ kind: 'response_done', t, chars: jaChars, enWords });
      return;
    }
    // 入力(削除も含む)
    this.lastTypingAt = nowMs;
    this.activity(nowMs);
  }

  /** onDidChangeActiveTextEditor */
  onActiveEditor(uri: UriLike | undefined, nowMs: number): void {
    if (!uri || !TRACKED_SCHEMES.has(uri.scheme)) return;
    const key = uri.toString();
    const prev = this.activeUri;
    this.activeUri = key;
    // 最初の 1 つ・同じファイルは切替に数えない
    if (prev === null || prev === key) return;
    if (nowMs - this.lastSwitchAt < SWITCH_MIN_INTERVAL_MS) {
      this.activity(nowMs);
      return;
    }
    this.lastSwitchAt = nowMs;
    this.push({ kind: 'switch', t: this.state.minute, source: 'file' });
  }

  /** onDidEndTerminalShellExecution / onDidEndTaskProcess。失敗(終了コード ≠ 0)だけを確認・検証に数える */
  onCommandEnd(exitCode: number | undefined, nowMs: number): void {
    if (exitCode !== undefined && exitCode !== 0) {
      this.push({ kind: 'verification', t: this.state.minute, count: 1, source: 'exit_code' });
      return;
    }
    // 成功や終了コードが分からないものは、作業していた印だけ
    this.activity(nowMs, true);
  }

  /** コマンドの開始など、作業していた印 */
  activity(nowMs: number, force = false): void {
    if (!force && nowMs - this.lastActivityPushAt < ACTIVITY_THROTTLE_MS) return;
    this.lastActivityPushAt = nowMs;
    this.push({ kind: 'activity', t: this.state.minute });
  }

  /**
   * 計算上の 1 分を進める。休憩の予定時間が過ぎたら休憩を終える。
   * present: 目の前に人がいる 1 分か(開き直した時の取り戻しでは false)
   */
  tick(present = true): TickResult & { finished: FinishedBreak | null } {
    const res = tick(this.state, this.params);
    this.state = res.state;
    const b = this.state.breakState;
    const finished = b && this.state.minute - b.startedAt >= b.plannedMin ? this.finishBreak(true, present) : null;
    return { ...res, finished };
  }

  /**
   * 開き直した時に、閉じていた間の分(計算上の分)を進める。休憩中なら休憩のタイマーが続き、
   * 予定の時間を過ぎていれば終える(作業していないので器は増えない)。上限は 1 日
   */
  catchUp(minutes: number): FinishedBreak | null {
    let finished: FinishedBreak | null = null;
    const n = Math.min(Math.max(0, Math.floor(minutes)), 24 * 60);
    for (let i = 0; i < n; i++) finished = this.tick(false).finished ?? finished;
    return finished;
  }

  /** 休憩の残り(計算上の分)。休憩中でなければ null */
  breakRemainingMin(): number | null {
    const b = this.state.breakState;
    return b ? Math.max(0, b.plannedMin - (this.state.minute - b.startedAt)) : null;
  }

  /**
   * 提案への答え。undefined(押さずに消えた)と「今回は不要」は、出した時の扱いのまま。
   * id が最後に出した提案の番号でなければ(古い通知のボタン)、何もしない
   */
  respondToPrompt(id: number, action: PromptAction | undefined, memo = ''): boolean {
    const previous = this.pendingPrompt;
    if (!previous || id !== this.latestPromptId) return false;
    this.pendingPrompt = null;
    if (!action || action === 'decline' || this.state.breakState) return true;
    this.state = { ...this.state, prompt: previous };
    if (action === 'now') this.beginBreak(breakMinutes(load(this.state), this.breakScale), memo);
    else this.state = applyPromptAction(this.state, 'next_breakpoint');
    return true;
  }

  /** 提案を待たずに休む(Chrome 版の startManualBreak と同じく、器が低くても 80 の時の長さ) */
  startManualBreak(memo: string): boolean {
    if (this.state.breakState) return false;
    this.pendingPrompt = null;
    this.beginBreak(breakMinutes(Math.max(80, load(this.state)), this.breakScale), memo);
    return true;
  }

  /** 「次の区切りで」を選んだ後に、自分で休憩を始める */
  startDeferredBreak(memo = ''): boolean {
    if (!this.state.prompt.waitingForUser || this.state.breakState) return false;
    this.beginBreak(breakMinutes(load(this.state), this.breakScale), memo);
    return true;
  }

  private beginBreak(minutes: number, memo: string): void {
    this.breakTopAtStart = topContributor(this.state);
    const stretches: StretchId[] = ['reach', 'shoulder', 'sway'];
    const stretch = stretches[Math.min(stretches.length - 1, Math.floor(this.random() * stretches.length))]!;
    this.state = startBreak(this.state, minutes, memo, stretch);
  }

  /** 休憩を終える(予定の時間が来た時と、途中で終える時) */
  finishBreak(completed: boolean, present = true): FinishedBreak | null {
    const b = this.state.breakState;
    if (!b) return null;
    const finished: FinishedBreak = { memo: b.memo, plannedMin: b.plannedMin, top: this.breakTopAtStart, completed };
    this.state = endBreak(this.state, present);
    this.pendingPrompt = null;
    return finished;
  }

  load(): number {
    return load(this.state);
  }

  gateContext(nowMs: number, focused = true): GateContext {
    return {
      generating: false,
      typing: nowMs - this.lastTypingAt < TYPING_QUIET_MS,
      composerHasText: false,
      // 裏にある時は出さない(出した時点で間を空けるので、見られないまま次が遠くなる)
      tabVisible: focused,
      secondsSinceResponse: null,
      quietSeconds: 0,
    };
  }

  /**
   * 今、提案を出すか。出すときは文を返す。VS Code の通知は押さずに消えても答えが返らないことがあるので、
   * 出した時点で「今回は不要」と同じく次の提案まで間を空けておき、ボタンの答えが来たら respondToPrompt で上書きする
   */
  checkPrompt(nowMs: number, info: GateInfo): { id: number; message: string } | null {
    if (info.taskRunning || info.debugging) return null;
    if (!shouldPrompt(this.state, this.params, this.gateContext(nowMs, info.focused))) return null;
    const message = promptMessage(topContributor(this.state), this.state.uf);
    this.pendingPrompt = structuredClone(this.state.prompt);
    this.state = applyPromptAction(this.state, 'decline');
    return { id: ++this.latestPromptId, message };
  }
}
