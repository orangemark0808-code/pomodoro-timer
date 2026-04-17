// ============================================================
// 設定
// ============================================================
const WORK_SECONDS  = 50 * 60;
const BREAK_SECONDS = 10 * 60;
const STORAGE_KEY   = 'pomodoro_state';

// ============================================================
// 状態
// ============================================================
let mode             = 'work';
let totalSeconds     = WORK_SECONDS;
let remaining        = WORK_SECONDS;
let running          = false;
let sessions         = 0;
let intervalId       = null;
let startTimestamp   = null;
let remainingAtStart = null;

// ============================================================
// Service Worker 登録
// ============================================================
let swRegistration = null;

async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    swRegistration = await navigator.serviceWorker.register('./sw.js');
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data.type === 'TIMER_ENDED') {
        if (document.visibilityState === 'visible') {
          onTimerEnd();
        }
      }
    });
  } catch (e) {
    console.warn('ServiceWorker登録失敗:', e);
  }
}

function scheduleSwNotification(delaySec) {
  try {
    var sw = swRegistration && swRegistration.active;
    if (!sw) return;
    sw.postMessage({ type: 'SCHEDULE', delay: delaySec * 1000, isWork: mode === 'work' });
  } catch (e) { console.warn('SW通知スケジュール失敗:', e); }
}

function cancelSwNotification() {
  try {
    var sw = swRegistration && swRegistration.active;
    if (!sw) return;
    sw.postMessage({ type: 'CANCEL' });
  } catch (e) { console.warn('SW通知キャンセル失敗:', e); }
}

// ============================================================
// 通知許可
// ============================================================
const isIos          = /iphone|ipad|ipod/i.test(navigator.userAgent);
const isIosPwa       = ('standalone' in navigator) && !!navigator.standalone;
const notifSupported = ('Notification' in window)
  && ('serviceWorker' in navigator)
  && !(isIos && !isIosPwa);

async function requestNotificationPermission() {
  if (!notifSupported) return false;
  try {
    const result = await Notification.requestPermission();
    document.getElementById('permissionBar').classList.add('hidden');
    return result === 'granted';
  } catch (e) {
    console.warn('通知許可取得失敗:', e);
    return false;
  }
}

function checkNotificationPermission() {
  if (!notifSupported) return;
  if (Notification.permission === 'default') {
    document.getElementById('permissionBar').classList.remove('hidden');
  }
}

// ============================================================
// プログレスリング
// ============================================================
const CIRCLE_R      = 108;
const CIRCUMFERENCE = 2 * Math.PI * CIRCLE_R;
let progressEl      = null;

// ============================================================
// localStorage（Privateモード等で例外が出てもタイマーを止めない）
// ============================================================
function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      mode, totalSeconds, remaining, running, sessions,
      startTimestamp, remainingAtStart,
    }));
  } catch (e) { /* Privateモード等では無視 */ }
}

function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!s) return false;
    mode             = s.mode             !== undefined ? s.mode             : 'work';
    totalSeconds     = s.totalSeconds     !== undefined ? s.totalSeconds     : WORK_SECONDS;
    remaining        = s.remaining        !== undefined ? s.remaining        : WORK_SECONDS;
    running          = s.running          !== undefined ? s.running          : false;
    sessions         = s.sessions         !== undefined ? s.sessions         : 0;
    startTimestamp   = s.startTimestamp   !== undefined ? s.startTimestamp   : null;
    remainingAtStart = s.remainingAtStart !== undefined ? s.remainingAtStart : null;
    return true;
  } catch (e) { return false; }
}

// ============================================================
// 実時刻ベースで remaining を補正
// ============================================================
function recalcRemaining() {
  if (!running || startTimestamp === null) return;
  const elapsed = Math.floor((Date.now() - startTimestamp) / 1000);
  remaining = Math.max(remainingAtStart - elapsed, 0);
}

// ============================================================
// 表示更新
// ============================================================
function updateDisplay() {
  const r = Math.max(remaining, 0);
  const m = Math.floor(r / 60).toString().padStart(2, '0');
  const s = (r % 60).toString().padStart(2, '0');
  document.getElementById('timeDisplay').textContent = `${m}:${s}`;
  progressEl.style.strokeDashoffset = CIRCUMFERENCE * (1 - r / totalSeconds);
  document.title = `${m}:${s} — ${mode === 'work' ? '作業中' : '休憩中'}`;
}

