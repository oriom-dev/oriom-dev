// The admin page and the two public pieces its sign-in needs: the OAuth client metadata
// and the redirect page. The redirect page knows nothing of the admin page's path: the
// admin page leaves it in sessionStorage before it sends the browser to sign in.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { ORIGIN, SCOPE } from '../shared/standard.ts';
import { ROOT } from './content.ts';
import { bundleJs } from './templates.ts';

const inline = (js: string) => js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');

const CSS = `
:root{color-scheme:light dark;--bg:#fbfbfc;--fg:#1d1f24;--mut:#636874;--line:#d7d9de;--acc:#3a5bd9;--err:#b3261e;--ok:#1b7a3d}
@media (prefers-color-scheme:dark){:root{--bg:#16171b;--fg:#e6e7ea;--mut:#9a9eaa;--line:#33363d;--acc:#8aa4ff;--err:#ff8a80;--ok:#7bd88f}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.7 system-ui,sans-serif}
header{display:flex;align-items:center;gap:1rem;padding:.8rem 1rem;border-bottom:1px solid var(--line)}
header b{margin-right:auto;font-weight:500}
main{max-width:48rem;margin:0 auto;padding:1rem 1rem 4rem}
h2{font-size:1.15rem;font-weight:600;margin:1.6rem 0 .6rem}
h3{font-size:1rem;margin:0}
form{display:grid;gap:.9rem}
label{display:grid;gap:.25rem}
label>span{font-size:.85rem;color:var(--mut)}
label small{color:var(--mut);font-size:.8rem}
label.check{display:flex;gap:.5rem;align-items:center}
input,textarea,button{font:inherit;color:inherit}
input:not([type=checkbox]),textarea{width:100%;padding:.45rem .6rem;border:1px solid var(--line);border-radius:.4rem;background:transparent}
input[readonly]{color:var(--mut)}
textarea.body{font-family:ui-monospace,monospace;font-size:.9rem;line-height:1.6}
button{padding:.4rem .9rem;border:1px solid var(--line);border-radius:.4rem;background:transparent;cursor:pointer}
button.primary{background:var(--acc);border-color:var(--acc);color:var(--bg)}
button:disabled{opacity:.5;cursor:wait}
.actions{display:flex;gap:.6rem;flex-wrap:wrap;margin:.4rem 0}
.note{color:var(--mut)}.note.error{color:var(--err)}.note.ok{color:var(--ok)}
.uri{font-family:ui-monospace,monospace;font-size:.8rem;color:var(--mut);word-break:break-all}
ul.docs{list-style:none;padding:0;margin:1rem 0 0}
ul.docs li{display:flex;gap:.8rem;align-items:baseline;padding:.5rem 0;border-top:1px solid var(--line)}
ul.docs .date{color:var(--mut);font-variant-numeric:tabular-nums}
ul.docs a{margin-right:auto;color:inherit}
.row-actions{display:flex;gap:.4rem}
.announce{display:grid;gap:.6rem;padding:.8rem;border:1px solid var(--line);border-radius:.5rem}
ol.steps{padding-left:1.4rem}
ol.steps li{margin:1rem 0}
.method{font-family:ui-monospace,monospace;font-size:.85rem;color:var(--mut);margin:.2rem 0}
pre{margin:0;padding:.8rem;border:1px solid var(--line);border-radius:.4rem;overflow:auto;font-size:.8rem;line-height:1.5;white-space:pre-wrap;word-break:break-all}
`.trim();

export function writeAdmin(out: string): void {
  const js = inline(bundleJs(path.join(ROOT, 'src/client/admin/main.ts'), 'esm'));
  writeFileSync(path.join(out, 'admin.html'), `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>管理 | oriom.dev</title><link rel="icon" href="/icon.svg"><style>${CSS}</style></head><body><header><b>oriom.dev 管理</b><button id="signout" type="button">サインアウト</button></header><main></main><script type="module">${js}</script></body></html>`);
  // the authorization server sends the browser here; it goes on to the admin page
  const cb = `const p=sessionStorage.getItem('oriom.admin');location.replace(p&&/^\\/[A-Za-z0-9_-]{16,128}$/.test(p)?p+location.hash:'/')`;
  writeFileSync(path.join(out, 'oauth-callback.html'), `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>oriom.dev</title></head><body><script>${cb}</script></body></html>`);
  writeFileSync(path.join(out, 'client-metadata.json'), JSON.stringify({
    client_id: `${ORIGIN}/oauth/client-metadata.json`,
    client_name: 'oriom.dev',
    client_uri: ORIGIN,
    logo_uri: `${ORIGIN}/icon-512.png`,
    redirect_uris: [`${ORIGIN}/oauth/callback`],
    scope: SCOPE,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    application_type: 'web',
    dpop_bound_access_tokens: true,
  }, null, 2));
}
