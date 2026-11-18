// The admin page: sign in with the author's Bluesky account (AT Protocol OAuth, scoped to
// the standard.site collections, Bluesky posts and images), then write the
// site.standard.publication and site.standard.document records and the announcements.
// Every write is shown first as the exact requests that will be sent; nothing is written
// before "この内容で書き込む".
import { atprotoLoopbackClientMetadata, BrowserOAuthClient, type OAuthSession } from '@atproto/oauth-client-browser';
import { marked } from 'marked';
import {
  announcementRecord, AUTHOR_DID, BSKY_POST, DOCUMENT, documentRecord, MARKDOWN, ORIGIN, PUBLICATION,
  postPath, publicationRecord, SCOPE, slugOf,
} from '../../shared/standard.ts';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const h = (tag: string, attrs: Record<string, string> = {}, ...kids: (Node | string)[]) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...kids);
  return el;
};
const main = $('main');
const show = (...nodes: Node[]) => main.replaceChildren(...nodes);
const note = (text: string, cls = '') => h('p', { class: `note ${cls}` }, text);

// ------------------------------------------------------------------ sign-in
const LOOPBACK = ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
const SITE = LOOPBACK ? `http://127.0.0.1:${location.port}` : ORIGIN;
const REDIRECT = `${SITE}/oauth/callback` as `https://${string}`;
const RETURN = 'oriom.admin'; // the admin path, for /oauth/callback to send the browser back

// on 127.0.0.1 (npm run dev) a loopback client needs no metadata document; on the site,
// the client is https://oriom.dev/oauth/client-metadata.json
const oauth: Promise<BrowserOAuthClient> = LOOPBACK
  ? Promise.resolve(new BrowserOAuthClient({
    handleResolver: 'https://public.api.bsky.app',
    clientMetadata: atprotoLoopbackClientMetadata(`http://localhost?redirect_uri=${encodeURIComponent(REDIRECT)}&scope=${encodeURIComponent(SCOPE)}`),
  }))
  : BrowserOAuthClient.load({ clientId: `${ORIGIN}/oauth/client-metadata.json`, handleResolver: 'https://public.api.bsky.app' });

let session: OAuthSession;

async function start(): Promise<void> {
  if (LOOPBACK && new URLSearchParams(location.search).has('demo')) { session = demoSession(); return home(); }
  const c = await oauth;
  try {
    const params = new URLSearchParams(location.hash.slice(1));
    const result = params.has('state') && (params.has('code') || params.has('error'))
      ? await c.initCallback(params, REDIRECT)
      : await c.initRestore();
    if (result) {
      session = result.session;
      if (session.did !== AUTHOR_DID) {
        await c.revoke(session.did).catch(() => {});
        show(note('このアカウントでは管理できません。サイトの持ち主のアカウントでサインインしてください。', 'error'), signInForm());
        return;
      }
      return home();
    }
  } catch (e) {
    show(note(`サインインできませんでした：${(e as Error).message}`, 'error'), signInForm());
    return;
  }
  show(signInForm());
}

function signInForm(): Node {
  const input = h('input', { name: 'handle', value: 'oriom.dev', autocomplete: 'username', required: '' }) as HTMLInputElement;
  const form = h('form', { class: 'signin' }, h('label', {}, 'ハンドル', input), h('button', {}, 'Bluesky でサインイン'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    sessionStorage.setItem(RETURN, location.pathname);
    try { await (await oauth).signInRedirect(input.value.trim(), { scope: SCOPE }); }
    catch (err) { form.after(note(`サインインを始められませんでした：${(err as Error).message}`, 'error')); }
  });
  return form;
}

