# Labour Monitor

How healthy is Canada's labour market? Unemployment and what moved it, the provinces, jobs by industry, how hard it is to
find work, and which age and education groups are worse off than usual. All from Statistics Canada, updated with every
Labour Force Survey.

Published at [panahovf.github.io/labour-monitor](https://panahovf.github.io/labour-monitor/), and one of the pages on
[Monitor](https://panahovf.github.io/monitor/), part of [Farhad Panahov's website](https://panahovf.github.io).

## What's here

- `series.csv`: every series the page uses, one row each (id, topic, source, table, vector, name, units, frequency,
  seasonal adjustment).
- `data/`: the two notebooks, one per step (below). Downloads go to `data/store/`, which is not in the repository.
- `site/`: the page.
  - `index.html`: the page; `assets/monitor.js` draws it from the data file and `assets/monitor.css` styles it.
  - `data/labour.json`: everything the page shows, its sentences included. Written by step 2; don't edit it by hand.
  - `tile.json`: the few numbers the labour tile on the Monitor front page shows (headline, its change, the last three
    years for the small line, the release). Written by step 2.
  - `og.png`: the preview picture shown when the link is shared (made from `tools/og.html`, see below).
- `.github/workflows/publish.yml`: updates the data every weekday and publishes the page (below).

## Run it

With Python 3.9 and the versions pinned in `requirements.txt` (`pip install -r requirements.txt`), from `data/`:

```bash
jupyter nbconvert --to notebook --execute 01_fetch_statcan.ipynb --output-dir /tmp/runs
jupyter nbconvert --to notebook --execute 02_build_labour.ipynb --output-dir /tmp/runs
```

| Notebook | What it does | Writes |
|---|---|---|
| `01_fetch_statcan` | Downloads the full history of every series in `series.csv` from Statistics Canada's Web Data Service (no key needed, a few seconds) | `data/store/statcan.csv` |
| `02_build_labour` | Works out everything the page shows: the four numbers at the top, what the latest release changed, seven charts in four sections, each with a reading written from the numbers by fixed rules. Checks first, and stops if the data look wrong (latest month too old, values out of range, a breakdown that doesn't add up, a chart with no data) | `site/data/labour.json`, `site/tile.json` |

To look at the page, serve `site/` (e.g. `python3 -m http.server` from `site/`) and open it in a browser. Its links back
to the Monitor front page (`/monitor/`) work only online.

## Updates and publishing

GitHub publishes the page (Settings → Pages → Source: GitHub Actions) with `.github/workflows/publish.yml`:

- Every weekday at 13:45 and 17:15 UTC (Statistics Canada publishes at 8:30 Toronto time), it runs steps 1 and 2. If any
  number changed, it commits the new `site/data/labour.json` and `site/tile.json` and publishes; otherwise it stops. If a
  step fails, nothing changes and the page keeps its last good data.
- On every push to `main`, it publishes `site/` as it is in the repository.
- By hand: Actions tab → "Update and publish" → "Run workflow".

## Preview picture

`tools/og.html` draws it from the data. After changing it, render it again and raise the `?v=` number of `og:image` in
`site/index.html`, so LinkedIn fetches the new picture. From this folder:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars --allow-file-access-from-files --force-device-scale-factor=2 --window-size=1200,630 --virtual-time-budget=8000 --screenshot="$PWD/site/og.png" "file://$PWD/tools/og.html"
```

## Sources

Statistics Canada (Open Government Licence – Canada), through its Web Data Service: the Labour Force Survey and the Job
Vacancy and Wage Survey. Each chart links to its table.
