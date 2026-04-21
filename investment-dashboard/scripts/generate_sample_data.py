"""Generate realistic sample investment data for demo/testing.

Creates:
  assets/data/sample_prices.csv      — wide-format daily prices (3 years)
  assets/data/sample_holdings.json   — portfolio holdings with weights
  assets/data/sample_transactions.csv— trade log (optional)

The universe is intentionally diverse — US large cap, KR large cap, bond,
gold, REIT, small-cap and international equity — so that the dashboard can
exercise sector/region/asset-class slices and correlation meaningfully.

Usage:
    python scripts/generate_sample_data.py
"""
from __future__ import annotations

import json
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

OUT_DIR = Path(__file__).resolve().parents[1] / "assets" / "data"
OUT_DIR.mkdir(parents=True, exist_ok=True)

RNG = np.random.default_rng(3)

# (ticker, name, sector, asset_class, region, annual_drift, annual_vol, start_price, rho)
# rho = correlation to the latent market factor
UNIVERSE = [
    # US mega-cap tech (bullish demo drifts)
    ("AAPL",     "Apple Inc.",            "IT",            "Equity",    "US", 0.22, 0.26, 130.0,    0.70),
    ("MSFT",     "Microsoft Corp.",       "IT",            "Equity",    "US", 0.24, 0.24, 240.0,    0.72),
    ("NVDA",     "NVIDIA Corp.",          "IT",            "Equity",    "US", 0.55, 0.50, 150.0,    0.65),
    ("GOOGL",    "Alphabet Inc.",         "Communication", "Equity",    "US", 0.18, 0.25,  90.0,    0.68),
    ("AMZN",     "Amazon.com Inc.",       "Consumer",      "Equity",    "US", 0.16, 0.30,  95.0,    0.66),
    ("TSLA",     "Tesla Inc.",            "Consumer",      "Equity",    "US", 0.10, 0.55, 115.0,    0.50),
    # US value / defensive
    ("JPM",      "JPMorgan Chase",        "Financial",     "Equity",    "US", 0.14, 0.23, 135.0,    0.72),
    ("XOM",      "Exxon Mobil",           "Energy",        "Equity",    "US", 0.12, 0.28, 110.0,    0.45),
    ("JNJ",      "Johnson & Johnson",     "Healthcare",    "Equity",    "US", 0.08, 0.17, 172.0,    0.55),
    ("V",        "Visa Inc.",             "Financial",     "Equity",    "US", 0.15, 0.20, 215.0,    0.70),
    ("PG",       "Procter & Gamble",      "Consumer",      "Equity",    "US", 0.10, 0.15, 140.0,    0.50),
    # Korea
    ("005930.KS","삼성전자",               "IT",            "Equity",    "KR", 0.13, 0.28,  60000.0, 0.55),
    ("000660.KS","SK하이닉스",             "IT",            "Equity",    "KR", 0.22, 0.38,  90000.0, 0.52),
    ("035420.KS","NAVER",                 "Communication", "Equity",    "KR", 0.08, 0.33, 210000.0, 0.48),
    # Alt assets / broad exposure
    ("GLD",      "Gold ETF",              "Commodity",     "Commodity", "Global", 0.08, 0.14, 170.0, 0.05),
    ("IYR",      "US REIT ETF",           "REIT",          "RealEstate","US",     0.08, 0.20,  85.0, 0.55),
    ("EFA",      "MSCI EAFE ETF",         "Broad",         "Equity",    "DM-exUS",0.10, 0.17,  70.0, 0.60),
    ("EEM",      "MSCI EM ETF",           "Broad",         "Equity",    "EM",     0.09, 0.21,  40.0, 0.55),
    ("IWM",      "Russell 2000 ETF",      "Broad",         "Equity",    "US",     0.12, 0.25, 190.0, 0.75),
    # Benchmark + bond
    ("SPY",      "S&P 500 ETF",           "Benchmark",     "Equity",    "US",     0.14, 0.17, 380.0, 1.00),
    ("AGG",      "US Aggregate Bond ETF", "Bond",          "Bond",      "US",     0.04, 0.06,  98.0, 0.10),
    ("TLT",      "20+ Year US Treasury",  "Bond",          "Bond",      "US",     0.03, 0.12,  95.0, -0.10),
]


