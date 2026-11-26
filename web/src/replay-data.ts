export type XYZ = [number, number, number];
export type GPS = [number, number, number | null];
export type Camera = { number: number; file: File | string };
export type Pose = { fields: string[]; truth: (number | null)[]; predicted: (number | null)[] };
export type Sample = {
  id: string;
  time: string;
  camera: Camera[];
  rf: (File | number[] | null)[];
  lidar: File | XYZ[] | null;
  ego: GPS | null;
  peer: GPS | null;
  pose?: Pose;
};
export type Replay = { label: string; example: boolean; samples: Sample[] };

export function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  const input = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '"' && quoted && input[i + 1] === '"') {
      field += '"';
      i++;
    } else if (c === '"' && (quoted || field === '')) {
      quoted = !quoted;
    } else if (!quoted && (c === ',' || c === '\n' || c === '\r')) {
      row.push(field.trim());
      field = '';
      if (c !== ',') {
        if (row.some(Boolean)) rows.push(row);
        row = [];
        if (c === '\r' && input[i + 1] === '\n') i++;
      }
    } else {
      field += c;
    }
  }
  if (quoted) throw new Error('The CSV has an unfinished quoted field.');
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

const key = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
const relative = (path: string) => path.replaceAll('\\', '/').replace(/^\.\//, '');
const value = (text?: string) => {
  const number = text?.trim() ? Number(text) : NaN;
  return Number.isFinite(number) ? number : null;
};

function readGps(row: string[], headers: Map<string, number>, unit: number): GPS | null {
  const get = (...names: string[]) => names.map(n => headers.get('unit' + unit + n))
    .find(i => i !== undefined);
  const gpsPath = row.findIndex(p => new RegExp('^unit' + unit + '/gps1/', 'i').test(relative(p)));
  const latIndex = get('latitude', 'lat', 'latdeg', 'gps1latitude', 'gpslatitude', 'gps1lat', 'gpslat');
  const lonIndex = get('longitude', 'lon', 'long', 'londeg', 'gps1longitude', 'gpslongitude', 'gps1lon', 'gpslon');
  const altIndex = get('altitude', 'alt', 'altm', 'gps1altitude', 'gpsaltitude', 'gps1alt', 'gpsalt');
  const at = (column: number | undefined, defaultOffset: number) =>
    value(row[column ?? (gpsPath < 0 ? -1 : gpsPath + defaultOffset)]);
  const lat = at(latIndex, 1), lon = at(lonIndex, 2);
  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (!lat && !lon)) return null;
  return [lat, lon, at(altIndex, 3)];
}

function assetKey(path: string) {
  const cleaned = relative(path);
  return cleaned.split('/').some(p => p === '..') ? '' : cleaned;
}

export async function importScenario(files: File[]): Promise<Replay> {
  const indices = files.filter(f => /^scenario[_ -]?\d+\.csv$/i.test(f.name));
  if (indices.length !== 1) throw new Error('Select one extracted Scenario folder containing its scenario CSV.');
  const index = indices[0];
  const scenario = index.name.match(/\d+/)?.[0] ?? '';
  const parent = index.webkitRelativePath.slice(0, index.webkitRelativePath.lastIndexOf('/') + 1);
  const byPath = new Map(files.map(f => [f.webkitRelativePath || f.name, f]));
  const [header, ...rows] = csvRows(await index.text());
  if (!header || !rows.length) throw new Error('The scenario CSV has no samples.');
  const headers = new Map(header.map((name, i) => [key(name), i]));
  const idColumn = ['absindex', 'index', 'sampleindex', 'sampleid', 'id', 'sample'].map(n => headers.get(n))
    .find(i => i !== undefined) ?? 0;
  const timeColumn = ['timestamp', 'time', 'synchronizationtime', 'syncstamp', 'synctime']
    .map(n => headers.get(n)).find(i => i !== undefined);
  const result: Sample[] = [];
  const ids = new Set<string>();
  for (const row of rows) {
    const id = row[idColumn];
    if (!id || ids.has(id)) throw new Error('The scenario CSV must have nonempty, unique sample IDs.');
    ids.add(id);
    const assets = new Map<string, File>();
    for (const raw of row) {
      const path = assetKey(raw);
      const modality = /^unit1\/(rgb[1-6]|pwr[1-4]|lidar1)\//i.exec(path)?.[1].toLowerCase();
      if (!modality) continue;
      const file = byPath.get(parent + path);
      if (file) assets.set(modality, file);
    }
    if (!assets.size) continue;
    const camera: Camera[] = [];
    for (let number = 1; number <= 6; number++) {
      const file = assets.get('rgb' + number);
      if (file && /\.(jpg|jpeg|png|webp)$/i.test(file.name)) camera.push({ number, file });
    }
    result.push({
      id, time: row[timeColumn ?? -1] ?? '',
      camera, rf: [1, 2, 3, 4].map(n => assets.get('pwr' + n) ?? null),
      lidar: assets.get('lidar1') ?? null,
      ego: readGps(row, headers, 1), peer: readGps(row, headers, 2),
    });
  }
  if (!result.length) throw new Error('No sensor files matched the CSV paths. Keep the CSV and unit1 folder side by side.');
  return { label: 'DeepSense Scenario ' + scenario, example: false, samples: result };
}

