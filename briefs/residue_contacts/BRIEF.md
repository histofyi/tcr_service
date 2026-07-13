# Brief — residue-level bond-typed contacts for all 206 TCR:pMHC structures

**For:** whoever owns the pipeline that produced `interaction_export/`.
**Purpose:** the histo.fyi TCRs site needs a residue-level chord diagram. The
data to draw it does not exist yet.

---

## 1. The one-line ask

Produce, for every one of the 385 structure ids, a **residue-level, bond-typed
contact list** — every contacting residue pair between a TCR CDR loop and a
region of the MHC groove, with the residue identities on both sides.

## 0. The 60-second version

- **Don't modify `histo_contacts`.** It already returns residue- and atom-level
  bond-typed rows. The problem is downstream. (§2)
- The export pipeline **aggregates those rows away** to
  `cdr_loop|region|bond_type` counts before writing. Stop doing that. (§3)
- **Start from `bsi_career_enhancing_grant/code/compute_contact_maps.py`** — it
  already does ~half of this — but fix four things or it won't reconcile with the
  data that already exists. (§8)
- **Settle the α1/α2 definition first**: the grant and the export disagree, and it
  changes which contacts land in which group. (§4)
- There is a **mechanical acceptance test**: your new file must re-aggregate,
  exactly, to `contacts_by_structure.json`. Sample data provided. (§7, §9)

## 2. Read this before you touch anything: `histo_contacts` is NOT the problem

