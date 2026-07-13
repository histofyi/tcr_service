"""
Real residue numbers for the CDR loops and the peptide, read from the coordinates.

The structure page lets you hover a residue in a CDR loop or the peptide and click
to zoom to it in Mol*. That needs the residue's actual number in the file — and it
cannot be guessed:

* **A CDR sequence is shorter than its IMGT range.** 1AO7's CDR1α is `DRGSQS` — six
  residues — across IMGT positions 27–38, which is twelve. IMGT numbering is gapped
  by design, so the Nth letter is not the Nth position.
* **57 structures have insertion codes** in the TCR chains (1AO7 has both E:112 and
  E:112A, and both are in CDR3β). A residue number alone is therefore not a unique
  key; the insertion code is part of it.
* **Three peptides contain a modified residue** — `PFF` and `F2F` (fluorinated
  phenylalanines, the point of 3D39/3D3V) and `ABA` (2-aminobutyric acid, 8SHI).
  These are HETATM records, not ATOM, so a naive parser drops them and the peptide
  silently comes up a residue short.
* **Four peptide chains carry a ligand** — iodide, isopropanol, and `3IB`, the
  indolylbutyric acid hapten in 2GJ6 — as extra residues on chain C.

So the numbers are read from the coordinate file itself. Verified across all 206
structures: every CDR loop (1236 of them) and every peptide maps exactly.
"""

import math
import os
import re
from functools import lru_cache

from functions.coordinates import COORDINATE_DIR, coordinate_file

# IMGT positions of the CDR loops. Chains D and E are IMGT-renumbered, so these
# are the same in every structure — but see the note above: the loops are gapped,
# so a range is not a count.
IMGT_LOOPS = {
    'cdr1': (27, 38),
    'cdr2': (56, 65),
    'cdr3': (105, 117),
}

CHAIN_FOR = {'alpha': 'D', 'beta': 'E'}
PEPTIDE_CHAIN = 'C'

# Solvent, cryoprotectants and ions that sit on the peptide chain but are nothing to
# do with the peptide. Almost every structure has waters on chain C; a good few also
# carry glycerol, ethylene glycol, isopropanol, sulfate or an iodide from the
# crystallisation. None of them modify the peptide.
SOLVENT = {
    'HOH', 'WAT', 'DOD',
    'GOL', 'EDO', 'PEG', 'PG4', 'IPA', 'MPD', 'DMS', 'TRS', 'ACT', 'FMT',
    'SO4', 'PO4', 'NO3', 'ACY', 'CIT',
    'IOD', 'CL', 'NA', 'K', 'MG', 'ZN', 'CA', 'MN', 'CD', 'NI', 'BR',
}

# A covalent bond is ~1.2-1.6 Å; nothing non-bonded gets that close.
COVALENT_BOND_MAX = 2.0

THREE_TO_ONE = {
    'ALA': 'A', 'ARG': 'R', 'ASN': 'N', 'ASP': 'D', 'CYS': 'C', 'GLN': 'Q',
    'GLU': 'E', 'GLY': 'G', 'HIS': 'H', 'ILE': 'I', 'LEU': 'L', 'LYS': 'K',
    'MET': 'M', 'PHE': 'F', 'PRO': 'P', 'SER': 'S', 'THR': 'T', 'TRP': 'W',
    'TYR': 'Y', 'VAL': 'V',
}


