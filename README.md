# Token Launch Radar

A token launch radar for make.fun's `token-radar-01` bounty. It reads the
sealed DefiLlama snapshot, finds every protocol that records no token and is
not a wrapped, staked or bridged product of one that trades, ranks them by
implied launch value, and renders a static dashboard with a detail view and
a concrete farm plan for each protocol.

## The model (radar-2, comps-calibrated)

The snapshot prices its own board: for each category, take the median
market-cap / TVL multiple of the token-bearing protocols that already trade,
then price a pre-token protocol's TVL at its category's multiple (categories
with fewer than 3 priced peers fall back to the global median, shrunk 10%).

    implied = TVL x categoryMultiple x growthAdj x ageAdj x breadthAdj
    growthAdj  = 1 + clamp(change_7d, -30, +30)/100 x 0.8
    ageAdj     = 1 + 0.25 x min(tokenless age in days, 1095)/1095
    breadthAdj = 1 + 0.01 x min(chains - 1, 8)

On this snapshot that yields 198 ranked candidates, covering all 40
watchlist protocols; 416 live-token protocols form the comp set and 144
derivative products are excluded. No protocol name is special-cased.
Each row also carries a reader's verdict from `verdictOf()` — farm first,
worth a sized position, watch only, or small test position — derived from
the row's own TVL, 7-day growth and tokenless age, plus a five-step farm
plan that names its position size, weekly time and estimated cost.

## Run

    mkdir -p out
    MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>

Writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and
`dossier.json` (via `vendor/makefun-board.ts`) into the output directory.
Node.js 22.18 or later, standard library only.

## Layout

- `main.ts` — entry program: snapshot in, board + dashboard data + dossier out
- `lib/model.ts` — the valuation model, farm plans and the gate self-check
- `dashboard/` — static page (board, filters, sort, per-protocol detail)
- `screenshots/` — the board, a detail view and a filtered view
- `vendor/makefun-board.ts` — the kit's dossier library, vendored unchanged
