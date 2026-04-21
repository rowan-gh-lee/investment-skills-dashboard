"""Data ingestion — read prices, holdings, transactions from flexible formats.

All higher-level modules depend on the canonical shapes returned here:
  - prices:   DataFrame indexed by DatetimeIndex, columns are tickers.
  - holdings: DataFrame with columns [ticker, name, sector, asset_class, region, weight, currency].
  - txns:     DataFrame with columns [date, ticker, side, qty, price, fee]  (optional).
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

import pandas as pd


def load_prices(path: str | Path) -> pd.DataFrame:
    """Load wide-format daily prices. Auto-detects CSV/XLSX."""
    path = Path(path)
    if path.suffix.lower() in (".xlsx", ".xls"):
        df = pd.read_excel(path)
    else:
        df = pd.read_csv(path)

    # Find date column
    date_col = None
    for c in df.columns:
        if c.lower() in ("date", "날짜", "기준일"):
            date_col = c
            break
    if date_col is None:
        date_col = df.columns[0]  # assume first column is date

    df[date_col] = pd.to_datetime(df[date_col])
    df = df.set_index(date_col).sort_index()
    df.index.name = "date"

    # Ensure all ticker columns are numeric
    for c in df.columns:
        df[c] = pd.to_numeric(df[c], errors="coerce")

    # Forward-fill minor gaps (max 5 days) — longer gaps remain NaN
    df = df.ffill(limit=5)
    # Drop leading all-NaN rows
    df = df.dropna(how="all")
    return df


def load_holdings(path: str | Path) -> pd.DataFrame:
    """Load portfolio holdings. Accepts JSON or CSV."""
    path = Path(path)
    if path.suffix.lower() == ".json":
        records = json.loads(path.read_text(encoding="utf-8"))
        df = pd.DataFrame(records)
    else:
        df = pd.read_csv(path)

    required = {"ticker", "weight"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"holdings is missing required columns: {missing}")

    # Normalize optional columns
    for col, default in [("name", ""), ("sector", "Unknown"),
                          ("asset_class", "Equity"), ("region", "Unknown"),
                          ("currency", "USD")]:
        if col not in df.columns:
            df[col] = default

    # Weight sanity check → renormalize if off
    total = df["weight"].sum()
    if abs(total - 1.0) > 0.005:
        print(f"[warn] holdings weights sum to {total:.4f} — renormalizing to 1.0")
        df["weight"] = df["weight"] / total
    return df[["ticker", "name", "sector", "asset_class", "region", "weight", "currency"]]


def load_transactions(path: Optional[str | Path]) -> Optional[pd.DataFrame]:
    if path is None:
        return None
    path = Path(path)
    if not path.exists():
        return None
    df = pd.read_csv(path)
    df["date"] = pd.to_datetime(df["date"])
    return df.sort_values("date").reset_index(drop=True)


def load_fx_rates(path: Optional[str | Path]) -> dict[str, float]:
    """Load FX rate table. Returns {currency_code: rate_to_base}.

    File format (JSON):
        { "_meta": {"base": "USD", ...},
          "USD": 1.0, "KRW": 0.000724, ... }
    """
    if path is None:
        return {"USD": 1.0}
    path = Path(path)
    if not path.exists():
        return {"USD": 1.0}
    data = json.loads(path.read_text(encoding="utf-8"))
    # drop metadata keys (any key starting with "_")
    return {k: float(v) for k, v in data.items() if not k.startswith("_")}


def convert_prices_to_base(
    prices: pd.DataFrame,
    holdings: pd.DataFrame,
    fx_rates: dict[str, float],
    base: str = "USD",
) -> pd.DataFrame:
    """Multiply each ticker's price column by its holding.currency→base FX rate.

    Deterministic, multiplicative: `price_base = price_local * rate[ccy]`.
    If a ticker's currency equals base (or is missing), column is unchanged.
    If rate for a non-base currency is missing, prints a warning and leaves
    that column unscaled (user must supply rate for strict correctness).

    Returns a NEW DataFrame; input is not mutated.
    """
    if holdings is None or prices is None:
        return prices
    ccy_map = dict(zip(holdings["ticker"], holdings.get("currency", pd.Series(["USD"] * len(holdings)))))
    out = prices.copy()
    missing = []
    for tkr in out.columns:
        ccy = ccy_map.get(tkr, base)
        if ccy is None or ccy == base:
            continue
        rate = fx_rates.get(ccy)
        if rate is None:
            missing.append(ccy)
            continue
        out[tkr] = out[tkr].astype(float) * rate
    if missing:
        print(f"[warn] FX rate missing for currencies {sorted(set(missing))}; columns unscaled.")
    return out