def simulate_prices(years: float = 3.0) -> pd.DataFrame:
    end = date(2026, 4, 17)
    start = end - timedelta(days=int(365 * years) + 30)

    dates = pd.bdate_range(start, end)
    n = len(dates)
    dt = 1 / 252

    # Single latent market factor + regime-switching vol
    market_shock = RNG.normal(0, 1, size=n)
    # Mild deterministic bear windows — creates visible but recoverable corrections
    market_shock[int(n * 0.30): int(n * 0.33)] -= 0.6
    market_shock[int(n * 0.72): int(n * 0.75)] -= 0.4
    vol_regime = np.ones(n)
    vol_regime[int(n * 0.30): int(n * 0.35)] = 1.5
    vol_regime[int(n * 0.72): int(n * 0.77)] = 1.3

    data = {"date": dates}
    for ticker, _, sector, asset_class, _, drift, vol, p0, rho in UNIVERSE:
        idio = RNG.normal(0, 1, size=n)
        # handle negative correlation (for TLT)
        sign = 1.0 if rho >= 0 else -1.0
        r = abs(rho)
        shock = sign * r * market_shock + np.sqrt(max(1 - r ** 2, 0.0)) * idio
        daily_drift = (drift - 0.5 * vol ** 2) * dt
        daily_vol = vol * np.sqrt(dt) * vol_regime
        log_ret = daily_drift + daily_vol * shock

        prices = p0 * np.exp(np.cumsum(log_ret))
        data[ticker] = np.round(prices, 4)

    return pd.DataFrame(data)


def build_holdings() -> list[dict]:
    """Illustrative multi-asset portfolio — 16 positions + SPY as benchmark.

    Growth tilt (tech) + defensive (bonds, gold, healthcare) + international.
    Weights sum to 1.00 exactly.
    """
    weights = {
        # US mega-cap growth — 38%
        "AAPL": 0.08, "MSFT": 0.09, "NVDA": 0.07, "GOOGL": 0.06, "AMZN": 0.05, "TSLA": 0.03,
        # US value / defensive — 16%
        "JPM": 0.04, "XOM": 0.03, "JNJ": 0.03, "V": 0.04, "PG": 0.02,
        # Korea — 12%
        "005930.KS": 0.06, "000660.KS": 0.04, "035420.KS": 0.02,
        # International — 7%
        "EFA": 0.04, "EEM": 0.03,
        # Alt / diversifiers — 27%
        "IWM": 0.03, "IYR": 0.03, "GLD": 0.05, "AGG": 0.10, "TLT": 0.06,
    }
    total = sum(weights.values())
    assert abs(total - 1.0) < 1e-9, f"weights must sum to 1.0 (got {total})"

    lookup = {t[0]: t for t in UNIVERSE}
    out = []
    for tk, w in weights.items():
        _, name, sector, asset_class, region, *_ = lookup[tk]
        out.append({
            "ticker": tk,
            "name": name,
            "sector": sector,
            "asset_class": asset_class,
            "region": region,
            "weight": round(w, 6),
            "currency": "KRW" if tk.endswith(".KS") else "USD",
        })
    return out


def build_transactions(prices: pd.DataFrame, holdings: list[dict]) -> pd.DataFrame:
    """Initial buy-and-hold transaction log at t=0. Useful for PnL attribution."""
    first_day = prices["date"].iloc[0]
    portfolio_value = 1_000_000.0
    rows = []
    for h in holdings:
        tk = h["ticker"]
        price = float(prices[tk].iloc[0])
        notional = portfolio_value * h["weight"]
        qty = round(notional / price, 4)
        rows.append({
            "date": first_day.date().isoformat(),
            "ticker": tk,
            "side": "BUY",
            "qty": qty,
            "price": round(price, 4),
            "fee": round(notional * 0.0005, 2),
        })
    return pd.DataFrame(rows)


def main():
    prices = simulate_prices(3.0)
    holdings = build_holdings()
    txns = build_transactions(prices, holdings)

    prices_path = OUT_DIR / "sample_prices.csv"
    prices.to_csv(prices_path, index=False)

    holdings_path = OUT_DIR / "sample_holdings.json"
    holdings_path.write_text(json.dumps(holdings, ensure_ascii=False, indent=2))

    txns_path = OUT_DIR / "sample_transactions.csv"
    txns.to_csv(txns_path, index=False)

    print(f"✓ Wrote {prices_path}  ({len(prices)} rows × {len(prices.columns)-1} tickers)")
    print(f"✓ Wrote {holdings_path} ({len(holdings)} positions, weight sum={sum(h['weight'] for h in holdings):.4f})")
    print(f"✓ Wrote {txns_path}    ({len(txns)} transactions)")


if __name__ == "__main__":
    main()
