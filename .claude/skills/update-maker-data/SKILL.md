---
name: update-maker-data
description: js/data.js の選定テーブル（LBSヒューズ・MCCB/ACB の定格と遮断容量・THR・CT・EB・電線/銅バー・標準容量・%Z）をカタログや規準の値で更新する手順。ユーザーがカタログ PDF・画像・型番・定格を提示して表の修正を求めたときに使う。
---

# 選定データの更新

1. 出典（カタログ名・版数・ページ）を確認する。推測値で上書きしない。
   - PDF が `pdftotext` で読めない日本語表は `pip install pymupdf` → `page.get_pixmap(dpi=150, clip=...)` で画像化して目視。
2. `js/data.js` の該当テーブルを編集する。

| テーブル | 形式 |
|---|---|
| `capacities.single/three/scott` | 標準容量 kVA（昇順） |
| `defaultZ.single/three/three400` | `[kVA以上, %Z]` |
| `lbs.makers.mitsubishi.single/three[3300|6600]` | `[kVA, [G,T]最小, [G,T]最大]`（`'※'`=CLS M400A、`null`=—） |
| `lbs.makers.mitsubishi.combined` | `[Im 以下, [G,T]]`（表5(2)） |
| `lbs.makers.fuji.oil/mold[3300|6600]` | `rows`(三相kVA, 0=なし) × `cols`(単相kVA, 0=なし) の `g` 行列 |
| `breaker.makers.<maker>.list` | MCCB。**フレーム昇順→同フレームは下位グレード順**。`{model, af, ratings[], icu:[230V級,440V級], branchAf?}` |
| `breaker.makers.<maker>.acb` | ACB。同上の並び。富士 DH は icu=[JEC220V, JIS440V] |
| `ct` | `factor`, `primaries[]`（/5A、Y-0550 CWシリーズ）、`models`=`[一次A以下, 形名, VA]` |
| `thr` | `{name, model, step}`（富士 TU-0、整定は step 単位で切り捨て） |
| `eb.table` | `[100V級, 200V級, 400V級 の一相分kVA以下, mm²]`（表2.13.1） |
| `eb.table2` | `[遮断器定格A以下, 表示, 比較用mm², 'R4'?]`（表2.13.2。4番目 'R4' は令和4年版からの参考値） |
| `cable.tables[]` | `{group, temp, name, basis, limits[], sizes[]}`（60℃ IV・FP と 75℃ の2表。A以下→sq、昇順・同数、最小5.5sq）、`maxParallel:2`、`parallelRatio:0.6` |
| `busCable.tables[]` | 母線電線の許容電流表（IV・FP 60℃・HIV・EM-IE・EM-LMFC 75℃）。形式は `cable.tables` と同じ |
| `busbar.table` | `[表示名, 許容A]`（許容電流の昇順） |

3. 確認済みテーブルは `verified: true`、`version` を当日の日付（同日複数回は末尾に英字）に。
4. 転記した代表値を `tests/calc.test.js` に追加して照合する。
5. `npm run check && npm test` を全て pass させる。
6. `sw.js` の `CACHE` 名を上げる（例 `tr-select-v11` → `v12`）。
7. CLAUDE.md / README.md の出典表を更新し、コミットメッセージに出典（カタログ名・版）を書く。