function updateModeUI() {
  const isBreak = mode === 'break';
  document.getElementById('modeLabel').textContent  = isBreak ? '休憩中' : '作業中';
  document.getElementById('modeLabel').className    = 'mode-label' + (isBreak ? ' break' : '');
  document.getElementById('startBtn').className     = 'btn-start'  + (isBreak ? ' break' : '');
  progressEl.className = 'progress-ring__progress'  + (isBreak ? ' break' : '');
  document.body.className = isBreak ? 'break-mode' : '';
  document.getElementById('tabWork').className  = 'tab' + (mode === 'work'  ? ' active-work'  : '');
  document.getElementById('tabBreak').className = 'tab' + (mode === 'break' ? ' active-break' : '');
  document.getElementById('sessionCount').textContent =
    `セッション ${sessions + (mode === 'work' ? 1 : 0)}`;
}

// ============================================================
// タイマー制御
// ============================================================
function toggleTimer() {
  if (running) { pause(); } else { start(); }
}

function start() {
  try { ensureAudioContext(); } catch (e) { console.warn('AudioContext:', e); }

  if (notifSupported && Notification.permission === 'default') requestNotificationPermission();

  startTimestamp   = Date.now();
  remainingAtStart = remaining;
  running          = true;
  document.getElementById('startBtn').textContent = '一時停止';
  saveState();
  scheduleSwNotification(remaining);
  intervalId = setInterval(tick, 1000);
}

function pause() {
  recalcRemaining();
  clearInterval(intervalId);
  cancelSwNotification();
  running          = false;
  startTimestamp   = null;
  remainingAtStart = null;
  document.getElementById('startBtn').textContent = '再開';
  saveState();
  updateDisplay();
}

function resetTimer() {
  clearInterval(intervalId);
  cancelSwNotification();
  running          = false;
  startTimestamp   = null;
  remainingAtStart = null;
  remaining        = totalSeconds;
  document.getElementById('startBtn').textContent = '開始';
  document.getElementById('logText').textContent  = '';
  saveState();
  updateDisplay();
  stopSound();
}

function tick() {
  recalcRemaining();
  updateDisplay();
  saveState();
  if (remaining <= 0) { onTimerEnd(); }
}

let timerEndedLock = false;
function onTimerEnd() {
  if (timerEndedLock) return;
  timerEndedLock = true;
  setTimeout(() => { timerEndedLock = false; }, 2000);

  clearInterval(intervalId);
  cancelSwNotification();
  running          = false;
  startTimestamp   = null;
  remainingAtStart = null;
  remaining        = 0;

  playSound();
  showNotify();

  if (mode === 'work') {
    sessions++;
    document.getElementById('logText').textContent =
      `✅ 作業 ${sessions} セッション完了 — 休憩へ`;
    setTimeout(() => autoSwitchMode('break'), 1200);
  } else {
    document.getElementById('logText').textContent =
      `☕ 休憩終了 — 次のセッションを始めましょう`;
    setTimeout(() => autoSwitchMode('work'), 1200);
  }
  saveState();
}

function autoSwitchMode(nextMode) {
  stopSound();
  mode             = nextMode;
  totalSeconds     = nextMode === 'work' ? WORK_SECONDS : BREAK_SECONDS;
  remaining        = totalSeconds;
  startTimestamp   = null;
  remainingAtStart = null;
  document.getElementById('startBtn').textContent = '開始';
  updateModeUI();
  updateDisplay();
  saveState();
}

function switchMode(m) {
  if (running) pause();
  cancelSwNotification();
  mode             = m;
  totalSeconds     = m === 'work' ? WORK_SECONDS : BREAK_SECONDS;
  remaining        = totalSeconds;
  startTimestamp   = null;
  remainingAtStart = null;
  document.getElementById('startBtn').textContent = '開始';
  document.getElementById('logText').textContent  = '';
  updateModeUI();
  updateDisplay();
  saveState();
}

