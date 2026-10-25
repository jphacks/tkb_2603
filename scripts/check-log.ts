// 実機の確認(issue #16 の 3・4)を、設定画面の「記録を書き出す(JSON)」で確かめる。本文は記録に無いので、件数と時刻だけを出す。
// 使い方: node scripts/check-log.ts <file.json> [同意を取り消した時刻] [計測を止めた時刻]
//   時刻は "2026-10-25 11:05" の形(手元の時刻)。片方だけ確かめるときは、もう片方を "" にする
import { readFileSync } from 'node:fs';
import type { StoredLogEntry } from '../src/shared/settings.ts';
import { parseLog } from './analyze-log.ts';

export interface SiteFlow {
  sent: number;
  /** 続き(continuation)を除いた回答の数。送信と同じになるのが正しい */
  responses: number;
  continuations: number;
  /** 停止ボタンが見えた回数。送信より少なければ、生成中のセレクタが当たっていない回がある */
  generationStarts: number;
  classifyOk: number;
  classifyFailed: number;
}

export function siteFlow(log: StoredLogEntry[]): Record<string, SiteFlow> {
  const out: Record<string, SiteFlow> = {};
  for (const e of log) {
    const r = (out[e.site ?? '不明'] ??= { sent: 0, responses: 0, continuations: 0, generationStarts: 0, classifyOk: 0, classifyFailed: 0 });
    if (e.type === 'classify') e.ok ? r.classifyOk++ : r.classifyFailed++;
    if (e.type !== 'observation') continue;
    if (e.kind === 'prompt_sent') r.sent++;
    else if (e.kind === 'generation_start') r.generationStarts++;
    else if (e.kind === 'response_done') e.detail?.continuation ? r.continuations++ : r.responses++;
  }
  return out;
}

export function entriesAfter(log: StoredLogEntry[], at: number, type?: StoredLogEntry['type']): StoredLogEntry[] {
  return log.filter((e) => e.at > at && (!type || e.type === type));
}

/** "2026-10-25 11:05" を手元の時刻として読む。読めなければ null */
export function parseLocalTime(s: string | undefined): number | null {
  if (!s) return null;
  const t = new Date(s.trim().replace(' ', 'T')).getTime();
  return Number.isFinite(t) ? t : null;
}

const fmt = (ms: number) => new Date(ms).toLocaleString('ja-JP', { hour12: false });

export function checkReport(log: StoredLogEntry[], revokedAt: number | null, stoppedAt: number | null): string {
  const lines: string[] = [];
  const times = log.map((e) => e.at);
  lines.push(`記録 ${log.length} 件${times.length ? `: ${fmt(Math.min(...times))} 〜 ${fmt(Math.max(...times))}` : ''}`, '');
  lines.push('## サイト別の取れ方(4)', '', '| サイト | 送信 | 回答(続きを除く) | 続き | 生成の始まり | 分類の成功 / 失敗 |', '| --- | --- | --- | --- | --- | --- |');
  for (const [site, r] of Object.entries(siteFlow(log))) {
    lines.push(`| ${site} | ${r.sent} | ${r.responses} | ${r.continuations} | ${r.generationStarts} | ${r.classifyOk} / ${r.classifyFailed} |`);
  }
  lines.push('', '送信と回答が同じなら取りこぼし無し。生成の始まりが送信より少ないサイトは、停止ボタンが取れていない回がある。');
  if (revokedAt !== null) {
    const after = entriesAfter(log, revokedAt, 'classify');
    const responses = entriesAfter(log, revokedAt).filter((e) => e.type === 'observation' && e.kind === 'response_done').length;
    lines.push('', `## 同意を取り消した後(${fmt(revokedAt)} より後、3)`, '', `classify ${after.length} 件(0 なら OK)、回答 ${responses} 件(器はたまり続ける)`);
    for (const e of after) lines.push(`- ${fmt(e.at)} ${e.site ?? '不明'}`);
  }
  if (stoppedAt !== null) {
    const after = entriesAfter(log, stoppedAt);
    lines.push('', `## 計測を止めた後(${fmt(stoppedAt)} より後、3)`, '', `${after.length} 件(計測を戻すまでの間に 0 件なら OK)`);
    for (const e of after) lines.push(`- ${fmt(e.at)} ${e.site ?? '不明'} ${e.type}${e.type === 'observation' ? ` ${e.kind}` : ''}`);
  }
  return lines.join('\n');
}

if (import.meta.main) {
  const [file, revoked, stopped] = process.argv.slice(2);
  if (!file) {
    console.error('使い方: node scripts/check-log.ts <file.json> [同意を取り消した時刻] [計測を止めた時刻]');
    process.exit(1);
  }
  console.log(checkReport(parseLog(readFileSync(file, 'utf8')), parseLocalTime(revoked), parseLocalTime(stopped)));
}
