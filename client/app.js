/* ═══════════════════════════════════════════════════════════════
   TangoLive – app.js
   Main SPA logic: auth, navigation, streams, socket.io, gifts
═══════════════════════════════════════════════════════════════ */

const API = '';  // same origin
let token = localStorage.getItem('tl_token');
let currentUser = JSON.parse(localStorage.getItem('tl_user') || 'null');
let socket = null;
let currentStream = null;  // stream object being watched
let profileStatsTimer = null;
let chatPartnerId = null; // Currently chatting with this user ID
let socketConnected = false;
let isHost = false;
let guestTimerInterval = null;
let pendingJoinRequest = null; // { userId, streamId, socket_id }
let livekitRoom = null;


// ─── UTILITY ─────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const apiReq = async (method, path, body) => {
    try {
        const res = await fetch(API + path, {
            method,
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: body ? JSON.stringify(body) : undefined,
        });

        const data = await res.json();
        if (!res.ok) {
            console.error(`[API Error] ${method} ${path}:`, data.message || res.statusText);
            throw new Error(data.message || `Request failed with status ${res.status}`);
        }
        return data;
    } catch (err) {
        if (err.name === 'TypeError' && err.message === 'Failed to fetch') {
            showGlobalError('Network error: Please check your internet connection or server status.');
        } else {
            // Re-throw to be handled by the caller (like login-form submit)
            throw err;
        }
    }
};

function showGlobalError(msg) {
    const container = $('global-error-container') || createGlobalErrorContainer();
    container.textContent = msg;
    container.classList.remove('hidden');
    container.style.display = 'block';
    setTimeout(() => {
        container.style.display = 'none';
        container.classList.add('hidden');
    }, 5000);
}

function createGlobalErrorContainer() {
    const div = document.createElement('div');
    div.id = 'global-error-container';
    div.className = 'global-error-toast hidden';
    div.style.cssText = `
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: #ff4d4d;
        color: white;
        padding: 12px 24px;
        border-radius: 8px;
        z-index: 9999;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        font-weight: 600;
        display: none;
    `;
    document.body.appendChild(div);
    return div;
}

// ─── SOCKET INIT ─────────────────────────────────────────────────────
function initSocket() {
    if (socket) return;
    socket = io({ auth: { token: token || null }, transports: ['websocket'] });

    socket.on('viewer-count', ({ count }) => {
        $('hud-viewers').textContent = count;
    });

    socket.on('chat-message', (msg) => {
        appendChat(msg.username, msg.message);
    });

    socket.on('direct-message', data => {
        handleIncomingDirectMessage(data);
    });

    socket.on('reaction', data => {
        if (currentScreen === 'live' && currentStream?.livekit_room === data.roomName) {
            showFloatingReaction(data.emoji);
        }
    });

    socket.on('gift-animation', ({ sender, gift }) => {
        showGiftBurst(gift.icon, sender, gift.name);
    });

    socket.on('stream-ended', ({ message }) => {
        if (!isHost) {
            alert(message || 'Stream has ended.');
            leaveLiveScreen();
        }
    });

    socket.on('user-joined', ({ username }) => {
        appendChat('System', `${username} joined 🎉`, true);
    });

    socket.on('join-request-received', ({ userId, username, streamId }) => {
        showJoinRequestToast(userId, username, streamId);
    });

    // Listen for own join response (e.g., for private/group streams)
    if (currentUser) {
        socket.on(`join-response-${currentUser.id}`, ({ approved, roomName }) => {
            $('joinreq-status').textContent = approved ? '✅ Approved! Joining...' : '❌ Host denied your request.';
            if (approved && currentStream) {
                setTimeout(() => {
                    closeModal('joinreq-modal');
                    enterLiveScreen(currentStream);
                }, 1000);
            }
        });
    }
}

