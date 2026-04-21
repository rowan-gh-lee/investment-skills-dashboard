---
name: investment-data-schema
description: Use this skill whenever ingesting investment data from varied sources (CSV/XLSX/JSON) — auto-detects price time series shape (wide/long), maps flexible column names, handles missing columns with defaults, validates weight sums, normalizes currencies. Gives a canonical in-memory representation regardless of input quirks.
version: 1.0.0
license: MIT
---

# 02 · 데이터 스키마 Skills.md

사용자의 실제 투자 데이터는 **구조가 매번 다릅니다**. 본 문서는 원본 파일의 형식 차이를 흡수하고, 분석 단계(01)에 **정규화된 3개 테이블**을 공급하는 규칙을 정의합니다.

## 정규화 타깃 (Canonical In-Memory)

| 이름 | 타입 | 형태 |
|---|---|---|
| `prices` | `pd.DataFrame` | `DatetimeIndex × tickers`, 값은 조정종가(float) |
| `holdings` | `pd.DataFrame` | cols=`ticker, name, sector, asset_class, region, weight, currency` |
| `transactions` | `pd.DataFrame?` | cols=`date, ticker, side, qty, price, fee` (선택) |

## A) 가격 시계열

### 입력 허용 포맷

| 형식 | 예 | 감지 규칙 |
|---|---|---|
| Wide CSV/XLSX | `date, AAPL, MSFT, ...` | 날짜 컬럼 하나 + 나머지 숫자 컬럼 |
| Long CSV | `date, ticker, close` | 컬럼이 정확히 3개 + `ticker` 존재 → pivot |
| JSON (nested) | `{AAPL: [{date, close}, ...]}` | top-level이 티커 키 |

### 자동 매핑 규칙

**날짜 컬럼 탐지 우선순위**: `date` → `날짜` → `기준일` → `trade_date` → `Date` → 첫 번째 컬럼.

**가격 컬럼 정규화**:
- 컬럼명에 공백/한글 허용, 내부적으로 `strip()`.
- 숫자 변환: `pd.to_numeric(errors="coerce")`.
- 음수 가격 → NaN 치환 + 경고.
- 이상치: 일간 변동 ±50% 초과 시 flag (삭제는 하지 않음).

**결측 처리**:
- `ffill(limit=5)` — 5영업일까지 전값 유지.
- `ffill` 후에도 남은 NaN 행은 **선행 행**에 한해 `dropna(how='all')`.
- 특정 티커가 전 기간 중간부터 시작하면 그대로 유지 (신규 상장 케이스).

## B) 포트폴리오 보유종목

### 최소 요구 컬럼

| 컬럼 | 필수 | 기본값 (없을 때) |
|---|---|---|
| `ticker` | ✅ | – |
| `weight` | ✅ | – |
| `name` | ❌ | `""` |
| `sector` | ❌ | `"Unknown"` |
| `asset_class` | ❌ | `"Equity"` |
| `region` | ❌ | `"Unknown"` |
| `currency` | ❌ | `"USD"` |

### `weight` 검증

1. `abs(sum - 1.0) > 0.005` → 경고 + **자동 재정규화** (`w_i / Σw`).
2. 음수 가중치 (숏 포지션) 허용, 합이 1일 필요는 없음 (경고는 띄움).
3. 동일 티커 중복 → 가중치 합산.

### 허용값 목록

```
asset_class ∈ {Equity, Bond, Commodity, RealEstate, Cash, Derivative, Alternative}
region      ∈ {US, KR, JP, CN, EU, DM-exUS, EM, Global, Unknown}
sector      ∈ 임의 (문자열 그대로 유지, 표기 통일만 권장)
```

## C) 거래 내역 (선택)

| 컬럼 | 필수 | 비고 |
|---|---|---|
| `date` | ✅ | ISO-8601 파싱 |
| `ticker` | ✅ | – |
| `side` | ✅ | `BUY` / `SELL` (대소문자 무시) |
| `qty` | ✅ | 음수 가능 (매도를 음수 qty로 기록하는 관행 허용) |
| `price` | ✅ | 체결가 |
| `fee` | ❌ | 기본 0 |

거래내역이 있으면 `01 분석`의 PnL 기여도를 **실현/미실현** 분리하여 계산.

## 입력 스키마 감지 의사코드

