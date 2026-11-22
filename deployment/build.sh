#!/bin/sh
set -eu

python -m pip install fastapi==0.115.12 uvicorn==0.34.2
npm --prefix web ci --include=dev --no-audit --no-fund
npm --prefix web run build
test -f web/dist/dashboard/browser/index.html
test -s deployment/demo/report.json
test -s deployment/demo/predictions.csv