// ─── NAV ──────────────────────────────────────────────────────────────
function navigateTo(screenName) {
    if (screenName === 'golive' && !currentUser) {
        showAuthOverlay('login');
        return;
    }
    if (screenName === 'wallet' && !currentUser) {
        showAuthOverlay('login');
        return;
    }

    document.querySelectorAll('.screen').forEach(s => {
        s.classList.remove('active');
        s.classList.add('hidden');
    });

    const target = $(`screen-${screenName}`);
    if (target) {
        target.classList.remove('hidden');
        target.classList.add('active');
    }

    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const navItem = document.querySelector(`.nav-item[data-screen="${screenName}"]`);
    if (navItem) navItem.classList.add('active');

    // Side effects
    if (screenName === 'golive') initCamera();
    if (screenName === 'wallet') loadWallet();
    if (screenName === 'profile') renderProfile();
    if (screenName === 'home') loadStreams();
    if (screenName === 'chat') renderChatList();
    if (screenName !== 'chat-thread') chatPartnerId = null;
}

// ─── AUTH ──────────────────────────────────────────────────────────────
function showAuthOverlay(form = 'login') {
    $('auth-overlay').classList.remove('hidden');
    showAuthForm(form);
}
function hideAuthOverlay() {
    $('auth-overlay').classList.add('hidden');
    // Start 5-min guest timer
    if (!currentUser) startGuestTimer();
}
function showAuthForm(form) {
    $('login-form').classList.toggle('hidden', form !== 'login');
    $('register-form').classList.toggle('hidden', form !== 'register');
}

$('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('login-email').value;
    const password = $('login-password').value;
    try {
        const user = await apiReq('POST', '/api/auth/login', { email, password });
        saveSession(user);
        hideAuthOverlay();
        afterLogin();
    } catch (err) {
        showError('login-error', err.message);
    }
});

$('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = $('reg-username').value;
    const email = $('reg-email').value;
    const password = $('reg-password').value;
    try {
        const user = await apiReq('POST', '/api/auth/register', { username, email, password });
        saveSession(user);
        hideAuthOverlay();
        afterLogin();
    } catch (err) {
        showError('reg-error', err.message);
    }
});

function saveSession(user) {
    token = user.token;
    currentUser = user;
    localStorage.setItem('tl_token', token);
    localStorage.setItem('tl_user', JSON.stringify(user));
}

function afterLogin() {
    clearGuestTimer();
    $('guest-timer-popup').classList.add('hidden');
    socket = null;
    initSocket();
    renderTopBar();
    navigateTo('home');
}

function logout() {
    token = null;
    currentUser = null;
    localStorage.removeItem('tl_token');
    localStorage.removeItem('tl_user');
    socket?.disconnect();
    socket = null;
    renderTopBar();
    navigateTo('home');
    showAuthOverlay('login');
}

function showError(id, msg) {
    const el = $(id);
    el.textContent = msg;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 4000);
}

// ─── GUEST TIMER ──────────────────────────────────────────────────────
let guestSecondsLeft = 5 * 60;
function startGuestTimer() {
    if (currentUser) return;
    guestSecondsLeft = 5 * 60;
    const popup = $('guest-timer-popup');
    popup.classList.remove('hidden');

    guestTimerInterval = setInterval(() => {
        guestSecondsLeft--;
        const m = Math.floor(guestSecondsLeft / 60);
        const s = guestSecondsLeft % 60;
        $('guest-timer-count').textContent = `${m}:${s.toString().padStart(2, '0')}`;
        if (guestSecondsLeft <= 0) {
            clearGuestTimer();
            popup.classList.add('hidden');
            leaveLiveScreen();
            showAuthOverlay('register');
        }
    }, 1000);
}
function clearGuestTimer() {
    if (guestTimerInterval) { clearInterval(guestTimerInterval); guestTimerInterval = null; }
}

// ─── TOP BAR ──────────────────────────────────────────────────────────
function renderTopBar() {
    const avatarEl = $('user-avatar-top');
    if (currentUser) {
        avatarEl.textContent = currentUser.username.charAt(0).toUpperCase();
        avatarEl.style.display = 'flex';
    } else {
        avatarEl.style.display = 'flex';
        avatarEl.textContent = '?';
    }
}

