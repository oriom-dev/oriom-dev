import { Marked } from 'marked';
import { artAttr, curve, decode, type Art } from '../shared/art.ts';
import { mdPath } from '../shared/routes.ts';
import type { PageOut, Post, Work } from '../shared/types.ts';
import { AUTHOR, loadStandard } from './content.ts';

export const ORIGIN = 'https://oriom.dev';
export const PUBLICATION_URI = process.env.PUBLICATION_URI || loadStandard().publication;

const marked = new Marked({ gfm: true, async: false });
export const mdToHtml = (md: string) => marked.parse(md) as string;

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&${({ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot', "'": '#39' } as const)[c as '&']};`);

const KIND: Record<string, string> = {
  hackathon: 'ハッカソン', product: 'プロダクト', research: '研究・コンテスト', personal: '個人制作',
  contract: '受託', contest: 'コンテスト', school: '学校', other: 'その他',
};
export const kindLabel = (k: string) => KIND[k] ?? k;

export interface Ctx { works: Work[]; posts: Post[] }
export type Target = 'md' | 'html';

/**
 * A line drawing. `data-art` feeds the 1D thread; the inline SVG is the same curve
 * for the other designs and for browsers without JavaScript.
 */
export function figure(a: Art, label: string, cls = ''): string {
  const h = Math.round(1000 / a.aspect);
  const pts = decode(a.p);
  const d = `M${pts[0]![0]} ${pts[0]![1]}${curve(pts)}`;
  return `<figure class="art${cls && ` ${cls}`}" data-art="${artAttr(a)}" style="aspect-ratio:${a.aspect}" role="img" aria-label="${esc(label)}">`
    + `<svg viewBox="0 0 1000 ${h}" aria-hidden="true"><path d="${d}"/></svg></figure>`;
}

export const workItem = (w: Work) =>
  `<li><a href="/works/${w.slug}">${w.art ? figure(w.art, w.art.title ?? w.title, 'thumb') : ''}`
  + `<b>${esc(w.title)}</b>${w.date ? `<time datetime="${w.date}">${w.date.slice(0, 4)}</time>` : ''}`
  + `<span>${esc(w.summary)}</span>${w.awards.length ? `<small>受賞 ${w.awards.length}</small>` : ''}</a></li>`;

const workLine = (w: Work) =>
  `- [${w.title}](/works/${w.slug})${w.date ? `（${w.date.slice(0, 4)}）` : ''}：${w.summary}${w.awards.length ? ` 🏆×${w.awards.length}` : ''}`;
const mdText = (s: string) => s.replace(/[\\`*_[\]<>#|]/g, (c) => `\\${c}`);
const postLine = (p: Post) =>
  `- ${p.date} [${mdText(p.title)}](${p.path})${p.author.did !== AUTHOR.did ? `（${mdText(p.author.name)}）` : ''}`;

const LINKS = [
  ['GitHub', 'https://github.com/oriom-dev', '@oriom-dev'],
  ['Bluesky', 'https://bsky.app/profile/oriom.dev', '@oriom.dev'],
  ['Team JISAKU', 'https://jisaku.dev/', 'jisaku.dev'],
] as const;

/** Expand `{{name:arg}}` lines into Markdown (stats become serve-time slots). */
export function expand(md: string, ctx: Ctx, target: Target = 'md'): string {
  return md.replace(/^\{\{(\w+)(?::(\w+))?\}\}$/gm, (_, name: string, arg = '') => {
    switch (name) {
      case 'works': {
        const ws = arg === 'featured' ? ctx.works.slice(0, 6) : ctx.works;
        const more = arg === 'featured' ? '\n\n[すべての実績 →](/works)' : '';
        if (target === 'html') return `<ul class="works">${ws.map(workItem).join('')}</ul>${more}`;
        return ws.map(workLine).join('\n') + more;
      }
      case 'posts': {
        const n = arg === 'all' ? Infinity : Number(arg) || 5;
        return ctx.posts.slice(0, n).map(postLine).join('\n') || '_まだ記事はありません。_';
      }
      case 'stats':
        return `<!--@stats:${arg || 'summary'}-->`;
      case 'links':
        return LINKS.map(([l, u, t]) => `- ${l}：[${t}](${u})`).join('\n');
      case 'badges':
        return '_準備中です。_';
      default:
        throw new Error(`unknown directive {{${name}}}`);
    }
  });
}

export function workMarkdown(w: Work, target: Target = 'md'): string {
  const rows: [string, string][] = [];
  if (w.date) rows.push(['時期', w.date]);
  rows.push(['種別', kindLabel(w.kind)]);
  if (w.team) rows.push(['チーム', w.team]);
  if (w.role.length) rows.push(['担当', w.role.join('、')]);
  if (w.tech.length) rows.push(['技術', w.tech.join('、')]);
  const awards = w.awards.map((a) => `- ${a.date}：${a.name}`).join('\n');
  const links = w.links.map((l) => `- [${l.label}](${l.url})`).join('\n');
  return [
    `# ${w.title}`,
    target === 'html' && w.art ? figure(w.art, w.art.title ?? w.title, 'hero') : '',
    `> ${w.summary}`,
    `| | |\n|---|---|\n${rows.map(([k, v]) => `| ${k} | ${v} |`).join('\n')}`,
    w.body,
    w.stat ? `<!--@stats:${w.stat}-->` : '',
    awards && `## 受賞\n\n${awards}`,
    links && `## リンク\n\n${links}`,
    '[← 実績一覧](/works)',
  ].filter(Boolean).join('\n\n');
}

/** Text from another site is plain text: never let it become HTML or Markdown markup. */
const plain = (s: string, target: Target) =>
  target === 'html'
    ? s.split(/\n{2,}/).map((para) => `<p>${esc(para).replace(/\n/g, '<br>')}</p>`).join('\n\n')
    : s;

export function postMarkdown(p: Post, target: Target = 'md'): string {
  const by = p.author.did === AUTHOR.did ? '' : `・${p.author.name}`;
  const ext = p.external ? `\n\n元の記事：<${p.external}>` : '';
  const body = p.external ? plain(p.body, target) : p.body;
  const title = p.external && target === 'html' ? esc(p.title) : p.title;
  return `# ${title}\n\n${p.date}${by}${p.tags.length ? `・${p.tags.map((t) => `#${target === 'html' ? esc(t) : t}`).join(' ')}` : ''}\n\n${body}${ext}\n\n[← 記事一覧](/blog)`;
}

export interface HeadMeta { path: string; title: string; description: string; type?: 'website' | 'article'; atUri?: string; published?: string }

export function head(m: HeadMeta): string {
  const url = ORIGIN + (m.path === '/' ? '' : m.path);
  const title = m.path === '/' ? m.title : `${m.title} | oriom`;
  return [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(m.description)}">`,
    `<link rel="canonical" href="${url}">`,
    `<link rel="alternate" type="text/markdown" href="${mdPath(m.path)}">`,
    `<meta property="og:title" content="${esc(m.title)}">`,
    `<meta property="og:description" content="${esc(m.description)}">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:type" content="${m.type ?? 'website'}">`,
    `<meta property="og:site_name" content="oriom">`,
    m.published ? `<meta property="article:published_time" content="${m.published}">` : '',
    m.atUri ? `<link rel="site.standard.document" href="${esc(m.atUri)}">` : '',
    PUBLICATION_URI ? `<link rel="site.standard.publication" href="${esc(PUBLICATION_URI)}">` : '',
  ].join('');
}

/** `htmlSource` is the Markdown to render as HTML when it differs from the .md version. */
export function page(meta: HeadMeta, md: string, htmlSource = md): PageOut {
  return { path: meta.path, title: meta.title, head: head(meta), body: mdToHtml(htmlSource), md: md.trim() + '\n' };
}
