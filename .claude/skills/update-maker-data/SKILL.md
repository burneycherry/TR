---
name: update-maker-data
description: js/data.js のメーカー選定テーブル（限流ヒューズ・THR・ブレーカーIcu・電線/銅バー許容電流）をカタログ値で更新する手順。ユーザーがカタログ値・型番・定格を提示して表の修正を求めたときに使う。
---

# メーカー選定データの更新

1. ユーザーが提示した値（カタログ名・版数）を確認する。推測値で上書きしない。
2. `js/data.js` の該当テーブルを編集する。
   - 三菱ヒューズ：`lbs.makers.mitsubishi.single/three[電圧]` = `[kVA, [G,T]最小, [G,T]最大]`（'※'=CLS M400A, null=—）、`combined` = `[Im以下, [G,T]]`。
   - 富士ヒューズ：`lbs.makers.fuji.oil/mold[電圧]` の `rows`(三相kVA)×`cols`(単相kVA) と `g` 行列（行列サイズはテストで検証）。
   - 画像から転記した場合は、転記後にテストへ代表値を数件追加して照合する。
   - THR：`thr.makers.<maker>.heaters` = `[呼び, 最小, 最大]`。
   - ブレーカー：`breaker.makers.<maker>.list` は **小フレーム→下位グレードの順**。`icu: [230V級, 440V級]`。
   - EB：`eb.table` = `[100V級, 200V級, 400V級 の一相分kVA以下, mm²]`。
   - 電線：`cable.table` = `[sq, A]` 昇順。銅バー：`busbar.table` = `[表示名, A]` 許容電流の昇順。
3. 確認済みのテーブルは `verified: true`、`version` を当日の日付に。
4. `npm run check && npm test` を実行し全て pass させる。
5. `sw.js` の `CACHE` 名を上げる（例 `tr-select-v2`）。
6. コミットメッセージに出典（カタログ名・版）を書く。
