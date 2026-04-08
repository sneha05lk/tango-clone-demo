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
let pendingGuestInvite = null; // { hostId, roomName }
let isGuestStreamer = false;
let activeGuestIds = new Set(); // To track UI elements for guests


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
    // Remove transport restriction to allow polling fallback for better stability on unstable networks
    socket = io({ auth: { token: token || null } });

    socket.on('viewer-count', ({ count }) => {
        $('hud-viewers').textContent = count;
    });

    socket.on('chat-message', (msg) => {
        appendChat(msg.username, msg.message, false, msg.avatar);
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

        // Co-streaming: Host invited me
        socket.on('guest-invite-received', ({ hostId, hostName, roomName }) => {
            if (isGuestStreamer) return; // Already streaming
            pendingGuestInvite = { hostId, roomName };
            $('guest-invite-msg').textContent = `${hostName} invited you to go live!`;
            $('guest-invite-toast').classList.remove('hidden');
            setTimeout(() => $('guest-invite-toast').classList.add('hidden'), 20000);
        });

        // Co-streaming: Viewer replied to host
        socket.on('guest-invite-reply', ({ userId, username, accepted, roomName }) => {
            if (accepted) {
                appendChat('System', `🎉 ${username} accepted your invite and is joining!`, true);
            } else {
                appendChat('System', `❌ ${username} declined your invitation.`, true);
            }
        });

        // Co-streaming: Host kicked me
        socket.on('guest-kicked', ({ roomName }) => {
            if (isGuestStreamer) {
                alert('The host has ended your guest session.');
                stopGuestStream();
            }
        });

        // Co-streaming: Update grid when someone leaves
        socket.on('guest-left', ({ userId }) => {
            removeGuestVideo(userId);
        });
    }
}

// ─── SEARCH ───────────────────────────────────────────────────────────
function initSearch() {
    const searchInput = $('global-search');
    const searchWrap = document.querySelector('.search-bar-wrap');
    
    searchInput.addEventListener('input', debounce((e) => {
        const query = e.target.value.trim();
        if (query.length >= 2) {
            searchAll(query);
        } else if (query.length === 0) {
            loadStreams();
        }
    }, 500));

    const toggleSearch = () => {
        searchWrap.classList.toggle('active');
        if (searchWrap.classList.contains('active')) {
            searchInput.focus();
        } else {
            searchInput.value = '';
            if (currentScreen === 'home') loadStreams();
        }
    };

    document.querySelector('.search-trigger').addEventListener('click', (e) => {
        e.stopPropagation();
        toggleSearch();
    });

    searchInput.addEventListener('click', (e) => e.stopPropagation());

    document.addEventListener('click', (e) => {
        if (searchWrap.classList.contains('active')) {
            searchWrap.classList.remove('active');
            searchInput.value = '';
        }
    });
}

async function searchAll(query) {
    const feed = $('stream-feed');
    feed.innerHTML = '<div class="feed-loading"><div class="spinner"></div><p>Searching...</p></div>';
    try {
        const [streams, users] = await Promise.all([
            apiReq('GET', `/api/streams/search?q=${query}`),
            apiReq('GET', `/api/users/search?q=${query}`)
        ]);
        renderSearchResults(streams, users);
    } catch {
        feed.innerHTML = '<div class="feed-loading"><p>Search failed.</p></div>';
    }
}

function renderSearchResults(streams, users) {
    const feed = $('stream-feed');
    let html = '';
    
    if (streams.length) {
        html += '<h3 style="grid-column: 1/-1; font-size: 1.1rem; margin: 10px 0;">Live Streams</h3>';
        html += renderStreamFeedHTML(streams);
    }
    
    if (users.length) {
        html += '<h3 style="grid-column: 1/-1; font-size: 1.1rem; margin: 15px 0 10px;">Users</h3>';
        html += users.map(u => {
            const initials = u.username.charAt(0).toUpperCase();
            const avatarStyle = u.avatar ? `background-image:url(${u.avatar});background-size:cover;background-position:center;` : '';
            return `
                <div class="glass" style="display:flex; align-items:center; gap:12px; padding:10px; border-radius:12px; cursor:pointer;" onclick="viewUserProfile(${u.id})">
                    <div class="user-avatar-sm" style="background: linear-gradient(135deg, var(--accent), var(--accent2)); width:40px; height:40px; display:flex; align-items:center; justify-content:center; color:white; font-weight:bold; border-radius:50%; ${avatarStyle}">${u.avatar ? '' : initials}</div>
                    <div style="font-weight:600;">${u.username}</div>
                </div>
            `;
        }).join('');
    }
    
    if (!streams.length && !users.length) {
        html = '<div class="feed-loading"><p>No results found.</p></div>';
    }
    
    feed.innerHTML = html;
}

