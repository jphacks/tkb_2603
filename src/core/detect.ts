// 本文を残さずに、貼り付けがエラー文らしいかだけを判定する(確認・検証の手がかり)。

const ERROR_PATTERNS: RegExp[] = [
  /Traceback \(most recent call last\)/,
  /\b[A-Z][A-Za-z]*(Error|Exception)\b[:\s]/,
  /\bat .+:\d+:\d+\)?/, // JS のスタックトレース
  /\bFile ".+", line \d+/, // Python
  /\b(ERROR|FATAL|panic):/,
  /npm ERR!/,
  /error(\[E\d+\])?:/i, // Rust・TypeScript など
  /Uncaught /,
  /Segmentation fault/,
  /\bexit (code|status) [1-9]\d*/i,
];

export function looksLikeError(text: string): boolean {
  if (!text || text.length < 8) return false;
  return ERROR_PATTERNS.some((re) => re.test(text));
}

export function lineCount(text: string): number {
  return text ? text.split(/\r?\n/).length : 0;
}
