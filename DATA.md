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

### 1. Two TCRs have no name — and it breaks in two different ways at once

9K2R and 9D95 have no published clone name. That is fine; how it is *carried* is
not, because the two stores disagree:

| Store | Value | Rendered as |
| --- | --- | --- |
| `tcrs.parquet` (index) | float `NaN` | the string **"nan"** |
| `data/tcr/*.json` (bundle) | `null` | **nothing** — an empty page heading |

Only one of the two was ever visible at a time, which is why it looked like one
bug rather than two.

**Fix at source:** carry a real value. The bundle for 9K2R already knows its
**donor code (KI-890)** and carries a `naming_note` explaining there is no clone
name — that is a real identifier and should be the name.

**Site workaround:** `models/tcrs.py::annotate_tcr_name()` normalises all three
cases in the model layer, so every consumer agrees. 9K2R uses its donor code;
9D95 has nothing to fall back on and shows "Unknown".

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

### 10. Structure ids and coordinate filenames disagree on case

The interaction export keys on `7N2P_aligned_1_altlocA` — upper-case PDB id,
**upper-case altloc letter**. The coordinate files are lower-cased on disk
(`7n2p_aligned_1_altloca.pdb`), which is how the site serves them.

Reconstructing one from the other by upper-casing the PDB id looks right and
works for most structures — then **silently returns nothing for every altloc-only
structure**, which is a third of the set. It fails quietly: you get an empty
interface matrix, not an error.

**Fix at source:** settle on one case convention across coordinate files and
data keys.

**Site workaround:** `functions/interface.py::_structure_id_index()` matches
case-insensitively against the keys that actually exist, rather than constructing
the key.

### 11. No residue-level contacts — the chord cannot be drawn as designed

