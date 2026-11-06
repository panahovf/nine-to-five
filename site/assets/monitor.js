/* ============================================================
   The monitor: draws a topic page (or the front page) from the
   JSON that the build notebooks write to site/data/.

   Needs d3 and Observable Plot loaded first (see the HTML pages).
   All text from the data goes in with textContent, never innerHTML.
   ============================================================ */

// The site's name lives here and only here (pages show it via .js-name / {NAME}).
const NAME = "Monitor";

// (fourth: validated against the other three at CVD ΔE 7.6, under the 8 target, so a "fourth" line is also dashed)
const COLORS = { main: "#2148cc", second: "#c8571f", third: "#13896f", fourth: "#a3368f", context: "#858c96",
                 // a lighter set for parts of a total drawn under a main-colour line (labour breakdown); checked together and
                 // against main: all pairs pass for colour-blind and normal vision; amber and grey are light on white
                 sky: "#4f86e8", amber: "#d0900f", grey: "#b2b7be",
                 // another checked set: purple, light blue; all pairs pass, purple vs the main blue line sits exactly at the
                 // CVD target (8.0)
                 purple: "#9a5fd0", cyan: "#47b6ec",
                 // labour breakdown: teal jobs, gold population, lavender participation; all pairs pass
                 // for colour-blind and normal vision, with and without the main blue line (teal is a touch muted on purpose)
                 teal: "#2a8a85", gold: "#e0a43a", lavender: "#9b86d6" };
const INK = "#14171c", MUTED = "#6a727d", LINE = "#e7e3dc", PAPER = "#ffffff";
const RANGES = [["5y", "5 years", 5], ["10y", "10 years", 10], ["all", "All", null]];
const FONT = { fontFamily: "IBM Plex Sans, sans-serif", fontSize: "11.5px", color: MUTED, background: "transparent", overflow: "visible" };
const NS = "http://www.w3.org/2000/svg";

