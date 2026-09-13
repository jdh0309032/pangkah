const mySessionId = 'p_' + Math.random().toString(36).substr(2, 9);
const db = typeof firebase !== 'undefined' ? firebase.database() : null;
let roomRef = null;
let publicRoomRef = null;
let roomStatus = 'waiting';

function openCustomModal() {
    document.getElementById('custom-modal').style.display = 'flex';
}
function closeCustomModal() {
    document.getElementById('custom-modal').style.display = 'none';
}

function openMultiplayerModal() {
    document.getElementById('multiplayer-modal').style.display = 'flex';
    document.getElementById('room-menu-view').style.display = 'block';
    document.getElementById('room-waiting-view').style.display = 'none';
}
function closeMultiplayerModal() {
    document.getElementById('multiplayer-modal').style.display = 'none';
}

let currentRoomCode = '';
let isHost = false;
let roomPlayers = [];

function getMyPlayerData() {
    return {
        id: mySessionId,
        name: document.getElementById('nickname-input').value || 'Player',
        isHost: isHost,
        blade: document.getElementById('select-blade').value,
        tip: document.getElementById('select-tip').value,
        zodiac: document.getElementById('select-zodiac').value || 'rat',
        color1: document.getElementById('blade-color-1').value,
        color2: document.getElementById('blade-color-2').value,
        core: document.getElementById('core-color').value,
        isAlive: true,
        isBot: false
    };
}

function createRoom() {
    if (!db) return alert("Firebase is not initialized!");
    currentRoomCode = Math.floor(1000 + Math.random() * 9000).toString();
    isHost = true;
    document.getElementById('display-room-code').innerText = currentRoomCode;
    document.getElementById('room-menu-view').style.display = 'none';
    document.getElementById('room-waiting-view').style.display = 'flex';
    
    roomRef = db.ref('rooms/' + currentRoomCode);
    roomRef.child('players/' + mySessionId).onDisconnect().remove();
    roomRef.child('gameStates/' + mySessionId).onDisconnect().remove();
    
    roomRef.set({ status: 'waiting' });
    roomRef.child('players/' + mySessionId).set(getMyPlayerData());
    
    setupPrivateRoomListener();
    initPrivateChatListener();
    clearPrivateChat();
    addChatSystemMessage(`Room created! Code: ${currentRoomCode}`);
}

function joinRoom() {
    if (!db) return alert("Firebase is not initialized!");
    let code = document.getElementById('room-code-input').value.trim();
    if (code.length !== 4) {
        alert('Please enter a valid 4-digit room code.');
        return;
    }
    currentRoomCode = code;
    isHost = false;
    document.getElementById('display-room-code').innerText = currentRoomCode;
    document.getElementById('room-menu-view').style.display = 'none';
    document.getElementById('room-waiting-view').style.display = 'flex';

    roomRef = db.ref('rooms/' + currentRoomCode);
    roomRef.child('players/' + mySessionId).onDisconnect().remove();
    roomRef.child('gameStates/' + mySessionId).onDisconnect().remove();
    
    roomRef.once('value', (snapshot) => {
        if (!snapshot.val()) {
            alert('존재하지 않는 방입니다!');
            leaveRoom();
            return;
        }
        roomRef.child('players/' + mySessionId).set(getMyPlayerData());
        setupPrivateRoomListener();
        initPrivateChatListener();
        clearPrivateChat();
        addChatSystemMessage(`Joined room ${currentRoomCode}`);
    });
}

function setupPrivateRoomListener() {
    if (!roomRef) return;
    roomRef.on('value', (snapshot) => {
        let data = snapshot.val();
        if (!data) return;
        
        if (data.players) {
            let incomingPlayers = Object.values(data.players);
            // 배열 변경 시 안전하게 UI 및 게임 내 유령 엔티티 정리
            if (gamePhase === 'playing' || gamePhase === 'countdown') {
                for (let i = entities.length - 1; i >= 0; i--) {
                    let ent = entities[i];
                    if (!data.players[ent.id] && !ent.isBot) {
                        removeEntityFromScene(i);
                    }
                }
            }
            roomPlayers = incomingPlayers;
            updateRoomPlayerList();
        } else {
            roomPlayers = [];
            updateRoomPlayerList();
        }
        
        let newStatus = data.status;
        if (newStatus === 'loading' && roomStatus !== 'loading') {
            roomStatus = 'loading';
            closeMultiplayerModal();
            let resModal = document.getElementById('result-modal');
            if (resModal) resModal.style.display = 'none';
            startGameSession(roomPlayers, 'private');
        } else if (newStatus === 'gameover') {
            roomStatus = 'gameover';
        } else if (newStatus === 'waiting') {
            roomStatus = 'waiting';
        }
    });

    // 방장으로부터 물리 충돌 이벤트 수신 (비방장 클라이언트 동기화)
    if (!isHost) {
        roomRef.child('events').on('child_added', snap => {
            let ev = snap.val();
            if (ev && ev.type === 'collision') {
                createCollisionSpark(ev.cx, ev.cy);
                let e1 = entities.find(e => e.id === ev.id1);
                let e2 = entities.find(e => e.id === ev.id2);
                if (e1) { e1.x = ev.x1; e1.y = ev.y1; e1.vx = ev.vx1; e1.vz = ev.vz1; }
                if (e2) { e2.x = ev.x2; e2.y = ev.y2; e2.vx = ev.vx2; e2.vz = ev.vz2; }
            }
        });
    }
}

function leaveRoom() {
    if (roomRef) {
        roomRef.child('players/' + mySessionId).remove();
        roomRef.child('gameStates/' + mySessionId).remove();
        roomRef.off();
    }
    currentRoomCode = ''; roomRef = null; isHost = false;
    clearPrivateChat();
    document.getElementById('room-waiting-view').style.display = 'none';
    document.getElementById('room-menu-view').style.display = 'block';
}

function updateRoomPlayerList() {
    let countElem = document.getElementById('player-count');
    if (countElem) countElem.innerText = roomPlayers.length;
    let html = '';
    roomPlayers.forEach(p => {
        html += `<div style="display:flex; justify-content:space-between; font-size:12px; padding:4px 0; border-bottom:1px solid #334155; align-items:center;">
            <span style="color:#f8fafc; font-weight:600;">${p.name} ${p.isHost ? '👑' : ''} ${p.isBot ? '🤖' : ''}</span>
            <span style="color:#10b981; font-weight:bold;">Ready</span>
        </div>`;
    });
    let listElem = document.getElementById('room-player-list');
    if (listElem) listElem.innerHTML = html;
}

function addBotToPrivateRoom() {
    if (!isHost || !roomRef) { alert('방장만 봇을 추가할 수 있습니다!'); return; }
    let botId = 'bot_' + Math.random().toString(36).substr(2, 5);
    let botNames = ['BladeKing', 'SpinMaster', 'NoobSlayer', 'TornadoX', 'IronSpins'];
    let bName = botNames[roomPlayers.length % botNames.length] + '_' + Math.floor(Math.random()*10);
    
    let botData = {
        id: botId,
        name: bName,
        isHost: false,
        isBot: true,
        blade: ['circle', 'saw', 'shield'][Math.floor(Math.random()*3)],
        tip: ['speed', 'heavy'][Math.floor(Math.random()*2)],
        zodiac: ['ox', 'tiger', 'dragon', 'rabbit', 'snake', 'horse'][Math.floor(Math.random()*6)],
        color1: ['#ef4444', '#10b981', '#8b5cf6', '#f97316'][Math.floor(Math.random()*4)],
        color2: ['#b91c1c', '#047857', '#6d28d9', '#c2410c'][Math.floor(Math.random()*4)],
        core: ['#f59e0b', '#38bdf8', '#ec4899', '#84cc16'][Math.floor(Math.random()*4)],
        isAlive: true
    };
    roomRef.child('players/' + botId).set(botData);
    addChatSystemMessage(`Added bot: ${bName}`);
}

