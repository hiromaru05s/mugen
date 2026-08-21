// 夢幻の森 — ホーム画面 / 認証(Clerk) / 戦績表示
// 認証はサーバー(/api/config)の設定で決まる:
//   CLERK_PUBLISHABLE_KEY あり → Clerkログイン可能。なし → ゲスト(端末トークン)のみ
// 個人戦績は /api/me がトークンを検証して本人の分だけ返す(README設計思想: 個人統計は本人のみ閲覧)
'use strict';
const MNM = (() => {
  const CLS_JP = { warrior: '⚔近接', mage: '✦魔法', thief: '◆盗賊', priest: '✚僧侶', ranger: '➹遠距離' };
  const SCREENS = ['home', 'auth', 'select', 'mystats', 'rank', 'howtoScr'];
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

  const state = { config: null, clerk: null, user: null, guestId: null };

  /* ---------- 端末トークン(ゲストの本人識別。なりすまし防止の最低限) ---------- */
  function guestId() {
    if (state.guestId) return state.guestId;
    let g = null;
    try { g = localStorage.getItem('mnm_guest'); } catch (e) { /* プライベートモード等 */ }
    if (!g || !/^[a-zA-Z0-9_-]{8,64}$/.test(g)) {
      g = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random())).replace(/-/g, '');
      try { localStorage.setItem('mnm_guest', g); } catch (e) { /* noop */ }
    }
    return (state.guestId = g);
  }

  /* ---------- 画面遷移 ---------- */
  function go(name) {
    const id = name === 'howto' ? 'howtoScr' : name === 'play' ? 'select' : name;
    for (const s of SCREENS) { const el = $(s); if (el) el.style.display = s === id ? 'flex' : 'none'; }
    if (id === 'mystats') renderMyStats();
    if (id === 'rank') renderRank();
    if (id === 'home') renderHome();
  }
  function hideAll() { for (const s of SCREENS) { const el = $(s); if (el) el.style.display = 'none'; } }

  /* ---------- 認証 ---------- */
  async function getToken() {
    try {
      if (state.clerk && state.clerk.session) return await state.clerk.session.getToken();
    } catch (e) { /* セッション切れ */ }
    return null;
  }
  // 参加URLに付ける本人確認クエリ(Clerkトークン or 端末トークン)
  async function authQuery() {
    const p = new URLSearchParams();
    const t = await getToken();
    if (t) p.set('token', t);
    p.set('guest', guestId());
    return p.toString();
  }

  async function initAuth() {
    try {
      state.config = await (await fetch('/api/config')).json();
    } catch (e) { state.config = { authEnabled: false }; }
    if (state.config.authEnabled && state.config.clerkPublishableKey) {
      try { await loadClerk(state.config.clerkPublishableKey); }
      catch (e) { state.authBroken = true; console.warn('[auth] Clerk読み込み失敗 — ゲストで続行', e); }
    }
    renderHome();
    refreshResume();
  }

  function loadClerk(pk) {
    return new Promise((resolve, reject) => {
      // Clerk JSは自分のインスタンス(publishable keyが指すドメイン)から配信される
      let host;
      try { host = atob(pk.replace(/^pk_(test|live)_/, '').replace(/-/g, '+').replace(/_/g, '/')).replace(/\$+$/, ''); }
      catch (e) { return reject(new Error('bad publishable key')); }
      const sc = document.createElement('script');
      sc.async = true; sc.crossOrigin = 'anonymous';
      sc.setAttribute('data-clerk-publishable-key', pk);
      sc.src = `https://${host}/npm/@clerk/clerk-js@5/dist/clerk.browser.js`;
      sc.onerror = () => reject(new Error('clerk script load failed'));
      sc.onload = async () => {
        try {
          await window.Clerk.load({ afterSignOutUrl: location.origin + '/' });
          state.clerk = window.Clerk;
          // Google(OAuth)リダイレクトからの復帰を処理
          if (/__clerk/i.test(location.search + location.hash)) {
            try {
              await window.Clerk.handleRedirectCallback({
                afterSignInUrl: location.origin + '/', afterSignUpUrl: location.origin + '/' });
              try { history.replaceState({}, '', location.origin + '/'); } catch (e2) { /* noop */ }
            } catch (e2) { console.warn('[auth] redirect callback', e2); }
          }
          state.user = window.Clerk.user || null;
          window.Clerk.addListener(({ user }) => { state.user = user || null; renderHome(); });
          if (state.user) afterSignIn().catch(() => { /* 引き継ぎ失敗は致命的でない */ });
          resolve();
        } catch (e) { reject(e); }
      };
      document.head.appendChild(sc);
    });
  }

  function displayName() {
    const u = state.user;
    if (!u) return null;
    return u.username || u.firstName || (u.primaryEmailAddress && u.primaryEmailAddress.emailAddress.split('@')[0]) || 'user';
  }
  function signIn() { go('auth'); }

  /* ---------- ログイン導線(LORE同様の自前UI: Googleリダイレクト + メールコード) ---------- */
  const authMsg = (text, cls) => { const el = $('authMsg'); if (el) { el.textContent = text || ''; el.className = 'authMsg ' + (cls || ''); } };
  function authStep(n) {
    for (const i of [1, 2, 3]) { const el = $('authStep' + i); if (el) el.style.display = i === n ? 'block' : 'none'; }
    authMsg('');
  }
  function showEmail() { authStep(2); setTimeout(() => { const el = $('authEmail'); if (el) el.focus(); }, 50); }
  function authBack() { state.signIn = null; state.signUp = null; authStep(1); }

  function clerkOrWarn() {
    if (state.clerk) return state.clerk;
    authMsg(state.config && state.config.authEnabled
      ? 'ログイン機能に接続できませんでした。ゲストのまま遊べます'
      : 'このサーバーではログインは未設定です。ゲストのまま遊べます', 'err');
    return null;
  }

  // Google: OAuthリダイレクト。戻ってきたら init() の handleRedirectCallback がセッションを確立する
  async function startGoogle() {
    const c = clerkOrWarn(); if (!c) return;
    authMsg('Googleへ移動しています…', 'busy');
    try {
      await c.client.signIn.authenticateWithRedirect({
        strategy: 'oauth_google', redirectUrl: location.origin + '/', redirectUrlComplete: location.origin + '/',
      });
    } catch (e) { authMsg(errText(e), 'err'); }
  }

  // メール: パスワードレス。既存ユーザーはサインイン、居なければそのまま新規登録に切り替える
  async function sendCode() {
    const c = clerkOrWarn(); if (!c) return;
    const email = ($('authEmail').value || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return authMsg('メールアドレスの形式を確認してください', 'err');
    authMsg('確認コードを送信中…', 'busy');
    state.email = email; state.signIn = null; state.signUp = null;
    try {
      let si = await c.client.signIn.create({ identifier: email });
      const f = (si.supportedFirstFactors || []).find(x => x.strategy === 'email_code');
      if (!f) throw new Error('email_code disabled');
      state.signIn = await si.prepareFirstFactor({ strategy: 'email_code', emailAddressId: f.emailAddressId });
    } catch (e) {
      // 未登録のメール → 新規登録フローへ(会員登録もここで完結する)
      try {
        const su = await c.client.signUp.create({ emailAddress: email });
        state.signUp = await su.prepareEmailAddressVerification({ strategy: 'email_code' });
      } catch (e2) { return authMsg(errText(e2), 'err'); }
    }
    $('authSentTo').textContent = email;
    authStep(3);
    setTimeout(() => { const el = $('authCode'); if (el) el.focus(); }, 50);
    authMsg('コードを送りました', 'ok');
  }

  async function verifyCode() {
    const c = clerkOrWarn(); if (!c) return;
    const code = ($('authCode').value || '').replace(/\D/g, '');
    if (code.length < 6) return authMsg('6桁のコードを入力してください', 'err');
    authMsg('確認中…', 'busy');
    try {
      let res;
      if (state.signIn) res = await state.signIn.attemptFirstFactor({ strategy: 'email_code', code });
      else if (state.signUp) res = await state.signUp.attemptEmailAddressVerification({ code });
      else return authMsg('もう一度メールアドレスから始めてください', 'err');
      const sid = res.createdSessionId;
      if (!sid) return authMsg('確認できませんでした。コードをご確認ください', 'err');
      await c.setActive({ session: sid });
      await afterSignIn();
    } catch (e) { authMsg(errText(e), 'err'); }
  }

  function errText(e) {
    const m = e && (e.errors && e.errors[0] && (e.errors[0].longMessage || e.errors[0].message) || e.message);
    return m ? String(m) : 'うまくいきませんでした。もう一度お試しください';
  }

  // ログイン直後: ゲストで貯めた戦績をアカウントへ引き継ぐ
  async function afterSignIn() {
    state.user = state.clerk && state.clerk.user || null;
    authMsg('ログインしました', 'ok');
    try {
      const t = await getToken();
      if (t) {
        const r = await fetch('/api/link-guest', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
          body: JSON.stringify({ guest: guestId(), name: displayName() }),
        });
        const d = await r.json();
        if (d.linked) authMsg(`ゲストの戦績を引き継ぎました(${d.moved.matches}戦 / ${d.moved.rp}RP)`, 'ok');
      }
    } catch (e) { /* 引き継ぎ失敗でもログイン自体は成立している */ }
    renderHome();
    setTimeout(() => go('home'), 600);
  }

  function openProfile() { if (state.clerk) state.clerk.openUserProfile(); }
  async function signOut() { if (state.clerk) await state.clerk.signOut(); state.user = null; renderHome(); go('home'); }

  /* ---------- 前の試合への復帰(続きから / 新規を選ばせる) ---------- */
  const CLS_ONLY = { warrior: '近接', mage: '魔法', thief: '盗賊', priest: '僧侶', ranger: '遠距離' };
  function savedToken() { try { return sessionStorage.getItem('mnm_token'); } catch (e) { return null; } }
  function dropToken() { try { sessionStorage.removeItem('mnm_token'); } catch (e) { /* noop */ } }

  // サーバーに「まだ戻れるか」を聞く(試合が終わっていたら選択肢自体を出さない)
  async function refreshResume() {
    const tk = savedToken();
    state.resume = null;
    if (tk) {
      try {
        const r = await fetch('/api/resume?token=' + encodeURIComponent(tk));
        const d = await r.json();
        if (d && d.resumable) state.resume = d; else dropToken();
      } catch (e) { /* 通信不能: 判定できないので出さない */ }
    }
    renderResume();
    return state.resume;
  }

  function renderResume() {
    const r = state.resume;
    const html = r ? `
      <div class="rt">⏱ 前の試合がまだ続いています</div>
      <div class="rs">${esc(r.name || '')}${r.cls ? ' / ' + (CLS_ONLY[r.cls] || r.cls) : ''}
        ${r.dead ? ' · 脱落(観戦)' : r.downed ? ' · ダウン中' : ' · 今はBotが代行中'}
        · 残り ${Math.floor(r.left / 60)}:${String(r.left % 60).padStart(2, '0')}</div>
      <div class="rbtns">
        <button class="mbtn primary" onclick="MNM.resumeMatch()">▶ 続きから</button>
        <button class="mbtn" onclick="MNM.discardMatch()">🆕 新しく始める</button>
      </div>` : '';
    for (const id of ['homeReconnect', 'reconnectRow']) {
      const el = $(id); if (!el) continue;
      el.innerHTML = html;
      el.style.display = r ? 'block' : 'none';
    }
  }

  function resumeMatch() { if (typeof window.tryReconnect === 'function') window.tryReconnect(); }
  function discardMatch() { dropToken(); state.resume = null; renderResume(); go('play'); }
  // 「はじめる」: 戻れる試合があるなら、まず選ばせる
  async function startFlow() {
    go('play');
    await refreshResume();
  }

  /* ---------- ホーム ---------- */
  function renderHome() {
    const row = $('authRow'); if (!row) return;
    if (!state.config) { row.innerHTML = '<span class="muted">読み込み中…</span>'; return; }
    if (state.user) {
      row.innerHTML = `<span class="who">👤 ${esc(displayName())}</span><span class="rk" id="homeRank"></span>
        <div style="margin-top:8px">
          <button class="mbtn small" onclick="MNM.openProfile()">アカウント</button>
          <button class="mbtn small" onclick="MNM.signOut()">ログアウト</button>
        </div>`;
      fetchMe().then(me => { const el = $('homeRank'); if (el && me && me.found) el.textContent = `${me.rank} · ${me.rp}RP`; });
    } else if (state.config.authEnabled && state.authBroken) {
      row.innerHTML = '<span class="muted small">⚠ ログイン機能に接続できませんでした。この端末の記録として遊べます</span>';
    } else if (state.config.authEnabled) {
      row.innerHTML = `<span class="muted small">ログインすると、スマホでもPCでも同じ戦績で遊べます</span>
        <div style="margin-top:8px"><button class="mbtn small" onclick="MNM.signIn()">🔑 ログイン / 新規登録</button>
        <span class="muted small" style="margin-left:8px">未ログインでも遊べます</span></div>`;
    } else {
      row.innerHTML = '<span class="muted small">この端末の記録として戦績を保存します</span>';
    }
    // ログイン名を出撃画面の初期値に(保存済みの名前があればそちらを優先)
    const nameEl = document.getElementById('pname');
    if (nameEl && !nameEl.value && state.user) nameEl.value = String(displayName()).slice(0, 12);
    renderResume();
  }

  /* ---------- 自分の戦績(本人のみ) ---------- */
  async function fetchMe() {
    const q = new URLSearchParams({ guest: guestId() });
    const t = await getToken();
    if (t) q.set('token', t);
    try {
      const r = await fetch('/api/me?' + q.toString());
      if (!r.ok) return null;
      return await r.json();
    } catch (e) { return null; }
  }
  async function renderMyStats() {
    const body = $('statsBody');
    body.innerHTML = '<span class="muted">読み込み中…</span>';
    const me = await fetchMe();
    if (!me || !me.found) {
      body.innerHTML = `<p class="muted small">まだ戦績がありません。1試合遊ぶとここに記録されます。</p>
        ${state.config && state.config.authEnabled && !state.user
          ? '<p class="muted small">※ 今はこの端末だけの記録です。<a href="#" onclick="MNM.signIn();return false" style="color:#5bc8b0">ログイン</a>すると他の端末でも引き継げます。</p>' : ''}`;
      return;
    }
    const wr = me.matches ? Math.round(me.wins / me.matches * 100) : 0;
    const cls = (me.byClass || []).map(c => {
      const w = c.matches ? Math.round(c.wins / c.matches * 100) : 0;
      return `<div class="rowline"><span>${CLS_JP[c.cls] || esc(c.cls)}</span>
        <span class="muted">${c.matches}戦 ${w}% · 平均貢献 ${Math.round((c.share || 0) * 100)}%</span></div>`;
    }).join('') || '<div class="muted small">—</div>';
    const recent = (me.recent || []).map(m => {
      const d = new Date(m.at);
      const dt = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      return `<div class="rowline"><span>${dt} ${CLS_JP[m.cls] || ''}${m.night ? ' 🌙' : ''}</span>
        <span><span class="${m.win ? 'win' : 'lose'}">${m.win ? '勝' : m.dragon ? '討伐' : '—'}</span>
        <span class="muted"> 貢献${Math.round((m.share || 0) * 100)}%</span>
        <b style="color:#e0b64f"> +${m.rp}</b></span></div>`;
    }).join('') || '<div class="muted small">—</div>';
    body.innerHTML = `
      <div class="rowline" style="border:none;padding:0 4px 8px">
        <span class="who">${esc(me.name)} <span class="rk">${me.rank}</span></span>
        <span class="muted small">${me.kind === 'clerk' ? '🔑 アカウント' : '📱 この端末'}</span></div>
      <div class="statGrid">
        <div class="statCell"><div class="v">${me.rp}</div><div class="k">累計RP</div></div>
        <div class="statCell"><div class="v">${me.matches}</div><div class="k">試合数</div></div>
        <div class="statCell"><div class="v">${wr}%</div><div class="k">勝率(${me.wins}勝)</div></div>
        <div class="statCell"><div class="v">${me.placement}位</div><div class="k">順位</div></div>
      </div>
      <h3 class="ptitle" style="font-size:13px;margin:14px 0 4px">職別(本人のみ表示)</h3>${cls}
      <h3 class="ptitle" style="font-size:13px;margin:14px 0 4px">最近の試合</h3>${recent}
      ${state.config && state.config.authEnabled && !state.user
        ? '<p class="muted small" style="margin-top:12px">※ この端末だけの記録です。<a href="#" onclick="MNM.signIn();return false" style="color:#5bc8b0">ログイン</a>すると他の端末でも引き継げます。</p>' : ''}`;
  }

  /* ---------- ランキング ---------- */
  async function renderRank() {
    const body = $('rankBody');
    body.innerHTML = '<span class="muted">読み込み中…</span>';
    let rows = [];
    try { rows = await (await fetch('/leaderboard.json')).json(); } catch (e) { /* noop */ }
    if (!rows.length) { body.innerHTML = '<p class="muted small">まだ記録がありません。</p>'; return; }
    body.innerHTML = rows.slice(0, 50).map(r =>
      `<div class="rowline"><span>${r.place}. ${esc(r.name)} <span class="rk">${r.rank}</span></span>
       <span><b style="color:#e0b64f">${r.rp}</b><span class="muted"> ${r.matches}戦${r.wins}勝</span></span></div>`).join('');
  }

  addEventListener('DOMContentLoaded', initAuth);
  return { go, hideAll, signIn, signOut, authQuery, guestId, renderHome, state,
    refreshResume, resumeMatch, discardMatch, startFlow,
    startGoogle, showEmail, sendCode, verifyCode, authBack, openProfile, afterSignIn };
})();
window.MNM = MNM;
