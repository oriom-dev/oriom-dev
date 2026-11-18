// Markdown -> gemtext (gemini://). Gemtext has no inline links, so the links of a
// paragraph or list item follow it as `=>` lines; tables become preformatted text.
import { Lexer, type Token, type Tokens } from 'marked';

function inline(tokens: Token[] | undefined, links: { href: string; text: string }[]): string {
  let out = '';
  for (const t of tokens ?? []) {
    switch (t.type) {
      case 'link': {
        const text = inline((t as Tokens.Link).tokens, links);
        links.push({ href: (t as Tokens.Link).href, text });
        out += text;
        break;
      }
      case 'image': out += `[${(t as Tokens.Image).text}]`; links.push({ href: (t as Tokens.Image).href, text: (t as Tokens.Image).text || '画像' }); break;
      case 'br': out += '\n'; break;
      case 'codespan': out += (t as Tokens.Codespan).text; break;
      case 'html': break;
      default:
        out += 'tokens' in t && t.tokens ? inline(t.tokens as Token[], links) : unescape((t as { text?: string }).text ?? t.raw);
    }
  }
  return out;
}

const unescape = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\\([\\`*_[\]<>#|])/g, '$1');

/** Same-site links stay paths (resolved against gemini://<host>); .md suffixes go. */
const href = (h: string) => (h.startsWith('/') ? h.replace(/\.md$/, '').replace(/^\/index$/, '/') : h);
const linkLines = (links: { href: string; text: string }[]) => links.map((l) => `=> ${href(l.href)} ${l.text.replace(/\s+/g, ' ').trim()}`);

export function gemtext(md: string): string {
  const out: string[] = [];
  const block = (tokens: Token[]) => {
    for (const t of tokens) {
      const links: { href: string; text: string }[] = [];
      switch (t.type) {
        case 'heading':
          out.push(`${'#'.repeat(Math.min(3, (t as Tokens.Heading).depth))} ${inline((t as Tokens.Heading).tokens, links)}`, ...linkLines(links), '');
          break;
        case 'paragraph': {
          const text = inline((t as Tokens.Paragraph).tokens, links);
          // a paragraph that is only a link becomes just the link line
          if (links.length === 1 && text.trim() === links[0]!.text.trim()) out.push(...linkLines(links), '');
          else out.push(text, ...linkLines(links), '');
          break;
        }
        case 'list':
          for (const item of (t as Tokens.List).items) out.push(`* ${inline(item.tokens.flatMap((x) => ('tokens' in x && x.tokens ? x.tokens : [x])) as Token[], links).replace(/\n/g, ' ')}`);
          out.push(...linkLines(links), '');
          break;
        case 'blockquote':
          out.push(...inline((t as Tokens.Blockquote).tokens.flatMap((x) => ('tokens' in x && x.tokens ? x.tokens : [x])) as Token[], links).split('\n').map((l) => `> ${l}`), ...linkLines(links), '');
          break;
        case 'code':
          out.push('```', (t as Tokens.Code).text, '```', '');
          break;
        case 'table': {
          const tb = t as Tokens.Table;
          const rows = [tb.header.map((c) => inline(c.tokens, links)), ...tb.rows.map((r) => r.map((c) => inline(c.tokens, links)))];
          out.push('```', ...rows.map((r) => r.join(' | ')), '```', ...linkLines(links), '');
          break;
        }
        case 'hr': out.push('', '* * *', ''); break;
        case 'space': case 'html': break;
        default: out.push(t.raw.trim(), '');
      }
    }
  };
  block(new Lexer().lex(md));
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