// ─── HOME FEED ────────────────────────────────────────────────────────
async function loadStreams(cat) {
    const feed = $('stream-feed');
    feed.innerHTML = '<div class="feed-loading"><div class="spinner"></div><p>Loading streams...</p></div>';
    try {
        const endpoint = currentUser ? '/api/streams/all' : '/api/streams';
        const streams = await apiReq('GET', endpoint);
        renderStreamFeed(streams, cat);
    } catch {
        feed.innerHTML = '<div class="feed-loading"><p>Could not load streams.</p></div>';
    }
}

const STREAM_EMOJIS = { Gaming: '🎮', Music: '🎵', Talk: '💬', Dance: '💃', Cooking: '🍳', General: '🌐' };
function renderStreamFeed(streams, cat) {
    const feed = $('stream-feed');
    let filtered = streams;
    if (cat && cat !== 'all') {
        filtered = streams.filter(s => s.category?.toLowerCase() === cat.toLowerCase());
    }
    if (!filtered.length) {
        // INJECT MOCK STREAMS IF NONE EXIST
        filtered = [
            { id: "'mock1'", username: 'GamingGuru', category: 'Gaming', viewer_count: 1240, type: 'public', title: 'Late Night Valorant Ranked!' },
            { id: "'mock2'", username: 'MelodyMaker', category: 'Music', viewer_count: 850, type: 'public', title: 'Acoustic Covers & Chill' },
            { id: "'mock3'", username: 'ChefGordon', category: 'Cooking', viewer_count: 3200, type: 'public', title: 'Making the perfect Carbonara' },
            { id: "'mock4'", username: 'DanceQueen', category: 'Dance', viewer_count: 540, type: 'public', title: 'Learning new K-Pop Choreo' }
        ];
        if (cat && cat !== 'all') {
            filtered = filtered.filter(s => s.category?.toLowerCase() === cat.toLowerCase());
        }

        if (!filtered.length) {
            feed.innerHTML = '<div class="feed-loading"><span style="font-size:2.5rem">📡</span><p>No live streams right now</p></div>';
            return;
        }
    }
    feed.innerHTML = filtered.map((s, i) => `
    <div class="stream-card" style="animation-delay:${i * 0.07}s" onclick="openStream(${s.id})">
      <div class="stream-thumb">
        <span class="stream-thumb-emoji">${STREAM_EMOJIS[s.category] || '🌐'}</span>
        <span style="position:absolute;top:8px;left:8px;z-index:2">
          <span class="live-badge">LIVE</span>
        </span>
        ${s.type && s.type.toLowerCase() !== 'public' ? `
          <div style="position:absolute;top:8px;right:8px;z-index:3;background:rgba(0,0,0,0.5);backdrop-filter:blur(4px);padding:4px 6px;border-radius:8px;border:1px solid var(--glass-border);display:flex;align-items:center;gap:4px">
            <span style="font-size:0.9rem">${s.type.toLowerCase() === 'private' ? '🔒' : '👥'}</span>
          </div>` : ''}
      </div>
      <div class="stream-card-info">
        <div class="stream-card-host">${s.username}</div>
        <div class="stream-card-meta">
          <span class="viewer-count">👁 ${s.viewer_count || 0}</span>
        </div>
        <div class="stream-card-cat">${s.category || 'General'}</div>
      </div>
    </div>
  `).join('');
}

