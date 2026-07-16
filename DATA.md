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

**Site workaround (partial):** the *numbers* are left alone — `MHC_SELECTIONS` still
uses the whole-domain bounds so the Mol\* highlight describes the same residues the
figures are computed over. Changing one without the other would be worse than leaving
both wrong: clicking an "α1" cell would light up a region the figure doesn't refer to.
**Switch both together when the data lands.**

What *did* change is the **label**: `MHC_LABELS` reads `α1` / `α2`, not "α1 helix" /
"α2 helix", on both the structure-page matrix and the TCR panel. The word "helix"
claimed a precision the whole-domain numbers don't have. Put it back when the
regenerated data lands and the numbers are genuinely helix-only.

### 14. Two `peptide` keys for the same thing

The per-TCR bundle's `structures[]` use `peptide`; the per-structure bundle uses
`peptide_seq` (+ `peptide_len`). Templates must read the right one per shape.
`data/README.md` explicitly warns not to "unify" them, so this looks deliberate —
but it is a foot-gun.

### 16. The residue-level contacts DROP every insertion-coded residue

`contacts_by_structure.json` names each contacting residue by chain and number only,
with no insertion code. But **57 structures have insertion codes** in the TCR chains,
and IMGT puts them exactly where the contacts are: 1AO7 has both `E:112` and
`E:112A`, and both sit in CDR3β. **427 contacts across 60 of the 206 structures** land
on a residue number that has an insertion-code twin.

That looks like an ambiguity — a contact on `E:112` could be either residue. **It is
not. It is a hole.** The export never refers to an inserted residue at all:

* All **427** of those contacts carry the residue name of the **icode-free** twin.
  Not one names an inserted twin.
* Their `min_distance` is the icode-free twin's distance **even where the inserted
  twin is closer**. 1AO7's row for `E:112`–`C:7` reports 3.97 Å, which is `E:112`'s
  distance; `E:112A` is at **3.95 Å**. A row covering both would have said 3.95.
* `sum(residues[].n_atom_pairs) == ct_total_atom_pairs` for all 385 records — so the
  rows are not merged either. The inserted residues are simply not counted.

So the rows are unambiguous, and the real defect is that **contacts made by
insertion-coded residues are missing from the data entirely**. This is not a footnote:

| | |
| --- | --- |
| CDR-loop residues with an insertion code | **95**, across 63 structures |
| …of those, within 5 Å of the MHC or peptide | **75**, across **51** structures |
| …closest | **5JHD `D:112A`, at 2.04 Å** — a hydrogen bond |
| …appearing anywhere in `contacts_by_structure.json` | **none** |

IMGT numbers CDR3 insertions **inward from the apex of the loop** — which is the part
of the receptor most likely to be lying on the peptide. The residues being dropped
are, systematically, some of the most important ones at the interface. The total,
183,925 atom pairs, is byte-identical to the previous loop-level file, so the
aggregate `bonds[]` — and therefore the interface matrix — has always had the same
blind spot.

**Fix at source:** the contact computation is filtering on `insertion_code == ''`
somewhere (or keying a dict on the residue number). Include inserted residues, and
carry `from_icode` / `to_icode` on every row — the residue number alone is not a key.
Expect the counts to *rise*.

**Site workaround:** none is possible — the contacts do not exist and cannot be
invented. `functions/interface.py::_resolve()` resolves every contact to the
icode-free residue, which is provably the right one, so the chord's clicks are exact.

`omitted_residues()` still computes the inserted CDR residues that have no contact row
(it reads them back from the coordinates, and they ride along in the `chord` dict as
`chord.omitted`), but the structure page **no longer displays them**: the "Not shown:
E:112A" note under the chord was removed to declutter the panel. So the ring is drawn
with silent holes in it after all — the omission is tracked here and available to the
template, but not currently surfaced to the reader.

### 17. A modified peptide is not flagged anywhere, and the coordinates have no LINK records

`peptide_seq` gives the parent residue at every position, so a modified peptide is
indistinguishable from an unmodified one in the data. There are two kinds, and the
second cannot be seen in the data at all:

* **The residue itself is non-standard.** 3D39 (`PFF`) and 3D3V (`F2F`) — the
  fluorinated phenylalanines those two structures are *about* — and 8SHI (`ABA`).
  `peptide_seq` says `F`, `F`, `A`. At least these are visible in the coordinates,
  as a HETATM residue in the peptide chain.
* **The residue is standard but carries a covalently attached group.** 2GJ6's Lys5
  holds the `3IB` hapten, modelled as its own residue on chain C. `peptide_seq` says
  `K` and the coordinates say `LYS`. Nothing marks the attachment.

