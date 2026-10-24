/** 表示上の%と色の境界を揃える（例: 表示が90%なら黄色）。 */
export function loadPercent(value: number): number {
  return Math.round(Math.max(0, value));
}

/** バーとリングの満杯は100%。数値の表示とは分ける。 */
export function loadFillPercent(value: number): number {
  return Math.min(100, loadPercent(value));
}

export function loadLevel(value: number): 'normal' | 'warning' | 'critical' {
  const percent = loadPercent(value);
  return percent >= 100 ? 'critical' : percent >= 90 ? 'warning' : 'normal';
}
