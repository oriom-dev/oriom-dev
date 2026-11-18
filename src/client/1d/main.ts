import { boot } from '../common.ts';
import { drawThread } from './thread.ts';

boot();

let raf = 0;
const redraw = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(drawThread); };
drawThread();
// Any layout change (resize, live numbers, fonts) re-routes the thread.
new ResizeObserver(redraw).observe(document.body);
