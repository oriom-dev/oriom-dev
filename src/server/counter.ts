// A retro visitor counter. A visit is one client (IP + UA) per path per day; the
// hashes live only in memory with a random salt and are dropped every day.
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BOT = /bot|crawl|spider|slurp|preview|monitor|uptime|headless|lighthouse|pingdom|curl|wget|python|go-http|java\//i;

export class Counter {
  private data: { total: number; paths: Record<string, number> } = { total: 0, paths: {} };
  private seen = new Set<string>();
  private salt = randomBytes(16);
  private day = '';
  private dirty = false;

  private file?: string;

  constructor(file?: string) {
    this.file = file;
    if (file) {
      try { this.data = JSON.parse(readFileSync(file, 'utf8')); } catch { /* first run */ }
      mkdirSync(path.dirname(file), { recursive: true });
      setInterval(() => this.flush(), 30_000).unref();
      for (const sig of ['SIGINT', 'SIGTERM'] as const) process.once(sig, () => { this.flush(); process.exit(0); });
    }
  }

  /** Counts a page view; returns the total so the page can show its own number. */
  hit(pagePath: string, client: string, ua = ''): number {
    if (BOT.test(ua)) return this.data.total;
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.day) { this.day = today; this.seen.clear(); this.salt = randomBytes(16); }
    const key = createHash('sha256').update(this.salt).update(`${client}\0${ua}\0${pagePath}`).digest('base64url').slice(0, 16);
    if (this.seen.has(key)) return this.data.total;
    this.seen.add(key);
    this.data.total++;
    this.data.paths[pagePath] = (this.data.paths[pagePath] ?? 0) + 1;
    this.dirty = true;
    return this.data.total;
  }

  total = () => this.data.total;
  of = (p: string) => this.data.paths[p] ?? 0;

  flush(): void {
    if (!this.file || !this.dirty) return;
    writeFileSync(`${this.file}.tmp`, JSON.stringify(this.data));
    renameSync(`${this.file}.tmp`, this.file);
    this.dirty = false;
  }
}
