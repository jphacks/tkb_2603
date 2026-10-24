import type { StretchId } from './copy';

// 参照画像の丸みのある人物を、拡大しても崩れないSVGとCSSで表現する。
export function Pictogram({ kind }: { kind: StretchId }) {
  return (
    <svg className={`hi-picto hi-picto-${kind}`} width="100" height="136" viewBox="0 0 100 136" aria-hidden="true">
      <ellipse cx="50" cy="130" rx="27" ry="3" fill="currentColor" opacity=".10" />
      <g className="hi-picto-body" fill="none" stroke="currentColor" strokeWidth="13" strokeLinecap="round" strokeLinejoin="round">
        <path d="M49 69v28m0-2-15 28m15-28 15 28" />
        <path className="hi-arm-l" d={kind === 'shoulder' ? 'M48 57C33 54 24 61 17 72' : 'M48 57C33 54 29 38 26 23'} />
        <path className="hi-arm-r" d={kind === 'shoulder' ? 'M52 57C67 54 76 61 83 72' : 'M52 57C67 54 73 38 74 23'} />
        <circle cx="50" cy="35" r="19" fill="currentColor" stroke="none" />
        <g className="hi-picto-face" stroke="var(--hi-bg)" strokeWidth="2" fill="none"><path d="M39 32q3-4 6 0m10 0q3-4 6 0M44 42q6 7 12 0" /></g>
      </g>
      <g className="hi-picto-rays" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity=".45"><path d="m16 17-5-7m73 7 5-7M50 9V2" /></g>
    </svg>
  );
}
