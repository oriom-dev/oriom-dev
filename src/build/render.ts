import { Marked } from 'marked';
import { separatePath, type Art } from '../shared/art.ts';
import { mdPath } from '../shared/routes.ts';
import type { Badge, Comment, Comments, Item, PageOut, Post, Work } from '../shared/types.ts';
import { AUTHOR, loadStandard } from './content.ts';

export const ORIGIN = 'https://oriom.dev';
export const PUBLICATION_URI = process.env.PUBLICATION_URI || loadStandard().publication;

const marked = new Marked({ gfm: true, async: false });
/** Links to other sites open in a new tab. */
export const externalLinks = (html: string) =>
  html.replace(/<a href="(https?:\/\/(?!oriom\.dev[/"])[^"]*)"(?![^>]*\starget=)/g, '<a href="$1" target="_blank" rel="noopener"');
export const mdToHtml = (md: string) => externalLinks(marked.parse(md) as string);

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&${({ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot', "'": '#39' } as const)[c as '&']};`);

const KIND: Record<string, string> = {
  hackathon: 'ハッカソン', product: 'プロダクト', research: '研究・コンテスト', personal: '個人制作',
  contract: '受託', contest: 'コンテスト', school: '学校', other: 'その他',
};
export const kindLabel = (k: string) => KIND[k] ?? k;

export interface Ctx { works: Work[]; posts: Post[]; badges?: Badge[] }
export type Target = 'md' | 'html';
export const SITE = 'oriom.dev';

/** A line drawing, as inline SVG (each stroke drawn on its own). */
export function figure(a: Art, label: string, cls = ''): string {
  const h = Math.round(1000 / a.aspect);
  const d = separatePath(a);
  return `<figure class="art${cls && ` ${cls}`}" style="aspect-ratio:${a.aspect}" role="img" aria-label="${esc(label)}">`
    + `<svg viewBox="0 0 1000 ${h}" aria-hidden="true"><path d="${d}"/></svg></figure>`;
}

const year = (d?: string) => (d ? d.slice(0, 4) : '');
const ymd = (s: string) => s.slice(0, 10);
const mdText = (s: string) => s.replace(/[\\`*_[\]<>#|]/g, (c) => `\\${c}`);

export const workItem = (w: Work) =>
  `<li><a href="/works/${w.slug}">${w.art ? figure(w.art, w.art.title ?? w.title, 'thumb') : ''}`
  + `<b>${esc(w.title)}</b>${w.date ? `<time datetime="${w.date}">${year(w.date)}</time>` : ''}`
  + `<span>${esc(w.summary)}</span>${w.stat ? `<!--@stats:${w.stat}-->` : ''}`
  + `${w.tech.length ? `<ul class="tags">${w.tech.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}</a></li>`;
const workLine = (w: Work) => `- [${mdText(w.title)}](/works/${w.slug}) ${year(w.date)}：${w.summary}`;

const postItem = (p: Post) =>
  `<li><a href="${esc(p.path)}"><time datetime="${p.date}">${p.date}</time><b>${esc(p.title)}</b>`
  + `${p.author.did !== AUTHOR.did ? `<small>${esc(p.author.name)}</small>` : ''}</a></li>`;
const postLine = (p: Post) =>
  `- ${p.date} [${mdText(p.title)}](${p.path})${p.author.did !== AUTHOR.did ? `（${mdText(p.author.name)}）` : ''}`;

const badgeItem = (b: Badge) =>
  `<li><a href="/badges/${b.slug}">${b.art ? figure(b.art, b.art.title ?? b.name, 'thumb') : ''}`
  + `<b>${esc(b.name)}</b><span>${esc(b.issuer.name)}</span><time datetime="${ymd(b.issuedOn)}">${ymd(b.issuedOn)}</time></a></li>`;
const badgeLine = (b: Badge) => `- [${mdText(b.name)}](/badges/${b.slug})：${b.issuer.name}・${ymd(b.issuedOn)}`;

/** A badge: its drawing, who issued it and when, what it stands for, and the issuer's page. */
export function badgeMarkdown(b: Badge, target: Target = 'md'): string {
  const criteria = b.criteria.replace(/\s*\n\s*/g, ' ');
  if (target === 'md') {
    return [`# ${b.name}`, `${b.issuer.name} · ${ymd(b.issuedOn)}`, b.description, criteria && `> ${criteria}`, `[${b.issuer.name} のページ](${b.share})`].filter(Boolean).join('\n\n');
  }
  return [
    `# ${b.name}`,
    b.art ? figure(b.art, b.art.title ?? b.name, 'hero badge') : '',
    `<ul class="facts"><li>${esc(b.issuer.name)}</li><li><time datetime="${ymd(b.issuedOn)}">${ymd(b.issuedOn)}</time></li></ul>`,
    b.description.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join(''),
    criteria ? `<blockquote><p>${esc(criteria)}</p></blockquote>` : '',
    `<ul class="links"><li><a href="${esc(b.share)}">${esc(b.issuer.name)} のページ</a></li></ul>`,
  ].filter(Boolean).join('\n\n');
}

const LINKS = [
  ['GitHub', 'https://github.com/oriom-dev', '@oriom-dev'],
  ['Bluesky', 'https://bsky.app/profile/oriom.dev', '@oriom.dev'],
  ['Team JISAKU', 'https://jisaku.dev', 'jisaku.dev'],
] as const;

/** A section of the top page that can be linked as /#id. */
function section(id: string, heading: string, html: string, md: string, target: Target): string {
  return target === 'html' ? `<section id="${id}"><h2>${heading}</h2>${html}</section>` : `## ${heading}\n\n${md}`;
}

/** Expand `{{name:arg}}` lines (stats become serve-time slots). Empty sections vanish. */
export function expand(md: string, ctx: Ctx, target: Target = 'md'): string {
  return md.replace(/^\{\{(\w+)(?::(\w+))?\}\}$/gm, (_, name: string, arg = '') => {
    switch (name) {
      case 'works':
        return section('works', '実績', `<ul class="works">${ctx.works.map(workItem).join('')}</ul>`, ctx.works.map(workLine).join('\n'), target);
      case 'posts':
        return ctx.posts.length ? section('posts', '記事', `<ul class="posts">${ctx.posts.map(postItem).join('')}</ul>`, ctx.posts.map(postLine).join('\n'), target) : '';
      case 'badges': {
        const bs = ctx.badges ?? [];
        return bs.length ? section('badges', 'バッジ', `<ul class="badges">${bs.map(badgeItem).join('')}</ul>`, bs.map(badgeLine).join('\n'), target) : '';
      }
      case 'stats':
        return `<!--@stats:${arg || 'full'}-->`;
      case 'links':
        return target === 'html'
          ? `<ul class="links">${LINKS.map(([l, u, t]) => `<li><a href="${u}">${l} <span>${t}</span></a></li>`).join('')}</ul>`
          : LINKS.map(([l, u, t]) => `- ${l}：[${t}](${u})`).join('\n');
      default:
        throw new Error(`unknown directive {{${name}}}`);
    }
  });
}

/** A work: the facts as a short line and tags, laid out instead of labelled. */
export function workMarkdown(w: Work, target: Target = 'md'): string {
  const when = w.date ? (w.date.length === 4 ? `${w.date} 年度` : w.date) : '';
  const facts = [when, kindLabel(w.kind), w.team ?? ''].filter(Boolean);
  const stat = w.stat ? `<!--@stats:${w.stat}-->` : '';
  if (target === 'md') {
    return [
      `# ${w.title}`, w.summary, `${facts.join(' · ')}${stat ? ` · ${stat}` : ''}`,
      w.role.length ? `担当：${w.role.join('、')}` : '', w.tech.length ? `技術：${w.tech.join('、')}` : '',
      w.body,
      w.awards.map((a) => `- 🏆 ${a.date} ${a.name}`).join('\n'),
      w.links.map((l) => `- [${l.label}](${l.url})`).join('\n'),
    ].filter(Boolean).join('\n\n');
  }
  const li = (xs: string[]) => xs.map((x) => `<li>${esc(x)}</li>`).join('');
  return [
    `# ${w.title}`,
    w.art ? figure(w.art, w.art.title ?? w.title, 'hero') : '',
    `<p class="lead">${esc(w.summary)}</p>`,
    `<ul class="facts">${li(facts)}${stat ? `<li>${stat}</li>` : ''}</ul>`
      + (w.role.length ? `<ul class="roles">${li(w.role)}</ul>` : '')
      + (w.tech.length ? `<ul class="tags">${li(w.tech)}</ul>` : ''),
    w.body,
    w.awards.length ? `<ul class="awards">${w.awards.map((a) => `<li><time datetime="${a.date}">${a.date}</time>${esc(a.name)}</li>`).join('')}</ul>` : '',
    w.links.length ? `<ul class="links">${w.links.map((l) => `<li><a href="${esc(l.url)}">${esc(l.label)}</a></li>`).join('')}</ul>` : '',
  ].filter(Boolean).join('\n\n');
}

/** Text from another site is plain text: never let it become HTML or Markdown markup. */
const plain = (s: string, target: Target) =>
  target === 'html'
    ? s.split(/\n{2,}/).map((para) => `<p>${esc(para).replace(/\n/g, '<br>')}</p>`).join('\n\n')
    : s;

function commentsMd(cs: Comment[], depth = 0): string {
  const pad = '  '.repeat(depth);
  return cs.map((c) => {
    const text = c.text.map((s) => (s.href ? `[${mdText(s.t)}](${s.href})` : mdText(s.t))).join('').replace(/\n+/g, ' ');
    return `${pad}- **${mdText(c.author.name)}**（@${c.author.handle}・[${c.at}](${c.url})）${text}${c.replies.length ? `\n${commentsMd(c.replies, depth + 1)}` : ''}`;
  }).join('\n');
}

function commentsHtml(cs: Comment[]): string {
  return `<ul>${cs.map((c) => `<li><p class="who"><b>${esc(c.author.name)}</b> <a href="${esc(c.url)}">@${esc(c.author.handle)}・<time datetime="${esc(c.at)}">${esc(c.at)}</time></a></p>`
    + `<p>${c.text.map((s) => (s.href ? `<a href="${esc(s.href)}" rel="nofollow ugc">${esc(s.t)}</a>` : esc(s.t))).join('').replace(/\n/g, '<br>')}</p>`
    + `${c.replies.length ? commentsHtml(c.replies) : ''}</li>`).join('')}</ul>`;
}

/** The comment section: replies to the post's Bluesky announcement. */
export function commentSection(c: Comments[string] | undefined, target: Target): string {
  if (!c) return '';
  const head = `## コメント ${c.count}`;
  const shown = (cs: Comment[]): number => cs.reduce((n, x) => n + 1 + shown(x.replies), 0);
  const more = c.count > shown(c.comments) ? `ほかの ${c.count - shown(c.comments)} 件は Bluesky で読めます。 ` : '';
  const reply = `${more}[Bluesky で返信する](${c.url})`;
  const none = '';
  if (target === 'md') return [head, c.count ? commentsMd(c.comments) : none, reply].filter(Boolean).join('\n\n');
  return [head, c.count ? `<div class="comments">${commentsHtml(c.comments)}</div>` : '', reply].filter(Boolean).join('\n\n');
}

export function postMarkdown(p: Post, target: Target = 'md', comments?: Comments[string]): string {
  const by = p.author.did === AUTHOR.did ? '' : `・${p.author.name}`;
  const ext = p.external ? `\n\n元の記事：<${p.external}>` : '';
  const body = p.external ? plain(p.body, target) : p.body;
  const title = p.external && target === 'html' ? esc(p.title) : p.title;
  const cs = commentSection(comments ?? (p.bsky ? { url: `https://bsky.app/profile/${p.bsky.uri.split('/')[2]}/post/${p.bsky.uri.split('/').pop()}`, count: 0, comments: [] } : undefined), target);
  return `# ${title}\n\n${p.date}${by}${p.tags.length ? `・${p.tags.map((t) => `#${target === 'html' ? esc(t) : t}`).join(' ')}` : ''}\n\n${body}${ext}${cs && `\n\n${cs}`}`;
}

export interface HeadMeta { path: string; title: string; description: string; type?: 'website' | 'article'; atUri?: string; published?: string }

export function head(m: HeadMeta): string {
  const url = ORIGIN + (m.path === '/' ? '' : m.path);
  const title = m.path === '/' ? SITE : `${m.title} | ${SITE}`;
  return [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(m.description)}">`,
    `<link rel="canonical" href="${url}">`,
    `<link rel="alternate" type="text/markdown" href="${mdPath(m.path)}">`,
    `<meta property="og:title" content="${esc(m.title)}">`,
    `<meta property="og:description" content="${esc(m.description)}">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:type" content="${m.type ?? 'website'}">`,
    `<meta property="og:site_name" content="${SITE}">`,
    m.published ? `<meta property="article:published_time" content="${m.published}">` : '',
    m.atUri ? `<link rel="site.standard.document" href="${esc(m.atUri)}">` : '',
    PUBLICATION_URI ? `<link rel="site.standard.publication" href="${esc(PUBLICATION_URI)}">` : '',
  ].join('');
}

/** `htmlSource` is the Markdown to render as HTML when it differs from the .md version. */
export function page(meta: HeadMeta, md: string, htmlSource = md, item?: Item): PageOut {
  return { path: meta.path, title: meta.title, ...(item ? { item } : {}), head: head(meta), body: mdToHtml(htmlSource), md: md.trim() + '\n' };
}