function debounce(fn, delay) {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => fn(...args), delay);
    };
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
    if (screenName === 'golive') {
        initCamera();
    } else {
        stopCamera();
    }
    
    if (screenName === 'wallet') loadWallet();
    if (screenName === 'profile') renderProfile();
    if (screenName === 'chat') renderChatList();
    if (screenName !== 'chat-thread') chatPartnerId = null;
    if (screenName !== 'view-profile' && screenName !== 'follow-list') {
        viewProfileUserId = null;
    }
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
    $('login-pane').classList.toggle('hidden', form !== 'login');
    $('register-pane').classList.toggle('hidden', form !== 'register');
}

$('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('login-email').value.trim().toLowerCase();
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
    const username = $('reg-username').value.trim();
    const email = $('reg-email').value.trim().toLowerCase();
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
    
    // Explicitly disconnect old guest socket before creating a new authenticated one
    if (socket) {
        socket.disconnect();
        socket = null;
    }
    
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
    clearGuestTimer(); // Ensure only one timer is running at a time
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
        setAvatar(avatarEl, currentUser.avatar, currentUser.username);
    } else {
        setAvatar(avatarEl, null, null);
    }
}

// ─── HOME FEED ────────────────────────────────────────────────────────
async function loadStreams(cat) {
    const feed = $('stream-feed');
    feed.innerHTML = '<div class="feed-loading"><div class="spinner"></div><p>Loading streams...</p></div>';
    try {
        let endpoint = currentUser ? '/api/streams/all' : '/api/streams';
        if (cat === 'following') endpoint += '?category=following';
        
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
    if (cat && cat !== 'all' && cat !== 'following') {
        filtered = streams.filter(s => s.category?.toLowerCase() === cat.toLowerCase());
    }
    if (!filtered.length) {
        if (cat === 'following') {
            feed.innerHTML = '<div class="feed-loading"><span style="font-size:2.5rem">🤝</span><p>No one you follow is live. Explore some new hosts!</p></div>';
            return;
        }
        
        filtered = [
            { id: "'mock1'", username: 'GamingGuru', category: 'Gaming', viewer_count: 1240, type: 'public', title: 'Late Night Valorant Ranked!' },
            { id: "'mock2'", username: 'MelodyMaker', category: 'Music', viewer_count: 850, type: 'public', title: 'Acoustic Covers & Chill' },
            { id: "'mock3'", username: 'ChefGordon', category: 'Cooking', viewer_count: 3200, type: 'public', title: 'Making the perfect Carbonara' },
            { id: "'mock4'", username: 'DanceQueen', category: 'Dance', viewer_count: 540, type: 'public', title: 'Learning new K-Pop Choreo' }
        ];
        if (cat && cat !== 'all') {
            filtered = filtered.filter(s => s.category?.toLowerCase() === cat.toLowerCase());
        }
    }
    feed.innerHTML = renderStreamFeedHTML(filtered);
}

function captureThumbnail() {
    const video = document.getElementById('local-video');
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 180;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.8));
}