The obvious move is to go and change
[`histo_contacts`](https://github.com/drchristhorpe/histo_contacts). **Don't.**
It already emits exactly what is needed, today, unmodified.

`ContactMapper.contact_map()` returns a plain list of row dicts, one per contact
(`src/histo_contacts/core.py`, and `arpeggio_backend.map_contacts()`):

```python
{
  "type": "atom-atom",
  "from_chain": "D", "from_residue": 101, "from_atom": "OG1", "from_aa": "THR",
  "to_chain":   "A", "to_residue":  62,  "to_atom":  "CA",  "to_aa":  "GLY",
  "distance": 4.48,
  "bond_types": ["proximal", "vdw"]
}
```

That is residue-level **and** atom-level, with the bond types already classified
by Arpeggio. Nothing is missing.

Two further reasons not to modify it:

- Its `CLAUDE.md` says, explicitly: *"The CLI intentionally exposes exactly four
  options… Don't add further options… these were deliberate constraints from the
  initial design conversation, not oversights."*
- It is a **generic** tool — any structure, any chains. "CDR loop", "α1 helix"
  and "peptide" are TCR:pMHC domain concepts. Teaching them to `histo_contacts`
  would break its single-purpose contract. **The grouping belongs in the
  pipeline, not the library.**

## 3. Where the data is actually being lost

The export pipeline calls `histo_contacts`, gets the rows above, and then
**aggregates them away** before writing. Every file in `interaction_export/` is
already rolled up to CDR-loop × MHC-region:

| File | Grain | Residue identities? |
| --- | --- | --- |
| `contacts_by_structure.json` | `{cdr_loop, region, bond_type, n_atom_pairs}` | ✗ |
| `neighbours_by_structure.json` | `{cdr_loop, region, n_atom_pairs}` | ✗ |
| `interaction_com_raw.json` ("raw") | `ct_bond_types` keyed `CDR1_alpha\|alpha1\|proximal` | ✗ |

Note `interaction_com_raw.json` is called *raw* but is already aggregated.
`nb_residue_contacts` is a **count** (e.g. `63`), not the pairs.

**So: the fix is to stop discarding the rows, not to compute anything new.** The
expensive part (running Arpeggio) is already being done.

## 4. ⚠️ Resolve this first — the two pipelines disagree on what α1 and α2 are

This is a genuine conflict and it must be settled before anyone writes code,
because it changes which contacts land in which group.

| Source | α1 | α2 |
| --- | --- | --- |
| `interaction_export/README.md` | chain A **1–90** (whole domain) | chain A **91–180** (whole domain) |
| `bsi_career_enhancing_grant/structure_components.json` | chain A **50–86** (helix only) | chain A **137–180** (helix only) |

The grant's chord figures use the **helix-only** definition; the aggregated export
uses the **whole-domain** definition. They will not agree, and a residue-level file
built to one definition cannot be validated against aggregates built to the other.

**Recommendation: use the whole-domain definition (1–90 / 91–180)**, because it is
what every existing `interaction_export` file already uses, and it lets the
acceptance test in §7 work. If you prefer helix-only, say so — the website will
follow, but then the existing aggregates need regenerating too, and §7's test must
be dropped.

*(The website currently groups by the whole-domain definition, matching the
export.)*

## 5. The grouping rules

**TCR side** — chains `D` (α) and `E` (β). These files are **IMGT-renumbered**, so
the loops are at fixed positions in every structure:

| Loop | Chain | Residues |
| --- | --- | --- |
| `CDR1_alpha` | D | 27–38 |
| `CDR2_alpha` | D | 56–65 |
| `CDR3_alpha` | D | 105–117 |
| `CDR1_beta` | E | 27–38 |
| `CDR2_beta` | E | 56–65 |
| `CDR3_beta` | E | 105–117 |

**MHC side** — per §4:

| Region | Chain | Residues |
| --- | --- | --- |
| `alpha1` | A | 1–90 |
| `alpha2` | A | 91–180 |
| `peptide` | C | all |

Anything else (chain A ≥ 181 = α3, chain B = β2-microglobulin) is **excluded**, as
it is in the current aggregates.

## 6. The deliverable

A new file, `contacts_residue_by_structure.json`, in the same folder and keyed the
same way as its siblings (structure id = coordinate-file stem):

```json
{
  "1AO7_aligned_1": {
    "pdb_id": "1AO7",
    "complex": "1",
    "file": "1AO7_aligned_1.pdb",
    "ct_total_atom_pairs": 519,
    "contacts": [
      {
        "cdr_loop": "CDR3_alpha",
        "region": "peptide",
        "tcr_chain": "D",
        "tcr_resnum": 101,
        "tcr_resname": "THR",
        "mhc_chain": "C",
        "mhc_resnum": 5,
        "mhc_resname": "TYR",
        "n_atom_pairs": 3,
        "bond_type_counts": {"proximal": 3, "vdw": 1, "hbond": 1},
        "min_distance": 3.41
      }
    ]
  }
}
```

**One row per (CDR residue, MHC residue) pair** — atom-level multiplicity collapsed
to `n_atom_pairs`, and `min_distance` the closest approach. That is what the chord
needs: one ribbon per residue pair, its width `n_atom_pairs`.

### ⚠️ `bond_type_counts`, NOT a list of bond types

The obvious thing is to collapse the atom pairs and emit the **union** of their bond
types (`["proximal", "vdw", "hbond"]`). **Don't** — it is lossy in a way that
silently breaks the acceptance test.

The existing aggregates count **atom pairs per bond type**. A union list tells you
*that* a `vdw` occurred somewhere in this residue pair, not *how many* of the atom
pairs were `vdw` — so §7 becomes uncomputable and the two files can never be
reconciled.

Emit a **count per bond type** instead: of this residue pair's `n_atom_pairs` atom
pairs, how many carried each type. Note these will not sum to `n_atom_pairs` —
Arpeggio gives one atom pair several types at once, so the counts overlap by
design. In the example above: 3 atom pairs, all 3 `proximal`, of which 1 is also
`vdw` and 1 also an `hbond`.

### Also emit, please

- **`resname` as three-letter** (`THR`), as Arpeggio returns it. The website will
  convert to one-letter for labels. (The grant's CSVs use one-letter — don't copy
  that, it loses information.)

### If it is easier

Emitting the **atom-level** rows verbatim (one per atom pair, as `histo_contacts`
returns them, plus `cdr_loop` and `region`) and letting the website collapse them
is completely fine, and loses nothing. Say which you did. The file will be several
times larger; that is the only cost.

## 7. Acceptance test — this is the good bit

The new file must **re-aggregate exactly** to the file that already exists. This is
a precise, mechanical check, and it will catch a wrong distance cutoff, a wrong
region boundary, or a dropped chain immediately.

For each structure id, for each `(cdr_loop, region, bond_type)`:

```
SUM over residue-level contacts in that cell of  bond_type_counts[bond_type]
    ==  n_atom_pairs  in contacts_by_structure.json
```

and — **this is the one that is a true total** — per cell, and overall, against
`interaction_com_raw.json`'s `ct_atom_pairs` / `ct_total_atom_pairs`:

```
SUM of n_atom_pairs over residue-level contacts in cell  ==  ct_atom_pairs[cell]
SUM of n_atom_pairs over ALL residue-level contacts      ==  ct_total_atom_pairs
```

(Verified: for every structure, `sum(ct_atom_pairs.values()) == ct_total_atom_pairs`
— e.g. 1AO7 = 519.)

⚠️ **Bond types overlap, so they do not partition.** One atom pair can be
`["proximal", "vdw"]` and is counted in *both* bond-type totals. A bond-type count is
"number of atom pairs carrying this type", **not** a share of the whole. In `1AO7`,
`CDR1_alpha|alpha2` is `proximal: 51` and `hydrophobic: 2` — those 2 hydrophobic
pairs *are* 2 of the 51 proximal ones. Summing bond-type counts gives 53 for 51 atom
pairs; that is correct, not a bug. **Only `n_atom_pairs` is a true total** — always
reconcile totals against `ct_atom_pairs`, never against a sum of bond types.

⚠️ **And do not assume every pair is `proximal`.** It is tempting (it is nearly true)
but it is false: across 659 cells checked, 440 have a `proximal` count *lower* than
the cell's atom-pair total — some pairs carry only a specific bond type. In `1AO7`,
`CDR1_alpha|peptide` is 38 atom pairs but only 36 proximal. So `proximal` is **not**
a usable stand-in for the total.

Sample data to test against is in `sample/` (§9). For `1AO7_aligned_1` the target is
`ct_total_atom_pairs: 519` across 37 `(cdr_loop, region, bond_type)` rows.

## 8. Start from `compute_contact_maps.py` — but fix four things

**`bsi_career_enhancing_grant/code/compute_contact_maps.py` already does most of
this** (354 lines). It runs Arpeggio, categorises each contact into MHC-region ×
CDR-loop, and writes residue+atom-level rows. Its `categorise_contact()` is
essentially the function you want. **Lift it — don't start from scratch.**

But it was written for the grant's 10-structure set, and copied as-is it will
**not** reconcile with the existing aggregates (§7). Four things must change:

### (a) It filters to `atom-atom` only — this will break the acceptance test

```python
if record.get("type") != "atom-atom":
    return None
```

`histo_contacts` — which produced the existing `interaction_export` aggregates
(the `ct_` prefix is literally *histo_contacts*) — keeps **all five** of Arpeggio's
interaction granularities: `atom-atom`, `atom-plane`, `plane-plane`, `group-group`,
`group-plane`. Its `CLAUDE.md` calls this "a deliberate, confirmed choice".

So the aggregates you must reconcile against include plane/group rows, and
`compute_contact_maps.py` throws them away. **Drop this filter** (and note that
`from_atom`/`to_atom` can then be a comma-joined multi-atom string for a ring or
amide group — not always one atom).

### (b) The CDR string-matching is now unnecessary — delete it

`find_cdr_residue_numbers()` / `compute_cdr_ranges()` recover CDR positions by
string-matching Immunum-segmented CDR sequences into the PDB's own sequence, and
depend on `annotated_sequences/`. That was needed because the grant's structures
were **not renumbered**.

**Ours are IMGT-renumbered** (chains D and E). The loops are therefore at *fixed*
positions in every structure — the constants in §5. That whole mechanism, and its
dependency on `annotated_sequences/`, collapses to a lookup. It is also a fragile
step (a silent `[]` on any sequence mismatch), so removing it is a real win.

### (c) It uses the helix-only α1/α2 ranges

It reads `structure_components.json` (50–86 / 137–180). See §4 — this must become
the whole-domain definition, or nothing reconciles.

### (d) It downgrades residue names to one letter

`seq1(a["label_comp_id"])` in `make_row()`. Keep the three-letter name (§6).

### Also worth doing

It shells out to `pdbe-arpeggio` via `subprocess` and does its own gemmi
PDB→mmCIF conversion. `histo_contacts` already wraps both — and its `CLAUDE.md`
documents two non-obvious traps it has already solved (Arpeggio needs a populated
`_chem_comp.` category, so **every** input must be gemmi-round-tripped; and a
fresh `InteractionComplex` must be built per call or results silently accumulate
between queries). Prefer the library over re-running the subprocess:

```bash
histo-contacts 1ao7_aligned_1.pdb \
  --query  "D:27-38,D:56-65,D:105-117,E:27-38,E:56-65,E:105-117" \
  --target "A,C" \
  --output 1AO7_aligned_1_contacts.json \
  --distance 5.0
```

(`histo_contacts` has no residue-range support in its *target* selector — chain ids
only — so target the whole MHC chains and group the `to_*` side by residue number
afterwards, dropping chain A ≥ 181 and chain B.)

**Use the same `--distance` the current pipeline used** (Arpeggio's default is
`5.0`) or §7 will not reconcile. If you don't know what it used, `5.0` is the right
first guess — confirm by checking the test reconciles.

Run over **all 385 structure ids**, not the 206 PDB entries: multi-copy and altloc
structures each get their own file (`5JHD` alone has four:
`5JHD_aligned_{1,2}_altloc{A,B}`). `compute_contact_maps.py` iterates
`complex_list.json` (10 structures, one file each) — that loop needs replacing with
one over the coordinate files themselves.

## 9. Sample dataset (in `sample/`)

| File | What it is |
| --- | --- |
| `1ao7_aligned_1.pdb` | Input structure. The simplest case: one copy, no altloc. |
| `expected_aggregate__1AO7_aligned_1.json` | The **existing** aggregate for that structure, lifted straight from `contacts_by_structure.json`. Your residue-level output must re-aggregate to exactly this (§7). `ct_total_atom_pairs: 519`, 37 bond rows. |
| `reference_residue_level__grant_format.csv` | From `bsi_career_enhancing_grant/contact_maps/` — the residue-level shape, done once before, for 5JHD's α1 vs TCR. **Format reference only**, see the caveats below. |

**Caveats on the grant CSV** — it is the right *idea* but do not copy it verbatim:

- It uses the **helix-only** α1/α2 definition (§4).
- Its `resname_1`/`resname_2` are **one-letter** — lossy.
- It has **one row per atom pair**, not per residue pair (`atom_1`, `atom_2`
  columns). We want the collapsed form (§6), but if it is easier to emit the
  atom-level rows and collapse downstream, that is fine too — say which you did.
- It splits into one CSV per MHC region; we want one JSON keyed by structure id, to
  match the existing sibling files.

## 10. Why this matters (what it unblocks)

The site currently draws the chord at **CDR-loop × MHC-region** — six arcs against
three. That is all the data allows. It is a useful diagram, but it cannot show
*which residues* are doing the binding, which is the actual scientific point.

With this file, the chord becomes residue × residue, grouped and coloured by CDR
loop / peptide / α1 / α2 — matching the grant's published figures — and every
ribbon becomes clickable through to the two residues it connects, highlighted in
the Mol\* viewer. The rendering work is done; it is waiting on the data.

## 11. Definition of done

- [ ] §4 settled and written down.
- [ ] `contacts_residue_by_structure.json` produced for all 385 structure ids.
- [ ] §7's re-aggregation test passes for every structure, not just the sample.
- [ ] A short note in the export README describing the new file, in the style of
      the existing entries.
- [ ] `interaction_com_raw.json` renamed or documented — it is currently called
      "raw" but is aggregated, which is misleading.

---

## 12. Files in this brief

```
BRIEF.md                                        this document
sample/
  1ao7_aligned_1.pdb                            input structure (1 copy, no altloc)
  expected_aggregate__1AO7_aligned_1.json       what your output must re-aggregate to (§7)
  expected_totals__1AO7_aligned_1.json          per-cell ATOM-PAIR totals — the true totals (§7)
  reference_residue_level__grant_format.csv     the residue-level shape, done before (§9)
  compute_contact_maps.py                       the grant's script — your starting point (§8)
```
