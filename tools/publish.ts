// Publish the blog to standard.site (AT Protocol) on the account's own PDS.
//   ATP_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx node tools/publish.ts [--dry-run] [--prune]
// Creates the site.standard.publication once, then per post a Bluesky announcement
// (its replies are the comments; --no-bsky skips it) and a site.standard.document
// with bskyPostRef (updated only when it changed). The AT-URIs go to content/standard.json, from
// which the build emits <link rel="site.standard.*"> and /.well-known/site.standard.publication.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { AUTHOR, ROOT, loadPosts, loadStandard } from '../src/build/content.ts';
import { mdToHtml, ORIGIN } from '../src/build/render.ts';

const dry = process.argv.includes('--dry-run');
const prune = process.argv.includes('--prune');
const handle = process.env.ATP_HANDLE ?? AUTHOR.handle;
const password = process.env.ATP_APP_PASSWORD;
const cfgPath = path.join(ROOT, 'content/standard.json');
const cfg = loadStandard();

async function xrpc(base: string, method: string, opts: { token?: string; body?: unknown; query?: Record<string, string>; raw?: { data: Buffer; type: string } } = {}) {
  const url = new URL(`/xrpc/${method}`, base);
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  let body: BodyInit | undefined;
  if (opts.raw) { headers['content-type'] = opts.raw.type; body = opts.raw.data; }
  else if (opts.body !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(opts.body); }
  const r = await fetch(url, { method: body ? 'POST' : 'GET', headers, body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method}: ${r.status} ${JSON.stringify(j)}`);
  return j as any;
}

const text = (md: string) =>
  mdToHtml(md).replace(/<\/(p|li|h\d|blockquote|pre|tr)>/g, '\n').replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n').trim();

const did = (await (await fetch(`https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${handle}`)).json()).did as string;
const doc = await (await fetch(`https://plc.directory/${did}`)).json();
const pds = doc.service.find((s: any) => s.id === '#atproto_pds').serviceEndpoint as string;
console.log(`${handle} = ${did} on ${pds}`);

let token = '';
if (!dry) {
  if (!password) throw new Error('ATP_APP_PASSWORD is required (or use --dry-run)');
  token = (await xrpc(pds, 'com.atproto.server.createSession', { body: { identifier: handle, password } })).accessJwt;
}
const rkeyOf = (uri: string) => uri.split('/').pop()!;

if (!cfg.publication) {
  const icon = dry ? undefined : (await xrpc(pds, 'com.atproto.repo.uploadBlob', { token, raw: { data: readFileSync(path.join(ROOT, 'dist/icon-512.png')), type: 'image/png' } })).blob;
  const record = {
    $type: 'site.standard.publication', url: ORIGIN, name: 'oriom',
    description: 'oriom のポートフォリオと記事。',
    ...(icon ? { icon } : {}), preferences: { showInDiscover: true },
  };
  if (dry) console.log('would create publication', record);
  else {
    cfg.publication = (await xrpc(pds, 'com.atproto.repo.createRecord', { token, body: { repo: did, collection: 'site.standard.publication', record } })).uri;
    console.log('publication', cfg.publication);
  }
}

/** The announcement on Bluesky: its replies become the post's comments (bskyPostRef). */
async function announce(p: (typeof posts)[number]): Promise<{ uri: string; cid: string }> {
  const url = ORIGIN + p.path;
  const text = `${p.title}\n${url}`;
  const enc = new TextEncoder();
  const byteStart = enc.encode(`${p.title}\n`).length;
  const record = {
    $type: 'app.bsky.feed.post', text, langs: ['ja'], createdAt: new Date().toISOString(),
    facets: [{ index: { byteStart, byteEnd: byteStart + enc.encode(url).length }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: url }] }],
    embed: { $type: 'app.bsky.embed.external', external: { uri: url, title: p.title, description: p.description } },
  };
  const r = await xrpc(pds, 'com.atproto.repo.createRecord', { token, body: { repo: did, collection: 'app.bsky.feed.post', record } });
  return { uri: r.uri, cid: r.cid };
}

const noBsky = process.argv.includes('--no-bsky');
const posts = loadPosts();
for (const p of posts) {
  const prevDoc = cfg.documents[p.slug];
  let bsky = prevDoc?.bsky;
  if (!bsky && !noBsky) {
    if (dry) console.log(`would announce ${p.slug} on Bluesky`);
    else {
      bsky = await announce(p);
      console.log(`  announced ${bsky.uri}`);
      // saved at once, so a failure below never announces the same post twice
      cfg.documents[p.slug] = { ...(cfg.documents[p.slug] ?? { uri: '', hash: '' }), bsky };
      writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
    }
  }
  const record = {
    $type: 'site.standard.document',
    site: cfg.publication || 'at://(new publication)',
    title: p.title,
    path: p.path,
    description: p.description || undefined,
    publishedAt: `${p.date}T00:00:00.000+09:00`,
    updatedAt: p.updated ? `${p.updated}T00:00:00.000+09:00` : undefined,
    tags: p.tags.length ? p.tags : undefined,
    textContent: text(p.body),
    bskyPostRef: bsky,
  };
  const hash = createHash('sha256').update(JSON.stringify(record)).digest('hex').slice(0, 16);
  const prev = cfg.documents[p.slug];
  if (prev?.hash === hash) { console.log(`= ${p.slug}`); continue; }
  if (dry) { console.log(`${prev ? '~' : '+'} ${p.slug}`, record); continue; }
  const collection = 'site.standard.document';
  const uri = prev?.uri
    ? (await xrpc(pds, 'com.atproto.repo.putRecord', { token, body: { repo: did, collection, rkey: rkeyOf(prev.uri), record } })).uri
    : (await xrpc(pds, 'com.atproto.repo.createRecord', { token, body: { repo: did, collection, record } })).uri;
  cfg.documents[p.slug] = { uri, hash, ...(bsky ? { bsky } : {}) };
  console.log(`${prev?.uri ? '~' : '+'} ${p.slug} ${uri}`);
}

if (prune) {
  for (const [slug, d] of Object.entries(cfg.documents)) {
    if (posts.some((p) => p.slug === slug)) continue;
    if (!dry && d.uri) await xrpc(pds, 'com.atproto.repo.deleteRecord', { token, body: { repo: did, collection: 'site.standard.document', rkey: rkeyOf(d.uri) } });
    delete cfg.documents[slug];
    console.log(`- ${slug}`);
  }
}

if (!dry) writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