function addChatSystemMessage(msg) {
    let cm = document.getElementById('chat-messages');
    if (cm) {
        cm.innerHTML += `<div style="color:#38bdf8; font-style:italic;">[System] ${msg}</div>`;
        cm.scrollTop = cm.scrollHeight;
    }
}

function sendChatMessage() { sendChatToFirebase('chat-input'); }
function sendIngameChatMessage() { sendChatToFirebase('ingame-chat-input'); }
function sendResultChatMessage() { sendChatToFirebase('result-chat-input'); }

function sendChatToFirebase(inputId) {
    let input = document.getElementById(inputId);
    if (!input || !input.value.trim()) return;
    let text = input.value.trim();
    let nickname = document.getElementById('nickname-input').value || 'Player1';
    
    if (roomRef) {
        roomRef.child('chat').push({ sender: nickname, text: text });
    } else {
        appendIngameChatLog(nickname, text);
        appendResultChatLog(nickname, text);
        let cm = document.getElementById('chat-messages');
        if (cm) { cm.innerHTML += `<div><span style="color:#f1c40f; font-weight:bold;">${nickname}:</span> ${text}</div>`; cm.scrollTop = cm.scrollHeight; }
    }
    input.value = '';
}

function initPrivateChatListener() {
    if (!roomRef) return;
    roomRef.child('chat').off();
    roomRef.child('chat').on('child_added', (snapshot) => {
        let data = snapshot.val();
        if (data) {
            let cm = document.getElementById('chat-messages');
            if (cm) { cm.innerHTML += `<div><span style="color:#f1c40f; font-weight:bold;">${data.sender}:</span> ${data.text}</div>`; cm.scrollTop = cm.scrollHeight; }
            appendIngameChatLog(data.sender, data.text);
            appendResultChatLog(data.sender, data.text);
        }
    });
}

function appendIngameChatLog(sender, text) {
    let log = document.getElementById('ingame-chat-log');
    if (log && gameMode === 'private') {
        log.innerHTML += `<div><span style="color:#f1c40f;">${sender}:</span> ${text}</div>`;
        log.scrollTop = log.scrollHeight;
    }
}

function appendResultChatLog(sender, text) {
    let rcm = document.getElementById('result-chat-messages');
    if (rcm && gameMode === 'private') {
        rcm.innerHTML += `<div><span style="color:#f1c40f;">${sender}:</span> ${text}</div>`;
        rcm.scrollTop = rcm.scrollHeight;
    }
}

function clearPrivateChat() {
    ['chat-messages', 'ingame-chat-log', 'result-chat-messages'].forEach(id => {
        let el = document.getElementById(id); if (el) el.innerHTML = '';
    });
}

function startPrivateGameSession() {
    if (roomPlayers.length <= 0) { alert('No players in room!'); return; }
    if (!isHost) { alert('방장만 게임을 시작할 수 있습니다!'); return; }
    
    if (roomRef) {
        roomRef.child('gameStates').remove();
        roomRef.child('events').remove();
        roomRef.update({ status: 'loading' }); // 트리거 발동 (방장, 비방장 모두)
    }
}

function startQuickGame() {
    let nickname = document.getElementById('nickname-input').value || 'Player1';
    let quickPlayers = [
        { id: mySessionId, name: nickname, isHost: true, isBot: false },
        { id: 'b1', name: 'BladeKing', isHost: false, isBot: true },
        { id: 'b2', name: 'SpinMaster', isHost: false, isBot: true },
        { id: 'b3', name: 'NoobSlayer', isHost: false, isBot: true }
    ];
    // 빠른 게임의 경우 내가 호스트 역할을 담당
    isHost = true;
    startGameSession(quickPlayers, 'quick');
}

const textureLoader = new THREE.TextureLoader();
const gltfLoader = new THREE.GLTFLoader();

function getVisibleZodiacColor(hexString) {
    let color = new THREE.Color(hexString);
    let hsl = { h: 0, s: 0, l: 0 };
    color.getHSL(hsl);
    if (hsl.l > 0.55) { color.setHSL(hsl.h, Math.min(1.0, hsl.s + 0.2), Math.max(0.12, hsl.l - 0.45)); } 
    else { color.setHSL(hsl.h, Math.min(1.0, hsl.s + 0.2), Math.min(0.92, hsl.l + 0.45)); }
    return color.getStyle();
}

const zodiacCanvasTextureCache = {};
function createColorizedZodiacTexture(sign, hexColor, callback) {
    let cacheKey = `${sign}_${hexColor}`;
    if (zodiacCanvasTextureCache[cacheKey]) { callback(zodiacCanvasTextureCache[cacheKey]); return; }
    let img = new Image(); img.crossOrigin = 'anonymous'; img.src = `./assets/textures/zodiac/${sign}.png`;
    img.onload = () => {
        let canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 256;
        let ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, 256, 256);
        ctx.globalCompositeOperation = 'source-in'; ctx.fillStyle = hexColor; ctx.fillRect(0, 0, 256, 256);
        let texture = new THREE.CanvasTexture(canvas); texture.encoding = THREE.sRGBEncoding;
        zodiacCanvasTextureCache[cacheKey] = texture; callback(texture);
    };
    img.onerror = () => { callback(null); };
}

let gameStarted = false;
let gameMode = 'quick'; 
let gamePhase = 'waiting'; 
let countdownTimer = 0;
let survivalTime = 0;
let entities = [];
let entityMeshes = [];
let entityTrails = []; 
let eliminationOrder = [];
let player = null;
let spectateTargetIndex = 0;
let activeSparks = [];
let lastNetworkSync = 0;

const PARTS_STAT = {
    'circle': { speed: 3.7, atk: 1.2, def: 1.2, weight: 1.0, glb: 'custom_balance.glb' },
    'saw':    { speed: 4.3, atk: 1.7, def: 0.6, weight: 0.9, glb: 'custom_attack.glb'  },
    'shield': { speed: 3.0, atk: 0.7, def: 1.8, weight: 1.3, glb: 'custom_defense.glb' },
    'speed':  { speedBonus: 1.25, weight: 0.7, glb: 'custom_tip_speed.glb' },
    'heavy':  { speedBonus: 0.90, weight: 1.5, glb: 'custom_tip_heavy.glb' }
};

function getEntityWeight(ent) {
    let bStat = PARTS_STAT[ent.type] || PARTS_STAT['circle'];
    let tStat = PARTS_STAT[ent.tipType] || PARTS_STAT['speed'];
    return bStat.weight + tStat.weight;
}

let trailTextureCache = {};
function getTrailTexture() {
    if (trailTextureCache['default']) return trailTextureCache['default'];
    let canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 128;
    let ctx = canvas.getContext('2d');
    let grad = ctx.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.9)'); 
    grad.addColorStop(0.35, 'rgba(255, 255, 255, 0.35)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');     
    ctx.fillStyle = grad; ctx.fillRect(0, 0, 64, 128);
    let tex = new THREE.CanvasTexture(canvas); tex.encoding = THREE.sRGBEncoding;
    trailTextureCache['default'] = tex; return tex;
}

function createDynamicTrail(bladeColor) {
    const segs = 14; const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array((segs + 1) * 2 * 3); const uvs = new Float32Array((segs + 1) * 2 * 2);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    let mat = new THREE.MeshBasicMaterial({ color: bladeColor, map: getTrailTexture(), transparent: true, depthWrite: false, side: THREE.DoubleSide });
    let mesh = new THREE.Mesh(geometry, mat); mesh.frustumCulled = false; mesh.visible = false;
    return { mesh, points: [], segs };
}

