import { test } from 'node:test';
import assert from 'node:assert/strict';
import { App } from '../src/server/app.ts';
import { Counter } from '../src/server/counter.ts';
import { ownPosts } from '../src/server/own.ts';
import { AUTHOR_DID, documentRecord, MARKDOWN, ORIGIN, publicationRecord, SCOPE } from '../src/shared/standard.ts';

const ADMIN = '/admin-0123456789abcdef';
const stats = () => ({ at: '2026-01-01T00:00:00Z', views: 0 });
const app = new App(new Counter(), stats, undefined, ADMIN);

test('the admin page is only there over TLS, at its path, never indexed or cached', () => {
  const r = app.respond({ path: ADMIN, protocol: 'http', secure: true });
  assert.equal(r.status, 200);
  assert.match(String(r.body), /oriom\.dev 管理/);
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.match(r.headers['x-robots-tag']!, /noindex/);
  assert.match(r.headers['content-security-policy']!, /script-src 'sha256-/);
  assert.match(r.headers['content-security-policy']!, /frame-ancestors 'none'/);
  // plain HTTP, the text protocols, or another path: as if it did not exist
  assert.equal(app.respond({ path: ADMIN, protocol: 'http' }).status, 404);
  assert.equal(app.respond({ path: ADMIN, protocol: 'http/0.9' }).status, 404);
  assert.equal(app.respond({ path: `${ADMIN}x`, protocol: 'http', secure: true }).status, 404);
  assert.equal(new App(new Counter(), stats).respond({ path: ADMIN, protocol: 'http', secure: true }).status, 404);
  assert.throws(() => new App(new Counter(), stats, undefined, '/admin'), /ADMIN_PATH/);
});

test('the OAuth client metadata and redirect page are public, and name no admin path', () => {
  const m = app.respond({ path: '/oauth/client-metadata.json', protocol: 'http' });
  const j = JSON.parse(String(m.body));
  assert.equal(j.client_id, `${ORIGIN}/oauth/client-metadata.json`);
  assert.deepEqual(j.redirect_uris, [`${ORIGIN}/oauth/callback`]);
  assert.equal(j.scope, SCOPE);
  assert.ok(!String(m.body).includes(ADMIN));
  const cb = app.respond({ path: '/oauth/callback', protocol: 'http', secure: true });
  assert.equal(cb.status, 200);
  assert.ok(!String(cb.body).includes(ADMIN));
  assert.equal(app.respond({ path: '/oauth/callback', protocol: 'http' }).status, 404);
});

test('the publication proof and the refresh request', () => {
  const a = new App(new Counter(), stats);
  assert.equal(a.respond({ path: '/.well-known/site.standard.publication', protocol: 'http' }).status, 404);
  a.publication = 'at://did:plc:x/site.standard.publication/abc';
  assert.equal(a.respond({ path: '/.well-known/site.standard.publication', protocol: 'http' }).body, a.publication);
  let n = 0;
  a.onRefresh = () => { n++; };
  assert.equal(a.respond({ path: '/_/refresh', protocol: 'http' }).status, 202);
  assert.equal(a.respond({ path: '/_/refresh', protocol: 'http' }).status, 429); // at most once in 10 s
  assert.equal(n, 1);
});

test('own posts come from the publication whose URL is this site, with their Markdown', () => {
  const pub = { uri: `at://${AUTHOR_DID}/site.standard.publication/p1`, value: publicationRecord({ name: 'oriom', description: '', url: ORIGIN, showInDiscover: true }) };
  const other = { uri: `at://${AUTHOR_DID}/site.standard.publication/p2`, value: publicationRecord({ name: 'x', description: '', url: 'https://example.com', showInDiscover: false }) };
  const doc = (rkey: string, over: Record<string, unknown> = {}) => ({
    uri: `at://${AUTHOR_DID}/site.standard.document/${rkey}`,
    value: { ...documentRecord({ site: pub.uri, slug: 'hello', title: 'はじめまして', description: '概要', tags: ['a'], body: '# 見出し\n\n**本文**', text: '見出し 本文', publishedAt: '2026-11-18T10:00:00.000Z', bsky: { uri: `at://${AUTHOR_DID}/app.bsky.feed.post/3x`, cid: 'bafy' } }), ...over },
  });
  const own = ownPosts([other, pub], [
    doc('d1'),
    doc('d2', { path: '/blog/hello' }), // the same address twice: the first wins
    doc('d3', { site: other.uri, path: '/blog/other' }), // another publication
    doc('d4', { path: '/../etc' }), // not a post address
    doc('d5', { path: '/blog/no-date', publishedAt: undefined }),
  ]);
  assert.equal(own.publication, pub.uri);
  assert.deepEqual(own.posts.map((p) => p.path), ['/blog/hello']);
  const p = own.posts[0]!;
  assert.equal(p.body, '# 見出し\n\n**本文**');
  assert.equal(p.date, '2026-11-18');
  assert.equal(p.atUri, `at://${AUTHOR_DID}/site.standard.document/d1`);
  assert.equal(p.bsky?.cid, 'bafy');
  assert.equal((doc('x').value.content as { $type: string }).$type, MARKDOWN);
  assert.deepEqual(ownPosts([other], []), { publication: '', posts: [] });
});
