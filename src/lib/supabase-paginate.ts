/**
 * PostgREST caps every response at 1000 rows (`db-max-rows`) and signals the
 * truncation only through the Content-Range header, which supabase-js discards.
 * An unpaginated `.select()` over a table that can exceed 1000 rows therefore
 * returns silently incomplete data — with no error to notice.
 *
 * Verified against production on 2026-08-20: a hub with 1676 issues received
 * exactly 1000 rows, which hid 318 issues from its cycle pages and made the
 * incremental sync re-upsert every issue past the first 1000 on every run.
 */
export const POSTGREST_PAGE_SIZE = 1000;

type PageResult<T> = { data: T[] | null; error: { message: string } | null };

/**
 * Run a query in 1000-row pages until a short page comes back, returning every
 * row.
 *
 * `makeQuery` MUST apply a deterministic `.order(...)` — ideally ending in a
 * unique column such as `linear_id` — or rows can repeat or vanish across page
 * boundaries.
 */
export async function fetchAllPages<T>(
  label: string,
  makeQuery: (from: number, to: number) => PromiseLike<PageResult<T>>
): Promise<T[]> {
  const rows: T[] = [];

  for (let from = 0; ; from += POSTGREST_PAGE_SIZE) {
    const { data, error } = await makeQuery(from, from + POSTGREST_PAGE_SIZE - 1);

    if (error) {
      console.error(`${label} error:`, error);
      throw error;
    }

    const page = data ?? [];
    rows.push(...page);

    if (page.length < POSTGREST_PAGE_SIZE) return rows;
  }
}