export function beamPowers(text: string) {
  const numbers = text.trim().split(/[\s,;]+/).map(value);
  if (numbers.length !== 64 || numbers.some(n => n === null)) {
    throw new Error('Expected 64 finite beam powers in each selected RF file.');
  }
  return numbers as number[];
}

export function lidarPoints(text: string): XYZ[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim());
  const split = (row: string) => row.trim().includes(',') ? row.split(',') :
    row.trim().includes(';') ? row.split(';') : row.trim().split(/\s+/);
  let first = 0;
  let order = [0, 1, 2];
  for (let i = 0; i < Math.min(12, lines.length); i++) {
    const names = split(lines[i]).map(name => key(name.replaceAll('"', '')));
    const xyz = ['x', 'y', 'z'].map(axis => names.findIndex(n =>
      [axis, axis + 'm', axis + '1', axis + '1m'].includes(n)));
    if (xyz.every(index => index >= 0)) {
      order = xyz;
      first = i + 1;
      break;
    }
  }
  if (first === 0 && !split(lines[0] ?? '').slice(0, 3).every(cell => value(cell) !== null)) {
    throw new Error('The LiDAR CSV needs X, Y and Z coordinate columns in metres.');
  }
  const points: XYZ[] = [];
  const stride = Math.max(1, Math.ceil((lines.length - first) / 10000));
  for (let i = first; i < lines.length; i += stride) {
    const cells = split(lines[i]);
    const point = order.map(index => value(cells[index]));
    if (point.every(n => n !== null) && point.some(Boolean)) points.push(point as XYZ);
  }
  if (!points.length) throw new Error('The LiDAR file has no valid XYZ returns.');
  return points;
}

export function enu(ego: GPS, peer: GPS): [number, number] {
  const radians = Math.PI / 180;
  const ecef = ([latitude, longitude]: GPS) => {
    const lat = latitude * radians, lon = longitude * radians;
    const r = 6378137 / Math.sqrt(1 - 0.00669437999014 * Math.sin(lat) ** 2);
    return [r * Math.cos(lat) * Math.cos(lon), r * Math.cos(lat) * Math.sin(lon),
      r * (1 - 0.00669437999014) * Math.sin(lat)];
  };
  const start = ecef(ego);
  const [dx, dy, dz] = ecef(peer).map((n, i) => n - start[i]);
  const b = ego[0] * radians, l = ego[1] * radians;
  return [-Math.sin(l) * dx + Math.cos(l) * dy,
    -Math.sin(b) * Math.cos(l) * dx - Math.sin(b) * Math.sin(l) * dy + Math.cos(b) * dz];
}

export function predictions(text: string, samples: Sample[], scenario: string) {
  const [header, ...rows] = csvRows(text);
  if (!header || !rows.length) throw new Error('The predictions CSV has no samples.');
  const headers = new Map(header.map((name, i) => [key(name), i]));
  const find = (...names: string[]) => names.map(n => headers.get(n)).find(i => i !== undefined);
  const id = find('id', 'sampleid', 'index', 'sampleindex');
  const east = find('predeastm'), north = find('prednorthm');
  const x = find('preddx', 'preddxm', 'predx'), y = find('preddy', 'preddym', 'predy');
  const z = find('preddz', 'preddzm', 'predz'), heading = find('predheadingdeg', 'predheading');
  const isEnu = east !== undefined && north !== undefined;
  if (id === undefined || (!isEnu && (x === undefined || y === undefined))) {
    throw new Error('The CSV needs a sample ID and predicted East/North or X/Y columns. See the README for column names.');
  }
  const byId = new Map<string, string[]>();
  const ids = new Set(samples.map(sample => sample.id));
  for (const row of rows) {
    const raw = row[id];
    const parts = raw?.split('/');
    const sampleId = parts?.length === 2 && parts[0].toLowerCase().replace(/^scenario[_ -]?/, '') === scenario ? parts[1] : raw;
    if (!ids.has(sampleId)) continue;
    if (byId.has(sampleId)) throw new Error('The predictions CSV has duplicate rows for sample ' + sampleId + '.');
    byId.set(sampleId, row);
  }
  if (!byId.size) throw new Error('No prediction IDs matched the selected scenario.');
  const result = new Map<string, Pose>();
  for (const sample of samples) {
    const row = byId.get(sample.id);
    if (!row) continue;
    const at = (column?: number) => value(row[column ?? -1]);
    if (isEnu) {
      result.set(sample.id, {
        fields: ['East (m)', 'North (m)'],
        truth: [at(find('eastm')), at(find('northm'))],
        predicted: [at(east), at(north)],
      });
    } else {
      result.set(sample.id, {
        fields: ['ΔX (m)', 'ΔY (m)', 'ΔZ (m)', 'Heading (°)'],
        truth: [at(find('truedx', 'truedxm', 'truex')), at(find('truedy', 'truedym', 'truey')),
          at(find('truedz', 'truedzm', 'truez')), at(find('trueheadingdeg', 'trueheading'))],
        predicted: [at(x), at(y), at(z), at(heading)],
      });
    }
  }
  return result;
}
