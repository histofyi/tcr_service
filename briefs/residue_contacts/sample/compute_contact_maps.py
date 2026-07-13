"""Compute atom-atom contact maps via PDBe-Arpeggio.

For each TCR-pMHC complex in complex_list.json, converts the remediated PDB to
mmCIF (gemmi), runs `pdbe-arpeggio` once over the whole structure, then filters
the resulting JSON into four CSV section files in contact_maps/:

    {system}__{pdb_id}__mhc__peptide.csv        HLA alpha1+alpha2 <-> peptide
    {system}__{pdb_id}__alpha1__tcr.csv         HLA alpha1 helix <-> TCR alpha/beta CDR loops
    {system}__{pdb_id}__alpha2__tcr.csv         HLA alpha2 helix <-> TCR alpha/beta CDR loops
    {system}__{pdb_id}__peptide__tcr.csv        peptide <-> TCR alpha/beta CDR loops

Helix residue ranges come from structure_components.json (chain A residues
50-86 / 137-180). TCR CDR residue numbers are recovered by string-matching the
Immunum-segmented CDR sequences (from annotated_sequences/) into each chain's
PDB-derived 1-letter sequence.

Output CSV schema (matches examples/cdr1a_mhc_contacts.csv minus `structure`,
plus `tcr_chain` and `cdr_loop`):
    chain_1, resnum_1, resname_1, atom_1,
    chain_2, resnum_2, resname_2, atom_2,
    interaction_types, distance,
    tcr_chain, cdr_loop

The lower chain letter goes on the `_1` side. tcr_chain/cdr_loop are blank for
mhc__peptide rows.
"""

import csv
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import gemmi
from Bio.PDB import PDBParser
from Bio.SeqUtils import seq1

REPO_ROOT = Path(__file__).resolve().parent.parent
COMPLEX_LIST = REPO_ROOT / "complex_list.json"
COMPONENTS_FILE = REPO_ROOT / "structure_components.json"
ANNOTATED_DIR = REPO_ROOT / "annotated_sequences"
REMEDIATED_DIR = REPO_ROOT / "remediated_structures"
CONTACT_MAPS_DIR = REPO_ROOT / "contact_maps"
LOG_FILE = CONTACT_MAPS_DIR / "contact_maps_log.json"

SECTION_FILENAMES = ("mhc__peptide", "alpha1__tcr", "alpha2__tcr", "peptide__tcr")

CSV_COLUMNS = [
    "chain_1", "resnum_1", "resname_1", "atom_1",
    "chain_2", "resnum_2", "resname_2", "atom_2",
    "interaction_types", "distance",
    "tcr_chain", "cdr_loop",
]

CHAIN_HLA_ALPHA = "A"
CHAIN_PEPTIDE = "C"
CHAIN_TCR_ALPHA = "D"
CHAIN_TCR_BETA = "E"


def load_chain_residues(pdb_path: Path) -> dict[str, list[tuple[int, str, str]]]:
    """Return {chain_id: [(resnum, three_letter_resname, one_letter), ...]} in chain order."""
    parser = PDBParser(QUIET=True)
    structure = parser.get_structure(pdb_path.stem, pdb_path)
    model = next(iter(structure))
    out: dict[str, list[tuple[int, str, str]]] = {}
    for chain in model:
        residues = [
            (r.id[1], r.resname, seq1(r.resname, undef_code="X"))
            for r in chain
            if r.id[0] == " "
        ]
        out[chain.id] = sorted(residues, key=lambda t: t[0])
    return out


def find_cdr_residue_numbers(
    chain_residues: list[tuple[int, str, str]], cdr_seq: str
) -> list[int]:
    """Return PDB residue numbers matching cdr_seq in chain, or [] if not found."""
    if not cdr_seq:
        return []
    pdb_seq = "".join(letter for _, _, letter in chain_residues)
    idx = pdb_seq.find(cdr_seq)
    if idx < 0:
        return []
    return [chain_residues[idx + i][0] for i in range(len(cdr_seq))]


def load_tcr_cdrs(slug: str, pdb_id: str) -> dict[str, dict[str, str]]:
    """Return {'alpha': {'cdr1': '...', 'cdr2': '...', 'cdr3': '...'}, 'beta': {...}}."""
    out: dict[str, dict[str, str]] = {}
    for chain_label in ("alpha", "beta"):
        path = ANNOTATED_DIR / f"{slug}__{pdb_id}__{chain_label}.json"
        data = json.loads(path.read_text())
        seg = data.get("segmentation", {})
        out[chain_label] = {
            "cdr1": seg.get("cdr1") or "",
            "cdr2": seg.get("cdr2") or "",
            "cdr3": seg.get("cdr3") or "",
        }
    return out


