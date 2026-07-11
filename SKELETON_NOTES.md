# TCR service — app skeleton notes

Step 2 of the agreed build order: a thin, working Quart microapp that renders
the real prebaked data. Minimal styling only — the full front-end pass (card
visuals, COM viewer, chord diagram, SC/BSA panels, Mol*) is deliberately later.

## What was built

- **App factory + config** — `main.py::create_app()`, `config.json` loaded into
  `app.config`, secrets read from the environment, `git_commit` captured at
  startup, `trim_blocks`/`lstrip_blocks` set. `pyproject.toml` (Python ≥3.14;
  quart, duckdb, polars, jinja2, hypercorn, pyarrow, fastparquet). `dev_server.sh`
  runs `uv run python -m quart --app main:app` on port 8080.
- **Six routes** as thin `*_view` → `*_handler` pairs:
  - `/tcrs` — sortable card grid + accordion. `?sort=` → 6 orderings
    (deposition / name / n_structures × asc/desc), sorted server-side in DuckDB.
  - `/tcrs/explore` — COM viewer page; route + template slot wired, viewer
    component dropped in a later pass (the 880KB viewer is not embedded).
  - `/tcrs/{tcr_id}` — per-TCR page from `data/tcr/{tcr_id}.json`.
  - `/tcrs/{tcr_id}/structures/{pdb_id}` — deep dive from `data/structure/{pdb_id}.json`.
  - `/clonotypes` and `/clonotypes/{clonotype_id}` — the finer grain (built, not
    stubbed).
