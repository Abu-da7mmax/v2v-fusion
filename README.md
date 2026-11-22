# V2V Fusion

**[Open the live dashboard](https://v2v-fusion.onrender.com/)** · **[Explore the FastAPI docs](https://v2v-fusion.onrender.com/docs)**

The senior project used synchronized RGB camera views, 3D LiDAR and 60 GHz beam powers to estimate relative vehicle pose. This repository presents the original evaluation and a runnable TensorFlow reconstruction for horizontal position estimation. FastAPI serves completed evaluation artifacts alongside the Angular dashboard.

| Page | What to explore |
| --- | --- |
| **Dashboard** | Select a sample, switch camera views, plot RF values and rotate the LiDAR point cloud. The bundled example uses four synthetic samples; open a local DeepSense scenario to replay real files. |
| **Dataset Explorer** | Published routes, locations, lighting, sample counts, and collection statistics for Scenarios 36–39. |
| **How It Works, Results, Ablation** | The original sensor-fusion architecture and the graduation report's results and modality comparisons. |
| **Demo** | A runnable evaluation browser with 16 synthetic predictions, pagination and CSV export. |

The hosted app includes a synthetic sensor preview and archived evaluation tables. The browser can replay locally supplied DeepSense recordings. Reproducing the original 3D evaluation requires the original model checkpoint and evaluation inputs. The Render free instance can take about a minute to start after a period of inactivity.

## Replay real DeepSense files

1. Download and extract one scenario from the [official DeepSense-V2V portal](https://www.deepsense6g.net/scenarios/Scenarios%2030-39/scenarios-36-39). For Scenario 36, part 1 has the index CSV, GPS information, RF powers and RGB180 files. The later part has the other camera views and LiDAR. Download only the modalities you want to inspect.
2. In **Dashboard**, select **Open DeepSense folder**. Choose the extracted folder containing `scenario36.csv` and `unit1/`. Keep file names and subfolders as referenced by the index CSV. The browser matches cameras `rgb1` through `rgb6`, four `pwr` files and the `lidar1` CSV by sample ID. For a smaller replay folder, copy the original index CSV and a subset of sensor files with the same relative paths. The list includes only rows with matching sensor files.
3. Select a sample by ID or use Previous and Next. Available cameras have enabled buttons. The RF panel expects 64 numeric powers per file. The LiDAR panel reads XYZ in metres from CSV, draws up to 10,000 returns and supports rotation, tilt and zoom. The dashboard reads these files locally in the browser. Opening the external OpenStreetMap link sends the selected GPS location to OpenStreetMap.
4. To compare model outputs, select **Load predictions CSV**. Join on the sensor index using `id`, `sample_id`, or `index`. A scenario-qualified ID such as `36/2674` also works. For a horizontal run use `pred_east_m,pred_north_m` and optional `east_m,north_m`. For the original pose format, map exported columns to `pred_dx,pred_dy,pred_dz,pred_heading_deg` and `true_dx,true_dy,true_dz,true_heading_deg`. X/Y are required in this format; Z, heading, and ground truth appear only where supplied. The GPS-derived east/north reference is shown when both geodetic positions are available. The viewer reads saved predictions and does not run inference on imported sensor files.

## Result provenance

| Result | Status |
| --- | --- |
| Original senior project, approximately 3 m error | Original report, Table 5: 3.0 m 3D RMSE, 1.9 m median 3D error and 94.7% heading accuracy within ±15° over 1,000 Scenario 36 samples. Original checkpoint and raw replay assets are needed to reproduce these historical results. |
| DeepSense-V2V reconstruction | Real-data evaluation pending. The archive requires dataset sign-in and local extraction. |
| Synthetic integration check | Three training epochs, with 32/12/16 train/validation/test samples. Fusion mean error 15.58 m and training-mean baseline 15.55 m. These numbers describe only the generated fixture and do not characterize DeepSense performance. |

## Run locally

Use Python 3.12 and Node.js 24. Run commands from the repository root. To serve the same bundled demo as the live site, build the Angular frontend and point the API at the included results.

```bash
python -m pip install fastapi==0.115.12 uvicorn==0.34.2
npm --prefix web ci
npm --prefix web run build
export V2V_RUN_DIR=deployment/demo
# PowerShell equivalent: $env:V2V_RUN_DIR = 'deployment/demo'
python -m uvicorn v2v.api:app
```

### Train a new synthetic run

The CPU workflow works without a GPU. Start in a clean checkout, or unset `V2V_RUN_DIR` before serving the new run.

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

Each run saves `model.keras`, `history.json`, `split.json`, `predictions.csv` and `report.json` with parameters and manifest hashes. The Dashboard reads sensor files for the selected sample. Dataset Explorer and Results present the published routes, collection statistics and original evaluation tables. The Demo tab reads the current horizontal-position run from FastAPI and paginates the per-sample predictions. Keep the original sensor files and record their release version for forensic reproducibility. Seeded runs can still vary across hardware and TensorFlow versions.

The target axes are geographic and the sensor tensors are vehicle-mounted. Without vehicle heading, the geographic direction can be ambiguous from a single snapshot. Test performance therefore depends on route coverage and sensor cues. GPS errors, synchronization offsets, beam sweep timing, and LiDAR cropping also affect the achievable accuracy. This is an offline localization experiment.

## Deploy the dashboard to Render

Create a Python web service from the repository root on the `main` branch.
For the free dashboard demo, use the following settings.

| Setting | Value |
| --- | --- |
| Build command | `sh deployment/build.sh` |
| Start command | `python -m uvicorn v2v.api:app --host 0.0.0.0 --port $PORT` |
| Environment | `PYTHON_VERSION=3.12.13`, `NODE_VERSION=24.15.0`, `V2V_RUN_DIR=deployment/demo` |
| Optional HTTP health check | `/api/overview` |

The web service serves the Angular interface and FastAPI at the same origin.
The bundled report and CSV in `deployment/demo` come from the synthetic smoke test.
Model training and raw DeepSense data are managed separately from the public dashboard. The active Render service uses manual deploys from `main`.

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
