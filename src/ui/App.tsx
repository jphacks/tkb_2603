// ChatGPT の画面に重ねる UI(がくさんの UI 案の 4 状態: 通常 / 休憩の提案 / 詳細 / 休憩中)。
// 見た目はがくさんの案に合わせて後で整える。今は計算が動いている様子が分かることを優先する。
import { useEffect, useMemo, useState } from 'react';
import { contributionShares } from '../core/model';
import { ELEMENT_KEYS, ELEMENT_LABELS } from '../core/types';
import type { Runner, UiSnapshot } from '../content/runner';
import { AUTO_TIMER_COPY, endCopy, promptCopy, SNOOZE_COPY, STRETCHES, type StretchId } from './copy';
import { Pictogram } from './Pictogram';

const HIGH_UF = 30;

export function App({ runner }: { runner: Runner }) {
  const [snap, setSnap] = useState<UiSnapshot | null>(null);
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => runner.subscribe(setSnap), [runner]);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, [toast]);
  if (!snap || !snap.settings.enabled) return null;

  const onBreak = !!snap.state.breakState;
  return (
    <div className="hi-root">
      {snap.settings.speed > 1 && <div className="hi-demo">デモ: {snap.settings.speed}倍速</div>}
      {snap.prompt && !onBreak && (
        <PromptCard
          snap={snap}
          onAction={(a, memo) => {
            runner.respondToPrompt(a, memo);
            if (a !== 'now') setToast(SNOOZE_COPY[a]);
          }}
        />
      )}
      {onBreak && <BreakOverlay snap={snap} runner={runner} />}
      {snap.finishedBreak && !onBreak && <Welcome snap={snap} runner={runner} />}
      {open && !onBreak && <Detail snap={snap} runner={runner} onClose={() => setOpen(false)} />}
      {toast && <div className="hi-toast">{toast}</div>}
      <button className="hi-pill" onClick={() => setOpen(!open)} title="ひといき: 作業の負担の目安">
        <Ring value={snap.load} threshold={snap.settings.threshold} />
        <span className="hi-pill-label">ひといき</span>
        <span className="hi-pill-value">{Math.round(snap.load)}%</span>
      </button>
    </div>
  );
}

