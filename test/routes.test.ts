import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, mdPath } from '../src/shared/routes.ts';
import { maybe3d, pickVariant } from '../src/shared/variant.ts';

test('trailing slashes redirect, .md selects markdown', () => {
  assert.deepEqual(resolve('/'), { kind: 'page', path: '/', md: false });
  assert.deepEqual(resolve('/index.md'), { kind: 'page', path: '/', md: true });
  assert.deepEqual(resolve('/works/'), { kind: 'redirect', location: '/works' });
  assert.deepEqual(resolve('/works//mosimo/'), { kind: 'redirect', location: '/works/mosimo' });
  assert.deepEqual(resolve('/works/mosimo.md?x=1'), { kind: 'page', path: '/works/mosimo', md: true });
  assert.deepEqual(resolve('/index.html'), { kind: 'redirect', location: '/' });
  assert.equal(mdPath('/'), '/index.md');
  assert.equal(mdPath('/blog'), '/blog.md');
});

test('3D is only offered to browsers that might run it', () => {
  const chrome = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Safari/537.36';
  assert.equal(maybe3d(chrome, null), true);
  assert.equal(maybe3d(chrome, 'a=b; no3d=1'), false);
  assert.equal(maybe3d(chrome, 'no3d=0'), true);
  assert.equal(maybe3d('curl/8.9.1', null), false);
  assert.equal(maybe3d('Lynx/2.9.0 libwww-FM/2.14', null), false);
  assert.equal(maybe3d(undefined, null), false);
  for (let i = 0; i < 100; i++) assert.notEqual(pickVariant(false), '3d');
  assert.equal(pickVariant(false, '3d'), '3d');
  assert.equal(pickVariant(true, null, () => 0.99), '3d');
});
