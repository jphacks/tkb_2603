// VS Code 拡張の入り口。出来事を Tracker に渡し、1 分ごとに器を進め、区切りで休憩を提案する。
import * as vscode from 'vscode';
import { contributionShares } from '../../src/core/model';
import { DEFAULT_PARAMS, ELEMENT_KEYS, ELEMENT_LABELS, type EngineState, type ModelParams } from '../../src/core/types';
import { Tracker, VSCODE_PARAMS } from './tracker';

const STATE_KEY = 'hitoiki:engine';
/** 区切りかどうかを見る間隔(実時間 ms) */
const GATE_INTERVAL_MS = 1000;

interface SavedEngine {
  state: EngineState;
  /** 保存した実時刻(ms)。開き直した時に、閉じていた間の分を進めるため */
  realSavedAt: number;
}

interface Settings {
  speed: number;
  threshold: number;
}

function readSettings(): Settings {
  const c = vscode.workspace.getConfiguration('hitoiki');
  return {
    speed: Math.max(1, c.get<number>('speed', 1)),
    threshold: c.get<number>('threshold', VSCODE_PARAMS.threshold),
  };
}

function paramsFrom(s: Settings): ModelParams {
  return { ...VSCODE_PARAMS, threshold: s.threshold };
}

/** 動作確認(結合テスト)から中を見るための口 */
export interface HitoikiApi {
  tracker: Tracker;
  promptsShown(): number;
}

export function activate(context: vscode.ExtensionContext): HitoikiApi {
  let settings = readSettings();
  const saved = context.globalState.get<SavedEngine>(STATE_KEY);
  const tracker = new Tracker(saved?.state, paramsFrom(settings));
  let promptsShown = 0;

  // 閉じていた間の分を進める(作業していないので、器は増えない。長ければ 1 日の区切りで 0 に戻る)
  if (saved) {
    const away = Math.floor((Date.now() - saved.realSavedAt) / 60_000);
    for (let i = 0; i < Math.min(away, DEFAULT_PARAMS.dayResetIdleMin + 1); i++) tracker.tick();
  }

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.name = 'ひといき';
  status.show();
  context.subscriptions.push(status);

  const render = () => {
    status.text = `ひといき ${Math.round(tracker.load())}%`;
    const shares = contributionShares(tracker.state);
    const lines = ELEMENT_KEYS.map((k) => {
      if (k === 'decision') return `${ELEMENT_LABELS[k]}: 未計測`;
      return `${ELEMENT_LABELS[k]}: ${shares ? Math.round(shares[k] * 100) : 0}%`;
    });
    status.tooltip = `負担の目安(しきい値 ${settings.threshold})\n今日の内訳\n${lines.join('\n')}`;
  };

  const save = () =>
    context.globalState.update(STATE_KEY, { state: tracker.state, realSavedAt: Date.now() } satisfies SavedEngine);

  let tickTimer: ReturnType<typeof setInterval> | undefined;
  const restartTick = () => {
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = setInterval(() => {
      tracker.tick();
      render();
      void save();
    }, 60_000 / settings.speed);
  };
  restartTick();

  const gateTimer = setInterval(() => {
    const message = tracker.checkPrompt(Date.now(), {
      // tsc --watch・npm run dev のような終わらないタスクは、実行中に数えない
      taskRunning: vscode.tasks.taskExecutions.some((e) => !e.task.isBackground),
      focused: vscode.window.state.focused,
      debugging: vscode.debug.activeDebugSession !== undefined,
    });
    if (!message) return;
    promptsShown++;
    render();
    void save();
    void vscode.window.showInformationMessage(message);
  }, GATE_INTERVAL_MS);

  context.subscriptions.push(
    { dispose: () => (clearInterval(gateTimer), tickTimer && clearInterval(tickTimer)) },
    vscode.workspace.onDidChangeTextDocument((e) => tracker.onTextChange(e, Date.now())),
    vscode.window.onDidChangeActiveTextEditor((ed) => tracker.onActiveEditor(ed?.document.uri, Date.now())),
    // ターミナルはシェル統合が有効な時だけ届く
    vscode.window.onDidStartTerminalShellExecution(() => tracker.activity(Date.now(), true)),
    vscode.window.onDidEndTerminalShellExecution((e) => tracker.onCommandEnd(e.exitCode, Date.now())),
    vscode.tasks.onDidStartTaskProcess(() => tracker.activity(Date.now(), true)),
    vscode.tasks.onDidEndTaskProcess((e) => tracker.onCommandEnd(e.exitCode, Date.now())),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('hitoiki')) return;
      const prevSpeed = settings.speed;
      settings = readSettings();
      tracker.params = paramsFrom(settings);
      if (settings.speed !== prevSpeed) restartTick();
      render();
    }),
    vscode.commands.registerCommand('hitoiki.reset', async () => {
      const fresh = new Tracker(undefined, tracker.params);
      tracker.state = fresh.state;
      render();
      await save();
    }),
  );

  // 起動時に開いていたファイルを、切替の起点にする
  tracker.onActiveEditor(vscode.window.activeTextEditor?.document.uri, Date.now());
  render();
  return { tracker, promptsShown: () => promptsShown };
}

export function deactivate(): void {
  // 保存は 1 分ごとに行っている(globalState は deactivate の中で待てない場合がある)
}
