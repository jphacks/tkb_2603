import type { StretchId } from './copy';

// 脚は地面に固定し、上半身・肩・肘をそれぞれの関節で動かす。
// 右腕は左腕を反転。位置決めとCSSの回転を別のgにして回転軸を保つ。
function Arm({ right = false }: { right?: boolean }) {
  return (
    <g transform={right ? 'translate(62 62) scale(-1 1)' : 'translate(38 62)'}>
      <g className={`hi-picto-arm hi-arm-${right ? 'r' : 'l'}`}>
        <path d="M0 0l-9 22" />
        <g transform="translate(-9 22)">
          <g className="hi-picto-forearm"><path d="M0 0l-2 20" /></g>
        </g>
      </g>
    </g>
  );
}

// 手を肩に添えたまま、肘の位置を楕円上で動かす。右側は左右反転。
function ShoulderArm({ right = false }: { right?: boolean }) {
  return (
    <g transform={right ? 'translate(64 66) scale(-1 1)' : 'translate(36 66)'}>
      <g className="hi-picto-shoulder-guide" strokeWidth="1.5" opacity=".4">
        <path d="M-20 22C-39 22-47-5-34-21m-1 7 1-7-7 2" />
      </g>
      <path className="hi-picto-shoulder-arm" d="M0 0L-22 11L4-11" strokeWidth="8" />
      <circle className="hi-picto-hand" cx="4" cy="-11" r="4.5" fill="currentColor" stroke="none" />
    </g>
  );
}

export function Pictogram({ kind }: { kind: StretchId }) {
  return (
    <svg className={`hi-picto hi-picto-${kind}`} width="128" height="136" viewBox="0 0 128 136" aria-hidden="true">
      {/* 腕を横に開く途中も切れないよう、左右に14pxずつ余白を取る。 */}
      <g transform="translate(14 0)">
        <ellipse cx="50" cy="130" rx="27" ry="3" fill="currentColor" opacity=".10" />
        <g fill="none" stroke="currentColor" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round">
          <path className="hi-picto-legs" d="M50 94l-15 29m15-29 15 29" />
          <g className="hi-picto-body">
            <path d="M50 53v42" />
            <g className="hi-picto-shoulders">
              <path d={kind === 'shoulder' ? 'M36 66h28' : 'M38 62h24'} />
              {kind === 'shoulder' ? <><ShoulderArm /><ShoulderArm right /></> : <><Arm /><Arm right /></>}
            </g>
            <circle cx="50" cy="35" r="18" fill="currentColor" stroke="none" />
            <g className="hi-picto-face" stroke="var(--hi-bg)" strokeWidth="2" fill="none"><path d="M39 32q3-4 6 0m10 0q3-4 6 0M44 42q6 7 12 0" /></g>
          </g>
        </g>
        {kind === 'reach' && <g className="hi-picto-rays" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="m16 17-5-7m73 7 5-7M50 9V2" /></g>}
      </g>
    </svg>
  );
}
