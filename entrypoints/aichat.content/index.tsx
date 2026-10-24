import ReactDOM from 'react-dom/client';
import { Runner } from '../../src/content/runner';
import { SITE_MATCHES } from '../../src/content/sites';
import { App } from '../../src/ui/App';
import '../../src/ui/style.css';

export default defineContentScript({
  matches: SITE_MATCHES,
  cssInjectionMode: 'ui',
  async main(ctx) {
    const runner = new Runner();
    await runner.start();
    const ui = await createShadowRootUi(ctx, {
      name: 'hitoiki-ui',
      position: 'inline',
      anchor: 'body',
      append: 'last',
      // サイトのショートカットに入力が奪われないようにする
      isolateEvents: ['keydown', 'keyup', 'keypress'],
      onMount(container) {
        const root = ReactDOM.createRoot(container);
        root.render(<App runner={runner} />);
        return root;
      },
      onRemove(root) {
        root?.unmount();
      },
    });
    ui.mount();
  },
});