function createEntity(id, x, y, type, tipType, zodiac, bladeColor1, bladeColor2, coreColor, name, isPlayer, isBot) {
    return {
        id: id, x: x, y: y, vx: 0, vz: 0, radius: 28,
        type: type, tipType: tipType, zodiac: zodiac,
        bladeColor1: bladeColor1, bladeColor2: bladeColor2, coreColor: coreColor,
        isDashing: false, dashFrames: 0, dashDirX: 0, dashDirZ: 0, hasHit: false, hasScoredHit: false,
        isStunned: false, stunTimer: 0, staggerTimer: 0,
        comboCount: 0, comboTimer: 0, cooldownTimer: 0, isCooldown: false,
        prevX: x, prevY: y, name: name, isPlayer: isPlayer, isBot: isBot,
        isAlive: true, dropHeight: 120, survivalTime: 0,
        aiState: 'attack', aiTimer: 0,
        targetX: x, targetY: y // 원격 동기화용 변수 추가
    };
}

// 통합 클린업 함수 (인덱스 불일치 원천 차단)
function removeEntityFromScene(index) {
    if (entityMeshes[index]) beybladeScene.remove(entityMeshes[index]);
    if (entityTrails[index]) beybladeScene.remove(entityTrails[index].mesh);
    entities.splice(index, 1);
    entityMeshes.splice(index, 1);
    entityTrails.splice(index, 1);
}

function startGameSession(playerList, mode) {
    gameMode = mode;
    document.getElementById('lobby-screen').style.display = 'none';
    gameRenderer.domElement.style.display = 'block';
    document.getElementById('game-ui').style.display = 'block';
    document.getElementById('result-modal').style.display = 'none';
    
    let ingameChatLog = document.getElementById('ingame-chat-log');
    let ingameChatBox = document.getElementById('ingame-chat-box');
    if (gameMode === 'private') {
        if (ingameChatLog) ingameChatLog.style.display = 'flex';
    } else {
        if (ingameChatLog) ingameChatLog.style.display = 'none';
    }
    if (ingameChatBox) ingameChatBox.style.display = 'none';

    // 로컬 플레이어 정보 강제 세팅 방지 (Firebase 데이터 우선 적용)
    let pType = document.getElementById('select-blade').value;
    let tType = document.getElementById('select-tip').value;
    let zType = document.getElementById('select-zodiac').value || 'rat';
    let cCol = document.getElementById('core-color').value;

    let dashBtn = document.getElementById('dash-btn');
    let textContent = document.getElementById('dash-text-content');
    let timerRing = document.getElementById('dash-timer-ring');
    let dashIconMask = document.getElementById('dash-icon-mask');
    
    if (dashBtn) { dashBtn.className = ""; dashBtn.style.background = cCol; dashBtn.style.borderColor = getVisibleZodiacColor(cCol); dashBtn.style.boxShadow = "none"; }
    if (dashIconMask) {
        let maskUrl = `url('./assets/textures/zodiac/${zType}.png')`;
        dashIconMask.style.webkitMask = `${maskUrl} center/contain no-repeat`;
        dashIconMask.style.mask = `${maskUrl} center/contain no-repeat`;
        dashIconMask.style.backgroundColor = getVisibleZodiacColor(cCol);
        dashIconMask.style.display = "block";
    }
    if (textContent) { textContent.style.display = "none"; textContent.innerHTML = ""; }
    if (timerRing) { timerRing.style.strokeDashoffset = 264; }

    // 기존 리소스 완전 초기화
    for (let i = entities.length - 1; i >= 0; i--) removeEntityFromScene(i);
    activeSparks.forEach(s => { if (s && s.mesh) beybladeScene.remove(s.mesh); });
    activeSparks = [];
    eliminationOrder = []; player = null; survivalTime = 0; spectateTargetIndex = 0;

    let total = playerList.length;
    let spawnRadius = 140; 

    playerList.forEach((p, idx) => {
        let angle = (idx / total) * Math.PI * 2;
        let sx = Math.cos(angle) * spawnRadius;
        let sy = Math.sin(angle) * spawnRadius;

        let isThisPlayer = (p.id === mySessionId);
        let ent = createEntity(
            p.id || ('bot_'+idx), sx, sy, 
            p.blade || ['circle', 'saw', 'shield'][idx % 3], 
            p.tip || ['speed', 'heavy'][idx % 2], 
            p.zodiac || 'rat', 
            p.color1 || '#ef4444', 
            p.color2 || '#b91c1c', 
            p.core || '#f59e0b', 
            p.name || 'Bot', 
            isThisPlayer, 
            p.isBot || false
        );

        if (isThisPlayer) player = ent;
        entities.push(ent);

        let mesh = createBeybladeMesh(ent.type, ent.tipType, ent.zodiac, ent.bladeColor1, ent.bladeColor2, ent.coreColor);
        mesh.position.set(ent.x, ent.dropHeight, ent.y);
        beybladeScene.add(mesh); entityMeshes.push(mesh);

        let trailData = createDynamicTrail(ent.bladeColor1);
        beybladeScene.add(trailData.mesh); entityTrails.push(trailData);
    });

    // 비방장일 경우 방장의 실시간 좌표를 구독
    if (gameMode === 'private' && roomRef) {
        roomRef.child('gameStates').on('value', (snapshot) => {
            let states = snapshot.val() || {};
            for (let pid in states) {
                if (pid !== mySessionId) {
                    let target = entities.find(e => e.id === pid);
                    if (target && target.isAlive) {
                        target.targetX = states[pid].x;
                        target.targetY = states[pid].y;
                        target.vx = states[pid].vx;
                        target.vz = states[pid].vz;
                        target.isAlive = states[pid].isAlive;
                    }
                }
            }
        });
    }

    gameStarted = true; gamePhase = 'countdown'; countdownTimer = 180; 
    let overlay = document.getElementById('countdown-overlay'); if (overlay) overlay.style.display = 'flex';
    let numElem = document.getElementById('countdown-number'); if (numElem) numElem.innerText = '3';
}

function returnToLobby() {
    gameStarted = false; gamePhase = 'waiting';
    document.getElementById('game-ui').style.display = 'none';
    document.getElementById('result-modal').style.display = 'none';
    
    let ingameChatLog = document.getElementById('ingame-chat-log');
    if (ingameChatLog) ingameChatLog.style.display = 'none';
    let ingameChatBox = document.getElementById('ingame-chat-box');
    if (ingameChatBox) ingameChatBox.style.display = 'none';
    
    gameRenderer.domElement.style.display = 'none';
    document.getElementById('lobby-screen').style.display = 'flex';
    
    for (let i = entities.length - 1; i >= 0; i--) removeEntityFromScene(i);
    activeSparks.forEach(s => { if (s && s.mesh) beybladeScene.remove(s.mesh); });
    activeSparks = [];

    // 멀티플레이어 방 연결 정리
    if (gameMode === 'private' && roomRef) { leaveRoom(); }
}

function restartCurrentGame() {
    document.getElementById('result-modal').style.display = 'none';
    if (gameMode === 'private') { startPrivateGameSession(); } 
    else { startQuickGame(); }
}

// ---------------------- 그래픽 & 렌더링 영역 (원본 완전 보존) ---------------------- //
const showroomScene = new THREE.Scene(); showroomScene.background = new THREE.Color('#000000');
const showroomCam = new THREE.PerspectiveCamera(40, 1, 0.1, 1000); showroomCam.position.set(0, 60, 95); showroomCam.lookAt(0, 0, 0);
const showroomRenderer = new THREE.WebGLRenderer({ antialias: true }); showroomRenderer.setSize(180, 180);
document.getElementById('showroom-container').appendChild(showroomRenderer.domElement);

showroomScene.add(new THREE.AmbientLight(0xffffff, 0.65));
const sLight = new THREE.DirectionalLight(0xffffff, 0.75); sLight.position.set(50, 150, 50); showroomScene.add(sLight);

