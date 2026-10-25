// パネルの詳細を開いた時に、今日の記録から「30 分ごとのタイマーだったら」を計算する
import { useEffect, useState } from 'react';
import { loadLog } from '../shared/settings';
import { type TodayTimerSummary, todayTimerSummary } from '../shared/timerCompare';

export function useTodayTimerSummary(): TodayTimerSummary | null {
  const [summary, setSummary] = useState<TodayTimerSummary | null>(null);
  useEffect(() => {
    let alive = true;
    // 記録が読めない時(拡張の外・テスト)は出さない
    void (async () => {
      try {
        const s = todayTimerSummary(await loadLog());
        if (alive) setSummary(s);
      } catch {
        // 出さないだけ
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  return summary;
}
