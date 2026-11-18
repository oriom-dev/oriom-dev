// Fetch the Open Badges 2.0 data listed in content/badges.json (hosted assertions):
//   node tools/badges.ts
// Writes content/badges/<slug>.json (what the page shows, committed) and the badge
// images to .cache/art-src/badge-<slug>.png for tools/lineart.py. The server checks
// the hosted assertions again at run time; this is only the snapshot the build uses.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const list: { slug: string; assertion: string; share: string }[] = JSON.parse(readFileSync(path.join(ROOT, 'content/badges.json'), 'utf8'));
const get = async (u: string) => {
  const r = await fetch(u, { headers: { accept: 'application/ld+json, application/json' } });
  if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`);
  return r.json();
};
const text = (v: unknown) => (typeof v === 'string' ? v : v && typeof v === 'object' && 'narrative' in v ? String((v as { narrative: unknown }).narrative) : '');

mkdirSync(path.join(ROOT, '.cache/art-src'), { recursive: true });
for (const b of list) {
  const a = await get(b.assertion);
  const cls = typeof a.badge === 'string' ? await get(a.badge) : a.badge;
  const issuer = typeof cls.issuer === 'string' ? await get(cls.issuer) : cls.issuer;
  const out = {
    slug: b.slug,
    assertion: a.id,
    share: b.share,
    name: cls.name,
    description: String(cls.description ?? '').trim(),
    criteria: text(cls.criteria).trim(),
    tags: Array.isArray(cls.tags) ? cls.tags : [],
    issuer: { name: issuer.name, url: issuer.url, id: issuer.id },
    issuedOn: a.issuedOn,
    expires: a.expires ?? null,
    recipient: a.recipient, // { type: "email", hashed: true, identity: "sha256$…", salt }
    verification: a.verification?.type ?? 'HostedBadge',
  };
  writeFileSync(path.join(ROOT, `content/badges/${b.slug}.json`), JSON.stringify(out, null, 2) + '\n');
  const img = await fetch(a.image ?? cls.image);
  writeFileSync(path.join(ROOT, `.cache/art-src/badge-${b.slug}.png`), Buffer.from(await img.arrayBuffer()));
  console.log(`${b.slug}: ${out.name} (${out.issuer.name}, ${out.issuedOn})`);
}
