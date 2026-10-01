# CLAUDE.md

変圧器の機器選定 PWA（素の HTML/CSS/JS、ビルドなし）。詳細は README.md。

## ユーザー要件・制約（厳守）

- 主対象は **iOS Safari / ホーム画面PWA**。Android Chrome でも動くこと。
- **CSS カスタムプロパティ `var(--xxx)` は絶対に使わない**（コピペ時に `--` が `—` に変換され壊れるため）。色は直接記述し、ダークモードは `@media (prefers-color-scheme: dark)` で個別に上書きする。
- **SyntaxError に注意**。変更後は必ず `npm run check` と `npm test` を通す。
- 動作確認は GitHub Pages で作業ブランチを配信して行う → パスは常に相対（`./`、先頭 `/` 禁止）。
- iOS 対策：input/select は `font-size:16px` 以上（ズーム防止）、`env(safe-area-inset-*)` を考慮、横スクロールを出さない。
- localStorage は try/catch で囲み、失敗しても動作継続。

## ファイルの役割

| ファイル | 役割 |
|---|---|
| `js/data.js` | 全選定テーブル。LBSヒューズはカタログ転記(`verified:true`)、他は参考値。グローバル `TR_DATA` |
| `js/calc.js` | 計算ロジック。DOM 非依存。`window.TRCalc` / `module.exports` |
| `js/app.js` | DOM 操作・描画・コピー・SW登録 |
| `sw.js` | ネットワーク優先 + キャッシュフォールバック。**資産を追加したら `ASSETS` に追記し `CACHE` 名を上げる** |
| `tests/calc.test.js` | `node:test` による単体テスト |

script の読み込み順は `data.js → calc.js → app.js`（ES Modules は使わない：file:// やiOS旧版での互換性重視）。

## 計算仕様

- モード：`single` / `three` / `scott`（UI は スコット高圧/低圧・低圧/低圧 を電圧候補で切替）。一次 >600V を高圧扱い
- 電圧は select の候補＋「手入力」（`manual`）。手入力値も localStorage に保存
- 定格電流：三相 `kVA*1000/(√3*V)`、単相 `kVA*1000/V`（単相3線は 210V 基準）
- スコット：一次は三相、二次は M座・T座 各 `kVA/2` の単相回路（CT/THR/主幹/幹線は各座＝2回路分）
- 短絡電流：`Is = I2*100/(%Ztr + %Zsrc)`。R/X 分離なしの簡易計算
  - `%Zsrc = kVA / Ssc * 100`、`Ssc = √3*V1*Isc`（単相は線間：`V1*(√3/2)*Isc`）
  - %Z 未入力は `defaultZ`（低め＝安全側）
- LBS ヒューズ（高圧のみ）：**カタログ選定表の転記値**（係数計算はしない）
  - 三菱 表5(1)：容量行の推奨最小/最大 G(T)。三相＋共用単相(`kva1`)は表5(2)：Im=I3φ+I1φ で選定
  - 富士 JC：油入(FHH-A/FHH-S)/モールド(FM-T26) × 3.3/6.6kV の 三相行×単相列 マトリクス
  - 表にない容量は直近上位行。電圧は 3.0〜3.6kV→3.3、6.0〜7.2kV→6.6、それ以外は表外。スコットは三相表
- 低圧/低圧：LBS の代わりに一次側ブレーカー（`rating ≥ I1*1.25`、Icu は一次側短絡電流入力時のみ）
- EB（B種接地線, 高圧のみ）：一相分容量（三相÷3・単相・スコット÷2）と 100/200/400V級 で表引き
- CT：`primary ≥ I2 * 1.25` の最小標準値（/5A）
- THR：整定 `I2 * 5 / CT一次`、調整範囲に入り中央に近いヒータ
- ブレーカー：`rating ≥ I2`、`Icu(230V級 if V2≤240 else 440V級) ≥ Is`。リスト順（小フレーム→下位グレード）で最初に適合したもの → **リストは必ずその順で並べる**
- 電線・銅バー：各社主幹定格の大きい方以上。電線は単条で無ければ並列条数を増やす

## データ更新ルール

- 数値はメーカー最新カタログで確認してから変更し、確認済みテーブルは `verified: true`。
- 表は昇順（テストで検証）。`version` を更新日に変える。
- 手順は `.claude/skills/update-maker-data/SKILL.md` を参照。

## コーディング規約

- `const`/`let`、`'use strict'`、IIFE。外部ライブラリ・CDN 依存なし（オフライン前提）。
- innerHTML に入れる文字列は `esc()` を通す。
- コメント・UI 文言は日本語。

## 検証手順

1. `npm run check && npm test`
2. `python3 -m http.server` で表示し、iPhone 幅（390px）・ダークモードで崩れ/横スクロールがないか確認
   （Playwright：`/opt/pw-browsers` の Chromium、`devices['iPhone 13']`）
3. ブランチを push → GitHub Pages で実機確認
