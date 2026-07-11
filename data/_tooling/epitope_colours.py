"""epitope_colours.py — sequence-derived colours for peptide epitopes.

A homage to Dopplr's city colours (2007): every epitope gets a deterministic
colour. The upgrade: the colour is *meaningful*, not a hash — sequence-similar
peptides get perceptually similar colours; unrelated peptides sit far apart on
the hue wheel.

Pipeline:
  1. Pairwise sequence distance via BLOSUM62 global alignment, normalised.
  2. Classical MDS (PCoA) of the distance matrix → 2-D embedding.
  3. Embedding → OKLCh (perceptually uniform): angle→hue, radius→chroma,
     fixed lightness so every dot reads on a white background.
  4. OKLCh → sRGB hex.

Deterministic for a fixed input set (the MDS embedding is defined up to
rotation/reflection; we canonicalise by fixing the sign of the first axis).
Deps: biopython (BLOSUM62 + aligner) + numpy. No sklearn.

Usage:
    from epitope_colours import epitope_colours
    colours = epitope_colours(["EVDPIGHLY", "ESDPIVAQY", "GILGFVFTL", ...])
    # -> {"EVDPIGHLY": "#6389b4", ...}
"""
from __future__ import annotations
import numpy as np
from Bio.Align import substitution_matrices, PairwiseAligner

_BLOSUM = substitution_matrices.load("BLOSUM62")

def _aligner() -> PairwiseAligner:
    a = PairwiseAligner()
    a.substitution_matrix = _BLOSUM
    a.mode = "global"
    a.open_gap_score = -11
    a.extend_gap_score = -1
    return a

def sequence_distance_matrix(peptides: list[str], aligner=None) -> np.ndarray:
    """Normalised BLOSUM62 alignment distance, 0 (identical) .. ~1.6 (unrelated)."""
    aln = aligner or _aligner()
    self_ = {p: aln.score(p, p) for p in peptides}
    n = len(peptides)
    D = np.zeros((n, n))
    for i in range(n):
        for j in range(i + 1, n):
            s = aln.score(peptides[i], peptides[j])
            d = max(0.0, 1.0 - s / max(self_[peptides[i]], self_[peptides[j]]))
            D[i, j] = D[j, i] = d
    return D

def classical_mds(D: np.ndarray, dims: int = 2) -> np.ndarray:
    """Principal-coordinates embedding of a distance matrix."""
    n = D.shape[0]
    J = np.eye(n) - np.ones((n, n)) / n
    B = -0.5 * J @ (D ** 2) @ J
    w, V = np.linalg.eigh(B)
    order = np.argsort(w)[::-1]
    w, V = w[order], V[:, order]
    emb = V[:, :dims] * np.sqrt(np.clip(w[:dims], 0, None))
    # canonicalise orientation: make the largest-|coord| point have positive x
    if emb[np.argmax(np.abs(emb[:, 0])), 0] < 0:
        emb[:, 0] *= -1
    return emb

def _oklab_to_srgb_hex(L: float, a: float, b: float) -> str:
    l_ = L + 0.3963377774 * a + 0.2158037573 * b
    m_ = L - 0.1055613458 * a - 0.0638541728 * b
    s_ = L - 0.0894841775 * a - 1.2914855480 * b
    l, m, s = l_ ** 3, m_ ** 3, s_ ** 3
    r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
    g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
    bb = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    def gamma(x):
        x = max(0.0, min(1.0, x))
        return 12.92 * x if x <= 0.0031308 else 1.055 * x ** (1 / 2.4) - 0.055
    return "#%02x%02x%02x" % tuple(round(255 * gamma(c)) for c in (r, g, bb))

def epitope_colours(peptides, lightness: float = 0.62, chroma_max: float = 0.15,
                    chroma_floor: float = 0.35) -> dict[str, str]:
    """Map each unique peptide to a sequence-derived sRGB hex colour.

    lightness   OKLab L (0..1); 0.62 reads well as a filled marker on white.
    chroma_max  peak OKLab chroma (colour intensity) at the embedding rim.
    chroma_floor fraction of chroma_max applied at the centre, so central
                 peptides are still tinted rather than washed to grey.
    """
    peps = list(dict.fromkeys(peptides))           # unique, order-preserving
    if len(peps) == 1:
        return {peps[0]: _oklab_to_srgb_hex(lightness, chroma_max, 0.0)}
    D = sequence_distance_matrix(peps)
    emb = classical_mds(D, 2)
    ang = np.arctan2(emb[:, 1], emb[:, 0])
    rad = np.sqrt((emb ** 2).sum(1))
    rad = rad / rad.max() if rad.max() > 0 else rad
    out = {}
    for i, p in enumerate(peps):
        C = chroma_max * (chroma_floor + (1 - chroma_floor) * rad[i])
        out[p] = _oklab_to_srgb_hex(lightness, C * np.cos(ang[i]), C * np.sin(ang[i]))
    return out

if __name__ == "__main__":
    demo = ["EVDPIGHLY", "ESDPIVAQY", "LLFGYPVYV", "LLFGYAVYV",
            "GILGFVFTL", "NLVPMVATV", "AAGIGILTV"]
    for p, c in epitope_colours(demo).items():
        print(f"{p}  {c}")
