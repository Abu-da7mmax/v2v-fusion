"""Inspect a source CSV or validate a mapped dataset before training."""
import argparse
import csv
from pathlib import Path

from .data import features, manifest, split


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    options = parser.add_mutually_exclusive_group(required=True)
    options.add_argument("--csv", type=Path, help="Print the column names and first-row values")
    options.add_argument("--config", type=Path, help="Check a mapped dataset and split")
    parser.add_argument("--all", action="store_true", help="Decode every sensor sample")
    args = parser.parse_args()
    if args.csv:
        with args.csv.open(encoding="utf-8-sig", newline="") as stream:
            reader = csv.DictReader(stream)
            for name, value in next(reader, {}).items():
                print(f"{name}: {value}")
        return
    spec, rows = manifest(args.config)
    for name, subset in split(spec, rows).items():
        for row in subset if args.all else subset[:1]:
            decoded = features(row)
        print(f"{name}: {len(subset)} samples, shapes "
              f"{ {key: value.shape for key, value in decoded.items()} }")


if __name__ == "__main__":
    main()
