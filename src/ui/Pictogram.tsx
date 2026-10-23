// 円のタイマーの中で動くストレッチのピクトグラム(脇役。がくさんの案で後から差し替える)。
import type { StretchId } from './copy';

export function Pictogram({ kind }: { kind: StretchId }) {
  return (
    <svg className={`hi-picto hi-picto-${kind}`} width="64" height="64" viewBox="0 0 64 64" aria-hidden>
      <g className="hi-picto-body" stroke="currentColor" strokeWidth="5" strokeLinecap="round" fill="none">
        <circle cx="32" cy="12" r="6" fill="currentColor" stroke="none" />
        <line x1="32" y1="20" x2="32" y2="42" />
        <line x1="32" y1="42" x2="24" y2="58" />
        <line x1="32" y1="42" x2="40" y2="58" />
        <g className="hi-picto-arms">
          <line x1="32" y1="24" x2="20" y2="8" className="hi-arm-l" />
          <line x1="32" y1="24" x2="44" y2="8" className="hi-arm-r" />
        </g>
      </g>
    </svg>
  );
}
