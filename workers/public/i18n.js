// 夢幻の森 — i18n(日本語/한국어/English)
// 方針: サーバーは表示文字列を持たない(コード/キーを送る)。表示はすべてクライアントで翻訳。
// 言語は localStorage('mnm_lang') > ブラウザ言語 > en の順で決定。ホーム画面で手動切替可。
'use strict';
(function () {
  const pick = () => {
    try { const v = localStorage.getItem('mnm_lang'); if (v === 'ja' || v === 'ko' || v === 'en') return v; } catch (e) { /* noop */ }
    const n = (navigator.language || '').toLowerCase();
    return n.startsWith('ja') ? 'ja' : n.startsWith('ko') ? 'ko' : 'en';
  };
  const LANG = pick();

  const D = {
  /* ================= 日本語 ================= */
  ja: {
    tagline: '3人1組で森の深部へ。竜を討つのは、どのチームか。',
    menuStart: '▶ はじめる', menuStats: '📊 自分の戦績', menuRank: '🏆 ランキング', menuHowto: '📖 遊び方',
    loading: '読み込み中…', back: '← もどる',
    // 認証
    authLead: 'アカウントを作ると、スマホでもPCでも同じ戦績で遊べます',
    authGoogle: 'Googleで続ける', authEmail: '✉ メールアドレスで続ける', or: 'または',
    authGuest: 'ゲストのまま遊ぶ', authGuestNote: 'ゲストの戦績は、あとからログインすると引き継がれます',
    authSend: '確認コードを送る', authSendLead: 'メールアドレスに確認コードを送ります',
    authCodeLead: '{email} に届いた6桁のコードを入力', authLogin: 'ログイン', authEditMail: '← メールを変更',
    authNoClerk: 'ログイン機能に接続できませんでした。ゲストのまま遊べます',
    authDisabled: 'このサーバーではログインは未設定です。ゲストのまま遊べます',
    authToGoogle: 'Googleへ移動しています…', authBadMail: 'メールアドレスの形式を確認してください',
    authSending: '確認コードを送信中…', authSent: 'コードを送りました', authNeed6: '6桁のコードを入力してください',
    authChecking: '確認中…', authRestart: 'もう一度メールアドレスから始めてください',
    authCodeNg: '確認できませんでした。コードをご確認ください', authOk: 'ログインしました',
    authLinked: 'ゲストの戦績を引き継ぎました({m}戦 / {rp}RP)',
    authErr: 'うまくいきませんでした。もう一度お試しください',
    // ホーム
    homeLoginLead: 'ログインすると、スマホでもPCでも同じ戦績で遊べます',
    homeLogin: '🔑 ログイン / 新規登録', homeGuestOk: '未ログインでも遊べます',
    homeAccount: 'アカウント', homeLogout: 'ログアウト',
    homeAuthBroken: '⚠ ログイン機能に接続できませんでした。この端末の記録として遊べます',
    homeDeviceOnly: 'この端末の記録として戦績を保存します',
    // 出撃
    selTitle: '出撃準備', selBots: '足りない枠はBotが埋めて常に3v3。', selName: 'なまえ', selParty: 'パーティ合言葉(任意)',
    selSkin: 'スキン:', selGo: '職を選ぶと出撃します',
    howtoPC: 'WASD/矢印移動・クリックorSpace攻撃・1-4(E/R/T)スキル・<kbd>5</kbd>薬・<kbd>F</kbd>装置/蘇生/購入・<kbd>G</kbd>砥石・<kbd>P</kbd>FPS表示',
    howtoTouch: '左下スティックで移動・<b>⚔</b>で攻撃(自動照準)・スキルと薬は枠をタップ・<b>F</b>=装置/蘇生/購入',
    // 復帰
    resumeTitle: '⏱ 前の試合がまだ続いています', resumeDead: '脱落(観戦)', resumeDown: 'ダウン中', resumeBot: '今はBotが代行中',
    resumeLeft: '残り', resumeGo: '▶ 続きから', resumeNew: '🆕 新しく始める', resumeFail: '前の試合には戻れませんでした',
    // ロビー
    lobbyTitle: '待機ロビー', lobbyNote: '同じ合言葉のパーティは必ず同チーム。空き枠はBotが埋める',
    lobbyStart: 'マッチ開始', lobbyNight: '🌙 夜マッチで開始', lobbyInvite: '🔗 招待リンクをコピー',
    inviteCopied: '招待リンクをコピーした — 開くだけで同チームになる',
    inviteCopiedNoParty: '招待リンクをコピーした(合言葉なし=チーム保証なし)', invitePrompt: 'このURLを友達に送る:',
    // HUD
    phasePick: '職を選択', phaseExplore: '探索と成長', phaseUnseal: '封印がゆらぐ', phaseDragon: '竜との戦い', phaseEnd: '決着',
    spect: '観戦: {name}', spectKey: '(Tabで切替)', spectTouch: '(👁で切替)',
    contrib: '(竜与ダメ貢献)', team: 'チーム{name}', potion: '薬×', lite: '軽量',
    // ヒント
    hintDown: '<b style="color:#c33d2e">ダウン</b> 味方の救助を待て… 残り{s}s',
    hintReviving: '<b style="color:#8fe0a8">蘇生中…</b> 動くと中断',
    hintRevive: '<b style="color:#8fe0a8">味方がダウン</b> <kbd>F</kbd>で蘇生(2.5秒・その場から動かない)',
    hintQte: '<b style="color:#5bc8b0">解除中</b> <kbd>F</kbd>で金ゾーンに針を止めろ({n}/3) — 移動で中断',
    hintGim: '<b style="color:#5bc8b0">封印装置</b> <kbd>F</kbd>で解除開始(解除でチームの対竜与ダメ+12%)',
    hintShop: '<b style="color:#e0b64f">商人</b> <kbd>F</kbd>ポーション(80G) / <kbd>G</kbd>砥石+8%({w}G) — 所持{g}G',
    // アナウンス
    axUnseal: '封印が解けた — 竜が目覚める',
    axDownAlly: '{name}がダウン! 近づいてFで蘇生', axDownEnemy: '{name}を仕留めた — 追撃で確殺できる',
    axRevive: '{name}が立ち上がった!',
    axMist: '夢幻の霧が立ちこめる — 視界が狭まる…', axMistEnd: '霧が晴れた',
    axGolden: '黄金の宝箱を手に入れた! 攻撃+10%', axGoldenLost: '黄金の宝箱は奪われた…',
    axRoar: '竜が咆哮する — 全員の姿が暴かれた!', axNight: '🌙 夜の森 — 視界が悪い…',
    axBoss: '森の主が目覚めた — 討伐したチームは対竜+8%',
    axBossWin: '森の主を討伐! 対竜与ダメ+8%', axBossLost: '森の主は他チームに討たれた',
    axNpc: '迷い人が現れた — 祠まで護衛すると報酬(横取り可)',
    axNpcWin: '迷い人を送り届けた! +200G', axNpcLost: '迷い人は他チームが送り届けた',
    axAlarm: '警報罠が敵を捕捉! 位置をマークした',
    // リザルト
    resWin: '竜は倒れた', resEnd: 'マッチ終了',
    reason_dragon: '竜は倒れた', reason_wipe: '全滅 — 森が勝った', reason_timeout: '時間切れ — 森が全てを呑んだ',
    resTeam: 'チーム', resDmg: '竜与ダメ', resShare: '貢献率',
    resPlayer: '{name} {rank}: +{rp}RP → 累計<b style="color:#e0b64f">{total}RP</b>({m}戦{w}勝)',
    resSave: '📷 結果を画像で保存', resAgain: 'もう一度',
    imgWin: '— 竜は倒れた —', imgEnd: '— マッチ終了 —', imgDmg: '与ダメ {d}', imgTotal: '{name} — 累計{total}RP({m}戦{w}勝)',
    // ビルド
    buildTitle: 'Lv{lv}ビルド選択(どちらか一つ)',
    // 戦績
    stTitle: '自分の戦績', stNone: 'まだ戦績がありません。1試合遊ぶとここに記録されます。',
    stLoginNote: '※ 今はこの端末だけの記録です。{a}ログイン{b}すると他の端末でも引き継げます。',
    stAccount: '🔑 アカウント', stDevice: '📱 この端末',
    stRp: '累計RP', stMatches: '試合数', stWinrate: '勝率({w}勝)', stPlace: '順位', stPlaceV: '{n}位',
    stByClass: '職別(本人のみ表示)', stRecent: '最近の試合',
    stClsLine: '{m}戦 {w}% · 平均貢献 {s}%', stWin: '勝', stDragon: '討伐', stShare: '貢献{s}%',
    rankTitle: 'ランキング', rankNone: 'まだ記録がありません。', rankLine: '{m}戦{w}勝',
    // 遊び方
    howtoTitle: '遊び方',
    howtoBody: `<p><b>目的</b> — 10分以内に森の最奥の<b>竜</b>を討つ。RPは<b>チームの竜への与ダメージ割合</b>で配分される。</p>
  <p><b>操作(PC)</b> — WASD/矢印で移動、クリックorSpaceで攻撃、1-4(E/R/T)でスキル、<kbd>5</kbd>ポーション、<kbd>F</kbd>装置/蘇生/購入、<kbd>G</kbd>砥石、<kbd>Z/X/C/V</kbd>ピン、<kbd>Tab</kbd>観戦切替、<kbd>M</kbd>ミュート、<kbd>P</kbd>でFPS/通信遅延の表示切替。</p>
  <p><b>操作(スマホ)</b> — 左下スティックで移動、⚔で攻撃(自動照準)、スキルは枠をタップ、📍でピン、死んだら👁で観戦切替。</p>
  <p><b>隠れる</b> — 茂みに入ると敵から見えない。ただし<b>攻撃すると1.4秒露見</b>し、HPが55%を切ると<b>血の足跡</b>が残る。</p>
  <p><b>ダウン&蘇生</b> — HP0で即死ではなく15秒ダウン。味方が近づいて<kbd>F</kbd>長押しで復活できる。味方が全員倒れていると即脱落。</p>
  <p><b>封印装置</b> — 深層の3基を解除するとチームの対竜与ダメが+12%。盗賊は解除が速い。</p>
  <p><b>枯死圧</b> — 時間とともに森の外周が枯れる。外にいるとダメージ+視界が狭まる。</p>
  <p><b>パーティ</b> — 同じ合言葉を入れた人とは<b>必ず同じチーム</b>になる。招待リンクを送れば自動で入る。</p>`,
    pins: ['集合', '危険', '装置', '竜'],
    teams: ['金', '紅', '蒼', '翠', '紫', '白', '橙', '灰', '黄', '茶'],
    cls: { warrior: '近接', mage: '魔法', thief: '盗賊', priest: '僧侶', ranger: '遠距離' },
    ranks: { 'ブロンズ': 'ブロンズ', 'シルバー': 'シルバー', 'ゴールド': 'ゴールド', 'ミスリル': 'ミスリル', '竜狩り': '竜狩り' },
    skills: {
      warrior: ['突進', '咆哮', '盾打', '大斬撃'], mage: ['ブリンク', '減速域', '魔氷壁', '爆裂'],
      thief: ['罠', '隠密', '検知', '毒刃'], priest: ['祝福', '聖域', '聖障壁', '天光'], ranger: ['狙撃', '跳躍', 'マーク', '煙幕'],
    },
    builds: {
      warrior: { 1: ['鉄壁(被ダメ-10%)', '俊足(移動+8%)'], 2: ['大斬撃2.4倍', '盾打スタン+0.6s'] },
      mage: { 1: ['火球+15%威力', 'ブリンク射程+60'], 2: ['爆裂半径+25%', '魔氷壁+2.5秒'] },
      thief: { 1: ['警報罠(通報型)', '罠ダメージ+50%'], 2: ['隠密+1.5秒', '背面2.2倍'] },
      priest: { 1: ['祝福+40', '俊足(移動+8%)'], 2: ['天光+120', '聖域半径+40%'] },
      ranger: { 1: ['狙撃2.6倍', '跳躍CD-3秒'], 2: ['マーク被ダメ+25%', '煙幕半径+50%'] },
    },
  },
  /* ================= 한국어 ================= */
  ko: {
    tagline: '3인 1조로 숲의 심부로. 용을 잡는 팀은 어디인가.',
    menuStart: '▶ 시작하기', menuStats: '📊 내 전적', menuRank: '🏆 랭킹', menuHowto: '📖 플레이 방법',
    loading: '불러오는 중…', back: '← 뒤로',
    authLead: '계정을 만들면 폰과 PC에서 같은 전적으로 플레이할 수 있습니다',
    authGoogle: 'Google로 계속하기', authEmail: '✉ 이메일로 계속하기', or: '또는',
    authGuest: '게스트로 플레이', authGuestNote: '게스트 전적은 나중에 로그인하면 이어집니다',
    authSend: '인증 코드 보내기', authSendLead: '이메일로 인증 코드를 보냅니다',
    authCodeLead: '{email} 로 전송된 6자리 코드를 입력', authLogin: '로그인', authEditMail: '← 이메일 변경',
    authNoClerk: '로그인 기능에 연결할 수 없습니다. 게스트로 플레이할 수 있습니다',
    authDisabled: '이 서버에는 로그인이 설정되어 있지 않습니다. 게스트로 플레이할 수 있습니다',
    authToGoogle: 'Google로 이동 중…', authBadMail: '이메일 주소 형식을 확인해 주세요',
    authSending: '인증 코드 전송 중…', authSent: '코드를 보냈습니다', authNeed6: '6자리 코드를 입력해 주세요',
    authChecking: '확인 중…', authRestart: '이메일 주소부터 다시 시작해 주세요',
    authCodeNg: '확인하지 못했습니다. 코드를 확인해 주세요', authOk: '로그인했습니다',
    authLinked: '게스트 전적을 이어받았습니다({m}전 / {rp}RP)',
    authErr: '실패했습니다. 다시 시도해 주세요',
    homeLoginLead: '로그인하면 폰과 PC에서 같은 전적으로 플레이할 수 있습니다',
    homeLogin: '🔑 로그인 / 회원가입', homeGuestOk: '로그인 없이도 플레이 가능',
    homeAccount: '계정', homeLogout: '로그아웃',
    homeAuthBroken: '⚠ 로그인 기능에 연결할 수 없습니다. 이 기기 기록으로 플레이합니다',
    homeDeviceOnly: '이 기기의 기록으로 전적을 저장합니다',
    selTitle: '출격 준비', selBots: '부족한 자리는 봇이 채워 항상 3v3.', selName: '이름', selParty: '파티 암호(선택)',
    selSkin: '스킨:', selGo: '직업을 고르면 출격합니다',
    howtoPC: 'WASD/방향키 이동 · 클릭/Space 공격 · 1-4(E/R/T) 스킬 · <kbd>5</kbd> 물약 · <kbd>F</kbd> 장치/부활/구매 · <kbd>G</kbd> 숫돌 · <kbd>P</kbd> FPS 표시',
    howtoTouch: '왼쪽 아래 스틱으로 이동 · <b>⚔</b>로 공격(자동 조준) · 스킬과 물약은 슬롯 탭 · <b>F</b>=장치/부활/구매',
    resumeTitle: '⏱ 이전 매치가 아직 진행 중입니다', resumeDead: '탈락(관전)', resumeDown: '다운 상태', resumeBot: '지금은 봇이 대행 중',
    resumeLeft: '남은 시간', resumeGo: '▶ 이어하기', resumeNew: '🆕 새로 시작', resumeFail: '이전 매치로 돌아갈 수 없었습니다',
    lobbyTitle: '대기 로비', lobbyNote: '같은 암호의 파티는 반드시 같은 팀. 빈 자리는 봇이 채웁니다',
    lobbyStart: '매치 시작', lobbyNight: '🌙 야간 매치로 시작', lobbyInvite: '🔗 초대 링크 복사',
    inviteCopied: '초대 링크를 복사했습니다 — 열기만 하면 같은 팀이 됩니다',
    inviteCopiedNoParty: '초대 링크를 복사했습니다(암호 없음=같은 팀 보장 없음)', invitePrompt: '이 URL을 친구에게 보내세요:',
    phasePick: '직업 선택', phaseExplore: '탐색과 성장', phaseUnseal: '봉인이 흔들린다', phaseDragon: '용과의 전투', phaseEnd: '결착',
    spect: '관전: {name}', spectKey: '(Tab으로 전환)', spectTouch: '(👁로 전환)',
    contrib: '(용 피해 기여)', team: '{name} 팀', potion: '물약×', lite: '경량',
    hintDown: '<b style="color:#c33d2e">다운</b> 아군의 구조를 기다려라… 남은 {s}s',
    hintReviving: '<b style="color:#8fe0a8">부활 중…</b> 움직이면 중단',
    hintRevive: '<b style="color:#8fe0a8">아군이 다운</b> <kbd>F</kbd>로 부활(2.5초 · 제자리에서)',
    hintQte: '<b style="color:#5bc8b0">해제 중</b> <kbd>F</kbd>로 금색 구간에 바늘을 멈춰라({n}/3) — 이동하면 중단',
    hintGim: '<b style="color:#5bc8b0">봉인 장치</b> <kbd>F</kbd>로 해제 시작(해제 시 팀의 대 용 피해 +12%)',
    hintShop: '<b style="color:#e0b64f">상인</b> <kbd>F</kbd> 물약(80G) / <kbd>G</kbd> 숫돌+8%({w}G) — 보유 {g}G',
    axUnseal: '봉인이 풀렸다 — 용이 깨어난다',
    axDownAlly: '{name} 다운! 다가가서 F로 부활', axDownEnemy: '{name} 처치 — 추격하면 확실히 마무리할 수 있다',
    axRevive: '{name} 일어섰다!',
    axMist: '몽환의 안개가 깔린다 — 시야가 좁아진다…', axMistEnd: '안개가 걷혔다',
    axGolden: '황금 보물상자 획득! 공격 +10%', axGoldenLost: '황금 보물상자를 빼앗겼다…',
    axRoar: '용이 포효한다 — 모두의 위치가 드러났다!', axNight: '🌙 밤의 숲 — 시야가 나쁘다…',
    axBoss: '숲의 주인이 깨어났다 — 처치한 팀은 대 용 +8%',
    axBossWin: '숲의 주인 처치! 대 용 피해 +8%', axBossLost: '숲의 주인은 다른 팀이 처치했다',
    axNpc: '길 잃은 자가 나타났다 — 사당까지 호위하면 보상(가로채기 가능)',
    axNpcWin: '길 잃은 자를 데려다주었다! +200G', axNpcLost: '길 잃은 자는 다른 팀이 데려다주었다',
    axAlarm: '경보 덫이 적을 포착! 위치를 표시했다',
    resWin: '용이 쓰러졌다', resEnd: '매치 종료',
    reason_dragon: '용이 쓰러졌다', reason_wipe: '전멸 — 숲이 이겼다', reason_timeout: '시간 초과 — 숲이 모든 것을 삼켰다',
    resTeam: '팀', resDmg: '용 피해', resShare: '기여율',
    resPlayer: '{name} {rank}: +{rp}RP → 누적 <b style="color:#e0b64f">{total}RP</b>({m}전 {w}승)',
    resSave: '📷 결과를 이미지로 저장', resAgain: '다시 하기',
    imgWin: '— 용이 쓰러졌다 —', imgEnd: '— 매치 종료 —', imgDmg: '피해 {d}', imgTotal: '{name} — 누적 {total}RP({m}전 {w}승)',
    buildTitle: 'Lv{lv} 빌드 선택(둘 중 하나)',
    stTitle: '내 전적', stNone: '아직 전적이 없습니다. 한 판 플레이하면 여기에 기록됩니다.',
    stLoginNote: '※ 지금은 이 기기만의 기록입니다. {a}로그인{b}하면 다른 기기에서도 이어집니다.',
    stAccount: '🔑 계정', stDevice: '📱 이 기기',
    stRp: '누적 RP', stMatches: '매치 수', stWinrate: '승률({w}승)', stPlace: '순위', stPlaceV: '{n}위',
    stByClass: '직업별(본인만 표시)', stRecent: '최근 매치',
    stClsLine: '{m}전 {w}% · 평균 기여 {s}%', stWin: '승', stDragon: '토벌', stShare: '기여 {s}%',
    rankTitle: '랭킹', rankNone: '아직 기록이 없습니다.', rankLine: '{m}전 {w}승',
    howtoTitle: '플레이 방법',
    howtoBody: `<p><b>목적</b> — 10분 안에 숲 가장 깊은 곳의 <b>용</b>을 잡는다. RP는 <b>팀이 용에게 준 피해 비율</b>로 분배된다.</p>
  <p><b>조작(PC)</b> — WASD/방향키 이동, 클릭/Space 공격, 1-4(E/R/T) 스킬, <kbd>5</kbd> 물약, <kbd>F</kbd> 장치/부활/구매, <kbd>G</kbd> 숫돌, <kbd>Z/X/C/V</kbd> 핀, <kbd>Tab</kbd> 관전 전환, <kbd>M</kbd> 음소거, <kbd>P</kbd> FPS/지연 표시 전환.</p>
  <p><b>조작(모바일)</b> — 왼쪽 아래 스틱으로 이동, ⚔로 공격(자동 조준), 스킬은 슬롯 탭, 📍로 핀, 죽으면 👁로 관전 전환.</p>
  <p><b>은신</b> — 수풀에 들어가면 적에게 보이지 않는다. 단, <b>공격하면 1.4초 노출</b>되고 HP가 55% 아래면 <b>핏자국</b>이 남는다.</p>
  <p><b>다운 & 부활</b> — HP 0이면 즉사가 아니라 15초 다운. 아군이 다가가 <kbd>F</kbd> 길게 누르면 부활. 아군이 전멸하면 즉시 탈락.</p>
  <p><b>봉인 장치</b> — 심층의 3기를 해제하면 팀의 대 용 피해 +12%. 도적은 해제가 빠르다.</p>
  <p><b>고사 압박</b> — 시간이 지나면 숲 외곽이 말라간다. 밖에 있으면 피해 + 시야 감소.</p>
  <p><b>파티</b> — 같은 암호를 입력한 사람과는 <b>반드시 같은 팀</b>. 초대 링크를 보내면 자동으로 들어온다.</p>`,
    pins: ['집합', '위험', '장치', '용'],
    teams: ['금', '홍', '청', '녹', '보라', '백', '주황', '회', '황', '갈'],
    cls: { warrior: '근접', mage: '마법', thief: '도적', priest: '사제', ranger: '원거리' },
    ranks: { 'ブロンズ': '브론즈', 'シルバー': '실버', 'ゴールド': '골드', 'ミスリル': '미스릴', '竜狩り': '용 사냥꾼' },
    skills: {
      warrior: ['돌진', '포효', '방패치기', '대참격'], mage: ['블링크', '감속 지대', '얼음벽', '폭렬'],
      thief: ['덫', '은신', '탐지', '독날'], priest: ['축복', '성역', '성 방벽', '천광'], ranger: ['저격', '도약', '표적', '연막'],
    },
    builds: {
      warrior: { 1: ['철벽(받는 피해 -10%)', '준족(이동 +8%)'], 2: ['대참격 2.4배', '방패치기 스턴 +0.6s'] },
      mage: { 1: ['화구 위력 +15%', '블링크 사거리 +60'], 2: ['폭렬 반경 +25%', '얼음벽 +2.5초'] },
      thief: { 1: ['경보 덫(통보형)', '덫 피해 +50%'], 2: ['은신 +1.5초', '배후 2.2배'] },
      priest: { 1: ['축복 +40', '준족(이동 +8%)'], 2: ['천광 +120', '성역 반경 +40%'] },
      ranger: { 1: ['저격 2.6배', '도약 CD -3초'], 2: ['표적 받는 피해 +25%', '연막 반경 +50%'] },
    },
  },
  /* ================= English ================= */
  en: {
    tagline: 'Teams of three venture into the deep forest. Which team will slay the dragon?',
    menuStart: '▶ Play', menuStats: '📊 My Stats', menuRank: '🏆 Leaderboard', menuHowto: '📖 How to Play',
    loading: 'Loading…', back: '← Back',
    authLead: 'Create an account to share your record between phone and PC',
    authGoogle: 'Continue with Google', authEmail: '✉ Continue with email', or: 'or',
    authGuest: 'Play as guest', authGuestNote: 'Guest records carry over when you log in later',
    authSend: 'Send verification code', authSendLead: 'We will send a verification code to your email',
    authCodeLead: 'Enter the 6-digit code sent to {email}', authLogin: 'Log in', authEditMail: '← Change email',
    authNoClerk: 'Could not reach the login service. You can keep playing as a guest',
    authDisabled: 'Login is not configured on this server. You can play as a guest',
    authToGoogle: 'Redirecting to Google…', authBadMail: 'Please check the email address format',
    authSending: 'Sending code…', authSent: 'Code sent', authNeed6: 'Enter the 6-digit code',
    authChecking: 'Verifying…', authRestart: 'Please start again from your email address',
    authCodeNg: 'Verification failed. Please check the code', authOk: 'Logged in',
    authLinked: 'Guest record transferred ({m} matches / {rp} RP)',
    authErr: 'Something went wrong. Please try again',
    homeLoginLead: 'Log in to share your record between phone and PC',
    homeLogin: '🔑 Log in / Sign up', homeGuestOk: 'You can play without logging in',
    homeAccount: 'Account', homeLogout: 'Log out',
    homeAuthBroken: '⚠ Could not reach the login service. Playing with device-local records',
    homeDeviceOnly: 'Records are saved to this device',
    selTitle: 'Ready Up', selBots: 'Empty slots are filled by bots — always 3v3.', selName: 'Name', selParty: 'Party passphrase (optional)',
    selSkin: 'Skin:', selGo: 'Pick a class to deploy',
    howtoPC: 'WASD/arrows move · click or Space attack · 1-4 (E/R/T) skills · <kbd>5</kbd> potion · <kbd>F</kbd> device/revive/buy · <kbd>G</kbd> whetstone · <kbd>P</kbd> FPS display',
    howtoTouch: 'Left stick to move · <b>⚔</b> to attack (auto-aim) · tap slots for skills & potion · <b>F</b> = device/revive/buy',
    resumeTitle: '⏱ Your previous match is still running', resumeDead: 'eliminated (spectating)', resumeDown: 'downed', resumeBot: 'a bot is filling in',
    resumeLeft: 'time left', resumeGo: '▶ Resume', resumeNew: '🆕 Start fresh', resumeFail: 'Could not return to the previous match',
    lobbyTitle: 'Lobby', lobbyNote: 'Same passphrase = same team, guaranteed. Bots fill empty slots',
    lobbyStart: 'Start match', lobbyNight: '🌙 Start night match', lobbyInvite: '🔗 Copy invite link',
    inviteCopied: 'Invite link copied — opening it puts them on your team',
    inviteCopiedNoParty: 'Invite link copied (no passphrase = no team guarantee)', invitePrompt: 'Send this URL to a friend:',
    phasePick: 'Pick a class', phaseExplore: 'Explore & Level', phaseUnseal: 'The seal weakens', phaseDragon: 'Dragon fight', phaseEnd: 'Finale',
    spect: 'Spectating: {name}', spectKey: '(Tab to switch)', spectTouch: '(👁 to switch)',
    contrib: '(dragon damage share)', team: 'Team {name}', potion: 'Potion×', lite: 'lite',
    hintDown: '<b style="color:#c33d2e">DOWNED</b> Wait for rescue… {s}s left',
    hintReviving: '<b style="color:#8fe0a8">Reviving…</b> moving cancels',
    hintRevive: '<b style="color:#8fe0a8">Ally downed</b> — hold <kbd>F</kbd> to revive (2.5s, stand still)',
    hintQte: '<b style="color:#5bc8b0">Unsealing</b> — press <kbd>F</kbd> to stop the needle in the gold zone ({n}/3), moving cancels',
    hintGim: '<b style="color:#5bc8b0">Seal device</b> — press <kbd>F</kbd> to start (unlocks +12% team dragon damage)',
    hintShop: '<b style="color:#e0b64f">Merchant</b> <kbd>F</kbd> potion (80G) / <kbd>G</kbd> whetstone +8% ({w}G) — you have {g}G',
    axUnseal: 'The seal is broken — the dragon awakens',
    axDownAlly: '{name} is down! Get close and press F to revive', axDownEnemy: '{name} is down — finish them with a follow-up',
    axRevive: '{name} is back up!',
    axMist: 'Phantom mist rolls in — vision shrinks…', axMistEnd: 'The mist has cleared',
    axGolden: 'Golden chest claimed! Attack +10%', axGoldenLost: 'The golden chest was taken…',
    axRoar: 'The dragon roars — everyone is revealed!', axNight: '🌙 Night forest — visibility is poor…',
    axBoss: 'The Forest Lord awakens — the team that slays it gets +8% vs dragon',
    axBossWin: 'Forest Lord slain! +8% dragon damage', axBossLost: 'Another team slew the Forest Lord',
    axNpc: 'A lost wanderer appeared — escort them to the shrine for a reward (can be stolen)',
    axNpcWin: 'Wanderer delivered! +200G', axNpcLost: 'Another team delivered the wanderer',
    axAlarm: 'Alarm trap triggered! Enemy position marked',
    resWin: 'The Dragon Has Fallen', resEnd: 'Match Over',
    reason_dragon: 'The dragon has fallen', reason_wipe: 'Total wipe — the forest won', reason_timeout: 'Time up — the forest devoured all',
    resTeam: 'Team', resDmg: 'Dragon dmg', resShare: 'Share',
    resPlayer: '{name} {rank}: +{rp} RP → total <b style="color:#e0b64f">{total} RP</b> ({m} matches, {w} wins)',
    resSave: '📷 Save result image', resAgain: 'Play again',
    imgWin: '— The Dragon Has Fallen —', imgEnd: '— Match Over —', imgDmg: 'DMG {d}', imgTotal: '{name} — total {total} RP ({m}M {w}W)',
    buildTitle: 'Lv{lv} build choice (pick one)',
    stTitle: 'My Stats', stNone: 'No matches yet. Play one match and it will be recorded here.',
    stLoginNote: 'Note: records are device-local for now. {a}Log in{b} to carry them to other devices.',
    stAccount: '🔑 Account', stDevice: '📱 This device',
    stRp: 'Total RP', stMatches: 'Matches', stWinrate: 'Win rate ({w}W)', stPlace: 'Rank', stPlaceV: '#{n}',
    stByClass: 'By class (visible only to you)', stRecent: 'Recent matches',
    stClsLine: '{m} matches {w}% · avg share {s}%', stWin: 'WIN', stDragon: 'slain', stShare: 'share {s}%',
    rankTitle: 'Leaderboard', rankNone: 'No records yet.', rankLine: '{m}M {w}W',
    howtoTitle: 'How to Play',
    howtoBody: `<p><b>Goal</b> — slay the <b>dragon</b> in the heart of the forest within 10 minutes. RP is split by <b>your team's share of dragon damage</b>.</p>
  <p><b>Controls (PC)</b> — WASD/arrows to move, click or Space to attack, 1-4 (E/R/T) skills, <kbd>5</kbd> potion, <kbd>F</kbd> device/revive/buy, <kbd>G</kbd> whetstone, <kbd>Z/X/C/V</kbd> pings, <kbd>Tab</kbd> spectate switch, <kbd>M</kbd> mute, <kbd>P</kbd> FPS/latency display.</p>
  <p><b>Controls (mobile)</b> — left stick to move, ⚔ to attack (auto-aim), tap slots for skills, 📍 for pings, 👁 to spectate when dead.</p>
  <p><b>Hiding</b> — bushes hide you from enemies, but <b>attacking reveals you for 1.4s</b> and below 55% HP you leave a <b>blood trail</b>.</p>
  <p><b>Down & revive</b> — at 0 HP you are downed for 15s instead of dying. An ally can hold <kbd>F</kbd> nearby to revive you. If your whole team is down, you are out.</p>
  <p><b>Seal devices</b> — unsealing the 3 deep devices grants your team +12% dragon damage. Thieves unseal faster.</p>
  <p><b>Wither</b> — the forest edge decays over time. Staying outside deals damage and shrinks vision.</p>
  <p><b>Party</b> — players with the same passphrase are <b>always on the same team</b>. Invite links join automatically.</p>`,
    pins: ['Rally', 'Danger', 'Device', 'Dragon'],
    teams: ['Gold', 'Red', 'Blue', 'Green', 'Purple', 'White', 'Orange', 'Gray', 'Yellow', 'Brown'],
    cls: { warrior: 'Fighter', mage: 'Mage', thief: 'Thief', priest: 'Priest', ranger: 'Ranger' },
    ranks: { 'ブロンズ': 'Bronze', 'シルバー': 'Silver', 'ゴールド': 'Gold', 'ミスリル': 'Mithril', '竜狩り': 'Dragonslayer' },
    skills: {
      warrior: ['Charge', 'War Cry', 'Shield Bash', 'Great Cleave'], mage: ['Blink', 'Slow Field', 'Ice Wall', 'Blast'],
      thief: ['Trap', 'Stealth', 'Detect', 'Venom Blade'], priest: ['Blessing', 'Sanctuary', 'Holy Barrier', 'Radiance'], ranger: ['Snipe', 'Leap', 'Mark', 'Smoke'],
    },
    builds: {
      warrior: { 1: ['Ironwall (dmg taken -10%)', 'Swift (move +8%)'], 2: ['Great Cleave ×2.4', 'Bash stun +0.6s'] },
      mage: { 1: ['Fireball +15% power', 'Blink range +60'], 2: ['Blast radius +25%', 'Ice Wall +2.5s'] },
      thief: { 1: ['Alarm trap (alert)', 'Trap damage +50%'], 2: ['Stealth +1.5s', 'Backstab ×2.2'] },
      priest: { 1: ['Blessing +40', 'Swift (move +8%)'], 2: ['Radiance +120', 'Sanctuary radius +40%'] },
      ranger: { 1: ['Snipe ×2.6', 'Leap CD -3s'], 2: ['Marked dmg taken +25%', 'Smoke radius +50%'] },
    },
  },
  };

  const dict = D[LANG];
  const GLYPH = { warrior: '⚔', mage: '✦', thief: '◆', priest: '✚', ranger: '➹' };
  function T(key, vars) {
    let s = dict[key];
    if (s == null) s = D.ja[key];
    if (s == null) return key;
    if (vars) for (const k in vars) s = s.split('{' + k + '}').join(vars[k]);
    return s;
  }
  window.T = T;
  window.I18N = {
    lang: LANG,
    pins: dict.pins.slice(),
    setLang(l) { try { localStorage.setItem('mnm_lang', l); } catch (e) { /* noop */ } location.reload(); },
    teamName: i => T('team', { name: dict.teams[i] || '?' }),   // 「チーム金」/「금 팀」/「Team Gold」
    teamShort: i => dict.teams[i] || '?',
    clsName: c => (GLYPH[c] || '') + (dict.cls[c] || c),
    skillName: (c, slot) => (dict.skills[c] || [])[slot - 1] || '',
    buildName: (c, tier, i) => ((dict.builds[c] || {})[tier] || [])[i] || '',
    rankName: ja => dict.ranks[ja] || ja || '',
  };
  document.documentElement.lang = LANG;

  // 静的HTMLの流し込み: data-i18n(innerHTML) / data-i18n-ph(placeholder)
  addEventListener('DOMContentLoaded', () => {
    for (const el of document.querySelectorAll('[data-i18n]')) el.innerHTML = T(el.getAttribute('data-i18n'));
    for (const el of document.querySelectorAll('[data-i18n-ph]')) el.placeholder = T(el.getAttribute('data-i18n-ph'));
    // 言語切替(ホーム画面下部)
    const box = document.getElementById('langSwitch');
    if (box) box.innerHTML = [['ja', '日本語'], ['ko', '한국어'], ['en', 'English']].map(([l, n]) =>
      `<button onclick="I18N.setLang('${l}')" style="background:none;border:none;cursor:pointer;font-size:11px;padding:2px 6px;color:${l === LANG ? '#e0b64f' : '#8fa598'}">${n}</button>`).join('·');
  });
})();