// ------------------------------------------------------------------ XRPC
async function xrpc(method: string, opts: { query?: Record<string, string>; json?: unknown; blob?: Blob } = {}): Promise<any> {
  const q = new URLSearchParams(opts.query ?? {}).toString();
  const init: RequestInit = opts.json !== undefined
    ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(opts.json) }
    : opts.blob ? { method: 'POST', headers: { 'content-type': opts.blob.type }, body: opts.blob } : { method: 'GET' };
  const r = await session.fetchHandler(`/xrpc/${method}${q ? `?${q}` : ''}`, init);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method}: ${r.status} ${j.error ?? ''} ${j.message ?? ''}`.trim());
  return j;
}

interface Rec { uri: string; cid: string; value: any }
async function list(collection: string): Promise<Rec[]> {
  const out: Rec[] = [];
  let cursor = '';
  for (let i = 0; i < 20; i++) {
    const j = await xrpc('com.atproto.repo.listRecords', { query: { repo: session.did, collection, limit: '100', ...(cursor ? { cursor } : {}) } });
    out.push(...j.records);
    if (!j.cursor || j.records.length < 100) break;
    cursor = j.cursor;
  }
  return out;
}
const rkeyOf = (uri: string) => uri.split('/').pop()!;

/** A record key from the clock (TID): known before the write, so the confirmation shows it. */
function tid(): string {
  const S32 = '234567abcdefghijklmnopqrstuvwxyz';
  let n = (BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000))) << 10n | BigInt(Math.floor(Math.random() * 1024));
  let s = '';
  for (let i = 0; i < 13; i++) { s = S32[Number(n & 31n)]! + s; n >>= 5n; }
  return s;
}

// ------------------------------------------------------------------ writes, confirmed
/** One request. `fill` puts in what only an earlier step's result knows (a blob, a cid). */
interface Step { title: string; method: string; json?: any; blob?: Blob; blobFrom?: string; fill?: (prev: any[]) => void }

/** Shows the exact requests; writes them in order only after the button. */
function confirm(steps: Step[], back: () => void, done: (results: any[]) => void): void {
  const list = h('ol', { class: 'steps' });
  for (const s of steps) {
    const body = s.blob
      ? `${s.blob.type}、${s.blob.size} バイト（${s.blobFrom}）`
      : JSON.stringify(s.json, null, 2);
    list.append(h('li', {}, h('h3', {}, s.title), h('p', { class: 'method' }, `POST /xrpc/${s.method}`), h('pre', {}, body)));
  }
  const go = h('button', { class: 'primary' }, 'この内容で書き込む') as HTMLButtonElement;
  const cancel = h('button', {}, '戻る');
  const status = h('p', { class: 'note' });
  cancel.addEventListener('click', back);
  go.addEventListener('click', async () => {
    go.disabled = true; cancel.remove();
    const results: any[] = [];
    try {
      for (const [i, s] of steps.entries()) {
        status.textContent = `${i + 1} / ${steps.length}：${s.title}`;
        s.fill?.(results);
        results.push(await xrpc(s.method, s.blob ? { blob: s.blob } : { json: s.json }));
      }
      await fetch('/_/refresh', { cache: 'no-store' }).catch(() => {});
      done(results);
    } catch (e) {
      status.className = 'note error';
      status.textContent = `${results.length + 1} 番目で失敗しました（それより前は書き込み済み）：${(e as Error).message}`;
      const again = h('button', {}, '一覧に戻る');
      again.addEventListener('click', () => void home());
      status.after(again);
    }
  });
  show(h('h2', {}, '書き込む内容'), note('次の要求を、この順に PDS へ送ります。「（…の結果）」の部分だけ、前の要求の結果で埋めます。'), list, h('p', { class: 'actions' }, go, cancel), status);
}

// ------------------------------------------------------------------ home
let pub: Rec | undefined;
let docs: Rec[] = [];

async function home(message?: string): Promise<void> {
  show(note('読み込み中…'));
  try {
    pub = (await list(PUBLICATION)).find((r) => String(r.value?.url ?? '').replace(/\/+$/, '') === ORIGIN);
    docs = pub ? (await list(DOCUMENT)).filter((r) => r.value?.site === pub!.uri) : [];
  } catch (e) {
    show(note(`読み込めませんでした：${(e as Error).message}`, 'error'));
    return;
  }
  docs.sort((a, b) => String(b.value.publishedAt).localeCompare(String(a.value.publishedAt)));
  const out: Node[] = [];
  if (message) out.push(note(message, 'ok'));
  if (!pub) {
    out.push(h('h2', {}, '出版物'), note('standard.site の出版物（site.standard.publication）がまだありません。記事を書く前に作ります。'), publicationForm());
    return show(...out);
  }
  const edit = h('button', {}, '出版物を編集');
  edit.addEventListener('click', () => show(h('h2', {}, '出版物を編集'), publicationForm(pub)));
  out.push(h('section', { class: 'pub' }, h('h2', {}, String(pub.value.name)), h('p', { class: 'uri' }, pub.uri), edit));

  const add = h('button', { class: 'primary' }, '新しい記事');
  add.addEventListener('click', () => documentForm());
  const rows = docs.map((d) => {
    const e = h('button', {}, '編集'), x = h('button', {}, '削除');
    e.addEventListener('click', () => documentForm(d));
    x.addEventListener('click', () => removeDocument(d));
    const slug = slugOf(d.value.path);
    return h('li', {},
      h('span', { class: 'date' }, String(d.value.publishedAt).slice(0, 10)),
      slug ? h('a', { href: postPath(slug), target: '_blank', rel: 'noopener' }, String(d.value.title)) : h('span', {}, String(d.value.title)),
      h('span', { class: 'row-actions' }, e, x));
  });
  out.push(h('section', {}, h('h2', {}, '記事'), add, rows.length ? h('ul', { class: 'docs' }, ...rows) : note('まだ記事はありません。')));
  show(...out);
}

// ------------------------------------------------------------------ publication
function field(label: string, input: HTMLElement, hint = ''): HTMLElement {
  return h('label', {}, h('span', {}, label), input, ...(hint ? [h('small', {}, hint)] : []));
}

function publicationForm(existing?: Rec): Node {
  const v = existing?.value ?? {};
  const name = h('input', { required: '', value: v.name ?? '' }) as HTMLInputElement;
  const desc = h('textarea', { rows: '3' }, v.description ?? '') as HTMLTextAreaElement;
  const url = h('input', { value: ORIGIN, readonly: '' }) as HTMLInputElement;
  const icon = h('input', { type: 'checkbox' }) as HTMLInputElement;
  icon.checked = !existing || !!v.icon;
  const discover = h('input', { type: 'checkbox' }) as HTMLInputElement;
  discover.checked = v.preferences?.showInDiscover ?? true;
  const form = h('form', {},
    field('名前', name),
    field('説明', desc),
    field('URL', url, 'サイトはこの URL の出版物を自分のものとして扱います'),
    h('label', { class: 'check' }, icon, existing?.value.icon ? 'アイコンを付ける（今のアイコンのまま）' : 'サイトのアイコン（/icon-512.png）を付ける'),
    h('label', { class: 'check' }, discover, 'standard.site の発見フィードに表示する'),
    h('p', { class: 'actions' }, h('button', { class: 'primary' }, '内容を確認'), ...(existing ? [backButton()] : [])));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const steps: Step[] = [];
    const keepIcon = existing && v.icon && icon.checked;
    let iconBlob: Blob | undefined;
    if (icon.checked && !keepIcon) iconBlob = await (await fetch('/icon-512.png')).blob();
    const record = publicationRecord({
      name: name.value.trim(), description: desc.value.trim(), url: ORIGIN, showInDiscover: discover.checked,
      icon: keepIcon ? v.icon : iconBlob ? '（1 の結果の blob）' : undefined,
    });
    if (iconBlob) steps.push({ title: 'アイコンをアップロード', method: 'com.atproto.repo.uploadBlob', blob: new Blob([iconBlob], { type: 'image/png' }), blobFrom: '/icon-512.png' });
    const rkey = existing ? rkeyOf(existing.uri) : tid();
    const json: any = existing
      ? { repo: session.did, collection: PUBLICATION, rkey, record, swapRecord: existing.cid }
      : { repo: session.did, collection: PUBLICATION, rkey, record };
    steps.push({
      title: existing ? '出版物を更新' : '出版物を作成',
      method: existing ? 'com.atproto.repo.putRecord' : 'com.atproto.repo.createRecord',
      json,
      fill: iconBlob ? (prev) => { json.record.icon = prev[0].blob; } : undefined,
    });
    confirm(steps, () => show(h('h2', {}, existing ? '出版物を編集' : '出版物'), form), () => void home(existing ? '出版物を更新しました。' : '出版物を作りました。'));
  });
  return form;
}

function backButton(): HTMLElement {
  const b = h('button', { type: 'button' }, '一覧に戻る');
  b.addEventListener('click', () => void home());
  return b;
}

// ------------------------------------------------------------------ documents
/** Markdown -> plain text, for textContent (search, readers that do not render Markdown). */
function plain(md: string): string {
  const html = (marked.parse(md, { async: false }) as string).replace(/<\/(p|li|h\d|blockquote|pre|tr)>/g, '$&\n');
  return (new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
}

const localInput = (iso: string) => {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

function documentForm(existing?: Rec): void {
  const v = existing?.value ?? {};
  const body0 = v.content?.$type === MARKDOWN ? v.content.text : (v.textContent ?? '');
  const title = h('input', { required: '', value: v.title ?? '' }) as HTMLInputElement;
  const slug = h('input', { required: '', pattern: '[a-z0-9](?:[a-z0-9\\-]{0,78}[a-z0-9])?', value: slugOf(v.path) ?? '' }) as HTMLInputElement;
  const desc = h('textarea', { rows: '2' }, v.description ?? '') as HTMLTextAreaElement;
  const tags = h('input', { value: (v.tags ?? []).join(', ') }) as HTMLInputElement;
  const date = h('input', { type: 'datetime-local', required: '', value: localInput(v.publishedAt ?? new Date().toISOString()) }) as HTMLInputElement;
  const body = h('textarea', { rows: '20', class: 'body', required: '' }, body0) as HTMLTextAreaElement;
  const canAnnounce = !v.bskyPostRef;
  const announce = h('input', { type: 'checkbox' }) as HTMLInputElement;
  announce.checked = canAnnounce && !existing;
  const ann = h('textarea', { rows: '3' }) as HTMLTextAreaElement;
  let annEdited = false;
  const annDefault = () => `${title.value.trim()}\n${ORIGIN}${postPath(slug.value.trim())}`;
  const syncAnn = () => { if (!annEdited) ann.value = annDefault(); };
  ann.addEventListener('input', () => { annEdited = true; });
  title.addEventListener('input', syncAnn);
  slug.addEventListener('input', syncAnn);
  syncAnn();
  const annBox = h('div', { class: 'announce' }, h('label', { class: 'check' }, announce, 'Bluesky で告知する（返信が記事のコメントになります）'), field('告知の本文', ann, '記事の URL を含めるとリンクになります'));
  if (existing) slug.setAttribute('readonly', ''); // the address of a published post stays

  const form = h('form', {},
    field('タイトル', title),
    field('スラッグ', slug, `記事の URL は ${ORIGIN}/blog/<スラッグ>（英小文字・数字・ハイフン）`),
    field('概要', desc),
    field('タグ', tags, 'カンマ区切り'),
    field('公開日時', date),
    field('本文（Markdown）', body),
    ...(canAnnounce ? [annBox] : [note('Bluesky の告知は済んでいます。')]),
    h('p', { class: 'actions' }, h('button', { class: 'primary' }, '内容を確認'), backButton()));
  const again = () => show(h('h2', {}, existing ? '記事を編集' : '新しい記事'), form);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const s = slug.value.trim();
    if (!existing && docs.some((d) => slugOf(d.value.path) === s)) { slug.setCustomValidity('このスラッグの記事はもうあります'); slug.reportValidity(); slug.setCustomValidity(''); return; }
    const url = `${ORIGIN}${postPath(s)}`;
    const steps: Step[] = [];
    const doAnnounce = canAnnounce && announce.checked;
    let postUri = '';
    if (doAnnounce) {
      const rkey = tid();
      postUri = `at://${session.did}/${BSKY_POST}/${rkey}`;
      steps.push({
        title: 'Bluesky に告知を投稿', method: 'com.atproto.repo.createRecord',
        json: { repo: session.did, collection: BSKY_POST, rkey, record: announcementRecord(ann.value.trim(), url, title.value.trim(), desc.value.trim(), new Date().toISOString()) },
      });
    }
    const record = documentRecord({
      site: pub!.uri, slug: s, title: title.value.trim(), description: desc.value.trim(),
      tags: tags.value.split(/[,、]/).map((t) => t.trim()).filter(Boolean),
      body: body.value, text: plain(body.value),
      publishedAt: new Date(date.value).toISOString(),
      ...(existing ? { updatedAt: new Date().toISOString() } : {}),
      bsky: doAnnounce ? { uri: postUri, cid: '（1 の結果の cid）' } : v.bskyPostRef,
    });
    const rkey = existing ? rkeyOf(existing.uri) : tid();
    const json: any = existing
      ? { repo: session.did, collection: DOCUMENT, rkey, record, swapRecord: existing.cid }
      : { repo: session.did, collection: DOCUMENT, rkey, record };
    steps.push({
      title: existing ? '記事を更新' : '記事を作成',
      method: existing ? 'com.atproto.repo.putRecord' : 'com.atproto.repo.createRecord',
      json,
      fill: doAnnounce ? (prev) => { json.record.bskyPostRef = { uri: prev[0].uri, cid: prev[0].cid }; } : undefined,
    });
    confirm(steps, again, () => void home(existing ? '記事を更新しました。サイトへの反映には少しかかります。' : '記事を公開しました。サイトへの反映には少しかかります。'));
  });
  again();
}

