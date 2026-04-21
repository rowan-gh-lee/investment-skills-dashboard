"""Plotly figure factories for the investment dashboard.

Each function returns a plotly.graph_objects.Figure. The colors and fonts follow
the palette fixed in SKILL.md so figures render consistently across reports.
"""
from __future__ import annotations

from typing import Optional

import numpy as np
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go

from metrics import (
    cumulative_from_log,
    log_returns,
    rolling_beta,
    rolling_sharpe,
    value_at_risk,
    conditional_var,
)

COL_PORT   = "#2E86AB"
COL_BENCH  = "#E63946"
COL_ACCENT = "#F4A261"
COL_NEUTRAL= "#6C757D"
COL_POS    = "#2A9D8F"
COL_NEG    = "#E76F51"
FONT_FAMILY = "Pretendard, -apple-system, 'Noto Sans KR', sans-serif"


def _base_layout(title: str, height: int = 360) -> dict:
    return dict(
        title=dict(text=title, x=0.01, xanchor="left", font=dict(size=14, color="#0f172a")),
        margin=dict(l=50, r=20, t=44, b=40),
        height=height,
        font=dict(family=FONT_FAMILY, size=12, color="#222"),
        plot_bgcolor="white",
        paper_bgcolor="white",
        hovermode="x unified",
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1,
                    bgcolor="rgba(255,255,255,0)"),
    )


def fig_cumulative(port_rets: pd.Series, bench_rets: Optional[pd.Series], bench_ticker: str = "SPY") -> go.Figure:
    cum_p = cumulative_from_log(port_rets)
    fig = go.Figure()
    fig.add_trace(go.Scatter(
        x=cum_p.index, y=(cum_p - 1) * 100,
        name="포트폴리오", line=dict(color=COL_PORT, width=2.6),
        hovertemplate="%{x|%Y-%m-%d}<br>누적수익률 %{y:.2f}%<extra></extra>",
    ))
    if bench_rets is not None:
        cum_b = cumulative_from_log(bench_rets)
        fig.add_trace(go.Scatter(
            x=cum_b.index, y=(cum_b - 1) * 100,
            name=bench_ticker, line=dict(color=COL_BENCH, width=1.8, dash="dot"),
            hovertemplate="%{x|%Y-%m-%d}<br>" + bench_ticker + " %{y:.2f}%<extra></extra>",
        ))
    fig.update_layout(**_base_layout("누적 수익률 (%)"))
    fig.update_xaxes(showgrid=True, gridcolor="#eee")
    fig.update_yaxes(showgrid=True, gridcolor="#eee", ticksuffix="%")
    return fig


def fig_monthly_heatmap(port_rets: pd.Series) -> go.Figure:
    monthly = (np.exp(port_rets.groupby([port_rets.index.year, port_rets.index.month]).sum()) - 1) * 100
    monthly.index.names = ["year", "month"]
    df = monthly.reset_index()
    pivot = df.pivot(index="year", columns="month", values=monthly.name if monthly.name else 0)
    if monthly.name is None:
        pivot.columns.name = None
    pivot = pivot.reindex(columns=range(1, 13))
    z = pivot.values
    z_text = [[("" if np.isnan(v) else f"{v:+.1f}%") for v in row] for row in z]
    fig = go.Figure(data=go.Heatmap(
        z=z,
        x=["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"],
        y=[str(y) for y in pivot.index],
        colorscale=[[0, COL_NEG], [0.5, "#FFFFFF"], [1, COL_POS]],
        zmid=0,
        text=z_text,
        texttemplate="%{text}",
        hovertemplate="%{y}년 %{x}<br>월수익률 %{z:.2f}%<extra></extra>",
        colorbar=dict(title="%", thickness=10),
    ))
    fig.update_layout(**_base_layout("월별 수익률 히트맵"))
    return fig


def fig_drawdown(port_rets: pd.Series) -> go.Figure:
    cum = cumulative_from_log(port_rets)
    dd = (cum / cum.cummax() - 1) * 100
    fig = go.Figure()
    fig.add_trace(go.Scatter(
        x=dd.index, y=dd.values, fill="tozeroy", mode="lines",
        line=dict(color=COL_NEG, width=1.5),
        fillcolor="rgba(231,111,81,0.25)",
        name="Drawdown",
        hovertemplate="%{x|%Y-%m-%d}<br>Drawdown %{y:.2f}%<extra></extra>",
    ))
    fig.update_layout(**_base_layout("Drawdown (%)"))
    fig.update_yaxes(ticksuffix="%", showgrid=True, gridcolor="#eee")
    fig.update_xaxes(showgrid=True, gridcolor="#eee")
    return fig