@lru_cache(maxsize=32)
def _chain_residues(filename: str) -> dict:
    """{ chain: [(resnum, icode, resname), ...] } from a coordinate file, in
    sequence order.

    Two things make the ordering fiddlier than it looks, and getting either wrong
    corrupts the sequence silently:

    **HETATM must be included, and sorted into place.** A modified residue in a
    peptide (PFF, F2F, ABA) is a real residue of that peptide, but it is a HETATM
    record and those sit in their own block at the *end* of the file. Left in file
    order, 3D39's fluorinated Phe lands after the peptide's C-terminus instead of
    at position 5.

    **But the sort must be on the residue number ALONE, not the insertion code.**
    IMGT numbers CDR3 insertions inward from both ends, so an inserted residue can
    precede its base position in sequence: 1MI5's CDR3α runs ...112A, 112..., while
    1AO7's CDR3β runs ...112, 112A.... Sorting on the insertion code imposes an
    order the chain does not have, and quietly transposes those two residues.
    Python's sort is stable, so sorting on the number alone keeps the file's own
    order for the ties — and the file is in sequence order.
    """
    path = os.path.join(COORDINATE_DIR, filename)
    chains: dict = {}
    seen: set = set()

    with open(path) as coordinate_file_handle:
        for line in coordinate_file_handle:
            if line[:6].strip() not in ('ATOM', 'HETATM'):
                continue
            chain = line[21]
            resnum = int(line[22:26])
            icode = line[26].strip()
            resname = line[17:20].strip()

            key = (chain, resnum, icode)
            if key in seen:
                continue
            seen.add(key)
            chains.setdefault(chain, []).append((resnum, icode, resname))

    return {
        chain: sorted(residues, key=lambda residue: residue[0])
        for chain, residues in chains.items()
    }


def _residue(chain: str, resnum: int, icode: str, resname: str,
             parent: str | None = None, attached: str | None = None) -> dict:
    """One residue, ready to render and to select in Mol*.

    A modified residue is displayed as **X**, not as the residue it derives from.
    Two things count as modified, and both matter:

    * the residue itself is non-standard — `PFF`/`F2F` (the fluorinated
      phenylalanines that 3D39/3D3V are *about*) or `ABA` (8SHI);
    * the residue is standard but carries a covalently bonded group — 2GJ6's Lys5
      holds the `3IB` hapten on its side-chain nitrogen. It is not a plain lysine,
      and showing a bare `K` would hide the entire point of that structure.

    Either way it keeps the parent residue's background colour, so it still reads
    as part of its chemical group. `parent` is the one-letter code the data gives
    for that position.
    """
    one_letter = THREE_TO_ONE.get(resname)
    is_nonstandard = one_letter is None
    is_modified = is_nonstandard or bool(attached)

    return {
        'chain': chain,
        'resnum': resnum,
        'icode': icode,
        'resname': resname,
        'display': 'X' if is_modified else one_letter,
        # what colours the cell — the parent residue for a modified one
        'colour': (parent or 'X') if is_nonstandard else one_letter,
        'is_modified': is_modified,
        'attached': attached,
    }


def cdr_residues(pdb_id: str, chain_label: str, loop: str, sequence: str | None) -> list:
    """The residues of one CDR loop, with their real numbers.

    `sequence` is the CDR string from the data, used only as a cross-check: if the
    coordinates disagree with it, we return nothing rather than wire up clicks that
    would focus the wrong residue. (Verified: they agree for all 1236 loops.)
    """
    filename = coordinate_file(pdb_id)
    if not filename or chain_label not in CHAIN_FOR or loop not in IMGT_LOOPS:
        return []

    chain = CHAIN_FOR[chain_label]
    start, end = IMGT_LOOPS[loop]

    residues = [
        _residue(chain, resnum, icode, resname, None)
        for resnum, icode, resname in _chain_residues(filename).get(chain, [])
        if start <= resnum <= end
    ]

    if sequence and ''.join(r['display'] for r in residues) != sequence:
        return []
    return residues


# chain-resnum[icode], e.g. e-112a, d-27, c-5
RESIDUE_TOKEN = re.compile(r'^([a-z])-(\d+)([a-z]?)$', re.IGNORECASE)


def residue_token(residue: dict) -> str:
    """The shareable ?residue= token for a residue: chain, number, insertion code.

    The chain is part of the token and cannot be dropped — residue numbering
    restarts per chain, so D:28 and E:28 are different residues, and both CDR1
    loops start at 27. The separator is there so it reads unambiguously
    (`e-112a`, not `e112a`).

    Lower-cased, matching the PDB ids in the site's paths. E:112A -> e-112a.
    """
    return f"{residue['chain']}-{residue['resnum']}{residue['icode']}".lower()


