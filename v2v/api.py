"""Read-only dashboard API for a completed evaluation."""
import csv
from itertools import islice
import json
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parents[1]
RUN = Path(os.environ.get("V2V_RUN_DIR", ROOT / "runs" / "demo"))
WEB = ROOT / "web" / "dist" / "dashboard" / "browser"
app = FastAPI(title="V2V Fusion", version="1.0.0")


@app.get("/api/overview")
def overview():
    return {
        "target": "Unit 2 relative to Unit 1 in local east/north metres",
        "modalities": ["360-degree RGB coverage", "3D LiDAR", "60 GHz beam powers"],
        "historical": {"approx_error_m": 3, "metric": "3D RMSE", "scenario": 36, "test_samples": 1000, "status": "original-report"},
        "evaluation_available": (RUN / "report.json").is_file(),
    }


@app.get("/api/results")
def results():
    if not (RUN / "report.json").is_file():
        raise HTTPException(404, "No completed evaluation is configured")
    return json.loads((RUN / "report.json").read_text())


@app.get("/api/predictions")
def predictions(offset: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=500)):
    report = results()
    with (RUN / "predictions.csv").open(newline="") as handle:
        page = list(islice(csv.DictReader(handle), offset, offset + limit))
    return {"total": report["counts"]["test"], "rows": [
        {key: value if key in ("id", "drive") else float(value) for key, value in row.items()}
        for row in page
    ]}


@app.get("/api/predictions.csv")
def download():
    results()
    return FileResponse(RUN / "predictions.csv", filename="predictions.csv", media_type="text/csv")


if WEB.is_dir():
    app.mount("/", StaticFiles(directory=WEB, html=True), name="dashboard")
