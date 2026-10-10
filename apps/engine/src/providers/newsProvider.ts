// News source seam.
//
// The plan (decision #2 + §1) is explicit: v1 reads mock rows, but the
// generation pipeline must only ever see an interface's return shape, so a real
// provider is a drop-in swap later. Hence `NewsProvider` below is deliberately
// one method wide, returns plain data (no DB rows, no SQLite types), and the
// shape mirrors what a real headlines API hands back — id, headline, summary,
// category, source, publishedAt — rather than our column names.
//
// A real provider later is: implement `NewsProvider` against the HTTP API,
// construct it instead of `MockNewsProvider` in src/scheduler/loop.ts. Nothing
// else changes.

import { listNewsItems } from "../store.ts";

export interface NewsItem {
  id: string;
  headline: string;
  /** One or two sentences of detail, or null for a headline-only item. */
  summary: string | null;
  category: string | null;
  source: string | null;
  /** ISO 8601. */
  publishedAt: string;
}

export interface NewsProvider {
  /** Most recent items first. May return fewer than `limit`, including none. */
  fetchLatestNews(limit: number): Promise<NewsItem[]>;
}

export class MockNewsProvider implements NewsProvider {
  async fetchLatestNews(limit: number): Promise<NewsItem[]> {
    return listNewsItems(limit).map((row) => ({
      id: String(row.id),
      headline: row.headline,
      summary: row.body,
      category: row.category,
      source: row.source_label,
      publishedAt: row.mock_published_at.replace(" ", "T") + "Z",
    }));
  }
}

/**
 * Formats items for the news prompt's `{list of 2-4 headlines/summaries}`
 * slot. Kept next to the interface rather than in the prompt module because
 * this is "how a news item reads as raw input", which belongs to the data
 * shape — a real provider swapping in gets the same rendering for free.
 */
export function formatNewsForPrompt(items: NewsItem[]): string {
  return items
    .map((item) => {
      const attribution = item.source ? ` (${item.source})` : "";
      const detail = item.summary ? `\n  ${item.summary}` : "";
      return `- ${item.headline}${attribution}${detail}`;
    })
    .join("\n");
}