- **models/** — `Tcr`, `Clonotype` (DuckDB over the parquet index for the
  sortable browse + JSON file read for detail), `Structure` (JSON file read).
  All subclass a shared `Model` base. No ORM.
- **functions/** — `decorators.py` (`@templated`), `templating.py` (`render()`),
  `slugs.py`, `common.py` (`run_query`).
- **templates/** — `shared/base.html` + `shared/components/*` shell linking the
  histo stylesheet via `STATIC_ROUTE`; one template per route; the named
  partials `_tcr_card.html`, `_structure_row.html`, plus `_executive_summary.html`.

## mimotopesdb idioms reused (verbatim or near-verbatim)

- `create_app()` factory + flat route table in `main.py` (no blueprints).
- Package split: `handlers/` (context-dict functions), `functions/`, `models/`,
  `templates/`. `handlers/__init__.py` re-exports every handler.
- Thin `*_view` (parse args → delegate) → `*_handler` (returns a plain dict);
  the single `@templated('<template>')` decorator renders via `render()`.
- `render()` injects site globals (`static_route`, `site_title`, nav items,
  colour maps, `git_commit`, `current_navitem`).
- `functions/decorators.py`, `functions/templating.py`, `functions/slugs.py`,
  `functions/common.py::run_query` ported from the house versions.
- `Model` base with `build_read_fragment`/`build_base_query`; object models
  named `Tcr`/`Structure`/`Clonotype` with `get_one`/`get_all`; domain
  annotation (`annotate_index_record`) as module-level functions in the model
  file, mirroring `annotate_record` in mimotopesdb's `tcrs.py`.
- **Literal-path + slug URL construction, NO `url_for`** — nav paths in
  `config.json`, `href`s typed out, dynamic paths built as f-strings.
- Template shell = `top.html`/`bottom.html` includes; `{% extends "shared/base.html" %}`
  + `{% block main %}` for pages; `{% include %}` for partials; template
  filters (`deslugify_allele`, `sequence_display`, …) registered in `main.py`.
- The CSS-only checkbox accordion pattern (from `browse_collection.html`) drives
  the card structure-list expand without JS.

## Deliberate deviations from mimotopesdb (flagged for review)

1. **`/tcrs` serves the index, not a redirect.** mimotopesdb redirects
   `/tcrs` → `/browse/tcrs/all`. The brief specifies `/tcrs` *is* the sortable
   card grid for this standalone microapp, so I followed the brief. No `/browse`
   namespace exists here.
2. **Model method naming.** The brief's loader sketch names free functions
   (`get_tcr_index(sort=…)`, `get_tcr(tcr_id)`); the house pattern (which the
   brief also says to match exactly) uses object-model classes with
   `get_one`/`get_all`. I built the house class shape (`Tcr().get_all(sort=…)`,
   `Tcr().get_one(tcr_id)`) since that's the load-bearing convention repeated
   across every mimotopesdb model. **Confirm this is the wanted shape.**
3. **`current_navitem` set by handlers.** mimotopesdb derives the nav key from
   the template filename (`template_name.split('_')[0]`), which here would give
   `tcr`/`clonotype`/`structure` — none of which match a nav slug, and which
   would highlight both `TCRs` and `Explore` together. I kept the filename
   derivation as the fallback in `render()` but have each handler set
   `current_navitem` explicitly (`tcrs`/`clonotypes`/`explore`). **Confirm.**

## Data-shape notes (worth knowing before the front-end pass)

- Parquet index list columns (`trav`, `alleles`, `peptides`, `antigen_types`,
  `pdb_ids`, …) are **JSON-encoded strings**; models decode them to lists in
  `annotate_index_record`.
- The per-TCR bundle's `structures[]` items use the key `peptide`; the per-
  structure deep-dive bundle uses `peptide_seq` + `peptide_len`. The templates
  read the correct key for each shape — do not "unify" them.
- Clonotype detail files are `CL001.json` (upper-case); `Clonotype.get_one` is
  case-tolerant. Structure files are `1AO7.json` (upper-case); `Structure.get_one`
  upper-cases the incoming slug (URLs carry lower-case PDB ids).
- Antigen types in the data: `tumour`, `pathogen`, `autoimmune`, `alloreactive`,
  `unresolved`. Methods: `x_ray`, `cryo_em`. `ANTIGEN_COLORS` (config.json,
  IBM palette) drives the card dots.
- `AA_COLORS` covers all 20 residues incl. Cysteine, and `top.html` has a
  matching `.bg-c` rule (CDR3 sequences begin with a conserved C).

## AI-provenance (REQUIRED — implemented)

`fragments/_executive_summary.html` renders every `executive_summary` **with**
its `executive_summary_attribution_html` (`<smaller>Summary generated by a
literature research agent in Claude Science</smaller>`). It is used on both the
per-TCR page (one block per publication) and the structure deep dive. A summary
is never rendered without the attribution. Verified: A6's page emits 7
attribution snippets (one per publication summary); 1AO7's deep dive emits 1.

## Verification (how I confirmed it runs)

- App imports cleanly; `create_app()` builds the factory.
- Exercised all routes via the Quart test client AND a live hypercorn dev
  server over HTTP — all return 200 (missing-entity ids render their in-page
  "not found" state, still 200). Sample:
  `/tcrs`, `/tcrs?sort=name_asc`, `/tcrs/explore`, `/tcrs/a6`,
  `/tcrs/a6/structures/1ao7`, `/clonotypes`, `/clonotypes/CL001`.
- Content assertions on rendered HTML: 6 sort orderings produce distinct first
  cards (newest N17.3.2 / oldest A6 / name_asc 0606T1-2 / most-structures A6);
  all 123 TCR cards render; the histo stylesheet is linked; nav active-state is
  correct; AI-provenance attribution present on every summary; DOI/PMID links,
  CDR sequences and alleles render from the real bundles.

## Deliberately left for later passes

- **Front-end pass:** real card styling, typography polish, the IBM-palette
  visual language. Current CSS is inline-minimal, just enough to read the data.
- **COM viewer** (`/tcrs/explore` + scoped on per-TCR pages) — component exists,
  dropped in later.
- **Mol\* viewer, structure overlay, SC/BSA bubble-matrix, COMs-on-ABD,
  within-structure variability** — placeholder slots are in the templates; the
  structure bundle already carries the data (`shape_complementarity`, `bsa`,
  `com_px`, `completeness`, `contacts_loop_region`).
- **Interactive chord diagram** — the dedicated last pass; needs residue-residue
  contact pairs not yet in the bundle (see data README TODO).
- No `send_file` CIF/PDB serving yet — the aligned coordinate files live on
  `coordinates.histo.fyi`; wire when the viewer lands.

## Open questions raised

- Model method shape (classes/`get_all` vs free functions/`get_tcr_index`)?
- `current_navitem` handled by handlers — acceptable, or prefer another scheme?
- `/tcrs` as index (confirmed from brief) vs the mimotopesdb redirect idiom.
