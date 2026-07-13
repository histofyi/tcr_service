# Bugs found

Defects found while building the site — in the site's own code, in the coordinate
files, and in the upstream data. Kept separate from `DATA.md`, which is a list of
things the *pipeline* should fix; this is a log of what actually went wrong, what
the symptom was, and how it was caught. Several of these were silent — they
produced plausible output, not an error — which is the reason for writing them
down.

Status: **FIXED** = fixed here and verified. **OPEN** = still live.

---

## 1. Chain colours meant different things on different structures — FIXED

**Symptom.** 9ZCL's chains were coloured differently to every other structure: its
peptide came out MHC-green.

**Cause.** Mol\*'s `chain-id` colour theme assigns colours by **chain index — the
order the chains first appear in the file** — not by the chain's id. Most files run
`A,B,C,D,E`, but **10 of the 206 did not**:

| Chain order | Structures |
| --- | --- |
| `ABCDE` | 196 |
| `DEABC` | 4 — 7L1D, 8RRO, 9HLJ, 9WBD |
| `DECAB` | 2 — 9RXM, 9YW4 |
| `ABCED` | 1 — 6VM8 |
| `ABDEC` | 1 — 9J4U |
| `CABDE` | 1 — **9ZCL** |
| `DEAC` | 1 — 9RU5 (and it has no chain B at all) |

So a colour meant a different chain depending on the file. Worse, the *legend was
correct* — it was painted by reading the colours back off the theme — so each page
was internally consistent and only comparison between pages revealed it.

**Fix.** `static/viewer.js` now builds one component per chain and pins Mol\*'s own
palette (Dark2) to the chain **letter**: A green, B orange, C purple, D pink, E
olive. The palette is Mol\*'s, so the site looks unchanged; the assignment is ours,
so it is the same everywhere.

**Also fixed upstream.** The revised coordinate drop (2026-07-13) reletters
everything to `ABCDE`, so the ordering problem is gone at source. The fix is kept
regardless: the site should not silently depend on the order chains happen to
appear in a file.

**Caught by:** Chris noticing the colours differed on one page.

---

## 2. Sorting a chain's residues transposes IMGT insertions — FIXED

**Symptom.** 44 CDR loops failed a cross-check against the sequence in the data.

**Cause.** Sorting residues by `(resnum, insertion_code)` looks obviously right and
is wrong. **IMGT numbers CDR3 insertions inward from both ends**, so an inserted
residue can *precede* its base position in sequence:

- 1MI5 CDR3α runs `... 111, 112A, 112, 113 ...`
- 1AO7 CDR3β runs `... 111, 112, 112A, 113 ...`

Sorting on the insertion code imposes an ascending order the chain does not have,
and quietly swaps those two residues — the sequence still *looks* plausible.

**Fix.** `functions/residues.py::_chain_residues()` sorts on the residue **number
alone**. Python's sort is stable, so the file's own order (which is sequence order)
breaks the ties.

**Caught by:** cross-checking the residues read from the coordinates against the
CDR sequence in the data. That check is now kept permanently in the code — if they
ever disagree, the loop renders non-interactive rather than wiring a click that
would focus the wrong residue.

---

## 3. Selecting a residue by number alone selects two residues — FIXED

**Symptom.** Clicking E:112 in a sequence focused *both* E:112 and E:112A in Mol\*
(`GLY 112A | E [+ 1 other Residue]`).

**Cause.** The Mol\* selection tested `auth_seq_id` only. **57 structures have
insertion codes** in the TCR chains, and 1AO7 has both E:112 and E:112A — both
inside CDR3β. The insertion code is part of the residue's identity, not an optional
extra.

**Fix.** The `pdbx_PDB_ins_code` test is now applied **always**, including when
there is no insertion code — Mol\* reports `''` for those, so testing for `''`
correctly excludes 112A when you asked for 112. (Verified in the browser: Mol\*
returns 4 atoms for both `ins_code=''` and `ins_code='A'` at E:112.)

---

## 4. A modified peptide residue silently vanishes — FIXED

**Symptom.** Three peptides came out a residue short: 3D39's read `LLFGPVYV` (8)
where the data says `LLFGFPVYV` (9).

**Cause.** The residue at that position is **`PFF` — a fluorinated phenylalanine**,
which is a `HETATM` record, not `ATOM`. An ATOM-only parse drops it. The irony is
that 3D39/3D3V *are the fluorination papers* — the dropped residue is the entire
point of the structure.

Also `F2F` (3D3V, difluoro-Phe) and `ABA` (8SHI, 2-aminobutyric acid).

