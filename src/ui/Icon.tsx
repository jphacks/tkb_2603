// 小さな操作アイコンは同じ線幅とサイズで揃える。
export function Icon({ name }: { name: 'leaf' | 'clock' | 'close' | 'chevron' | 'settings' }) {
  return (
    <svg className={`hi-icon hi-icon-${name}`} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {name === 'leaf' && <><path d="M20 4C10 2 4 7 5 14c.7 4.6 6.2 6.4 10 3 3-2.8 4.3-7.7 5-13Z" /><path d="m9 16 6-8M12 18l-1-5" /></>}
      {name === 'clock' && <><circle cx="12" cy="12" r="9" /><path d="M12 6v6l4 2" /></>}
      {name === 'close' && <path d="m7 7 10 10M17 7 7 17" />}
      {name === 'chevron' && <path d="m9 6 6 6-6 6" />}
      {name === 'settings' && <><path d="m10 3-.6 2.2-2 .9-2-.6-2 3.5 1.5 1.6v2.3L3.4 16l2 3.5 2.1-.6 2 .9.5 2.2h4l.6-2.2 2-.9 2 .6 2-3.5-1.5-1.6v-2.3l1.5-1.6-2-3.5-2.1.6-2-.9L14 3Z" /><circle cx="12" cy="12.5" r="3" /></>}
    </svg>
  );
}
