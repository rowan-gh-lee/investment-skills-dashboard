"""Financial KPI calculations — implementations match definitions in SKILL.md.

All functions accept pandas Series/DataFrames of daily returns unless otherwise noted.
"""
from __future__ import annotations

from typing import Optional

import numpy as np
import pandas as pd

TRADING_DAYS = 252
DEFAULT_RF = 0.035  # 3.5% annual risk-free rate


# ---------- Return construction ----------------------------------------------

def log_returns(prices: pd.DataFrame | pd.Series) -> pd.DataFrame | pd.Series:
    return np.log(prices / prices.shift(1)).dropna(how="all")


def simple_returns(prices: pd.DataFrame | pd.Series) -> pd.DataFrame | pd.Series:
    return (prices / prices.shift(1) - 1).dropna(how="all")


def portfolio_returns(prices: pd.DataFrame, weights: dict[str, float]) -> pd.Series:
    """Daily log-return of a weighted portfolio. Weights {ticker: w}."""
    tickers = [t for t in weights if t in prices.columns]
    if not tickers:
        raise ValueError("No holdings ticker is present in price data")
    w = pd.Series({t: weights[t] for t in tickers})
    w = w / w.sum()  # renormalize among available
    rets = log_returns(prices[tickers])
    return (rets * w).sum(axis=1)


def cumulative_from_log(rets: pd.Series) -> pd.Series:
    """Cumulative value starting at 1.0 from log-returns."""
    return np.exp(rets.cumsum())


# ---------- Core KPIs --------------------------------------------------------

def cagr(prices_or_cum: pd.Series) -> float:
    s = prices_or_cum.dropna()
    if len(s) < 2:
        return float("nan")
    years = (s.index[-1] - s.index[0]).days / 365.25
    if years <= 0:
        return float("nan")
    return (s.iloc[-1] / s.iloc[0]) ** (1 / years) - 1


def annualized_vol(rets: pd.Series) -> float:
    return float(rets.std(ddof=1) * np.sqrt(TRADING_DAYS))


def sharpe(rets: pd.Series, rf: float = DEFAULT_RF) -> float:
    vol = annualized_vol(rets)
    if vol == 0 or np.isnan(vol):
        return float("nan")
    ann_ret = rets.mean() * TRADING_DAYS
    return (ann_ret - rf) / vol


def sortino(rets: pd.Series, rf: float = DEFAULT_RF) -> float:
    downside = rets[rets < 0]
    dd_vol = float(downside.std(ddof=1) * np.sqrt(TRADING_DAYS))
    if dd_vol == 0 or np.isnan(dd_vol):
        return float("nan")
    ann_ret = rets.mean() * TRADING_DAYS
    return (ann_ret - rf) / dd_vol


def max_drawdown(cum: pd.Series) -> tuple[float, pd.Timestamp, pd.Timestamp]:
    """Returns (mdd, peak_date, trough_date) where mdd is negative."""
    running_peak = cum.cummax()
    dd = cum / running_peak - 1
    trough = dd.idxmin()
    peak = cum.loc[:trough].idxmax()
    return float(dd.min()), peak, trough


def calmar(cum: pd.Series) -> float:
    c = cagr(cum)
    mdd, _, _ = max_drawdown(cum)
    if mdd == 0 or np.isnan(mdd):
        return float("nan")
    return c / abs(mdd)


def beta_alpha(
    port_rets: pd.Series,
    bench_rets: pd.Series,
    rf: float = DEFAULT_RF,
) -> tuple[float, float]:
    df = pd.concat([port_rets, bench_rets], axis=1, keys=["p", "b"]).dropna()
    cov = df["p"].cov(df["b"])
    var = df["b"].var()
    beta = cov / var if var else float("nan")
    ann_p = df["p"].mean() * TRADING_DAYS
    ann_b = df["b"].mean() * TRADING_DAYS
    alpha = ann_p - (rf + beta * (ann_b - rf))
    return float(beta), float(alpha)


def hhi(weights: pd.Series) -> float:
    """Herfindahl–Hirschman concentration index in [0,1]. 1 == single-position."""
    w = weights / weights.sum()
    return float((w ** 2).sum())


