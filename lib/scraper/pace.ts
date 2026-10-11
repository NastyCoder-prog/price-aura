// lib/scraper/pace.ts
// Shared pacing so sustained scraping (the cron) never fires rapid requests
// at an aggregator in a loop. Interactive requests get a short courtesy gap;
// batch mode uses the human-paced 3–7 second gap.

let nextSlotAt = 0

export async function paceAggregator(batch: boolean): Promise<void> {
  const now = Date.now()
  const wait = Math.max(0, nextSlotAt - now)
  const gapMs = batch ? 3000 + Math.random() * 4000 : 200 + Math.random() * 500
  nextSlotAt = Math.max(now, nextSlotAt) + gapMs
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
}

// Hard deadline shared by all aggregator candidates so a chain of slow
// fallbacks can never blow past the serverless function's time budget.
export function makeDeadline(ms: number): () => boolean {
  const endsAt = Date.now() + ms
  return () => Date.now() >= endsAt
}
