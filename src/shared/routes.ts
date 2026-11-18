// URL rules: no trailing slash anywhere except the root, and `<path>.md` (or
// `/index.md` for the root) is the Markdown version of `<path>`.

export const mdPath = (path: string) => (path === '/' ? '/index.md' : `${path}.md`);

/** /works, /blog and /badges are sections of the top page. */
export const SECTIONS: Record<string, string> = { '/works': 'works', '/blog': 'posts', '/badges': 'badges' };

export type Resolved =
  | { kind: 'page'; path: string; md: boolean }
  | { kind: 'redirect'; location: string };

/** Map a request path to a page path, or to the canonical form when it differs. */
export function resolve(raw: string): Resolved {
  let path = raw.split('?')[0]!.split('#')[0]!;
  try { path = decodeURI(path); } catch { /* keep as is */ }
  path = path.replace(/\/{2,}/g, '/');
  if (path.length > 1 && path.endsWith('/')) {
    return { kind: 'redirect', location: encodeURI(path.replace(/\/+$/, '')) || '/' };
  }
  // sections of the top page that used to be pages of their own
  const section = SECTIONS[path.replace(/\.md$/, '')];
  if (section) return path.endsWith('.md') ? { kind: 'redirect', location: '/index.md' } : { kind: 'redirect', location: `/#${section}` };
  if (path === '/index.md') return { kind: 'page', path: '/', md: true };
  if (path === '/index' || path === '/index.html') return { kind: 'redirect', location: '/' };
  if (path.endsWith('.md')) return { kind: 'page', path: path.slice(0, -3), md: true };
  if (path.endsWith('.html')) return { kind: 'redirect', location: encodeURI(path.slice(0, -5)) };
  return { kind: 'page', path, md: false };
}
