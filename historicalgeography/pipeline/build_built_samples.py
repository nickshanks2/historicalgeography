"""Write the built-environment style samples (Phase 1) to data/features/built.geojson.

Takes the `dataset: built` features from pipeline/samples/sketch.geojson.
All are flagged `sample: true`; Phases 3 and 4 replace them with traced,
sourced streets, buildings and piers (and remove them from the sketch).
Sourced features already in built.geojson are kept.

    python3 pipeline/build_built_samples.py
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKETCH = ROOT / "pipeline" / "samples" / "sketch.geojson"
OUT = ROOT / "data" / "features" / "built.geojson"


def main():
    sketch = json.loads(SKETCH.read_text())["features"]
    current = json.loads(OUT.read_text())["features"] if OUT.exists() else []
    features = [f for f in current if not f["properties"].get("sample")]
    for feature in sketch:
        props = dict(feature["properties"])
        if props.pop("dataset") == "built":
            features.append({**feature, "properties": props})
    features.sort(key=lambda f: str(f["properties"]["id"]))
    OUT.write_text('{"type":"FeatureCollection","features":[\n'
                   + ",\n".join(json.dumps(f, separators=(",", ":"), ensure_ascii=False) for f in features)
                   + "\n]}\n")
    print(f"{len(features)} features -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