# ---------- Tail risk -------------------------------------------------------

def value_at_risk(rets: pd.Series, alpha: float = 0.05) -> float:
    """Historical VaR — loss not exceeded with prob (1-alpha). Returned as a
    positive decimal (e.g. 0.023 = 2.3% one-day loss)."""
    q = float(np.nanquantile(rets.dropna(), alpha))
    return float(-q)


def conditional_var(rets: pd.Series, alpha: float = 0.05) -> float:
    """Historical CVaR / Expected Shortfall — average loss in the worst alpha tail."""
    r = rets.dropna()
    thr = np.nanquantile(r, alpha)
    tail = r[r <= thr]
    if len(tail) == 0:
        return float("nan")
    return float(-tail.mean())


def parametric_var(rets: pd.Series, alpha: float = 0.05) -> float:
    """Gaussian parametric VaR for comparison against historical."""
    from math import erf, sqrt
    # Inverse standard normal via a simple approximation (Beasley–Springer)
    def _ndtri(p: float) -> float:
        # Acklam's approximation
        a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
             1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00]
        b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
             6.680131188771972e+01, -1.328068155288572e+01]
        c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
             -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00]
        d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
             3.754408661907416e+00]
        plow = 0.02425; phigh = 1 - plow
        if p < plow:
            q = sqrt(-2 * np.log(p))
            return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / \
                   ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1)
        if p > phigh:
            q = sqrt(-2 * np.log(1 - p))
            return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / \
                    ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1)
        q = p - 0.5
        r = q*q
        return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q / \
               (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1)

    mu = float(rets.mean())
    sd = float(rets.std(ddof=1))
    z = _ndtri(alpha)  # negative
    return float(-(mu + z * sd))


def rolling_sharpe(rets: pd.Series, window: int = 63, rf: float = DEFAULT_RF) -> pd.Series:
    """Rolling annualized Sharpe (default 1 quarter window)."""
    ann_ret = rets.rolling(window).mean() * TRADING_DAYS
    ann_vol = rets.rolling(window).std(ddof=1) * np.sqrt(TRADING_DAYS)
    return (ann_ret - rf) / ann_vol


def rolling_beta(port: pd.Series, bench: pd.Series, window: int = 63) -> pd.Series:
    """Rolling beta of portfolio vs benchmark."""
    df = pd.concat([port, bench], axis=1, keys=["p", "b"]).dropna()
    cov = df["p"].rolling(window).cov(df["b"])
    var = df["b"].rolling(window).var()
    return cov / var


# ---------- Scenario / stress -----------------------------------------------

STRESS_SCENARIOS = {
    # (name, mapping from sector/asset_class pattern to daily shock in %)
    "2008 GFC (1일 최악)":            {"Equity": -0.09, "REIT": -0.12, "Bond": +0.01, "Commodity": +0.00},
    "COVID-19 쇼크 (2020-03-16)":     {"Equity": -0.12, "REIT": -0.17, "Bond": -0.02, "Commodity": -0.05},
    "테크 디레이팅 (금리 +100bp)":     {"IT": -0.06, "Communication": -0.05, "Consumer": -0.03,
                                        "Financial": +0.02, "Energy": +0.01, "Bond": -0.03,
                                        "Commodity": 0.0, "REIT": -0.04, "Equity": -0.03},
    "달러 초강세 (DXY +5%)":           {"Equity": -0.02, "Commodity": -0.04, "Bond": -0.01,
                                        "REIT": -0.01},
    "에너지 쇼크 (유가 +30%)":         {"Energy": +0.08, "Consumer": -0.03, "IT": -0.02,
                                        "Commodity": +0.04, "Bond": -0.01, "Equity": -0.02},
}