The chord diagram is meant to be **residue × residue**, with residues grouped by
CDR loop / peptide / α1 / α2 (as in the grant's figures). Nothing in the export
supports that. Every layer aggregates to **CDR-loop × MHC-region**:

| File | Grain |
| --- | --- |
| `contacts_by_structure.json` | `{cdr_loop, region, bond_type, n_atom_pairs}` |
| `neighbours_by_structure.json` | `{cdr_loop, region, n_atom_pairs}` |
| `interaction_com_raw.json` (the raw source) | `ct_bond_types` keyed `CDR1_alpha\|alpha1\|proximal` |

`nb_residue_contacts` is a **count** (e.g. 63), not the pairs. No file carries
`chain / resnum / resname` on either side of a contact.

The only residue-level data anywhere is the grant's `contact_maps/*.csv` —
columns `chain_1, resnum_1, resname_1, atom_1, chain_2, resnum_2, resname_2,
atom_2, interaction_types, distance, tcr_chain, cdr_loop` — and it covers **10 of
the 206** structures.

**Fix at source:** emit the grant's `contact_maps` format (or equivalent) for all
206. `bsi_career_enhancing_grant/code/compute_contact_maps.py` already produces
exactly this from PDBe-Arpeggio; it just needs running over the full set.

**Site workaround:** the chord is drawn at loop × region for now, with ribbon
width = atom pairs and a "specific bonds only" toggle (Arpeggio's `proximal`
catch-all is ~90% of all pairs).

### 13. α1 / α2 are defined two different ways — and the shipped data uses the wrong one

Two definitions of the MHC regions are in circulation:

| Source | α1 | α2 |
| --- | --- | --- |
| `bsi_career_enhancing_grant/structure_components.json` | A **50–86** (helix only) | A **137–180** (helix only) |
| `interaction_export` (what we currently ship) | A 1–90 (whole domain) | A 91–180 (whole domain) |

**Decided: helix-only.** The TCR reads the helices flanking the groove; the β-sheet
floor beneath them is not part of the recognised surface, and including it dilutes
the signal.

So **every interaction file we currently hold is built to the wrong definition** —
not just the contacts, but `sasa_by_structure` and
`shape_complementarity_by_structure` too, whose MHC *patches* are defined the same
way. An "α1" buried-area figure on the site today includes the sheet floor.

**Fix at source:** regenerate all five files (contacts, residue-level contacts,
neighbours, SASA, SC) to 50–86 / 137–180. Expect every count to fall — fewer
residues are in scope. See `briefs/residue_contacts/BRIEF.md` §4.

**Site workaround:** none, deliberately. `functions/interface.py::MHC_SELECTIONS`
still uses the whole-domain bounds so the Mol\* highlight describes the same
residues the numbers are computed over. Changing one without the other would be
worse than leaving both wrong: clicking an "α1" cell would light up a region the
figure doesn't refer to. **Switch both together when the data lands.**

### 14. Two `peptide` keys for the same thing

The per-TCR bundle's `structures[]` use `peptide`; the per-structure bundle uses
`peptide_seq` (+ `peptide_len`). Templates must read the right one per shape.
`data/README.md` explicitly warns not to "unify" them, so this looks deliberate —
but it is a foot-gun.

---

## Resolved

### 4. No IEDB epitope / reference id — RESOLVED

**RESOLVED** — the master table now carries `iedb_epitope_ids`,
`iedb_epitope_id_count` and `iedb_primary_epitope_id` (2026-07-13).

**204 of 206** structures have an epitope id — far better coverage than the source
antigen (152), and it is what the peptide is now linked to
(`iedb.org/epitope/<id>`).

Worth knowing: a peptide can map to **several** IEDB epitopes — 1OGA's `GILGFVFTL`
has twelve — hence the primary id plus the full `;`-separated list. And the epitope
id and the source antigen are **independent**: 52 structures have an id and no
antigen, so a panel keyed off the antigen alone (as ours used to be) showed them
nothing.

### 15. Ten coordinate files had a non-standard chain order — RESOLVED

**RESOLVED** by the revised coordinate drop (2026-07-13).

Ten of the 206 files did not letter their chains in `A,B,C,D,E` order — 9ZCL ran
`C,A,B,D,E`; 7L1D, 8RRO, 9HLJ and 9WBD ran `D,E,A,B,C`. The chains were correctly
*named*; they simply appeared in a different order.

That matters because **Mol\*'s `chain-id` colour theme assigns colours by chain
INDEX, not by chain id**, so a colour meant a different chain on those pages — the
peptide came out MHC-green. It surfaced twice: once in the cartoon, and again in
the side chains Mol\* draws when focusing a residue (`element-symbol` colours its
carbons with a `chain-id` sub-theme). See BUGS.md #1 and #12.

The revised drop reletters everything to `A,B,C,D,E`.

**Site workaround (kept):** the cartoon pins Mol\*'s palette to the chain
**letter**, so it no longer depends on file order at all. The focus side chains
still use Mol\*'s own theme and therefore still depend on it — that is the one
place a future odd-ordered file would show up first.


### 9. `overall_completeness_pct` is not "overall" — RESOLVED

**RESOLVED** — answered by Claude Science, 2026-07-13. The site now labels it
correctly; one pipeline action remains (renaming the column).

It is It is **neither** the TCR chains alone **nor** the
whole structure. It is a QC metric over the interface-defining regions plus the TCR
variable domains — the fraction of residues present across:

- MHC α1 helix (A 50–86)
- MHC α2 helix (A 137–180)
- peptide (chain C)
- TCR α and β **variable** domains (chains D, E)

counting **internal disorder only** (Cα backbone breaks > 4.2 Å for the TCR; missing
residues within the modelled span for peptide/MHC). Chain-terminal truncation is
ignored. It excludes β2-microglobulin (chain B) and the MHC α3 domain / the
non-helix parts of α1–α2.

**So the column name is actively misleading** — "overall" means neither of the two
things a reader would assume, and both my first guess and the page's original copy
were wrong.

**Fix at source:** rename it to something that says what it measures, e.g.
`groove_and_tcrv_completeness_pct`.

**Site workaround:** the row is labelled "Groove & TCR V domains", not "Overall",
and the note spells out what is and isn't counted.

*(Note this metric already uses the **helix-only** α1/α2 bounds — 50–86 / 137–180 —
which is further support for #13.)*


### 12. BSA could not be attributed to an ASU copy — RESOLVED

**RESOLVED** by the `interaction_export` drop.

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