function removeDocument(d: Rec): void {
  const steps: Step[] = [{ title: '記事を削除', method: 'com.atproto.repo.deleteRecord', json: { repo: session.did, collection: DOCUMENT, rkey: rkeyOf(d.uri), swapRecord: d.cid } }];
  const ref = d.value.bskyPostRef?.uri as string | undefined;
  if (ref?.startsWith(`at://${session.did}/${BSKY_POST}/`)) {
    steps.push({ title: 'Bluesky の告知を削除（返信も見えなくなります）', method: 'com.atproto.repo.deleteRecord', json: { repo: session.did, collection: BSKY_POST, rkey: rkeyOf(ref) } });
  }
  const pick = steps.length > 1 ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: '' }), 'Bluesky の告知も削除する') : null;
  const next = h('button', { class: 'primary' }, '内容を確認');
  next.addEventListener('click', () => {
    const keepPost = pick && !(pick.querySelector('input') as HTMLInputElement).checked;
    confirm(keepPost ? steps.slice(0, 1) : steps, () => removeDocument(d), () => void home('記事を削除しました。'));
  });
  show(h('h2', {}, `「${d.value.title}」を削除`), ...(pick ? [pick] : []), h('p', { class: 'actions' }, next, backButton()));
}

// ------------------------------------------------------------------ demo
/** 127.0.0.1 with ?demo: a pretend PDS in memory, to try the page without signing in.
 *  Nothing leaves the browser. */
