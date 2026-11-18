// Bluesky replies as comments. A post links to its announcement on Bluesky through
// site.standard.document#bskyPostRef; the thread is read from the public AppView.
// Replies the author hid (threadgate) and replies labelled to be hidden are left out.
import type { Comment } from '../shared/types.ts';

const APPVIEW = 'https://public.api.bsky.app';
const MAX_SHOWN = 150;
const HIDE = new Set(['!hide', '!takedown', 'porn', 'sexual', 'nudity', 'graphic-media', 'gore', 'spam']);

interface Facet { index: { byteStart: number; byteEnd: number }; features: { $type: string; uri?: string; did?: string }[] }

/** Text with link and mention facets turned into segments (offsets are UTF-8 bytes). */
export function segments(text: string, facets: Facet[] = []): Comment['text'] {
  const bytes = new TextEncoder().encode(text);
  const dec = new TextDecoder();
  const out: Comment['text'] = [];
  let at = 0;
  for (const f of [...facets].sort((a, b) => a.index.byteStart - b.index.byteStart)) {
    const { byteStart: s, byteEnd: e } = f.index;
    if (s < at || e > bytes.length || s >= e) continue;
    const feat = f.features.find((x) => x.$type === 'app.bsky.richtext.facet#link' || x.$type === 'app.bsky.richtext.facet#mention');
    if (!feat) continue;
    const href = feat.uri ?? `https://bsky.app/profile/${feat.did}`;
    if (!/^https?:\/\//.test(href)) continue;
    if (s > at) out.push({ t: dec.decode(bytes.slice(at, s)) });
    out.push({ t: dec.decode(bytes.slice(s, e)), href });
    at = e;
  }
  if (at < bytes.length) out.push({ t: dec.decode(bytes.slice(at)) });
  return out;
}

const webUrl = (uri: string) => {
  const [, , did, , rkey] = uri.split('/');
  return `https://bsky.app/profile/${did}/post/${rkey}`;
};

function convert(node: any, hidden: Set<string>, depth: number): Comment[] {
  const out: Comment[] = [];
  for (const r of node.replies ?? []) {
    if (r.$type !== 'app.bsky.feed.defs#threadViewPost' || !r.post) continue;
    const p = r.post;
    if (hidden.has(p.uri)) continue;
    if ((p.labels ?? []).some((l: any) => HIDE.has(l.val)) || (p.author?.labels ?? []).some((l: any) => HIDE.has(l.val))) continue;
    out.push({
      uri: p.uri,
      url: webUrl(p.uri),
      author: { did: p.author.did, handle: p.author.handle, name: p.author.displayName || p.author.handle },
      at: String(p.record?.createdAt ?? p.indexedAt ?? '').slice(0, 10),
      text: segments(String(p.record?.text ?? ''), p.record?.facets),
      likes: p.likeCount ?? 0,
      replies: depth < 4 ? convert(r, hidden, depth + 1) : [],
    });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

export async function fetchComments(uri: string): Promise<{ url: string; count: number; comments: Comment[] }> {
  const r = await fetch(`${APPVIEW}/xrpc/app.bsky.feed.getPostThread?uri=${encodeURIComponent(uri)}&depth=6&parentHeight=0`, {
    headers: { 'user-agent': 'oriom.dev-comments (+https://oriom.dev)' }, signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`getPostThread ${r.status}`);
  const j = await r.json();
  const hidden = new Set<string>(j.thread?.post?.threadgate?.record?.hiddenReplies ?? j.threadgate?.record?.hiddenReplies ?? []);
  const all = convert(j.thread, hidden, 0);
  const count = (cs: Comment[]): number => cs.reduce((n, c) => n + 1 + count(c.replies), 0);
  // keep the page well under 512 KB: the rest is one click away on Bluesky
  let budget = MAX_SHOWN;
  const cap = (cs: Comment[]): Comment[] => cs.filter(() => budget-- > 0).map((c) => ({ ...c, replies: cap(c.replies) }));
  return { url: webUrl(uri), count: count(all), comments: cap(all) };
}