function renderStreamFeedHTML(streams) {
    return streams.map((s, i) => {
        const initials = s.username ? s.username.charAt(0).toUpperCase() : '?';
        const thumbBg = s.thumbnail ? `background-image:url(${s.thumbnail});background-size:cover;background-position:center;` : '';

        return `
    <div class="stream-card" style="animation-delay:${i * 0.07}s" onclick="openStream(${s.id})">
      <div class="stream-thumb" style="${thumbBg}">
        ${!s.thumbnail ? `<span class="stream-thumb-emoji">${STREAM_EMOJIS[s.category] || '🌐'}</span>` : ''}
        <div class="stream-thumb-overlay"></div>
        <span style="position:absolute;top:8px;left:8px;z-index:2">
          <span class="live-badge">LIVE</span>
          ${s.is_trending ? '<span class="trending-badge">🔥 TRENDING</span>' : ''}
        </span>
        ${s.type && s.type.toLowerCase() !== 'public' ? `
          <div style="position:absolute;top:8px;right:8px;z-index:3;background:rgba(0,0,0,0.5);backdrop-filter:blur(4px);padding:4px 6px;border-radius:8px;border:1px solid var(--glass-border);display:flex;align-items:center;gap:4px">
            <span style="font-size:0.9rem">${s.type.toLowerCase() === 'private' ? '🔒' : '👥'}</span>
          </div>` : ''}
      </div>
      <div class="stream-card-info">
        <div style="display:flex; align-items:center; gap:8px">
           <div class="thumb-avatar" style="width:20px;height:20px;font-size:0.6rem;background:var(--accent);display:flex;align-items:center;justify-content:center;color:white;border-radius:50%;background-size:cover;background-position:center;${s.avatar ? `background-image:url(${s.avatar})` : ''}">${s.avatar ? '' : initials}</div>
           <div class="stream-card-host">${s.username}</div>
        </div>
        <div class="stream-card-meta">
          <span class="viewer-count">👁 ${s.viewer_count || 0}</span>
        </div>
        <div class="stream-card-cat">${s.category || 'General'}</div>
      </div>
    </div>
  `; }).join('');
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
    stopCamera(); // Ensure preview camera is released
    
    // NEW: Reset co-streaming states for the new session
    activeGuestIds.clear();
    isGuestStreamer = false;
    $('video-area').innerHTML = ''; // Clear all old video wrappers
    $('video-area').className = 'video-area grid-1'; // Reset grid

    // Update HUD
    $('hud-title').textContent = stream.title || 'Live Stream';
    $('hud-viewers').textContent = stream.viewer_count || 0;
    $('hud-host-name').textContent = stream.username || 'Host';
    
    setAvatar($('hud-host-avatar'), stream.avatar, stream.username || 'H');

    // Show/hide end stream button & host controls
    const endBtn = $('end-stream-btn');
    if (endBtn) endBtn.classList.toggle('hidden', !isHost);
    
    const hostCtrls = $('host-controls');
    if (hostCtrls) hostCtrls.classList.toggle('hidden', !isHost);

    // Initial state for host toggles
    if (isHost) {
        const micBtn = $('hud-mic-btn');
        const camBtn = $('hud-cam-btn');
        if (micBtn) {
            micBtn.classList.remove('muted');
            micBtn.textContent = '🎤';
        }
        if (camBtn) {
            camBtn.classList.remove('muted');
            camBtn.textContent = '📷';
        }
        const vPlaceholder = $('video-placeholder');
        if (vPlaceholder) vPlaceholder.classList.add('hidden');
    }

    // Clear chat
    $('chat-messages').innerHTML = '';

    // Switch screen
    document.querySelectorAll('.screen').forEach(s => { s.classList.remove('active'); s.classList.add('hidden'); });
    $('screen-live').classList.remove('hidden');
    $('screen-live').classList.add('active');

    // Join socket room
    initSocket();
    joinRoom(stream.livekit_room);

    // Create host's own local video wrapper in the grid
    if (isHost) {
        const videoArea = $('video-area');
        const localWrapper = document.createElement('div');
        localWrapper.id = 'video-wrapper-__local__';
        localWrapper.className = 'video-wrapper';
        const localVid = document.createElement('video');
        localVid.id = 'local-video';
        localVid.className = 'live-video';
        localVid.autoplay = true;
        localVid.muted = true;
        localVid.playsInline = true;
        const badge = document.createElement('div');
        badge.className = 'guest-name-badge';
        badge.textContent = (currentUser?.username || 'You') + ' (Host)';
        localWrapper.appendChild(localVid);
        localWrapper.appendChild(badge);
        videoArea.insertBefore(localWrapper, videoArea.firstChild);
        // Note: We don't add '__local__' to activeGuestIds anymore. 
        // updateVideoGrid() handles the local user separately.
        updateVideoGrid();
    }

    // Fetch LiveKit token and connect (now allowing guests!)
    apiReq('POST', '/api/livekit/token', {
        room: stream.livekit_room,
        identity: currentUser ? currentUser.username : null, // Controller will fallback for guest
        canPublish: isHost
    }).then(data => {
        connectToLiveKit(data.token, stream.livekit_room);
    }).catch(err => {
        console.error('Failed to get LiveKit token:', err);
        // If guest, show a login hint?
        if (!currentUser) {
            appendChat('System', 'You are watching as a guest. Log in to chat and send gifts!', true);
        }
    });

    // Load gifts
    loadGifts();

    // Check follow status
    updateFollowButton();
}


// ─── FOLLOW SYSTEM ────────────────────────────────────────────────────
async function toggleFollow() {
    if (!currentUser) { showAuthOverlay('login'); return; }
    if (!currentStream || isHost) return;

    const followBtn = $('hud-follow-btn');
    const isFollowing = followBtn.classList.contains('following');
    const method = isFollowing ? 'DELETE' : 'POST';

    try {
        await apiReq(method, `/api/users/follow/${currentStream.host_id}`);
        updateFollowButton();
    } catch (err) {
        console.error("Follow error:", err);
    }
}

