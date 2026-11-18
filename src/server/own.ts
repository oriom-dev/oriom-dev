// The site's own posts: site.standard.document records on the author's PDS (written from
// the admin page), read back at run time. The publication is the one whose URL is this
// site; documents of other publications on the same account are not ours.
import { AUTHOR } from '../build/content.ts';
import { AUTHOR_DID, DOCUMENT, MARKDOWN, ORIGIN, PUBLICATION, postPath, slugOf } from '../shared/standard.ts';
import type { Post } from '../shared/types.ts';
import { listRecords, pdsOf } from './feeds.ts';

export interface Own { publication: string; posts: Post[] }

const day = (s: unknown) => (typeof s === 'string' ? s.slice(0, 10) : '');
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

/** Records -> posts. Exported for the tests (no network). */
export function ownPosts(pubs: { uri: string; value: any }[], docs: { uri: string; value: any }[]): Own {
  const pub = pubs.find((r) => typeof r.value?.url === 'string' && r.value.url.replace(/\/+$/, '') === ORIGIN);
  if (!pub) return { publication: '', posts: [] };
  const posts: Post[] = [];
  const seen = new Set<string>();
  for (const r of docs) {
    const v = r.value;
    const slug = slugOf(v?.path);
    if (v?.site !== pub.uri || !slug || seen.has(slug) || typeof v.title !== 'string' || !day(v.publishedAt)) continue;
    seen.add(slug);
    const md = v.content?.$type === MARKDOWN && typeof v.content.text === 'string' ? v.content.text : str(v.textContent, 200_000);
    posts.push({
      slug,
      path: postPath(slug),
      title: v.title.slice(0, 300),
      date: day(v.publishedAt),
      ...(day(v.updatedAt) ? { updated: day(v.updatedAt) } : {}),
      description: str(v.description, 3000),
      tags: Array.isArray(v.tags) ? v.tags.filter((t: unknown) => typeof t === 'string').slice(0, 20) : [],
      body: md.slice(0, 200_000),
      author: AUTHOR,
      atUri: r.uri,
      ...(typeof v.bskyPostRef?.uri === 'string' && v.bskyPostRef.uri.startsWith('at://') ? { bsky: { uri: v.bskyPostRef.uri, cid: String(v.bskyPostRef.cid ?? '') } } : {}),
    });
  }
  return { publication: pub.uri, posts: posts.sort((a, b) => b.date.localeCompare(a.date)) };
}

export async function fetchOwn(): Promise<Own> {
  const pds = await pdsOf(AUTHOR_DID);
  const [pubs, docs] = await Promise.all([listRecords(pds, AUTHOR_DID, PUBLICATION), listRecords(pds, AUTHOR_DID, DOCUMENT)]);
  return ownPosts(pubs, docs);
}
