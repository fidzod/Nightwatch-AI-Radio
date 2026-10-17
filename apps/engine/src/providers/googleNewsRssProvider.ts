// Real news provider — Google News' free, keyless RSS feed. No API key, no
// signup: a GET to
//   https://news.google.com/rss?hl=<lang>&gl=<country>&ceid=<country>:<lang>
// (e.g. hl=en-GB&gl=GB&ceid=GB:en for the UK) returns a standard RSS 2.0
// document. Confirmed live against the real endpoint while building this —
// a top-level `<item>` looks like:
//
//   <item>
//     <title>Headline text here - Source Name</title>
//     <link>https://news.google.com/rss/articles/...</link>
//     <guid isPermaLink="false">CBMi...</guid>
//     <pubDate>Sat, 17 Oct 2026 16:08:30 GMT</pubDate>
//     <description>&lt;ol&gt;&lt;li&gt;&lt;a href="...">Headline...&lt;/a&gt;
//       &amp;nbsp;&amp;nbsp;&lt;font color="#6f6f6f"&gt;Source&lt;/font&gt;
//       &lt;/li&gt;...&lt;/ol&gt;</description>
//     <source url="...">Source Name</source>
//   </item>
//
// Two things worth noting about that shape:
//  - `title` is "<headline> - <source>", but there's ALSO a clean `<source>`
//    element carrying just the outlet name — confirmed present on every item
//    in a live fetch, so it's used directly and the " - <source>" suffix is
//    trimmed off the title using that known value (falling back to a
//    last-" - "-wins split on the rare item missing `<source>`).
//  - `description` on the *aggregate* feed (no topic/section) is an <ol> of
//    OTHER outlets covering the same story, not a summary of the article.
//    Treating that as "the summary" would be actively misleading, so this
//    provider deliberately leaves `summary` null — a headline-only item,
//    which NewsItem already supports.

import { XMLParser } from "fast-xml-parser";
import type { NewsItem, NewsProvider } from "./newsProvider.ts";

interface RssItem {
  title?: string;
  link?: string;
  guid?: string | { "#text"?: string };
  pubDate?: string;
  /** Clean outlet name, e.g. "BBC" — see the parsing notes above. */
  source?: string | { "#text"?: string };
}

interface RssFeed {
  rss?: {
    channel?: {
      item?: RssItem | RssItem[];
    };
  };
}

const parser = new XMLParser({ ignoreAttributes: true });

/** fast-xml-parser gives back a plain string for a tag with no attributes
 *  left after `ignoreAttributes: true`, or `{ "#text": ... }` if it ever has
 *  mixed content — handle both so a parser-option tweak can't silently break
 *  this. */
function textOf(value: string | { "#text"?: string } | undefined): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") return value["#text"] ?? null;
  return null;
}

/** Strips a known-good "<headline> - <source>" suffix off the title using
 *  the `<source>` element's own value, so the split can't accidentally eat
 *  into a headline that itself contains " - ". Falls back to splitting on
 *  the LAST " - " when `<source>` is missing — Google News always appends
 *  the source that way. */
function splitTitle(
  title: string,
  knownSource: string | null,
): { headline: string; source: string | null } {
  if (knownSource) {
    const suffix = ` - ${knownSource}`;
    if (title.endsWith(suffix)) {
      return { headline: title.slice(0, -suffix.length), source: knownSource };
    }
    return { headline: title, source: knownSource };
  }
  const idx = title.lastIndexOf(" - ");
  if (idx === -1) return { headline: title, source: null };
  return { headline: title.slice(0, idx), source: title.slice(idx + 3) };
}

function guidOf(item: RssItem): string {
  return textOf(item.guid) ?? item.link ?? item.title ?? "";
}

function toIso(pubDate: string | undefined): string {
  if (!pubDate) return new Date().toISOString();
  const parsed = new Date(pubDate);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

export class GoogleNewsRssProvider implements NewsProvider {
  private readonly language: () => string;
  private readonly country: () => string;

  /** `language` (e.g. "en") and `country` (ISO 3166-1 alpha-2, e.g. "GB") are
   *  read via functions, not captured once, so a `/settings` change takes
   *  effect on the provider's next fetch without reconstructing it. */
  constructor(language: () => string, country: () => string) {
    this.language = language;
    this.country = country;
  }

  async fetchLatestNews(limit: number): Promise<NewsItem[]> {
    const lang = this.language();
    const country = this.country();
    const ceid = `${country}:${lang}`;
    const url = `https://news.google.com/rss?hl=${lang}-${country}&gl=${country}&ceid=${ceid}`;

    let xml: string;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
      if (!res.ok) throw new Error(`Google News RSS ${res.status}`);
      xml = await res.text();
    } catch (err) {
      // Network failures, timeouts, non-200s: the station keeps running —
      // the scheduler already treats an empty news list as "skip this
      // moment" (see loop.ts's buildContext), same as the mock provider
      // having no rows.
      console.warn("[news] Google News RSS fetch failed —", err);
      return [];
    }

    let feed: RssFeed;
    try {
      feed = parser.parse(xml) as RssFeed;
    } catch (err) {
      console.warn("[news] Google News RSS parse failed —", err);
      return [];
    }

    const raw = feed.rss?.channel?.item;
    const items: RssItem[] = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];

    return items.slice(0, limit).map((item): NewsItem => {
      const { headline, source } = splitTitle(
        item.title ?? "(untitled)",
        textOf(item.source),
      );
      return {
        id: guidOf(item),
        headline,
        summary: null,
        category: null,
        source,
        publishedAt: toIso(item.pubDate),
      };
    });
  }
}
