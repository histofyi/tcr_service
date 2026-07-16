# Data flow — what the data is, where it comes from, and what happens to it at runtime

This is the reference for the service's **data layer**: the sources it reads, and
the transformations it applies to them — which happen once per process, and which
happen on every request.

It sits alongside two other data docs, and defers to them rather than repeating:

- **`data/README.md`** — the *file layout*: what each bundle and index contains,
  field by field. Read that for "what's in a structure bundle".
- **`DATA.md`** — the *defect log*: where the underlying data is wrong or awkward and
  what the site does to compensate. Read that for "why does the code work around X".
  Every workaround named below is explained there.

This file is the connective tissue between them: the path a byte takes from an S3
object to a rendered page.

---

## 1. Where the data comes from

The service renders **prebaked** data. It computes almost nothing about the biology
itself at runtime — the structural analysis was done upstream, by the **Claude
Science** pipeline, and shipped as static files. The chain:

```
RCSB / PDBe                 206 canonical TCR:pMHC:TCR structures (class I)
  │
  ▼
Claude Science pipeline     IMGT renumbering + 1hhk alignment of coordinates;
  │                         PDBe-Arpeggio contacts; SASA / shape-complementarity;
  │                         completeness QC; centre-of-mass projection;
  │                         literature-agent executive summaries
  ▼
prebaked artefacts          master table (CSV) · per-page JSON bundles ·
  │                         parquet browse indexes · interaction export (JSON) ·
  │                         aligned coordinate files (PDB) · PDBe publications
  ▼
this repo (data/ + static/) in production these live in S3; the repo mocks that
                            layout locally
```

Provenance notes worth carrying:

- The coordinates are **IMGT-renumbered and 1hhk-aligned** upstream. That is what
  lets the site treat CDR loops as sitting at canonical residue numbers in every
  structure, and lets the TCR-page overlay superpose structures without fitting.
- Every `executive_summary` was written by a **literature-research agent, not a
  human**. The bundles carry an attribution string that the front end is required to
  render with the summary (`data/README.md`, "AI provenance").
- The master table is **v17** (`class_i_annotation.csv`); the parquet indexes and
  JSON bundles are generated from it plus the pipeline tables.

## 2. What lives where

| Path | Kind | Read by | Held how |
| --- | --- | --- | --- |
| `data/tcrs.parquet` | Browse index | DuckDB, per request | not cached |
| `data/tcr/<id>.json`, `data/structure/<PDB>.json` | Per-page bundles | `json.load`, per request | not cached |
| `data/clonotypes.parquet`, `data/clonotype/<id>.json`, `data/clonotypes_index.json` | Clonotype data | **nothing** — views held back from MVP | on disk, unused |
| `data/class_i_annotation.csv` | Master table (IEDB, external DB sources, gene calls) | `functions/annotations.py` | cached for process life |
| `data/interactions/*.json` | Contacts, neighbours, SASA, shape-complementarity | `functions/interface.py` | cached for process life |
| `data/pdbe_publications.json` | Author lists | `functions/publications.py` | cached for process life |
| `static/coordinates/*.pdb` | Aligned coordinate files (152 MB, 385 files; gitignored) | Mol\* (browser) + `functions/residues.py` | index + per-file parses cached |
| `static/data/com_coords.json` | Centre-of-mass points for the Explore viewer | browser (`explore.js`) | — |
| `config.json` | COM projection geometry, colour palettes, chain labels, nav | loaded at `create_app()` | held on `app.config` |

The 206 structures roll up into **123 TCR** pages. They also roll up into 133
clonotypes (the finer TRAV/TRBV/CDR3 grain), but **the clonotype views are held back
from the MVP** — the data is still on disk and the parquet index still builds, but no
route serves it. See `data/README.md` for how the page units relate.

## 3. Transformations at process start (cached for the process lifetime)

These run **once**, the first time something needs them, and the result is held for
the life of the worker process via `functools.lru_cache`. They are the service's
"first run" cost. None has a TTL — see §5 for what that means.

