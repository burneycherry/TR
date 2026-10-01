/*
 * 選定用データテーブル（参考値）
 * ------------------------------------------------------------
 * ここの数値はすべて「参考値」です。メーカーカタログ・最新の選定表で
 * 必ず確認し、必要に応じて書き換えてください。計算ロジック(calc.js)は
 * このファイルのテーブルだけを参照します。
 * verified: true にした項目は画面上の「要確認」バッジが消えます。
 */
var TR_DATA = {
  version: '2026-10-01',

  // 標準容量 [kVA]（入力候補）
  capacities: {
    single: [5, 10, 15, 20, 30, 50, 75, 100, 150, 200, 300, 500],
    three: [10, 20, 30, 50, 75, 100, 150, 200, 300, 500, 750, 1000, 1500, 2000, 2500, 3000]
  },

  // %Z 未入力時に使う標準的な値（油入・モールド汎用の目安）。
  // 低めの値＝短絡電流が大きく出る＝遮断容量選定では安全側。
  defaultZ: {
    single: [[0, 2.0], [75, 2.2], [100, 2.3], [150, 2.5], [200, 2.7], [300, 3.0], [500, 3.5]],
    three: [[0, 2.0], [75, 2.2], [100, 2.3], [150, 2.5], [200, 2.7], [300, 3.0], [500, 3.5],
      [750, 4.0], [1000, 4.5], [1500, 5.0], [2000, 5.5], [2500, 6.0]]
  },

  // LBS + 限流ヒューズ(PF) T形（変圧器用）
  // 選定：定格電流 ≥ 一次定格電流 × factor の最小値（励磁突入電流 約10倍・0.1秒を考慮した目安）
  lbs: {
    maxKvaThree: 300, // 高圧受電設備規程：LBS(PF付)で開閉する変圧器は300kVA以下が目安
    maxKvaSingle: 300,
    voltages: [3300, 6600], // 7.2kV級ヒューズの適用電圧
    makers: {
      mitsubishi: {
        name: '三菱電機',
        fuse: '限流ヒューズ T形（変圧器用）',
        factor: 2.0,
        series: [3, 5, 7.5, 10, 15, 20, 30, 40, 50, 60, 75, 100],
        verified: false
      },
      fuji: {
        name: '富士電機',
        fuse: '限流ヒューズ T形（変圧器用）',
        factor: 2.0,
        series: [3, 5, 7.5, 10, 15, 20, 30, 40, 50, 60, 75, 100],
        verified: false
      }
    }
  },

  // 低圧 CT（一次定格 / 5A）
  ct: {
    factor: 1.25, // CT一次 ≥ 二次定格電流 × factor
    primaries: [5, 10, 15, 20, 30, 40, 50, 60, 75, 100, 150, 200, 250, 300, 400, 500, 600,
      750, 800, 1000, 1200, 1500, 2000, 2500, 3000, 4000, 5000, 6000],
    secondary: 5,
    burdens: [5, 10, 15, 40] // VA
  },

  // サーマルリレー(THR) CT二次側接続用のヒータ呼び・調整範囲 [呼び, 最小, 最大] A
  thr: {
    makers: {
      mitsubishi: {
        name: '三菱電機',
        model: 'TH-T18 系',
        heaters: [[1.7, 1.4, 2.0], [2.1, 1.7, 2.5], [2.5, 2.0, 3.0], [3.6, 2.8, 4.4],
          [5, 4.0, 6.0], [6.6, 5.2, 8.0], [9, 7.0, 11.0]],
        verified: false
      },
      fuji: {
        name: '富士電機',
        model: 'TK-E2 系',
        heaters: [[2.1, 1.7, 2.6], [2.8, 2.2, 3.4], [3.5, 2.8, 4.2], [5, 4.0, 6.0],
          [6.5, 5.0, 8.0], [9, 7.0, 11.0]],
        verified: false
      }
    }
  },

  // 600V CVT（トリプレックス）許容電流 [sq, A] 気中・暗渠布設 周囲40℃ の目安
  cable: {
    name: 'CVT (600V)',
    note: '気中・暗渠布設、周囲温度40℃の目安。並列時の低減は未考慮。',
    table: [[8, 62], [14, 79], [22, 105], [38, 150], [60, 200], [100, 280], [150, 360],
      [200, 430], [250, 490], [325, 580]],
    maxParallel: 6,
    verified: false
  },

  // 裸銅バー許容電流 [表示名, A]（DIN 43671 相当 交流・周囲35℃ の目安）小さい順
  busbar: {
    note: 'DIN 43671 相当（裸銅・交流・周囲35℃）の目安。盤内温度・塗装・配置で変わります。',
    table: [
      ['3t×15', 162], ['3t×20', 204], ['5t×20', 274], ['5t×25', 327], ['5t×30', 379],
      ['5t×40', 482], ['10t×30', 573], ['5t×50', 583], ['5t×60', 688], ['10t×40', 715],
      ['10t×50', 852], ['10t×60', 985], ['10t×80', 1240], ['10t×100', 1490],
      ['2×10t×60', 1720], ['10t×120', 1740], ['2×10t×80', 2110], ['2×10t×100', 2560],
      ['2×10t×120', 2970], ['3×10t×100', 3310], ['3×10t×120', 3720], ['4×10t×100', 4180],
      ['4×10t×120', 4800]
    ],
    verified: false
  },

  // 主幹ブレーカー
  // icu: [AC230V級, AC440V級] kA（定格限界短絡遮断容量 Icu の目安）
  breaker: {
    factor: 1.0, // 定格電流 ≥ 二次定格電流 × factor
    makers: {
      mitsubishi: {
        name: '三菱電機',
        series: 'WS-V / AE-SW',
        list: [
          { model: 'NF63-CV', af: 63, ratings: [15, 20, 30, 40, 50, 60, 63], icu: [7.5, 2.5] },
          { model: 'NF63-SV', af: 63, ratings: [15, 20, 30, 40, 50, 60, 63], icu: [15, 7.5] },
          { model: 'NF63-HV', af: 63, ratings: [15, 20, 30, 40, 50, 60, 63], icu: [100, 50] },
          { model: 'NF125-CV', af: 125, ratings: [75, 100, 125], icu: [30, 10] },
          { model: 'NF125-SV', af: 125, ratings: [75, 100, 125], icu: [50, 30] },
          { model: 'NF125-HV', af: 125, ratings: [75, 100, 125], icu: [100, 50] },
          { model: 'NF250-CV', af: 250, ratings: [150, 175, 200, 225, 250], icu: [36, 15] },
          { model: 'NF250-SV', af: 250, ratings: [150, 175, 200, 225, 250], icu: [85, 36] },
          { model: 'NF250-HV', af: 250, ratings: [150, 175, 200, 225, 250], icu: [125, 65] },
          { model: 'NF400-CW', af: 400, ratings: [300, 350, 400], icu: [50, 25] },
          { model: 'NF400-SW', af: 400, ratings: [300, 350, 400], icu: [85, 45] },
          { model: 'NF400-HEW', af: 400, ratings: [300, 350, 400], icu: [125, 70] },
          { model: 'NF630-CW', af: 630, ratings: [500, 600, 630], icu: [50, 36] },
          { model: 'NF630-SW', af: 630, ratings: [500, 600, 630], icu: [85, 50] },
          { model: 'NF800-CEW', af: 800, ratings: [700, 800], icu: [50, 36] },
          { model: 'NF800-SEW', af: 800, ratings: [700, 800], icu: [85, 50] },
          { model: 'NF1000-SEW', af: 1000, ratings: [1000], icu: [85, 65] },
          { model: 'NF1250-SEW', af: 1250, ratings: [1200, 1250], icu: [85, 65] },
          { model: 'NF1600-SEW', af: 1600, ratings: [1400, 1500, 1600], icu: [85, 65] },
          { model: 'AE2000-SW (ACB)', af: 2000, ratings: [2000], icu: [85, 85] },
          { model: 'AE2500-SW (ACB)', af: 2500, ratings: [2500], icu: [85, 85] },
          { model: 'AE3200-SW (ACB)', af: 3200, ratings: [3200], icu: [85, 85] },
          { model: 'AE4000-SW (ACB)', af: 4000, ratings: [4000], icu: [100, 100] },
          { model: 'AE5000-SW (ACB)', af: 5000, ratings: [5000], icu: [100, 100] },
          { model: 'AE6300-SW (ACB)', af: 6300, ratings: [6300], icu: [120, 120] }
        ],
        verified: false
      },
      fuji: {
        name: '富士電機',
        series: 'G-TWIN / ACB',
        list: [
          { model: 'BW63EAG', af: 63, ratings: [15, 20, 30, 40, 50, 60, 63], icu: [7.5, 2.5] },
          { model: 'BW63SAG', af: 63, ratings: [15, 20, 30, 40, 50, 60, 63], icu: [15, 7.5] },
          { model: 'BW63RAG', af: 63, ratings: [15, 20, 30, 40, 50, 60, 63], icu: [25, 10] },
          { model: 'BW125JAG', af: 125, ratings: [75, 100, 125], icu: [30, 15] },
          { model: 'BW125RAG', af: 125, ratings: [75, 100, 125], icu: [50, 25] },
          { model: 'BW250EAG', af: 250, ratings: [150, 175, 200, 225, 250], icu: [36, 18] },
          { model: 'BW250RAG', af: 250, ratings: [150, 175, 200, 225, 250], icu: [85, 36] },
          { model: 'BW250HAG', af: 250, ratings: [150, 175, 200, 225, 250], icu: [125, 65] },
          { model: 'BW400EAG', af: 400, ratings: [300, 350, 400], icu: [50, 30] },
          { model: 'BW400RAG', af: 400, ratings: [300, 350, 400], icu: [100, 50] },
          { model: 'BW400HAG', af: 400, ratings: [300, 350, 400], icu: [125, 70] },
          { model: 'BW630EAG', af: 630, ratings: [500, 600, 630], icu: [50, 36] },
          { model: 'BW630RAG', af: 630, ratings: [500, 600, 630], icu: [100, 50] },
          { model: 'BW800EAG', af: 800, ratings: [700, 800], icu: [50, 36] },
          { model: 'BW800RAG', af: 800, ratings: [700, 800], icu: [100, 50] },
          { model: 'ACB 1250AF', af: 1250, ratings: [1000, 1250], icu: [65, 65] },
          { model: 'ACB 1600AF', af: 1600, ratings: [1600], icu: [65, 65] },
          { model: 'ACB 2000AF', af: 2000, ratings: [2000], icu: [80, 80] },
          { model: 'ACB 2500AF', af: 2500, ratings: [2500], icu: [80, 80] },
          { model: 'ACB 3200AF', af: 3200, ratings: [3200], icu: [80, 80] },
          { model: 'ACB 4000AF', af: 4000, ratings: [4000], icu: [100, 100] },
          { model: 'ACB 5000AF', af: 5000, ratings: [5000], icu: [100, 100] },
          { model: 'ACB 6300AF', af: 6300, ratings: [6300], icu: [100, 100] }
        ],
        verified: false
      }
    }
  }
};

if (typeof module !== 'undefined' && module.exports) { module.exports = TR_DATA; }