document.querySelectorAll('.cat-pill').forEach(pill => {
    pill.addEventListener('click', () => {
        document.querySelectorAll('.cat-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        loadStreams(pill.dataset.cat);
    });
});

// ─── OPEN STREAM ──────────────────────────────────────────────────────
async function openStream(streamId) {
    if (typeof streamId === 'string' && streamId.startsWith('mock')) {
        alert("This is just a sample placeholder stream to show what the UI looks like!");
        return;
    }
    try {
        const stream = await apiReq('GET', `/api/streams/${streamId}`);
        currentStream = stream;
        isHost = currentUser && currentUser.id === stream.host_id;

        // For private/group: show join request flow
        if ((stream.type === 'private' || stream.type === 'group') && !isHost) {
            if (!currentUser) { showAuthOverlay('login'); return; }
            showJoinRequestModal(stream);
            return;
        }

        enterLiveScreen(stream);

        // Start guest timer if not logged in
        if (!currentUser) startGuestTimer();
    } catch (err) {
        alert('Failed to open stream: ' + err.message);
    }
}

function enterLiveScreen(stream) {
    currentStream = stream;

    // Update HUD
    $('hud-title').textContent = stream.title || 'Live Stream';
    $('hud-viewers').textContent = stream.viewer_count || 0;
    $('hud-host-name').textContent = stream.username || 'Host';
    $('hud-host-avatar').textContent = (stream.username || 'H').charAt(0).toUpperCase();

    // Show/hide end stream button
    $('end-stream-btn').classList.toggle('hidden', !isHost);

    // Clear chat
    $('chat-messages').innerHTML = '';

    // Switch screen
    document.querySelectorAll('.screen').forEach(s => { s.classList.remove('active'); s.classList.add('hidden'); });
    $('screen-live').classList.remove('hidden');
    $('screen-live').classList.add('active');

    // Join socket room
    initSocket();
    joinRoom(stream.livekit_room);

    // Fetch LiveKit token and connect
    if (currentUser) {
        apiReq('POST', '/api/livekit/token', {
            room: stream.livekit_room,
            identity: currentUser.username,
            canPublish: isHost
        }).then(data => {
            connectToLiveKit(data.token, stream.livekit_room);
        }).catch(err => {
            console.error('Failed to get LiveKit token:', err);
        });
    }

    // Load gifts
    loadGifts();
}


function joinRoom(roomName) {
    if (!socket || !roomName) return;
    socket.emit('join-room', { roomName });
}

// ─── LIVEKIT INTEGRATION ──────────────────────────────────────────────
async function connectToLiveKit(token, roomName) {
    if (livekitRoom) await livekitRoom.disconnect();

    livekitRoom = new LivekitClient.Room({
        adaptiveStream: true,
        dynacast: true,
    });

    // Setup event listeners
    livekitRoom
        .on(LivekitClient.RoomEvent.TrackSubscribed, handleTrackSubscribed)
        .on(LivekitClient.RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed)
        .on(LivekitClient.RoomEvent.Disconnected, () => {
            console.log('Disconnected from LiveKit');
        });

    try {
        const config = await apiReq('GET', '/api/config');
        const livekitUrl = config.livekitUrl;
        
        await livekitRoom.connect(livekitUrl, token);

        console.log('Connected to LiveKit room:', roomName);

        if (isHost && mediaStream) {
            // Publish local tracks
            const tracks = await LivekitClient.createLocalTracks({
                audio: true,
                video: { resolution: LivekitClient.VideoPresets.h720.resolution },
            });
            for (const track of tracks) {
                await livekitRoom.localParticipant.publishTrack(track);
            }
            console.log('Local tracks published');
        }
    } catch (error) {
        console.error('Failed to connect to LiveKit:', error);
        alert('Video connection failed. Please check your LiveKit configuration.');
    }
}

function handleTrackSubscribed(track, publication, participant) {
    if (track.kind === LivekitClient.Track.Kind.Video) {
        const remoteVideo = $('remote-video');
        remoteVideo.classList.remove('hidden');
        track.attach(remoteVideo);
    } else if (track.kind === LivekitClient.Track.Kind.Audio) {
        track.attach();
    }
}

function handleTrackUnsubscribed(track, publication, participant) {
    track.detach();
    if (track.kind === LivekitClient.Track.Kind.Video) {
        $('remote-video').classList.add('hidden');
    }
}


function leaveLiveScreen() {
    if (socket && currentStream) {
        socket.emit('leave-room', { roomName: currentStream.livekit_room });
    }
    if (livekitRoom) {
        livekitRoom.disconnect();
        livekitRoom = null;
    }
    currentStream = null;

    isHost = false;
    clearGuestTimer();
    $('guest-timer-popup').classList.add('hidden');
    stopCamera();
    navigateTo('home');
}

// ─── GO LIVE ──────────────────────────────────────────────────────────
let mediaStream = null;
async function initCamera() {
    try {
        mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        $('camera-preview').srcObject = mediaStream;
    } catch {
        console.warn('Camera not available');
    }
}
function stopCamera() {
    if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }
    const preview = $('camera-preview');
    if (preview) preview.srcObject = null;
}

