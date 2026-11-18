// Open Badges 2.0 hosted verification, done again at run time: the assertion must
// still be served by the issuer, unrevoked, unexpired, unchanged (badge, recipient),
// and hosted on the issuer's own origin.
import type { Badge, BadgeStatus } from '../shared/types.ts';

const get = async (u: string) => {
  const r = await fetch(u, { headers: { accept: 'application/ld+json, application/json', 'user-agent': 'oriom.dev-badges (+https://oriom.dev)' }, signal: AbortSignal.timeout(15_000) });
  return r;
};

export async function verify(b: Badge): Promise<BadgeStatus> {
  const at = new Date().toISOString();
  try {
    const r = await get(b.assertion);
    if (r.status === 410) return { ok: false, at, note: '発行元で取り消されています' };
    if (!r.ok) return { ok: false, at, note: `発行元に問い合わせられませんでした（HTTP ${r.status}）` };
    const a = await r.json();
    if (a.revoked) return { ok: false, at, note: '発行元で取り消されています' };
    if (a.id !== b.assertion) return { ok: false, at, note: 'アサーションの ID が一致しません' };
    if (a.recipient?.identity !== b.recipient.identity || a.recipient?.salt !== b.recipient.salt) return { ok: false, at, note: '受領者が変わっています' };
    if (a.expires && Date.parse(a.expires) < Date.now()) return { ok: false, at, note: '有効期限が切れています' };
    const badgeId = typeof a.badge === 'string' ? a.badge : a.badge?.id;
    const cls = await (await get(badgeId)).json();
    const issuerId = typeof cls.issuer === 'string' ? cls.issuer : cls.issuer?.id;
    if (issuerId !== b.issuer.id) return { ok: false, at, note: '発行者が変わっています' };
    if (new URL(a.id).origin !== new URL(issuerId).origin) return { ok: false, at, note: 'アサーションが発行者のドメインにありません' };
    return { ok: true, at, note: '発行元で有効です' };
  } catch (e) {
    return { ok: false, at, note: `確認できませんでした（${(e as Error).message}）` };
  }
}
