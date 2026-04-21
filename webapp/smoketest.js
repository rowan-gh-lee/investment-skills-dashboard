// Smoke test — runs app.js analytics against sample data, compares to Python baseline.
const fs = require("fs");
const path = require("path");

const WEBAPP = "/sessions/blissful-gifted-davinci/mnt/투자 데이터 시각화/webapp";
const code = fs.readFileSync(path.join(WEBAPP, "app.js"), "utf-8");

// Strip parts that reference browser globals (DOMContentLoaded listener, wireUI, plotly calls).
// We only need the compute functions. Safest: use new Function() to evaluate in a sandboxed context.
const ctx = {
  console,
  Math,
  Number,
  Array,
  String,
  Object,
  JSON,
  Date,
  // stubs for browser globals app.js touches at top level
  document: { addEventListener: () => {} },
  window: {},
  Papa: null,
  Plotly: null,
  fetch: null,
  module,
  require,
};
const wrapped = `
(function(g) {
  const { console, Math, Number, Array, String, Object, JSON, Date, document, window, Papa, Plotly, fetch } = g;
  ${code}
  g.__exp = { mean, std, cov, variance, quantile, logReturns, portfolioReturns, cumulative,
    cagrFromCum, annualVol, sharpeOf, sortinoOf, maxDrawdown, betaAlpha, hhiOf,
    valueAtRisk, conditionalVar, stressTest, computeAll, toWidePrices, parseHoldings,
    convertPricesToBase };
})(arguments[0]);
`;
new Function(wrapped)(ctx);
const api = ctx.__exp;

// Parse sample CSV manually (no PapaParse)
function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split(",");
  return lines.slice(1).map(line => {
    const cells = line.split(",");
    const row = {};
    header.forEach((h, i) => {
      const v = cells[i];
      const n = Number(v);
      row[h] = (!isNaN(n) && v !== "") ? n : v;
    });
    return row;
  });
}

const priceText = fs.readFileSync(path.join(WEBAPP, "data/sample_prices.csv"), "utf-8");
const holdingsText = fs.readFileSync(path.join(WEBAPP, "data/sample_holdings.json"), "utf-8");
const rows = parseCsv(priceText);
const priceData = api.toWidePrices(rows);
const holdings = api.parseHoldings(holdingsText, false);

const summary = api.computeAll(priceData, holdings, "SPY");
const p = summary.portfolio;
const b = summary.vs_benchmark;

const baseline = JSON.parse(fs.readFileSync(
  "/sessions/blissful-gifted-davinci/mnt/투자 데이터 시각화/investment-dashboard/outputs/kpi_summary.json",
  "utf-8"
));
const bp = baseline.portfolio;
const bb = baseline.vs_benchmark;

function cmp(label, js, py, tol = 0.005) {
  const delta = Math.abs(js - py);
  const ok = delta <= tol;
  console.log(`  ${ok ? "✓" : "✗"} ${label.padEnd(28)} JS=${js.toFixed(5)}  PY=${py.toFixed(5)}  Δ=${delta.toFixed(5)}`);
  return ok;
}

console.log("Period:", summary.period.start, "→", summary.period.end, "·", summary.period.trading_days, "days");
console.log(`  (PY baseline: ${baseline.period.start} → ${baseline.period.end} · ${baseline.period.trading_days} days)`);
console.log();
console.log("Portfolio KPIs:");
let allOk = true;
allOk &= cmp("CAGR",               p.cagr,        bp.cagr);
allOk &= cmp("Total Return",       p.total_return, bp.total_return);
allOk &= cmp("Annual Vol",         p.ann_vol,     bp.ann_vol);
allOk &= cmp("Sharpe",             p.sharpe,      bp.sharpe, 0.05);
allOk &= cmp("Sortino",            p.sortino,     bp.sortino, 0.05);
allOk &= cmp("MDD",                p.mdd,         bp.mdd);
allOk &= cmp("Calmar",             p.calmar,      bp.calmar, 0.05);
allOk &= cmp("HHI",                p.hhi,         bp.hhi);
allOk &= cmp("VaR 95%",            p.var_95,      bp.var_95);
allOk &= cmp("CVaR 95%",           p.cvar_95,     bp.cvar_95);
console.log();
console.log("vs Benchmark:");
allOk &= cmp("Beta",               b.beta,        bb.beta);
allOk &= cmp("Alpha",              b.alpha,       bb.alpha);
allOk &= cmp("Bench CAGR",         b.cagr,        bb.cagr);
allOk &= cmp("Tracking Error",     b.tracking_error, bb.tracking_error);
allOk &= cmp("Information Ratio",  b.information_ratio, bb.information_ratio, 0.05);
allOk &= cmp("Up Capture Daily",   b.up_capture_daily, bb.up_capture_daily, 0.02);