// Stream type picker
document.querySelectorAll('.type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    });
});

$('go-live-btn').addEventListener('click', async () => {
    if (!currentUser) { showAuthOverlay('login'); return; }
    const title = $('stream-title').value || 'My Live Stream';
    const category = $('stream-category').value;
    const type = document.querySelector('.type-btn.active')?.dataset.type || 'public';

    try {
        const stream = await apiReq('POST', '/api/streams', { title, category, type });
        currentStream = stream;
        isHost = true;

        // Fetch LiveKit token for host
        const tkData = await apiReq('POST', '/api/livekit/token', {
            room: stream.livekit_room,
            identity: currentUser.username,
            canPublish: true
        });

        enterLiveScreen(stream);
        connectToLiveKit(tkData.token, stream.livekit_room);

        // Show local camera on live screen
        const localVideo = $('local-video');
        localVideo.classList.remove('hidden');
        if (mediaStream) localVideo.srcObject = mediaStream;
        $('remote-video').classList.add('hidden');
    } catch (err) {
        alert('Failed to go live: ' + err.message);
    }
});


// ─── END STREAM ────────────────────────────────────────────────────────
async function endStream() {
    if (!currentStream || !isHost) return;
    try {
        await apiReq('PUT', `/api/streams/${currentStream.id}/end`);
        socket?.emit('end-stream', { roomName: currentStream.livekit_room });
        leaveLiveScreen();
    } catch (err) { alert(err.message); }
}

// ─── CHAT ──────────────────────────────────────────────────────────────
$('chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendChatMessage('live');
});
function sendChatMessage(context) {
    const input = $('chat-input');
    const msg = input.value.trim();
    if (!msg || !currentStream) return;
    socket?.emit('chat-message', { roomName: currentStream.livekit_room, message: msg });
    input.value = '';
}
function appendChat(username, message, isSystem = false) {
    const box = $('chat-messages');
    const div = document.createElement('div');
    div.className = 'chat-msg';
    div.innerHTML = `<span class="chat-msg-name" style="${isSystem ? 'color:var(--accent2)' : ''}">${username}:</span><span class="chat-msg-text">${message}</span>`;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
}

// ─── REACTIONS ─────────────────────────────────────────────────────────
function sendReaction(emoji) {
    if (!currentStream) return;
    socket?.emit('reaction', { roomName: currentStream.livekit_room, emoji });
    showFloatingReaction(emoji);
}
function showFloatingReaction(emoji) {
    const overlay = $('reaction-overlay');
    const el = document.createElement('div');
    el.className = 'floating-reaction';
    el.textContent = emoji;
    el.style.left = Math.random() * 70 + 5 + '%';
    overlay.appendChild(el);
    setTimeout(() => el.remove(), 2500);
}

