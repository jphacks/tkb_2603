import { useLayoutEffect, useRef, useState } from 'react';

/** 入力欄の伸縮や会話の切替に追従し、ボタンを入力欄の16px上に置く。 */
export function useDockPosition(findComposerContainer: () => HTMLElement | null) {
  const ref = useRef<HTMLDivElement>(null);
  const [bottom, setBottom] = useState(144);
  useLayoutEffect(() => {
    let composer: HTMLElement | null = null;
    let frame = 0;
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const resize = new ResizeObserver(schedule);
    const update = () => {
      frame = 0;
      const next = findComposerContainer();
      if (next !== composer) {
        if (composer) resize.unobserve(composer);
        composer = next;
        if (composer) resize.observe(composer);
      }
      const viewport = window.visualViewport;
      const visibleBottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
      const rect = composer?.getBoundingClientRect();
      const desired = rect && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < visibleBottom
        ? window.innerHeight - Math.min(rect.top, visibleBottom) + 16
        : Math.max(144, window.innerHeight - visibleBottom + 24);
      const maxBottom = window.innerHeight - (ref.current?.getBoundingClientRect().height ?? 0) - (viewport?.offsetTop ?? 0) - 16;
      setBottom(Math.max(16, Math.min(desired, maxBottom)));
    };
    if (ref.current) resize.observe(ref.current);
    const mutations = new MutationObserver(schedule);
    mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    window.visualViewport?.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);
    update();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutations.disconnect();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      window.visualViewport?.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('scroll', schedule);
    };
  }, []);
  return { ref, bottom };
}