async function updateFollowButton() {
    const btn = $('hud-follow-btn');
    if (!btn) return;

    if (!currentUser || !currentStream || isHost) {
        btn.classList.add('hidden');
        return;
    }

    try {
        const { isFollowing } = await apiReq('GET', `/api/users/follow-status/${currentStream.host_id}`);
        btn.classList.remove('hidden');
        btn.classList.toggle('following', isFollowing);
        btn.textContent = isFollowing ? 'Following' : '+ Follow';
    } catch (e) {
        btn.classList.add('hidden');
    }
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
        .on(LivekitClient.RoomEvent.AudioPlaybackStatusChanged, handleAudioPlaybackStatus)
        .on(LivekitClient.RoomEvent.TrackMuted, (pub, part) => handleTrackMuteChange(pub, part, true))
        .on(LivekitClient.RoomEvent.TrackUnmuted, (pub, part) => handleTrackMuteChange(pub, part, false))
        .on(LivekitClient.RoomEvent.Disconnected, () => {
            console.log('Disconnected from LiveKit');
        });

    try {
        const config = await apiReq('GET', '/api/config');
        const livekitUrl = config.livekitUrl;
        
        await livekitRoom.connect(livekitUrl, token);
        console.log('Connected to LiveKit room:', roomName);

        // Check if audio is already blocked at start
        if (!isHost && !livekitRoom.canPlaybackAudio) {
            console.warn('Audio blocked immediately on connect. Showing prompt.');
            showAudioPrompt();
        }
        
        // Try to start audio immediately since the user just clicked a stream card (user gesture)
        if (!isHost) {
            livekitRoom.startAudio().catch(e => console.warn('Early startAudio failed:', e));
        }

        if (isHost) {
            // Stop existing preview to free up camera/mic Device for LiveKit
            stopCamera();
            
            // Publish local tracks
            const tracks = await LivekitClient.createLocalTracks({
                audio: true,
                video: { resolution: LivekitClient.VideoPresets.h720.resolution },
            });
            for (const track of tracks) {
                await livekitRoom.localParticipant.publishTrack(track);
                console.log(`[Host] Local ${track.kind} track published`);
                if (track.kind === 'video') {
                   const localVideo = $('local-video');
                   if (localVideo) {
                       localVideo.classList.remove('hidden');
                       track.attach(localVideo);
                   }
                }
            }
            console.log('Host tracks active and publishing');
        } else {
            // If viewer, handle participants who are already in the room
            livekitRoom.remoteParticipants.forEach(participant => {
                participant.trackPublications.forEach(publication => {
                    if (publication.track) {
                        handleTrackSubscribed(publication.track, publication, participant);
                    }
                });
            });
        }
    } catch (error) {
        console.error('Failed to connect to LiveKit:', error);
        alert('Video connection failed. Please check your LiveKit configuration.');
    }
}

function handleTrackSubscribed(track, publication, participant) {
    console.log('Track subscribed:', track.kind, participant.identity);
    if (track.kind === 'video') {
        renderParticipantVideo(participant, track);
        // If track is already muted when subscribed
        if (publication.isMuted) {
            handleTrackMuteChange(publication, participant, true);
        }
    } else if (track.kind === 'audio') {
        const audioId = `audio-track-${participant.identity}`;
        let existing = $(audioId);
        if (existing) existing.remove();

        const el = track.attach();
        el.id = audioId;
        document.body.appendChild(el); 
        el.play().catch(e => {
            console.warn('Initial audio play() failed:', e);
            showAudioPrompt();
        });
        console.log('Audio track attached for:', participant.identity);
    }
}

function renderParticipantVideo(participant, track) {
    const videoArea = $('video-area');
    const wrapperId = `video-wrapper-${participant.identity}`;
    let wrapper = $(wrapperId);

    if (!wrapper) {
        wrapper = document.createElement('div');
        wrapper.id = wrapperId;
        wrapper.className = 'video-wrapper';
        
        const videoEl = document.createElement('video');
        videoEl.id = `video-${participant.identity}`;
        videoEl.className = 'live-video';
        videoEl.autoplay = true;
        videoEl.playsInline = true;
        
        const badge = document.createElement('div');
        badge.className = 'guest-name-badge';
        badge.textContent = participant.identity || 'Guest';
        
        wrapper.appendChild(videoEl);
        wrapper.appendChild(badge);

        // If I am host, add a Kick button for guests (but not for myself)
        if (isHost && !participant.isLocal) {
            const kickBtn = document.createElement('button');
            kickBtn.className = 'kick-btn-overlay';
            kickBtn.innerHTML = '✕';
            kickBtn.onclick = (e) => { e.stopPropagation(); kickGuest(participant.identity); };
            wrapper.appendChild(kickBtn);
        }

        videoArea.appendChild(wrapper);
        activeGuestIds.add(participant.identity);
        updateVideoGrid();
    }

    const video = wrapper.querySelector('video');
    track.attach(video);
    video.play().catch(e => console.warn('Autoplay prevented video:', e));
}

function handleTrackUnsubscribed(track, publication, participant) {
    track.detach();
    if (track.kind === 'video') {
       removeGuestVideo(participant.identity);
    }
}

