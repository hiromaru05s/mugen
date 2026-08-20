// 夢幻の森 — Room DO / Registry DO 共有の小物
'use strict';

// ランクタイア(RP累積)
export function rankOf(rp) {
  return rp >= 15000 ? '竜狩り' : rp >= 8000 ? 'ミスリル' : rp >= 4000 ? 'ゴールド' : rp >= 1500 ? 'シルバー' : 'ブロンズ';
}
