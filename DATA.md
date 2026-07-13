# Data notes — problems found, and what the site does about them

A running list of defects and awkwardnesses in the underlying data, and the
workarounds the website currently carries. **The point of this file is to be
deleted, a bit at a time**: each entry is a thing the pipeline should fix at
source so the site doesn't have to compensate. Where the site works around
something, the workaround is named so it can be ripped out when the data is
fixed.

Sources: `data/` (prebaked bundles + parquet indexes), `data/class_i_annotation.csv`
(master table), `data/interactions/*.json` (the `interaction_export` drop).

---

## Open — the pipeline should fix these

### 1. Two TCRs are literally named `nan`

`tcr_name` is the string `"nan"` for two entries — a pandas NaN that was
stringified rather than handled. They render as "nan" in the browse list.

`data/README.md` says these should resolve to **`ki-890`** (9K2R, donor code, no
published clone name) and **`hghv4`** (9D95). The `tcr_id` slugs appear to be
right; it is `tcr_name` that is broken.

**Site workaround:** none. It renders what it is given, so the bug is visible.

### 2. `NaN` in the shape-complementarity tables — not valid JSON

21% of SC cells are `NaN` (the Sc calculation legitimately fails when a patch
pair is too far apart to generate molecular dots). Python's `json` module both
reads and writes `NaN` happily, but **`NaN` is not valid JSON** — it makes
`JSON.parse()` throw in the browser, so any bundle carrying it cannot be handed
to a template as-is.

**Fix at source:** emit `null`, not `NaN`.

**Site workaround:** `functions/interface.py::_clean()` coerces every non-finite
float to `None` before serialisation.

### 3. IEDB accessions are four namespaces in one column

`iedb_antigen_accession` mixes:

| Namespace | Count (of 80 distinct) | Example |
| --- | --- | --- |
| NCBI GenBank protein | 54 | `AAG31572.1` |
| NCBI GI number (bare integer) | most of the rest | `1125014` |
| PDB chain reference | a few | `6VM8_C` |
| UniProtKB | 17 | `O43395.2`, `A0A1W2PQQ0.2` |

So there is no single resolver. Linking them all at UniProt (the obvious thing)
404s for the ~79% that are NCBI.

**Fix at source:** carry the namespace in its own column, or normalise to one
(UniProt where a mapping exists).

**Site workaround:** `functions/annotations.py::accession_link()` sniffs the
namespace by regex and sends UniProt-shaped ids to UniProt and everything else to
NCBI Protein. Both verified against the live services.

### 4. No IEDB epitope / reference id

The master table has `iedb_matched`, `iedb_source_antigen`,
`iedb_source_organism`, `iedb_antigen_accession`, `iedb_tcr_alpha_v`,
`iedb_tcr_beta_v` — but **no IEDB epitope id or reference id**. So there is
nothing to link back to IEDB with, only the source protein.

**Fix at source:** carry the IEDB epitope id. (Chris is having Claude Science
generate these.)

### 5. IEDB coverage is partial, and "matched" overstates it

`iedb_matched` is `True` for 204 of 206 — but only **152** carry a
`iedb_source_antigen`. So a structure can be "matched" and still have nothing to
show.

**Site workaround:** the structure page keys off the presence of
`iedb_source_antigen`, not `iedb_matched`, and renders no IEDB rows at all when
it's absent.

### 6. Publication year is not on the structure records

The per-TCR bundle's `structures[]` carry `deposition_date` but no publication
year; the year lives on `publications[]`, which lists the PDB ids each paper
reported.

**Site workaround:** `models/tcrs.py::annotate_structure_publications()` inverts
`publications[]` into a `pdb_id -> year` map and stamps it onto each structure.

### 7. The COM points carry no coordinate filename

`com_coords.json` figure points have `pdb` but no `file`, while the viewer's
loader was written as `DATA.structDir + p.file` — i.e. it was building
`structures/undefined`. **The explore page's Mol\* panel could never have
worked.** (See also #8: a filename couldn't have been derived on the client
anyway.)

**Fix at source:** carry `file` (the coordinate-file stem) on each point. The
`interaction_export` JSONs already do this — they key on
`<PDB>_aligned_<complex>[_altloc<X>]` and carry `file` — so the COM data should
simply do the same.

**Site workaround:** `functions/coordinates.py::coordinate_map()` builds a
`{PDB_ID: url}` map server-side and hands it to the page.

### 8. A third of structures have no plain `_aligned_1.pdb`

**76 of the 206** structures exist *only* as altloc files
(`2f53_aligned_1_altloca.pdb`), and many have several ASU copies
(`2ak4_aligned_1..4`). So the obvious filename convention `{pdb}_aligned_1.pdb`
**404s for a third of the set** — a trap anything constructing paths will fall
into.

**Site workaround:** all path construction goes through
`functions/coordinates.py`, which indexes what is actually on disk and picks the
preferred file (first copy, first altloc).

### 9. `overall_completeness_pct` — whole complex, or TCR chains only?

The structure page's completeness note now says "the TCR chains overall", but the
field is named `overall_completeness_pct` and the row is labelled just "Overall".
**Unresolved:** if the figure really is TCR-chains-only the name is misleading;
if it is whole-complex, the page copy is wrong. Needs confirming, and the column
renaming to match.

### 10. Two `peptide` keys for the same thing

The per-TCR bundle's `structures[]` use `peptide`; the per-structure bundle uses
`peptide_seq` (+ `peptide_len`). Templates must read the right one per shape.
`data/README.md` explicitly warns not to "unify" them, so this looks deliberate —
but it is a foot-gun.

---

## Fixed by the `interaction_export` drop

### 11. BSA could not be attributed to an ASU copy — *now fixed*

In the **old** structure bundles, a multi-copy structure carries 18 SASA/SC cells
*per copy* (2AK4 has 72 rows), but the BSA rows' `complex` field is the **system
slug** (`hla_b_35_08__lpeplpqgqltay`), identical across every copy — so there was
no way to say which copy a BSA figure belonged to. The SC rows did identify their
copy (`2AK4_aligned_1`), so the two tables disagreed with each other.

**Site workaround (now removable):** `functions/interface.py` averages each cell
over the copies and tells the reader it has done so.

**Fixed by:** `data/interactions/*.json` are keyed by *structure id*
(`1AO7_aligned_1`, `3PWP_aligned_1_altlocA`) throughout, so every table is
per-copy and they agree. The averaging can go once the matrix is rebuilt on it.

---

## Not a data problem, but worth recording

### TCR3d has no per-structure URL

All 206 structures are in TCR3d, but it has **no per-structure page** to link to:
its class-I set is a single browse table with every row embedded as JSON, and the
only per-PDB link it renders is *outward* to ATLAS.

So the structure page links **PDBe** (all), **STCRDab** (the 159 that
`sources` says it holds) and **ATLAS** (139) — and cannot link TCR3d, however
much we'd like to. `sources` on the master table is what gates each link.