let showroomAngleY = 0, showroomVelY = 0, showroomAngleX = 0, showroomVelX = 0, isShowroomDragging = false, prevMouseX = 0, prevMouseY = 0;
const showroomFrame = document.getElementById('showroom-frame');
if (showroomFrame) {
    showroomFrame.addEventListener('pointerdown', (e) => { isShowroomDragging = true; prevMouseX = e.clientX; prevMouseY = e.clientY; });
    window.addEventListener('pointermove', (e) => {
        if (!isShowroomDragging) return;
        let dx = e.clientX - prevMouseX; let dy = e.clientY - prevMouseY;
        showroomVelY = dx * 0.03; showroomVelX = dy * 0.03; showroomAngleY += showroomVelY; showroomAngleX += showroomVelX;
        prevMouseX = e.clientX; prevMouseY = e.clientY;
    });
    window.addEventListener('pointerup', () => { isShowroomDragging = false; });
}

function createBeybladeMesh(bladeType, tipType, zodiacType, bladeCol1, bladeCol2, coreCol) {
    const containerGroup = new THREE.Group();
    const spinGroup = new THREE.Group();       
    const staticCoreGroup = new THREE.Group(); 
    containerGroup.add(spinGroup); containerGroup.add(staticCoreGroup);
    
    let statInfo = PARTS_STAT[bladeType] || PARTS_STAT['circle'];
    let glbPath = `./assets/models/${statInfo.glb || 'custom_balance.glb'}`;

    gltfLoader.load(glbPath, (gltf) => {
        const model = gltf.scene; model.scale.set(50, 50, 50); model.position.y = 10;
        model.traverse((child) => {
            if (child.isMesh && child.material) {
                child.material = child.material.clone();
                let mName = (child.material.name || '').toLowerCase();
                if (mName.includes('main') || mName.includes('1') || mName.includes('body')) { child.material.color.set(bladeCol1); } 
                else if (mName.includes('accent') || mName.includes('2') || mName.includes('point') || mName.includes('sub')) { child.material.color.set(bladeCol2); } 
                else { child.material.color.set(bladeCol1); }
                child.material.roughness = 0.4; child.material.metalness = 0.2;
            }
        });
        spinGroup.add(model);
    }, undefined, (error) => {
        let bGeo = bladeType === 'saw' ? new THREE.CylinderGeometry(26, 26, 10, 7) : bladeType === 'shield' ? new THREE.CylinderGeometry(29, 29, 14, 32) : new THREE.CylinderGeometry(26, 26, 10, 32);
        const blade = new THREE.Mesh(bGeo, new THREE.MeshStandardMaterial({ color: bladeCol1, roughness: 0.4, metalness: 0.2 }));
        blade.position.y = 10; spinGroup.add(blade);
    });

    let tipStat = PARTS_STAT[tipType] || PARTS_STAT['speed'];
    gltfLoader.load(`./assets/models/${tipStat.glb || 'custom_tip_speed.glb'}`, (gltf) => {
        const tipModel = gltf.scene; tipModel.scale.set(50, 50, 50); tipModel.position.y = 5; 
        tipModel.traverse((child) => {
            if (child.isMesh && child.material) {
                child.material = child.material.clone(); child.material.roughness = 0.3; child.material.metalness = 0.3;
                child.material.color.set(tipType === 'heavy' ? 0x475569 : 0x94a3b8);
            }
        });
        spinGroup.add(tipModel);
    }, undefined, (error) => {
        let tipGeo = tipType === 'speed' ? new THREE.ConeGeometry(8, 14, 16) : new THREE.SphereGeometry(10, 16, 16);
        const tip = new THREE.Mesh(tipGeo, new THREE.MeshStandardMaterial({ color: tipType === 'heavy' ? 0x475569 : 0x94a3b8, roughness: 0.3, metalness: 0.3 }));
        if (tipType === 'speed') tip.rotation.x = Math.PI; tip.position.y = 5; spinGroup.add(tip);
    });

    const jewelMaterial = new THREE.MeshPhysicalMaterial({ color: coreCol, metalness: 0.1, roughness: 0.15, transmission: 0.2, opacity: 1.0, transparent: true, ior: 1.5, side: THREE.DoubleSide, clearcoat: 1.0, clearcoatRoughness: 0.05 });
    gltfLoader.load('./assets/models/custom_core.glb', (gltf) => {
        const coreModel = gltf.scene; coreModel.scale.set(50, 50, 50); coreModel.position.y = 11.5;
        coreModel.traverse((child) => { if (child.isMesh && child.material) { child.material = jewelMaterial; } });
        staticCoreGroup.add(coreModel);
    }, undefined, (err) => {
        const coreMesh = new THREE.Mesh(new THREE.CylinderGeometry(14, 10, 13, 6), jewelMaterial); coreMesh.position.y = 11.5; staticCoreGroup.add(coreMesh);
    });

    if (zodiacType) {
        let visibleIconColor = getVisibleZodiacColor(coreCol);
        const bitMat = new THREE.MeshBasicMaterial({ transparent: true, side: THREE.FrontSide, depthTest: false, depthWrite: false, alphaTest: 0.1 });
        createColorizedZodiacTexture(zodiacType, visibleIconColor, (tex) => { if (tex) { tex.center.set(0.5, 0.5); tex.rotation = Math.PI; bitMat.map = tex; bitMat.needsUpdate = true; } });
        const bitChip = new THREE.Mesh(new THREE.PlaneGeometry(17, 17), bitMat); bitChip.rotation.x = -Math.PI / 2; bitChip.position.set(0, 19.8, 0); bitChip.renderOrder = 999; staticCoreGroup.add(bitChip);
    }

    const particleCount = 40; const pGeo = new THREE.BufferGeometry(); const positions = new Float32Array(particleCount * 3); const particleData = [];
    for (let i = 0; i < particleCount; i++) {
        let angle = Math.random() * Math.PI * 2; let radius = 10 + Math.random() * 12; let y = Math.random() * 32; let speed = 0.06 + Math.random() * 0.04; let riseSpeed = 0.7 + Math.random() * 0.8;
        positions[i * 3] = Math.cos(angle) * radius; positions[i * 3 + 1] = y; positions[i * 3 + 2] = Math.sin(angle) * radius; particleData.push({ angle, radius, y, speed, riseSpeed });
    }
    pGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64; const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32); grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.5, 'rgba(255,255,255,0.4)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, 64, 64); const pTexture = new THREE.CanvasTexture(canvas);
    const pMat = new THREE.PointsMaterial({ color: coreCol, size: 7, map: pTexture, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const tornadoParticles = new THREE.Points(pGeo, pMat); tornadoParticles.name = 'tornadoParticles'; tornadoParticles.userData = { particleData }; spinGroup.add(tornadoParticles);

    containerGroup.userData = { spinGroup }; return containerGroup;
}

let showroomTop = createBeybladeMesh('circle', 'speed', 'rat', '#3b82f6', '#1d4ed8', '#f59e0b'); showroomScene.add(showroomTop);
function updateShowroom() { showroomScene.remove(showroomTop); showroomTop = createBeybladeMesh(document.getElementById('select-blade').value, document.getElementById('select-tip').value, document.getElementById('select-zodiac').value || 'rat', document.getElementById('blade-color-1').value, document.getElementById('blade-color-2').value, document.getElementById('core-color').value); showroomScene.add(showroomTop); }

const gameScene = new THREE.Scene(); gameScene.background = new THREE.Color('#000000');
const beybladeScene = new THREE.Scene();
const gameCam = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 2000); gameCam.position.set(0, 480, 350); gameCam.lookAt(0, 0, 0);
const gameRenderer = new THREE.WebGLRenderer({ antialias: true }); gameRenderer.setSize(window.innerWidth, window.innerHeight); gameRenderer.autoClear = false; 
document.body.appendChild(gameRenderer.domElement); gameRenderer.domElement.style.display = 'none';

gameScene.add(new THREE.AmbientLight(0xffffff, 0.65)); const gLight = new THREE.DirectionalLight(0xffffff, 0.9); gLight.position.set(150, 350, 150); gameScene.add(gLight);
beybladeScene.add(new THREE.AmbientLight(0xffffff, 0.65)); const bLight = new THREE.DirectionalLight(0xffffff, 0.9); bLight.position.set(150, 350, 150); beybladeScene.add(bLight);