console.log();
console.log("Stress scenarios:");
for (let i = 0; i < baseline.stress.length; i++) {
  const j = summary.stress[i], y = baseline.stress[i];
  cmp(y.scenario, j.pnl_pct, y.pnl_pct);
}

console.log();
console.log("MDD peak/trough:");
console.log("  JS:", p.mdd_peak, "→", p.mdd_trough);
console.log("  PY:", bp.mdd_peak, "→", bp.mdd_trough);

console.log();
console.log("Composition (asset class):");
for (const [k, v] of Object.entries(summary.composition.by_asset_class)) {
  const yv = baseline.composition.by_asset_class[k] ?? 0;
  cmp(k, v, yv, 0.001);
}

// ----- FX conversion smoke test (unit-level, no Python baseline needed) -----
console.log();
console.log("FX conversion (convertPricesToBase):");
{
  const fx = { USD: 1.0, KRW: 0.000724, JPY: 0.00661 };
  const pd = {
    dates: ["2024-01-02", "2024-01-03"],
    tickers: ["AAPL", "005930.KS", "7203.T"],
    prices: {
      "AAPL":       [190.0, 191.5],
      "005930.KS":  [72000, 73500],  // KRW
      "7203.T":     [2800, 2850],    // JPY
    },
  };
  const hd = [
    { ticker: "AAPL", weight: 0.5, currency: "USD" },
    { ticker: "005930.KS", weight: 0.3, currency: "KRW" },
    { ticker: "7203.T", weight: 0.2, currency: "JPY" },
  ];
  const out = api.convertPricesToBase(pd, hd, fx, "USD");
  const expAapl = 190.0;                // unchanged
  const expSam  = 72000 * 0.000724;     // 52.128
  const expToy  = 2800  * 0.00661;      // 18.508
  const delta1 = Math.abs(out.prices["AAPL"][0] - expAapl);
  const delta2 = Math.abs(out.prices["005930.KS"][0] - expSam);
  const delta3 = Math.abs(out.prices["7203.T"][0] - expToy);
  const fxOk = delta1 < 1e-9 && delta2 < 1e-6 && delta3 < 1e-6
    && pd.prices["005930.KS"][0] === 72000; // input not mutated
  console.log(`  ${delta1 < 1e-9 ? "✓" : "✗"} USD ticker unchanged  (${out.prices["AAPL"][0]} == ${expAapl})`);
  console.log(`  ${delta2 < 1e-6 ? "✓" : "✗"} KRW → USD             (${out.prices["005930.KS"][0].toFixed(4)} == ${expSam.toFixed(4)})`);
  console.log(`  ${delta3 < 1e-6 ? "✓" : "✗"} JPY → USD             (${out.prices["7203.T"][0].toFixed(4)} == ${expToy.toFixed(4)})`);
  console.log(`  ${pd.prices["005930.KS"][0] === 72000 ? "✓" : "✗"} input not mutated`);
  allOk &= fxOk;
}

console.log();
console.log(allOk ? "✓ smoke test PASSED" : "✗ smoke test had failures");
process.exit(allOk ? 0 : 1);
