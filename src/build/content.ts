import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { Art } from '../shared/art.ts';
import { AUTHOR_DID } from '../shared/standard.ts';
import type { Badge, Work } from '../shared/types.ts';

export const ROOT = path.resolve(import.meta.dirname, '../..');
const CONTENT = path.join(ROOT, 'content');
const INCLUDE_DRAFTS = process.env.DRAFTS === '1';

export interface Doc { name: string; meta: Record<string, any>; body: string }

export function readDoc(file: string): Doc {
  const raw = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
  const meta = m ? (parseYaml(m[1]!) ?? {}) : {};
  // YAML turns 2026-11-18 into a Date; keep dates as plain strings.
  for (const [k, v] of Object.entries(meta)) if (v instanceof Date) meta[k] = v.toISOString().slice(0, 10);
  return { name: path.basename(file, '.md'), meta, body: raw.slice(m ? m[0].length : 0).trim() };
}

function readDir(dir: string): Doc[] {
  if (!existsSync(path.join(CONTENT, dir))) return [];
  return readdirSync(path.join(CONTENT, dir))
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => readDoc(path.join(CONTENT, dir, f)))
    .filter((d) => INCLUDE_DRAFTS || !d.meta.draft);
}

const day = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v == null ? undefined : String(v));

export function loadWorks(): Work[] {
  return readDir('works')
    .map(({ name, meta, body }) => ({
      slug: name,
      title: String(meta.title),
      date: day(meta.date),
      kind: String(meta.kind ?? 'other'),
      team: meta.team,
      role: meta.role ?? [],
      tech: meta.tech ?? [],
      summary: String(meta.summary ?? ''),
      awards: (meta.awards ?? []).map((a: any) => ({ date: day(a.date)!, name: String(a.name) })),
      links: meta.links ?? [],
      image: meta.image,
      stat: meta.stat,
      art: loadArt(name),
      body,
    }))
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
}

export function loadArt(name: string): Art | undefined {
  const f = path.join(CONTENT, 'art', `${name}.json`);
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : undefined;
}

export function loadBadges(): Badge[] {
  const dir = path.join(CONTENT, 'badges');
  if (!existsSync(dir)) return [];
  const order: { slug: string }[] = JSON.parse(readFileSync(path.join(CONTENT, 'badges.json'), 'utf8'));
  return order.map(({ slug }) => ({ ...JSON.parse(readFileSync(path.join(dir, `${slug}.json`), 'utf8')), art: loadArt(`badge-${slug}`) }));
}

/** Other standard.site publications whose posts are shown here. The site's own posts
 *  live on its PDS (written from the admin page) and are read at run time. */
export interface StandardConfig {
  follow: { handle: string; name: string }[];
}
export const loadStandard = (): StandardConfig => JSON.parse(readFileSync(path.join(CONTENT, 'standard.json'), 'utf8'));

export const AUTHOR = { name: 'oriom', handle: 'oriom.dev', did: AUTHOR_DID };

export const loadPages = () => readDir('pages');