function removeGuestVideo(identity) {
    const wrapper = $(`video-wrapper-${identity}`);
    if (wrapper) {
        wrapper.remove();
        activeGuestIds.delete(identity);
        updateVideoGrid();
    }
}

function updateVideoGrid() {
    const area = $('video-area');
    if (!area) return;

    const count = activeGuestIds.size + (isHost || isGuestStreamer ? 1 : 0); // Participants + Local 
    
    // Clear old grid classes
    area.classList.remove('grid-1', 'grid-2', 'grid-3', 'grid-4');
    
    if (count <= 1) area.classList.add('grid-1');
    else if (count === 2) area.classList.add('grid-2');
    else if (count === 3) area.classList.add('grid-3');
    else area.classList.add('grid-4');
}

function handleAudioPlaybackStatus() {
    console.log('Audio playback status changed. Can playback:', livekitRoom.canPlaybackAudio);
    if (livekitRoom.canPlaybackAudio) {
        hideAudioPrompt();
    } else {
        showAudioPrompt();
    }
}

function showAudioPrompt() {
    let prompt = $('audio-prompt');
    if (!prompt) prompt = createAudioPrompt();
    prompt.classList.remove('hidden');
    // For some browsers, adding interaction hint helps
    console.warn('Audio is blocked by browser. Showing unmute prompt.');
}

function hideAudioPrompt() {
    const prompt = $('audio-prompt');
    if (prompt) prompt.classList.add('hidden');
}

function createAudioPrompt() {
    const div = document.createElement('div');
    div.id = 'audio-prompt';
    div.className = 'audio-unlock-overlay hidden';
    div.innerHTML = `
        <div class="audio-prompt-content glass">
            <div class="prompt-icon-ring">
                <span class="prompt-icon-large">🔇</span>
            </div>
            <h3>Audio is Muted</h3>
            <p>Your browser is blocking sound.</p>
            <button class="btn-primary" onclick="resumeAudio()">
                Tap to Unmute
            </button>
        </div>
    `;
    // Append to body to ensure it's not hidden by container overflow
    document.body.appendChild(div);
    return div;
}