// ─── GIFTS ─────────────────────────────────────────────────────────────
let giftsCache = [];
async function loadGifts() {
    if (giftsCache.length) { renderGiftList(); return; }
    try { giftsCache = await apiReq('GET', '/api/gifts'); renderGiftList(); } catch { }
}
function renderGiftList() {
    $('gift-list').innerHTML = giftsCache.map(g => `
    <div class="gift-item" onclick="sendGift(${g.id})">
      <div class="gift-icon">${g.icon}</div>
      <div class="gift-name">${g.name}</div>
      <div class="gift-cost">🪙${g.coin_cost}</div>
    </div>
  `).join('');
}
function toggleGiftPanel() {
    if (!currentUser) { showAuthOverlay('login'); return; }
    $('gift-panel').classList.toggle('hidden');
}
async function sendGift(giftId) {
    if (!currentUser || !currentStream) return;
    const gift = giftsCache.find(g => g.id === giftId);
    if (!gift) return;
    try {
        await apiReq('POST', '/api/gifts/send', {
            gift_id: giftId,
            stream_id: currentStream.id,
            receiver_id: currentStream.host_id,
        });
        socket?.emit('gift-sent', {
            roomName: currentStream.livekit_room,
            gift,
            receiverUsername: currentStream.username,
        });
        showGiftBurst(gift.icon, 'You', gift.name);
        $('gift-panel').classList.add('hidden');
        // Refresh user coins locally
        currentUser.coin_balance -= gift.coin_cost;
        localStorage.setItem('tl_user', JSON.stringify(currentUser));
    } catch (err) { alert(err.message); }
}
function showGiftBurst(icon, sender, name) {
    const el = document.createElement('div');
    el.className = 'gift-burst';
    el.innerHTML = `${icon}<br><small style="font-size:.5em;opacity:.8">${sender} sent ${name}</small>`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1600);
}

// ─── WALLET ────────────────────────────────────────────────────────────
async function loadWallet() {
    $('wallet-balance').textContent = '...';
    $('wallet-transactions').innerHTML = '';
    try {
        const data = await apiReq('GET', '/api/wallet');
        $('wallet-balance').textContent = data.coin_balance.toLocaleString();
        if (!data.transactions.length) {
            $('wallet-transactions').innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:20px">No transactions yet</p>';
            return;
        }
        $('wallet-transactions').innerHTML = data.transactions.map(t => {
            const isGiftDebit = t.sender_id === currentUser.id && t.receiver_id !== currentUser.id && t.receiver_id !== null;
            const isWithdrawal = t.gift_name === 'Withdrawal';
            const isPurchase = t.gift_name === 'Coin Purchase';

            const isDebit = isGiftDebit || isWithdrawal; // Money leaving or being locked for withdrawal

            let typeLabel = isGiftDebit ? 'Gift Sent' : 'Gift Received';
            let icon = t.gift_icon || '🪙';
            let subText = isGiftDebit ? 'To ' + (t.receiver_name || '?') : 'From ' + (t.sender_name || '?');

            if (isPurchase) {
                typeLabel = 'Coins Purchased';
                icon = '💳';
                subText = 'via Credit Card';
            } else if (isWithdrawal) {
                typeLabel = 'Withdrawal Request';
                icon = '💸';
                subText = 'Pending Approval';
            }

            return `
        <div class="txn-item">
          <div class="txn-icon">${icon}</div>
          <div class="txn-info">
            <div class="txn-title">${typeLabel}</div>
            <div class="txn-sub">${subText}</div>
          </div>
          <div class="txn-amount ${isDebit ? 'debit' : 'credit'}">${isDebit ? '-' : '+'}${t.amount} 🪙</div>
        </div>
      `;
        }).join('');
    } catch (err) { $('wallet-balance').textContent = 'Error'; }
}

function showWithdrawModal() {
    if (!currentUser) { showAuthOverlay('login'); return; }
    $('withdraw-modal').classList.remove('hidden');
}
async function submitWithdrawal() {
    const amount = parseInt($('withdraw-amount').value);
    if (!amount || amount < 100) { showError('withdraw-msg', 'Minimum 100 coins'); return; }
    try {
        await apiReq('POST', '/api/wallet/withdraw', { amount });
        closeModal('withdraw-modal');

        // Sync the local current user profile
        if (currentUser) {
            currentUser.coin_balance -= amount;
            localStorage.setItem('tl_user', JSON.stringify(currentUser));
        }

        loadWallet(); // Refresh UI
        alert("Withdrawal request submitted! 100 coins have been deducted.");
    } catch (err) { showError('withdraw-msg', err.message); }
}

