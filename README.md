# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/vvtwentyfive/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/vvtwentyfive/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Launch Radar v2 ranks the 200 pre-token protocols in the sealed 2026-11-14 DefiLlama snapshot by implied token value. A log-log OLS fit on 128 tokenised comparables (intercept 3.0247, slope 0.5223) turns each protocol's TVL into an implied value with its 1σ band — never a point alone — and a bounded growth/age tilt keeps the ranking honest about how young and how fast a protocol is. Every row carries a 12-field KPI strip, a farm score with its verdict (PRIORITY, WORTH FARMING, WATCH, LOW PRIORITY), and a 7-step farm plan with its net cost, so the board reads as a menu: value says how big, verdict says how farmable right now. The dashboard is a static page with no network calls; it renders only the data `main.ts` writes.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=073t4skd&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
