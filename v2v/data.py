"""Synchronized sensor decoding and GPS-derived targets."""
import csv
import json
from pathlib import Path

import numpy as np
from PIL import Image

SHAPES = {"camera": (64, 128, 3), "lidar": (64, 64, 2), "rf": (256,)}


def numeric(path):
    if path.suffix.lower() == ".npy":
        return np.load(path, allow_pickle=False)
    for delimiter in (None, ",", ";"):
        try:
            return np.loadtxt(path, delimiter=delimiter)
        except ValueError:
            continue
    raise ValueError(f"Cannot decode numeric file {path}")


def gps(raw, root, columns):
    if len(columns) == 2:
        lat, lon = (float(raw[c]) for c in columns)
    else:
        values = numeric(asset(root, raw[columns[0]])).ravel()
        lat, lon = values[columns[1]], values[columns[2]]
    if not (-90 <= lat <= 90 and -180 <= lon <= 180) or (lat, lon) == (0, 0):
        raise ValueError("Invalid GPS coordinates")
    return np.array([lat, lon])


def horizontal_offset(ego, peer):
    """WGS84 ECEF chord projected onto the ego east/north tangent plane."""
    def ecef(coords):
        lat, lon = np.radians(coords)
        radius = 6378137 / np.sqrt(1 - 0.00669437999014 * np.sin(lat)**2)
        return radius * np.array([
            np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon),
            (1 - 0.00669437999014) * np.sin(lat),
        ])

    lat, lon = np.radians(ego)
    basis = [[-np.sin(lon), np.cos(lon), 0],
             [-np.sin(lat)*np.cos(lon), -np.sin(lat)*np.sin(lon), np.cos(lat)]]
    return np.asarray(basis) @ (ecef(peer) - ecef(ego))


def asset(root, value):
    if not value or not value.strip() or value.strip().lower() == "nan":
        raise ValueError("Missing asset path")
    path = (root / value.strip().replace("\\", "/")).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        raise ValueError(f"Missing or invalid asset path: {value}")
    return path


def manifest(config):
    spec = json.loads(config.read_text())
    kind = spec["source"]
    if kind not in {"synthetic", "deepsense-v2v"}:
        raise ValueError("Unknown dataset source")
    rows = []
    rejected = []
    groups = set()
    for drive in spec["drives"]:
        group = drive["id"]
        if group in groups:
            raise ValueError(f"Duplicate drive {group}")
        groups.add(group)
        mapping = drive["columns"]
        for key, count in (("camera", 2), ("rf", 4)):
            if len(set(mapping[key])) != count:
                raise ValueError(f"Expected {count} distinct {key} columns")
        file = (config.parent / drive["csv"]).resolve()
        with file.open(encoding="utf-8-sig", newline="") as stream:
            reader = csv.DictReader(stream)
            required = [mapping["id"], mapping["lidar"], *mapping["camera"], *mapping["rf"]]
            for key in ("ego_gps", "peer_gps"):
                columns = mapping[key]
                if len(columns) not in (2, 3):
                    raise ValueError(f"Invalid GPS mapping {key}")
                required.extend(columns if len(columns) == 2 else columns[:1])
            missing = set(required) - set(reader.fieldnames or [])
            if missing:
                raise ValueError(f"{file} missing CSV columns: {sorted(missing)}")
            seen = set()
            for raw in reader:
                key = raw[mapping["id"]]
                if not key or key in seen:
                    raise ValueError(f"{file}: empty or duplicate sample ID {key!r}")
                seen.add(key)
                try:
                    get = lambda name: asset(file.parent, raw[name])
                    target = horizontal_offset(
                        gps(raw, file.parent, mapping["ego_gps"]),
                        gps(raw, file.parent, mapping["peer_gps"]),
                    )
                    rows.append({
                        "id": f"{group}/{key}", "drive": group,
                        "camera": [get(col) for col in mapping["camera"]],
                        "lidar": get(mapping["lidar"]),
                        "rf": [get(col) for col in mapping["rf"]],
                        "target": target.astype("float32"),
                    })
                except (ValueError, OSError, IndexError, TypeError) as error:
                    if len(rejected) < 5:
                        rejected.append(f"{group}/{key}: {error}")
    if rejected:
        raise ValueError("Repair or explicitly filter incomplete rows before training:\n" + "\n".join(rejected))
    return spec, rows


def lidar_grid(path):
    if path.suffix.lower() in {".las", ".laz"}:
        import laspy
        cloud = laspy.read(path)
        xyz = np.column_stack([cloud.x, cloud.y, cloud.z])
    else:
        xyz = numeric(path)
        if xyz.ndim < 2 or xyz.shape[-1] < 3:
            raise ValueError(f"LiDAR requires XYZ columns: {path}")
        xyz = xyz.reshape(-1, xyz.shape[-1])[:, :3]

    valid = np.isfinite(xyz).all(axis=1) & (xyz[:, :2] >= -64).all(axis=1)
    valid &= (xyz[:, :2] < 64).all(axis=1) & np.any(xyz != 0, axis=1)
    xyz = xyz[valid]
    x, y = ((xyz[:, :2] + 64) / 2).astype(int).T
    count = np.zeros((64, 64), dtype="float32")
    height = np.zeros_like(count)
    np.add.at(count, (y, x), 1)
    np.maximum.at(height, (y, x), np.clip((xyz[:, 2] + 4) / 12, 0, 1))
    return np.stack([np.log1p(count) / 8, height], axis=-1)


def features(row):
    halves = []
    for path in row["camera"]:
        with Image.open(path) as image:
            halves.append(np.asarray(image.convert("RGB").resize((64, 64), Image.Resampling.BILINEAR)))
    powers = [numeric(path).ravel() for path in row["rf"]]
    if any(p.size != 64 or not np.isfinite(p).all() for p in powers):
        raise ValueError(f"{row['id']}: expected 64 finite beam powers per array")
    return {
        "camera": np.concatenate(halves, axis=1).astype("float32") / 255,
        "lidar": lidar_grid(row["lidar"]),
        "rf": np.concatenate(powers).astype("float32"),
    }


def split(spec, rows):
    partitions = spec["split"]
    if set(partitions) != {"train", "val", "test"}:
        raise ValueError("Specify train, val and test drive lists")
    assigned = [drive for drives in partitions.values() for drive in drives]
    if len(set(assigned)) != len(assigned) or set(assigned) != {r["drive"] for r in rows}:
        raise ValueError("Each nonempty drive must occur in exactly one split")
    outputs = {name: [r for r in rows if r["drive"] in drives] for name, drives in partitions.items()}
    if not all(outputs.values()):
        raise ValueError("All three splits must contain samples")
    for field in ("camera", "lidar", "rf"):
        assets = set()
        for subset in outputs.values():
            paths = {p for r in subset for p in ([r[field]] if field == "lidar" else r[field])}
            if paths & assets:
                raise ValueError(f"Shared {field} file paths across splits")
            assets |= paths
    return outputs