def fig_return_distribution(port_rets: pd.Series) -> go.Figure:
    pct = port_rets * 100
    var95 = -value_at_risk(port_rets, 0.05) * 100
    cvar95 = -conditional_var(port_rets, 0.05) * 100
    fig = go.Figure()
    fig.add_trace(go.Histogram(
        x=pct, nbinsx=50, marker=dict(color=COL_PORT, line=dict(color="white", width=0.5)),
        hovertemplate="구간 %{x:.2f}%<br>빈도 %{y}<extra></extra>",
        name="일간수익률 분포",
    ))
    mu, sd = pct.mean(), pct.std()
    fig.add_vline(x=mu, line=dict(color=COL_ACCENT, dash="dash"),
                  annotation_text=f"평균 {mu:.2f}%", annotation_position="top")
    fig.add_vline(x=var95, line=dict(color=COL_NEG, dash="dot"),
                  annotation_text=f"VaR 95% {var95:.2f}%", annotation_position="bottom")
    fig.add_vline(x=cvar95, line=dict(color="#7b1d1d"),
                  annotation_text=f"CVaR 95% {cvar95:.2f}%", annotation_position="bottom")
    fig.update_layout(**_base_layout("일간 수익률 분포 · VaR/CVaR"))
    fig.update_xaxes(ticksuffix="%", showgrid=True, gridcolor="#eee")
    fig.update_yaxes(showgrid=True, gridcolor="#eee")
    return fig


def fig_sector_donut(holdings_df: pd.DataFrame) -> go.Figure:
    g = holdings_df.groupby("sector")["weight"].sum().sort_values(ascending=False)
    fig = go.Figure(go.Pie(
        labels=g.index, values=g.values * 100,
        hole=0.55,
        marker=dict(colors=px.colors.qualitative.Set2),
        textinfo="label+percent",
        hovertemplate="%{label}<br>비중 %{value:.2f}%<extra></extra>",
    ))
    fig.update_layout(**_base_layout("섹터 비중"))
    return fig


def fig_asset_class_bar(holdings_df: pd.DataFrame) -> go.Figure:
    g = holdings_df.groupby("asset_class")["weight"].sum().sort_values(ascending=True) * 100
    fig = go.Figure(go.Bar(
        x=g.values, y=g.index, orientation="h",
        marker=dict(color=[COL_PORT, COL_ACCENT, COL_NEUTRAL, COL_POS, COL_BENCH][:len(g)]),
        text=[f"{v:.2f}%" for v in g.values], textposition="outside",
        hovertemplate="%{y}<br>비중 %{x:.2f}%<extra></extra>",
    ))
    fig.update_layout(**_base_layout("자산군 비중"))
    fig.update_xaxes(ticksuffix="%", showgrid=True, gridcolor="#eee")
    fig.update_yaxes(showgrid=False)
    return fig


def fig_region_treemap(holdings_df: pd.DataFrame) -> go.Figure:
    df = holdings_df.copy()
    df["weight_pct"] = df["weight"] * 100
    fig = px.treemap(
        df,
        path=[px.Constant("포트폴리오"), "region", "sector", "ticker"],
        values="weight_pct",
        color="weight_pct",
        color_continuous_scale="Blues",
        hover_data={"name": True, "weight_pct": ":.2f"},
    )
    fig.update_traces(root_color="#ffffff")
    fig.update_layout(**_base_layout("지역·섹터·종목 Treemap"))
    fig.update_layout(margin=dict(l=0, r=0, t=44, b=0))
    return fig


def fig_top_holdings(holdings_df: pd.DataFrame, top_n: int = 10) -> go.Figure:
    top = holdings_df.sort_values("weight", ascending=True).tail(top_n)
    labels = []
    for _, r in top.iterrows():
        nm = r.get("name", "")
        labels.append(f"{r['ticker']} · {nm}" if pd.notna(nm) and str(nm) else r["ticker"])
    fig = go.Figure(go.Bar(
        x=top["weight"].values * 100, y=labels, orientation="h",
        marker=dict(color=COL_PORT),
        text=[f"{w*100:.2f}%" for w in top["weight"]],
        textposition="outside",
        hovertemplate="%{y}<br>비중 %{x:.2f}%<extra></extra>",
    ))
    fig.update_layout(**_base_layout(f"Top {top_n} 비중 종목"))
    fig.update_xaxes(ticksuffix="%", showgrid=True, gridcolor="#eee")
    fig.update_yaxes(showgrid=False)
    return fig


def fig_correlation(prices: pd.DataFrame, tickers: list[str]) -> go.Figure:
    rets = log_returns(prices[tickers])
    corr = rets.corr()
    fig = go.Figure(data=go.Heatmap(
        z=corr.values, x=corr.columns, y=corr.index,
        colorscale=[[0, "#1D3557"], [0.5, "#FFFFFF"], [1, "#E63946"]],
        zmid=0, zmin=-1, zmax=1,
        text=[[f"{v:.2f}" for v in row] for row in corr.values],
        texttemplate="%{text}", textfont=dict(size=10),
        hovertemplate="%{y} · %{x}<br>상관계수 %{z:.3f}<extra></extra>",
        colorbar=dict(thickness=10),
    ))
    fig.update_layout(**_base_layout("종목 간 일간수익률 상관관계"))
    return fig


