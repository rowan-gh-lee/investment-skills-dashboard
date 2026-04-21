// Investment Dashboard — client-side analytics engine
// Mirrors the formulas defined in skills/01_analysis_rules.md
// No backend. Pure JS + Plotly + PapaParse.

const TRADING_DAYS = 252;
const DEFAULT_RF = 0.035;

// ---------- utility helpers ----------
const qs = (s, el = document) => el.querySelector(s);
const fmtPct = (x, d = 2, sign = true) =>
  (x == null || Number.isNaN(x)) ? "–" : `${sign && x > 0 ? "+" : ""}${(x * 100).toFixed(d)}%`;
const fmtRatio = x => (x == null || Number.isNaN(x)) ? "–" : x.toFixed(2);
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const std = (a, ddof = 1) => {
  if (a.length <= ddof) return NaN;
  const m = mean(a);
  const v = a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - ddof);
  return Math.sqrt(v);
};
const cov = (a, b) => {
  const ma = mean(a), mb = mean(b);
  return a.reduce((s, x, i) => s + (x - ma) * (b[i] - mb), 0) / (a.length - 1);
};
const variance = a => {
  const m = mean(a);
  return a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1);
};
const quantile = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  const idx = (s.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return s[lo];
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
};

// ---------- CSV / Excel ingestion ----------
async function parseCSV(text) {
  return new Promise(resolve => {
    Papa.parse(text, {
      header: true, skipEmptyLines: true, dynamicTyping: true,
      complete: res => resolve(res.data),
    });
  });
}

// Parse Excel (.xlsx/.xls) via SheetJS. Returns array of records from the first sheet.
async function parseExcel(file) {
  if (typeof XLSX === "undefined") throw new Error("SheetJS 라이브러리가 로드되지 않았습니다.");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { raw: true, defval: null });
  // Normalize Date cells → ISO string
  return rows.map(r => {
    const o = {};
    for (const k of Object.keys(r)) {
      const v = r[k];
      if (v instanceof Date) o[k] = v.toISOString().slice(0, 10);
      else o[k] = v;
    }
    return o;
  });
}

// File-type-aware price parser
async function parsePriceFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    return toWidePrices(await parseExcel(file));
  }
  const text = await file.text();
  if (name.endsWith(".json")) {
    // JSON nested: { TICKER: [{date, close}, ...] } → flatten to long rows
    const obj = JSON.parse(text);
    const rows = [];
    for (const [t, arr] of Object.entries(obj)) {
      for (const r of arr) rows.push({ date: r.date, ticker: t, close: r.close });
    }
    return toWidePrices(rows);
  }
  return toWidePrices(await parseCSV(text));
}

async function parseHoldingsFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    return parseHoldings(await parseExcel(file), true);
  }
  const text = await file.text();
  const isCSV = name.endsWith(".csv");
  return parseHoldings(isCSV ? await parseCSV(text) : text, isCSV);
}

// Convert ticker price columns from their local currency to a base currency.
// `priceData`  : { dates, tickers, prices: {ticker: number[]} }
// `holdings`   : [{ticker, currency, ...}]
// `fxRates`    : { CCY: rate_to_base, base: 1.0 }
// `base`       : 3-letter currency code (default "USD")
// Returns a NEW priceData; input is not mutated. Tickers whose currency equals base
// (or is missing) are copied through unchanged. Missing FX rates are left unscaled
// with a console warning.
function convertPricesToBase(priceData, holdings, fxRates, base = "USD") {
  if (!priceData || !holdings || !fxRates) return priceData;
  const ccyMap = Object.fromEntries(holdings.map(h => [h.ticker, (h.currency || base).toUpperCase()]));
  const missing = new Set();
  const out = { dates: priceData.dates.slice(), tickers: priceData.tickers.slice(), prices: {} };
  for (const t of priceData.tickers) {
    const ccy = ccyMap[t] || base;
    if (ccy === base) { out.prices[t] = priceData.prices[t].slice(); continue; }
    const rate = fxRates[ccy];
    if (rate == null) { missing.add(ccy); out.prices[t] = priceData.prices[t].slice(); continue; }
    out.prices[t] = priceData.prices[t].map(v => v == null ? null : v * rate);
  }
  if (missing.size) console.warn("[fx] missing rates for", [...missing], "— columns unscaled");
  return out;
}

// Slice priceData to [fromISO, toISO] (inclusive). Empty strings mean no bound.
function slicePriceData(pd, fromISO, toISO) {
  if (!fromISO && !toISO) return pd;
  const keepIdx = [];
  for (let i = 0; i < pd.dates.length; i++) {
    const d = pd.dates[i];
    if (fromISO && d < fromISO) continue;
    if (toISO && d > toISO) continue;
    keepIdx.push(i);
  }
  if (keepIdx.length < 2) throw new Error("선택한 기간에 데이터가 부족합니다 (최소 2일 필요)");
  const dates = keepIdx.map(i => pd.dates[i]);
  const prices = {};
  for (const t of pd.tickers) prices[t] = keepIdx.map(i => pd.prices[t][i]);
  return { dates, tickers: pd.tickers, prices };
}

function detectDateColumn(row0) {
  const keys = Object.keys(row0);
  for (const k of keys) {
    if (["date", "날짜", "기준일", "Date", "trade_date"].includes(k)) return k;
  }
  return keys[0];
}

function toWidePrices(rows) {
  if (!rows.length) throw new Error("가격 CSV가 비어 있습니다");
  const cols = Object.keys(rows[0]);
  // Detect long vs wide
  const lower = cols.map(c => c.toLowerCase());
  const hasTickerCol = lower.includes("ticker") && lower.includes("close") && lower.includes("date");
  const dateCol = detectDateColumn(rows[0]);

  let dates = [], tickers = [], data = {};
  if (hasTickerCol) {
    // Long → pivot
    const tickerCol = cols[lower.indexOf("ticker")];
    const closeCol = cols[lower.indexOf("close")];
    const dateKey = cols[lower.indexOf("date")];
    for (const r of rows) {
      const d = String(r[dateKey]).slice(0, 10);
      const t = String(r[tickerCol]);
      const p = Number(r[closeCol]);
      if (!data[t]) data[t] = {};
      data[t][d] = p;
    }
    tickers = Object.keys(data);
    dates = [...new Set(rows.map(r => String(r[dateKey]).slice(0, 10)))].sort();
  } else {
    // Wide
    for (const r of rows) dates.push(String(r[dateCol]).slice(0, 10));
    tickers = cols.filter(c => c !== dateCol);
    tickers.forEach(t => data[t] = {});
    for (const r of rows) {
      const d = String(r[dateCol]).slice(0, 10);
      for (const t of tickers) {
        const v = Number(r[t]);
        data[t][d] = Number.isFinite(v) && v > 0 ? v : null;
      }
    }
  }

  // Forward-fill limit 5 per ticker
  const ffilled = {};
  for (const t of tickers) {
    const arr = dates.map(d => data[t][d] ?? null);
    const out = new Array(arr.length).fill(null);
    let lastValid = null, gap = 0;
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] != null) { out[i] = arr[i]; lastValid = arr[i]; gap = 0; }
      else if (lastValid != null && gap < 5) { out[i] = lastValid; gap += 1; }
      else { out[i] = null; }
    }
    ffilled[t] = out;
  }
  // Drop leading all-null rows
  let startIdx = 0;
  for (; startIdx < dates.length; startIdx++) {
    if (tickers.some(t => ffilled[t][startIdx] != null)) break;
  }
  dates = dates.slice(startIdx);
  for (const t of tickers) ffilled[t] = ffilled[t].slice(startIdx);

  return { dates, tickers, prices: ffilled };
}

function parseHoldings(jsonOrCsv, isCSV) {
  let records;
  if (isCSV) {
    // expect CSV with header row
    records = jsonOrCsv;
  } else {
    records = typeof jsonOrCsv === "string" ? JSON.parse(jsonOrCsv) : jsonOrCsv;
  }
  if (!Array.isArray(records)) throw new Error("holdings는 배열(JSON) 또는 CSV 여야 합니다");
  // Normalize columns
  records = records.map(r => ({
    ticker: String(r.ticker),
    name: r.name ?? "",
    sector: r.sector ?? "Unknown",
    asset_class: r.asset_class ?? "Equity",
    region: r.region ?? "Unknown",
    weight: Number(r.weight),
    currency: r.currency ?? "USD",
  }));
  // Renormalize
  const tot = records.reduce((s, x) => s + x.weight, 0);
  if (Math.abs(tot - 1.0) > 0.005) {
    console.warn(`holdings weight sum = ${tot}. renormalizing.`);
    records.forEach(r => r.weight = r.weight / tot);
  }
  return records;
}

// ---------- Returns & KPIs ----------
function logReturns(series) {
  const out = new Array(series.length - 1);
  for (let i = 1; i < series.length; i++) {
    const a = series[i], b = series[i - 1];
    out[i - 1] = (a != null && b != null && b > 0) ? Math.log(a / b) : null;
  }
  return out;
}

