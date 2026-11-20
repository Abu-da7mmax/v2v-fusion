# V2V Fusion

Estimate the horizontal position of a peer vehicle relative to an instrumented receiver using synchronized RGB camera views, 3D LiDAR and 60 GHz receive beam powers. TensorFlow trains the estimator. FastAPI serves completed evaluation artifacts and the Angular dashboard.

## Result provenance

| Result | Status |
| --- | --- |
| Original senior project, approximately 3 m error | User-reported historical figure. Original metric, scenario, checkpoint and split are unknown. |
| DeepSense-V2V reconstruction | Real-data evaluation pending. The archive requires dataset sign-in and local extraction. |
| Synthetic integration check | Three training epochs, with 32/12/16 train/validation/test samples. Fusion mean error 15.58 m and training-mean baseline 15.55 m. These numbers describe only the generated fixture and do not characterize DeepSense performance. |

## Run locally

Use Python 3.12 and Node.js 24. Run commands from the repository root. The CPU workflow works without a GPU.

```bash
python -m venv .venv
# Bash
source .venv/bin/activate
# PowerShell equivalent: .\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt

python -m v2v.demo data/demo
python -m v2v.inspect_data --config data/demo/config.json --all
python -m v2v.train data/demo/config.json runs/demo --epochs 3 --batch-size 8

cd web
npm ci
npm run build
cd ..
python -m uvicorn v2v.api:app
```

Open http://127.0.0.1:8000 for the dashboard and http://127.0.0.1:8000/docs for the API. For Angular development, run `npm start` inside `web/` while FastAPI is running, then open http://localhost:4200. It proxies `/api` to FastAPI. Use fresh demo and run directory names for repeated runs. The API supports an empty state before training.

## Train and evaluate on DeepSense-V2V

1. Sign in on the [official Scenarios 36–39 download page](https://www.deepsense6g.net/scenarios/Scenarios%2030-39/scenarios-36-39). For each scenario, download the GPS, receive power, RGB180 and CSV files from part 1, and LiDAR from the later part. Extract all selected volumes. Keep both units and their asset directories next to each scenario CSV, as described by the dataset provider. Radar, RGB90 and pickle files are unnecessary.
2. Copy `configs/deepsense.example.json` to `configs/deepsense.local.json`. Set each CSV filename and replace the marked example column names with the exact names from the downloaded CSV. Inspect each CSV with the command below. Each row must describe one synchronized sample. Use two distinct RGB180 paths, the Unit 1 LiDAR path, and the four Unit 1 power paths in consistent array order across drives. Specify Unit 1 and Unit 2 GPS separately.
3. Use `["latitude_column","longitude_column"]` for inline decimal degrees, or `["gps_path_column", 0, 1]` for a numeric GPS sidecar with latitude at flattened index 0 and longitude at index 1. Adjust indices to the file layout. Asset paths resolve relative to the CSV. Input shapes and supported formats are listed below. For a release-specific asset encoding outside this contract, convert it to an accepted numeric file and update the CSV path, keeping the synchronized ID. Record any quality filters, rejected-row counts, or format conversions alongside your run.
4. Validate the manifest and train. The example uses Scenarios 36 and 38 for training, 37 for validation and 39 as the unseen test scenario. Decide the split before training. Use separate recordings for a smaller pilot and keep all synchronized rows from each recording in a single partition.

```bash
python -m v2v.inspect_data --csv data/Scenario36/scenario36.csv
python -m v2v.inspect_data --config configs/deepsense.local.json
python -m v2v.train configs/deepsense.local.json runs/deepsense-001 --epochs 30 --batch-size 16 --seed 42

# Bash
export V2V_RUN_DIR=runs/deepsense-001
# PowerShell equivalent: $env:V2V_RUN_DIR = 'runs/deepsense-001'
python -m uvicorn v2v.api:app
```

Pass `--all` to the inspection command for a full decode check before a long run. Missing assets and malformed samples stop the workflow with an error. The full dataset is large. Training streams frames from disk with bounded buffering and can be I/O-intensive.

| Input | Decoder and representation |
| --- | --- |
| Camera | Pillow-readable images, resized to 64×64 RGB per view, joined in the configured order |
| LiDAR | LAS/LAZ or numeric NPY/text XYZ, including organized H×W×C arrays with XYZ in the first three channels. Rasterized over ±64 m in X/Y into 64×64 density/height cells |
| RF | Four numeric NPY/text vectors of 64 finite powers each. Preserve published beam order and power scale across all splits |
| GPS targets | Paired latitude/longitude, converted to WGS84 ECEF and projected from Unit 1 onto its local east/north tangent plane. Height is ignored |

## Evaluation protocol

The camera and LiDAR CNNs and RF dense encoder feed a late-fusion regression head with two outputs, east and north in metres. GPS is used only for target construction. The Huber loss is optimized on the training split. The checkpoint with lowest validation loss is loaded once for the held-out test. The comparator always predicts the mean training offset. Mean, RMSE, median and P90 use the Euclidean norm of each two-axis residual.

Each run saves `model.keras`, `history.json`, `split.json`, `predictions.csv` and `report.json` with parameters and manifest hashes. The dashboard reads the report and paginates the per-sample predictions. Keep the original sensor files and record their release version for forensic reproducibility. Seeded runs can still vary across hardware and TensorFlow versions.

The target axes are geographic and the sensor tensors are vehicle-mounted. Without vehicle heading, the geographic direction can be ambiguous from a single snapshot. Test performance therefore depends on route coverage and sensor cues. GPS errors, synchronization offsets, beam sweep timing, and LiDAR cropping also affect the achievable accuracy. This is an offline localization experiment.

## Repository layout

| Path | Responsibility |
| --- | --- |
| `configs/` | DeepSense mapping and scenario split template |
| `v2v/data.py` | CSV mapping, geodesy, sensor decoders, split checks |
| `v2v/demo.py`, `v2v/inspect_data.py` | Synthetic fixture and dataset diagnostics |
| `v2v/train.py` | TensorFlow training and held-out evaluation |
| `v2v/api.py` | Read-only FastAPI endpoints and built dashboard |
| `web/` | Angular source and locked npm dependencies |

DeepSense-V2V reference: João Morais, Gouranga Charan, Nikhil Srinivas and Ahmed Alkhateeb, [IEEE Transactions on Vehicular Technology](https://doi.org/10.1109/TVT.2025.3578349). Obtain sensor data from the dataset provider under its terms. This repository package contains source files and a generator for synthetic data.