def compute_cdr_ranges(
    cdr_seqs: dict[str, dict[str, str]],
    chain_residues: dict[str, list[tuple[int, str, str]]],
) -> dict[str, dict[str, list[int]]]:
    """Return {'alpha': {'cdr1': [resnums], 'cdr2': [...], 'cdr3': [...]}, 'beta': {...}}."""
    chain_for_label = {"alpha": CHAIN_TCR_ALPHA, "beta": CHAIN_TCR_BETA}
    out: dict[str, dict[str, list[int]]] = {}
    for chain_label, cdrs in cdr_seqs.items():
        chain_id = chain_for_label[chain_label]
        residues = chain_residues.get(chain_id, [])
        out[chain_label] = {
            cdr_key: find_cdr_residue_numbers(residues, cdrs[cdr_key])
            for cdr_key in ("cdr1", "cdr2", "cdr3")
        }
    return out


def pdb_to_cif(pdb_path: Path, cif_path: Path) -> None:
    s = gemmi.read_pdb(str(pdb_path))
    s.setup_entities()
    s.make_mmcif_document().write_file(str(cif_path))


def run_arpeggio(cif_path: Path, out_dir: Path) -> tuple[int, str]:
    result = subprocess.run(
        ["pdbe-arpeggio", "-m", "-o", str(out_dir), str(cif_path)],
        capture_output=True,
        text=True,
    )
    return result.returncode, result.stderr


def in_range(resnum: int, low: int, high: int) -> bool:
    return low <= resnum <= high


def cdr_loop_for(resnum: int, cdr_ranges_for_chain: dict[str, list[int]]) -> str | None:
    for cdr_key, resnums in cdr_ranges_for_chain.items():
        if resnum in resnums:
            return cdr_key
    return None


def make_row(
    bgn: dict, end: dict, contact: list[str], distance: float,
    tcr_chain: str = "", cdr_loop: str = "",
) -> dict[str, str]:
    """Build a CSV row, ensuring `_1` is the lower chain letter."""
    if bgn["auth_asym_id"] <= end["auth_asym_id"]:
        a, b = bgn, end
    else:
        a, b = end, bgn
    return {
        "chain_1": a["auth_asym_id"],
        "resnum_1": str(a["auth_seq_id"]),
        "resname_1": seq1(a["label_comp_id"], undef_code="X"),
        "atom_1": a["auth_atom_id"],
        "chain_2": b["auth_asym_id"],
        "resnum_2": str(b["auth_seq_id"]),
        "resname_2": seq1(b["label_comp_id"], undef_code="X"),
        "atom_2": b["auth_atom_id"],
        "interaction_types": ",".join(contact),
        "distance": f"{distance:.2f}",
        "tcr_chain": tcr_chain,
        "cdr_loop": cdr_loop,
    }


def categorise_contact(
    record: dict,
    alpha1_range: tuple[int, int],
    alpha2_range: tuple[int, int],
    peptide_resnums: set[int],
    cdr_ranges: dict[str, dict[str, list[int]]],
) -> tuple[str, dict[str, str]] | None:
    """Return (section_name, csv_row) if the contact falls into one of the four maps."""
    if record.get("type") != "atom-atom":
        return None
    bgn = record["bgn"]
    end = record["end"]
    contact_labels = record.get("contact", [])
    distance = record.get("distance")
    if distance is None:
        return None

    sides = (bgn, end)
    chains = {s["auth_asym_id"] for s in sides}

    # mhc <-> peptide
    if chains == {CHAIN_HLA_ALPHA, CHAIN_PEPTIDE}:
        mhc_side = bgn if bgn["auth_asym_id"] == CHAIN_HLA_ALPHA else end
        pep_side = bgn if bgn["auth_asym_id"] == CHAIN_PEPTIDE else end
        mhc_resnum = mhc_side["auth_seq_id"]
        if (
            in_range(mhc_resnum, *alpha1_range)
            or in_range(mhc_resnum, *alpha2_range)
        ) and pep_side["auth_seq_id"] in peptide_resnums:
            return "mhc__peptide", make_row(bgn, end, contact_labels, distance)
        return None

    # alpha1/alpha2 <-> TCR (chain A on MHC side, chain D or E on TCR side)
    if chains in ({CHAIN_HLA_ALPHA, CHAIN_TCR_ALPHA}, {CHAIN_HLA_ALPHA, CHAIN_TCR_BETA}):
        mhc_side = bgn if bgn["auth_asym_id"] == CHAIN_HLA_ALPHA else end
        tcr_side = bgn if bgn["auth_asym_id"] in (CHAIN_TCR_ALPHA, CHAIN_TCR_BETA) else end
        mhc_resnum = mhc_side["auth_seq_id"]
        tcr_resnum = tcr_side["auth_seq_id"]
        tcr_label = "alpha" if tcr_side["auth_asym_id"] == CHAIN_TCR_ALPHA else "beta"
        cdr = cdr_loop_for(tcr_resnum, cdr_ranges[tcr_label])
        if cdr is None:
            return None
        row = make_row(bgn, end, contact_labels, distance, tcr_chain=tcr_label, cdr_loop=cdr)
        if in_range(mhc_resnum, *alpha1_range):
            return "alpha1__tcr", row
        if in_range(mhc_resnum, *alpha2_range):
            return "alpha2__tcr", row
        return None

    # peptide <-> TCR
    if chains in ({CHAIN_PEPTIDE, CHAIN_TCR_ALPHA}, {CHAIN_PEPTIDE, CHAIN_TCR_BETA}):
        pep_side = bgn if bgn["auth_asym_id"] == CHAIN_PEPTIDE else end
        tcr_side = bgn if bgn["auth_asym_id"] in (CHAIN_TCR_ALPHA, CHAIN_TCR_BETA) else end
        if pep_side["auth_seq_id"] not in peptide_resnums:
            return None
        tcr_label = "alpha" if tcr_side["auth_asym_id"] == CHAIN_TCR_ALPHA else "beta"
        cdr = cdr_loop_for(tcr_side["auth_seq_id"], cdr_ranges[tcr_label])
        if cdr is None:
            return None
        return "peptide__tcr", make_row(
            bgn, end, contact_labels, distance, tcr_chain=tcr_label, cdr_loop=cdr
        )

    return None