function portfolioReturns(prices, dates, holdings) {
  const usable = holdings.filter(h => prices[h.ticker]);
  const wsum = usable.reduce((s, h) => s + h.weight, 0);
  const weights = usable.map(h => h.weight / wsum);
  const tickerRets = usable.map(h => logReturns(prices[h.ticker]));
  const n = dates.length - 1;
  const dates1 = dates.slice(1);
  const port = new Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0, ok = true;
    for (let j = 0; j < tickerRets.length; j++) {
      const r = tickerRets[j][i];
      if (r == null || !Number.isFinite(r)) { ok = false; break; }
      s += weights[j] * r;
    }
    port[i] = ok ? s : null;
  }
  return { dates: dates1, rets: port };
}

function cumulative(rets) {
  const out = new Array(rets.length);
  let s = 0;
  for (let i = 0; i < rets.length; i++) {
    if (rets[i] != null) s += rets[i];
    out[i] = Math.exp(s);
  }
  return out;
}

function dropNulls(rets) { return rets.filter(x => x != null && Number.isFinite(x)); }

function cagrFromCum(dates, cum) {
  const start = new Date(dates[0]), end = new Date(dates[dates.length - 1]);
  const years = (end - start) / (365.25 * 86400000);
  if (years <= 0) return NaN;
  return Math.pow(cum[cum.length - 1] / cum[0], 1 / years) - 1;
}

function annualVol(rets) { return std(dropNulls(rets)) * Math.sqrt(TRADING_DAYS); }

function sharpeOf(rets, rf = DEFAULT_RF) {
  const r = dropNulls(rets);
  const vol = std(r) * Math.sqrt(TRADING_DAYS);
  if (!vol) return NaN;
  return (mean(r) * TRADING_DAYS - rf) / vol;
}

function sortinoOf(rets, rf = DEFAULT_RF) {
  const r = dropNulls(rets);
  const down = r.filter(x => x < 0);
  const vol = std(down) * Math.sqrt(TRADING_DAYS);
  if (!vol) return NaN;
  return (mean(r) * TRADING_DAYS - rf) / vol;
}

function maxDrawdown(dates, cum) {
  let peak = -Infinity, peakIdx = 0, troughIdx = 0, mdd = 0;
  let curPeak = -Infinity, curPeakIdx = 0;
  for (let i = 0; i < cum.length; i++) {
    if (cum[i] > curPeak) { curPeak = cum[i]; curPeakIdx = i; }
    const dd = cum[i] / curPeak - 1;
    if (dd < mdd) { mdd = dd; peakIdx = curPeakIdx; troughIdx = i; }
  }
  return { mdd, peak: dates[peakIdx], trough: dates[troughIdx], peakIdx, troughIdx };
}

function betaAlpha(port, bench, rf = DEFAULT_RF) {
  const p = [], b = [];
  for (let i = 0; i < port.length; i++) {
    if (port[i] != null && bench[i] != null) { p.push(port[i]); b.push(bench[i]); }
  }
  const vb = variance(b);
  const beta = vb ? cov(p, b) / vb : NaN;
  const annP = mean(p) * TRADING_DAYS;
  const annB = mean(b) * TRADING_DAYS;
  const alpha = annP - (rf + beta * (annB - rf));
  return { beta, alpha };
}

function hhiOf(weights) {
  const s = weights.reduce((a, b) => a + b, 0);
  return weights.reduce((a, w) => a + (w / s) ** 2, 0);
}

function valueAtRisk(rets, alpha = 0.05) {
  return -quantile(dropNulls(rets), alpha);
}

function conditionalVar(rets, alpha = 0.05) {
  const r = dropNulls(rets);
  const thr = quantile(r, alpha);
  const tail = r.filter(x => x <= thr);
  return -mean(tail);
}

function rollingMean(arr, w) {
  const out = new Array(arr.length).fill(NaN);
  let sum = 0, count = 0;
  const buf = [];
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    buf.push(v);
    if (v != null && Number.isFinite(v)) { sum += v; count++; }
    if (buf.length > w) {
      const old = buf.shift();
      if (old != null && Number.isFinite(old)) { sum -= old; count--; }
    }
    if (buf.length === w && count === w) out[i] = sum / w;
  }
  return out;
}

function rollingStd(arr, w) {
  const out = new Array(arr.length).fill(NaN);
  for (let i = w - 1; i < arr.length; i++) {
    const seg = arr.slice(i - w + 1, i + 1).filter(x => x != null && Number.isFinite(x));
    if (seg.length === w) out[i] = std(seg);
  }
  return out;
}

function rollingBetaArr(port, bench, w) {
  const out = new Array(port.length).fill(NaN);
  for (let i = w - 1; i < port.length; i++) {
    const p = [], b = [];
    for (let k = i - w + 1; k <= i; k++) {
      if (port[k] != null && bench[k] != null) { p.push(port[k]); b.push(bench[k]); }
    }
    if (p.length === w) {
      const v = variance(b);
      out[i] = v ? cov(p, b) / v : NaN;
    }
  }
  return out;
}

// ---------- Stress scenarios (mirror 01_analysis_rules.md) ----------
const STRESS = {
  "2008 GFC (1일 최악)": { Equity: -0.09, REIT: -0.12, Bond: +0.01, Commodity: 0.0 },
  "COVID-19 쇼크 (2020-03-16)": { Equity: -0.12, REIT: -0.17, Bond: -0.02, Commodity: -0.05 },
  "테크 디레이팅 (금리 +100bp)": {
    IT: -0.06, Communication: -0.05, Consumer: -0.03,
    Financial: +0.02, Energy: +0.01, Bond: -0.03, REIT: -0.04, Equity: -0.03, Commodity: 0.0
  },
  "달러 초강세 (DXY +5%)": { Equity: -0.02, Commodity: -0.04, Bond: -0.01, REIT: -0.01 },
  "에너지 쇼크 (유가 +30%)": {
    Energy: +0.08, Consumer: -0.03, IT: -0.02, Commodity: +0.04, Bond: -0.01, Equity: -0.02
  },
};

function stressTest(holdings) {
  return Object.entries(STRESS).map(([name, shocks]) => {
    let pnl = 0;
    const bySector = {};
    for (const h of holdings) {
      let sh = shocks[h.sector];
      if (sh === undefined) sh = shocks[h.asset_class];
      if (sh === undefined) sh = h.asset_class === "Equity" ? (shocks.Equity ?? 0) : 0;
      const c = h.weight * sh;
      pnl += c;
      bySector[h.sector] = (bySector[h.sector] ?? 0) + c;
    }
    return { scenario: name, pnl_pct: pnl, by_sector: bySector };
  });
}

// ---------- Top-level compute ----------
function computeAll(priceData, holdings, benchmark = "SPY", rf = DEFAULT_RF) {
  const { dates, tickers, prices } = priceData;
  const { dates: rDates, rets: pRet } = portfolioReturns(prices, dates, holdings);
  const pCum = cumulative(pRet);
  const md = maxDrawdown(rDates, pCum);

  let vsBench = null;
  let bRet = null, bCum = null, bDates = null;
  if (prices[benchmark]) {
    bRet = logReturns(prices[benchmark]).slice();
    bDates = dates.slice(1);
    // align to rDates length
    bRet = bRet.slice(0, rDates.length);
    bCum = cumulative(bRet);
    const { beta, alpha } = betaAlpha(pRet, bRet, rf);
    const diffs = pRet.map((x, i) => (x != null && bRet[i] != null) ? (x - bRet[i]) : null);
    const diffsClean = dropNulls(diffs);
    const tErr = std(diffsClean) * Math.sqrt(TRADING_DAYS);
    const cagrP = cagrFromCum(rDates, pCum);
    const cagrB = cagrFromCum(rDates, bCum);
    const ir = tErr ? (cagrP - cagrB) / tErr : NaN;
    const up = pRet.reduce((s, x, i) => s + ((x != null && bRet[i] != null && x > bRet[i]) ? 1 : 0), 0) /
               pRet.filter((x, i) => x != null && bRet[i] != null).length;
    vsBench = {
      ticker: benchmark,
      beta, alpha,
      cagr: cagrB,
      ann_vol: annualVol(bRet),
      mdd: maxDrawdown(rDates, bCum).mdd,
      tracking_error: tErr,
      information_ratio: ir,
      up_capture_daily: up,
    };
  }

  const portfolio = {
    cagr: cagrFromCum(rDates, pCum),
    total_return: pCum[pCum.length - 1] - 1,
    ann_vol: annualVol(pRet),
    sharpe: sharpeOf(pRet, rf),
    sortino: sortinoOf(pRet, rf),
    mdd: md.mdd, mdd_peak: md.peak, mdd_trough: md.trough,
    calmar: cagrFromCum(rDates, pCum) / Math.abs(md.mdd || 1),
    hhi: hhiOf(holdings.map(h => h.weight)),
    var_95: valueAtRisk(pRet, 0.05),
    cvar_95: conditionalVar(pRet, 0.05),
  };

  // Composition
  const bySector = {}, byAsset = {}, byRegion = {};
  for (const h of holdings) {
    bySector[h.sector] = (bySector[h.sector] ?? 0) + h.weight;
    byAsset[h.asset_class] = (byAsset[h.asset_class] ?? 0) + h.weight;
    byRegion[h.region] = (byRegion[h.region] ?? 0) + h.weight;
  }

  return {
    period: { start: rDates[0], end: rDates[rDates.length - 1], trading_days: rDates.length },
    portfolio,
    vs_benchmark: vsBench,
    stress: stressTest(holdings),
    composition: {
      by_sector: bySector, by_asset_class: byAsset, by_region: byRegion,
      n_positions: holdings.length,
    },
    _arrays: { rDates, pRet, pCum, bRet, bCum },
  };
}

