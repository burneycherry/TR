---
name: update-maker-data
description: js/data.js のメーカー選定テーブル（限流ヒューズ・THR・ブレーカーIcu・電線/銅バー許容電流）をカタログ値で更新する手順。ユーザーがカタログ値・型番・定格を提示して表の修正を求めたときに使う。
---

# メーカー選定データの更新

1. ユーザーが提示した値（カタログ名・版数）を確認する。推測値で上書きしない。
2. `js/data.js` の該当テーブルを編集する。
   - ヒューズ：`lbs.makers.<maker>.series`（定格の昇順）と `factor`。容量→定格の固定表が必要なら
     `calc.js` の `selectFuse` に表引きを追加し、表が無い容量は係数方式にフォールバック。
   - THR：`thr.makers.<maker>.heaters` = `[呼び, 最小, 最大]`。
   - ブレーカー：`breaker.makers.<maker>.list` は **小フレーム→下位グレードの順**。`icu: [230V級, 440V級]`。
   - 電線：`cable.table` = `[sq, A]` 昇順。銅バー：`busbar.table` = `[表示名, A]` 許容電流の昇順。
3. 確認済みのテーブルは `verified: true`、`version` を当日の日付に。
4. `npm run check && npm test` を実行し全て pass させる。
5. `sw.js` の `CACHE` 名を上げる（例 `tr-select-v2`）。
6. コミットメッセージに出典（カタログ名・版）を書く。
