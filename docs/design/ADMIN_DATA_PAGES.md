# Data pages in the admin: the standard

Data-centric admin screens (lists, queues, reports) should read like an analytics tool: figures first, then charts, then a dense table with filters. The School directory (`app/(app)/admin/schools/page.tsx`) is the reference.

## Layout, top to bottom

1. **Header**: title, one sentence, small actions on the right (Export, Import).
2. **Key figures**: 4 to 6 compact tiles (`Kpi`). A tile turns amber only when something needs attention (for example "Waiting for review" above zero).
3. **Charts** (`components/admin/DataViz.tsx`): a ranked bar for "where" (click a bar to filter the table), a split bar for "what share", a trend curve for "over time". Two charts side by side on wide screens, stacked on a phone.
4. **Filter bar**, one row: status control, dependent selects (region then district), type and level selects, search, "Clear filters". Filters narrow both the table and, where it makes sense, the charts.
5. **Table**: 34px rows, sticky header, sortable columns (sort is done by the database, not the browser), small row buttons that open a detail row under the record, page size 25 / 50 / 100, "x to y of N".

## Rules for charts

- One colour per meaning, from the app's chart tokens (`--chart-1` blue, `--amber`, grey for "not set"). The Public / Private pair was checked with the palette validator (adjacent colour difference 31 and 35, well above the floors).
- Thin bars (10px), 2px gaps between touching segments, 4px rounded ends, direct value labels, a hover title on every mark, a legend whenever there are two or more series, and text in ink colours (never the series colour).
- A table is always the fallback: the same numbers sit in the table below.
- Figures come from one database function per screen (for example `qb_school_admin_stats`), so the page makes one request for all of its charts.

## Controls

Use `dx-btn` (30px; `sm` 24px), `dx-select`, `dx-input` and `dx-seg-control`. Avoid the large rounded `qb-btn` and `qb-chip` on data pages.

## Next screens to bring in line

Reviewer applications, Question batches, Affiliates, Support requests, Payouts and Operations are the busiest data screens. Move them one at a time, adding a stats function for each rather than computing figures in the browser.
