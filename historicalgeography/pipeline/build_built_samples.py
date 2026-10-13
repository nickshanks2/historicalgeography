"""Write the built-environment style samples (Phase 1) to data/features/built.geojson.

Takes the `dataset: built` features from pipeline/samples/sketch.geojson.
All are flagged `sample: true`; Phases 3 and 4 replace them with traced,
sourced streets, buildings and piers.

    python3 pipeline/build_built_samples.py
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKETCH = ROOT / "pipeline" / "samples" / "sketch.geojson"
OUT = ROOT / "data" / "features" / "built.geojson"


def main():
    sketch = json.loads(SKETCH.read_text())["features"]
    features = []
    for feature in sketch:
        props = dict(feature["properties"])
        if props.pop("dataset") == "built":
            features.append({**feature, "properties": props})
    OUT.write_text(
        json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":"))
        + "\n"
    )
    print(f"{len(features)} features -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
