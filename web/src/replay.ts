import { DecimalPipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, DestroyRef, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Replay, XYZ, beamPowers, enu, importScenario, lidarPoints, predictions } from './replay-data';

const panels = ['Camera', 'RF', 'LiDAR', 'Predictions'] as const;
type Panel = typeof panels[number];
const colors = ['#2563eb', '#087b62', '#cf670f', '#8046bb'];

@Component({
  selector: 'sample-replay',
  imports: [DecimalPipe],
  templateUrl: './replay.html',
  styleUrl: './replay.css',
})
export class SampleReplay {
  private readonly http = inject(HttpClient);
  private readonly pointCanvas = viewChild<ElementRef<HTMLCanvasElement>>('pointCanvas');
  private objectUrl: string | null = null;
  private panelVersion = 0;
  private sourceVersion = 0;
  private predictionVersion = 0;

  readonly replay = signal<Replay | null>(null);
  readonly selection = signal(0);
  readonly sample = computed(() => this.replay()?.samples[this.selection()] ?? null);
  readonly sourceStatus = signal('Loading example samples…');
  readonly panelStatus = signal('');
  readonly importStatus = signal('');
  readonly panel = signal<Panel>('Camera');
  readonly panels = panels;
  readonly importedPoses = signal<ReturnType<typeof predictions>>(new Map());
  readonly camera = signal<number | null>(null);
  readonly cameraUrl = signal('');
  readonly beams = signal<(number[] | null)[]>([]);
  readonly points = signal<XYZ[]>([]);
  readonly azimuth = signal(0);
  readonly tilt = signal(90);
  readonly zoom = signal(1);

