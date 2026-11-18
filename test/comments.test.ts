import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mdToHtml, postMarkdown } from '../src/build/render.ts';
import { segments } from '../src/server/comments.ts';
import type { Comment, Post } from '../src/shared/types.ts';

test('facets use UTF-8 byte offsets', () => {
  const text = '日本語 https://exa… と @alice';
  const enc = new TextEncoder();
  const s = enc.encode('日本語 ').length, e = s + enc.encode('https://exa…').length;
  const m = enc.encode('日本語 https://exa… と ').length;
  const out = segments(text, [
    { index: { byteStart: s, byteEnd: e }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://example.com/long' }] },
    { index: { byteStart: m, byteEnd: m + 6 }, features: [{ $type: 'app.bsky.richtext.facet#mention', did: 'did:plc:alice' }] },
    { index: { byteStart: 0, byteEnd: 3 }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'javascript:alert(1)' }] },
  ]);
  assert.deepEqual(out, [
    { t: '日本語 ' }, { t: 'https://exa…', href: 'https://example.com/long' }, { t: ' と ' },
    { t: '@alice', href: 'https://bsky.app/profile/did:plc:alice' },
  ]);
});

const post: Post = {
  slug: 'p', path: '/blog/p', title: 'T', date: '2026-11-18', description: '', tags: [], body: 'Body',
  author: { name: 'oriom', did: 'did:plc:p4woeawvwwrsvh6mjp5cvufu' }, bsky: { uri: 'at://did:plc:me/app.bsky.feed.post/abc', cid: 'x' },
};
const c = (name: string, text: string, replies: Comment[] = []): Comment => ({
  uri: 'at://x', url: 'https://bsky.app/profile/x/post/y', author: { did: 'did:plc:x', handle: 'x.test', name },
  at: '2026-11-19', text: [{ t: text }], likes: 0, replies,
});

test('comments render escaped, nested, in both Markdown and HTML', () => {
  const cs = { url: 'https://bsky.app/profile/did:plc:me/post/abc', count: 2, comments: [c('<b>Eve</b>', '<script>x</script> *hi*', [c('Bob', 'reply')])] };
  const html = mdToHtml(postMarkdown(post, 'html', cs));
  assert.match(html, /<h2>コメント 2<\/h2>/);
  assert.doesNotMatch(html, /<script>|<b>Eve/);
  assert.match(html, /&lt;script&gt;x&lt;\/script&gt; \*hi\*/);
  assert.match(html, /<ul><li>.*<ul><li>.*Bob/s);
  assert.match(html, /href="https:\/\/bsky\.app\/profile\/did:plc:me\/post\/abc">Bluesky で返信する</);
  const md = postMarkdown(post, 'md', cs);
  assert.match(md, /^- \*\*\\<b\\>Eve\\<\/b\\>\*\*（@x\.test/m);
  assert.match(md, /^  - \*\*Bob\*\*/m);
});

test('a post announced on Bluesky but without replies yet links to the thread', () => {
  assert.match(postMarkdown(post, 'md'), /## コメント 0\n\n\[Bluesky で返信する\]\(https:\/\/bsky\.app\/profile\/did:plc:me\/post\/abc\)/);
});
