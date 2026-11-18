// Posts from followed standard.site publications (e.g. Team JISAKU). A document is
// shown only when its publication proves the site link: the publication's URL serves
// its AT-URI at /.well-known/site.standard.publication (https://standard.site/docs/verification).
import type { Post } from '../shared/types.ts';

const UA = 'oriom.dev-feeds (+https://oriom.dev)';
const get = async (url: string) => {
  const r = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15_000), redirect: 'follow' });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r;
};

export async function resolve(handle: string): Promise<{ did: string; pds: string }> {
  const did = (await (await get(`https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`)).json()).did as string;
  const doc = await (await get(did.startsWith('did:web:') ? `https://${did.slice(8)}/.well-known/did.json` : `https://plc.directory/${did}`)).json();
  const pds = doc.service?.find((s: any) => s.id.endsWith('#atproto_pds'))?.serviceEndpoint;
  if (!pds) throw new Error(`${handle}: no PDS`);
  return { did, pds };
}

async function listRecords(pds: string, did: string, collection: string): Promise<{ uri: string; value: any }[]> {
  const out: { uri: string; value: any }[] = [];
  let cursor = '';
  for (let page = 0; page < 20; page++) {
    const j = await (await get(`${pds}/xrpc/com.atproto.repo.listRecords?repo=${did}&collection=${collection}&limit=100${cursor && `&cursor=${encodeURIComponent(cursor)}`}`)).json();
    out.push(...j.records);
    if (!j.cursor || j.records.length < 100) break;
    cursor = j.cursor;
  }
  return out;
}

/** https://example.com/blog -> https://example.com/.well-known/site.standard.publication/blog */
export function wellKnownUrl(publicationUrl: string): string {
  const u = new URL(publicationUrl.replace(/\/+$/, ''));
  const rest = u.pathname.replace(/^\/+/, '');
  return `${u.origin}/.well-known/site.standard.publication${rest ? `/${rest}` : ''}`;
}

export async function verified(pubUri: string, url: string): Promise<boolean> {
  try {
    return (await (await get(wellKnownUrl(url))).text()).trim() === pubUri;
  } catch {
    return false;
  }
}

const day = (s: string) => (s ?? '').slice(0, 10);

export async function fetchFollowed(follow: { handle: string; name: string }[]): Promise<Post[]> {
  const posts: Post[] = [];
  for (const f of follow) {
    try {
      const { did, pds } = await resolve(f.handle);
      const pubs = new Map<string, string>(); // at-uri -> url, verified only
      for (const r of await listRecords(pds, did, 'site.standard.publication')) {
        if (typeof r.value?.url === 'string' && (await verified(r.uri, r.value.url))) pubs.set(r.uri, r.value.url.replace(/\/+$/, ''));
      }
      for (const r of await listRecords(pds, did, 'site.standard.document')) {
        const v = r.value;
        const base = pubs.get(v?.site);
        if (!base || typeof v.title !== 'string' || !v.publishedAt) continue;
        const rkey = r.uri.split('/').pop()!;
        if (!/^[a-zA-Z0-9._:~-]{1,512}$/.test(rkey)) continue;
        posts.push({
          slug: `${f.handle}/${rkey}`,
          path: `/blog/${f.handle}/${rkey}`,
          title: v.title.slice(0, 500),
          date: day(v.publishedAt),
          updated: v.updatedAt ? day(v.updatedAt) : undefined,
          description: String(v.description ?? '').slice(0, 3000),
          tags: Array.isArray(v.tags) ? v.tags.filter((t: unknown) => typeof t === 'string').slice(0, 20) : [],
          body: String(v.textContent ?? v.description ?? ''),
          author: { name: f.name, handle: f.handle, did },
          external: base + (typeof v.path === 'string' ? (v.path.startsWith('/') ? v.path : `/${v.path}`) : ''),
          atUri: r.uri,
          bsky: typeof v.bskyPostRef?.uri === 'string' && v.bskyPostRef.uri.startsWith('at://') ? { uri: v.bskyPostRef.uri, cid: String(v.bskyPostRef.cid ?? '') } : undefined,
        });
      }
    } catch (e) {
      console.warn(`feeds: ${f.handle}: ${(e as Error).message}`);
    }
  }
  return posts;
}