const arenaRadius = 300; 
gltfLoader.load('./assets/models/custom_arena.glb', (gltf) => {
    const arenaModel = gltf.scene; arenaModel.scale.set(25, 25, 25); arenaModel.position.set(0, 0, 0);
    arenaModel.traverse((child) => {
        if (child.isMesh && child.material) {
            let materials = Array.isArray(child.material) ? child.material : [child.material];
            materials.forEach((mat) => {
                let mName = (mat.name || '').toLowerCase();
                if (mName.includes('logo_decal')) {
                    let fileName = ''; if (mName.includes('center')) fileName = 'logo_center.png'; else if (mName.includes('topleft')) fileName = 'logo_top_left.png'; else if (mName.includes('topright')) fileName = 'logo_top_right.png'; else if (mName.includes('bottomleft')) fileName = 'logo_bottom_left.png'; else if (mName.includes('bottomright')) fileName = 'logo_bottom_right.png'; else if (mName.includes('top')) fileName = 'logo_top.png'; else if (mName.includes('bottom')) fileName = 'logo_bottom.png';
                    if (fileName) { textureLoader.load(`./assets/textures/ads/${fileName}`, (tex) => { tex.wrapS = THREE.ClampToEdgeWrapping; tex.wrapT = THREE.ClampToEdgeWrapping; tex.encoding = THREE.sRGBEncoding; tex.center.set(0.5, 0.5); if (mName.includes('center')) { tex.rotation = Math.PI; } else { tex.repeat.x = -1; } mat.map = tex; mat.transparent = true; mat.alphaTest = 0.1; mat.depthWrite = true; mat.opacity = 1.0; mat.needsUpdate = true; }, undefined, () => { mat.transparent = true; mat.opacity = 0.0; mat.needsUpdate = true; }); }
                } 
                else if (mName.includes('arena_floor_mat') || mName.includes('floor')) { mat.color.set(0xcccccc); mat.roughness = 0.3; mat.metalness = 0.05; mat.needsUpdate = true; }
                else if (mName.includes('arena_wall_mat') || mName.includes('wall')) { mat.color.set(0x475569); mat.roughness = 0.05; mat.metalness = 0.85; mat.needsUpdate = true; }
            });
        }
    });
    gameScene.add(arenaModel);
}, undefined, (error) => {
    const outerWallGeo = new THREE.CylinderGeometry(arenaRadius + 35, arenaRadius + 45, 45, 64); const outerWallMat = new THREE.MeshStandardMaterial({ color: '#cbd5e1', metalness: 0.8, roughness: 0.05 });
    const outerWall = new THREE.Mesh(outerWallGeo, outerWallMat); outerWall.position.y = -22; gameScene.add(outerWall);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(arenaRadius, 5.5, 16, 100), new THREE.MeshStandardMaterial({ color: '#ef4444', emissive: 0x991b1b, emissiveIntensity: 0.9 })); ring.rotation.x = Math.PI / 2; ring.position.y = 2; gameScene.add(ring);
});

let inputDirX = 0, inputDirZ = 0, activeTouchId = null, joystickBaseX = 0, joystickBaseY = 0; const maxDist = 45;
const joystickBase = document.getElementById('joystick-base'); const joystickStick = document.getElementById('joystick-stick');

window.addEventListener('pointerdown', (e) => {
    if (!gameStarted || gamePhase !== 'playing' || (player && !player.isAlive)) return;
    if (e.target.closest('#dash-btn') || e.target.closest('#exit-btn') || e.target.closest('.modal') || e.target.closest('#ingame-chat-box')) return;
    activeTouchId = e.pointerId; joystickBaseX = e.clientX; joystickBaseY = e.clientY;
    joystickBase.style.display = 'flex'; joystickBase.style.left = `${joystickBaseX}px`; joystickBase.style.top = `${joystickBaseY}px`; joystickStick.style.transform = `translate(0px, 0px)`;
    inputDirX = 0; inputDirZ = 0;
});
window.addEventListener('pointermove', (e) => {
    if (activeTouchId !== e.pointerId) return; let dx = e.clientX - joystickBaseX; let dy = e.clientY - joystickBaseY; let dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > maxDist) { dx = (dx / dist) * maxDist; dy = (dy / dist) * maxDist; } joystickStick.style.transform = `translate(${dx}px, ${dy}px)`; inputDirX = dx / maxDist; inputDirZ = dy / maxDist;
});
window.addEventListener('pointerup', (e) => { if (activeTouchId !== e.pointerId) return; activeTouchId = null; inputDirX = 0; inputDirZ = 0; joystickBase.style.display = 'none'; });

function triggerDash() {
    if (!gameStarted || gamePhase !== 'playing' || !player || !player.isAlive || player.isDashing || player.isStunned || player.isCooldown) return;
    let dirX = inputDirX || 0, dirZ = inputDirZ || -1, len = Math.sqrt(dirX * dirX + dirZ * dirZ) || 1;
    player.isDashing = true; player.hasHit = false; player.hasScoredHit = false; player.dashFrames = 10; player.dashDirX = (dirX / len) * 7; player.dashDirZ = (dirZ / len) * 7;
}

function handleActionClick() { if (player && !player.isAlive && gameMode === 'private') { switchSpectateTarget(); } else { triggerDash(); } }
function switchSpectateTarget() { let aliveEntities = entities.filter(e => e.isAlive); if (aliveEntities.length === 0) return; spectateTargetIndex = (spectateTargetIndex + 1) % aliveEntities.length; }

let keys = {}; window.addEventListener('keydown', (e) => { keys[e.code] = true; if (e.code === 'Space') triggerDash(); }); window.addEventListener('keyup', (e) => { keys[e.code] = false; });
setInterval(() => { if (gameStarted && gamePhase === 'playing') { entities.forEach(e => { if (e.isAlive) e.survivalTime++; }); if (gameMode === 'quick') { survivalTime++; } } }, 1000);

