// ============================================================
// Service Worker — ポモドーロタイマー バックグラウンド通知
// ============================================================

let notificationTimer = null;

// インストール・即時有効化
self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', e  => e.waitUntil(clients.claim()));

// メインページからのメッセージを受信
self.addEventListener('message', (event) => {
  const { type } = event.data;

  // タイマー開始 / 再開 → 通知をスケジュール
  if (type === 'SCHEDULE') {
    clearTimeout(notificationTimer);

    const { delay, isWork } = event.data;

    notificationTimer = setTimeout(async () => {
      // 通知を表示
      await self.registration.showNotification('ポモドーロタイマー ⏰', {
        body       : isWork ? '🍅 作業50分完了！休憩しましょう' : '☕ 休憩終了！作業を始めましょう',
        requireInteraction: true,          // 閉じるまで残る
        vibrate    : [400, 150, 400, 150, 400],  // バイブパターン
        tag        : 'pomodoro',           // 同タグは上書き（重複しない）
        renotify   : true,
      });

      // 開いているタブにも終了を通知（タブが見えていれば音を鳴らす）
      const allClients = await clients.matchAll({ includeUncontrolled: true, type: 'window' });
      allClients.forEach(c => c.postMessage({ type: 'TIMER_ENDED', isWork }));

    }, delay);
  }

  // タイマー停止 / リセット → スケジュールをキャンセル
  if (type === 'CANCEL') {
    clearTimeout(notificationTimer);
    notificationTimer = null;
  }
});

// 通知タップ → アプリを前面に出す
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      if (list.length > 0) {
        list[0].focus();
      } else {
        clients.openWindow('./');
      }
    })
  );
});