async function buyCoins(amount) {
    if (!currentUser) { showAuthOverlay('login'); return; }
    if (!confirm(`Confirm purchase of ${amount} coins?`)) return;

    try {
        await apiReq('POST', '/api/wallet/buy', { coins: amount });

        // Update local session
        if (currentUser) {
            currentUser.coin_balance += amount;
            localStorage.setItem('tl_user', JSON.stringify(currentUser));
        }

        loadWallet(); // Refresh UI
        alert(`Successfully added ${amount} coins to your wallet! 🪙`);
    } catch (err) {
        alert("Purchase failed: " + err.message);
    }
}

// ─── CHAT ────────────────────────────────────────────────────────────
async function renderChatList() {
    if (!currentUser) {
        $('chat-list').innerHTML = '<div class="profile-guest"><span class="empty-icon">💬</span><p>Login to chat with others</p></div>';
        return;
    }
    try {
        const convos = await apiReq('GET', '/api/messages');
        const list = $('chat-list');
        if (!convos.length) {
            list.innerHTML = '<div class="empty-state"><span class="empty-icon">💬</span><p>No messages yet</p></div>';
            return;
        }
        list.innerHTML = convos.map(c => `
      <div class="chat-list-item glass" onclick="openChatThread(${c.partner_id}, '${c.partner_name}')" style="display:flex;align-items:center;padding:12px;border-radius:12px;gap:12px;cursor:pointer">
         <div class="profile-avatar-lg" style="width:48px;height:48px;font-size:1.2rem;background:linear-gradient(135deg,#c084fc,#818cf8)">${c.partner_name.charAt(0).toUpperCase()}</div>
         <div style="flex:1">
           <div style="font-weight:600;margin-bottom:4px;color:var(--text)">${c.partner_name}</div>
           <div style="color:var(--text);opacity:0.7;font-size:0.85rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px;">${c.last_message}</div>
         </div>
         <div style="font-size:0.75rem;color:var(--text);opacity:0.5">${formatTime(c.time)}</div>
         ${!c.is_read && c.partner_id !== currentUser.id ? '<div style="width:8px;height:8px;background:var(--accent);border-radius:50%"></div>' : ''}
      </div>
    `).join('');
    } catch (err) {
        console.error(err);
    }
}

async function openChatThread(partnerId, partnerName) {
    chatPartnerId = partnerId;
    $('chat-thread-partner-name').textContent = partnerName;
    $('chat-thread-partner-avatar').textContent = partnerName.charAt(0).toUpperCase();
    $('chat-thread-messages').innerHTML = '<div class="feed-loading">📡 Loading messages...</div>';
    navigateTo('chat-thread');

    try {
        const messages = await apiReq('GET', `/api/messages/${partnerId}`);
        renderThreadMessages(messages);
    } catch (err) {
        console.error(err);
    }
}

function renderThreadMessages(messages) {
    const box = $('chat-thread-messages');
    box.innerHTML = messages.map(m => {
        const isMe = m.sender_id === currentUser.id;
        return `
      <div style="align-self: ${isMe ? 'flex-end' : 'flex-start'}; background: ${isMe ? 'var(--accent)' : 'var(--bg-card)'}; padding: 10px 14px; border-radius: 18px; border-bottom-${isMe ? 'right' : 'left'}-radius: 4px; max-width: 80%; border: 1px solid var(--glass-border)">
        <div style="font-size: 0.9rem">${m.message}</div>
        <div style="font-size: 0.65rem; opacity: 0.5; margin-top: 4px; text-align: right">${formatTime(m.created_at)}</div>
      </div>
    `;
    }).join('');
    box.scrollTop = box.scrollHeight;
}

function sendDirectMessage() {
    const input = $('chat-thread-input');
    const msg = input.value.trim();
    if (!msg || !chatPartnerId) return;

    socket.emit('direct-message', { receiverId: chatPartnerId, message: msg });
    input.value = '';
}

