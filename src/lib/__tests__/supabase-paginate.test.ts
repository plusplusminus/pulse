import { describe, it, expect, vi } from "vitest";
import { fetchAllPages, POSTGREST_PAGE_SIZE } from "../supabase-paginate";

const rows = (n: number, offset = 0) =>
  Array.from({ length: n }, (_, i) => ({ id: offset + i }));

describe("fetchAllPages", () => {
  it("returns a single short page without asking for another", async () => {
    const make = vi.fn(async () => ({ data: rows(3), error: null }));
    const out = await fetchAllPages("t", make);

    expect(out).toHaveLength(3);
    expect(make).toHaveBeenCalledTimes(1);
    expect(make).toHaveBeenCalledWith(0, POSTGREST_PAGE_SIZE - 1);
  });

  it("keeps paging while pages come back full, and concatenates in order", async () => {
    const make = vi.fn(async (from: number) => ({
      data:
        from === 0
          ? rows(POSTGREST_PAGE_SIZE, 0)
          : from === POSTGREST_PAGE_SIZE
            ? rows(POSTGREST_PAGE_SIZE, POSTGREST_PAGE_SIZE)
            : rows(7, 2 * POSTGREST_PAGE_SIZE),
      error: null,
    }));

    const out = await fetchAllPages("t", make);

    expect(out).toHaveLength(2 * POSTGREST_PAGE_SIZE + 7);
    expect(make).toHaveBeenCalledTimes(3);
    expect(out[0]).toEqual({ id: 0 });
    expect(out.at(-1)).toEqual({ id: 2 * POSTGREST_PAGE_SIZE + 6 });
    // Ranges must be contiguous and non-overlapping.
    expect(make.mock.calls.map((c) => c[0])).toEqual([
      0,
      POSTGREST_PAGE_SIZE,
      2 * POSTGREST_PAGE_SIZE,
    ]);
  });

  it("stops at an exact multiple of the page size via a trailing empty page", async () => {
    const make = vi.fn(async (from: number) => ({
      data: from === 0 ? rows(POSTGREST_PAGE_SIZE) : [],
      error: null,
    }));

    const out = await fetchAllPages("t", make);

    expect(out).toHaveLength(POSTGREST_PAGE_SIZE);
    expect(make).toHaveBeenCalledTimes(2);
  });

  it("treats a null data page as empty rather than throwing", async () => {
    const make = vi.fn(async () => ({ data: null, error: null }));
    await expect(fetchAllPages("t", make)).resolves.toEqual([]);
  });

  it("throws on a query error instead of returning partial rows", async () => {
    const make = vi.fn(async (from: number) =>
      from === 0
        ? { data: rows(POSTGREST_PAGE_SIZE), error: null }
        : { data: null, error: { message: "boom" } }
    );

    await expect(fetchAllPages("t", make)).rejects.toEqual({ message: "boom" });
  });
});
