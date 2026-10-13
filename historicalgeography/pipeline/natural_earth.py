"""Ocean polygon from the Natural Earth coastline, as a fallback where no
historical survey covers the coast. Standard library only."""

import json
import math
from pathlib import Path

from clip_coastline import clip_line


def merge_lines(lines):
    """Join clipped pieces end to end into one line."""
    lines = [list(l) for l in lines]
    merged = lines.pop(0)
    while lines:
        best = None
        for i, line in enumerate(lines):
            for rev in (False, True):
                cand = line[::-1] if rev else line
                for at_end in (True, False):
                    a = merged[-1] if at_end else merged[0]
                    b = cand[0] if at_end else cand[-1]
                    d = math.dist(a, b)
                    if best is None or d < best[0]:
                        best = (d, i, cand, at_end)
        _, i, cand, at_end = best
        lines.pop(i)
        merged = merged + cand if at_end else cand + merged
    return merged


def ocean_ring(path, bbox):
    """Ring (lon/lat) of the ocean inside bbox, closed via its southern corners.

    Assumes the coast enters and leaves the bbox through its west/east edges
    (true for Santa Monica Bay). Islands (closed rings) are left out.
    """
    world = json.loads(Path(path).read_text())
    pieces = []
    for feature in world["features"]:
        geom = feature["geometry"]
        parts = [geom["coordinates"]] if geom["type"] == "LineString" else geom["coordinates"]
        for part in parts:
            pieces.extend(clip_line(part, bbox))
    pieces = [p for p in pieces if p[0] != p[-1]]
    coast = merge_lines(pieces)
    line = coast if coast[0][0] < coast[-1][0] else coast[::-1]  # west -> east
    xmin, ymin, xmax, ymax = bbox
    return line + [[xmax, ymin], [xmin, ymin], line[0]]