function createCollisionSpark(x, y) {
    let spark = new THREE.Mesh(new THREE.SphereGeometry(2.5, 6, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
    spark.position.set(x + (Math.random() - 0.5) * 8, 12, y + (Math.random() - 0.5) * 8); beybladeScene.add(spark); activeSparks.push({ mesh: spark, life: 6, maxLife: 6 });
}

function renderLayeredScene() { gameRenderer.clear(); gameRenderer.render(gameScene, gameCam); gameRenderer.clearDepth(); gameRenderer.render(beybladeScene, gameCam); }

function gameLoop() {
    try {
        if (!gameStarted) {
            if (document.getElementById('custom-modal').style.display === 'flex' || document.getElementById('multiplayer-modal').style.display === 'flex' || document.getElementById('lobby-screen').style.display !== 'none') {
                if (!isShowroomDragging) { showroomAngleY += (0 - showroomAngleY) * 0.18; showroomAngleX += (0 - showroomAngleX) * 0.18; showroomVelY *= 0.8; showroomVelX *= 0.8; }
                if (showroomTop && showroomTop.userData && showroomTop.userData.spinGroup) { showroomTop.userData.spinGroup.rotation.y -= 0.05; showroomTop.rotation.y = showroomAngleY; showroomTop.rotation.x = showroomAngleX; }
                showroomRenderer.render(showroomScene, showroomCam);
            }
        } else {
            if (gamePhase === 'countdown') {
                countdownTimer--; let numElem = document.getElementById('countdown-number');
                if (numElem) {
                    if (countdownTimer > 120) numElem.innerText = '3'; else if (countdownTimer > 60) numElem.innerText = '2'; else if (countdownTimer > 0) numElem.innerText = '1';
                    else { numElem.innerText = 'GO!'; if (countdownTimer <= -20) { let overlay = document.getElementById('countdown-overlay'); if (overlay) overlay.style.display = 'none'; gamePhase = 'playing'; } }
                }
                if (player) { gameCam.position.x = player.x; gameCam.position.z = player.y + 220; gameCam.position.y = 320; gameCam.lookAt(player.x, 0, player.y); }
                entities.forEach((ent, i) => {
                    if (ent.dropHeight > 0) { ent.dropHeight -= 6; }
                    if (entityMeshes[i]) { entityMeshes[i].position.set(ent.x, Math.max(0, ent.dropHeight), ent.y); if (entityMeshes[i].userData && entityMeshes[i].userData.spinGroup) { entityMeshes[i].userData.spinGroup.rotation.y -= 0.5; } }
                    if (entityTrails[i]) { entityTrails[i].mesh.visible = false; }
                });
                renderLayeredScene(); requestAnimationFrame(gameLoop); return;
            }

            if (gamePhase === 'playing') {
                // 내 팽이 조작 및 AI (원격 팽이는 targetX/Y로 보간만)
                entities.forEach((ent) => {
                    if (!ent.isAlive) return;
                    let tipStat = PARTS_STAT[ent.tipType]; ent.prevX = ent.x; ent.prevY = ent.y;
                    if (ent.staggerTimer > 0) ent.staggerTimer--;
                    if (ent.comboTimer > 0) { ent.comboTimer--; if (ent.comboTimer <= 0) ent.comboCount = 0; }
                    if (ent.isCooldown) { ent.cooldownTimer--; if (ent.cooldownTimer <= 0) ent.isCooldown = false; }

                    if (gameMode === 'private' && !ent.isPlayer && !isHost) {
                        // 비방장은 원격 플레이어와 AI를 단순히 보간(Lerp) 처리 (호스트 권한 위임)
                        ent.x += (ent.targetX - ent.x) * 0.3;
                        ent.y += (ent.targetY - ent.y) * 0.3;
                        return; // 스턴, 대시 물리연산 스킵
                    }

                    if (ent.isStunned) {
                        ent.stunTimer--; if (ent.stunTimer <= 0) ent.isStunned = false; ent.vx *= 0.88; ent.vz *= 0.88;
                    } else if (ent.isDashing) {
                        ent.vx = ent.dashDirX; ent.vz = ent.dashDirZ; ent.dashFrames--;
                        if (ent.dashFrames <= 0) { ent.isDashing = false; if (!ent.hasHit) { ent.isStunned = true; ent.stunTimer = 60; ent.isCooldown = true; ent.cooldownTimer = 300; ent.comboCount = 0; } }
                    } else {
                        if (ent.isPlayer) {
                            let mx = inputDirX, mz = inputDirZ;
                            if (keys['ArrowLeft'] || keys['KeyA']) mx = -1; if (keys['ArrowRight'] || keys['KeyD']) mx = 1; if (keys['ArrowUp'] || keys['KeyW']) mz = -1; if (keys['ArrowDown'] || keys['KeyS']) mz = 1;
                            let accel = 0.45 * tipStat.speedBonus; ent.vx += mx * accel; ent.vz += mz * accel;
                        } else if (isHost || gameMode === 'quick') {
                            ent.aiTimer = (ent.aiTimer || 0) - 1;
                            if (ent.aiTimer <= 0) { ent.aiTimer = 40 + Math.random() * 60; let dCenter = Math.sqrt(ent.x * ent.x + ent.y * ent.y); if (dCenter > 190) { ent.aiState = 'defend'; } else { let choices = ['attack', 'circle', 'defend']; ent.aiState = choices[Math.floor(Math.random() * choices.length)]; } }
                            let target = player && player.isAlive ? player : entities.find(e => e.isAlive && e !== ent);
                            if (target) {
                                let dx = target.x - ent.x, dz = target.y - ent.y, d = Math.sqrt(dx*dx + dz*dz) || 1;
                                if (ent.aiState === 'attack') { ent.vx += (dx / d) * 0.35; ent.vz += (dz / d) * 0.35; } 
                                else if (ent.aiState === 'circle') { let perpX = -dz / d; let perpZ = dx / d; ent.vx += (perpX * 0.3 + (dx / d) * 0.12); ent.vz += (perpZ * 0.3 + (dz / d) * 0.12); } 
                                else if (ent.aiState === 'defend') { let toCenterX = -ent.x; let toCenterZ = -ent.y; let cDist = Math.sqrt(toCenterX*toCenterX + toCenterZ*toCenterZ) || 1; ent.vx += (toCenterX / cDist) * 0.28; ent.vz += (toCenterZ / cDist) * 0.28; }
                                if (d < 140 && !ent.isCooldown && Math.random() < 0.025) { ent.isDashing = true; ent.hasHit = false; ent.hasScoredHit = false; ent.dashFrames = 10; ent.dashDirX = (dx / d) * 7; ent.dashDirZ = (dz / d) * 7; }
                            }
                        }
                        ent.vx *= 0.86; ent.vz *= 0.86;
                    }
                    let distToCenter = Math.sqrt(ent.x * ent.x + ent.y * ent.y); if (distToCenter > 5 && !(ent.isDashing && ent.isPlayer)) { ent.vx -= (ent.x / distToCenter) * 0.07; ent.vz -= (ent.y / distToCenter) * 0.07; }
                    ent.x += ent.vx; ent.y += ent.vz;
                });

                // 멀티플레이 정기 동기화 (내 좌표 전송)
                if (gameMode === 'private' && roomRef && player && player.isAlive) {
                    let now = Date.now();
                    if (now - lastNetworkSync > 50) {
                        lastNetworkSync = now;
                        // 내가 방장이라면 봇들의 좌표도 함께 업데이트
                        let updates = {};
                        updates[mySessionId] = { x: player.x, y: player.y, vx: player.vx, vz: player.vz, isAlive: player.isAlive };
                        if (isHost) {
                            entities.filter(e => e.isBot).forEach(bot => {
                                updates[bot.id] = { x: bot.x, y: bot.y, vx: bot.vx, vz: bot.vz, isAlive: bot.isAlive };
                            });
                        }
                        roomRef.child('gameStates').update(updates);
                    }
                }

                // 물리 충돌 연산 (방장 권한)
                if (gameMode === 'quick' || isHost) {
                    for (let i = 0; i < entities.length; i++) {
                        for (let j = i + 1; j < entities.length; j++) {
                            let e1 = entities[i]; let e2 = entities[j]; if (!e1.isAlive || !e2.isAlive) continue;
                            let dx = e2.x - e1.x; let dz = e2.y - e1.y; let dist = Math.sqrt(dx * dx + dz * dz); let minDistSum = e1.radius + e2.radius;
                            if (dist < minDistSum) {
                                let overlap = minDistSum - dist; let nx = dx / dist; let nz = dz / dist;
                                e1.x -= nx * overlap * 0.55; e1.y -= nz * overlap * 0.55; e2.x += nx * overlap * 0.55; e2.y += nz * overlap * 0.55;
                                createCollisionSpark((e1.x + e2.x) / 2, (e1.y + e2.y) / 2);
                                let angleMultiplier = 1.0;
                                if (e2.staggerTimer > 0 || e2.isStunned) { angleMultiplier = 2.2; } else {
                                    let e2Speed = Math.sqrt(e2.vx * e2.vx + e2.vz * e2.vz);
                                    if (e2Speed > 0.1) {
                                        let v2x = e2.vx / e2Speed, v2z = e2.vz / e2Speed, dot = v2x * nx + v2z * nz;
                                        let angleRad = Math.acos(Math.max(-1, Math.min(1, Math.abs(dot)))), angleDeg = angleRad * (180 / Math.PI);
                                        if (angleDeg <= 45) { angleMultiplier = 1.0; } else if (angleDeg <= 135) { angleMultiplier = 1.4; } else { angleMultiplier = 2.2; }
                                    }
                                }
                                let statA = PARTS_STAT[e1.type] || PARTS_STAT['circle']; let statD = PARTS_STAT[e2.type] || PARTS_STAT['circle'];
                                let wtA = getEntityWeight(e1); let wtD = getEntityWeight(e2); let weightAtkRatio = (statA.atk * wtA) / (statD.def * wtD);
                                let e1DashHit = false, e2DashHit = false;

                                if (e1.isDashing) {
                                    if (overlap > 1.0) {
                                        e1.hasHit = true; e1DashHit = true; e2.staggerTimer = 60;
                                        if (e1.isPlayer && !e1.hasScoredHit) { e1.hasScoredHit = true; e1.comboCount++; e1.comboTimer = 300; }
                                        let knockbackForce = (18.0 + (e1.comboCount || 0) * 5.0) * weightAtkRatio * angleMultiplier;
                                        e2.vx += nx * knockbackForce; e2.vz += nz * knockbackForce; e1.vx = -nx * 4.0; e1.vz = -nz * 4.0;
                                    }
                                } else {
                                    let knockbackForce = (10.0 + (e1.comboCount || 0) * 5.0) * weightAtkRatio * angleMultiplier;
                                    e1.vx -= nx * (knockbackForce * 0.4); e1.vz -= nz * (knockbackForce * 0.4); e2.vx += nx * knockbackForce; e2.vz += nz * knockbackForce;
                                }

                                // 방장으로서 충돌 이벤트 배포 (다른 클라이언트에게 좌표 강제 푸시)
                                if (gameMode === 'private' && roomRef) {
                                    roomRef.child('events').push({
                                        type: 'collision', id1: e1.id, id2: e2.id, 
                                        x1: e1.x, y1: e1.y, vx1: e1.vx, vz1: e1.vz, dashHit1: e1DashHit,
                                        x2: e2.x, y2: e2.y, vx2: e2.vx, vz2: e2.vz, dashHit2: e2DashHit,
                                        cx: (e1.x + e2.x)/2, cy: (e1.y + e2.y)/2
                                    });
                                }
                            }
                        }
                    }
                }

                // 링 아웃 및 탈락 처리
                entities.forEach((ent, i) => {
                    if (!ent.isAlive) return; let dCenter = Math.sqrt(ent.x * ent.x + ent.y * ent.y);
                    if (dCenter + ent.radius > arenaRadius) {
                        if (gameMode === 'quick') {
                            if (ent.isPlayer) {
                                ent.x = 0; ent.y = 120; ent.vx = 0; ent.vz = 0; survivalTime = 0; ent.survivalTime = 0;
                                ent.isDashing = false; ent.dashFrames = 0; ent.hasHit = false; ent.hasScoredHit = false;
                                ent.isStunned = false; ent.stunTimer = 0; ent.staggerTimer = 0; ent.comboCount = 0; ent.comboTimer = 0; ent.isCooldown = false; ent.cooldownTimer = 0;
                            } else { ent.x = (Math.random() - 0.5) * 100; ent.y = (Math.random() - 0.5) * 100; ent.vx = 0; ent.vz = 0; ent.survivalTime = 0; }
                        } else {
                            ent.isAlive = false; eliminationOrder.unshift(ent); removeEntityFromScene(i);
                        }
                    }
                });

                // 게임 종료 판단
                if (gameMode === 'private') {
                    let aliveEntities = entities.filter(e => e.isAlive);
                    if (aliveEntities.length <= 1) {
                        if (aliveEntities.length === 1 && !eliminationOrder.includes(aliveEntities[0])) { eliminationOrder.unshift(aliveEntities[0]); }
                        gamePhase = 'gameover';
                        if (isHost && roomRef) roomRef.update({ status: 'gameover' });
                        showResults();
                    }
                }
            }

            // 그래픽 업데이트 (스파크 및 궤적)
            for (let s = activeSparks.length - 1; s >= 0; s--) { let sp = activeSparks[s]; sp.life--; sp.mesh.scale.multiplyScalar(1.08); sp.mesh.material.opacity = (sp.life / sp.maxLife) * 0.6; if (sp.life <= 0) { beybladeScene.remove(sp.mesh); activeSparks.splice(s, 1); } }

            entities.forEach((ent, i) => {
                if (!ent.isAlive || !entityMeshes[i]) return;
                let bm = entityMeshes[i]; let trail = entityTrails[i]; let moveVelX = ent.x - ent.prevX; let moveVelZ = ent.y - ent.prevY;
                bm.rotation.z += (-moveVelX * 0.15 - bm.rotation.z) * 0.15; bm.rotation.x += (moveVelZ * 0.15 - bm.rotation.x) * 0.15;
                if (bm.userData && bm.userData.spinGroup) {
                    bm.userData.spinGroup.rotation.y -= 0.75;
                    let aura = bm.userData.spinGroup.getObjectByName('tornadoParticles');
                    if (aura) {
                        if (ent.comboCount > 0 && ent.comboTimer > 0) {
                            let progress = ent.comboTimer / 300; aura.material.opacity = Math.min(0.4 + (ent.comboCount * 0.15), 0.95) * progress;
                            let positions = aura.geometry.attributes.position.array; let data = aura.userData.particleData;
                            for (let j = 0; j < data.length; j++) {
                                data[j].angle += data[j].speed; data[j].y += data[j].riseSpeed; if (data[j].y > 35) { data[j].y = 0; data[j].radius = 8 + Math.random() * 10; }
                                let currentRadius = data[j].radius * (0.7 + Math.sin(data[j].y / 35 * Math.PI) * 0.5);
                                positions[j * 3] = Math.cos(data[j].angle) * currentRadius; positions[j * 3 + 1] = data[j].y; positions[j * 3 + 2] = Math.sin(data[j].angle) * currentRadius;
                            }
                            aura.geometry.attributes.position.needsUpdate = true;
                        } else { aura.material.opacity = 0; }
                    }
                }
                bm.position.set(ent.x, 0, ent.y);

                // 궤적 생성
                if (trail) {
                    let currentPos = new THREE.Vector3(ent.x, 0.6, ent.y); let speed = Math.sqrt(ent.vx * ent.vx + ent.vz * ent.vz);
                    if (speed > 0.02) {
                        if (trail.points.length === 0) { for (let k = 0; k <= trail.segs; k++) trail.points.push(currentPos.clone()); } 
                        else { let dist = trail.points[0].distanceTo(currentPos); if (dist > 0.8) { trail.points.unshift(currentPos.clone()); if (trail.points.length > trail.segs + 1) { trail.points.pop(); } } else { trail.points[0].lerp(currentPos, 0.5); } }
                    } else { trail.mesh.visible = false; trail.points = []; }
                    let hasMoved = trail.points.length > 2 && speed > 0.02; trail.mesh.visible = hasMoved;
                    if (hasMoved) {
                        let posAttr = trail.mesh.geometry.attributes.position, uvAttr = trail.mesh.geometry.attributes.uv, lastPerp = null;
                        for (let j = 0; j <= trail.segs; j++) {
                            let ptIndex = Math.min(j, trail.points.length - 1), pt = trail.points[ptIndex], nextPt = trail.points[Math.min(j + 1, trail.points.length - 1)];
                            let dir = new THREE.Vector3().subVectors(pt, nextPt); if (dir.lengthSq() < 0.0001) { dir.set(0, 0, 1); } else { dir.normalize(); }
                            let perp = new THREE.Vector3(-dir.z, 0, dir.x); if (lastPerp && perp.dot(lastPerp) < 0) { perp.negate(); } lastPerp = perp.clone();
                            let width = 14 * (1.0 - (j / trail.segs)), left = pt.clone().addScaledVector(perp, width * 0.5), right = pt.clone().addScaledVector(perp, -width * 0.5);
                            posAttr.setXYZ(j * 2, left.x, left.y, left.z); posAttr.setXYZ(j * 2 + 1, right.x, right.y, right.z); let v = j / trail.segs; uvAttr.setXY(j * 2, 0.0, v); uvAttr.setXY(j * 2 + 1, 1.0, v);
                        }
                        if (!trail.mesh.geometry.index) { let indices = []; for (let j = 0; j < trail.segs; j++) { let i0 = j * 2, i1 = j * 2 + 1, i2 = (j + 1) * 2, i3 = (j + 1) * 2 + 1; indices.push(i0, i1, i2, i1, i3, i2); } trail.mesh.geometry.setIndex(indices); }
                        posAttr.needsUpdate = true; uvAttr.needsUpdate = true; trail.mesh.geometry.computeVertexNormals();
                    }
                }
            });

            // UI 및 카메라 갱신
            if (player) {
                let ingameChatBox = document.getElementById('ingame-chat-box'), dashBtn = document.getElementById('dash-btn'), timerRing = document.getElementById('dash-timer-ring'), textContent = document.getElementById('dash-text-content'), dashIconMask = document.getElementById('dash-icon-mask');
                if (gameMode === 'private') {
                    if (!player.isAlive && gamePhase === 'playing') {
                        if (ingameChatBox) ingameChatBox.style.display = 'block';
                        if (dashBtn && textContent && timerRing) { dashBtn.className = "sub"; dashBtn.style.background = "linear-gradient(135deg, #3b82f6, #1d4ed8)"; dashBtn.style.borderColor = "#1e40af"; dashBtn.style.boxShadow = "none"; if (dashIconMask) dashIconMask.style.display = "none"; textContent.style.display = "block"; textContent.innerHTML = "👁️"; timerRing.style.strokeDashoffset = 264; }
                    } else { if (ingameChatBox) ingameChatBox.style.display = 'none'; }
                }
                if (player.isAlive && dashBtn && timerRing && textContent) {
                    let baseColor = player.coreColor, visibleIconColor = getVisibleZodiacColor(baseColor);
                    if (dashIconMask) dashIconMask.style.display = "block";
                    if (player.isCooldown) { dashBtn.className = "cooldown"; dashBtn.style.background = "#334155"; dashBtn.style.borderColor = "#1e293b"; dashBtn.style.boxShadow = "none"; if (dashIconMask) dashIconMask.style.backgroundColor = "#94a3b8"; textContent.style.display = "block"; textContent.innerHTML = `${Math.ceil(player.cooldownTimer / 60)}s`; timerRing.style.strokeDashoffset = 264; } 
                    else {
                        if (player.comboCount > 0) { dashBtn.className = "glowing"; dashBtn.style.background = baseColor; dashBtn.style.borderColor = "#ffffff"; dashBtn.style.boxShadow = `0 0 20px ${baseColor}`; if (dashIconMask) dashIconMask.style.backgroundColor = "#ffffff"; textContent.style.display = "block"; textContent.innerHTML = `x${player.comboCount}`; timerRing.style.strokeDashoffset = 264 * (1 - (player.comboTimer / 300)); } 
                        else { dashBtn.className = ""; dashBtn.style.background = baseColor; dashBtn.style.borderColor = visibleIconColor; dashBtn.style.boxShadow = "none"; if (dashIconMask) dashIconMask.style.backgroundColor = visibleIconColor; textContent.style.display = "none"; timerRing.style.strokeDashoffset = 264; }
                    }
                }

                if (player.isAlive) {
                    gameCam.position.x += (player.x - gameCam.position.x) * 0.08; gameCam.position.z += ((player.y + 240) - gameCam.position.z) * 0.08; gameCam.position.y = 400; gameCam.lookAt(player.x, 0, player.y);
                } else if (gameMode === 'private') {
                    let aliveEntities = entities.filter(e => e.isAlive);
                    if (aliveEntities.length > 0) {
                        if (spectateTargetIndex >= aliveEntities.length) spectateTargetIndex = 0; let st = aliveEntities[spectateTargetIndex];
                        gameCam.position.x += (st.x - gameCam.position.x) * 0.08; gameCam.position.z += ((st.y + 240) - gameCam.position.z) * 0.08; gameCam.position.y = 420; gameCam.lookAt(st.x, 0, st.y);
                    } else { gameCam.position.x += (0 - gameCam.position.x) * 0.08; gameCam.position.z += (300 - gameCam.position.z) * 0.08; gameCam.position.y = 500; gameCam.lookAt(0, 0, 0); }
                }
            }

            const statusText = document.getElementById('status-text');
            if (statusText && gamePhase === 'playing' && player) {
                if (!player.isAlive) { statusText.innerHTML = "💀 SPECTATING - Click VIEW button to switch targets!"; statusText.style.color = "#ef4444"; } 
                else if (player.isStunned) { statusText.innerHTML = "⚠️ OVERHEAT STUN!"; statusText.style.color = "#ef4444"; } 
                else if (player.isDashing) { statusText.innerHTML = "⚡ DASHING!"; statusText.style.color = "#f59e0b"; } 
                else if (player.comboCount > 0) { statusText.innerHTML = `🔥 COMBO x${player.comboCount} - POWER BOOSTED!`; statusText.style.color = "#38bdf8"; } 
                else { statusText.innerHTML = gameMode === 'quick' ? "Survive as long as you can!" : "Last one standing wins!"; statusText.style.color = "#f8fafc"; }
            }

            let leaderboardTitle = document.getElementById('leaderboard-title'), rankListElem = document.getElementById('rank-list');
            if (rankListElem) {
                if (gameMode === 'quick') {
                    if (leaderboardTitle) leaderboardTitle.innerText = "🏆 SURVIVAL TIME";
                    let rankData = entities.map(e => ({ name: e.name, time: e.survivalTime || 0, color: e.bladeColor1 })).sort((a, b) => b.time - a.time);
                    rankListElem.innerHTML = rankData.map(r => { let isP = (player && r.name === player.name); return `<div class="rank-item"><span>⭐ <span style="color:${r.color}">${r.name}</span></span><span style="color:${isP ? '#f1c40f' : '#cbd5e1'}">${r.time}s</span></div>`; }).join('');
                } else {
                    if (leaderboardTitle) leaderboardTitle.innerText = "🏆 BATTLE STATUS";
                    rankListElem.innerHTML = entities.map((e) => `<div class="rank-item"><span>⭐ <span style="color:${e.bladeColor1}">${e.name}</span></span><span>${e.isAlive ? '<span style="color:#10b981">Alive</span>' : '<span style="color:#ef4444">Out</span>'}</span></div>`).join('');
                }
            }
            renderLayeredScene();
        }
    } catch (err) { console.error("Game loop error:", err); }
    requestAnimationFrame(gameLoop);
}

function showResults() {
    let ingameChatBox = document.getElementById('ingame-chat-box'); if (ingameChatBox) ingameChatBox.style.display = 'none';
    const dashBtn = document.getElementById('dash-btn'); if (dashBtn) { dashBtn.style.background = ""; dashBtn.style.borderColor = ""; }
    let resultList = document.getElementById('result-rank-list');
    if (resultList) {
        resultList.innerHTML = eliminationOrder.map((ent, idx) => `<div style="display:flex; justify-content:space-between; font-size:12px; padding:5px 0; border-bottom:1px solid #334155; font-weight:bold;"><span>${idx === 0 ? '👑 1st' : (idx + 1) + 'th'} - <span style="color:${ent.bladeColor1}">${ent.name}</span></span><span>${idx === 0 ? '🏆 WINNER' : 'Eliminated'}</span></div>`).join('');
    }
    let resultRoomInfo = document.getElementById('result-room-info'), resultChatBox = document.getElementById('result-chat-box'), resultRoomCode = document.getElementById('result-room-code');
    if (gameMode === 'private') { if (resultRoomInfo) resultRoomInfo.style.display = 'block'; if (resultChatBox) resultChatBox.style.display = 'flex'; if (resultRoomCode) resultRoomCode.innerText = currentRoomCode; } 
    else { if (resultRoomInfo) resultRoomInfo.style.display = 'none'; if (resultChatBox) resultChatBox.style.display = 'none'; }
    let resModal = document.getElementById('result-modal'); if (resModal) resModal.style.display = 'flex';
}

window.addEventListener('resize', () => { gameCam.aspect = window.innerWidth / window.innerHeight; gameCam.updateProjectionMatrix(); gameRenderer.setSize(window.innerWidth, window.innerHeight); });

gameLoop();