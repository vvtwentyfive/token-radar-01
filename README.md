[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/vvtwentyfive/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/vvtwentyfive/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

# token-radar-01

A token launch radar that reads a sealed DefiLlama snapshot and ranks every protocol that records no token by an implied launch value fitted from live-token comparables, with a one-sigma band around each estimate. Every ranked protocol carries an eight-step farm plan with concrete costs, times and hold windows derived from its own category, chains, size and age. The dashboard is a fully offline static page: it renders the same board, detail views and filters from the data file the program writes, with no network calls.

## Run it

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

The program writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` into the output directory. It needs Node 22.18 or later and nothing else; the entry runs offline on the standard library only.

<sub>Entered on [make.fun](https://make.fun/?ref=073t4skd&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