| Function | File | What it builds | Cache |
| --- | --- | --- | --- |
| `_annotations()` | `annotations.py` | master CSV → `{PDB_ID: row}`, upper-cased keys | `maxsize=1` |
| `_publications()` | `publications.py` | publications JSON → `{PDB_ID: record}` | `maxsize=1` |
| `_dataset(name)` | `interface.py` | one `interactions/*.json` loaded into memory | `maxsize=4` (all four) |
| `_structure_id_index()` | `interface.py` | case-insensitive map from lower-cased id → real export key (works around DATA.md #10) | `maxsize=1` |
| `global_bsa_max()` | `interface.py` | largest BSA cell across **all** structures — the shared bubble-area scale on the structure page | `maxsize=1` |
| `global_trimmed_area_max()` | `interface.py` | largest trimmed-area cell across all structures — the shared scale for the TCR-page panel | `maxsize=1` |
| `_coordinate_index()` | `coordinates.py` | scans `static/coordinates/`, maps each PDB id to its files, best copy/altloc first (works around DATA.md #8) | `maxsize=1` |
| `_chain_residues()`, `_chain_atoms()`, `_attached_groups()` | `residues.py` | per-coordinate-file parses, for residue numbering and PTM detection | `maxsize=32` |
| `_numbering()` | `interface.py` | per-file residue numbering for chord resolution | `maxsize=32` |
| `browse_structures()`, `_donor_codes()` | `models/tcrs.py` | the structures-per-TCR accordion map; the donor-code fallback for unnamed TCRs (DATA.md #1) | `maxsize=1` |

The per-file caches (`maxsize=32`) are keyed by filename, so they warm up as
structures are visited rather than all at once. The `maxsize=1` caches build on first
use and never change.

`config.json` is loaded once in `create_app()` and lives on `app.config`; the git
commit stamp is computed once there too.

## 4. Transformations per request (the page-load path)

Everything a *specific* page needs is assembled fresh on each request, from the
cached datasets above plus fresh reads of the two per-request sources (parquet via
DuckDB, and the individual JSON bundles). Nothing here is cached.

A structure-page request (`/tcrs/<tcr>/structures/<pdb>`) is the fullest example.
`handlers/structures.py` assembles its context by calling:

- `Structure().get_one(pdb)` — **fresh `json.load`** of the bundle each request.
- `cdr_residues()` / `peptide_residues()` (`residues.py`) — read real residue numbers
  from the *cached* coordinate parse, cross-check against the bundle's sequence, and
  (for the peptide) flag covalently modified residues geometrically (DATA.md #17).
- `interface_matrix()` (`interface.py`) — the 6×3 bubble matrix, joined per request
  from the cached SASA / SC / contacts datasets for this structure's copy.
- `residue_chord()` (`interface.py`) — the residue-level chord, resolved against the
  cached coordinate numbering; `omitted_residues()` notes inserted residues the
  contacts drop (DATA.md #16).
- `iedb_annotation()`, `external_links()`, `publication_authors()` — lookups into the
  cached annotation and publication tables.
- `parse_residue_token()` — validates a `?residue=` query arg against the residues
  this page can actually show.

A TCR-page request (`/tcrs/<tcr>`) is similar: `Tcr().get_one()` fresh-loads the
bundle and `annotate_tcr_name()` / `annotate_chains()` / `annotate_structure_publications()`
assemble the header, gene panel and per-structure publication years; `interface_panel()`
builds the cross-structure grid; `footprint_spread()` computes between-structure
variability.

The browse index (`/tcrs`) is the one genuinely query-driven page:
`Tcr().get_all(sort)` runs a **DuckDB `ORDER BY` over the parquet on every request**
(list-valued columns are JSON-decoded back into Python), then `annotate_index_record()`
tidies each row.

Finally, `functions/templating.py::render()` injects the config globals (routes,
colours, chain labels, COM projection geometry, nav) into every template context, and
the `asset()` helper stamps each static-asset URL with the file's mtime for
cache-busting — an `os.path.getmtime` per asset per render.

## 5. The caching model, and its one sharp edge

Two different caching regimes are in play, and the difference matters:

- **`@lru_cache` (§3) is process-lifetime with no TTL.** It is cleared only by
  restarting the worker. This is the right call — the underlying files don't change
  under a running server in production — but it has a **development gotcha**: editing
  a file in `data/interactions/`, `class_i_annotation.csv`, `pdbe_publications.json`
  or `static/coordinates/` has **no effect until the server is restarted**. The cache
  is still serving the version read at first use.

  (There is a matching gotcha one layer up, in the templates: the dev server runs with
  debug off, so **Jinja does not reload templates** either. A template edit also needs
  a restart to show up.)

- **The per-request path (§4) reads fresh every time.** Editing a `data/tcr/*.json`
  or `data/structure/*.json` bundle, or a `*.parquet` index, **is** picked up on the
  next request without a restart — at the cost of re-reading and re-decoding that file
  on every hit. That per-request cost is deliberate and cheap at this scale (one small
  JSON, or one DuckDB scan of a small parquet), but it is why the *shared, large*
  datasets in §3 are cached and the *per-page* bundles are not.

Rule of thumb while developing: **changed an interactions file, the CSV, the
publications file, a coordinate file, a template, or `config.json`? Restart.** Changed
a per-page JSON bundle or a parquet index? Just reload the page.
