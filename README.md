# 変圧器 機器選定 PWA

変圧器の **電源相・容量・一次電圧・二次電圧・%Z（任意）** を入力すると、以下を即時に算出・選定する PWA です。
iOS Safari / ホーム画面追加（PWA）を主対象とし、Android Chrome でも動作します。オフライン対応。

| 項目 | 内容 |
|---|---|
| 一次電流・二次電流 | 三相 `kVA×1000/(√3×V)`、単相 `kVA×1000/V` |
| 二次側短絡電流 | `I₂×100/%Z`（%Z未入力時は容量別の標準値、一次側短絡電流[kA]入力時は電源側%Zを加算） |
| LBS 限流ヒューズ | 三菱 / 富士 の T形（変圧器用）定格。`定格 ≥ I₁×2.0` の最小値。300kVA超・22kVは警告 |
| 二次側 CT | `CT一次 ≥ I₂×1.25` の最小標準値 / 5A |
| 二次側 THR | 整定値 `I₂×5/CT一次`、三菱 TH-T18系・富士 TK-E2系のヒータ呼び |
| 主幹ブレーカー | 三菱 WS-V/AE-SW・富士 G-TWIN/ACB から `定格 ≥ I₂` かつ `Icu ≥ 短絡電流` の最小フレーム・最下位グレード |
| 電線・銅バー | 主幹ブレーカー定格以上で CVT サイズ（並列条数含む）と裸銅バーサイズ |

## ⚠️ 参考値について

メーカー別の選定値（ヒューズ・THR・ブレーカー Icu）、電線・銅バー許容電流は **`js/data.js` に集約した参考値** です。
作成時にメーカーカタログを直接参照できなかったため、画面上は「要確認」バッジを表示しています。
最新カタログで確認・修正後、該当テーブルの `verified: true` にするとバッジが消えます。

## 使い方

1. GitHub Pages で公開した URL を iPhone の Safari で開く
2. 共有ボタン →「ホーム画面に追加」で PWA としてインストール
3. 入力値は端末内（localStorage）に保存され、次回起動時に復元。「結果をコピー」でテキスト出力

## 構成

```
index.html             画面
css/style.css          スタイル（CSSカスタムプロパティ不使用）
js/data.js             選定テーブル（参考値・ここだけ編集すれば選定が変わる）
js/calc.js             計算ロジック（DOM非依存、Node でテスト可）
js/app.js              UI
sw.js                  Service Worker（ネットワーク優先＋キャッシュ）
manifest.webmanifest   PWA マニフェスト
icons/                 アイコン
tests/calc.test.js     単体テスト
```

## 開発

ビルド不要の素の HTML/CSS/JS です。

```sh
npm run check   # 構文チェック（SyntaxError 検出）
npm test        # 計算ロジックの単体テスト
python3 -m http.server 8000   # ローカル確認 http://localhost:8000/
```

## 動作確認（GitHub Pages）

Settings → Pages → Source: *Deploy from a branch* → 作業ブランチ / `(root)` を選択。
`.nojekyll` 配置済み。全パスは相対指定なので `https://<user>.github.io/<repo>/` 配下で動作します。
更新が反映されない場合は、ページを再読み込み（SW はネットワーク優先のため通常は即反映）。
