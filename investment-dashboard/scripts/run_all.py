"""End-to-end pipeline: ingest → kpis → figures → dashboard + report.

Usage:
    python scripts/run_all.py \
        --prices assets/data/sample_prices.csv \
        --holdings assets/data/sample_holdings.json \
        --benchmark SPY \
        --out outputs/
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

from build_dashboard import build
from ingest import load_holdings, load_prices, load_transactions, load_fx_rates, convert_prices_to_base
from metrics import (
    DEFAULT_RF,
    log_returns,
    portfolio_returns,
    compute_summary,
)
from plotting import (
    fig_asset_class_bar,
    fig_correlation,
    fig_cumulative,
    fig_monthly_heatmap,
    fig_region_treemap,
    fig_return_distribution,
    fig_rolling_sharpe_beta,
    fig_rolling_vol,
    fig_sector_donut,
    fig_stress_test,
    fig_top_holdings,
    fig_underwater,
)


def build_insights(summary: dict, holdings_df: pd.DataFrame, benchmark: str) -> list[str]:
    p = summary["portfolio"]
    b = summary.get("vs_benchmark") or {}
    out = []

    # 1. Performance vs benchmark
    if b:
        diff = p["cagr"] - b["cagr"]
        direction = "상회" if diff > 0 else "하회"
        out.append(
            f"📈 <b>성과</b>: CAGR {p['cagr']*100:+.2f}% 로 벤치마크 {benchmark} ({b['cagr']*100:+.2f}%) 대비 "
            f"{abs(diff)*100:.2f}%p {direction}. β {b['beta']:.2f} · α {b['alpha']*100:+.2f}%p · IR {b.get('information_ratio', 0):.2f}."
        )
    else:
        out.append(f"📈 <b>성과</b>: CAGR {p['cagr']*100:+.2f}%, 연환산 변동성 {p['ann_vol']*100:.2f}%.")

    # 2. Risk profile
    out.append(
        f"🛡 <b>리스크</b>: MDD {p['mdd']*100:+.2f}% ({p['mdd_peak']} → {p['mdd_trough']}) · "
        f"Calmar {p['calmar']:.2f} · Sharpe {p['sharpe']:.2f} / Sortino {p['sortino']:.2f} · "
        f"VaR95 {p['var_95']*100:.2f}% / CVaR95 {p['cvar_95']*100:.2f}%."
    )

    # 3. Concentration
    top_name = holdings_df.sort_values("weight", ascending=False).iloc[0]
    sector_series = holdings_df.groupby("sector")["weight"].sum().sort_values(ascending=False)
    top_sector_name = sector_series.idxmax()
    top_sector_wt = sector_series.iloc[0]
    out.append(
        f"🧩 <b>구성</b>: HHI {p['hhi']:.3f} · 최대 비중 종목 {top_name['ticker']} "
        f"({top_name['weight']*100:.1f}%) · 1위 섹터 {top_sector_name} {top_sector_wt*100:.1f}%."
    )

    # 4. Stress pick-worst
    stress = summary.get("stress") or []
    if stress:
        worst = min(stress, key=lambda s: s["pnl_pct"])
        out.append(
            f"🌪 <b>스트레스 최악</b>: '{worst['scenario']}' 적용 시 1일 포트 {worst['pnl_pct']*100:+.2f}% — "
            f"대비 자산(금/국채/현금) 비중 점검."
        )

    # 5. Risk flags (only fire when triggered)
    flags = []
    if p["mdd"] < -0.20:
        flags.append("⚠︎ MDD 20% 초과 — 꼬리위험 헤지 또는 현금비중 재검토 권장.")
    if p["sharpe"] is not None and not pd.isna(p["sharpe"]) and p["sharpe"] < 0.5:
        flags.append("⚠︎ Sharpe 0.5 미만 — 위험 대비 수익 효율이 낮음. 종목/섹터 선택 재검토.")
    if p["hhi"] > 0.15:
        flags.append("⚠︎ HHI 0.15 초과 — 상위 몇 종목이 전체 리스크를 좌우하는 구조.")
    if b and p["ann_vol"] > 1.3 * b.get("ann_vol", p["ann_vol"]):
        flags.append("⚠︎ 포트 변동성이 벤치 대비 30% 이상 — 저베타 자산 편입 검토.")
    if b and b.get("up_capture_daily", 0.5) < 0.45:
        flags.append("⚠︎ 일간 상승 포착률 45% 미만 — 벤치 대비 강세장에서 뒤처짐.")
    out.extend(flags)

    # 6. Action proposals (always present at least one)
    actions = []
    if p["mdd"] < -0.20:
        actions.append("✅ 하방 헤지 — 풋옵션 혹은 역상관 자산(미국채/금) 5~10% 편입.")
    if p["hhi"] > 0.15:
        actions.append("✅ 집중도 완화 — 상위 2개 종목 비중 각 2%p 하향 → 동종 ETF로 대체.")
    if b and p["ann_vol"] > 1.3 * b.get("ann_vol", p["ann_vol"]):
        actions.append("✅ 변동성 축소 — 필수소비재/헬스케어 저베타 섹터 가점.")
    if not actions:
        actions.append("✅ 현 구성 유지 — 지표가 균형 범위. 분기 리밸런싱(±2%p 이탈 시)만 유지.")
    out.extend(actions)

    return out


def write_report(summary: dict, holdings_df: pd.DataFrame, benchmark: str, insights: list[str], out_path: Path):
    p = summary["portfolio"]
    b = summary.get("vs_benchmark") or {}

    sector_table = (
        holdings_df.groupby("sector")["weight"].sum().sort_values(ascending=False)
        .map(lambda x: f"{x*100:.2f}%").to_dict()
    )
    top_table = holdings_df.sort_values("weight", ascending=False).head(5)

    def _strip_html(s: str) -> str:
        import re
        return re.sub(r"<[^>]+>", "", s)

    lines = []
    lines.append(f"# 포트폴리오 분석 리포트")
    lines.append("")
    lines.append(f"- 기간: {summary['period']['start']} ~ {summary['period']['end']} "
                 f"(거래일 {summary['period']['trading_days']}일)")
    lines.append(f"- 벤치마크: {benchmark}")
    lines.append(f"- 포지션 수: {summary['composition']['n_positions']}")
    lines.append("")
    lines.append("## 한 줄 요약")
    lines.append(_strip_html(insights[0]) if insights else "요약 없음")
    lines.append("")

    lines.append("## 성과 · 리스크 지표")
    lines.append("")
    lines.append("| 지표 | 포트폴리오 | 벤치마크 |")
    lines.append("|---|---|---|")
    lines.append(f"| 누적 수익률 | {p.get('total_return', 0)*100:+.2f}% | – |")
    lines.append(f"| CAGR | {p['cagr']*100:+.2f}% | {(b.get('cagr') if b else float('nan'))*100 if b else float('nan'):+.2f}% |")
    lines.append(f"| 연환산 변동성 | {p['ann_vol']*100:.2f}% | {(b.get('ann_vol') if b else float('nan'))*100 if b else float('nan'):.2f}% |")
    lines.append(f"| Sharpe | {p['sharpe']:.2f} | – |")
    lines.append(f"| Sortino | {p['sortino']:.2f} | – |")
    lines.append(f"| MDD | {p['mdd']*100:+.2f}% | {(b.get('mdd') if b else float('nan'))*100 if b else float('nan'):+.2f}% |")
    lines.append(f"| Calmar | {p['calmar']:.2f} | – |")
    if b:
        lines.append(f"| Beta | {b['beta']:.2f} | 1.00 |")
        lines.append(f"| Alpha(Jensen) | {b['alpha']*100:+.2f}%p | – |")
        lines.append(f"| Information Ratio | {b.get('information_ratio', 0):.2f} | – |")
        lines.append(f"| Tracking Error | {b.get('tracking_error', 0)*100:.2f}% | – |")
    lines.append(f"| VaR 95% (1일) | {p['var_95']*100:.2f}% | – |")
    lines.append(f"| CVaR 95% (1일) | {p['cvar_95']*100:.2f}% | – |")
    lines.append(f"| HHI(집중도) | {p['hhi']:.3f} | – |")
    lines.append("")

    lines.append("## 리스크 진단")
    lines.append(f"- MDD 구간: **{p['mdd_peak']} → {p['mdd_trough']}**. 이 구간의 낙폭이 전체 리스크를 결정.")
    lines.append(f"- Sharpe {p['sharpe']:.2f} / Sortino {p['sortino']:.2f} — "
                 f"{'수용 가능' if p['sharpe']>=0.8 else '개선 필요'} 범위.")
    lines.append(f"- 집중도 HHI {p['hhi']:.3f} — "
                 f"{'분산 양호' if p['hhi']<=0.10 else ('중간' if p['hhi']<=0.15 else '편중 주의')}.")
    lines.append(f"- 1일 역사적 VaR95 {p['var_95']*100:.2f}% · CVaR95 {p['cvar_95']*100:.2f}% — "
                 f"꼬리가 평균보다 {p['cvar_95']/max(p['var_95'],1e-9):.1f}× 두꺼움.")
    lines.append("")

    lines.append("## 스트레스 시나리오")
    lines.append("")
    lines.append("| 시나리오 | 포트 1일 손익 |")
    lines.append("|---|---|")
    for s in (summary.get("stress") or []):
        lines.append(f"| {s['scenario']} | {s['pnl_pct']*100:+.2f}% |")
    lines.append("")

    lines.append("## 포트폴리오 구성")
    lines.append("**섹터 비중**")
    for k, v in sector_table.items():
        lines.append(f"- {k}: {v}")
    lines.append("")
    lines.append("**자산군 비중**")
    for k, v in summary["composition"]["by_asset_class"].items():
        lines.append(f"- {k}: {v*100:.2f}%")
    lines.append("")
    lines.append("**Top 5 종목**")
    lines.append("")
    lines.append("| 티커 | 종목명 | 섹터 | 지역 | 비중 |")
    lines.append("|---|---|---|---|---|")
    for r in top_table.itertuples():
        lines.append(f"| {r.ticker} | {r.name} | {r.sector} | {r.region} | {r.weight*100:.2f}% |")
    lines.append("")

    lines.append("## 실행 제안 (규칙 기반)")
    actions = [_strip_html(s) for s in insights if s.strip().startswith("✅")]
    for i, s in enumerate(actions, 1):
        lines.append(f"{i}. {s[2:].strip() if s.startswith('✅') else s}")
    lines.append("")

    lines.append("## 핵심 인사이트")
    for s in insights:
        lines.append(f"- {_strip_html(s)}")
    lines.append("")

    out_path.write_text("\n".join(lines), encoding="utf-8")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--prices", required=True)
    ap.add_argument("--holdings", required=True)
    ap.add_argument("--transactions", default=None)
    ap.add_argument("--benchmark", default="SPY")
    ap.add_argument("--start", default=None)
    ap.add_argument("--end", default=None)
    ap.add_argument("--rf", type=float, default=DEFAULT_RF)
    ap.add_argument("--out", default="outputs/")
    ap.add_argument("--title", default="Investment Dashboard")
    ap.add_argument("--fx-rates", default=None,
                    help="Path to fx_rates.json; defaults to assets/data/fx_rates.json if present")
    ap.add_argument("--base-currency", default="USD")
    args = ap.parse_args()

    prices = load_prices(args.prices)
    if args.start:
        prices = prices.loc[args.start:]
    if args.end:
        prices = prices.loc[:args.end]

    holdings_df = load_holdings(args.holdings)
    _txns = load_transactions(args.transactions)  # reserved for future PnL attribution

    # FX conversion: look for rate table at --fx-rates or default location
    fx_path = args.fx_rates
    if fx_path is None:
        _default_fx = Path(args.prices).parent / "fx_rates.json"
        if _default_fx.exists():
            fx_path = str(_default_fx)
    if fx_path:
        fx_rates = load_fx_rates(fx_path)
        ccys = set(holdings_df["currency"].dropna().unique()) - {args.base_currency}
        if ccys:
            print(f"[info] converting {sorted(ccys)} → {args.base_currency} using {fx_path}")
            prices = convert_prices_to_base(prices, holdings_df, fx_rates, args.base_currency)

    summary = compute_summary(prices, holdings_df, benchmark=args.benchmark, rf=args.rf)

    # Build figures
    weights = dict(zip(holdings_df["ticker"], holdings_df["weight"]))
    port = portfolio_returns(prices, weights)
    bench = log_returns(prices[args.benchmark]) if args.benchmark in prices.columns else None
    top_tickers = holdings_df.sort_values("weight", ascending=False).head(8)["ticker"].tolist()
    top_tickers = [t for t in top_tickers if t in prices.columns]

    figs = {
        "cumulative": fig_cumulative(port, bench, args.benchmark),
        "heatmap": fig_monthly_heatmap(port),
        "underwater": fig_underwater(port, bench, args.benchmark),
        "distribution": fig_return_distribution(port),
        "rolling_sb": fig_rolling_sharpe_beta(port, bench, window=63),
        "rolling_vol": fig_rolling_vol(port, 60),
        "stress": fig_stress_test(summary["stress"]),
        "correlation": fig_correlation(prices, top_tickers),
        "asset_class": fig_asset_class_bar(holdings_df),
        "sector": fig_sector_donut(holdings_df),
        "region": fig_region_treemap(holdings_df),
        "top_holdings": fig_top_holdings(holdings_df, top_n=10),
    }
    insights = build_insights(summary, holdings_df, args.benchmark)

    html = build(
        prices=prices, holdings_df=holdings_df, summary=summary,
        figs=figs, insights=insights, title=args.title, benchmark=args.benchmark,
    )

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "dashboard.html").write_text(html, encoding="utf-8")
    write_report(summary, holdings_df, args.benchmark, insights, out_dir / "analysis_report.md")
    (out_dir / "kpi_summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"✓ dashboard      → {out_dir / 'dashboard.html'}")
    print(f"✓ analysis report → {out_dir / 'analysis_report.md'}")
    print(f"✓ kpi json        → {out_dir / 'kpi_summary.json'}")


if __name__ == "__main__":
    main()