function handleIncomingDirectMessage(data) {
    // If we are currently looking at this thread, append it
    if (chatPartnerId === data.sender_id || chatPartnerId === data.receiver_id) {
        const box = $('chat-thread-messages');
        const isMe = data.sender_id === currentUser.id;
        const msgHtml = `
      <div style="align-self: ${isMe ? 'flex-end' : 'flex-start'}; background: ${isMe ? 'var(--accent)' : 'var(--bg-card)'}; padding: 10px 14px; border-radius: 18px; border-bottom-${isMe ? 'right' : 'left'}-radius: 4px; max-width: 80%; border: 1px solid var(--glass-border)">
        <div style="font-size: 0.9rem">${data.message}</div>
        <div style="font-size: 0.65rem; opacity: 0.5; margin-top: 4px; text-align: right">${formatTime(data.created_at)}</div>
      </div>
    `;
        box.insertAdjacentHTML('beforeend', msgHtml);
        box.scrollTop = box.scrollHeight;
    }

    // Always refresh the chat list if we are on that screen
    if (currentScreen === 'chat') {
        renderChatList();
    }
}

function formatTime(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ─── PROFILE ───────────────────────────────────────────────────────────
async function renderProfile() {
    const guest = $('profile-guest-msg');
    const user = $('profile-user');
    if (!currentUser) {
        guest.classList.remove('hidden');
        user.classList.add('hidden');
    } else {
        guest.classList.add('hidden');
        user.classList.remove('hidden');

        // Fetch fresh profile data
        try {
            const freshProfile = await apiReq('GET', '/api/auth/me');
            currentUser = freshProfile;
            localStorage.setItem('tl_user', JSON.stringify(freshProfile));

            $('profile-username').textContent = currentUser.username;
            $('profile-email').textContent = currentUser.email;
            $('profile-coins').textContent = (currentUser.coin_balance || 0).toLocaleString();
            $('profile-followers').textContent = (currentUser.followers || 0).toLocaleString();
            $('profile-streams').textContent = (currentUser.total_streams || 0).toLocaleString();

            const avatar = $('profile-avatar-el');
            avatar.textContent = currentUser.username.charAt(0).toUpperCase();
        } catch (e) {
            console.error("Failed to fetch fresh profile", e);
        }
    }
}

// ─── PRIVATE/GROUP JOIN REQUEST ────────────────────────────────────────
function showJoinRequestModal(stream) {
    $('joinreq-status').textContent = 'Waiting for host...';
    $('joinreq-modal').classList.remove('hidden');
    // Notify host via socket
    initSocket();
    joinRoom(stream.livekit_room);
    socket?.emit('join-request', { roomName: stream.livekit_room, streamId: stream.id });
}

function showJoinRequestToast(userId, username, streamId) {
    pendingJoinRequest = { userId, streamId };
    $('join-req-username').textContent = username;
    $('join-request-toast').classList.remove('hidden');
    setTimeout(() => $('join-request-toast').classList.add('hidden'), 15000);
}

async function respondToJoinRequest(approved) {
    $('join-request-toast').classList.add('hidden');
    if (!pendingJoinRequest || !currentStream) return;
    const { userId } = pendingJoinRequest;
    const status = approved ? 'approved' : 'rejected';

    // Update DB
    try { await apiReq('POST', `/api/streams/${currentStream.id}/request`, {}); } catch { }
    socket?.emit('join-request-response', { userId, approved, roomName: currentStream.livekit_room });
    pendingJoinRequest = null;
}

// ─── MODAL HELPERS ─────────────────────────────────────────────────────
function closeModal(id) { $(id)?.classList.add('hidden'); }

// ─── INIT ──────────────────────────────────────────────────────────────
(function init() {
    renderTopBar();
    initSocket();
    loadStreams();

    // If no user, show auth on first load after brief delay
    if (!currentUser) {
        setTimeout(() => {
            if (!currentUser) showAuthOverlay('login');
        }, 1000);
    }
})();