// ---------- Insight generation (mirror 04_insight_generation.md) ----------
function buildInsights(summary, holdings, benchmark) {
  const p = summary.portfolio, b = summary.vs_benchmark;
  const out = [];
  if (b) {
    const diff = p.cagr - b.cagr;
    const dir = diff >= 0 ? "상회" : "하회";
    out.push(`<b>성과</b> — CAGR ${fmtPct(p.cagr)} 로 벤치마크 ${benchmark} (${fmtPct(b.cagr)}) 대비 ${(Math.abs(diff) * 100).toFixed(2)}%p ${dir}. β ${fmtRatio(b.beta)} · α ${fmtPct(b.alpha)} · IR ${fmtRatio(b.information_ratio)}.`);
  } else {
    out.push(`<b>성과</b> — CAGR ${fmtPct(p.cagr)} · 연환산 변동성 ${fmtPct(p.ann_vol, 2, false)}.`);
  }
  out.push(`<b>리스크</b> — MDD ${fmtPct(p.mdd)} (${p.mdd_peak} → ${p.mdd_trough}) · Calmar ${fmtRatio(p.calmar)} · Sharpe ${fmtRatio(p.sharpe)} / Sortino ${fmtRatio(p.sortino)} · VaR95 ${(p.var_95 * 100).toFixed(2)}% / CVaR95 ${(p.cvar_95 * 100).toFixed(2)}%.`);

  const top = [...holdings].sort((a, b) => b.weight - a.weight)[0];
  const sectorAgg = summary.composition.by_sector;
  const topSector = Object.entries(sectorAgg).sort((a, b) => b[1] - a[1])[0];
  out.push(`<b>구성</b> — HHI ${p.hhi.toFixed(3)} · 최대 비중 ${top.ticker} (${(top.weight * 100).toFixed(1)}%) · 1위 섹터 ${topSector[0]} ${(topSector[1] * 100).toFixed(1)}%.`);

  if (summary.stress?.length) {
    const worst = summary.stress.reduce((w, s) => s.pnl_pct < w.pnl_pct ? s : w, summary.stress[0]);
    out.push(`<b>스트레스 최악</b> — '${worst.scenario}' 적용 시 1일 포트 ${fmtPct(worst.pnl_pct)}. 대비 자산(금/국채/현금) 비중 점검.`);
  }

  // Flags
  if (p.mdd < -0.20) out.push("<b>주의</b> — MDD 20% 초과. 꼬리위험 헤지 또는 현금비중 재검토 권장.");
  if (p.sharpe != null && !Number.isNaN(p.sharpe) && p.sharpe < 0.5) out.push("<b>주의</b> — Sharpe 0.5 미만. 위험 대비 수익 효율이 낮음. 종목/섹터 선택 재검토.");
  if (p.hhi > 0.15) out.push("<b>주의</b> — HHI 0.15 초과. 상위 몇 종목이 전체 리스크를 좌우하는 구조.");
  if (b && p.ann_vol > 1.3 * b.ann_vol) out.push("<b>주의</b> — 포트 변동성이 벤치 대비 30% 이상. 저베타 자산 편입 검토.");
  if (b && b.up_capture_daily < 0.45) out.push("<b>주의</b> — 일간 상승 포착률 45% 미만. 벤치 대비 강세장에서 뒤처짐.");
  // Mixed-currency check (from 02_data_schema.md)
  const currs = [...new Set(holdings.map(h => h.currency).filter(Boolean))];
  if (currs.length > 1) {
    out.push(`<b>주의</b> — 통화 혼재(${currs.join(", ")}). 기준통화(USD) 환산 전제 사용 중. 정확한 KPI 산출 위해 FX 환율 오버라이드 권장.`);
  }

  // Actions
  const actions = [];
  if (p.mdd < -0.20) actions.push("<b>제안</b> — 하방 헤지: 풋옵션 혹은 역상관 자산(미국채/금) 5~10% 편입.");
  if (p.hhi > 0.15) actions.push("<b>제안</b> — 집중도 완화: 상위 2개 종목 비중 각 2%p 하향 → 동종 ETF로 대체.");
  if (b && p.ann_vol > 1.3 * b.ann_vol) actions.push("<b>제안</b> — 변동성 축소: 필수소비재/헬스케어 저베타 섹터 가점.");
  if (!actions.length) actions.push("<b>제안</b> — 현 구성 유지: 지표가 균형 범위. 분기 리밸런싱(±2%p 이탈 시)만 유지.");
  out.push(...actions);
  return out;
}

// ---------- Plotly figure factories ----------
const COL_PORT = "#2E86AB", COL_BENCH = "#E63946", COL_POS = "#2A9D8F",
      COL_NEG = "#E76F51", COL_ACCENT = "#F4A261", COL_NEUTRAL = "#6C757D";
const FONT = "Pretendard Variable, Pretendard, -apple-system, 'Noto Sans KR', sans-serif";

// Theme-aware color palette — re-evaluated at render time so charts update when user toggles dark.
function themeColors() {
  const dark = document.documentElement.dataset.theme === "dark";
  return dark ? {
    ink: "#e6edf7", muted: "#8ea0b5", grid: "#2a3a5a",
    titleFill: "#e6edf7", zeroline: "#5b6c86",
    annBg: "#141f36", annBorder: "#2a3a5a",
    selectorBg: "#1a2744", sliderBg: "#0b1220",
  } : {
    ink: "#0f172a", muted: "#64748b", grid: "#eef2f6",
    titleFill: "#0f172a", zeroline: "#9aa6b2",
    annBg: "#ffffff", annBorder: "#d7dde6",
    selectorBg: "#f4f6fb", sliderBg: "#f4f6fb",
  };
}

const baseLayout = (title, h = 360) => {
  const c = themeColors();
  return {
    title: { text: title, x: 0.01, xanchor: "left", font: { size: 14, color: c.titleFill } },
    margin: { l: 64, r: 24, t: 48, b: 44 },
    height: h,
    font: { family: FONT, size: 12, color: c.ink },
    plot_bgcolor: "rgba(0,0,0,0)", paper_bgcolor: "rgba(0,0,0,0)",
    hovermode: "x unified",
    legend: { orientation: "h", yanchor: "bottom", y: 1.04, xanchor: "right", x: 1,
              bgcolor: "rgba(0,0,0,0)", font: { color: c.ink } },
    _c: c, // attach for downstream consumers
  };
};

function drawCumulative(el, summary, benchmark) {
  const { rDates, pCum, bCum } = summary._arrays;
  const traces = [{
    x: rDates, y: pCum.map(v => (v - 1) * 100), name: "포트폴리오", mode: "lines",
    line: { color: COL_PORT, width: 2.6 },
    hovertemplate: "%{x|%Y-%m-%d}<br>누적수익률 %{y:.2f}%<extra></extra>",
  }];
  if (bCum) traces.push({
    x: rDates, y: bCum.map(v => (v - 1) * 100), name: benchmark, mode: "lines",
    line: { color: COL_BENCH, width: 1.8, dash: "dot" },
    hovertemplate: `%{x|%Y-%m-%d}<br>${benchmark} %{y:.2f}%<extra></extra>`,
  });
  // Card's <h3> already provides the title — suppress chart title to avoid overlap with rangeselector
  const lay = baseLayout("");
  lay.margin = { l: 60, r: 24, t: 56, b: 40 };
  lay.xaxis = { showgrid: true, gridcolor: lay._c.grid,
                rangeselector: {
                  buttons: [
                    { count: 3, label: "3M", step: "month", stepmode: "backward" },
                    { count: 6, label: "6M", step: "month", stepmode: "backward" },
                    { count: 1, label: "1Y", step: "year", stepmode: "backward" },
                    { count: 3, label: "3Y", step: "year", stepmode: "backward" },
                    { step: "all", label: "전체" },
                  ],
                  bgcolor: lay._c.selectorBg, activecolor: "#2E86AB",
                  font: { size: 11, color: lay._c.ink }, y: 1.12, x: 0,
                },
                rangeslider: { visible: true, thickness: 0.05, bgcolor: lay._c.sliderBg } };
  lay.yaxis = { title: { text: "누적 수익률", font: { size: 11, color: lay._c.muted } },
                showgrid: true, gridcolor: lay._c.grid, ticksuffix: "%", automargin: true };
  // Position legend below the rangeselector row to prevent overlap
  lay.legend = { ...lay.legend, y: 1.18 };
  // MDD peak → trough annotation
  const p = summary.portfolio;
  if (p.mdd_peak && p.mdd_trough) {
    const peakIdx = rDates.indexOf(p.mdd_peak);
    const troughIdx = rDates.indexOf(p.mdd_trough);
    const peakY = peakIdx >= 0 ? (pCum[peakIdx] - 1) * 100 : 0;
    const troughY = troughIdx >= 0 ? (pCum[troughIdx] - 1) * 100 : 0;
    lay.shapes = [
      { type: "line", x0: p.mdd_peak, x1: p.mdd_peak, y0: 0, y1: 1, yref: "paper",
        line: { color: COL_NEG, dash: "dot", width: 1 } },
      { type: "line", x0: p.mdd_trough, x1: p.mdd_trough, y0: 0, y1: 1, yref: "paper",
        line: { color: COL_NEG, dash: "dot", width: 1 } },
      { type: "rect", x0: p.mdd_peak, x1: p.mdd_trough, y0: 0, y1: 1, yref: "paper",
        fillcolor: "rgba(231,111,81,0.08)", line: { width: 0 } },
    ];
    lay.annotations = [
      { x: p.mdd_peak, y: peakY, text: `MDD 시작<br>${p.mdd_peak}`, showarrow: true,
        arrowhead: 2, arrowcolor: COL_NEG, ax: -40, ay: -30,
        font: { size: 10, color: COL_NEG }, bgcolor: lay._c.annBg, bordercolor: COL_NEG, borderwidth: 1 },
      { x: p.mdd_trough, y: troughY, text: `MDD ${(p.mdd * 100).toFixed(1)}%<br>${p.mdd_trough}`, showarrow: true,
        arrowhead: 2, arrowcolor: COL_NEG, ax: 40, ay: 30,
        font: { size: 10, color: COL_NEG }, bgcolor: lay._c.annBg, bordercolor: COL_NEG, borderwidth: 1 },
    ];
  }
  Plotly.react(el, traces, lay, plotConfig());
}