async function resumeAudio() {
    if (livekitRoom) {
        try {
            await livekitRoom.startAudio();
            console.log('Audio manually resumed by user');
            hideAudioPrompt();
        } catch (err) {
            console.error('Failed to resume audio:', err);
        }
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
    isGuestStreamer = false;
    activeGuestIds.clear();
    $('video-area').innerHTML = ''; // Clean up all video elements
    
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

// Capture a single frame from the camera preview as a Blob (JPEG)
function captureThumbnail() {
    return new Promise((resolve) => {
        const video = $('camera-preview');
        if (!video || !video.srcObject || video.videoWidth === 0) {
            resolve(null);
            return;
        }
        const canvas = document.createElement('canvas');
        canvas.width = 480;
        canvas.height = 270; // 16:9
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.85);
    });
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

    const btn = $('go-live-btn');
    btn.disabled = true;
    btn.textContent = '📸 Capturing...';

    try {
        // 1. Capture a thumbnail frame from the camera preview
        const thumbnailBlob = await captureThumbnail();

        // 2. Build FormData so we can send both text fields + the image file
        const formData = new FormData();
        formData.append('title', title);
        formData.append('category', category);
        formData.append('type', type);
        if (thumbnailBlob) {
            formData.append('thumbnail', thumbnailBlob, 'thumb.jpg');
        }

        // 3. Create stream with thumbnail (multipart request – can't use apiReq helper)
        btn.textContent = '🚀 Going Live...';
        const res = await fetch('/api/streams', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: formData,
        });
        const stream = await res.json();
        if (!res.ok) throw new Error(stream.message || 'Failed to create stream');

        currentStream = stream;
        isHost = true;

        // 4. Fetch LiveKit token for host
        const tkData = await apiReq('POST', '/api/livekit/token', {
            room: stream.livekit_room,
            identity: currentUser.username,
            canPublish: true
        });

        enterLiveScreen(stream);
        connectToLiveKit(tkData.token, stream.livekit_room);
    } catch (err) {
        alert('Failed to go live: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<span class="live-dot-anim"></span> GO LIVE';
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
function appendChat(username, message, isSystem = false, avatar = '') {
    const box = $('chat-messages');
    const div = document.createElement('div');
    div.className = `chat-msg ${isSystem ? 'system-msg' : ''}`;
    
    if (isSystem) {
        div.innerHTML = `<span class="chat-msg-text" style="color:var(--accent2); font-weight:600">${message}</span>`;
    } else {
        const initials = username ? username.charAt(0).toUpperCase() : '?';
        const avatarHtml = `<div class="chat-avatar" style="${avatar ? `background-image:url(${avatar});background-size:cover;background-position:center;` : `background:var(--accent)`}">${avatar ? '' : initials}</div>`;
        div.innerHTML = `${avatarHtml}<div class="chat-msg-content"><span class="chat-msg-name">${username}</span><span class="chat-msg-text">${message}</span></div>`;
    }
    
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
            roomName: currentStream?.livekit_room,
            gift,
            receiverUsername: currentStream?.username,
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
        list.innerHTML = convos.map(c => {
            const initials = c.partner_name ? c.partner_name.charAt(0).toUpperCase() : '?';
            const avatarStyle = c.partner_avatar ? `background-image:url(${c.partner_avatar}); background-size:cover; background-position:center;` : '';
            return `
      <div class="chat-list-item glass" onclick="openChatThread(${c.partner_id}, '${c.partner_name}', '${c.partner_avatar || ''}')" style="display:flex;align-items:center;padding:12px;border-radius:12px;gap:12px;cursor:pointer">
         <div class="profile-avatar-lg" style="width:48px;height:48px;font-size:1.2rem;background:linear-gradient(135deg,#c084fc,#818cf8);${avatarStyle}">${c.partner_avatar ? '' : initials}</div>
         <div style="flex:1">
           <div style="font-weight:600;margin-bottom:4px;color:var(--text)">${c.partner_name}</div>
           <div style="color:var(--text);opacity:0.7;font-size:0.85rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px;">${c.last_message}</div>
         </div>
         <div style="font-size:0.75rem;color:var(--text);opacity:0.5">${formatTime(c.time)}</div>
         ${!c.is_read && c.partner_id !== currentUser.id ? '<div style="width:8px;height:8px;background:var(--accent);border-radius:50%"></div>' : ''}
      </div>
    `; }).join('');
    } catch (err) {
        console.error(err);
    }
}

async function openChatThread(partnerId, partnerName, partnerAvatar = '') {
    chatPartnerId = partnerId;
    $('chat-thread-partner-name').textContent = partnerName;
    setAvatar($('chat-thread-partner-avatar'), partnerAvatar, partnerName);
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

        try {
            // Fetch detailed profile data
            const data = await apiReq('GET', `/api/users/profile/${currentUser.id}`);
            
            $('profile-username').textContent = data.username;
            $('profile-email').textContent = currentUser.email; 
            $('profile-bio').textContent = data.bio || '';
            $('profile-followers').textContent = (data.followers_count || 0).toLocaleString();
            $('profile-followers').parentElement.onclick = () => openFollowList('followers', data.id);
            
            $('profile-following').textContent = (data.following_count || 0).toLocaleString();
            $('profile-following').parentElement.onclick = () => openFollowList('following', data.id);
            $('profile-wallet').textContent = (data.coin_balance || 0).toLocaleString();
            $('profile-earned').textContent = (data.earned_coins || 0).toLocaleString();

            setAvatar($('profile-avatar-el'), data.avatar, data.username);
        } catch (e) {
            console.error("Profile fetch error", e);
        }
    }
}

function openProfileEditor() {
    if (!currentUser) return;
    $('edit-username').value = currentUser.username || '';
    $('edit-bio').value = currentUser.bio || '';
    $('profile-modal').classList.remove('hidden');
    setAvatar($('edit-avatar-preview'), currentUser.avatar, currentUser.username);
}

function previewAvatar(input) {
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const preview = $('edit-avatar-preview');
            preview.style.backgroundImage = `url(${e.target.result})`;
            preview.textContent = '';
        };
        reader.readAsDataURL(input.files[0]);
    }
}

async function saveProfile() {
    const username = $('edit-username').value.trim();
    const bio = $('edit-bio').value.trim();
    const avatarFile = $('avatar-input').files[0];

    try {
        // 1. Update basic info
        await apiReq('PUT', '/api/users/profile', { username, bio });
        
        // 2. Update avatar if a new one was selected
        if (avatarFile) {
            const formData = new FormData();
            formData.append('avatar', avatarFile);
            
            const res = await fetch('/api/users/profile/avatar', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message);
            currentUser.avatar = data.avatar;

            // If user is currently hosting, update HUD avatar
            if (isHost) {
                setAvatar($('hud-host-avatar'), currentUser.avatar, currentUser.username);
            }
        }

        // Update local object
        currentUser.username = username;
        currentUser.bio = bio;
        localStorage.setItem('tl_user', JSON.stringify(currentUser));
        
        closeModal('profile-modal');
        renderProfile();
        renderTopBar();
    } catch (err) {
        alert("Failed to save: " + err.message);
    }
}

let viewProfileUserId = null;

