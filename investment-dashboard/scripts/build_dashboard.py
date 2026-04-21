"""Compose a single-file Plotly HTML dashboard from figures.

Layout (fixed, mirrors SKILL.md):
  header  →  Executive summary band  →  KPI cards (7)
         →  Row 1: 누적수익률 · 월 히트맵
         →  Row 2: Drawdown(포트vs벤치) · 수익률 분포(+VaR/CVaR)
         →  Row 3: 롤링 Sharpe·Beta · 이동 변동성
         →  Row 4: 스트레스 시나리오 · 상관관계
         →  Row 5: 섹터 도넛 · 자산군 바 · 지역 Treemap
         →  Row 6: Top10 · Insights side-panel
         →  footer
Only the first figure block includes Plotly.js (via CDN); the rest are
embedded with include_plotlyjs=False to keep the file lean.
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

import pandas as pd
import plotly.graph_objects as go
import plotly.io as pio


def _fig_html(fig: go.Figure, include_js: bool = False, div_id: Optional[str] = None) -> str:
    return pio.to_html(
        fig,
        include_plotlyjs="cdn" if include_js else False,
        full_html=False,
        div_id=div_id,
        config={"displaylogo": False, "responsive": True,
                "modeBarButtonsToRemove": ["lasso2d", "select2d"]},
    )


def _kpi_card(label: str, value: str, tone: str = "neutral", sub: str = "") -> str:
    color = {
        "pos": "#2A9D8F", "neg": "#E76F51", "neutral": "#2E86AB",
        "warn": "#F4A261", "ink": "#1f2937",
    }.get(tone, "#2E86AB")
    sub_html = f'<div class="kpi-sub">{sub}</div>' if sub else ""
    return f"""
<div class="kpi-card">
  <div class="kpi-label">{label}</div>
  <div class="kpi-value" style="color:{color}">{value}</div>
  {sub_html}
</div>""".strip()


def _fmt_pct(x, decimals: int = 2) -> str:
    if x is None or pd.isna(x):
        return "–"
    return f"{x*100:+.{decimals}f}%"


def _fmt_pct_unsigned(x, decimals: int = 2) -> str:
    if x is None or pd.isna(x):
        return "–"
    return f"{x*100:.{decimals}f}%"


def _fmt_ratio(x) -> str:
    if x is None or pd.isna(x):
        return "–"
    return f"{x:.2f}"


def build(
    prices: pd.DataFrame,
    holdings_df: pd.DataFrame,
    summary: dict,
    figs: dict[str, go.Figure],
    insights: list[str],
    title: str = "Investment Dashboard",
    benchmark: str = "SPY",
) -> str:
    p = summary["portfolio"]
    b = summary.get("vs_benchmark") or {}

    # --- KPI tones ---
    cagr_tone = "pos" if p["cagr"] >= 0 else "neg"
    sharpe_tone = (
        "pos" if (p.get("sharpe") or 0) >= 1
        else ("warn" if (p.get("sharpe") or 0) >= 0.5 else "neg")
    )
    mdd_tone = "neg" if p["mdd"] < -0.15 else "warn"

    # Alpha card only if benchmark exists
    alpha_card = _kpi_card(
        "Jensen α vs " + benchmark,
        _fmt_pct(b.get("alpha")),
        tone=("pos" if (b.get("alpha") or 0) > 0 else "neg"),
        sub=f"β {_fmt_ratio(b.get('beta'))} · IR {_fmt_ratio(b.get('information_ratio'))}",
    ) if b else _kpi_card("집중도 HHI", f"{p['hhi']:.3f}", tone="neutral",
                           sub="0에 가까울수록 분산")

    kpi_row = "\n".join([
        _kpi_card(
            "누적수익률",
            _fmt_pct(p.get("total_return")),
            tone=cagr_tone,
            sub=(f"벤치 {benchmark}: {_fmt_pct((1+b['cagr'])**((pd.to_datetime(summary['period']['end'])-pd.to_datetime(summary['period']['start'])).days/365.25)-1)}" if b else ""),
        ),
        _kpi_card(
            "연환산 수익률 (CAGR)", _fmt_pct(p["cagr"]), tone=cagr_tone,
            sub=(f"벤치 {benchmark}: {_fmt_pct(b.get('cagr'))}" if b else ""),
        ),
        _kpi_card(
            "연환산 변동성", _fmt_pct_unsigned(p["ann_vol"]), tone="neutral",
            sub=(f"벤치 {benchmark}: {_fmt_pct_unsigned(b.get('ann_vol'))}" if b else ""),
        ),
        _kpi_card(
            "Sharpe (Rf=3.5%)", _fmt_ratio(p["sharpe"]), tone=sharpe_tone,
            sub=f"Sortino {_fmt_ratio(p['sortino'])}",
        ),
        _kpi_card(
            "최대낙폭 (MDD)", _fmt_pct(p["mdd"]), tone=mdd_tone,
            sub=f"{p['mdd_peak']} → {p['mdd_trough']}",
        ),
        _kpi_card(
            "VaR / CVaR 95%",
            f"{-p['var_95']*100:.2f}% / {-p['cvar_95']*100:.2f}%",
            tone="neg",
            sub="일간 기준 (역사적)",
        ),
        alpha_card,
    ])

    # --- Composition summary strip (asset-class pills) ---
    ac = summary["composition"]["by_asset_class"]
    ac_pills = " ".join(
        f'<span class="pill">{k} <b>{v*100:.1f}%</b></span>' for k, v in ac.items()
    )

    # --- Stress-test mini table ---
    stress = summary.get("stress") or []
    stress_rows = "".join(
        f'<tr><td>{s["scenario"]}</td>'
        f'<td class="{"neg" if s["pnl_pct"]<0 else "pos"}">{s["pnl_pct"]*100:+.2f}%</td></tr>'
        for s in stress
    )

    insights_html = "".join(f"<li>{s}</li>" for s in insights)

    # Executive summary line (first insight)
    exec_line = insights[0] if insights else ""

    # --- Figure HTML (only first one emits Plotly.js) ---
    figs_html = {}
    is_first = True
    for key, fig in figs.items():
        figs_html[key] = _fig_html(fig, include_js=is_first, div_id=f"fig_{key}")
        is_first = False

    html = f"""<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>{title}</title>