  readonly gpsOffset = computed(() => {
    const s = this.sample();
    return s?.ego && s.peer ? enu(s.ego, s.peer) : null;
  });
  readonly pose = computed(() => {
    const s = this.sample();
    if (!s) return null;
    const matched = this.importedPoses().get(s.id) ?? s.pose;
    const offset = this.gpsOffset();
    if (matched?.fields[0] === 'East (m)' && offset) {
      return { ...matched, truth: matched.truth.map((n, i) => n ?? offset[i]) };
    }
    return matched ?? (offset ? { fields: ['East (m)', 'North (m)'], truth: offset, predicted: [null, null] } : null);
  });
  readonly positionError = computed(() => {
    const p = this.pose();
    if (!p) return null;
    const axes = p.fields[0] === 'East (m)' ? 2 : 3;
    const errors = p.truth.slice(0, axes).map((truth, i) =>
      truth === null || p.predicted[i] === null ? null : p.predicted[i]! - truth);
    return errors.every(n => n !== null) ? Math.hypot(...errors as number[]) : null;
  });
  readonly headingError = computed(() => {
    const p = this.pose();
    const t = p?.truth[3], v = p?.predicted[3];
    return t == null || v == null ? null : Math.abs(((v - t + 180) % 360 + 360) % 360 - 180);
  });
  readonly plottedPrediction = computed(() => {
    const p = this.pose();
    if (p?.fields[0] !== 'East (m)' || p.predicted[0] == null || p.predicted[1] == null) return null;
    return [p.predicted[0], p.predicted[1]];
  });
  readonly bound = computed(() => {
    const max = Math.max(1, ...[...(this.gpsOffset() ?? []), ...(this.plottedPrediction() ?? [])].map(Math.abs));
    return Math.ceil(max * 1.2);
  });
  readonly strongest = computed(() => {
    let best: {group: number; beam: number; power: number} | null = null;
    this.beams().forEach((powers, group) => powers?.forEach((power, beam) => {
      if (!best || power > best.power) best = { group, beam, power };
    }));
    return best as {group: number; beam: number; power: number} | null;
  });
  readonly range = computed(() => {
    const powers = this.beams().flatMap(group => group ?? []);
    const min = Math.min(0, ...powers);
    const max = Math.max(...powers);
    return [min, max > min ? max : min + 1];
  });
  readonly colors = colors;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.releaseCamera();
      this.panelVersion++;
      this.sourceVersion++;
      this.predictionVersion++;
    });
    effect(() => {
      const canvas = this.pointCanvas()?.nativeElement;
      const points = this.points();
      const azimuth = this.azimuth() * Math.PI / 180;
      const tilt = this.tilt() * Math.PI / 180;
      const zoom = this.zoom();
      if (canvas && points.length) this.drawCloud(canvas, points, azimuth, tilt, zoom);
    });
    void this.loadExample();
  }

  async loadExample() {
    const version = ++this.sourceVersion;
    this.importStatus.set('');
    this.sourceStatus.set('Loading example samples…');
    try {
      const data = await firstValueFrom(this.http.get<Replay>('replay/synthetic.json'));
      if (version === this.sourceVersion) this.use(data);
    } catch {
      if (version === this.sourceVersion) this.sourceStatus.set('Example files could not be loaded. Try again or open a scenario folder.');
    }
  }

  async openScenario(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (!files.length) return;
    const version = ++this.sourceVersion;
    this.importStatus.set('');
    this.sourceStatus.set('Reading the scenario index…');
    try {
      const dataset = await importScenario(files);
      if (version === this.sourceVersion) this.use(dataset);
    } catch (error) {
      if (version === this.sourceVersion) this.sourceStatus.set(this.error(error));
    }
  }

  async openPredictions(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    const data = this.replay();
    if (!file || !data || data.example) return;
    const version = ++this.predictionVersion;
    try {
      const poses = predictions(await file.text(), data.samples, data.label.split(' ').at(-1) ?? '');
      if (version !== this.predictionVersion) return;
      this.importedPoses.set(poses);
      this.importStatus.set('Predictions matched to ' + poses.size + ' samples.');
    } catch (error) {
      if (version === this.predictionVersion) this.importStatus.set(this.error(error));
    }
  }

  private use(data: Replay) {
    this.predictionVersion++;
    this.importedPoses.set(new Map());
    this.replay.set(data);
    this.sourceStatus.set('');
    this.choose(0);
  }

  chooseId(input: HTMLInputElement) {
    this.choose(this.replay()?.samples.findIndex(s => s.id === input.value.trim()) ?? -1);
    input.value = this.sample()?.id ?? '';
  }

  hasCamera(number: number) { return this.sample()?.camera.some(c => c.number === number) ?? false; }
  hasPrediction() { return this.pose()?.predicted.some(n => n !== null) ?? false; }

  choose(index: number) {
    if (!this.replay()?.samples[index]) return;
    this.selection.set(index);
    this.selectCamera(this.sample()?.camera[0]?.number ?? null);
    void this.loadPanel();
  }

  show(panel: Panel) {
    this.panel.set(panel);
    void this.loadPanel();
  }

  selectCamera(number: number | null) {
    this.camera.set(number);
    this.releaseCamera();
    const file = this.sample()?.camera.find(c => c.number === number)?.file;
    if (file instanceof File) this.objectUrl = URL.createObjectURL(file);
    this.cameraUrl.set(typeof file === 'string' ? file : this.objectUrl ?? '');
  }

  private releaseCamera() {
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
  }

  private async loadPanel() {
    const version = ++this.panelVersion;
    const sample = this.sample();
    this.panelStatus.set('');
    this.beams.set([]);
    this.points.set([]);
    if (!sample) return;
    if (this.panel() === 'RF') {
      this.panelStatus.set('Reading RF data…');
      const loaded = await Promise.allSettled(sample.rf.map(async file =>
        file instanceof File ? beamPowers(await file.text()) : file));
      if (version !== this.panelVersion) return;
      const arrays = loaded.map(result => result.status === 'fulfilled' ? result.value : null);
      this.beams.set(arrays);
      this.panelStatus.set(loaded.some(r => r.status === 'rejected')
        ? 'Some RF files could not be read. Each array needs 64 numeric beam powers.'
        : arrays.some(Boolean) ? '' : 'No RF files for this sample.');
    }
    if (this.panel() === 'LiDAR') {
      this.panelStatus.set('Reading the point cloud…');
      try {
        const cloud = sample.lidar instanceof File
          ? lidarPoints(await sample.lidar.text()) : sample.lidar ?? [];
        if (version !== this.panelVersion) return;
        this.points.set(cloud);
        this.panelStatus.set(cloud.length ? '' : 'No LiDAR file for this sample.');
      } catch (error) {
        if (version === this.panelVersion) this.panelStatus.set(this.error(error));
      }
    }
  }

  private error(error: unknown) {
    return error instanceof Error ? error.message : 'Could not read the selected data.';
  }

  chartHeight(value: number) {
    const [min, max] = this.range();
    return Math.max(1, (value - min) / (max - min) * 100);
  }

  plot(value: number) { return 50 + 50 * value / this.bound(); }
  mapLink([lat, lon]: [number, number, number | null]) {
    return 'https://www.openstreetmap.org/?mlat=' + lat + '&mlon=' + lon + '#map=18/' + lat + '/' + lon;
  }

  private drawCloud(canvas: HTMLCanvasElement, points: XYZ[], angle: number, tilt: number, zoom: number) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const {width, height} = canvas;
    const radius = Math.max(1, ...points.map(([x, y, z]) => Math.hypot(x, y, z)));
    const scale = Math.min(width, height) * .47 * zoom / radius;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const vertical = Math.sin(tilt), depth = Math.cos(tilt);
    ctx.fillStyle = '#122136';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = '#415877';
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.moveTo(width / 2, 0);
    ctx.lineTo(width / 2, height);
    ctx.stroke();
    for (const [x, y, z] of points) {
      const px = x * cos - y * sin;
      const py = (x * sin + y * cos) * vertical + z * depth;
      ctx.fillStyle = z > 1 ? '#53d5e5' : '#658fdb';
      ctx.fillRect(width / 2 + px * scale, height / 2 - py * scale, 2, 2);
    }
    ctx.fillStyle = '#fde5a1';
    ctx.fillRect(width / 2 - 2, height / 2 - 2, 4, 4);
  }
}
