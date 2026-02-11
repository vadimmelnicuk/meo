import { createApp } from 'vue';
import App from './App.vue';
import 'katex/dist/katex.min.css';
import 'cropperjs/dist/cropper.css';
import './styles.css';
import 'md-editor-v3/lib/style.css';

let optionalDepsLoaded = false;

const loadOptionalDeps = async () => {
  if (optionalDepsLoaded) {
    return;
  }
  optionalDepsLoaded = true;
  const { default: mermaid } = await import('mermaid');
  mermaid.initialize({ startOnLoad: false });
  if (typeof window !== 'undefined') {
    window.mermaid = mermaid;
  }
};

createApp(App).mount('#app');
if (typeof window !== 'undefined') {
  const schedule = () => void loadOptionalDeps();
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(schedule);
  } else {
    window.setTimeout(schedule, 0);
  }
}