// ============================================================
// 画面OFF / バックグラウンド復帰
// ============================================================
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (!running) return;

  recalcRemaining();

  if (remaining <= 0) {
    onTimerEnd();
  } else {
    updateDisplay();
    clearInterval(intervalId);
    intervalId = setInterval(tick, 1000);
  }
});

// ============================================================
// 通知音（Web Audio API）
// ============================================================
let soundLooping   = false;
let soundCtx       = null;
let soundLoopTimer = null;

function ensureAudioContext() {
  try {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!soundCtx || soundCtx.state === 'closed') {
      soundCtx = new AC();
    }
    if (soundCtx.state === 'suspended') {
      soundCtx.resume().catch(function() {});
    }
  } catch (e) {
    console.warn('AudioContext初期化失敗:', e);
    soundCtx = null;
  }
  return soundCtx;
}

function playBeepSet(ctx, onFinished) {
  [0, 0.55, 1.1].forEach(delay => {
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime + delay);
    gain.gain.setValueAtTime(0.4, ctx.currentTime + delay);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.55);
    osc.start(ctx.currentTime + delay);
    osc.stop(ctx.currentTime  + delay + 0.55);
  });
  soundLoopTimer = setTimeout(onFinished, 3000);
}

function playSound() {
  if (soundLooping) return;
  soundLooping = true;
  const ctx = ensureAudioContext();
  if (!ctx) { soundLooping = false; return; }
  function loop() {
    if (!soundLooping) return;
    playBeepSet(ctx, loop);
  }
  if (ctx.state === 'running') {
    loop();
  } else {
    ctx.resume().then(loop).catch(() => { soundLooping = false; });
  }
}

function stopSound() {
  soundLooping = false;
  clearTimeout(soundLoopTimer);
  const btn = document.getElementById('soundTestBtn');
  if (btn) btn.textContent = '🔊 通知音をテスト';
}

function toggleTestSound() {
  const btn = document.getElementById('soundTestBtn');
  if (soundLooping) {
    stopSound();
  } else {
    ensureAudioContext();
    playSound();
    if (btn) btn.textContent = '⏹ 音を止める';
  }
}

// ============================================================
// 通知バナー（画面内）
// ============================================================
function showNotify() {
  const banner = document.getElementById('notifyBanner');
  banner.textContent = mode === 'work'
    ? '🍅 作業時間終了！休憩しましょう'
    : '☕ 休憩終了！作業を再開しましょう';
  banner.classList.add('show');
  setTimeout(() => banner.classList.remove('show'), 4000);
}

// ============================================================
// 起動時の状態復元
// ============================================================
async function init() {
  progressEl = document.getElementById('progressCircle');
  progressEl.style.strokeDasharray  = CIRCUMFERENCE;
  progressEl.style.strokeDashoffset = 0;

  // ボタンにイベントリスナーを登録（onclickの代わり）
  document.getElementById('startBtn').addEventListener('click', toggleTimer);
  document.getElementById('resetBtn').addEventListener('click', resetTimer);
  document.getElementById('tabWork').addEventListener('click', function() { switchMode('work'); });
  document.getElementById('tabBreak').addEventListener('click', function() { switchMode('break'); });
  document.getElementById('soundTestBtn').addEventListener('click', toggleTestSound);
  document.getElementById('notifAllowBtn').addEventListener('click', requestNotificationPermission);
  document.getElementById('notifLaterBtn').addEventListener('click', function() {
    document.getElementById('permissionBar').classList.add('hidden');
  });

  await registerSW();
  checkNotificationPermission();

  const restored = loadState();

  if (restored && running) {
    recalcRemaining();

    if (remaining <= 0) {
      remaining = 0;
      running   = false;
      updateModeUI();
      updateDisplay();
      document.getElementById('logText').textContent  = '⚠️ 閉じている間にタイマーが終了しました';
      document.getElementById('startBtn').textContent = '開始';
      saveState();
      showNotify();
    } else {
      updateModeUI();
      updateDisplay();
      document.getElementById('startBtn').textContent = '一時停止';
      scheduleSwNotification(remaining);
      intervalId = setInterval(tick, 1000);
    }
  } else {
    updateModeUI();
    updateDisplay();
    if (restored) {
      document.getElementById('startBtn').textContent = running ? '一時停止' : '開始';
    }
  }
}

document.addEventListener('DOMContentLoaded', init);
