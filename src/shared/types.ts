export const VARIANTS = ['1d', '2d', '3d'] as const;
export type Variant = (typeof VARIANTS)[number];

export interface Link { label: string; url: string }
export interface Award { date: string; name: string }

export interface Work {
  slug: string;
  title: string;
  date?: string;
  kind: string;
  team?: string;
  role: string[];
  tech: string[];
  summary: string;
  awards: Award[];
  links: Link[];
  image?: string;
  stat?: string;
  body: string; // markdown
}

export interface Post {
  slug: string;
  path: string; // site path, e.g. /blog/foo or /team/jisaku.dev/3abc
  title: string;
  date: string;
  updated?: string;
  description: string;
  tags: string[];
  body: string; // markdown
  author: { name: string; handle?: string; did?: string };
  external?: string; // canonical URL when the post lives on another site
  atUri?: string; // site.standard.document record
}

/** A page as served: everything except the variant template, hue and live stats. */
export interface PageOut {
  path: string;
  title: string;
  head: string; // <title>, meta, link tags
  body: string; // content HTML; may contain <!--@stats:*--> slots
  md: string; // markdown version; may contain <!--@stats:*--> slots
}

export interface SiteBundle {
  version: string;
  builtAt: string;
  templates: Record<Variant, string>;
  /** script-src hashes per template, for the Content-Security-Policy header. */
  scriptHashes: Record<Variant, string[]>;
  pages: Record<string, PageOut>;
  stats?: Stats;
}

export interface Stats {
  at: string;
  views?: number;
  tompedia?: { total: number; byYear: { year: number; count: number }[] };
  mosimo?: { posts: number; authors: number };
  cluster?: ClusterSummary;
}

export interface ClusterSummary {
  nodes: ClusterNode[];
}

/** What is public about a node: an allowlist of the cluster agent's data, nothing else. */
export interface ClusterNode {
  name: string;
  cpus: number;
  load: number[];
  cpu: number | null; // percent of all cores
  memory: { used: number; total: number };
  rx: number | null; // bytes/s on physical interfaces
  tx: number | null;
  uptime: number | null; // seconds
  containers: { name: string; cpu: number | null; memory: number | null }[]; // running only; cpu in cores
  history: { cpu: (number | null)[]; mem: (number | null)[] };
}
