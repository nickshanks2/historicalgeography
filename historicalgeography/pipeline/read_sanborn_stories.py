"""Read each building's storey count from the number Sanborn printed on it.

Sanborn letters the number of storeys in a corner of every building ("1",
"1½", "2", "3"). For each building extracted by extract_sanborn_buildings.py
this finds the small ink marks inside its outline, classifies them with a
model trained on hand-labelled examples (pipeline/samples/<atlas>-glyphs.json),
and sets `stories` on the building in data/features/built.geojson:

  a "3" -> 3; a full-size "2" -> 2; only a "1½" (or the small "2" of one) -> 1.5;
  nothing read -> no `stories` (most of those are one storey, printed "1")

Run after extract_sanborn_buildings.py:

    python3 pipeline/read_sanborn_stories.py sanborn-santa-monica-1902-07
"""

import json
import sys
from pathlib import Path

import cv2
import numpy as np
from rasterio.control import GroundControlPoint
from rasterio.transform import from_gcps
from skimage.feature import hog
from sklearn.svm import SVC

from build_sanborn import GEOREF, RAW

ROOT = Path(__file__).resolve().parent.parent
BUILT = ROOT / "data" / "features" / "built.geojson"
INK = 150  # grey level below which a pixel is ink
HALF_MAX_HEIGHT = 24  # px: the "2" of "1½" is lettered smaller than a storey "2"
DEBUG = None  # a directory to dump marks and scores into, for labelling


def marks(image, ring):
    """Small ink marks inside a building outline (away from its walls)."""
    x0, y0 = np.maximum(np.floor(ring.min(0)).astype(int) - 4, 0)
    x1, y1 = np.ceil(ring.max(0)).astype(int) + 4
    crop = image[y0:y1, x0:x1]
    if crop.size == 0:
        return []
    mask = np.zeros(crop.shape, np.uint8)
    cv2.fillPoly(mask, [np.round(ring - [x0, y0]).astype(np.int32)], 1)
    mask = cv2.erode(mask, np.ones((9, 9), np.uint8))
    ink = cv2.morphologyEx(((crop < INK) & (mask > 0)).astype(np.uint8), cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(ink, 8)
    found = []
    for k in range(1, n):
        x, y, w, h, area = stats[k]
        if 12 <= h <= 80 and 3 <= w <= 80 and area >= 25 and x > 0 and y > 0:
            found.append((int(x + x0), int(y + y0), int(w), int(h)))
    return found


def features(image, x, y, w, h):
    """Shape of a mark (gradient histogram of its grey-level patch) and its size."""
    patch = 255 - image[y:y + h, x:x + w]
    side = max(h, w)
    pad = np.zeros((side + 4, side + 4), np.uint8)
    pad[2 + (side - h) // 2:2 + (side - h) // 2 + h, 2 + (side - w) // 2:2 + (side - w) // 2 + w] = patch
    small = cv2.resize(pad, (32, 32), interpolation=cv2.INTER_AREA)
    shape = hog(small, orientations=9, pixels_per_cell=(8, 8), cells_per_block=(2, 2))
    return np.concatenate([shape, [h / 40, w / 40]])


def main(atlas_id):
    labels = json.loads((ROOT / "pipeline" / "samples" / f"{atlas_id}-glyphs.json").read_text())
    built = json.loads(BUILT.read_text())
    prefix = f"{atlas_id}-bldg-"
    by_part = {}
    for f in built["features"]:
        fid = str(f["properties"]["id"])
        if fid.startswith(prefix):
            by_part.setdefault(fid[len(prefix):].rsplit("-", 1)[0], []).append(f)

    rows = []  # (feature, part, x, y, w, h, vector)
    for part, feats in sorted(by_part.items()):
        georef = json.loads((GEOREF / atlas_id / f"sheet-{part}.json").read_text())
        inverse = ~from_gcps([GroundControlPoint(row=g["py"], col=g["px"], x=g["lng"], y=g["lat"])
                              for g in georef["gcps"]])
        image = cv2.imread(str(RAW / atlas_id / f"sheet-{georef['sheet']}.jpg"), cv2.IMREAD_GRAYSCALE)
        for f in feats:
            ring = np.array([inverse * tuple(c) for c in f["geometry"]["coordinates"][0]])
            for x, y, w, h in marks(image, ring):
                rows.append((f, part, x, y, w, h, features(image, x, y, w, h)))
        print(f"  sheet {part}: {len(feats)} buildings", flush=True)
    X = np.array([r[6] for r in rows], np.float32)

    # Training set: the labelled marks, plus a random sample as "other"
    # (storey numbers other than "1" are a few percent of all marks).
    where = {(r[1], r[2], r[3]): i for i, r in enumerate(rows)}
    train = {}
    for cls in ("two", "three", "half", "other"):
        for part, x, y, *_ in labels[cls]:
            i = where.get((part, x, y))
            if i is None:
                print(f"  labelled mark {part} {x},{y} not found (outline changed?)")
            else:
                train[i] = cls
    rng = np.random.default_rng(1)
    for i in rng.choice(len(rows), min(2500, len(rows)), replace=False):
        train.setdefault(int(i), "other")
    idx = np.array(list(train))
    model = SVC(C=1, gamma="scale", class_weight={"two": 5, "three": 10, "half": 5, "other": 1})
    model.fit(X[idx], [train[i] for i in idx])
    predicted = model.predict(X)
    if DEBUG:
        import pickle
        pickle.dump([(r[1], r[2], r[3], r[4], r[5]) for r in rows], open(DEBUG + "/rows.pkl", "wb"))
        np.save(DEBUG + "/X.npy", X)
        pickle.dump(model, open(DEBUG + "/model.pkl", "wb"))

    read = {}
    for i, (f, _, x, y, w, h, _) in enumerate(rows):
        cls = train.get(i) or predicted[i]
        if cls == "other":
            continue
        # The "2" of "1½" is lettered smaller than a storey "2".
        storeys = {"three": 3, "half": 1.5}.get(cls, 2 if h > HALF_MAX_HEIGHT else 1.5)
        fid = f["properties"]["id"]
        read[fid] = max(read.get(fid, 0), storeys)

    counts = {}
    for feats in by_part.values():
        for f in feats:
            p = f["properties"]
            p.pop("stories", None)
            if f["properties"]["id"] in read:
                p["stories"] = read[p["id"]]
            counts[p.get("stories")] = counts.get(p.get("stories"), 0) + 1
    BUILT.write_text('{"type":"FeatureCollection","features":[\n'
                     + ",\n".join(json.dumps(f, separators=(",", ":"), ensure_ascii=False) for f in built["features"])
                     + "\n]}\n")
    print("storeys read:", {("not read" if k is None else k): v for k, v in sorted(counts.items(), key=lambda kv: kv[0] or 0)})


if __name__ == "__main__":
    main(sys.argv[1])
