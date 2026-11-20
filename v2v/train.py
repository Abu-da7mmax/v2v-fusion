"""Train, freeze the best validation model, and evaluate the held-out drives."""
import argparse
import csv
import json
from pathlib import Path
import hashlib
import os

import numpy as np
import tensorflow as tf
from tensorflow import keras

from .data import SHAPES, features, manifest, split


def batches(rows, size, shuffle=False, seed=42):
    def generate():
        for row in rows:
            yield features(row), row["target"]

    signature = (
        {key: tf.TensorSpec(shape, tf.float32) for key, shape in SHAPES.items()},
        tf.TensorSpec((2,), tf.float32),
    )
    dataset = tf.data.Dataset.from_generator(generate, output_signature=signature)
    dataset = dataset.apply(tf.data.experimental.assert_cardinality(len(rows)))
    if shuffle:
        dataset = dataset.shuffle(min(len(rows), 256), seed=seed)
    options = tf.data.Options()
    options.threading.private_threadpool_size = 2
    return dataset.with_options(options).batch(size).prefetch(1)


def fusion_model():
    layers = keras.layers
    inputs = {key: keras.Input(shape=shape, name=key) for key, shape in SHAPES.items()}
    branches = []
    for key in ("camera", "lidar"):
        branch = inputs[key]
        for channels in (16, 24, 32):
            branch = layers.Conv2D(channels, 3, strides=2, padding="same", activation="relu")(branch)
        branches.append(layers.Dense(48, activation="relu")(layers.Flatten()(branch)))
    rf = layers.Rescaling(0.02)(inputs["rf"])
    branches.append(layers.Dense(48, activation="relu")(layers.Dense(96, activation="relu")(rf)))
    fused = layers.Dense(96, activation="relu")(layers.Concatenate()(branches))
    output = layers.Dense(2, name="east_north_m")(layers.Dropout(0.15)(fused))
    model = keras.Model(inputs, output)
    model.compile(optimizer=keras.optimizers.Adam(3e-4), loss=keras.losses.Huber(delta=5))
    return model


def metrics(truth, predicted):
    error = np.linalg.norm(predicted - truth, axis=1)
    if not np.isfinite(error).all():
        raise ValueError("Non-finite model error")
    return {
        "mean_m": float(error.mean()),
        "rmse_m": float(np.sqrt(np.mean(error**2))),
        "median_m": float(np.median(error)),
        "p90_m": float(np.percentile(error, 90)),
    }


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def train(config, output, epochs, size, seed):
    if epochs < 1 or size < 1:
        raise ValueError("epochs and batch size must be positive")
    keras.utils.set_random_seed(seed)
    tf.config.experimental.enable_op_determinism()
    spec, rows = manifest(config)
    partitions = split(spec, rows)
    output.mkdir(parents=True, exist_ok=False)
    (output / "split.json").write_text(json.dumps(
        {name: [row["id"] for row in subset] for name, subset in partitions.items()}, indent=2))
    model = fusion_model()
    history = model.fit(
        batches(partitions["train"], size, shuffle=True, seed=seed),
        validation_data=batches(partitions["val"], size), epochs=epochs, verbose=2, shuffle=False,
        callbacks=[
            keras.callbacks.ModelCheckpoint(output / "model.keras", save_best_only=True),
            keras.callbacks.EarlyStopping(patience=6),
        ],
    )
    (output / "history.json").write_text(json.dumps(history.history, indent=2, allow_nan=False))
    model = keras.models.load_model(output / "model.keras", compile=False)
    predictions = []
    truth = []
    for inputs, targets in batches(partitions["test"], size):
        predictions.extend(model(inputs, training=False).numpy())
        truth.extend(targets.numpy())
    truth, predictions = np.asarray(truth), np.asarray(predictions)
    baseline = np.mean([r["target"] for r in partitions["train"]], axis=0)
    errors = np.linalg.norm(predictions - truth, axis=1)
    with (output / "predictions.csv").open("w", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(["id", "drive", "east_m", "north_m", "pred_east_m", "pred_north_m", "error_m"])
        for row, actual, estimate, error in zip(partitions["test"], truth, predictions, errors, strict=True):
            writer.writerow([row["id"], row["drive"], *actual, *estimate, error])
    report = {
        "source": spec["source"], "seed": seed, "batch_size": size,
        "epochs_requested": epochs, "best_epoch": int(np.argmin(history.history["val_loss"])) + 1,
        "tensorflow": tf.__version__, "config": spec, "config_sha256": digest(config),
        "csv_sha256": {drive["id"]: digest(config.parent / drive["csv"]) for drive in spec["drives"]},
        "counts": {key: len(value) for key, value in partitions.items()},
        "split": spec["split"], "model": metrics(truth, predictions),
        "baseline": metrics(truth, np.broadcast_to(baseline, truth.shape)),
    }
    pending = output / "report.tmp"
    pending.write_text(json.dumps(report, indent=2, allow_nan=False))
    os.replace(pending, output / "report.json")
    print(json.dumps({key: report[key] for key in ("source", "counts", "model", "baseline")}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("config", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    train(args.config, args.output, args.epochs, args.batch_size, args.seed)