def fig_rolling_vol(port_rets: pd.Series, window: int = 60) -> go.Figure:
    roll = port_rets.rolling(window).std() * np.sqrt(252) * 100
    fig = go.Figure()
    fig.add_trace(go.Scatter(
        x=roll.index, y=roll.values, line=dict(color=COL_ACCENT, width=2),
        name=f"{window}일 이동 변동성",
        hovertemplate="%{x|%Y-%m-%d}<br>연환산 변동성 %{y:.2f}%<extra></extra>",
    ))
    fig.update_layout(**_base_layout(f"{window}일 이동 연환산 변동성"))
    fig.update_yaxes(ticksuffix="%", showgrid=True, gridcolor="#eee")
    fig.update_xaxes(showgrid=True, gridcolor="#eee")
    return fig


def fig_rolling_sharpe_beta(
    port_rets: pd.Series,
    bench_rets: Optional[pd.Series],
    window: int = 63,
) -> go.Figure:
    """Two-axis rolling Sharpe (left) + rolling Beta (right)."""
    s = rolling_sharpe(port_rets, window=window)
    fig = go.Figure()
    fig.add_trace(go.Scatter(
        x=s.index, y=s.values, line=dict(color=COL_PORT, width=2),
        name=f"Rolling Sharpe ({window}d)",
        hovertemplate="%{x|%Y-%m-%d}<br>Sharpe %{y:.2f}<extra></extra>",
    ))
    if bench_rets is not None:
        b = rolling_beta(port_rets, bench_rets, window=window)
        fig.add_trace(go.Scatter(
            x=b.index, y=b.values, line=dict(color=COL_BENCH, width=2, dash="dot"),
            name=f"Rolling Beta ({window}d)",
            yaxis="y2",
            hovertemplate="%{x|%Y-%m-%d}<br>Beta %{y:.2f}<extra></extra>",
        ))
    fig.update_layout(
        **_base_layout(f"롤링 Sharpe & Beta ({window}일)"),
        yaxis=dict(title="Sharpe", showgrid=True, gridcolor="#eee"),
        yaxis2=dict(title="Beta", overlaying="y", side="right", showgrid=False),
    )
    fig.update_xaxes(showgrid=True, gridcolor="#eee")
    # zero reference line on left axis
    fig.add_hline(y=0, line=dict(color="#cccccc", dash="dash"))
    return fig


def fig_stress_test(stress: list[dict]) -> go.Figure:
    names = [s["scenario"] for s in stress][::-1]
    pnls = [s["pnl_pct"] * 100 for s in stress][::-1]
    colors = [COL_POS if v >= 0 else COL_NEG for v in pnls]
    fig = go.Figure(go.Bar(
        x=pnls, y=names, orientation="h",
        marker=dict(color=colors),
        text=[f"{v:+.2f}%" for v in pnls], textposition="outside",
        hovertemplate="%{y}<br>포트 손익 %{x:+.2f}%<extra></extra>",
    ))
    fig.update_layout(**_base_layout("스트레스 시나리오별 1일 포트 손익"))
    fig.update_xaxes(ticksuffix="%", showgrid=True, gridcolor="#eee", zeroline=True,
                     zerolinecolor="#999")
    fig.update_yaxes(showgrid=False)
    return fig


def fig_underwater(port_rets: pd.Series, bench_rets: Optional[pd.Series],
                   bench_ticker: str = "SPY") -> go.Figure:
    """Portfolio vs benchmark drawdown side-by-side (아래로 갈수록 나쁨)."""
    cum_p = cumulative_from_log(port_rets)
    dd_p = (cum_p / cum_p.cummax() - 1) * 100
    fig = go.Figure()
    fig.add_trace(go.Scatter(
        x=dd_p.index, y=dd_p.values, name="포트",
        line=dict(color=COL_PORT, width=1.6), fill="tozeroy",
        fillcolor="rgba(46,134,171,0.18)",
        hovertemplate="%{x|%Y-%m-%d}<br>포트 DD %{y:.2f}%<extra></extra>",
    ))
    if bench_rets is not None:
        cum_b = cumulative_from_log(bench_rets)
        dd_b = (cum_b / cum_b.cummax() - 1) * 100
        fig.add_trace(go.Scatter(
            x=dd_b.index, y=dd_b.values, name=bench_ticker,
            line=dict(color=COL_BENCH, width=1.4, dash="dot"),
            hovertemplate="%{x|%Y-%m-%d}<br>" + bench_ticker + " DD %{y:.2f}%<extra></extra>",
        ))
    fig.update_layout(**_base_layout("포트 vs 벤치 Underwater Curve"))
    fig.update_yaxes(ticksuffix="%", showgrid=True, gridcolor="#eee")
    fig.update_xaxes(showgrid=True, gridcolor="#eee")
    return fig