function Ring({ value, threshold }: { value: number; threshold: number }) {
  const r = 9;
  const c = 2 * Math.PI * r;
  const color = value >= threshold ? 'var(--hi-warn)' : 'var(--hi-accent)';
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r={r} fill="none" stroke="var(--hi-track)" strokeWidth="3" />
      <circle
        cx="12"
        cy="12"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="3"
        strokeDasharray={`${(c * Math.min(100, value)) / 100} ${c}`}
        transform="rotate(-90 12 12)"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PromptCard({ snap, onAction }: { snap: UiSnapshot; onAction: (a: 'now' | 'next_breakpoint' | 'decline', memo: string) => void }) {
  const p = snap.prompt!;
  const copy = promptCopy(p.top, p.minutes, snap.state.uf >= HIGH_UF);
  const [memo, setMemo] = useState('');
  return (
    <div className="hi-card hi-prompt" role="dialog" aria-label="休憩の提案">
      <div className="hi-title">{copy.title}</div>
      <div className="hi-body">{copy.body}</div>
      <Reason snap={snap} />
      <input
        className="hi-input"
        placeholder="戻ったら何をする?(1 行・任意)"
        value={memo}
        maxLength={80}
        onChange={(e) => setMemo(e.target.value)}
      />
      <div className="hi-actions">
        <button className="hi-btn hi-primary" onClick={() => onAction('now', memo)}>
          今 {p.minutes} 分休む
        </button>
        <button className="hi-btn" onClick={() => onAction('next_breakpoint', '')}>
          次の区切りで
        </button>
        <button className="hi-btn hi-ghost" onClick={() => onAction('decline', '')}>
          今回は不要
        </button>
      </div>
    </div>
  );
}

/** どの要素がどれだけためたか(足し算なので、そのまま理由になる) */
function Reason({ snap }: { snap: UiSnapshot }) {
  const shares = contributionShares(snap.state);
  if (!shares) return null;
  const top = ELEMENT_KEYS.filter((k) => shares[k] > 0)
    .sort((a, b) => shares[b] - shares[a])
    .slice(0, 3);
  return (
    <div className="hi-reason">
      {top.map((k) => (
        <span key={k} className="hi-chip">
          {ELEMENT_LABELS[k]} {Math.round(shares[k] * 100)}%
        </span>
      ))}
    </div>
  );
}

function Detail({ snap, runner, onClose }: { snap: UiSnapshot; runner: Runner; onClose: () => void }) {
  const shares = contributionShares(snap.state);
  const llmOff = !snap.state.llmAvailable;
  const [showDiag, setShowDiag] = useState(false);
  return (
    <div className="hi-card hi-detail" role="dialog" aria-label="作業モニター">
      <div className="hi-head">
        <span className="hi-title">作業モニター</span>
        <button className="hi-x" onClick={onClose} aria-label="閉じる">
          ×
        </button>
      </div>
      <div className="hi-gauge">
        <div className="hi-gauge-bar">
          <div className="hi-gauge-uf" style={{ width: `${snap.state.uf}%` }} />
          <div className="hi-gauge-rf" style={{ width: `${Math.min(100 - snap.state.uf, snap.state.rf)}%` }} />
          <div className="hi-gauge-th" style={{ left: `${snap.settings.threshold}%` }} />
        </div>
        <div className="hi-gauge-legend">
          <span>器 {Math.round(snap.load)}%</span>
          <span className="hi-muted">うち今日残る分 {Math.round(snap.state.uf)}%</span>
        </div>
      </div>
      <div className="hi-subtitle">休憩してから、何がためたか</div>
      {ELEMENT_KEYS.map((k) => (
        <div key={k} className="hi-row">
          <span className="hi-row-label">{ELEMENT_LABELS[k]}</span>
          <div className="hi-bar">
            <div className="hi-bar-fill" style={{ width: `${Math.round((shares?.[k] ?? 0) * 100)}%` }} />
          </div>
          <span className="hi-row-value">
            {k === 'decision' && llmOff ? '未計測' : `${Math.round((shares?.[k] ?? 0) * 100)}%`}
          </span>
        </div>
      ))}
      <div className="hi-subtitle">直近 30 分の推移</div>
      <Sparkline history={snap.state.history} threshold={snap.settings.threshold} />
      <div className="hi-note">ログから推定した作業の負担の目安です。値は仮置きです。疲れの感じ方は、自分の感覚も大切に。</div>
      <div className="hi-actions">
        <button className="hi-btn hi-primary" onClick={() => { runner.startManualBreak(''); onClose(); }}>
          休憩する
        </button>
        <button className="hi-btn" onClick={() => runner.openOptions()}>
          設定
        </button>
        <button className="hi-btn hi-ghost" onClick={() => setShowDiag(!showDiag)}>
          診断
        </button>
      </div>
      {showDiag && <Diagnostics snap={snap} />}
    </div>
  );
}

function Diagnostics({ snap }: { snap: UiSnapshot }) {
  const d = snap.diagnostics;
  return (
    <div className="hi-diag">
      <div>回答の数: {d.assistantCount} / 送信の数: {d.userCount} / 生成中: {d.generating ? 'はい' : 'いいえ'}</div>
      <div>最後の回答: {d.lastResponseChars} 文字「{d.lastResponseHead}…」(終わりの検出: {d.completionMethod ?? 'まだ'})</div>
      <div>読む残り: {snap.state.readBacklogMin.toFixed(1)} 分 / 計算上の時刻: {snap.state.minute} 分</div>
      {Object.entries(d.matched).map(([g, sel]) => (
        <div key={g}>
          {g}: <code>{sel ?? '見つからない'}</code>
        </div>
      ))}
      <div>
        分類:{' '}
        {snap.lastClassify
          ? snap.lastClassify.ok
            ? `OK(${snap.lastClassify.model}、${snap.lastClassify.ms}ms)`
            : `失敗(${snap.lastClassify.error})`
          : snap.settings.hasApiKey
            ? 'まだ'
            : 'API キー未設定'}
      </div>
    </div>
  );
}

function Sparkline({ history, threshold }: { history: { t: number; load: number }[]; threshold: number }) {
  const w = 260;
  const h = 56;
  const points = useMemo(() => {
    if (history.length < 2) return '';
    const t0 = history[0]!.t;
    const t1 = history[history.length - 1]!.t;
    const span = Math.max(1, t1 - t0);
    return history.map((p) => `${((p.t - t0) / span) * w},${h - (p.load / 100) * h}`).join(' ');
  }, [history]);
  return (
    <svg className="hi-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-label="器の推移">
      <line x1="0" x2={w} y1={h - (threshold / 100) * h} y2={h - (threshold / 100) * h} className="hi-spark-th" />
      {points && <polyline points={points} className="hi-spark-line" />}
    </svg>
  );
}

function BreakOverlay({ snap, runner }: { snap: UiSnapshot; runner: Runner }) {
  const b = snap.state.breakState!;
  const [stretch, setStretch] = useState<StretchId>('reach');
  const [memo, setMemo] = useState(b.memo);
  const elapsedMin = snap.state.minute - b.startedAt;
  const remaining = Math.max(0, b.plannedMin - elapsedMin);
  const progress = Math.min(1, elapsedMin / Math.max(1, b.plannedMin));
  const line = STRETCHES.find((s) => s.id === stretch)?.line ?? '';
  const autoMode = snap.settings.mode === 'auto_timer' && snap.prompt;
  const r = 64;
  const c = 2 * Math.PI * r;
  return (
    <div className="hi-overlay">
      <div className="hi-card hi-break" role="dialog" aria-label="休憩中">
        <div className="hi-head">
          <span className="hi-title">休憩中</span>
          <button className="hi-x" onClick={() => runner.askEndBreak()} aria-label="休憩を終える">
            ×
          </button>
        </div>
        {autoMode && <div className="hi-body">{AUTO_TIMER_COPY(b.plannedMin)}</div>}
        <div className="hi-timer">
          <svg width="160" height="160" viewBox="0 0 160 160" aria-hidden>
            <circle cx="80" cy="80" r={r} fill="none" stroke="var(--hi-track)" strokeWidth="8" />
            <circle
              cx="80"
              cy="80"
              r={r}
              fill="none"
              stroke="var(--hi-accent)"
              strokeWidth="8"
              strokeDasharray={`${c * (1 - progress)} ${c}`}
              transform="rotate(-90 80 80)"
              strokeLinecap="round"
            />
          </svg>
          <div className="hi-timer-inner">
            <Pictogram kind={stretch} />
            <div className="hi-timer-text">残り {remaining} 分</div>
          </div>
        </div>
        <div className="hi-tabs">
          {STRETCHES.map((s) => (
            <button key={s.id} className={`hi-tab ${s.id === stretch ? 'hi-on' : ''}`} onClick={() => setStretch(s.id)}>
              {s.name}
            </button>
          ))}
        </div>
        <div className="hi-body">{line}</div>
        <div className="hi-muted">そのまま休んでもOK!無理のない範囲でね😊</div>
        <input
          className="hi-input"
          placeholder="戻ったら何をする?(1 行・任意)"
          value={memo}
          maxLength={80}
          onChange={(e) => {
            setMemo(e.target.value);
            runner.setMemo(e.target.value);
          }}
        />
        {autoMode ? (
          <div className="hi-actions">
            <button className="hi-btn" onClick={() => runner.respondToPrompt('next_breakpoint')}>
              次の区切りで
            </button>
            <button className="hi-btn hi-ghost" onClick={() => runner.respondToPrompt('decline')}>
              今回は不要
            </button>
          </div>
        ) : (
          <div className="hi-actions">
            <button className="hi-btn" onClick={() => runner.askEndBreak()}>
              休憩を終える
            </button>
          </div>
        )}
        {snap.confirmEndBreak && (
          <div className="hi-confirm">
            <div>休憩を終える?</div>
            <div className="hi-actions">
              <button className="hi-btn hi-primary" onClick={() => { runner.setMemo(memo); runner.endBreakEarly(); }}>
                終える
              </button>
              <button className="hi-btn" onClick={() => runner.cancelEndBreak()}>
                続ける
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Welcome({ snap, runner }: { snap: UiSnapshot; runner: Runner }) {
  const f = snap.finishedBreak!;
  const line = endCopy({ top: f.top, plannedMin: f.plannedMin, highUf: snap.state.uf >= HIGH_UF, seed: snap.state.minute });
  return (
    <div className="hi-card hi-welcome" role="dialog" aria-label="おかえり">
      {f.memo && (
        <div className="hi-memo">
          <div className="hi-muted">戻ったらやること</div>
          <div className="hi-memo-text">📝 {f.memo}</div>
        </div>
      )}
      <div className="hi-title">{line}</div>
      <div className="hi-body">この休憩どうだった?👀</div>
      <div className="hi-actions">
        <button className="hi-btn" onClick={() => runner.sendFeedback('good')}>😆 よかった!</button>
        <button className="hi-btn" onClick={() => runner.sendFeedback('ok')}>🙂 ふつう</button>
        <button className="hi-btn" onClick={() => runner.sendFeedback('unneeded')}>😐 いらなかった</button>
      </div>
      <button className="hi-link" onClick={() => runner.dismissFinished()}>
        閉じる
      </button>
    </div>
  );
}
