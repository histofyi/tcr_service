"""
Distribution ellipses for the mini COM viewer on a structure page.

The viewer plots one point — this structure's centre of mass. To say whether that
sits where TCRs usually sit, or somewhere unusual, it needs context: the spread of
*every* structure's COM for the same measure, and the spread for structures reading
the same class of antigen. Those are drawn as covariance ellipses behind the point.

The ellipses are the same construction as the Explore viewer's facet shape
(static/explore.js): population covariance of the point cloud, its eigenvectors giving
the axis directions, 2·√eigenvalue giving the 2-sigma semi-axes. Computed here, once
per process, from the same `com_coords.json` the Explore viewer draws from — so the
structure page and Explore agree by construction.
"""

import json
import math
import os
from functools import lru_cache

COM_COORDS_FILE = os.path.join('static', 'data', 'com_coords.json')


@lru_cache(maxsize=1)
def _figs() -> dict:
    """{ layer: [ {x, y, antigen_type}, ... ] } — every structure's COM per layer."""
    if not os.path.exists(COM_COORDS_FILE):
        return {}
    with open(COM_COORDS_FILE) as coords_file:
        return json.load(coords_file).get('figs') or {}


def _ellipse(points: list) -> dict | None:
    """A 2-sigma covariance ellipse for a cloud of {x, y} points, in image pixels.

    Returns centre, rotation and semi-axes ready to hand to canvas `ellipse()`. None
    below three points — a covariance of one or two points is not a distribution.
    """
    n = len(points)
    if n < 3:
        return None

    cx = sum(p['x'] for p in points) / n
    cy = sum(p['y'] for p in points) / n

    a = b = d = 0.0
    for p in points:
        dx, dy = p['x'] - cx, p['y'] - cy
        a += dx * dx
        b += dx * dy
        d += dy * dy
    a /= n
    b /= n
    d /= n

    # eigenvalues of the 2x2 covariance [[a, b], [b, d]]
    trace, det = a + d, a * d - b * b
    disc = math.sqrt(max(0.0, trace * trace / 4 - det))
    l1 = trace / 2 + disc
    l2 = max(0.0, trace / 2 - disc)

    angle = math.atan2(l1 - a, b) if b != 0 else (0.0 if a >= d else math.pi / 2)

    return {
        'cx': round(cx, 2),
        'cy': round(cy, 2),
        'angle': round(angle, 5),
        'ax_major': round(2 * math.sqrt(l1), 2),   # 2-sigma semi-axes
        'ax_minor': round(2 * math.sqrt(l2), 2),
        'n': n,
    }


@lru_cache(maxsize=8)
def _overall() -> dict:
    """{ layer: ellipse } across every structure — cached, it never varies."""
    return {
        layer: _ellipse(points)
        for layer, points in _figs().items()
    }


@lru_cache(maxsize=8)
def _for_antigen(antigen_type: str) -> dict:
    """{ layer: ellipse } across the structures reading this class of antigen."""
    return {
        layer: _ellipse([p for p in points if p.get('antigen_type') == antigen_type])
        for layer, points in _figs().items()
    }


def com_distributions(antigen_type: str | None) -> dict:
    """The two ellipse sets the mini viewer draws behind its point: the overall
    distribution (black) and this structure's antigen-type distribution (coloured),
    keyed by COM layer.

    `antigen` is empty if the type is unknown, or has too few structures to describe —
    the viewer then draws the overall ellipse alone.
    """
    return {
        'overall': _overall(),
        'antigen': _for_antigen(antigen_type) if antigen_type else {},
    }