function demoSession(): OAuthSession {
  const repo = new Map<string, any>(); // at-uri -> record
  let n = 0;
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetchHandler = async (url: string, init?: RequestInit) => {
    const u = new URL(url, 'https://demo.invalid');
    const method = u.pathname.slice(6);
    if (method === 'com.atproto.repo.listRecords') {
      const c = u.searchParams.get('collection');
      const records = [...repo].filter(([k]) => k.split('/')[3] === c).map(([uri, value]) => ({ uri, cid: `bafydemo${uri.length}`, value }));
      return reply({ records });
    }
    if (method === 'com.atproto.repo.uploadBlob') return reply({ blob: { $type: 'blob', ref: { $link: `bafkreidemo${++n}` }, mimeType: 'image/png', size: 1 } });
    const j = JSON.parse(String(init?.body ?? '{}'));
    const uri = `at://${AUTHOR_DID}/${j.collection}/${j.rkey}`;
    if (method === 'com.atproto.repo.deleteRecord') { repo.delete(uri); return reply({}); }
    repo.set(uri, j.record);
    return reply({ uri, cid: `bafydemo${++n}` });
  };
  return { did: AUTHOR_DID, fetchHandler } as unknown as OAuthSession;
}

// ------------------------------------------------------------------ header
$('#signout').addEventListener('click', async () => {
  if (session) await (await oauth).revoke(session.did).catch(() => {});
  location.reload();
});

void start();
