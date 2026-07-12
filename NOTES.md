# TCR service — build notes

The **TCRs** section of [histo.fyi](https://www.histo.fyi/): a Quart microapp over
prebaked structural data for 123 T cell receptors, 133 clonotypes and 206
TCR:pMHC structures. It runs standalone in development and is intended to merge
into histo.fyi as a new navbar item.

Supersedes the original skeleton notes. The skeleton (routes, models, handlers,
prebaked data) is unchanged in shape; what follows describes the front end that
was built on top of it, and the traps found on the way.

`./dev_server.sh` → http://127.0.0.1:8080/tcrs

## Routes

| Route | Page |
| --- | --- |
| `/tcrs` | Browse: sortable accordion list of all TCRs |
| `/tcrs/explore` | The COM projection viewer over all 206 structures |
| `/tcrs/{tcr_id}` | One TCR: genes + CDRs, its structures, a scoped COM viewer |
| `/tcrs/{tcr_id}/structures/{pdb_id}` | One structure: Mol\*, the interface matrix |
| `/clonotypes`, `/clonotypes/{id}` | The finer grain. Live, but not in the navbar |

Thin `*_view` (parse args) → `*_handler` (returns a dict) → `@templated('name')`
renders via `functions/templating.py::render()`. No `url_for` — nav paths live in
`config.json`, dynamic paths are f-strings.

## The shell

`templates/shared/base.html` is a **real parent template**: the whole document,
with `{% block head %}`, `{% block style %}`, `{% block breadcrumbs %}`,
`{% block main %}` and `{% block scripts %}` defined directly in it.

> **This is load-bearing.** It used to `{% include %}` a `top.html` that *defined*
> those blocks. **Jinja blocks do not cross an `{% include %}`**, so every page's
> `{% block style %}` was silently discarded and no page CSS had ever reached the
> browser. That single bug is why the early prototype looked unstyled and why the
> explore page worked around it by inlining everything into `{% block main %}`.
> `top.html` / `bottom.html` are gone. Do not reintroduce that pattern.

- `shared/components/site_style.html` — house CSS every page shares (amino-acid
  palette, `.info-table`, `.structure-table`, `.antigen-dot`, `.flag`,
  `.molstar-box` + the Mol\* chrome overrides).
- `shared/components/header.html` + `navbar.html` + `shared/svgs/histo_logo.svg`
  — the real histo.fyi navbar. **The whole microapp is the "TCRs" nav item**, so
  `current_navitem` is hardcoded to `tcrs` in `render()`; the other items link
  out to histo.fyi absolutely.
- The histo stylesheet is used **directly from histo** and never vendored:
  `https://static.histo.fyi/style.css` via `STATIC_ROUTE`.
- `main.py::asset()` — cache-busting for **our own** JS/CSS. Quart serves
  `/static` with `cache-control: max-age=43200`, so an edited file stays
  invisible to a browser that already has it for 12 hours. `molstar.js` and the
  coordinate files are deliberately *not* routed through it — they never change,
  and the long cache is what we want.

### Beware the histo stylesheet's global class names

It styles bare class names that are easy to collide with. `.main` gets
`margin-top: 60px` (it styles the page's `<main class="main">`). The COM viewer's
own inner wrapper was called `.main`, which pushed it 60px below the filter panel
beside it. It is now `.com-main`. Scope new component classes.

## Mol\*

`static/molstar.js` (5.2MB, **committed**, so the site needs no build step) is the
self-bundled Mol\* copied from `protein-design-website`. It re-exports the
selection API — `MS`, `Script`, `StructureSelection`, `StructureElement` — which
the **CDN "viewer" build does not expose**. Without it you cannot build a loci, so
you cannot focus a residue or a loop. `molstar-src/` holds the esbuild entry point
to rebuild it (needs node; not installed on this box).

`static/viewer.js` (`window.HistoTCR`):

- `load(el, url)` / `replace(viewer, url)` — Mol\*'s own **chain-id colours**
  (deliberately not a house palette), plus ball-and-stick on the peptide, which
  is too short to read as cartoon alone.
- `paintLegend(viewerId, viewer)` — reads the colours **back off the chain-id
  theme** and paints the page's legend swatches, so the legend cannot drift from
  what is rendered.
- `focusRange` / `highlightRange` / `clearFocus` / `focusResidue`.
- `autoInit()` turns every `.molstar-box[data-structure-url]` into a viewer keyed
  by DOM id in `HistoTCR.viewers`. An empty `data-structure-url` yields an empty
  viewer ready for a later `replace()` — that is the explore page's lower panel.

Drop a viewer into a page with `fragments/_molstar_viewer.html` +
`_molstar_head.html` (in `{% block head %}`) + `_molstar_scripts.html` (in
`{% block scripts %}`).

### Chain conventions

Every coordinate file has the same chains:

`A` = MHC α (heavy) · `B` = β2m · `C` = peptide · `D` = TCR α · `E` = TCR β

**Chains D and E are IMGT-renumbered.** That is what makes the CDR loops
addressable by a fixed lookup (`functions/interface.py::CDR_SELECTIONS`) rather
than a per-structure annotation, and is what the interface matrix's click-to-zoom
depends on. Chain A is *not* renumbered, but class I heavy chains share a common
numbering, so the α1/α2 helix bounds are also fixed (taken from the grant's
`structure_components.json`).

### Coordinates

`static/coordinates/` — 385 IMGT-renumbered, aligned PDB files, lower-cased.
**Gitignored** (152MB); in production they live on `coordinates.histo.fyi`.
Rebuild from `imgt_renumbered_structures.tar.gz` with the recipe in `.gitignore`.

Always resolve a path through `functions/coordinates.py`. **76 of the 206
structures exist only as altloc files** (`2f53_aligned_1_altloca.pdb`), so the
obvious f-string `{pdb}_aligned_1.pdb` 404s for a third of the set. There are also
multi-copy structures (`2ak4_aligned_1..4`). `coordinate_url()` picks the
preferred file; `coordinate_map()` gives the explore page the whole
`{PDB_ID: url}` map, because its COM points carry a PDB id but **no filename**.

## Pages

### `/tcrs` — browse

Sortable (6 orderings, server-side in DuckDB) CSS-only accordion — hidden
checkbox + `<label>` + `max-height` transition, from mimotopesdb's
`browse_collection.html`. The `<input>` must be the **first child** so the `~`
sibling selectors reach both the header icon and the content.

Each row expands to a full structure table (PDB, allele, peptide, method,
resolution, published). Publication year is not on the structure records, so
`models/tcrs.py::annotate_structure_publications()` inverts the TCR's
`publications[]` into `pdb_id → year`, and `browse_structures()` reads and caches
all 123 TCR bundles once (a browse request must not re-read them).

### `/tcrs/explore` — the COM projection viewer

All 206 footprints projected onto the 1hhk antigen-binding domain. Click a COM to
load that structure into the Mol\* panel below; click empty background to clear.

It was authored as a **standalone `height:100vh` app** and is now split across the
histo grid: `column-three-quarters` (canvas + Mol\*) + `column-one-quarter`
(filters). Its CSS is scoped under `#com-viewer`. `layout()` sizes the canvas off
`stage.clientWidth`, so it scales with the column; the original viewport cap
(58vh + scroll) was removed — on a page that just hides half the projection.

Its Mol\* panel **had never worked**: the COM points have no `file` key, so it was
building `structures/undefined`. Coordinates are now resolved server-side.

The template used to be **892KB** — a 274KB inline `DATA` blob and a 586KB base64
PNG. Both are now static files (`static/data/com_coords.json`,
`static/images/com_projection_background.png`), fetched by `static/explore.js`.
Template is now 15KB.

### `/tcrs/{tcr_id}`

The **structure information panel** (V/J genes + CDR1–3 per chain, and the pMHC it
sees) at the top, ported from mimotopesdb's TCR view. The per-TCR bundle has no
CDR1/CDR2 — they are germline (V-gene encoded) and live in the structure bundles —
so `annotate_chains()` assembles the panel from a representative **non-engineered**
structure.

Then the structure list, then a **scoped COM viewer** (`static/com_scope.js`)
showing only this TCR's structures. Wired the *opposite* way to explore: clicking
a COM does not load Mol\*, it **highlights that structure's row in the list**
(`#structure-row-{PDB}`); hovering a row lights up its COM. The list is the
subject of the page; the projection is a way into it.

Executive summaries are deliberately **not** here — they belong on the structure
pages. Publications appear as titles + links only.

### `/tcrs/{tcr_id}/structures/{pdb_id}`

Headline is what the structure *is* ("HLA-B\*27:05 presenting GQVMVVAPR to AS4.3
at 2.5Å resolution"), with the PDB code demoted to a label above it — mirroring
histo.fyi. Use `heading-medium`: `heading-extra-large` is **72px** and sets that
sentence over four lines.

Mol\* is the main event (3/4 + 1/4). Below it, the **interface matrix**.

#### The interface matrix

`functions/interface.py` + `static/interface_matrix.js`. A 6 CDR loop × 3 MHC
region bubble chart: **area = buried surface area, colour = shape complementarity**
(viridis). Hover a cell → that CDR loop highlights in Mol\*; click → it zooms.

Ported as *geometry and a data contract* from `bsi_career_enhancing_grant`. **There
is no interactive code in that repo to lift** — its chord and bubble figures are
pure matplotlib rendered to static PNG/SVG. The interactivity here is new.

Three things the source data forces, all easy to get wrong:

1. **Area, not radius, carries BSA** (radius ∝ √BSA), and it is normalised against
   the max across **all 206 structures**, not the page's own max — so a bubble
   means the same thing on every structure page. `global_bsa_max()` is cached.
2. **A multi-copy structure has 18 cells *per ASU copy*** (2AK4 has 72 rows). The
   SC rows name their copy; the **BSA rows cannot be attributed to a copy at all**
   — their `complex` field is the *system slug*, identical across copies. Cells are
   therefore **averaged over copies**, and the page says so when n > 1.
3. **21% of SC values are `NaN`.** Python's json reads NaN happily but **`NaN` is
   not valid JSON** and breaks `JSON.parse` in the browser. They are sanitised to
   `None` and drawn as a **dashed outline** — kept visually distinct from *no
   contact*, which is a small dot (35% of BSA cells are exactly zero).

## Data layer

Unchanged from the skeleton; see `data/README.md`. Worth repeating:

- Parquet index list columns are **JSON-encoded strings**; models decode them.
- The per-TCR bundle's `structures[]` use the key `peptide`; the per-structure
  bundle uses `peptide_seq` + `peptide_len`. Do not "unify" them.
- Structure files are upper-case (`1AO7.json`); URLs carry lower-case PDB ids.

## AI provenance — REQUIRED

Every `executive_summary` was written by a literature research agent, not a human.
`fragments/_executive_summary.html` renders each one **with** its
`executive_summary_attribution_html`. A summary is **never** rendered without it.

## Open

- **Chord diagram.** Deferred: it needs residue-residue contact pairs (the grant's
  `contact_maps` CSV format), which the current bundle does not carry —
  `contacts_loop_region` is only loop × region *counts*. Chris has this data
  elsewhere. Expect to build the interactivity fresh, as with the bubble matrix.
- **Two TCRs are named `nan`** (9K2R and one other) — a NaN leaked into `tcr_name`.
  `data/README.md` says these should slug to `ki-890` and `hghv4`. Data-layer bug.
- **Structure overlay** and **within-structure variability** panels not yet built.
- Explore's Mol\* panel does not reset its camera between structures.
- Desktop-only; no responsive pass has been done.

## Verified

All routes 200 (`/tcrs` incl. all 6 sorts, `/tcrs/explore`, TCR pages, structure
pages incl. multi-copy + altloc-only, clonotypes, and the not-found states).
Driven in a real browser with `shot-scraper`; Mol\* needs WebGL, so headless runs
must pass `--browser-arg=--use-gl=angle --browser-arg=--use-angle=swiftshader
--browser-arg=--enable-unsafe-swiftshader` or it renders "WebGL is not available".
Confirmed end to end: chain-coloured structures render; an explore COM click loads
the right structure; a matrix cell click focuses the right IMGT loop
(α CDR3 → `ALA 105 | D [+8 residues]`); a scoped COM click selects the right row.