async function viewUserProfile(userId) {
    if (currentUser && userId === currentUser.id) {
        navigateTo('profile');
        return;
    }
    
    viewProfileUserId = userId;
    navigateTo('view-profile');
    
    // Reset view
    $('v-profile-username').textContent = 'Loading...';
    $('v-profile-bio').textContent = '';
    $('v-profile-followers').textContent = '0';
    $('v-profile-following').textContent = '0';
    $('v-profile-coins').textContent = '0';
    $('v-follow-btn').classList.add('hidden');
    
    try {
        const data = await apiReq('GET', `/api/users/profile/${userId}`);
        
        $('v-profile-username').textContent = data.username;
        $('v-profile-bio').textContent = data.bio || 'No bio provided.';
        $('v-profile-followers').textContent = (data.followers_count || 0).toLocaleString();
        $('v-profile-followers').parentElement.onclick = () => openFollowList('followers', data.id);
        
        $('v-profile-following').textContent = (data.following_count || 0).toLocaleString();
        $('v-profile-following').parentElement.onclick = () => openFollowList('following', data.id);
        $('v-profile-coins').textContent = (data.earned_coins || 0).toLocaleString();
        
        setAvatar($('v-profile-avatar'), data.avatar, data.username);

        // Setup message button
        $('v-message-btn').onclick = () => openChatThread(data.id, data.username);

        // Check follow status
        if (currentUser) {
            const { isFollowing } = await apiReq('GET', `/api/users/follow-status/${userId}`);
            const btn = $('v-follow-btn');
            if (btn) {
                btn.classList.remove('hidden');
                btn.classList.toggle('following', isFollowing);
                btn.textContent = isFollowing ? 'Following' : '+ Follow';
            }

            // NEW: Show Invite button if I am the Host
            const inviteBtn = $('v-invite-btn');
            if (inviteBtn) {
                if (isHost && currentStream && userId !== currentUser.id) {
                    inviteBtn.classList.remove('hidden');
                } else {
                    inviteBtn.classList.add('hidden');
                }
            }
        } else {
            const fBtn = $('v-follow-btn');
            if (fBtn) {
                fBtn.classList.remove('hidden');
                fBtn.textContent = '+ Follow';
            }
            const iBtn = $('v-invite-btn');
            if (iBtn) iBtn.classList.add('hidden');
        }
    } catch (e) {
        console.error("View profile error", e);
    }
}

async function toggleFollowProfile() {
    if (!currentUser) { showAuthOverlay('login'); return; }
    if (!viewProfileUserId) return;

    const btn = $('v-follow-btn');
    const isFollowing = btn.classList.contains('following');
    const method = isFollowing ? 'DELETE' : 'POST';

    try {
        await apiReq(method, `/api/users/follow/${viewProfileUserId}`);
        // Refresh view
        viewUserProfile(viewProfileUserId);
    } catch (err) {
        console.error("Follow error:", err);
    }
}

// ─── FOLLOW LIST ────────────────────────────────────────────────────────
let followListType = 'followers';
let followListUserId = null;

async function openFollowList(type, userId) {
    followListType = type;
    followListUserId = userId;
    navigateTo('follow-list');

    $('follow-list-title').textContent = type === 'followers' ? 'Followers' : 'Following';
    $('follow-list-content').innerHTML = '<div class="feed-loading">📡 Loading...</div>';

    try {
        const users = await apiReq('GET', `/api/users/${userId}/${type}`);
        renderFollowList(users);
    } catch (e) {
        $('follow-list-content').innerHTML = '<div class="feed-loading"><p>Failed to load.</p></div>';
    }
}

function renderFollowList(users) {
    const container = $('follow-list-content');
    if (!users.length) {
        container.innerHTML = `<div class="feed-loading"><p>No ${followListType} yet.</p></div>`;
        return;
    }

    container.innerHTML = users.map(u => {
        const initials = u.username.charAt(0).toUpperCase();
        const avatarStyle = u.avatar ? `background-image:url(${u.avatar}); background-size:cover; background-position:center;` : '';

        return `
            <div class="glass" style="display:flex; align-items:center; gap:12px; padding:15px; border-radius:16px; cursor:pointer; margin-bottom:10px;" onclick="viewUserProfile(${u.id})">
                <div class="user-avatar-sm" style="width:48px; height:48px; border:2px solid var(--glass-border); background: linear-gradient(135deg, var(--accent), var(--accent2)); ${avatarStyle}">${u.avatar ? '' : initials}</div>
                <div style="flex:1">
                    <div style="font-weight:700; font-size:1.05rem">${u.username}</div>
                    <div style="font-size:0.85rem; color:rgba(255,255,255,0.6)">View Profile</div>
                </div>
                <div style="color:var(--accent); font-size:1.2rem">→</div>
            </div>
        `;
    }).join('');
}

function goBackFromFollowList() {
    if (viewProfileUserId) {
        navigateTo('view-profile');
        viewUserProfile(viewProfileUserId);
    } else {
        navigateTo('profile');
    }
}

