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
| `js/data.js` | 全選定テーブル（参考値）。グローバル `TR_DATA`、Node では `module.exports` |
| `js/calc.js` | 計算ロジック。DOM 非依存。`window.TRCalc` / `module.exports` |
| `js/app.js` | DOM 操作・描画・コピー・SW登録 |
| `sw.js` | ネットワーク優先 + キャッシュフォールバック。**資産を追加したら `ASSETS` に追記し `CACHE` 名を上げる** |
| `tests/calc.test.js` | `node:test` による単体テスト |

script の読み込み順は `data.js → calc.js → app.js`（ES Modules は使わない：file:// やiOS旧版での互換性重視）。

## 計算仕様

- 定格電流：三相 `kVA*1000/(√3*V)`、単相 `kVA*1000/V`（単相3線は 210V 基準）
- 短絡電流：`Is = I2*100/(%Ztr + %Zsrc)`。R/X 分離なしの簡易計算
  - `%Zsrc = kVA / Ssc * 100`、`Ssc = √3*V1*Isc`（単相は線間：`V1*(√3/2)*Isc`）
  - %Z 未入力は `defaultZ`（低め＝安全側）
- LBS ヒューズ：`rating ≥ I1 * factor(2.0)` の最小値。300kVA 超・7.2kV級外は警告
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