def write_section_csv(out_path: Path, rows: list[dict[str, str]]) -> None:
    sorted_rows = sorted(
        rows,
        key=lambda r: (
            r["chain_1"], int(r["resnum_1"]), r["atom_1"],
            r["chain_2"], int(r["resnum_2"]), r["atom_2"],
        ),
    )
    with out_path.open("w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        writer.writerows(sorted_rows)


def main() -> int:
    CONTACT_MAPS_DIR.mkdir(exist_ok=True)
    systems = json.loads(COMPLEX_LIST.read_text())
    components = json.loads(COMPONENTS_FILE.read_text())
    alpha1_range = (components["alpha_1_helix"]["start"], components["alpha_1_helix"]["end"])
    alpha2_range = (components["alpha_2_helix"]["start"], components["alpha_2_helix"]["end"])

    log_entries: list[dict] = []
    wrote = skipped = failed = 0

    for system in systems:
        slug = system["system"]
        for entry in system["structures"]:
            pdb_id = entry["pdb_id"].lower()
            tcr_name = entry["tcr_name"]
            pdb_path = REMEDIATED_DIR / f"{slug}__{pdb_id}.pdb"
            section_paths = {
                section: CONTACT_MAPS_DIR / f"{slug}__{pdb_id}__{section}.csv"
                for section in SECTION_FILENAMES
            }

            if all(p.exists() for p in section_paths.values()):
                print(f"skipped    {slug}__{pdb_id}")
                skipped += 1
                continue

            if not pdb_path.exists():
                print(f"failed     {slug}__{pdb_id}  (missing remediated PDB)", file=sys.stderr)
                failed += 1
                continue

            try:
                chain_residues = load_chain_residues(pdb_path)
                cdr_seqs = load_tcr_cdrs(slug, pdb_id)
                cdr_ranges = compute_cdr_ranges(cdr_seqs, chain_residues)
                peptide_resnums = {n for n, _, _ in chain_residues.get(CHAIN_PEPTIDE, [])}

                with tempfile.TemporaryDirectory(prefix=f"arpeggio_{pdb_id}_") as tmpdir:
                    tmp = Path(tmpdir)
                    cif_path = tmp / f"{pdb_id}.cif"
                    pdb_to_cif(pdb_path, cif_path)
                    rc, stderr = run_arpeggio(cif_path, tmp)
                    if rc != 0:
                        print(f"failed     {slug}__{pdb_id}  (arpeggio rc={rc})", file=sys.stderr)
                        print(stderr, file=sys.stderr)
                        failed += 1
                        continue
                    json_path = tmp / f"{pdb_id}.json"
                    records = json.loads(json_path.read_text())
            except (KeyError, ValueError, RuntimeError) as e:
                print(f"failed     {slug}__{pdb_id}  ({type(e).__name__}: {e})", file=sys.stderr)
                failed += 1
                continue

            rows_per_section: dict[str, list[dict[str, str]]] = {s: [] for s in SECTION_FILENAMES}
            for rec in records:
                hit = categorise_contact(
                    rec, alpha1_range, alpha2_range, peptide_resnums, cdr_ranges
                )
                if hit is None:
                    continue
                section, row = hit
                rows_per_section[section].append(row)

            for section, path in section_paths.items():
                write_section_csv(path, rows_per_section[section])

            cdr_summary = {
                chain_label: {
                    cdr_key: (
                        [resnums[0], resnums[-1]] if resnums else None
                    )
                    for cdr_key, resnums in cdrs.items()
                }
                for chain_label, cdrs in cdr_ranges.items()
            }

            log_entries.append({
                "system": slug,
                "pdb_id": pdb_id,
                "tcr_name": tcr_name,
                "arpeggio_records": len(records),
                "row_counts": {s: len(rows_per_section[s]) for s in SECTION_FILENAMES},
                "cdr_ranges": cdr_summary,
            })
            print(
                f"wrote      {slug}__{pdb_id}  ({tcr_name:8})  "
                + "  ".join(
                    f"{s}={len(rows_per_section[s])}" for s in SECTION_FILENAMES
                )
            )
            wrote += 1

    LOG_FILE.write_text(json.dumps(log_entries, indent=2))
    print(f"\nSummary: wrote={wrote} skipped={skipped} failed={failed}")
    print(f"Wrote {LOG_FILE.relative_to(REPO_ROOT)}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