**And the coordinate files carry no `LINK` records**, so the attachment cannot be
read — it has to be inferred from geometry.

**Site workaround:** `functions/residues.py` finds the bond by distance — a
non-solvent group on the peptide chain, and the peptide atom it sits within 2.0 Å
of. (2GJ6: `3IB` C13 to `LYS` 5 NZ is 1.33 Å.) That needs a solvent/cryoprotectant
exclusion list, because chain C also carries waters, glycerol, iodide and the rest.
Both kinds then render as **X** in the parent residue's colour.

**The pipeline should** flag modified peptide positions explicitly — the modified
residue's component id, and for an attached group the residue it is attached to —
rather than leaving the site to rediscover it from atom distances. Across all 206
structures there are exactly four: 2GJ6, 3D39, 3D3V, 8SHI. Preserving `LINK` records
in the renumbered coordinates would also do it.

### 18. Author lists are truncated to three, and nothing says so

`pdbe_publications.json` covers all 206 structures and every entry has authors — but
the lists are cut off at three names, and **no field records the true count**:

| Names in the entry | Entries (of 207) |
| --- | --- |
| 3 | 198 |
| 2 | 6 |
| 1 | 3 |

1AO7's paper has **six** authors (Garboczi, Ghosh, Utz, Fan, Biddison, Wiley); the
file gives three. So a three-name entry cannot be told apart from the first three of
thirty, and printing those three as *the* authors would assert an authorship that is
usually false.

**Site workaround:** `functions/publications.py` treats three names as "at the cap,
therefore unknown" and the citation renders *et al.* — true whether the paper has four
authors or forty. Entries with one or two names are complete (nothing truncates to
fewer than the cap) and are shown in full.

**The pipeline should** carry the full author list, or failing that a total count
alongside the truncated list, so a correct citation can be built.

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

### 11. No residue-level contacts — the chord cannot be drawn as designed — RESOLVED

**RESOLVED** by the revised `contacts_by_structure.json` (2026-07-13).

The chord diagram is meant to be **residue × residue**, grouped by CDR loop /
peptide / α1 / α2 (as in the grant's figures). The first export could not support
it: every layer aggregated to **CDR-loop × MHC-region**, and `nb_residue_contacts`
was a *count*, not the pairs — no file carried `chain / resnum / resname` on either
side of a contact. The only residue-level data anywhere was the grant's
`contact_maps/*.csv`, covering 10 of the 206.

The revised file now carries a `residues[]` block per structure — `{from_chain,
from_residue, from_aa, to_chain, to_residue, to_aa, n_atom_pairs, min_distance,
bond_types}` — for all 206, and `functions/interface.py::residue_chord()` builds the
diagram from it. `static/chord.js` draws one arc per residue and one ribbon per pair.

**One caveat carries over as its own entry:** those `residues[]` rows silently drop
every insertion-coded residue. That is not a grain problem but a completeness one, so
it is tracked separately and is still open — see #16.

---

## Not a data problem, but worth recording

### The two charts size their bubbles by DIFFERENT quantities — on purpose

| Chart | Bubble area | Field | Source record |
| --- | --- | --- | --- |
| Structure page, *Interface* | Buried area | `bsa_total` | `sasa_by_structure.json` |
| TCR page, *The interface, across every structure* | Trimmed area | `trimmed_area` | `shape_complementarity_by_structure.json` |

They are **not** rescalings of each other — 1AO7's αCDR3/peptide cell is 63.3 Å²
trimmed and 127.1 Å² buried, and the ratio is not constant.

Trimmed area is the area of the patch the Sc calculation actually scored, so it is
the area that belongs beside an Sc colour; buried area is the surface lost on
contact, which is what people usually mean by "interface size". Both are wanted, and
the TCR panel deliberately mirrors the grant's published figures.

**So each chart's size legend names its own quantity** ("Buried area" / "Trimmed
area"). Do not "unify" them by relabelling one to match the other — the labels are
the only thing telling a reader that a bubble here and a bubble one click away are
not comparable.

### TCR3d has no per-structure URL

All 206 structures are in TCR3d, but it has **no per-structure page** to link to:
its class-I set is a single browse table with every row embedded as JSON, and the
only per-PDB link it renders is *outward* to ATLAS.

So the structure page links **PDBe** (all), **STCRDab** (the 159 that
`sources` says it holds) and **ATLAS** (139) — and cannot link TCR3d, however
much we'd like to. `sources` on the master table is what gates each link.