**Fix.** `HETATM` is included, and sorted into place by residue number — those
records sit in their own block at the *end* of the file, so left in file order the
fluorinated Phe lands after the peptide's C-terminus instead of at position 5.

Modified residues render as **X**, not as the residue they derive from — they are
not that residue, and 3D39/3D3V are interesting precisely because they are not.
They keep the parent's background colour so they still read as part of the chemical
group, and are marked with a dotted underline.

---

## 5. Ligands on the peptide chain lengthen the peptide — FIXED

**Symptom.** Four peptides came out a residue *too long*.

**Cause.** Chain C carries more than the peptide: an iodide ion (2AK4, 4JRX),
isopropanol (2P5E), and — the interesting one — **`3IB`, the indolylbutyric acid
hapten covalently linked to the peptide in 2GJ6**.

**Fix.** The peptide is taken as the first N residues of chain C, N =
`len(peptide_seq)`. It is numbered from 1 and the ligands sort after it.

---

## 6. The explore viewer's Mol\* panel could never have worked — FIXED

**Symptom.** Clicking a COM in `/tcrs/explore` did nothing.

**Cause.** The loader was written as `DATA.structDir + p.file`, but **the COM points
have no `file` key** — it was building `structures/undefined`. It had never worked.

**Fix.** Coordinate paths are resolved server-side and handed to the page as a map.
(See also DATA.md #8: a filename could not have been derived on the client anyway,
because 76 structures exist only as altloc files.)

---

## 7. Every page's CSS was silently discarded — FIXED

**Symptom.** The prototype looked unstyled; tables rendered with their headers run
together.

**Cause.** `base.html` pulled `top.html` in with `{% include %}`, but
`{% block style %}` and `{% block head %}` were **defined inside `top.html`** —
and **Jinja blocks do not cross an `{% include %}`**. Every page's stylesheet had
been thrown away since the skeleton was built. No error; the blocks were simply
ignored.

**Fix.** `base.html` is a real parent template with the blocks defined in it.

---

## 8. A class-name collision from the histo stylesheet — FIXED

**Symptom.** The COM viewer sat 60px lower than the filter panel beside it.

**Cause.** histo.fyi's stylesheet styles the bare class `.main` with
`margin-top: 60px` (it styles the page's `<main class="main">`). The COM viewer's
own inner wrapper was *also* called `.main`.

**Fix.** Renamed to `.com-main`. Worth remembering when adding components: the
histo stylesheet styles bare, generic class names.

---

## 9. `NaN` is not valid JSON — FIXED

**Symptom.** Would have broken `JSON.parse()` in the browser.

**Cause.** 21% of shape-complementarity values are `NaN`. Python's `json` module
both reads *and writes* `NaN` quite happily, so it round-trips through a Python
pipeline invisibly and only fails at the browser.

**Fix.** Sanitised to `null` before serialisation. See DATA.md #2 — the pipeline
should emit `null`.

---

## 10. Two TCRs rendered as "nan", and as nothing — FIXED

**Symptom.** Two TCRs showed as `nan` in the browse list. Their own pages showed an
**empty heading**.

**Cause.** Two different bugs wearing the same hat. The parquet index carries
`tcr_name` as a **float NaN** (stringifies to `"nan"`); the detail bundles carry it
as **null** (renders as nothing at all). Only one of the two was visible at a time,
which is why it looked like one bug.

**Fix.** `models/tcrs.py::annotate_tcr_name()` normalises both, in the model layer
so every consumer agrees. 9K2R uses its donor code (**KI-890**), which the bundle
knew all along; 9D95 has nothing to fall back on and shows "Unknown".

---

## 11. Static assets cached for 12 hours — FIXED

**Symptom.** Edits to `viewer.js` appeared to do nothing. Chris saw a "Mol\* failed
to load" error from a code path that no longer existed.

**Cause.** Quart serves `/static` with `cache-control: max-age=43200`. An edited JS
file stays invisible to a browser that already has it for **12 hours**.

**Fix.** `main.py::asset()` appends the file's mtime, so each edit is a new URL.
The Mol\* bundle and the coordinate files are deliberately *not* routed through it —
they never change, and the long cache is exactly what we want for them.

---

## Still open

See `DATA.md` for the full list of upstream data problems. The ones that bite
hardest:

- **#9** — is `overall_completeness_pct` whole-complex or TCR-chains-only? The page
  copy and the column name disagree. Unresolved.
- **#13** — every interaction file currently ships with the **wrong** α1/α2
  definition (whole-domain, not helix-only). SASA and shape complementarity are
  affected too, not just the contacts.
- **#11** — no residue-level contacts exist, so the chord is drawn at loop level.
