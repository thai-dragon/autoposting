export interface RedditPost {
  id: string;
  subreddit: string;
  title: string;
  selftext: string;
  score: number;
  num_comments: number;
  created_utc: number;
}

const USER_AGENT = "trend-triangulation/0.1.0";

async function fetchWithRetry(url: string, retries = 2): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (res.status === 429) {
      const backoff = (i + 1) * 15;
      console.log(`  429 → backoff ${backoff}s (attempt ${i + 1}/${retries})`);
      await new Promise((r) => setTimeout(r, backoff * 1000));
      continue;
    }
    return res;
  }
  throw new Error(`Rate limited: ${url}`);
}

export type RedditSort = "hot" | "rising" | "new";

export async function fetchSubredditPosts(
  subreddit: string,
  sort: RedditSort = "hot"
): Promise<RedditPost[]> {
  const url = `https://www.reddit.com/r/${subreddit}/${sort}.json?limit=100`;
  const res = await fetchWithRetry(url);

  if (!res.ok) throw new Error(`Fetch /r/${subreddit} failed: ${res.status}`);
  const json = await res.json();

  return json.data.children.map((c: { data: RedditPost }) => ({
    id: c.data.id,
    subreddit: c.data.subreddit,
    title: c.data.title,
    selftext: c.data.selftext || "",
    score: c.data.score,
    num_comments: c.data.num_comments,
    created_utc: Math.floor(c.data.created_utc),
  }));
}
