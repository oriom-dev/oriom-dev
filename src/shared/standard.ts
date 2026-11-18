// The site's own standard.site records, shared by the admin page (which writes them to the
// PDS) and the server (which reads them back and builds the post pages from them).
// https://standard.site/docs/lexicons/

export const ORIGIN = 'https://oriom.dev';
export const AUTHOR_DID = 'did:plc:p4woeawvwwrsvh6mjp5cvufu';
export const PUBLICATION = 'site.standard.publication';
export const DOCUMENT = 'site.standard.document';
export const BSKY_POST = 'app.bsky.feed.post';
/** The body as written (Markdown), in the document's open `content` union. */
export const MARKDOWN = 'dev.oriom.markdown';

/** What the admin page may do, and nothing else: these three collections and images. */
export const SCOPE = `atproto repo:${PUBLICATION} repo:${DOCUMENT} repo:${BSKY_POST} blob:image/*`;

/** A post's address on the site: /blog/<slug>. */
export const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
export const postPath = (slug: string) => `/blog/${slug}`;
export const slugOf = (path: unknown): string | null => {
  const m = typeof path === 'string' ? /^\/blog\/(.+)$/.exec(path) : null;
  return m && SLUG.test(m[1]!) ? m[1]! : null;
};

export interface PublicationInput {
  name: string;
  description: string;
  url: string;
  showInDiscover: boolean;
  icon?: unknown; // a blob ref from uploadBlob
}

export function publicationRecord(p: PublicationInput): Record<string, unknown> {
  return {
    $type: PUBLICATION,
    url: p.url,
    name: p.name,
    ...(p.description ? { description: p.description } : {}),
    ...(p.icon ? { icon: p.icon } : {}),
    preferences: { showInDiscover: p.showInDiscover },
  };
}

export interface DocumentInput {
  site: string; // the publication's AT-URI
  slug: string;
  title: string;
  description: string;
  tags: string[];
  body: string; // Markdown
  text: string; // the body as plain text (textContent)
  publishedAt: string; // ISO date-time
  updatedAt?: string;
  bsky?: { uri: string; cid: string };
}

export function documentRecord(d: DocumentInput): Record<string, unknown> {
  return {
    $type: DOCUMENT,
    site: d.site,
    path: postPath(d.slug),
    title: d.title,
    ...(d.description ? { description: d.description } : {}),
    publishedAt: d.publishedAt,
    ...(d.updatedAt ? { updatedAt: d.updatedAt } : {}),
    ...(d.tags.length ? { tags: d.tags } : {}),
    content: { $type: MARKDOWN, text: d.body },
    textContent: d.text,
    ...(d.bsky ? { bskyPostRef: d.bsky } : {}),
  };
}

/** The Bluesky post that announces a post: its replies are the post's comments. */
export function announcementRecord(text: string, url: string, title: string, description: string, createdAt: string): Record<string, unknown> {
  const enc = new TextEncoder();
  const at = text.indexOf(url);
  const facets = at < 0 ? [] : [{
    index: { byteStart: enc.encode(text.slice(0, at)).length, byteEnd: enc.encode(text.slice(0, at + url.length)).length },
    features: [{ $type: 'app.bsky.richtext.facet#link', uri: url }],
  }];
  return {
    $type: BSKY_POST, text, langs: ['ja'], createdAt,
    ...(facets.length ? { facets } : {}),
    embed: { $type: 'app.bsky.embed.external', external: { uri: url, title, description } },
  };
}