const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};
const svgEl = (tag, attrs) => {
  const node = document.createElementNS(NS, tag);
  for (const k in attrs) node.setAttribute(k, attrs[k]);
  return node;
};
const parseMonth = (s) => new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, 1));
const monthLabel = d3.utcFormat("%b %Y");
const quarterLabel = (d) => `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
const minus = (s) => s.replace("-", "−");
const ordinal = (n) => n + ((n % 100 >= 11 && n % 100 <= 13) ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"));
// width of a row label in the chart font, and a left margin that fits the longest one (never below min)
const textWidth = (() => {
  const ctx = document.createElement("canvas").getContext("2d");
  return (s) => { ctx.font = "11.5px 'IBM Plex Sans', sans-serif"; return ctx.measureText(s).width; };
})();
const labelMargin = (labels, min, pad = 14, max = 210) => Math.round(Math.max(min, Math.min(max, d3.max(labels, textWidth) + pad)));

function fmt(v, unit, decimals = 1) {
  if (unit === "%") return minus(v.toFixed(decimals)) + "%";
  if (unit === "%chg") return minus((v > 0 ? "+" : "") + v.toFixed(decimals)) + "%";      // a signed per cent change
  if (unit === "$bn") return (v < 0 ? "−" : "") + "$" + Math.abs(v).toFixed(decimals) + "B";   // billions of dollars
  if (unit === "jobs") return minus((v > 0 ? "+" : "") + (v / 1000).toFixed(0)) + "k";
  if (unit === "pts") return minus((v > 0 ? "+" : "") + v.toFixed(2));
  if (unit === "k") return minus(v.toFixed(decimals)) + "k";                                    // value already in thousands
  if (unit === "$") return (v < 0 ? "−" : "") + "$" + d3.format(`,.${decimals}f`)(Math.abs(v));   // dollars, e.g. $59,221
  if (unit === "$x") return (v < 0 ? "−" : "") + "$" + Math.abs(v).toFixed(decimals);              // small dollar amounts, e.g. $16.90
  if (unit === "pct") return ordinal(Math.round(v));                                              // a percentile, e.g. "85th"
  return minus(v.toFixed(decimals));
}
// axis tick labels: the unit without a plus sign ("5%", "$60B")
// (dec: an optional number of decimals for every tick, so that 5.5% sits next to 5.0%, not 5%. It is fixed when the
//  formatter is made, never read from the call: Plot calls tickFormat(value, index), and the index must not count as decimals)
function tickFmt(unit, dec) {
  const n = (d) => (dec ? d.toFixed(dec) : String(d));
  if (unit === "%" || unit === "%chg") return (d) => minus(n(d)) + "%";
  if (unit === "$bn") return (d) => (d < 0 ? "−" : "") + "$" + n(Math.abs(d)) + "B";
  if (unit === "k") return (d) => minus(n(d)) + "k";
  if (unit === "$") return (d) => (d < 0 ? "−" : "") + "$" + Math.abs(d) / 1000 + "k";            // $50,000 -> "$50k"
  if (unit === "$x") return (d) => (d < 0 ? "−" : "") + "$" + n(Math.abs(d));                     // "$15"
  return (d) => minus(n(d));
}
// the most decimals any of these tick values has (0.5 -> 1), so all ticks can be written alike
const tickDecimals = (values) => d3.max(values, (v) => (String(+v.toFixed(6)).split(".")[1] || "").length) || 0;

// ---------- remembered time range (a per-viewer convenience; works without storage) ----------
let range = "10y";
try { range = localStorage.getItem("monitor-range") || "10y"; } catch (e) {}

function fillName() {
  document.querySelectorAll(".js-name").forEach((n) => (n.textContent = NAME));
  document.title = document.title.replace("{NAME}", NAME);
}

// ---------- small sparkline (tiles) ----------
function sparkline(values, w = 140, h = 34) {
  const svg = svgEl("svg", { width: w, height: h, "aria-hidden": "true" });
  const x = d3.scaleLinear([0, values.length - 1], [2, w - 4]);
  const y = d3.scaleLinear(d3.extent(values), [h - 3, 3]);
  svg.append(
    svgEl("path", { d: d3.line((v, i) => x(i), (v) => y(v))(values), fill: "none", stroke: COLORS.main, "stroke-width": 1.5, "stroke-linejoin": "round" }),
    svgEl("circle", { cx: x(values.length - 1), cy: y(values.at(-1)), r: 2.75, fill: COLORS.main }),
  );
  return svg;
}

// ---------- time-series chart: lines and/or bars, plus an optional lower panel ----------
// Turns [["2026-09", 6.5], ...] into rows, keeping null values (gaps) so lines break there.
const toRows = (data, from) => data.map(([m, v]) => ({ date: parseMonth(m), value: v })).filter((r) => !from || r.date >= from);

function lineChart(box, chart) {
  box.replaceChildren();
  const width = box.clientWidth;
  if (!width) return;
  const narrow = width < 520;
  const quarterly = chart.freq === "quarterly", annual = chart.freq === "annual";   // annual points are "YYYY-01"
  // freq "month_of_year": one line per year across January to December (points are "2000-MM")
  const seasonal = chart.freq === "month_of_year";
  const interval = annual ? "year" : quarterly ? "quarter" : "month";
  // chart.quarterly_before: a monthly series whose earlier part is quarterly (points on the middle month of each quarter)
  const qBefore = chart.quarterly_before ? parseMonth(chart.quarterly_before) : null;
  const dateLabel = annual ? d3.utcFormat("%Y") : quarterly ? quarterLabel : seasonal ? d3.utcFormat("%B")
    : qBefore ? (d) => (d < qBefore ? quarterLabel(d) : monthLabel(d)) : monthLabel;
  const margins = { marginLeft: 40, marginRight: chart.end_labels === false ? 20 : 58 };

  // the time range: keep the last N years, but never before the chart's own start
  const lastDate = d3.max(chart.series, (s) => parseMonth(s.data.at(-1)[0]));
  const years = RANGES.find((r) => r[0] === range)?.[2];
  const from = years && !seasonal ? d3.utcYear.offset(lastDate, -years) : null;
  const series = chart.series.map((s) => ({ ...s, rows: toRows(s.data, from) })).filter((s) => s.rows.length);
  const defined = (rows) => rows.filter((r) => r.value != null);
  // bars are centred on their date, half a period either side, so a 2026 bar sits over the 2026 tick and the crosshair
  // runs through its middle; the axis gets half a period of room at each end (also for bars in the lower panel)
  const hasBars = series.some((s) => s.mark === "bar");
  const months = annual ? 12 : quarterly ? 3 : 1;
  const halfway = (d, sign) => new Date((+d + +d3.utcMonth.offset(d, sign * months)) / 2);
  const firstDate = d3.min(series, (s) => s.rows[0].date);
  const xDomain = seasonal ? [parseMonth("2000-01"), parseMonth("2000-12")]
    : hasBars || chart.lower ? [halfway(firstDate, -1), halfway(lastDate, 1)] : [firstDate, lastDate];
  // bar rectangles: x1/x2 around the date; parts that stack pile up from zero (positive) or down from it (negative),
  // in series order
  const barRects = (parts, stack) => {
    const up = new Map(), down = new Map();
    return parts.map((p) => {
      const t = +p.date, pile = p.value >= 0 ? up : down, base = stack ? pile.get(t) || 0 : 0;
      pile.set(t, base + p.value);
      return { ...p, x1: halfway(p.date, -1), x2: halfway(p.date, 1), y1: base, y2: base + p.value };
    });
  };
  // bars narrower than ~3px lose their hairline gap; otherwise, over a long range, the gap eats the whole bar
  const periodsShown = Math.max(1, d3.utcMonth.count(xDomain[0], xDomain[1]) / (annual ? 12 : quarterly ? 3 : 1));
  const barInset = (width - margins.marginLeft - margins.marginRight) / periodsShown > 3 ? 0.5 : 0;
  // chart.stack: the bar (or area) series stack on each other (positive parts up, negative parts down); line series draw on top
  const filled = (s) => s.mark === "bar" || s.mark === "area";
  const barSeries = series.filter(filled);
  const stacked = chart.stack && barSeries.length > 1;
  const stackParts = stacked ? barSeries.flatMap((s) => defined(s.rows).map((r) => ({ ...r, name: s.name, color: COLORS[s.color] }))) : [];
  const stackSums = d3.rollups(stackParts, (v) => [d3.sum(v, (d) => Math.max(0, d.value)), d3.sum(v, (d) => Math.min(0, d.value)), d3.sum(v, (d) => d.value)], (d) => +d.date);

  // --- top panel ---
  const values = series.filter((s) => !(stacked && filled(s))).flatMap((s) => defined(s.rows).map((r) => r.value));
  for (const [, [up, down]] of stackSums) values.push(up, down);
  if (chart.rule != null) values.push(chart.rule);
  if (hasBars || barSeries.length) values.push(0);
  // chart.y_domain / chart.y_ticks: a fixed axis and fixed ticks (e.g. percentiles, 0 to 100). Otherwise the ticks are
  // picked here rather than by Plot, so that they can all carry the same number of decimals (5.0%, 5.5%, 6.0%)
  const yDomain = chart.y_domain || d3.scaleLinear().domain(d3.extent(values)).nice().domain();
  const yTicks = Array.isArray(chart.y_ticks) ? chart.y_ticks : d3.ticks(yDomain[0], yDomain[1], chart.y_ticks || 5);
  const tick = tickFmt(chart.unit, tickDecimals(yTicks));
  const marks = [
    Plot.gridY({ ticks: yTicks, stroke: LINE, strokeOpacity: 1 }),
    Plot.axisY({ ticks: yTicks, tickSize: 0, tickPadding: 6, label: null, tickFormat: tick }),
    seasonal ? Plot.axisX({ ticks: d3.utcMonth.every(narrow ? 2 : 1), tickSize: 4, label: null, stroke: LINE, tickFormat: "%b" })
      : Plot.axisX({ ticks: narrow ? 4 : 6, tickSize: 4, label: null, stroke: LINE, tickFormat: quarterly || annual ? "%Y" : undefined }),
  ];
  if (chart.rule != null) marks.push(Plot.ruleY([chart.rule], { stroke: "#9aa1ab", strokeWidth: 1 }));
  // chart.events: dated policy changes etc., a thin dashed vertical line each (labelled after the plot is drawn)
  const events = (chart.events || []).map((e) => ({ ...e, date: parseMonth(e.date) })).filter((e) => e.date >= xDomain[0] && e.date <= xDomain[1]);
  if (events.length) marks.push(Plot.ruleX(events, { x: "date", stroke: "#9aa1ab", strokeWidth: 1, strokeDasharray: "2,3" }));
  if (stacked && barSeries[0].mark === "area") marks.push(Plot.areaY(stackParts, { x: "date", y: "value", z: "name", fill: "color" }));
  else if (stacked) marks.push(Plot.rect(barRects(stackParts, true), { x1: "x1", x2: "x2", y1: "y1", y2: "y2", fill: "color", insetLeft: barInset, insetRight: barInset }));
  for (const s of series) {
    const color = COLORS[s.color];
    if (filled(s)) {
      if (stacked) continue;     // already drawn in the stack
      if (s.mark === "area") marks.push(Plot.areaY(defined(s.rows), { x: "date", y: "value", fill: color }));
      else marks.push(Plot.rect(barRects(defined(s.rows), false), { x1: "x1", x2: "x2", y1: "y1", y2: "y2", fill: color, insetLeft: barInset, insetRight: barInset }));
      continue;
    }
    // (s.opacity fades a context line, e.g. earlier years; s.dash marks a line drawn from fewer points, e.g. quarterly)
    marks.push(Plot.line(s.rows, { x: "date", y: "value", stroke: color, strokeWidth: 2, strokeLinejoin: "round",
                                   strokeOpacity: s.opacity ?? 1, strokeDasharray: s.dash ? "4,3" : null }));
    // a faint dashed bridge across months with no data
    s.rows.forEach((r, i) => {
      if (r.value == null && i > 0 && s.rows[i - 1].value != null) {
        const next = s.rows.slice(i).find((x) => x.value != null);
        if (next) marks.push(Plot.line([s.rows[i - 1], next], { x: "date", y: "value", stroke: color, strokeWidth: 1.25, strokeDasharray: "3,4", strokeOpacity: 0.7 }));
      }
    });
    if (s.context) continue;     // (s.context: a faded companion line, e.g. the monthly values behind a 3-month average:
                                 //  no end dot, end label, legend entry or tooltip row)
    const last = defined(s.rows).at(-1);
    marks.push(Plot.dot([last], { x: "date", y: "value", r: 3.5, fill: color, fillOpacity: s.opacity ?? 1, stroke: PAPER, strokeWidth: 1.5 }));
  }
  const top = Plot.plot({
    width, height: chart.lower ? (narrow ? 200 : 230) : (narrow ? 230 : 280), ...margins, marginTop: 10, marginBottom: 24,
    x: { type: "utc", domain: xDomain }, y: { domain: yDomain }, style: FONT, marks,
  });
  box.append(top);
  const panels = [{ svg: top }];

  // latest value of each series, in the right margin (outside the plot area); nudged apart so they never overlap
  const ys = top.scale("y"), [, x1] = top.scale("x").range;
  // (stacked bars are labelled through their total: the line series if there is one, otherwise the sum of the parts;
  //  chart.end_labels false: no labels, e.g. when the legend already names the lines)
  const labelled = (stacked ? series.filter((s) => !filled(s)) : series).filter((s) => !s.context);
  const noEnds = chart.end_labels === false;
  const ends = noEnds ? [] : labelled.map((s) => ({ y: ys.apply(defined(s.rows).at(-1).value), text: fmt(defined(s.rows).at(-1).value, chart.unit, chart.decimals) }));
  const stackTotal = new Map(stackSums.map(([t, v]) => [t, v[2]]));
  if (stacked && !labelled.length && !noEnds) {
    const lastSum = stackSums.reduce((a, b) => (b[0] > a[0] ? b : a))[1][2];
    ends.push({ y: ys.apply(lastSum), text: fmt(lastSum, chart.unit, chart.decimals) });
  }
  ends.sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 13);
  for (const e of ends) {
    // (text-anchor set here: Plot's svg centres text by default, which would pull the label back over the line's end)
    const t = svgEl("text", { x: x1 + 14, y: e.y, dy: "0.35em", fill: INK, "font-size": "11.5px", "font-weight": 600, "text-anchor": "start" });
    t.textContent = e.text;
    top.append(t);
  }

  // event labels along the top of the plot; a label that would run into the previous one drops a line
  const [, yTop] = ys.range;
  let prevEnd = -Infinity, level = 0;
  for (const e of events) {
    const x = top.scale("x").apply(e.date), w = textWidth(e.label) * (10.5 / 11.5);
    const flip = x + 4 + w > x1;                            // too close to the right edge: put the label left of its line
    const start = flip ? x - 4 - w : x + 4;
    level = start < prevEnd + 6 ? level + 1 : 0;
    prevEnd = start + w;
    const t = svgEl("text", { x: flip ? x - 4 : x + 4, y: yTop + 9 + level * 13, fill: MUTED, "font-size": "10.5px",
                              "text-anchor": flip ? "end" : "start", stroke: PAPER, "stroke-width": 3, "paint-order": "stroke" });
    t.textContent = e.label;
    top.append(t);
  }

  // --- lower panel: stacked bars of the parts, a thin line for the total ---
  let lower = null;
  if (chart.lower) {
    // lower.modes: views the reader switches between (e.g. change over a month or over 12 months),
    // each with its own series, axis, panel label and reading; the choice is kept on the chart as chart._mode
    const modes = chart.lower.modes;
    const L = modes ? { ...chart.lower, ...(modes.find((m) => m.key === chart._mode) || modes[0]) } : chart.lower;
    const parts = L.series.flatMap((s) => toRows(s.data, from).filter((r) => r.value != null && r.date >= xDomain[0])
                                                 .map((r) => ({ ...r, name: s.name, color: COLORS[s.color] })));
    const total = L.total ? toRows(L.total.data, from).filter((r) => r.value != null && r.date >= xDomain[0]) : [];   // optional
    // the axis covers the stacked bars on both sides of zero
    const byDate = d3.rollups(parts, (v) => [d3.sum(v, (d) => Math.max(0, d.value)), d3.sum(v, (d) => Math.min(0, d.value))], (d) => +d.date);
    // (or a fixed axis, L.clip, when a few extreme periods would flatten the rest; marks are cut at its edges)
    const [lo, hi] = L.clip || [Math.min(0, d3.min(byDate, (d) => d[1][1]) ?? 0, d3.min(total, (d) => d.value) ?? 0),
                                Math.max(0, d3.max(byDate, (d) => d[1][0]) ?? 0, d3.max(total, (d) => d.value) ?? 0)];
    const lowUnit = L.unit || "pts";
    const clip = !!L.clip;
    const label = el("div", "panel-label");
    label.append(el("span", null, L.panel || L.label));
    if (modes) label.append(segmented(modes.map((m) => [m.key, m.label]), L.key, (key) => {
      chart._mode = key;
      setCardText(box, null, modes.find((m) => m.key === key).reading);
      lineChart(box, chart);
    }));
    const legend = el("div", "legend legend-sm");
    for (const s of L.series) {
      const item = el("span"), key = el("i", "sq"); key.style.background = COLORS[s.color];
      item.append(key, document.createTextNode(s.name)); legend.append(item);
    }
    // (L.total.line false: the total is listed in the tooltip but not drawn, and so not in the legend)
    const totalLine = L.total && L.total.line !== false;
    if (totalLine) {
      const tItem = el("span"), tKey = el("i"); tKey.style.background = INK; tItem.append(tKey, document.createTextNode(L.total.name)); legend.append(tItem);
    }
    box.append(label, legend);
    // ticks: L.ticks if given (e.g. [-1, 0, 1]), else three; all written with the same decimals
    const lowDomain = clip ? [lo, hi] : d3.scaleLinear().domain([lo, hi]).nice(3).domain();
    const lowTicks = L.ticks || d3.ticks(lowDomain[0], lowDomain[1], 3), lowTick = tickFmt(lowUnit, tickDecimals(lowTicks));
    const svg = Plot.plot({
      width, height: narrow ? 110 : 130, ...margins, marginTop: 6, marginBottom: 24,
      x: { type: "utc", domain: xDomain }, y: { domain: lowDomain }, style: FONT,
      marks: [
        Plot.gridY({ ticks: lowTicks, stroke: LINE, strokeOpacity: 1 }),
        // (a plus sign on positive ticks only when the panel shows changes, i.e. goes below zero)
        Plot.axisY({ ticks: lowTicks, tickSize: 0, tickPadding: 6, label: null, tickFormat: (d) => (d > 0 && lo < 0 ? "+" : "") + lowTick(d) }),
        Plot.axisX({ ticks: narrow ? 4 : 6, tickSize: 4, label: null, stroke: LINE }),
        Plot.rect(barRects(parts, true), { x1: "x1", x2: "x2", y1: "y1", y2: "y2", fill: "color", clip, insetLeft: barInset, insetRight: barInset }),
        Plot.ruleY([0], { stroke: "#9aa1ab", strokeWidth: 1 }),
        ...(totalLine ? [Plot.line(total, { x: "date", y: "value", stroke: INK, strokeWidth: 1.25, clip })] : []),
      ],
    });
    box.append(svg);
    panels.push({ svg });
    lower = { L, unit: lowUnit, maps: L.series.map((s) => new Map(s.data)), total: new Map(L.total ? L.total.data : []) };
  }

  // --- hover / keyboard: a crosshair across every panel snaps to the nearest period; one tooltip lists all values ---
  const xs = top.scale("x");
  const dates = Array.from(new Set(series.flatMap((s) => defined(s.rows).map((r) => +r.date)))).sort((a, b) => a - b);
  const lookup = series.map((s) => new Map(defined(s.rows).map((r) => [+r.date, r.value])));
  for (const p of panels) {
    const [y0, y1] = p.svg.scale("y").range;
    p.cross = svgEl("line", { y1, y2: y0, stroke: INK, "stroke-opacity": 0.35, visibility: "hidden" });
    p.hit = svgEl("rect", { x: xs.range[0], y: y1, width: xs.range[1] - xs.range[0] + 10, height: y0 - y1, fill: "transparent" });
    p.svg.append(p.cross, p.hit);
  }
  const tip = el("div", "tip"); tip.hidden = true; box.append(tip);
  let current = dates.length - 1;
  const row = (color, value, name, square) => {
    const r = el("div", "r"), key = el("i", square ? "sq" : null);
    key.style.background = color;
    r.append(key, el("b", null, value), el("span", null, name));
    return r;
  };

  function show(i) {
    current = Math.max(0, Math.min(dates.length - 1, i));
    const t = dates[current], d = new Date(t), px = xs.apply(d);
    for (const p of panels) { p.cross.setAttribute("x1", px); p.cross.setAttribute("x2", px); p.cross.setAttribute("visibility", "visible"); }
    tip.replaceChildren(el("div", "t", dateLabel(d)));
    series.forEach((s, k) => {
      const v = lookup[k].get(t);
      if (v == null || s.context) return;
      const r = row(COLORS[s.color], fmt(v, chart.unit, chart.decimals), s.name, filled(s));
      if (s.dash) r.firstChild.style.background = `repeating-linear-gradient(90deg, ${COLORS[s.color]} 0 4px, transparent 4px 7px)`;
      if (s.opacity != null) r.firstChild.style.opacity = s.opacity;
      tip.append(r);
    });
    if (stacked && !labelled.length && stackTotal.has(t)) tip.append(row(INK, fmt(stackTotal.get(t), chart.unit, chart.decimals), "Total"));
    if (lower) {
      const key = d3.utcFormat("%Y-%m")(d);
      lower.L.series.forEach((s, k) => { const v = lower.maps[k].get(key); if (v != null) tip.append(row(COLORS[s.color], fmt(v, lower.unit, lower.L.decimals), s.name, true)); });
      const v = lower.total.get(key); if (v != null) tip.append(row(INK, fmt(v, lower.unit, lower.L.decimals), lower.L.total.name));
    }
    tip.hidden = false;
    const tw = tip.offsetWidth;
    tip.style.left = (px + 14 + tw > width ? px - 14 - tw : px + 14) + "px";
    tip.style.top = "8px";
  }
  function hide() { for (const p of panels) p.cross.setAttribute("visibility", "hidden"); tip.hidden = true; }
  for (const p of panels) {
    p.hit.addEventListener("pointermove", (e) => show(d3.bisectCenter(dates, +xs.invert(d3.pointer(e, p.svg)[0]))));
    p.hit.addEventListener("pointerleave", hide);
  }
  box.onfocus = () => show(current);
  box.onblur = hide;
  box.onkeydown = (e) => {
    if (e.key === "ArrowLeft") { show(current - 1); e.preventDefault(); }
    if (e.key === "ArrowRight") { show(current + 1); e.preventDefault(); }
  };
}

// ---------- per-row hover for the row charts (dots, range) ----------
function rowHover(box, svg, rows, width, lines) {
  const ys = svg.scale("y"), step = ys.step ?? ys.bandwidth ?? 27;
  const offset = ys.bandwidth ? ys.bandwidth / 2 : 0;
  const tip = el("div", "tip"); tip.hidden = true; box.append(tip);
  rows.forEach((d) => {
    const cy = ys.apply(d.label) + offset;
    const r = svgEl("rect", { x: 0, width, y: cy - step / 2, height: step, fill: "transparent" });
    r.addEventListener("pointerenter", () => {
      tip.replaceChildren(el("div", "t", d.label));
      // (the fourth item: true for a hollow ring, or a shape name such as "tick"; a filled dot otherwise)
      for (const [color, value, name, ring] of lines(d)) {
        const row = el("div", "r"), key = el("i", ring === true ? "ring" : ring || "dot");
        if (ring !== true) key.style.background = color;
        row.append(key, el("b", null, value), el("span", null, name));
        tip.append(row);
      }
      tip.hidden = false;
      tip.style.left = Math.max(0, width - tip.offsetWidth - 4) + "px";
      tip.style.top = Math.max(0, cy - 30) + "px";
    });
    r.addEventListener("pointerleave", () => (tip.hidden = true));
    svg.append(r);
  });
}

// row labels of the dot and range charts; chart.highlight names one row (e.g. "Canada") drawn bold in the main colour
// (or in `fill`: the compare chart uses plain ink, like the bold total row of the industry chart)
function rowAxis(labels, highlight, padding, fill = COLORS.main) {
  const base = { tickSize: 0, tickPadding: padding, label: null };
  if (!labels.includes(highlight)) return [Plot.axisY({ ...base, fill: INK })];
  return [Plot.axisY({ ...base, ticks: labels.filter((l) => l !== highlight), fill: INK }),
          Plot.axisY({ ...base, ticks: [highlight], fill, fontWeight: 600 })];
}

// ---------- dot chart: now vs a year ago, one row per place ----------
function dotChart(box, chart) {
  box.replaceChildren();
  const width = box.clientWidth;
  if (!width) return;
  const rows = chart.dots;
  const unit = chart.unit || "%", dec = chart.decimals ?? 1, f = (v) => fmt(v, unit, dec);
  const lo = d3.min(rows, (d) => Math.min(d.now, d.before)), hi = d3.max(rows, (d) => Math.max(d.now, d.before));
  const labels = rows.map((d) => d.label);
  const ml = labelMargin(labels, 48, 12), mr = 20, x0 = Math.floor(lo - 1), x1 = Math.ceil(hi + 1);
  // a value label that would run into the row names (current dot near the left edge) moves to the right of the ring
  const px = (v) => ml + ((v - x0) / (x1 - x0)) * (width - ml - mr);
  const fitsLeft = (d) => px(d.now) - 10 - textWidth(f(d.now)) > ml + 4;
  const svg = Plot.plot({
    width, height: rows.length * 28 + 34, marginLeft: ml, marginRight: mr, marginTop: 6, marginBottom: 26,
    x: { domain: [x0, x1] },
    y: { domain: labels, padding: 0.5 },
    style: FONT,
    marks: [
      Plot.gridX({ ticks: 5, stroke: LINE, strokeOpacity: 1 }),
      Plot.axisX({ ticks: 5, tickSize: 0, label: null, tickFormat: tickFmt(unit) }),
      ...rowAxis(labels, chart.highlight, 8),
      Plot.link(rows, { x1: "before", x2: "now", y1: "label", y2: "label", stroke: "#cdc8bf", strokeWidth: 2 }),
      Plot.dot(rows, { x: "before", y: "label", r: 4.5, fill: PAPER, stroke: COLORS.context, strokeWidth: 1.5 }),
      Plot.dot(rows, { x: "now", y: "label", r: 5, fill: COLORS.main, stroke: PAPER, strokeWidth: 1.5 }),
      // the current value sits beside the current (filled) dot, on the side away from last year's ring
      Plot.text(rows.filter((d) => d.now >= d.before), { x: "now", y: "label", text: (d) => f(d.now), dx: 10, textAnchor: "start", fill: INK, fontWeight: 600 }),
      Plot.text(rows.filter((d) => d.now < d.before && fitsLeft(d)), { x: "now", y: "label", text: (d) => f(d.now), dx: -10, textAnchor: "end", fill: INK, fontWeight: 600 }),
      Plot.text(rows.filter((d) => d.now < d.before && !fitsLeft(d)), { x: "before", y: "label", text: (d) => f(d.now), dx: 10, textAnchor: "start", fill: INK, fontWeight: 600 }),
    ],
  });
  box.append(svg);
  rowHover(box, svg, rows, width, (d) => [
    [COLORS.main, f(d.now), chart.labels.now], [COLORS.context, f(d.before), chart.labels.before, true]]);
}

// ---------- range chart: each row against its own history ----------
function rangeChart(box, chart) {
  box.replaceChildren();
  const width = box.clientWidth;
  if (!width) return;
  const rows = chart.rows;
  const step = 46;
  const unit = chart.unit || "%", dec = chart.decimals ?? 1, f = (v) => fmt(v, unit, dec);
  // the axis runs from zero (or below, when a row has negative values) to the next multiple of chart.step (default 5)
  const every = chart.step || 5;
  const xMin = Math.min(0, Math.floor(d3.min(rows, (d) => d.min) / every) * every), xMax = Math.ceil(d3.max(rows, (d) => d.max) / every) * every;
  const labels = rows.map((d) => d.label);
  const svg = Plot.plot({
    width, height: rows.length * step + 32, marginLeft: labelMargin(labels, 92, 16), marginRight: 52, marginTop: 6, marginBottom: 26,
    x: { domain: [xMin, xMax] },
    y: { domain: labels, padding: 0 },
    style: FONT,
    marks: [
      Plot.gridX({ ticks: 6, stroke: LINE, strokeOpacity: 1 }),
      Plot.axisX({ ticks: 6, tickSize: 0, label: null, tickFormat: tickFmt(unit) }),
      ...rowAxis(labels, chart.highlight, 10),
      ...(xMin < 0 ? [Plot.ruleX([0], { stroke: "#9aa1ab", strokeWidth: 1 })] : []),
      Plot.barX(rows, { x1: "min", x2: "max", y: "label", fill: "#ece8e1", insetTop: 17, insetBottom: 17, rx: 3 }),
      Plot.barX(rows, { x1: "p25", x2: "p75", y: "label", fill: "#d6d0c6", insetTop: 12, insetBottom: 12, rx: 3 }),
      Plot.dot(rows, { x: "before", y: "label", r: 4.5, fill: PAPER, stroke: COLORS.context, strokeWidth: 1.5 }),
      Plot.dot(rows, { x: "now", y: "label", r: 6, fill: COLORS.main, stroke: PAPER, strokeWidth: 1.5 }),
      // percentile in the right margin, outside the plot area
      Plot.text(rows, { x: () => xMax, y: "label", text: (d) => ordinal(d.pct), dx: 14, textAnchor: "start", fill: INK, fontWeight: 600 }),
    ],
  });
  box.append(svg);
  rowHover(box, svg, rows, width, (d) => [
    [COLORS.main, f(d.now), `${chart.labels.now} · ${ordinal(d.pct)} percentile`],
    [COLORS.context, f(d.before), chart.labels.before, true],
    ["#d6d0c6", `${f(d.p25)} to ${f(d.p75)}`, chart.labels.middle],
    ["#ece8e1", `${f(d.min)} to ${f(d.max)}`, chart.labels.range]]);
}

// ---------- horizontal bar list: diverging around zero, in HTML ----------
function barChart(box, chart) {
  box.replaceChildren();
  const vals = chart.bars.map((b) => b.value);
  const neg = Math.max(0, -d3.min(vals)), pos = Math.max(0, d3.max(vals));
  const zero = (neg / (neg + pos)) * 100;
  const f = (v) => fmt(v, chart.unit, chart.decimals ?? 1);
  // a row with highlight: true keeps its colour and the other rows turn context grey
  const anyHighlight = chart.bars.some((b) => b.highlight);
  const wrap = el("div", "bars");
  for (const b of chart.bars) {
    const row = el("div", "bar-row" + (b.highlight ? " hl" : ""));
    row.title = `${b.label}: ${f(b.value)}`;
    const track = el("div", "bar-track");
    const z = el("i", "zero"); z.style.left = zero + "%";
    const bar = el("i", "bar " + (b.value >= 0 ? "pos" : "neg") + (anyHighlight && !b.highlight ? " dim" : ""));
    const w = (Math.abs(b.value) / (neg + pos)) * 100;
    bar.style.width = w + "%";
    bar.style.left = (b.value >= 0 ? zero : zero - w) + "%";
    track.append(bar, z);
    row.append(el("span", "bar-label", b.label), track, el("span", "bar-val", f(b.value)));
    wrap.append(row);
  }
  box.append(wrap);
}

// ---------- small shared pieces for the interactive charts below ----------
// a row of toggle buttons; options are [key, label] pairs
function segmented(options, current, onPick, cls = "seg") {
  const seg = el("div", cls);
  seg.setAttribute("role", "group");
  for (const [key, label] of options) {
    const b = el("button", null, label);
    b.type = "button";
    b.setAttribute("aria-pressed", String(key === current));
    b.onclick = () => onPick(key);
    seg.append(b);
  }
  return seg;
}
// change a card's title and/or reading (charts whose text depends on the reader's choice)
function setCardText(box, title, reading) {
  const c = box.closest(".card");
  if (!c) return;
  if (title) c.querySelector("h3").textContent = title;
  if (reading) c.querySelector(".reading").textContent = reading;
}
// ---------- compare chart: one line per row, now (blue dot, value beside it) and a year ago (ring, joined to the dot);
// the change from the previous month sits in a chip in the right margin (orange ▲ up, blue ▼ down).
// chart.fill: the chart grows taller to fill its card when the card beside it is taller (no empty space at the bottom) ----------
function compareChart(box, chart, extra = 0) {
  box.replaceChildren();
  const width = box.clientWidth;
  if (!width) return;
  const rows = chart.rows, unit = chart.unit || "%", f = (v) => fmt(v, unit, chart.decimals ?? 1);
  const labels = rows.map((d) => d.label);
  const lo = d3.min(rows, (d) => Math.min(d.now, d.year)), hi = d3.max(rows, (d) => Math.max(d.now, d.year));
  const x0 = Math.floor(lo - 1), x1 = Math.ceil(hi + 1);
  // chart.chips: columns of change chips right of the chart, e.g. [{key: "m1", label: "vs Aug"}, {key: "m3", label: "3-mo trend"}]
  // (rows carry each key); without it, one column of the change from the previous month
  const chips = chart.chips || [{ key: null, label: chart.labels.prev }];
  const chipW = 54, chipGap = 8;
  const ml = labelMargin(labels, 48, 12), mr = 18 + chips.length * (chipW + chipGap), mt = 24;
  const step = 28 + extra / rows.length;
  // whole numbers only on the axis (4%, 5%, 6%, not 4.5%): every 1, 2 or 5 points, at most about six ticks
  const every = [1, 2, 5].find((e) => (x1 - x0) / e <= 6) || 10;
  const xTicks = d3.range(Math.ceil(x0 / every) * every, x1 + 0.001, every);
  // the value sits beside the blue dot, on the side away from the ring; if that would run into the row names, past the ring
  const px = (v) => ml + ((v - x0) / (x1 - x0)) * (width - ml - mr);
  const fitsLeft = (d) => px(d.now) - 10 - textWidth(f(d.now)) > ml + 4;
  const svg = Plot.plot({
    width, height: rows.length * step + mt + 26, marginLeft: ml, marginRight: mr, marginTop: mt, marginBottom: 26,
    x: { domain: [x0, x1] }, y: { domain: labels, padding: 0.5 }, style: FONT,
    marks: [
      Plot.gridX({ ticks: xTicks, stroke: LINE, strokeOpacity: 1 }),
      Plot.axisX({ ticks: xTicks, tickSize: 0, label: null, tickFormat: tickFmt(unit) }),
      ...rowAxis(labels, chart.highlight, 8, INK),
      Plot.link(rows, { x1: "year", x2: "now", y1: "label", y2: "label", stroke: "#cdc8bf", strokeWidth: 2 }),
      Plot.dot(rows, { x: "year", y: "label", r: 4.5, fill: PAPER, stroke: COLORS.context, strokeWidth: 1.5 }),
      Plot.dot(rows, { x: "now", y: "label", r: 5, fill: COLORS.main, stroke: PAPER, strokeWidth: 1.5 }),
      Plot.text(rows.filter((d) => d.now >= d.year), { x: "now", y: "label", text: (d) => f(d.now), dx: 10, textAnchor: "start", fill: INK, fontWeight: 600 }),
      Plot.text(rows.filter((d) => d.now < d.year && fitsLeft(d)), { x: "now", y: "label", text: (d) => f(d.now), dx: -10, textAnchor: "end", fill: INK, fontWeight: 600 }),
      Plot.text(rows.filter((d) => d.now < d.year && !fitsLeft(d)), { x: "year", y: "label", text: (d) => f(d.now), dx: 10, textAnchor: "start", fill: INK, fontWeight: 600 }),
    ],
  });
  box.append(svg);

  // the chips, in the right margin, each column under its header ("vs Aug", "3-mo trend")
  const ys = svg.scale("y"), [, px1] = svg.scale("x").range;
  const change = (d, c) => Math.round((c.key ? d[c.key] : d.now - d.prev) * 10) / 10 || 0;   // (|| 0 turns −0 into 0)
  chips.forEach((c, j) => {
    const cx = px1 + 16 + chipW / 2 + j * (chipW + chipGap);
    const head = svgEl("text", { x: cx, y: 13, "text-anchor": "middle", fill: MUTED, "font-size": "10.5px", "font-weight": 500 });
    head.textContent = c.label;
    svg.append(head);
    for (const d of rows) {
      const v = change(d, c), cy = ys.apply(d.label);
      const [bg, fg, arrow] = v > 0 ? ["#fde3cb", "#8f3d06", "\u25B2 "] : v < 0 ? ["#dbe7fb", "#1d3f9e", "\u25BC "] : ["#f1efeb", MUTED, ""];
      const t = svgEl("text", { x: cx, y: cy, dy: "0.35em", "text-anchor": "middle", fill: fg, "font-size": "11px", "font-weight": 600 });
      t.textContent = arrow + Math.abs(v).toFixed(1);
      svg.append(svgEl("rect", { x: cx - chipW / 2, y: cy - 10, width: chipW, height: 20, rx: 10, fill: bg }), t);
    }
  });
  rowHover(box, svg, rows, width, (d) => [
    [COLORS.main, f(d.now), chart.labels.now], [COLORS.context, f(d.year), chart.labels.year, true],
    ...chips.map((c) => ["#5b6068", (change(d, c) > 0 ? "+" : "") + minus(change(d, c).toFixed(1)) + " pts", c.label, "none"])]);

  // fill the card: measure the empty space above its footnote and redraw once with the rows spread over it
  if (chart.fill && !extra) {
    const foot = box.closest(".card")?.querySelector(".foot");
    const free = foot ? foot.getBoundingClientRect().top - box.getBoundingClientRect().bottom - 14 : 0;
    if (free > 12) compareChart(box, chart, Math.min(free, rows.length * 24));
  }
}

// ---------- bars in columns: one row per item, one column per period, each column on its own scale ----------
// Clicking a column's heading orders the rows by that column (the total row stays on top). Outlined bars are
// statistically significant at chart.level; each row is its own grid, so hovering lights up the whole row.
function barsMulti(box, chart) {
  box.replaceChildren();
  const f = (v) => fmt(v, chart.unit, chart.decimals ?? 1);
  const cols = chart.columns;
  if (chart.sortBy == null) chart.sortBy = chart.sort ?? cols.length - 1;     // (kept on the chart, so a redraw keeps the reader's choice)
  const by = chart.sortBy;
  const rows = [...chart.rows].sort((a, b) => (b.total ? 1 : 0) - (a.total ? 1 : 0) || b.values[by] - a.values[by]);
  // in a card narrower than 720px the label moves onto its own line above the columns, or the bars get too thin to read
  const wrap = el("div", "bm" + (box.clientWidth < 720 ? " bm-narrow" : ""));
  wrap.style.setProperty("--cols", cols.length);
  const head = el("div", "bm-row bm-headrow");
  head.append(el("div", "bm-corner", "Click a column to sort"));
  cols.forEach((c, j) => {
    const h = el("button", "bm-head" + (j === by ? " on" : ""));
    h.type = "button";
    h.title = `Sort by ${c.label.toLowerCase()}`;
    h.setAttribute("aria-pressed", j === by);
    h.append(el("b", null, c.label + (j === by ? " ↓" : "")), el("span", null, c.sub));
    h.addEventListener("click", () => {
      chart.sortBy = j;
      barsMulti(box, chart);
      box.querySelectorAll(".bm-head")[j].focus({ preventScroll: true });  // (keep keyboard focus on the heading)
    });
    head.append(h);
  });
  wrap.append(head);
  // (a month's changes are far smaller than a year's, so each column has its own scale, shared by all its rows)
  const scales = cols.map((_, j) => {
    const vals = rows.map((r) => r.values[j]);
    const neg = Math.max(0, -d3.min(vals)), pos = Math.max(0, d3.max(vals));
    return { neg, pos, zero: (neg / (neg + pos || 1)) * 100 };
  });
  for (const r of rows) {
    const row = el("div", "bm-row" + (r.total ? " total" : ""));
    row.append(el("div", "bm-label", r.label));
    r.values.forEach((v, j) => {
      const s = scales[j], sig = r.significant?.[j], cell = el("div", "bm-cell");
      cell.title = `${r.label}, ${cols[j].label.toLowerCase()} (${cols[j].sub}): ${f(v)}, `
        + (sig ? `statistically significant (${chart.level})` : "not statistically significant");
      const track = el("div", "bar-track");
      const z = el("i", "zero"); z.style.left = s.zero + "%";
      const w = (Math.abs(v) / (s.neg + s.pos || 1)) * 100;
      const bar = el("i", "bar " + (v >= 0 ? "pos" : "neg") + (sig ? " sig" : ""));
      bar.style.width = w + "%";
      bar.style.left = (v >= 0 ? s.zero : s.zero - w) + "%";
      track.append(bar, z);
      cell.append(track, el("span", "bar-val", f(v)));
      row.append(cell);
    });
    wrap.append(row);
  }
  box.append(wrap);
}

// ---------- who is unemployed: two grids now (cohort_grids) and a heat map over time (cohort_heatmap) ----------
// A group's percentile against its own history is coloured in ten steps of ten: five blues (lower than usual) and five
// oranges (higher), with neighbouring steps distinct for colour-blind readers too. A rate is a level, not good or bad
// against history, so it gets a neutral slate in five steps. Charts with the same chart.link light up the same group.
const PCT_STEPS = ["#2456b9", "#4d78ca", "#7498d9", "#9db8e8", "#c4d7f8", "#f9d1ba", "#edae88", "#dc8b57", "#c66d2f", "#aa530a"];
const pctStep = (p) => PCT_STEPS[Math.min(9, Math.floor(p / 10))];
const PCT_TICKS = [[1, "10"], [3, "30"], [5, "50"], [7, "70"], [9, "90"]];        // (labels after steps 1, 3, 5 ...)
const RATE_STEPS = { cuts: [5, 7, 10, 15], colors: ["#eef0f3", "#d5dae1", "#b0b9c5", "#7f8b9b", "#4d5867"] };
const rateStep = (r) => RATE_STEPS.colors[d3.bisectRight(RATE_STEPS.cuts, r)];
// white or ink text on a coloured cell, whichever has more contrast
function inkOn(bg) {
  const c = d3.rgb(bg), lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  return 1.05 / (L + 0.05) > (L + 0.05) / 0.0587 ? "#fff" : INK;
}
// hovering a group in one chart lights it up in every chart with the same chart.link
const hovers = {};      // link -> Map(box -> light(groupKey or null))
function onLight(chart, box, light) { (hovers[chart.link] = hovers[chart.link] || new Map()).set(box, light); }
function lightLink(link, key) { for (const light of (hovers[link] || new Map()).values()) light(key); }
// one tooltip that follows the pointer, for charts drawn as HTML grids or wide SVG
let floatTip = null;
function showFloat(e, lines) {
  if (!floatTip) { floatTip = el("div", "tip float"); document.body.append(floatTip); }
  floatTip.replaceChildren(...lines);
  floatTip.hidden = false;
  const w = floatTip.offsetWidth, h = floatTip.offsetHeight;
  floatTip.style.left = (e.clientX + 16 + w > innerWidth ? e.clientX - 16 - w : e.clientX + 16) + "px";
  floatTip.style.top = Math.min(e.clientY + 14, innerHeight - h - 8) + "px";
}
function hideFloat() { if (floatTip) floatTip.hidden = true; }
// a tooltip line: plain text, with [text] parts in bold
const tipLine = (...parts) => {
  const d = el("div", "l");
  for (const p of parts) d.append(Array.isArray(p) ? el("b", null, p[0]) : document.createTextNode(p));
  return d;
};
const groupName = (e, a) => `${a.sub || a.label} year olds, ${e.key === "all" ? "all education levels" : e.label.toLowerCase()}`;
// a stepped colour key: equal segments, some boundaries labelled under them ([after step k, label]), a caption at each
// end, and the hatch for groups too small to measure beside it
function stepKey(colors, ticks, left, right, small) {
  const row = el("div", "step-key"), s = el("div", "steps"), bar = el("div", "bar"), marks = el("div", "ticks"), ends = el("div", "ends");
  for (const c of colors) { const i = el("i"); i.style.background = c; bar.append(i); }
  for (const [k, label] of ticks) { const t = el("span", null, label); t.style.left = (k / colors.length) * 100 + "%"; marks.append(t); }
  ends.append(el("span", null, left), el("span", null, right));
  s.append(bar, marks, ends);
  row.append(s);
  if (small) { const h = el("span"); h.append(el("i", "hatch"), document.createTextNode(small)); row.append(h); }
  return row;
}

// two grids side by side, ages down and education across ("All ages" row and "All" column first, set apart):
// the unemployment rate, then its percentile against the group's own history
function cohortGrids(box, chart) {
  box.replaceChildren();
  const lit = new Map();      // group key -> its cell in each grid
  const grid = (title, sub, color, text, key) => {
    const part = el("div");
    part.append(el("h4", null, title), el("p", "sub", sub));
    const g = el("div", "hm");
    g.append(el("div", "hm-h"));
    chart.edus.forEach((e, j) => { g.append(el("div", "hm-h" + (e.key === "all" ? " all" : ""), e.short)); if (!j) g.append(el("div")); });
    chart.ages.forEach((a, i) => {
      const first = i === 0;
      const label = el("div", "hm-row" + (a.sub ? " all" : "") + (first ? " first" : ""), a.label);
      if (a.sub) label.append(el("span", null, a.sub));
      g.append(label);
      chart.edus.forEach((e, j) => {
        const cell = chart.cells[e.key][a.key], c = el("div", "hm-cell" + (first ? " first" : ""));
        if (!cell) { c.classList.add("small"); c.title = chart.small; }
        else {
          const bg = color(cell), k = e.key + "|" + a.key;
          c.style.background = bg;
          c.style.color = inkOn(bg);
          c.textContent = text(cell);
          c.onpointermove = (ev) => {
            showFloat(ev, [el("div", "t", groupName(e, a)),
              tipLine(`${chart.month}: `, [fmt(cell.rate, "%", 1)], " unemployed (12-month average)"),
              tipLine([ordinal(cell.pct)], " percentile of its history since 2000"),
              tipLine(`A year earlier: ${fmt(cell.rate_year, "%", 1)}, ${ordinal(cell.pct_year)} percentile`)]);
            lightLink(chart.link, k);
          };
          c.onpointerleave = () => { hideFloat(); lightLink(chart.link, null); };
          if (!lit.has(k)) lit.set(k, []);
          lit.get(k).push(c);
        }
        g.append(c);
        if (!j) g.append(el("div", first ? "first" : null));       // (the gap after the "All" column)
      });
    });
    part.append(g, key);
    return part;
  };
  const pair = el("div", "pair");
  pair.append(
    grid("How high is it?", "Unemployment rate, 12-month average", (c) => rateStep(c.rate), (c) => fmt(c.rate, "%", 1),
         stepKey(RATE_STEPS.colors, RATE_STEPS.cuts.map((v, k) => [k + 1, v + "%"]), "Lower rate", "Higher rate", chart.small)),
    grid("How unusual is it?", "Percentile of the group's own history since 2000", (c) => pctStep(c.pct), (c) => ordinal(c.pct),
         stepKey(PCT_STEPS, PCT_TICKS, "Lower than usual", "Higher than usual", chart.small)));
  box.append(pair);
  onLight(chart, box, (key) => lit.forEach((cells, k) => cells.forEach((c) => c.classList.toggle("on", k === key))));
}

// one row per group, one cell per month (thin stripes when months are narrow), coloured by that month's percentile;
// rows grouped by education or by age; the page's time range sets how far back it goes
function cohortHeatmap(box, chart) {
  box.replaceChildren();
  const width = box.clientWidth;
  if (!width) return;
  const by = chart._by || "age";                     // (kept on the chart, so a redraw keeps the reader's choice)
  box.append(segmented([["age", "Group by age"], ["edu", "Group by education"]], by, (key) => { chart._by = key; draw(box, chart); }));
  const months = chart.months.map(parseMonth), N = months.length;
  const years = RANGES.find((r) => r[0] === range)?.[2];
  const from = years ? Math.max(0, months.findIndex((d) => d >= d3.utcYear.offset(months[N - 1], -years))) : 0;
  const row = (e, a) => ({ e, a, label: by === "edu" ? a.label : e.short, h: chart.history[e.key][a.key] });
  const blocks = by === "edu" ? chart.edus.map((e) => ({ label: e.label, rows: chart.ages.map((a) => row(e, a)) }))
                              : chart.ages.map((a) => ({ label: a.label + " year olds", rows: chart.edus.map((e) => row(e, a)) }));
  const rowH = 16, rowGap = 3, headH = 19, blockGap = 9;
  const ml = d3.max(blocks.flatMap((b) => b.rows), (r) => textWidth(r.label)) + 22, mr = 46;
  const cols = N - from, cw = (width - ml - mr) / cols, gap = cw >= 6 ? 1 : 0;   // (a gap between cells only when they are wide)
  const rows = [];
  let y = 0;
  for (const b of blocks) {
    b.y = y; y += headH;
    for (const r of b.rows) { rows.push({ ...r, y }); y += rowH + rowGap; }
    y += blockGap;
  }
  const svg = svgEl("svg", { width, height: y + 18, role: "img", "aria-label": chart.title + " " + chart.reading,
                             style: "display: block; overflow: visible; font: 11.5px 'IBM Plex Sans', sans-serif" });
  for (const b of blocks) {
    const t = svgEl("text", { x: 0, y: b.y + 12, fill: INK, "font-weight": 600, "text-anchor": "start" });
    t.textContent = b.label;
    svg.append(t);
  }
  const labels = new Map();     // group key -> its row and label, for lighting up
  for (const r of rows) {
    const t = svgEl("text", { x: ml - 8, y: r.y + rowH / 2, dy: "0.35em", fill: "#3d444e", "text-anchor": "end" });
    t.textContent = r.label;
    svg.append(t);
    if (!r.h) {
      svg.append(svgEl("rect", { x: ml, y: r.y, width: cols * cw, height: rowH, rx: 3, fill: "#f1efeb" }));
      const s = svgEl("text", { x: ml + 8, y: r.y + rowH / 2, dy: "0.35em", fill: MUTED, "font-size": "10.5px", "text-anchor": "start" });
      s.textContent = chart.small;
      svg.append(s);
      continue;
    }
    labels.set(r.e.key + "|" + r.a.key, { t, r });
    for (let i = from; i < N; i++) {
      // (without gaps each stripe overlaps the next by half a pixel, or anti-aliasing leaves pale seams between them)
      svg.append(svgEl("rect", { x: ml + (i - from) * cw, y: r.y, width: gap ? cw - gap : cw + (i < N - 1 ? 0.5 : 0), height: rowH,
                                 rx: gap ? 2 : 0, fill: pctStep(r.h.pct[i]) }));
    }
    const v = svgEl("text", { x: width - mr + 8, y: r.y + rowH / 2, dy: "0.35em", fill: INK, "font-weight": 600, "font-size": "11px", "text-anchor": "start" });
    v.textContent = ordinal(r.h.pct[N - 1]);
    svg.append(v);
  }
  const head = svgEl("text", { x: width - mr + 8, y: -6, fill: MUTED, "font-size": "10px", "text-anchor": "start" });
  head.textContent = "Now";
  svg.append(head);
  // years along the bottom, as many as fit
  const every = [1, 2, 5].find((k) => cw * 12 * k >= 34) || 10;
  for (let i = from; i < N; i++) {
    if (months[i].getUTCMonth() !== 0 || months[i].getUTCFullYear() % every) continue;
    const x = ml + (i - from) * cw;
    svg.append(svgEl("line", { x1: x, x2: x, y1: y - blockGap, y2: y - blockGap + 4, stroke: MUTED }));
    const t = svgEl("text", { x, y: y + 8, fill: MUTED, "font-size": "10.5px", "text-anchor": "middle" });
    t.textContent = months[i].getUTCFullYear();
    svg.append(t);
  }
  // hover: outline the month under the pointer; the lit-up group's row gets an outline and a bold label
  const band = svgEl("rect", { x: ml - 3, width: cols * cw + 6, height: rowH + 6, rx: 4, fill: "none", stroke: INK, "stroke-width": 1.5, visibility: "hidden" });
  const ring = svgEl("rect", { width: Math.max(cw, 3), height: rowH + 2, rx: 2, fill: "none", stroke: INK, "stroke-width": 1.5, visibility: "hidden" });
  const hit = svgEl("rect", { x: ml, y: 0, width: cols * cw, height: y, fill: "transparent" });
  svg.append(band, ring, hit);
  onLight(chart, box, (key) => {
    labels.forEach(({ t }, k) => { t.setAttribute("font-weight", k === key ? 600 : 400); t.setAttribute("fill", k === key ? INK : "#3d444e"); });
    const lit = labels.get(key);
    if (lit) band.setAttribute("y", lit.r.y - 3);
    band.setAttribute("visibility", lit ? "visible" : "hidden");
  });
  hit.addEventListener("pointermove", (e) => {
    const [px, py] = d3.pointer(e, svg), i = from + Math.min(cols - 1, Math.max(0, Math.floor((px - ml) / cw)));
    const r = rows.find((r) => py >= r.y - rowGap / 2 && py < r.y + rowH + rowGap / 2);
    if (!r || !r.h) { ring.setAttribute("visibility", "hidden"); hideFloat(); lightLink(chart.link, null); return; }
    ring.setAttribute("x", ml + (i - from) * cw - (cw < 3 ? 1 : 0));
    ring.setAttribute("y", r.y - 1);
    ring.setAttribute("visibility", "visible");
    showFloat(e, [el("div", "t", groupName(r.e, r.a)),
      tipLine(`${monthLabel(months[i])}: `, [fmt(r.h.rate[i], "%", 1)], " unemployed (12-month average)"),
      tipLine([ordinal(r.h.pct[i])], " percentile of its history since 2000")]);
    lightLink(chart.link, r.e.key + "|" + r.a.key);
  });
  hit.addEventListener("pointerleave", () => { ring.setAttribute("visibility", "hidden"); hideFloat(); lightLink(chart.link, null); });
  box.append(svg, stepKey(PCT_STEPS, PCT_TICKS, "Lower than usual", "Higher than usual", chart.small));
}

// ---------- one chart card ----------
const drawers = [];   // [box, chart] pairs, redrawn on resize and when the range changes

function legendItem(text, color, shape) {
  const item = el("span"), key = el("i", shape);
  if (color) key.style.background = color;
  item.append(key, document.createTextNode(text));
  return item;
}

function card(chart) {
  const c = el("article", "card");
  c.id = chart.id;
  // chart.reading_lines: the reading as separate lines, each optionally with a tone ("up" warm, "down" cool), e.g. what
  // pushed a rate up and what pulled it down; otherwise the plain reading
  const reading = el("p", "reading");
  // (a line's label, e.g. "Pushed it up:", carries the tone colour; the rest of the line stays in the reading colour)
  if (chart.reading_lines) for (const l of chart.reading_lines) {
    const line = el("span", "line" + (l.tone ? " tone-" + l.tone : ""));
    if (l.label) line.append(el("b", "lab", l.label), document.createTextNode(" "));
    line.append(document.createTextNode(l.text));
    reading.append(line);
  }
  else reading.textContent = chart.reading;
  c.append(el("h3", null, chart.title), reading);

  const legend = el("div", "legend");
  if (chart.kind === "line" && (chart.series.length > 1 || chart.lower)) {
    for (const s of [...chart.series.filter((s) => !s.context), ...(chart.legend_extra || [])]) {
      const item = legendItem(s.name, COLORS[s.color], s.mark === "bar" || s.mark === "area" ? "sq" : null), key = item.firstChild;
      if (s.opacity != null) key.style.opacity = s.opacity;
      if (s.dash) key.style.background = `repeating-linear-gradient(90deg, ${COLORS[s.color]} 0 4px, transparent 4px 7px)`;
      legend.append(item);
    }
  }
  if (chart.kind === "dots") legend.append(legendItem(chart.labels.now, COLORS.main, "dot"), legendItem(chart.labels.before, null, "ring"));
  if (chart.kind === "range") {
    legend.append(legendItem(chart.labels.now, COLORS.main, "dot"), legendItem(chart.labels.before, null, "ring"),
      legendItem(chart.labels.middle, "#d6d0c6", "sq"), legendItem(chart.labels.range, "#ece8e1", "sq"),
      legendItem("Right: percentile now", null, "none"));
  }
  if (chart.kind === "compare") {
    legend.append(legendItem(chart.labels.now, COLORS.main, "dot"), legendItem(chart.labels.year, null, "ring"));
  }
  if (chart.kind === "bars_multi") {
    legend.append(legendItem("Gain", COLORS.main, "sq"), legendItem("Loss", COLORS.second, "sq"),
      legendItem(`Outlined: statistically significant (${chart.level})`, "#d6d0c6", "sq sig"));
  }
  if (legend.childElementCount) c.append(legend);

  const box = el("div", "plot");
  if (chart.kind === "line") {
    box.tabIndex = 0;
    box.setAttribute("role", "img");
    box.setAttribute("aria-label", `${chart.title} ${chart.reading} Use the left and right arrow keys to read values.`);
  }
  c.append(box);
  drawers.push([box, chart]);

  const foot = el("div", "foot");
  foot.append(document.createTextNode(chart.note + " Source: "));
  const a = (text, href) => { const link = el("a", null, text); link.href = href; link.target = "_blank"; link.rel = "noopener noreferrer"; return link; };
  if (chart.source_links) {                // several tables: "tables 14-10-0287-01 & 14-10-0432-01", one link each
    const links = chart.source_links.links;
    foot.append(document.createTextNode(chart.source_links.text));
    links.forEach(([t, href], i) => foot.append(...(i ? [document.createTextNode(i === links.length - 1 ? " & " : ", ")] : []), a(t, href)));
  } else foot.append(a(chart.source, chart.source_url));
  foot.append(document.createTextNode("."));
  c.append(foot);
  return c;
}

function draw(box, chart) {
  if (chart.kind === "line") lineChart(box, chart);
  else if (chart.kind === "dots") dotChart(box, chart);
  else if (chart.kind === "range") rangeChart(box, chart);
  else if (chart.kind === "compare") compareChart(box, chart);
  else if (chart.kind === "bars_multi") barsMulti(box, chart);
  else if (chart.kind === "cohort_grids") cohortGrids(box, chart);
  else if (chart.kind === "cohort_heatmap") cohortHeatmap(box, chart);
  else barChart(box, chart);
}
function drawAll() { for (const [box, chart] of drawers) draw(box, chart); }

// ---------- topic page ----------
async function topicPage(root, topic) {
  const data = await (await fetch(`${root}data/${topic}.json`, { cache: "no-cache" })).json();

  const u = document.getElementById("updated");
  u.replaceChildren(document.createTextNode("Latest: "), el("b", null, `${data.updated.survey}, ${data.updated.month}`),
    document.createTextNode(`, released ${data.updated.released}.`));

  const tiles = document.getElementById("tiles");
  for (const t of data.tiles) {
    const tile = el("div", "tile-stat");
    const value = el("span", "v", t.value);
    if (t.unit) value.append(el("span", "u", " " + t.unit));        // (a small word after the number: "5 provinces")
    tile.append(el("span", "k", t.label), value, el("span", "d", t.change), sparkline(t.spark));
    tiles.append(tile);
  }

  const list = document.getElementById("changes");
  for (const c of data.changes) list.append(el("li", null, c));

  const jump = document.getElementById("jump"), groups = document.getElementById("groups");
  data.sections.forEach((s, i) => {
    const id = "s" + (i + 1);
    const a = el("a", null, s.title); a.href = "#" + id; jump.append(a);
    const sec = el("section", "group"); sec.id = id;
    const h = el("h2", "h2"); h.append(el("span", "n", String(i + 1).padStart(2, "0")), document.createTextNode(s.title));
    const grid = el("div", "grid");
    // cards pair up side by side; a card with chart.wide, or one left without a partner, takes the full row
    let run = [];
    const closeRun = () => { if (run.length % 2) run.at(-1).classList.add("wide"); run = []; };
    s.charts.forEach((ch) => {
      const c = card(ch);
      grid.append(c);
      if (ch.wide) { closeRun(); c.classList.add("wide"); } else run.push(c);
    });
    closeRun();
    sec.append(h, grid);
    groups.append(sec);
  });

  // time-range control: scopes every time-series chart on the page
  // (data.ranges false: the page's series are short, so it shows them whole and hides the control)
  const ctl = document.getElementById("range");
  if (data.ranges === false) { range = "all"; ctl.hidden = true; }
  else ctl.append(el("span", null, "Show"));
  for (const [key, label] of data.ranges === false ? [] : RANGES) {
    const b = el("button", null, label);
    b.type = "button";
    b.setAttribute("aria-pressed", String(key === range));
    b.onclick = () => {
      range = key;
      try { localStorage.setItem("monitor-range", key); } catch (e) {}
      ctl.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      drawAll();
    };
    ctl.append(b);
  }

  document.getElementById("built").textContent = new Date(data.built_at.replace("Z", ":00Z")).toLocaleString(undefined,
    { day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit" });

  drawAll();
  let width = window.innerWidth, timer;
  window.addEventListener("resize", () => {
    if (window.innerWidth === width) return;
    width = window.innerWidth;
    clearTimeout(timer); timer = setTimeout(drawAll, 150);
  });
  followScroll();
}

// ---------- the section links and time range stay at the top of the window while scrolling (CSS position: sticky);
// this marks the row once it is stuck (it gets a shadow) and highlights the section being read ----------
function followScroll() {
  const bar = document.querySelector(".controls");
  if (!bar) return;
  const links = [...document.querySelectorAll("#jump a")];
  const sections = links.map((a) => document.querySelector(a.getAttribute("href")));
  let current = null, queued = false;
  function update() {
    queued = false;
    bar.classList.toggle("stuck", bar.getBoundingClientRect().top <= 0.5);
    // the section being read: the last one whose top has passed just under the bar
    const line = bar.getBoundingClientRect().bottom + 24;
    let at = -1;
    sections.forEach((s, i) => { if (s && s.getBoundingClientRect().top <= line) at = i; });
    if (at === current) return;
    current = at;
    links.forEach((a, i) => a.toggleAttribute("aria-current", i === at));
    // (on narrow screens the links scroll sideways: keep the highlighted one in view)
    if (at >= 0) {
      const nav = links[at].parentElement, a = links[at];
      if (a.offsetLeft < nav.scrollLeft || a.offsetLeft + a.offsetWidth > nav.scrollLeft + nav.clientWidth) nav.scrollLeft = a.offsetLeft - 8;
    }
  }
  window.addEventListener("scroll", () => { if (!queued) { queued = true; requestAnimationFrame(update); } }, { passive: true });
  update();
  // when the links don't all fit, the cut-off edge fades (class "more") until the reader scrolls them to the end
  const nav = document.getElementById("jump");
  const fade = () => nav.classList.toggle("more", nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 2);
  nav.addEventListener("scroll", fade, { passive: true });
  window.addEventListener("resize", fade);
  fade();
}

// ---------- front page: one tile per topic ----------
async function frontPage(root) {
  for (const tile of document.querySelectorAll("[data-topic-tile]")) {
    const topic = tile.dataset.topicTile;
    try {
      const data = await (await fetch(`${root}data/${topic}.json`, { cache: "no-cache" })).json();
      const h = data.headline;
      tile.querySelector("h2").textContent = h.question;
      const stat = tile.querySelector(".stat"), left = el("div");
      left.append(el("div", "v", h.value), el("div", "l", `${h.label} · ${h.change}`));
      stat.replaceChildren(left, sparkline(h.spark, 120, 40));
      tile.querySelector(".when").textContent = `${data.updated.survey}, ${data.updated.month} · released ${data.updated.released}`;
    } catch (e) {
      tile.querySelector(".when").textContent = "Data unavailable right now.";
    }
  }
  for (const tile of document.querySelectorAll("[data-galaxy-tile]")) galaxyTile(tile);
}

// The Budget Galaxy tile. That page lives on its own (/budget-galaxy/); the tile reads its data, so it follows each new
// budget by itself: the latest budget's largest theme and its share of the new spending (measures that cost money, as
// Budget Galaxy counts them), and a small copy of its map with the latest budget's measures in blue.
// If the data can't be read, the tile keeps the text written in the HTML.
async function galaxyTile(tile) {
  try {
    const data = await (await fetch(tile.dataset.galaxyTile, { cache: "no-cache" })).json();
    const year = d3.max(data.years);
    const spending = d3.rollup(data.measures.filter((m) => m.year === year && m.money > 0), (v) => d3.sum(v, (m) => m.money), (m) => m.cat);
    const [top, money] = d3.greatest(spending, ([, v]) => v);
    const theme = data.categories.find((c) => c.id === top).name;
    const left = el("div");
    left.append(el("div", "v", d3.format(".0%")(money / d3.sum(spending.values()))),
                el("div", "l", `of Budget ${year}'s new spending goes to ${theme.toLowerCase()}`));
    tile.querySelector(".stat").replaceChildren(left, miniMap(data.measures, year));
    tile.querySelector(".when").textContent =
      `Budget Galaxy · ${d3.format(",")(data.measures.length)} measures in Budgets ${d3.min(data.years)} to ${year}`;
  } catch (e) {
    console.warn("Budget Galaxy tile:", e);
  }
}

// Budget Galaxy's map, small: every measure a dot (its map is 1.5 times as wide as it is tall), earlier budgets in grey
function miniMap(measures, year, w = 114, h = 76) {
  const svg = svgEl("svg", { width: w, height: h, "aria-hidden": "true" });
  const x = d3.scaleLinear([0, 1], [2, w - 2]), y = d3.scaleLinear([0, 1], [h - 2, 2]);
  const dot = (m, r, fill) => svgEl("circle", { cx: x(m.x).toFixed(1), cy: y(m.y).toFixed(1), r, fill });
  svg.append(...measures.filter((m) => m.year !== year).map((m) => dot(m, 1, "#d6d1c9")),
             ...measures.filter((m) => m.year === year).map((m) => dot(m, 1.35, COLORS.main)));
  return svg;
}

// ---------- start ----------
fillName();
const page = document.body.dataset.page, root = document.body.dataset.root || "";
if (page === "topic") topicPage(root, document.body.dataset.topic);
if (page === "front") frontPage(root);