```python
def detect_prices_shape(df):
    # Long vs Wide
    if set(df.columns.str.lower()) >= {"date", "ticker", "close"}:
        return "long"
    if df.shape[1] >= 3 and _looks_like_date(df.iloc[:, 0]):
        return "wide"
    raise ValueError("price shape unrecognized")

def normalize_prices(df):
    shape = detect_prices_shape(df)
    if shape == "long":
        df = df.pivot(index="date", columns="ticker", values="close")
    else:
        df = df.set_index(_find_date_col(df)).apply(pd.to_numeric, errors="coerce")
    return df.sort_index().ffill(limit=5).dropna(how="all")
```

## 통화 정규화

`holdings.currency`가 혼재된 경우 Python/JS 양쪽에서 **결정론적 FX 변환**을 적용합니다.

### 환율 테이블 (SSOT)

`fx_rates.json` 을 가격 파일과 같은 경로 (또는 `webapp/data/fx_rates.json`) 에 둡니다.

```json
{
  "_meta": {"base": "USD", "as_of": "YYYY-MM-DD"},
  "USD": 1.0, "KRW": 0.000724, "JPY": 0.00661, "EUR": 1.09, ...
}
```

값은 **1 local = rate × base** 규칙. `_` 로 시작하는 키는 메타데이터(계산 제외).

### 변환 공식

```
price_base(ticker) = price_local(ticker) × rate[ holdings.currency[ticker] ]
rate[base] = 1.0           # 기준통화 열은 변경 없음
```

- Python: `ingest.convert_prices_to_base(prices, holdings, fx_rates, base="USD")`
- JS: `convertPricesToBase(priceData, holdings, fxRates, base="USD")`

두 구현은 같은 공식으로 포팅되며 `webapp/smoketest.js` 에 교차 검증 추가.

### Fallback 순서

1. `--fx-rates` CLI / `fx_rates.json` 자동 탐지 성공 → 변환 적용
2. 파일 없음 또는 특정 통화 매핑 누락 → **해당 티커 열은 로컬 통화 유지**, 경고 로그 + UI 배너로 사용자에게 고지
3. 모든 `holdings.currency == base` → no-op (기존 재현성 보장)

### 수학적 특성 (중요)

환율이 **시간 불변의 상수** (as_of 스냅샷) 일 때, 로그수익률은 환율에 대해 불변:

```
ln(P_t · r / P_{t-1} · r) = ln(P_t / P_{t-1})
```

즉 **constant-rate FX 변환은 CAGR · Vol · Sharpe · MDD · Beta 등 수익률 기반 KPI 를 전혀 바꾸지 않는다**. FX 변환이 실제로 바뀌는 값을 만드는 지점은 다음 두 가지뿐:

1. 가격 수준 (nominal value) 을 표시하거나 합산할 때 (예: "포트폴리오 평가액 $X")
2. 환율이 시점별로 다른 time-varying FX 를 적용할 때 (향후 확장)

본 구현은 (1) 용도 — 가격 수준의 통화 일관성 확보 — 를 담당하며, KPI 재현성은 기존 스모크테스트가 계속 보장.

## 검증 체크리스트 (인제스트 직후)

```
✓ prices.index is DatetimeIndex, sorted, unique
✓ 모든 티커 컬럼은 numeric
✓ holdings.weight.sum() == 1.0 (±0.005) else renormalize + warn
✓ holdings.ticker ⊂ prices.columns ∪ {"Unknown"}
✓ 기간 길이 ≥ 60영업일 (그 미만이면 KPI 경고)
```

검증 실패 항목은 **전부 로그에 찍되**, 치명적 실패(= 분석 불가)만 예외 발생. 나머지는 경고 후 진행.

## 샘플 입력 (Tests / Fixture)

본 패키지는 다음 3종 샘플을 번들합니다:

- `assets/data/sample_prices.csv` — 22종목 × 3년 거래일 × 로그정규 시뮬레이션
- `assets/data/sample_holdings.json` — 21포지션, 자산군/지역/섹터 다양
- `assets/data/sample_transactions.csv` — 초기 매수 기록

생성 로직은 결정론적(`RNG seed = 3`)이며, `scripts/generate_sample_data.py` 실행 시 정확히 동일한 데이터가 재생성됩니다.