def stress_test(holdings_df: pd.DataFrame) -> list[dict]:
    """Apply pre-defined shocks to holdings. Returns list of {scenario, pnl_pct, by_sector}."""
    out = []
    for scn, shocks in STRESS_SCENARIOS.items():
        pnl = 0.0
        by_sector = {}
        for _, row in holdings_df.iterrows():
            # sector lookup wins over asset_class wins over fallback
            sh = shocks.get(row["sector"])
            if sh is None:
                sh = shocks.get(row["asset_class"])
            if sh is None:
                # fallback: generic equity shock
                sh = shocks.get("Equity", 0.0) if row["asset_class"] == "Equity" else 0.0
            contrib = float(row["weight"]) * sh
            pnl += contrib
            by_sector[row["sector"]] = by_sector.get(row["sector"], 0.0) + contrib
        out.append({
            "scenario": scn,
            "pnl_pct": round(pnl, 6),
            "by_sector": {k: round(v, 6) for k, v in sorted(by_sector.items(),
                                                              key=lambda kv: kv[1])},
        })
    return out


# ---------- Summary bundle ---------------------------------------------------

def compute_summary(
    prices: pd.DataFrame,
    holdings_df: pd.DataFrame,
    benchmark: Optional[str] = "SPY",
    rf: float = DEFAULT_RF,
) -> dict:
    weights = dict(zip(holdings_df["ticker"], holdings_df["weight"]))
    port = portfolio_returns(prices, weights)
    cum_port = cumulative_from_log(port)

    bench_rets = None
    cum_bench = None
    if benchmark and benchmark in prices.columns:
        bench_rets = log_returns(prices[benchmark])
        cum_bench = cumulative_from_log(bench_rets)

    mdd, peak_dt, trough_dt = max_drawdown(cum_port)
    beta = alpha = float("nan")
    if bench_rets is not None:
        beta, alpha = beta_alpha(port, bench_rets, rf=rf)

    out = {
        "period": {
            "start": cum_port.index[0].date().isoformat(),
            "end": cum_port.index[-1].date().isoformat(),
            "trading_days": int(len(cum_port)),
        },
        "portfolio": {
            "cagr": round(cagr(cum_port), 6),
            "total_return": round(float(cum_port.iloc[-1] - 1), 6),
            "ann_vol": round(annualized_vol(port), 6),
            "sharpe": round(sharpe(port, rf), 4),
            "sortino": round(sortino(port, rf), 4),
            "mdd": round(mdd, 6),
            "mdd_peak": peak_dt.date().isoformat(),
            "mdd_trough": trough_dt.date().isoformat(),
            "calmar": round(calmar(cum_port), 4),
            "hhi": round(hhi(holdings_df["weight"]), 4),
            "var_95": round(value_at_risk(port, 0.05), 6),
            "cvar_95": round(conditional_var(port, 0.05), 6),
            "var_99": round(value_at_risk(port, 0.01), 6),
        },
        "vs_benchmark": None,
    }
    if bench_rets is not None:
        tr_err = float((port - bench_rets).dropna().std(ddof=1) * np.sqrt(TRADING_DAYS))
        ir = (cagr(cum_port) - cagr(cum_bench)) / tr_err if tr_err else float("nan")
        up = (port > bench_rets).mean()
        out["vs_benchmark"] = {
            "ticker": benchmark,
            "beta": round(beta, 4),
            "alpha": round(alpha, 6),
            "cagr": round(cagr(cum_bench), 6),
            "ann_vol": round(annualized_vol(bench_rets), 6),
            "mdd": round(max_drawdown(cum_bench)[0], 6),
            "tracking_error": round(tr_err, 6),
            "information_ratio": round(float(ir), 4),
            "up_capture_daily": round(float(up), 4),
        }

    # Stress tests
    out["stress"] = stress_test(holdings_df)

    # Portfolio composition summaries
    out["composition"] = {
        "by_sector": (
            holdings_df.groupby("sector")["weight"].sum()
            .sort_values(ascending=False).round(6).to_dict()
        ),
        "by_asset_class": (
            holdings_df.groupby("asset_class")["weight"].sum()
            .sort_values(ascending=False).round(6).to_dict()
        ),
        "by_region": (
            holdings_df.groupby("region")["weight"].sum()
            .sort_values(ascending=False).round(6).to_dict()
        ),
        "n_positions": int(len(holdings_df)),
    }
    return out
