import { Component, OnInit, inject, provideZonelessChangeDetection, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { HttpClient, provideHttpClient } from '@angular/common/http';
import { bootstrapApplication } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';

import { SampleReplay } from './replay';
import { scenarios, datasetUrl, paperUrl, evaluation, ablation } from './report';

interface Overview {
  target: string;
  modalities: string[];
  historical: { approx_error_m: number };
  evaluation_available: boolean;
}
interface Metrics {
  mean_m: number;
  rmse_m: number;
  median_m: number;
  p90_m: number;
}
interface Report {
  source: 'synthetic' | 'deepsense-v2v';
  counts: { train: number; val: number; test: number };
  split: { train: string[]; val: string[]; test: string[] };
  model: Metrics;
  baseline: Metrics;
  best_epoch: number;
}
interface Prediction {
  id: string; drive: string;
  east_m: number; north_m: number;
  pred_east_m: number; pred_north_m: number;
  error_m: number;
}
interface Page { total: number; rows: Prediction[] }

@Component({
  selector: 'fusion-app',
  styleUrl: './styles.css',
  imports: [DecimalPipe],
  template: `
    <header><div class="bar"><a href="#overview">V2V Fusion</a><nav aria-label="Page sections"><a href="#overview">Overview</a><a href="#evaluation">Evaluation</a></nav></div></header>
    <main>
      <section id="overview" class="intro">
        <p class="eyebrow">DEEPSENSE-V2V · SENSOR FUSION</p>
        <h1>Relative vehicle<br>position estimation</h1>
        <p class="lede">Estimate the offset of a second vehicle by combining camera images, 3D LiDAR and 60 GHz beam powers.</p>
        <div class="sensors">
          <article><h2>Camera</h2><p>Two synchronized 180° RGB views.</p></article>
          <article><h2>LiDAR</h2><p>Point density and height in a bird’s-eye grid.</p></article>
          <article><h2>RF</h2><p>64 measured beam powers from each of four arrays.</p></article>
        </div>
      </section>
      <section id="evaluation">
        <div class="section-head"><h2>Evaluation</h2>@if (report(); as run) { <a class="button" href="/api/predictions.csv">Download CSV</a> }</div>
        <aside><strong>Historical senior project · ~{{ overview()?.historical?.approx_error_m ?? 3 }} m</strong>
          <p>Original report, Table 5. 3D RMSE on 1,000 Scenario 36 samples.</p></aside>
        @if (status()) { <p class="notice" role="status">{{ status() }}</p> }
        @if (report(); as run) {
          <h3>{{ run.source === 'synthetic' ? 'Synthetic smoke-test evaluation' : 'DeepSense-V2V held-out evaluation' }}</h3>
          <p class="meta">Test drives {{ run.split.test.join(', ') }} · {{ run.counts.test }} samples · Best validation epoch {{ run.best_epoch }}</p>
          <div class="scroll">
            <table>
              <caption>Horizontal Euclidean error in metres</caption>
              <thead><tr><th>Estimator</th><th>Mean</th><th>RMSE</th><th>Median</th><th>P90</th></tr></thead>
              <tbody>
                @for (item of [['Fusion', run.model], ['Training mean', run.baseline]]; track $index) {
                  <tr><th scope="row">{{ item[0] }}</th>
                    @for (value of values($index === 0 ? run.model : run.baseline); track $index) {
                      <td>{{ value | number:'1.2-2' }}</td>
                    }
                  </tr>
                }
              </tbody>
            </table>
          </div>
          @if (page(); as p) {
            <div class="detail">
              <div>
                <h3>Prediction scatter</h3>
                <p class="meta"><span class="truth">● GPS</span> &nbsp; <span class="estimate">● Prediction</span> · Current page</p>
                <div class="plot" role="img" [attr.aria-label]="'East and north offsets from minus ' + bound(p) + ' to plus ' + bound(p) + ' metres. Coordinates are also in the table.'">
                  <span class="east">East →</span><span class="north">North ↑</span>
                  @for (r of p.rows; track r.id) {
                    <i class="point actual" [style.left.%]="coordinate(r.east_m, p)" [style.bottom.%]="coordinate(r.north_m, p)"></i>
                    <i class="point predicted" [style.left.%]="coordinate(r.pred_east_m, p)" [style.bottom.%]="coordinate(r.pred_north_m, p)"></i>
                  }
                </div>
                <p class="meta">±{{ bound(p) }} m per axis</p>
              </div>
              <div class="observations">
                <h3>Test samples</h3>
                <div class="scroll">
                  <table>
                    <thead><tr><th>Sample</th><th>GPS E/N (m)</th><th>Pred. E/N (m)</th><th>Error (m)</th></tr></thead>
                    <tbody>@for (r of p.rows; track r.id) {
                      <tr><th scope="row">{{ r.id }}</th><td>{{ r.east_m | number:'1.1-1' }}, {{ r.north_m | number:'1.1-1' }}</td>
                      <td>{{ r.pred_east_m | number:'1.1-1' }}, {{ r.pred_north_m | number:'1.1-1' }}</td>
                      <td>{{ r.error_m | number:'1.2-2' }}</td></tr>
                    }</tbody>
                  </table>
                </div>
                <div class="paging">
                  <button [disabled]="loading() || offset() === 0" (click)="loadPage(offset() - pageSize)">Previous</button>
                  <span>{{ offset() + 1 }}–{{ offset() + p.rows.length }} of {{ p.total }}</span>
                  <button [disabled]="loading() || offset() + pageSize >= p.total" (click)="loadPage(offset() + pageSize)">Next</button>
                </div>
              </div>
            </div>
          }
        }
      </section>
    </main>
    <footer>TensorFlow · FastAPI · Angular</footer>
  `,
})
class Dashboard implements OnInit {
  private readonly http = inject(HttpClient);
  readonly pageSize = 12;
  readonly overview = signal<Overview | null>(null);
  readonly report = signal<Report | null>(null);
  readonly page = signal<Page | null>(null);
  readonly offset = signal(0);
  readonly status = signal('Loading evaluation…');
  readonly loading = signal(false);

  async ngOnInit() {
    try {
      const overview = await firstValueFrom(this.http.get<Overview>('/api/overview'));
      this.overview.set(overview);
      if (!overview.evaluation_available) {
        this.status.set('No completed evaluation. Train a model and point the server to the run directory.');
        return;
      }
      this.report.set(await firstValueFrom(this.http.get<Report>('/api/results')));
      await this.loadPage(0);
    } catch {
      this.status.set('Could not load the evaluation. Check the FastAPI server and run directory.');
    }
  }

  async loadPage(offset: number) {
    this.loading.set(true);
    try {
      this.page.set(await firstValueFrom(this.http.get<Page>(
        '/api/predictions', { params: { offset, limit: this.pageSize } }
      )));
      this.offset.set(offset);
      this.status.set('');
    } catch {
      this.status.set('Could not load this page of predictions.');
    } finally {
      this.loading.set(false);
    }
  }

  values(m: Metrics) { return [m.mean_m, m.rmse_m, m.median_m, m.p90_m]; }

  bound(page: Page) {
    const max = Math.max(1, ...page.rows.flatMap(r =>
      [r.east_m, r.north_m, r.pred_east_m, r.pred_north_m].map(Math.abs)));
    return Math.ceil(max * 1.1);
  }

  coordinate(value: number, page: Page) { return 50 + (value / this.bound(page)) * 50; }
}

@Component({
  selector: 'project-app',
  imports: [Dashboard, DecimalPipe, SampleReplay],
  templateUrl: './report.html',
})
class ProjectApp {
  readonly sections = ['Dashboard', 'Dataset Explorer', 'How It Works', 'Results', 'Ablation', 'About', 'Demo'];
  readonly section = signal('Dashboard');
  readonly scenarios = scenarios;
  readonly scenario = signal(scenarios[0]);
  readonly datasetUrl = datasetUrl;
  readonly paperUrl = paperUrl;
  readonly evaluation = evaluation;
  readonly ablation = ablation;
  readonly metricLabels = ['Samples', 'MAE X (m)', 'MAE Y (m)', 'MAE Z (m)', '3D RMSE (m)',
    'Median (m)', 'P90 (m)', 'Mean heading error', 'Heading within ±15°'];
}

bootstrapApplication(ProjectApp, { providers: [provideHttpClient(), provideZonelessChangeDetection()] }).catch(console.error);