function handleTrackMuteChange(pub, part, isMuted) {
    if (pub.kind !== 'video') return;
    
    const wrapper = $(`video-wrapper-${part.identity || '__local__'}`);
    const video = wrapper ? wrapper.querySelector('video') : null;

    if (isMuted) {
        if (video) video.classList.add('hidden');
        // We could show a specific placeholder within the wrapper here
    } else {
        if (video) video.classList.remove('hidden');
    }
}

// ─── GUEST STREAMING LOGIC ───────────────────────────────────────────
function inviteToStream() {
    if (!viewProfileUserId || !currentStream || !isHost) return;
    socket?.emit('guest-invite', { userId: viewProfileUserId, roomName: currentStream.livekit_room });
    appendChat('System', `📡 Invitation sent to ${$('v-profile-username').textContent}`, true);
    closeModal('v-profile-modal'); 
    navigateTo('live');
}

async function acceptGuestInvite(accepted) {
    $('guest-invite-toast').classList.add('hidden');
    if (!pendingGuestInvite) return;
    
    const { hostId, roomName } = pendingGuestInvite;
    socket?.emit('guest-invite-response', { hostId, accepted, roomName });
    
    if (accepted) {
        switchToGuestStreamer(roomName);
    }
    pendingGuestInvite = null;
}

async function switchToGuestStreamer(roomName) {
    try {
        console.log('[Guest] Switching to streamer role...');
        // 1. Get new token with canPublish: true
        const tkData = await apiReq('POST', '/api/livekit/token', {
            room: roomName,
            identity: currentUser.username,
            canPublish: true
        });

        isGuestStreamer = true;
        
        // 2. Reconnect to LiveKit as Guest Streamer
        // Note: we temporarily set isHost=true so connectToLiveKit publishes tracks
        const originalIsHost = isHost;
        isHost = true; 
        await connectToLiveKit(tkData.token, roomName);
        isHost = originalIsHost; // Restore host status (usually false for guest)
        
        appendChat('System', '🎥 You are now live as a guest!', true);
    } catch (err) {
        alert('Failed to join as guest: ' + err.message);
        isGuestStreamer = false;
    }
}

function stopGuestStream() {
    if (!isGuestStreamer) return;
    isGuestStreamer = false;
    socket?.emit('end-guest-session', { roomName: currentStream?.livekit_room });
    
    // Re-join as viewer (no publish)
    if (currentStream) {
        enterLiveScreen(currentStream); 
    }
}

function kickGuest(userId) {
    if (!isHost || !currentStream) return;
    socket?.emit('kick-guest', { userId, roomName: currentStream.livekit_room });
}

// ─── HOST CONTROLS ────────────────────────────────────────────────────
function toggleMic() {
    if (!livekitRoom || !isHost) return;
    const enabled = livekitRoom.localParticipant.isMicrophoneEnabled;
    livekitRoom.localParticipant.setMicrophoneEnabled(!enabled);
    
    const btn = $('hud-mic-btn');
    btn.classList.toggle('muted', enabled);
    btn.textContent = enabled ? '🔇' : '🎤';
}

function toggleCam() {
    if (!livekitRoom || !isHost) return;
    const enabled = livekitRoom.localParticipant.isCameraEnabled;
    livekitRoom.localParticipant.setCameraEnabled(!enabled);
    
    const btn = $('hud-cam-btn');
    btn.classList.toggle('muted', enabled);
    btn.textContent = enabled ? '🚫' : '📷';
    
    // UI update handled by TrackMuted listener
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
    socket?.emit('join-request-response', { userId, approved, roomName: currentStream?.livekit_room });
    pendingJoinRequest = null;
}

// ─── MODAL HELPERS ─────────────────────────────────────────────────────
function closeModal(id) { $(id)?.classList.add('hidden'); }

// ─── HELPERS ───────────────────────────────────────────────────────────
function setAvatar(el, avatarUrl, username) {
    if (!el) return;
    if (avatarUrl) {
        el.style.backgroundImage = `url(${avatarUrl})`;
        el.textContent = '';
        el.classList.add('has-img');
        el.style.backgroundSize = 'cover';
        el.style.backgroundPosition = 'center';
    } else {
        el.style.backgroundImage = 'none';
        el.textContent = username ? username.charAt(0).toUpperCase() : '?';
        el.classList.remove('has-img');
    }
}

function closeModal(id) { $(id)?.classList.add('hidden'); }

// ─── INIT ──────────────────────────────────────────────────────────────
(function init() {
    renderTopBar();
    initSocket();
    initSearch();
    loadStreams();

    // If no user, show auth on first load after brief delay
    if (!currentUser) {
        setTimeout(() => {
            if (!currentUser) showAuthOverlay('login');
        }, 1000);
    }
})();