function drawMonthlyHeatmap(el, summary) {
  const { rDates, pRet } = summary._arrays;
  const byMonth = {};
  for (let i = 0; i < rDates.length; i++) {
    const d = new Date(rDates[i]); const y = d.getFullYear(), m = d.getMonth() + 1;
    const k = `${y}-${m}`;
    if (!byMonth[k]) byMonth[k] = 0;
    if (pRet[i] != null) byMonth[k] += pRet[i];
  }
  const years = [...new Set(Object.keys(byMonth).map(k => +k.split("-")[0]))].sort();
  const z = years.map(y => Array.from({ length: 12 }, (_, m) => {
    const r = byMonth[`${y}-${m + 1}`];
    return r === undefined ? null : (Math.exp(r) - 1) * 100;
  }));
  const text = z.map(row => row.map(v => v == null ? "" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`));
  const lay = baseLayout("월별 수익률 히트맵");
  Plotly.react(el, [{
    type: "heatmap", z, x: ["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"],
    y: years.map(String),
    colorscale: [[0, COL_NEG], [0.5, lay._c.annBg === "#ffffff" ? "#FFFFFF" : "#14213d"], [1, COL_POS]], zmid: 0,
    text, texttemplate: "%{text}",
    hovertemplate: "%{y}년 %{x}<br>월수익률 %{z:.2f}%<extra></extra>",
    colorbar: { title: "%", thickness: 10 },
  }], lay, plotConfig());
}

function drawUnderwater(el, summary, benchmark) {
  const { rDates, pCum, bCum } = summary._arrays;
  const ddArr = (cum) => {
    let peak = -Infinity;
    return cum.map(v => { peak = Math.max(peak, v); return (v / peak - 1) * 100; });
  };
  const tP = { x: rDates, y: ddArr(pCum), name: "포트", mode: "lines",
               line: { color: COL_PORT, width: 1.6 }, fill: "tozeroy",
               fillcolor: "rgba(46,134,171,0.18)",
               hovertemplate: "%{x|%Y-%m-%d}<br>포트 DD %{y:.2f}%<extra></extra>" };
  const traces = [tP];
  if (bCum) traces.push({ x: rDates, y: ddArr(bCum), name: benchmark, mode: "lines",
                          line: { color: COL_BENCH, width: 1.4, dash: "dot" },
                          hovertemplate: `%{x|%Y-%m-%d}<br>${benchmark} DD %{y:.2f}%<extra></extra>` });
  const lay = baseLayout("포트 vs 벤치 Underwater Curve");
  lay.xaxis = { showgrid: true, gridcolor: lay._c.grid };
  lay.yaxis = { showgrid: true, gridcolor: lay._c.grid, ticksuffix: "%" };
  Plotly.react(el, traces, lay, plotConfig());
}

function drawDistribution(el, summary) {
  const { pRet } = summary._arrays;
  const pct = dropNulls(pRet).map(x => x * 100);
  const var95 = -summary.portfolio.var_95 * 100;
  const cvar95 = -summary.portfolio.cvar_95 * 100;
  const m = mean(pct);
  const lay = baseLayout("일간 수익률 분포 · VaR/CVaR");
  lay.xaxis = { ticksuffix: "%", showgrid: true, gridcolor: lay._c.grid };
  lay.yaxis = { showgrid: true, gridcolor: lay._c.grid };
  lay.shapes = [
    { type: "line", x0: m, x1: m, y0: 0, y1: 1, yref: "paper",
      line: { color: COL_ACCENT, dash: "dash" } },
    { type: "line", x0: var95, x1: var95, y0: 0, y1: 1, yref: "paper",
      line: { color: COL_NEG, dash: "dot" } },
    { type: "line", x0: cvar95, x1: cvar95, y0: 0, y1: 1, yref: "paper",
      line: { color: "#7b1d1d" } },
  ];
  const isDark = lay._c.ink !== "#0f172a";
  lay.annotations = [
    { x: m, y: 1, yref: "paper", text: `평균 ${m.toFixed(2)}%`, showarrow: false, yshift: 10,
      font: { color: lay._c.ink } },
    { x: var95, y: 0.08, yref: "paper", text: `VaR 95% ${var95.toFixed(2)}%`, showarrow: false,
      bgcolor: isDark ? "rgba(231,111,81,0.22)" : "#ffe6e0", font: { color: lay._c.ink } },
    { x: cvar95, y: 0.18, yref: "paper", text: `CVaR 95% ${cvar95.toFixed(2)}%`, showarrow: false,
      bgcolor: isDark ? "rgba(190,60,60,0.28)" : "#ffd8cc", font: { color: lay._c.ink } },
  ];
  Plotly.react(el, [{
    type: "histogram", x: pct, nbinsx: 50,
    marker: { color: COL_PORT, line: { color: lay._c.annBg, width: 0.5 } },
    hovertemplate: "구간 %{x:.2f}%<br>빈도 %{y}<extra></extra>",
    name: "일간수익률",
  }], lay, plotConfig());
}

function drawRollingSB(el, summary, benchmark) {
  const { rDates, pRet, bRet } = summary._arrays;
  const w = 63;
  const ma = rollingMean(pRet, w).map(v => Number.isFinite(v) ? v * TRADING_DAYS : NaN);
  const sd = rollingStd(pRet, w).map(v => Number.isFinite(v) ? v * Math.sqrt(TRADING_DAYS) : NaN);
  const sh = ma.map((v, i) => (Number.isFinite(v) && sd[i]) ? (v - DEFAULT_RF) / sd[i] : null);
  const traces = [{
    x: rDates, y: sh, mode: "lines", name: `Rolling Sharpe (${w}d)`,
    line: { color: COL_PORT, width: 2 },
    hovertemplate: "%{x|%Y-%m-%d}<br>Sharpe %{y:.2f}<extra></extra>",
  }];
  if (bRet) {
    const rb = rollingBetaArr(pRet, bRet, w);
    traces.push({
      x: rDates, y: rb, mode: "lines", name: `Rolling Beta (${w}d)`,
      yaxis: "y2", line: { color: COL_BENCH, width: 2, dash: "dot" },
      hovertemplate: "%{x|%Y-%m-%d}<br>Beta %{y:.2f}<extra></extra>",
    });
  }
  const lay = baseLayout(`롤링 Sharpe & Beta (${w}일)`);
  lay.margin = { l: 60, r: 60, t: 44, b: 40 };
  lay.yaxis = {
    title: { text: "Sharpe", font: { size: 11, color: lay._c.muted } },
    showgrid: true, gridcolor: lay._c.grid, automargin: true,
  };
  lay.yaxis2 = {
    title: { text: "Beta", font: { size: 11, color: lay._c.muted } },
    overlaying: "y", side: "right", showgrid: false, automargin: true,
  };
  lay.xaxis = { showgrid: true, gridcolor: lay._c.grid };
  lay.shapes = [{ type: "line", x0: rDates[0], x1: rDates[rDates.length-1], y0:0, y1:0,
                  line: { color: lay._c.zeroline, dash: "dash" } }];
  Plotly.react(el, traces, lay, plotConfig());
}

function drawRollingVol(el, summary) {
  const { rDates, pRet } = summary._arrays;
  const w = 60;
  const sd = rollingStd(pRet, w).map(v => Number.isFinite(v) ? v * Math.sqrt(TRADING_DAYS) * 100 : NaN);
  const lay = baseLayout(`${w}일 이동 연환산 변동성`);
  lay.xaxis = { showgrid: true, gridcolor: lay._c.grid };
  lay.yaxis = { ticksuffix: "%", showgrid: true, gridcolor: lay._c.grid };
  Plotly.react(el, [{
    x: rDates, y: sd, mode: "lines", name: `${w}d`,
    line: { color: COL_ACCENT, width: 2 },
    hovertemplate: "%{x|%Y-%m-%d}<br>변동성 %{y:.2f}%<extra></extra>",
  }], lay, plotConfig());
}

function drawStress(el, summary) {
  const st = [...summary.stress].reverse();
  const names = st.map(s => s.scenario);
  const vals = st.map(s => s.pnl_pct * 100);
  const colors = vals.map(v => v >= 0 ? COL_POS : COL_NEG);
  // Widen x-range so outside-positioned %text doesn't crowd the y-axis tick labels.
  // Add 25% headroom on the negative side so "-10.20%" has breathing room.
  const minV = Math.min(0, ...vals), maxV = Math.max(0, ...vals);
  const pad = Math.max(Math.abs(minV), Math.abs(maxV)) * 0.25;
  const lay = baseLayout("스트레스 시나리오별 1일 포트 손익");
  lay.margin = { l: 210, r: 56, t: 44, b: 40 };
  lay.xaxis = {
    ticksuffix: "%", showgrid: true, gridcolor: lay._c.grid,
    zeroline: true, zerolinecolor: lay._c.zeroline,
    range: [minV - pad, maxV + pad],
  };
  lay.yaxis = {
    showgrid: false, automargin: true,
    tickfont: { size: 12, color: lay._c.ink, family: FONT },
  };
  Plotly.react(el, [{
    type: "bar", orientation: "h", x: vals, y: names,
    marker: { color: colors },
    text: vals.map(v => `${v > 0 ? "+" : ""}${v.toFixed(2)}%`), textposition: "outside",
    cliponaxis: false,
    hovertemplate: "<b>%{y}</b><br>포트 손익 %{x:+.2f}%<extra></extra>",
  }], lay, plotConfig());
}

function drawCorrelation(el, priceData, holdings, topN = 8) {
  const topTickers = [...holdings].sort((a, b) => b.weight - a.weight).slice(0, topN)
    .map(h => h.ticker).filter(t => priceData.prices[t]);
  const rets = topTickers.map(t => logReturns(priceData.prices[t]));
  const n = rets[0].length;
  // Pearson corr
  const corr = topTickers.map((_, i) => topTickers.map((_, j) => {
    const a = [], b = [];
    for (let k = 0; k < n; k++) {
      if (rets[i][k] != null && rets[j][k] != null) { a.push(rets[i][k]); b.push(rets[j][k]); }
    }
    const va = variance(a), vb = variance(b);
    return (va && vb) ? cov(a, b) / Math.sqrt(va * vb) : 0;
  }));
  const text = corr.map(row => row.map(v => v.toFixed(2)));
  const lay = baseLayout("종목 간 일간수익률 상관관계");
  Plotly.react(el, [{
    type: "heatmap", z: corr, x: topTickers, y: topTickers,
    colorscale: [[0, "#1D3557"], [0.5, lay._c.ink === "#0f172a" ? "#FFFFFF" : "#1a2744"], [1, "#E63946"]], zmid: 0, zmin: -1, zmax: 1,
    text, texttemplate: "%{text}", textfont: { size: 10 },
    hovertemplate: "%{y} · %{x}<br>상관계수 %{z:.3f}<extra></extra>",
    colorbar: { thickness: 10 },
  }], lay, plotConfig());
}

function drawAssetClassBar(el, summary) {
  const a = Object.entries(summary.composition.by_asset_class).sort((x, y) => x[1] - y[1]);
  const colors = [COL_PORT, COL_ACCENT, COL_NEUTRAL, COL_POS, COL_BENCH];
  const xs = a.map(([_, v]) => v * 100);
  const maxX = Math.max(...xs, 1);
  const lay = baseLayout("자산군 비중");
  lay.margin = { l: 110, r: 56, t: 44, b: 40 };
  lay.xaxis = {
    ticksuffix: "%", showgrid: true, gridcolor: lay._c.grid,
    range: [0, maxX * 1.18],
  };
  lay.yaxis = {
    showgrid: false, automargin: true,
    tickfont: { size: 12, color: lay._c.ink, family: FONT },
  };
  Plotly.react(el, [{
    type: "bar", orientation: "h",
    x: xs, y: a.map(([k]) => k),
    marker: { color: a.map((_, i) => colors[i % colors.length]) },
    text: a.map(([_, v]) => `${(v * 100).toFixed(2)}%`), textposition: "outside",
    cliponaxis: false,
    hovertemplate: "<b>%{y}</b><br>비중 %{x:.2f}%<extra></extra>",
  }], lay, plotConfig());
}

function drawSectorDonut(el, summary) {
  const entries = Object.entries(summary.composition.by_sector)
    .sort((a, b) => b[1] - a[1]);
  const lay = baseLayout("섹터 비중");
  Plotly.react(el, [{
    type: "pie", hole: 0.55,
    labels: entries.map(([k]) => k),
    values: entries.map(([, v]) => v * 100),
    textinfo: "label+percent",
    hovertemplate: "%{label}<br>비중 %{value:.2f}%<extra></extra>",
  }], lay, plotConfig());
}

function drawRegionTreemap(el, holdings) {
  const labels = [], parents = [], values = [], customdata = [];
  labels.push("포트폴리오"); parents.push(""); values.push(0); customdata.push("");
  const regions = [...new Set(holdings.map(h => h.region))];
  for (const r of regions) {
    labels.push(r); parents.push("포트폴리오");
    values.push(holdings.filter(h => h.region === r).reduce((s, h) => s + h.weight, 0) * 100);
    customdata.push("");
  }
  const seenSector = new Set();
  for (const h of holdings) {
    const skey = `${h.region}/${h.sector}`;
    if (!seenSector.has(skey)) {
      seenSector.add(skey);
      labels.push(h.sector + ` (${h.region})`); parents.push(h.region);
      const total = holdings.filter(x => x.region === h.region && x.sector === h.sector)
        .reduce((s, x) => s + x.weight, 0) * 100;
      values.push(total); customdata.push("");
    }
  }
  for (const h of holdings) {
    labels.push(`${h.ticker}`); parents.push(h.sector + ` (${h.region})`);
    values.push(h.weight * 100); customdata.push(h.name);
  }
  const lay = baseLayout("지역 · 섹터 · 종목 Treemap");
  lay.margin = { l: 0, r: 0, t: 44, b: 0 };
  Plotly.react(el, [{
    type: "treemap", labels, parents, values,
    textinfo: "label+value", customdata,
    hovertemplate: "%{label}<br>비중 %{value:.2f}%<br>%{customdata}<extra></extra>",
    marker: { colorscale: "Blues" },
    root: { color: lay._c.ink === "#0f172a" ? "#ffffff" : "#0b1220" },
  }], lay, plotConfig());
}

function drawTopHoldings(el, holdings, n = 10) {
  const sorted = [...holdings].sort((a, b) => a.weight - b.weight).slice(-n);
  const xs = sorted.map(h => h.weight * 100);
  const maxX = Math.max(...xs, 1);
  const lay = baseLayout(`Top ${n} 비중 종목`);
  // Reserve left gutter for ticker labels + padded x-range so outside text doesn't clip
  lay.margin = { l: 90, r: 60, t: 44, b: 40 };
  lay.xaxis = {
    ticksuffix: "%", showgrid: true, gridcolor: lay._c.grid,
    range: [0, maxX * 1.22],
  };
  lay.yaxis = {
    showgrid: false, automargin: true,
    tickfont: { size: 12, color: lay._c.ink, family: FONT },
  };
  Plotly.react(el, [{
    type: "bar", orientation: "h",
    x: xs,
    y: sorted.map(h => h.ticker),                       // short, fully visible
    customdata: sorted.map(h => h.name || ""),          // full name in hover
    marker: { color: COL_PORT },
    text: sorted.map(h => `${(h.weight * 100).toFixed(2)}%`), textposition: "outside",
    cliponaxis: false,
    hovertemplate: "<b>%{y}</b> · %{customdata}<br>비중 %{x:.2f}%<extra></extra>",
  }], lay, plotConfig());
}

const plotConfig = () => ({
  displaylogo: false, responsive: true,
  modeBarButtonsToRemove: ["lasso2d", "select2d"],
});

// ---------- KPI cards renderer ----------
// KPI tooltips — definitions sourced verbatim from skills/01_analysis_rules.md (SSOT).
// Each key → { formula, note } pair. Change formulas here ONLY if the Skills.md row changes.
const KPI_DEFS = {
  total_return: { formula: "cum_end − 1", note: "기간 누적 수익률" },
  cagr:         { formula: "(P_end/P_start)^(1/years) − 1", note: "연복리 환산 수익률" },
  ann_vol:      { formula: "std(r_daily, ddof=1) · √252", note: "연환산 변동성" },
  sharpe:       { formula: "(mean(r)·252 − Rf) / σ_a  (Rf=3.5%)", note: "위험조정 초과수익" },
  sortino:      { formula: "(mean(r)·252 − Rf) / σ_downside", note: "하방 변동성 조정" },
  mdd:          { formula: "min(cum / cummax(cum) − 1)", note: "고점 대비 최대 낙폭" },
  calmar:       { formula: "CAGR / |MDD|", note: "수익·낙폭 비율" },
  var_95:       { formula: "−quantile(r, 0.05) (역사적)", note: "95% 신뢰 일간 손실 한계" },
  cvar_95:      { formula: "−mean(r | r ≤ VaR95)", note: "꼬리 조건부 평균 손실" },
  alpha:        { formula: "CAGR_p − (Rf + β · (CAGR_b − Rf))", note: "Jensen α (벤치 대비 초과수익)" },
  beta:         { formula: "Cov(r_p, r_b) / Var(r_b)", note: "벤치 민감도" },
  ir:           { formula: "(CAGR_p − CAGR_b) / TE", note: "Information Ratio" },
  hhi:          { formula: "Σ w_i²  (정규화 가중치)", note: "집중도 · 0에 가까울수록 분산" },
};

function renderKPIs(summary, benchmark, rf = DEFAULT_RF) {
  const p = summary.portfolio, b = summary.vs_benchmark;
  const rfLabel = `${(rf * 100).toFixed(2)}%`;
  const card = (label, value, tone = "neutral", sub = "", kpiKey = null) => {
    const color = { pos: "#2A9D8F", neg: "#E76F51", neutral: "#2E86AB", warn: "#F4A261" }[tone] || "#2E86AB";
    let tipHtml = "";
    if (kpiKey && KPI_DEFS[kpiKey]) {
      const d = KPI_DEFS[kpiKey];
      tipHtml = `<div class="kpi-tooltip"><div><b>공식:</b> <code>${d.formula}</code></div><div>${d.note}</div></div>`;
    }
    return `<div class="kpi-card${kpiKey ? " has-tip" : ""}">
      <div class="kpi-label">${label}${kpiKey ? ' <span class="ti">ⓘ</span>' : ""}</div>
      <div class="kpi-value" style="color:${color}">${value}</div>
      ${sub ? `<div class="kpi-sub">${sub}</div>` : ""}
      ${tipHtml}
    </div>`;
  };
  const cagrTone = p.cagr >= 0 ? "pos" : "neg";
  const sharpeTone = p.sharpe >= 1 ? "pos" : (p.sharpe >= 0.5 ? "warn" : "neg");
  const mddTone = p.mdd < -0.15 ? "neg" : "warn";
  const alphaCard = b ? card("Jensen α vs " + benchmark, fmtPct(b.alpha),
                              (b.alpha > 0 ? "pos" : "neg"),
                              `β ${fmtRatio(b.beta)} · IR ${fmtRatio(b.information_ratio)}`, "alpha")
                      : card("집중도 HHI", p.hhi.toFixed(3), "neutral", "0에 가까울수록 분산", "hhi");
  const cards = [
    card("누적수익률", fmtPct(p.total_return), cagrTone,
         b ? `벤치 ${benchmark}: ${fmtPct((Math.pow(1+b.cagr, ((new Date(summary.period.end) - new Date(summary.period.start))/(365.25*86400000))) - 1))}` : "",
         "total_return"),
    card("연환산 수익률 (CAGR)", fmtPct(p.cagr), cagrTone, b ? `벤치 ${benchmark}: ${fmtPct(b.cagr)}` : "", "cagr"),
    card("연환산 변동성", fmtPct(p.ann_vol, 2, false), "neutral", b ? `벤치 ${benchmark}: ${fmtPct(b.ann_vol, 2, false)}` : "", "ann_vol"),
    card(`Sharpe (Rf=${rfLabel})`, fmtRatio(p.sharpe), sharpeTone, `Sortino ${fmtRatio(p.sortino)}`, "sharpe"),
    card("최대낙폭 (MDD)", fmtPct(p.mdd), mddTone, `${p.mdd_peak} → ${p.mdd_trough}`, "mdd"),
    card("VaR / CVaR 95%", `-${(p.var_95 * 100).toFixed(2)}% / -${(p.cvar_95 * 100).toFixed(2)}%`, "neg", "일간 기준(역사적)", "var_95"),
    alphaCard,
  ];
  qs("#kpi-grid").innerHTML = cards.join("");
}

function renderInsights(insights) {
  qs("#insights ul").innerHTML = insights.map(s => `<li>${s}</li>`).join("");
  qs("#exec-text").innerHTML = insights[0] || "";
}

function renderStressTable(summary) {
  const rows = summary.stress.map(s => {
    const cls = s.pnl_pct < 0 ? "neg" : "pos";
    return `<tr><td>${s.scenario}</td><td class="num ${cls}">${fmtPct(s.pnl_pct)}</td></tr>`;
  }).join("");
  qs("#stress-table tbody").innerHTML = rows;
}

function renderHeader(summary, benchmark, portfolioName) {
  qs("#period").textContent = `${summary.period.start} ~ ${summary.period.end}`;
  qs("#tdays").textContent = summary.period.trading_days;
  qs("#bench").textContent = benchmark;
  qs("#nposition").textContent = `${summary.composition.n_positions}개`;
  qs("#gentime").textContent = new Date().toISOString().slice(0, 16).replace("T", " ");
  const titleEl = qs("#header-title");
  if (titleEl) {
    const base = "Portfolio Performance & Risk Review";
    titleEl.textContent = portfolioName ? `${portfolioName} · ${base}` : base;
  }
  const ac = summary.composition.by_asset_class;
  qs("#ac-pills").innerHTML = Object.entries(ac)
    .map(([k, v]) => `<span class="pill">${k} <b>${(v * 100).toFixed(1)}%</b></span>`)
    .join("");
}

// ---------- Main ----------
async function fetchFxRates() {
  try {
    const r = await fetch("data/fx_rates.json");
    if (!r.ok) return null;
    const data = await r.json();
    const out = {};
    for (const [k, v] of Object.entries(data)) {
      if (k.startsWith("_")) continue;
      out[k] = Number(v);
    }
    return out;
  } catch (_) { return null; }
}

async function fetchSample() {
  const [priceText, holdingsText] = await Promise.all([
    fetch("data/sample_prices.csv").then(r => r.text()),
    fetch("data/sample_holdings.json").then(r => r.text()),
  ]);
  const rows = await parseCSV(priceText);
  const priceData = toWidePrices(rows);
  const holdings = parseHoldings(holdingsText, false);
  return { priceData, holdings };
}

// If holdings contain currencies other than base, try to fetch fx_rates.json and
// convert. Returns { priceData, note } — note is a human-readable message for UI.
async function maybeFxConvert(priceData, holdings, base = "USD") {
  const ccys = [...new Set(holdings.map(h => (h.currency || base).toUpperCase()))];
  const foreign = ccys.filter(c => c !== base);
  if (!foreign.length) return { priceData, note: "" };
  const fxRates = await fetchFxRates();
  if (!fxRates) {
    return { priceData, note: `통화 혼재 (${ccys.join(", ")}) · fx_rates.json 없음 · 로컬 통화 그대로 계산 중` };
  }
  const missing = foreign.filter(c => fxRates[c] == null);
  const converted = convertPricesToBase(priceData, holdings, fxRates, base);
  const note = missing.length
    ? `FX 변환 적용 (기준 ${base}) · 누락 환율: ${missing.join(", ")}`
    : `FX 변환 적용 (기준 ${base}, as_of ${fxRates._as_of || "fx_rates.json"})`;
  return { priceData: converted, note };
}

// Redraws just the Plotly charts — used by the dark-mode toggle so axes/text/grid
// pick up the new theme without recomputing KPIs or insights.
function renderAllCharts(ctx) {
  const { priceData, holdings, benchmark, summary } = ctx;
  drawCumulative(qs("#fig-cumulative"), summary, benchmark);
  drawMonthlyHeatmap(qs("#fig-heatmap"), summary);
  drawUnderwater(qs("#fig-underwater"), summary, benchmark);
  drawDistribution(qs("#fig-distribution"), summary);
  drawRollingSB(qs("#fig-rolling-sb"), summary, benchmark);
  drawRollingVol(qs("#fig-rolling-vol"), summary);
  drawStress(qs("#fig-stress"), summary);
  const topN = parseInt(qs("#corr-topn")?.value || "8", 10);
  drawCorrelation(qs("#fig-correlation"), priceData, holdings, topN);
  drawAssetClassBar(qs("#fig-asset-class"), summary);
  drawSectorDonut(qs("#fig-sector"), summary);
  drawRegionTreemap(qs("#fig-region"), holdings);
  drawTopHoldings(qs("#fig-top-holdings"), holdings);
}

async function render({ priceData, holdings, benchmark, rf, portfolioName }) {
  const rfUsed = rf ?? DEFAULT_RF;
  const summary = computeAll(priceData, holdings, benchmark, rfUsed);
  const insights = buildInsights(summary, holdings, benchmark);

  renderHeader(summary, benchmark, portfolioName);
  renderKPIs(summary, benchmark, rfUsed);
  renderStressTable(summary);
  renderInsights(insights);

  renderAllCharts({ priceData, holdings, benchmark, summary });

  // Save for download + theme-toggle redraw
  window.__lastSummary = summary;
  window.__lastInsights = insights;
  window.__lastState = { priceData, holdings, benchmark, summary };
}

// ---------- Session persistence (localStorage) ----------
const SESSION_KEY = "investment-dashboard-session-v1";
const SESSION_FIELDS = ["benchmark", "rf", "portfolioName", "dateFrom", "dateTo", "topN"];

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return {};
    return JSON.parse(raw) || {};
  } catch (_) { return {}; }
}

function saveSession(state) {
  try {
    const snapshot = {
      benchmark: state.benchmark,
      rf: state.rf,
      portfolioName: state.portfolioName || "",
      dateFrom: qs("#date-from")?.value || "",
      dateTo: qs("#date-to")?.value || "",
      topN: qs("#corr-topn")?.value || "8",
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(snapshot));
  } catch (_) {}
}

function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch (_) {}
}

// ---------- Clipboard helper (with toast feedback) ----------
async function copyToClipboard(text, label = "값") {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", "");
      ta.style.position = "absolute"; ta.style.left = "-9999px";
      document.body.appendChild(ta); ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    toast(`${label} 복사됨: ${text}`, "success", 2500);
  } catch (err) {
    toast(`복사 실패: ${err.message}`, "error", 3000);
  }
}

// ---------- Template download ----------
function downloadTemplate() {
  const pricesCsv = [
    "# Investment Dashboard · 가격 데이터 템플릿 (Wide 포맷)",
    "# 첫 열 = date (YYYY-MM-DD), 이후 열 = 티커별 종가",
    "# 주석 (#) 줄은 무시됩니다. 최소 60영업일 이상 권장.",
    "date,AAPL,MSFT,GOOGL,SPY",
    "2025-01-02,185.64,372.11,141.92,470.12",
    "2025-01-03,184.25,373.80,142.18,468.30",
    "2025-01-06,186.88,376.10,143.55,471.20",
    "2025-01-07,188.42,378.05,144.12,473.80",
  ].join("\n");
  const holdingsJson = JSON.stringify([
    { ticker: "AAPL",  name: "Apple Inc.",         weight: 0.25, sector: "Technology",     region: "US",   asset_class: "Equity", currency: "USD" },
    { ticker: "MSFT",  name: "Microsoft Corp.",    weight: 0.25, sector: "Technology",     region: "US",   asset_class: "Equity", currency: "USD" },
    { ticker: "GOOGL", name: "Alphabet Inc. C",    weight: 0.20, sector: "Communications", region: "US",   asset_class: "Equity", currency: "USD" },
    { ticker: "SPY",   name: "SPDR S&P 500 ETF",   weight: 0.30, sector: "Broad Market",   region: "US",   asset_class: "ETF",    currency: "USD" },
  ], null, 2);
  const readme = [
    "# 투자 대시보드 입력 데이터 템플릿",
    "",
    "## 파일 구성",
    "- `prices.csv` — Wide 포맷: 첫 열 date, 이후 열이 티커. 최소 60영업일 권장.",
    "- `holdings.json` — 배열. 필수: ticker · weight. 선택: name · sector · region · asset_class · currency.",
    "",
    "## 규칙",
    "- 가중치 합은 1.0 이 아니어도 자동 정규화됩니다.",
    "- currency 미지정 시 USD 로 간주됩니다. 다중 통화는 webapp/data/fx_rates.json 을 참조하여 자동 변환됩니다.",
    "- asset_class 권장 값: Equity · ETF · Bond · Commodity · Cash · REIT · Crypto.",
    "- Long 포맷 (date,ticker,close) CSV 도 자동 감지되어 Wide 로 전환됩니다.",
    "",
    "## 사용 방법",
    "1. `prices.csv` 와 `holdings.json` 을 본인 데이터로 교체",
    "2. 웹앱에서 '가격 CSV/XLSX/JSON 업로드' / '보유종목 업로드' 로 각각 로드",
    "3. 즉시 12개 차트 + 7개 KPI 렌더",
  ].join("\n");
  const files = [
    { name: "prices.csv",     body: pricesCsv,    type: "text/csv" },
    { name: "holdings.json",  body: holdingsJson, type: "application/json" },
    { name: "README.md",      body: readme,       type: "text/markdown" },
  ];
  // Download as 3 separate files (browsers support sequential downloads without user prompt for each)
  for (const f of files) {
    const blob = new Blob([f.body], { type: f.type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = f.name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  toast("템플릿 3개 파일 다운로드 (prices.csv · holdings.json · README.md)", "success", 3500);
}

function wireUI(state) {
  qs("#btn-sample").addEventListener("click", async () => {
    await loadSample(state);
  });
  qs("#btn-upload-price").addEventListener("click", () => qs("#price-file").click());
  qs("#btn-upload-holdings").addEventListener("click", () => qs("#holdings-file").click());
  qs("#price-file").addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      state.priceDataRaw = await parsePriceFile(f);
      await refreshBase(state);
      state.priceData = applyDateFilter(state);
      qs("#price-status").textContent = `✓ ${f.name} (${state.priceDataRaw.tickers.length} tickers, ${state.priceDataRaw.dates.length} days)`;
      syncDateInputs(state);
      maybeRender(state);
    } catch (err) {
      qs("#price-status").textContent = `✗ ${err.message}`;
    }
  });
  qs("#holdings-file").addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      state.holdings = await parseHoldingsFile(f);
      await refreshBase(state);
      state.priceData = applyDateFilter(state);
      qs("#holdings-status").textContent = `✓ ${f.name} (${state.holdings.length} positions)`;
      maybeRender(state);
    } catch (err) {
      qs("#holdings-status").textContent = `✗ ${err.message}`;
    }
  });
  qs("#btn-bench").addEventListener("click", () => {
    const v = qs("#bench-input").value.trim();
    state.benchmark = v || "SPY";
    saveSession(state);
    maybeRender(state);
  });
  qs("#bench-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") qs("#btn-bench").click();
  });
  // Rf (risk-free rate) input — decimal form (0.035 = 3.5%)
  const rfEl = qs("#rf-input");
  const applyRf = () => {
    const raw = parseFloat(rfEl.value);
    if (!Number.isFinite(raw) || raw < 0 || raw > 1) {
      toast("Rf 값은 0~1 사이 소수여야 합니다 (예: 0.035 = 3.5%)", "error", 4000);
      rfEl.value = String(state.rf);
      return;
    }
    state.rf = raw;
    saveSession(state);
    maybeRender(state);
    toast(`Rf = ${(raw * 100).toFixed(2)}% 적용`, "info", 2500);
  };
  qs("#btn-rf-apply").addEventListener("click", applyRf);
  rfEl.addEventListener("keydown", (e) => { if (e.key === "Enter") applyRf(); });
  rfEl.addEventListener("change", applyRf);
  // Portfolio name input
  const pnameEl = qs("#portfolio-name");
  const applyPname = () => {
    state.portfolioName = pnameEl.value.trim();
    saveSession(state);
    maybeRender(state);
  };
  qs("#btn-pname-apply").addEventListener("click", applyPname);
  pnameEl.addEventListener("keydown", (e) => { if (e.key === "Enter") applyPname(); });
  // Session reset
  qs("#btn-reset-session").addEventListener("click", () => {
    clearSession();
    try { localStorage.removeItem("theme"); } catch (_) {}
    toast("세션 초기화 — 페이지를 새로 고칩니다", "info", 2000);
    setTimeout(() => location.reload(), 900);
  });
  // Template download
  qs("#btn-template").addEventListener("click", downloadTemplate);
  // KPI click → clipboard copy (delegated because cards re-render)
  qs("#kpi-grid").addEventListener("click", (e) => {
    const v = e.target.closest(".kpi-value");
    if (!v) return;
    const label = v.parentElement?.querySelector(".kpi-label")?.textContent?.replace(/\s*ⓘ\s*$/, "").trim() || "KPI";
    copyToClipboard(v.textContent.trim(), label);
  });
  // Preset benchmark dropdown — fills the input + applies immediately
  const presetEl = qs("#bench-preset");
  if (presetEl) {
    presetEl.addEventListener("change", (e) => {
      const v = e.target.value;
      if (!v) return;
      qs("#bench-input").value = v;
      state.benchmark = v;
      saveSession(state);
      maybeRender(state);
    });
  }
  // Theme toggle
  const themeBtn = qs("#btn-theme");
  if (themeBtn) {
    themeBtn.addEventListener("click", () => {
      const cur = document.documentElement.dataset.theme || "light";
      applyTheme(cur === "light" ? "dark" : "light");
    });
  }
  // Keyboard shortcuts: P=print, S=sample, D=dark
  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input, textarea, select")) return;
    if (e.key === "p" || e.key === "P") { e.preventDefault(); window.print(); }
    else if (e.key === "s" || e.key === "S") { e.preventDefault(); qs("#btn-sample").click(); }
    else if (e.key === "d" || e.key === "D") { e.preventDefault(); themeBtn?.click(); }
  });
  qs("#btn-date-apply").addEventListener("click", () => {
    try {
      state.priceData = applyDateFilter(state);
      saveSession(state);
      maybeRender(state);
    } catch (err) {
      qs("#date-status").textContent = `✗ ${err.message}`;
      setTimeout(() => qs("#date-status").textContent = "", 3000);
    }
  });
  qs("#btn-date-reset").addEventListener("click", () => {
    qs("#date-from").value = "";
    qs("#date-to").value = "";
    state.priceData = applyDateFilter(state);
    saveSession(state);
    maybeRender(state);
  });
  qs("#btn-download-json").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(window.__lastSummary, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "kpi_summary.json"; a.click();
  });
  qs("#btn-print").addEventListener("click", () => {
    // Trigger browser print dialog → save as PDF. @media print CSS handles layout.
    window.print();
  });
  qs("#corr-topn").addEventListener("change", () => { saveSession(state); maybeRender(state); });
  qs("#btn-download-md").addEventListener("click", () => {
    const md = buildMarkdownReport(
      window.__lastSummary, state.holdings, state.benchmark, window.__lastInsights,
      { rf: state.rf, portfolioName: state.portfolioName }
    );
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "analysis_report.md"; a.click();
  });
}

function maybeRender(state) {
  if (state.priceData && state.holdings) {
    render(state).catch(err => {
      console.error(err);
      toast("분석 중 오류: " + err.message, "error");
    });
  }
}

async function loadSample(state) {
  qs("#price-status").textContent = "샘플 로딩 중…";
  qs("#holdings-status").textContent = "";
  const { priceData, holdings } = await fetchSample();
  state.priceDataRaw = priceData;
  state.holdings = holdings;
  await refreshBase(state);
  state.priceData = applyDateFilter(state);
  qs("#price-status").textContent = `✓ sample_prices.csv (${priceData.tickers.length} tickers, ${priceData.dates.length} days)`;
  qs("#holdings-status").textContent = `✓ sample_holdings.json (${holdings.length} positions)`;
  syncDateInputs(state);
  await render(state);
}

// Run FX conversion on state.priceDataRaw using state.holdings, storing into
// state.priceDataBase. No-op when all holdings are in base currency.
async function refreshBase(state) {
  if (!state.priceDataRaw || !state.holdings) {
    state.priceDataBase = state.priceDataRaw;
    return;
  }
  const { priceData: converted, note } = await maybeFxConvert(state.priceDataRaw, state.holdings, state.baseCurrency || "USD");
  state.priceDataBase = converted;
  state.fxNote = note || "";
  const st = qs("#date-status");
  if (st && note) st.textContent = note;
}

// Read from date inputs and slice the FX-converted (or raw) priceData accordingly.
function applyDateFilter(state) {
  const src = state.priceDataBase || state.priceDataRaw;
  if (!src) return state.priceData;
  const from = qs("#date-from")?.value || "";
  const to = qs("#date-to")?.value || "";
  return slicePriceData(src, from, to);
}

function syncDateInputs(state) {
  const pd = state.priceDataRaw;
  if (!pd || pd.dates.length === 0) return;
  const fromEl = qs("#date-from"), toEl = qs("#date-to");
  if (!fromEl.value) fromEl.min = pd.dates[0];
  if (!toEl.value) toEl.max = pd.dates[pd.dates.length - 1];
  fromEl.placeholder = pd.dates[0];
  toEl.placeholder = pd.dates[pd.dates.length - 1];
}

function buildMarkdownReport(summary, holdings, benchmark, insights, opts = {}) {
  const p = summary.portfolio, b = summary.vs_benchmark;
  const strip = s => s.replace(/<[^>]+>/g, "");
  const rf = opts.rf ?? DEFAULT_RF;
  const portfolioName = opts.portfolioName || "";
  const out = [];
  out.push(portfolioName ? `# ${portfolioName} · 포트폴리오 분석 리포트` : "# 포트폴리오 분석 리포트");
  out.push("");
  out.push(`- 기간: ${summary.period.start} ~ ${summary.period.end} (거래일 ${summary.period.trading_days}일)`);
  out.push(`- 벤치마크: ${benchmark}`);
  out.push(`- 무위험 수익률 (Rf): ${(rf * 100).toFixed(2)}%`);
  out.push(`- 포지션 수: ${summary.composition.n_positions}`);
  out.push("");
  out.push("## 한 줄 요약");
  out.push(strip(insights[0] || ""));
  out.push("");
  out.push("## 성과 · 리스크 지표");
  out.push("");
  out.push("| 지표 | 포트폴리오 | 벤치마크 |");
  out.push("|---|---|---|");
  out.push(`| 누적 수익률 | ${fmtPct(p.total_return)} | – |`);
  out.push(`| CAGR | ${fmtPct(p.cagr)} | ${b ? fmtPct(b.cagr) : "–"} |`);
  out.push(`| 연환산 변동성 | ${fmtPct(p.ann_vol, 2, false)} | ${b ? fmtPct(b.ann_vol, 2, false) : "–"} |`);
  out.push(`| Sharpe | ${fmtRatio(p.sharpe)} | – |`);
  out.push(`| Sortino | ${fmtRatio(p.sortino)} | – |`);
  out.push(`| MDD | ${fmtPct(p.mdd)} | ${b ? fmtPct(b.mdd) : "–"} |`);
  out.push(`| Calmar | ${fmtRatio(p.calmar)} | – |`);
  if (b) {
    out.push(`| Beta | ${fmtRatio(b.beta)} | 1.00 |`);
    out.push(`| Alpha(Jensen) | ${fmtPct(b.alpha)} | – |`);
    out.push(`| Information Ratio | ${fmtRatio(b.information_ratio)} | – |`);
    out.push(`| Tracking Error | ${fmtPct(b.tracking_error, 2, false)} | – |`);
  }
  out.push(`| VaR 95% | ${(p.var_95 * 100).toFixed(2)}% | – |`);
  out.push(`| CVaR 95% | ${(p.cvar_95 * 100).toFixed(2)}% | – |`);
  out.push(`| HHI | ${p.hhi.toFixed(3)} | – |`);
  out.push("");
  out.push("## 스트레스 시나리오");
  out.push("");
  out.push("| 시나리오 | 포트 1일 손익 |");
  out.push("|---|---|");
  for (const s of summary.stress) out.push(`| ${s.scenario} | ${fmtPct(s.pnl_pct)} |`);
  out.push("");
  out.push("## 핵심 인사이트");
  for (const s of insights) out.push(`- ${strip(s)}`);
  return out.join("\n");
}

// ---------- Toast (non-blocking UI notifications) ----------
function toast(msg, kind = "info", ms = 4000) {
  const root = qs("#toast-root");
  if (!root) { console.log(`[${kind}] ${msg}`); return; }
  const el = document.createElement("div");
  el.className = `toast toast-${kind}`;
  el.textContent = msg;
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 300);
  }, ms);
}

