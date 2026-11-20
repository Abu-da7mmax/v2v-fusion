"""Write an original synthetic dataset only for integration testing."""
import csv
import json
from pathlib import Path
import sys

import numpy as np
from PIL import Image


def create(root):
    root.mkdir(parents=True, exist_ok=False)
    mapping = {
        "id": "index", "camera": ["rgbA", "rgbB"], "lidar": "lidar",
        "rf": ["pwr1", "pwr2", "pwr3", "pwr4"],
        "ego_gps": ["ego_lat", "ego_lon"], "peer_gps": ["peer_lat", "peer_lon"],
    }
    config = {"source": "synthetic", "drives": [], "split": {}}
    rng = np.random.default_rng(42)
    for name, size in (("train", 32), ("val", 12), ("test", 16)):
        drive = root / name
        drive.mkdir()
        config["drives"].append({"id": name, "csv": f"{name}/samples.csv", "columns": mapping})
        config["split"][name] = [name]
        with (drive / "samples.csv").open("w", newline="") as stream:
            out = csv.writer(stream)
            out.writerow(["index", "rgbA", "rgbB", "lidar", *mapping["rf"],
                          *mapping["ego_gps"], *mapping["peer_gps"]])
            for i in range(size):
                e, n = rng.uniform(-20, 20, 2)
                rgb_files = [f"{i}-{side}.png" for side in ("a", "b")]
                for view, file in enumerate(rgb_files):
                    image = np.full((64, 64, 3), 25 + 25 * view, dtype=np.uint8)
                    x, y = np.rint([32 + e, 32 - n]).astype(int)
                    image[y-3:y+4, x-3:x+4] = (80, 240, 180)
                    Image.fromarray(image).save(drive / file)
                lidar = f"{i}.npy"
                np.save(drive / lidar, rng.normal([e, n, 1], [1, 1, .4], (256, 3)))
                power_files = [f"{i}-p{k}.txt" for k in range(4)]
                angle = np.arctan2(n, e)
                for k, file in enumerate(power_files):
                    angles = np.linspace(-np.pi / 2, np.pi / 2, 64) + k * np.pi / 2
                    np.savetxt(drive / file, -75 + 25*np.cos(angle - angles) - np.hypot(e,n)/2)
                out.writerow([i, *rgb_files, lidar, *power_files, 33.4, -111.9,
                              33.4 + n/110900, -111.9 + e/93000])
    (root / "config.json").write_text(json.dumps(config, indent=2))


if __name__ == "__main__":
    create(Path(sys.argv[1]))