<link rel="preconnect" href="https://cdn.jsdelivr.net" />
<link href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/variable/pretendardvariable.css" rel="stylesheet" />
<style>
  :root {{
    --bg:#f4f6fb; --card:#ffffff; --border:#e4e7ee; --ink:#0f172a;
    --muted:#64748b; --accent:#2E86AB; --pos:#2A9D8F; --neg:#E76F51;
  }}
  * {{ box-sizing:border-box; }}
  body {{
    margin:0; background:var(--bg); color:var(--ink);
    font-family:'Pretendard Variable', Pretendard, -apple-system, 'Noto Sans KR', sans-serif;
    font-size:14px; line-height:1.55;
  }}
  header {{
    padding:24px 32px 64px; background:linear-gradient(135deg,#0f3b6b 0%,#2E86AB 50%,#3fa7c4 100%);
    color:white; position:relative;
  }}
  header h1 {{ margin:0 0 8px; font-size:24px; font-weight:800; letter-spacing:-0.02em; }}
  header .meta {{ font-size:13px; opacity:0.88; }}
  header .pills {{ margin-top:12px; display:flex; flex-wrap:wrap; gap:6px; }}
  .pill {{
    background:rgba(255,255,255,0.18); border:1px solid rgba(255,255,255,0.3);
    padding:3px 10px; border-radius:12px; font-size:12px;
  }}
  .container {{ max-width:1440px; margin:0 auto; padding:0 24px 48px; }}

  .exec-band {{
    background:#fff; border:1px solid var(--border); border-radius:12px;
    padding:16px 20px; margin:-40px 0 14px; position:relative; z-index:3;
    box-shadow:0 6px 16px rgba(12,32,72,0.08);
    display:flex; align-items:center; gap:14px;
  }}
  .exec-band .badge {{
    display:inline-block; background:#fff9ea; color:#8a6d3b; border:1px solid #f0dba5;
    padding:2px 10px; border-radius:8px; font-size:11px; font-weight:600;
  }}
  .exec-band .text {{ font-size:14.5px; color:var(--ink); font-weight:500; }}

  .kpi-grid {{
    display:grid; grid-template-columns:repeat(7, 1fr); gap:10px;
    margin:0 0 14px; position:relative; z-index:2;
  }}
  .kpi-card {{
    background:var(--card); border:1px solid var(--border); border-radius:10px;
    padding:12px 14px; box-shadow:0 2px 6px rgba(15,23,42,0.04);
  }}
  .kpi-label {{ font-size:11.5px; color:var(--muted); font-weight:500; letter-spacing:0.01em; }}
  .kpi-value {{ font-size:20px; font-weight:700; margin-top:4px; letter-spacing:-0.02em; }}
  .kpi-sub {{ font-size:11px; color:var(--muted); margin-top:3px; }}

  .row {{ display:grid; gap:14px; margin-top:14px; }}
  .row.row-2 {{ grid-template-columns:1.15fr 1fr; }}
  .row.row-2b {{ grid-template-columns:1fr 1fr; }}
  .row.row-3 {{ grid-template-columns:1fr 1fr 1fr; }}
  .row.row-2-wide {{ grid-template-columns:1.6fr 1fr; }}
  .panel {{
    background:var(--card); border:1px solid var(--border); border-radius:10px;
    padding:6px 8px 8px; overflow:hidden;
  }}
  .panel .caption {{
    font-size:11.5px; color:var(--muted); padding:2px 10px 6px;
  }}
  .panel.table-panel {{ padding:14px 18px; }}
  .panel.table-panel h3 {{ margin:0 0 8px; font-size:14px; color:var(--ink); }}
  .panel.table-panel table {{ width:100%; border-collapse:collapse; font-size:13px; }}
  .panel.table-panel td, .panel.table-panel th {{
    padding:6px 4px; border-bottom:1px dashed #eef1f6;
  }}
  .panel.table-panel td.pos {{ color:var(--pos); font-weight:600; }}
  .panel.table-panel td.neg {{ color:var(--neg); font-weight:600; }}

  .insights {{
    background:#fff9ea; border:1px solid #f0dba5; border-radius:10px;
    padding:14px 18px; margin-top:14px;
  }}
  .insights h3 {{ margin:0 0 8px; font-size:14px; color:#8a6d3b; }}
  .insights ul {{ margin:0; padding-left:20px; }}
  .insights li {{ margin-bottom:4px; }}

  footer {{
    color:var(--muted); font-size:11px; text-align:center; padding:18px 0 0;
  }}

  @media (max-width:1280px) {{
    .kpi-grid {{ grid-template-columns:repeat(4, 1fr); }}
  }}
  @media (max-width:1024px) {{
    .kpi-grid {{ grid-template-columns:repeat(2, 1fr); }}
    .row.row-2, .row.row-2b, .row.row-2-wide, .row.row-3 {{ grid-template-columns:1fr; }}
  }}
</style>
</head>
<body>
  <header>
    <h1>{title}</h1>
    <div class="meta">
      분석 기간 <b>{summary['period']['start']} ~ {summary['period']['end']}</b>
      &middot; 거래일 {summary['period']['trading_days']}일
      &middot; 벤치마크 {benchmark}
      &middot; 포지션 {summary['composition']['n_positions']}개
      &middot; 생성 {datetime.now().strftime('%Y-%m-%d %H:%M')}
    </div>
    <div class="pills">{ac_pills}</div>
  </header>

  <div class="container">
    <div class="exec-band">
      <span class="badge">Executive Summary</span>
      <span class="text">{exec_line}</span>
    </div>

    <section class="kpi-grid">
      {kpi_row}
    </section>

    <div class="row row-2-wide">
      <div class="panel">{figs_html['cumulative']}
        <div class="caption">그림 1 — 포트폴리오와 벤치마크의 누적 수익률 추이. 격차가 곧 알파.</div>
      </div>
      <div class="panel">{figs_html['heatmap']}
        <div class="caption">그림 2 — 월별 수익률(%). 녹색 양(+), 붉은색 음(-). 연중 편향 식별.</div>
      </div>
    </div>

    <div class="row row-2">
      <div class="panel">{figs_html['underwater']}
        <div class="caption">그림 3 — 포트 vs 벤치 Underwater. 포트 꼬리가 더 깊으면 헤지 재검토.</div>
      </div>
      <div class="panel">{figs_html['distribution']}
        <div class="caption">그림 4 — 일간수익률 분포와 VaR/CVaR 선. 꼬리두께 = 꼬리위험.</div>
      </div>
    </div>

    <div class="row row-2b">
      <div class="panel">{figs_html['rolling_sb']}
        <div class="caption">그림 5 — 롤링 Sharpe(좌)·Beta(우). 시장 국면 변화에 대한 민감도.</div>
      </div>
      <div class="panel">{figs_html['rolling_vol']}
        <div class="caption">그림 6 — 60일 이동 연환산 변동성. 상승 국면 = 리스크 온.</div>
      </div>
    </div>

    <div class="row row-2">
      <div class="panel">{figs_html['stress']}
        <div class="caption">그림 7 — 사전 정의된 충격 시나리오 적용 시 1일 포트 손익 추정.</div>
      </div>
      <div class="panel table-panel">
        <h3>스트레스 손익 요약</h3>
        <table>
          <thead><tr><th>시나리오</th><th>포트 손익</th></tr></thead>
          <tbody>{stress_rows}</tbody>
        </table>
      </div>
    </div>

    <div class="row row-2">
      <div class="panel">{figs_html['correlation']}
        <div class="caption">그림 8 — 보유종목 간 상관관계. 1에 가까우면 분산 실패.</div>
      </div>
      <div class="panel">{figs_html['asset_class']}
        <div class="caption">그림 9 — 자산군(주식/채권/원자재/부동산) 비중.</div>
      </div>
    </div>

    <div class="row row-3">
      <div class="panel">{figs_html['sector']}
        <div class="caption">그림 10 — 섹터별 비중. 쏠림 여부 판별.</div>
      </div>
      <div class="panel">{figs_html['region']}
        <div class="caption">그림 11 — 지역·섹터·종목 계층 구조.</div>
      </div>
      <div class="panel">{figs_html['top_holdings']}
        <div class="caption">그림 12 — 상위 10개 종목 비중.</div>
      </div>
    </div>

    <section class="insights">
      <h3>핵심 인사이트 · 리스크 플래그 · 실행 제안</h3>
      <ul>{insights_html}</ul>
    </section>

    <footer>
      Investment Dashboard Skill · v1.1 · 단일 파일 HTML · Pretendard · Plotly via CDN
    </footer>
  </div>
</body>
</html>
"""
    return html