// ---------- Dark mode ----------
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const btn = qs("#btn-theme");
  if (btn) btn.textContent = theme === "dark" ? "Light" : "Dark";
  try { localStorage.setItem("theme", theme); } catch (_) {}
  // Re-render every Plotly chart so axes, text, and gridlines pick up the new theme colors.
  if (window.__lastState && window.__lastState.summary && typeof Plotly !== "undefined") {
    try { renderAllCharts(window.__lastState); } catch (e) { console.warn("[theme] redraw failed:", e); }
  }
}

function initTheme() {
  let t = "light";
  try { t = localStorage.getItem("theme") || "light"; } catch (_) {}
  applyTheme(t);
}

document.addEventListener("DOMContentLoaded", async () => {
  initTheme();
  const saved = loadSession();
  const state = {
    priceData: null, holdings: null,
    benchmark: saved.benchmark || "SPY",
    baseCurrency: "USD",
    rf: Number.isFinite(saved.rf) ? saved.rf : DEFAULT_RF,
    portfolioName: saved.portfolioName || "",
  };
  // Reflect saved session into UI before first render
  const benchEl = qs("#bench-input"); if (benchEl) benchEl.value = state.benchmark;
  const rfEl = qs("#rf-input"); if (rfEl) rfEl.value = state.rf;
  const pnameEl = qs("#portfolio-name"); if (pnameEl) pnameEl.value = state.portfolioName;
  const fromEl = qs("#date-from"); if (fromEl && saved.dateFrom) fromEl.value = saved.dateFrom;
  const toEl = qs("#date-to"); if (toEl && saved.dateTo) toEl.value = saved.dateTo;
  const topNEl = qs("#corr-topn"); if (topNEl && saved.topN) topNEl.value = saved.topN;
  wireUI(state);
  await loadSample(state);
  if (saved.benchmark || saved.rf || saved.portfolioName || saved.dateFrom || saved.dateTo) {
    const ss = qs("#session-status");
    if (ss) {
      ss.textContent = "↻ 저장된 세션 설정 복원됨";
      setTimeout(() => { ss.textContent = ""; }, 4000);
    }
  }
});