def parse_residue_token(token: str, sequences: dict) -> str | None:
    """Validate a ?residue= token against the residues this structure actually
    shows, and return it in canonical form — or None.

    It arrives from the URL, so it is not trusted: a token that doesn't name a
    residue of one of this structure's CDR loops or its peptide selects nothing.
    That also means a link is only ever shareable to something the page can show.
    """
    if not token or not RESIDUE_TOKEN.match(token.strip()):
        return None

    wanted = token.strip().lower()
    for residues in sequences.values():
        for residue in residues:
            if residue_token(residue) == wanted:
                return wanted
    return None


@lru_cache(maxsize=32)
def _chain_atoms(filename: str, chain: str) -> tuple:
    """((resnum, icode, resname, atom_name, x, y, z), ...) for one chain."""
    path = os.path.join(COORDINATE_DIR, filename)
    atoms = []

    with open(path) as coordinate_file_handle:
        for line in coordinate_file_handle:
            if line[:6].strip() not in ('ATOM', 'HETATM') or line[21] != chain:
                continue
            atoms.append((
                int(line[22:26]), line[26].strip(), line[17:20].strip(),
                line[12:16].strip(),
                float(line[30:38]), float(line[38:46]), float(line[46:54]),
            ))
    return tuple(atoms)


@lru_cache(maxsize=32)
def _attached_groups(filename: str, peptide_length: int) -> dict:
    """{ (resnum, icode): group_resname } — peptide residues carrying a covalently
    bonded chemical group.

    Some peptides are modified by a group modelled as its own residue rather than
    as a non-standard amino acid. 2GJ6's peptide carries the indolylbutyric acid
    hapten `3IB` on chain C at residue 10, bonded to Lys5's side-chain nitrogen —
    that IS a modified peptide, and P5 should not read as a plain lysine.

    There are no LINK records in these files, so the bond is found geometrically:
    a non-solvent group on the peptide chain, and the peptide atom it sits within
    covalent distance of. (Verified for 2GJ6: 3IB C13 to LYS 5 NZ is 1.33 Å.)
    """
    atoms = _chain_atoms(filename, PEPTIDE_CHAIN)

    peptide_atoms = [a for a in atoms if a[0] <= peptide_length]
    group_atoms = [
        a for a in atoms
        if a[0] > peptide_length and a[2] not in SOLVENT and a[2] not in THREE_TO_ONE
    ]
    if not group_atoms:
        return {}

    attached: dict = {}
    for _, _, group_name, _, gx, gy, gz in group_atoms:
        for resnum, icode, resname, _, px, py, pz in peptide_atoms:
            distance = math.dist((gx, gy, gz), (px, py, pz))
            if distance <= COVALENT_BOND_MAX:
                attached[(resnum, icode)] = group_name
                break

    return attached


def peptide_residues(pdb_id: str, sequence: str) -> list:
    """The peptide's residues, with their real numbers.

    Chain C can also carry ligands (iodide, isopropanol, and 2GJ6's covalently
    linked hapten), so take exactly as many residues as the sequence is long —
    the peptide is numbered from 1 and the ligands sort after it.

    The data's `sequence` gives the PARENT residue at each position, so it is what
    colours a modified residue's cell.
    """
    filename = coordinate_file(pdb_id)
    if not filename or not sequence:
        return []

    residues = _chain_residues(filename).get(PEPTIDE_CHAIN, [])[:len(sequence)]
    if len(residues) != len(sequence):
        return []

    attached = _attached_groups(filename, len(sequence))

    return [
        _residue(
            PEPTIDE_CHAIN, resnum, icode, resname,
            parent=sequence[index],
            attached=attached.get((resnum, icode)),
        )
        for index, (resnum, icode, resname) in enumerate(residues)
    ]
