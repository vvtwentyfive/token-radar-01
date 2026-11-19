// token-radar-01 v2 — entrypoint. Node 22, standard library only.
//
// The program reads the sealed snapshot (/input/snapshot.json, or the path
// given by --input), ranks its pre-token protocols with the model in
// lib/model.ts, and writes everything the gate and the judge read:
//
//   /output/board.json    the 200-row ranked board
//   /output/data.js       window.RADAR, the same rows for the dashboard
//   /output/dashboard/   a copy of this repository's dashboard/
//   /output/screenshots/ a copy of this repository's screenshots/
//   /output/dossier.json the judge's dossier, via vendor/makefun-board.ts
//
// Local runs use MAKEFUN_OUTPUT_DIR instead of /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
//
// The run is deterministic — no clock, no network, no unsorted iteration —
// so two runs on one snapshot produce identical bytes in every file.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));

const TEXT_CAP = 65_536;
const SHOT_CAP = { max: 4, max_bytes: 524_288 };
const DASH_CAP = { max_files: 400, max_bytes: 4_194_304 };
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function die(msg: string): never {
  process.stderr.write(`token radar: ${msg}\n`);
  process.exit(1);
}

/** Value of --flag <v> or --flag=<v> on the command line, else `dflt`. */
function flag(name: string, dflt: string): string {
  const argv = process.argv;
  const i = argv.indexOf(`--${name}`);
  if (i !== -1 && i + 1 < argv.length) return argv[i + 1]!;
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  if (eq !== undefined) return eq.slice(name.length + 3);
  return dflt;
}

/** Copy a directory's plain top-level files (dot-names skipped) to `dst`. */
function copyDir(src: string, dst: string): string[] {
  if (!existsSync(src)) return [];
  mkdirSync(dst, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(src)) {
    if (name.startsWith('.')) continue;
    const srcPath = join(src, name);
    if (!statSync(srcPath).isFile()) continue;
    copyFileSync(srcPath, join(dst, name));
    names.push(name);
  }
  return names;
}

function main(): void {
  const inputArg = flag('input', '/input');
  const snapshotPath = inputArg.endsWith('.json')
    ? inputArg
    : join(inputArg, 'snapshot.json');
  if (!existsSync(snapshotPath)) {
    die(
      `no snapshot at ${snapshotPath} — pass --input <snapshot.json|directory> ` +
        `or mount the sealed /input`,
    );
  }
  const outDir = flag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

  const snapshot = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
  const { board, radar } = buildRadar(snapshot);
  const model = radar.model as Record<string, unknown>;

  // Self-check (spec 4.7): print the fit the graded run actually used, and
  // refuse to go on if the band sigma is not finite and sane — that would
  // mean the snapshot is not the one this model was designed for.
  const sigma = model.sigma_log10 as number;
  process.stdout.write(
    `token radar: comps_n=${model.comps_n} intercept=${model.intercept} ` +
      `slope=${model.slope} oof_rmse_log10=${model.oof_rmse_log10} sigma=${sigma}\n`,
  );
  if (typeof sigma !== 'number' || !Number.isFinite(sigma) || sigma <= 0 || sigma >= 2) {
    die(`self-check failed: sigma ${sigma} is not in (0, 2)`);
  }

  // Gate check before any file is written: ranks, ordering, coverage,
  // farm-step lengths. A board the gate refuses fails loudly here.
  const problem = boardIssue(board, snapshot);
  if (problem !== null) die(`the model wrote a board the gate refuses: ${problem}`);

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
  writeFileSync(join(outDir, 'data.js'), dataScript(radar));

  const dashCount = copyDir(join(repoRoot, 'dashboard'), join(outDir, 'dashboard')).length;
  const shots = copyDir(join(repoRoot, 'screenshots'), join(outDir, 'screenshots'));
  if (shots.length < 3) {
    die(
      `screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'} — ` +
        `hand in 3: the board, a detail view and a filtered view`,
    );
  }
  for (const name of shots) {
    if (!SHOT_NAME.test(name)) {
      die(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
    }
  }

  // Last: the dossier. The scorer rebuilds it from this output directory
  // and compares bytes, so nothing may change after this write.
  writeFileSync(
    join(outDir, 'dossier.json'),
    buildDossier(outDir, {
      text_max_bytes: TEXT_CAP,
      screenshots: SHOT_CAP,
      dashboard: DASH_CAP,
    }),
  );

  const top = board[0]!;
  process.stdout.write(
    `token radar: ${snapshot.protocols.length} protocols, ` +
      `${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored ` +
      `(${radar.early_size} early, ${radar.live_size} live set aside)\n` +
      `token radar: top-1 ${top.slug} $${top.implied_value_usd}\n` +
      `token radar: wrote ${join(outDir, 'board.json')}, ${join(outDir, 'data.js')}, ` +
      `${join(outDir, 'dashboard')} (${dashCount} files), ` +
      `${join(outDir, 'screenshots')} (${shots.length} images) and ` +
      `${join(outDir, 'dossier.json')}\n`,
  );
}

main();
