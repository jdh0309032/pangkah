// 고유 세션 ID 생성 (동명이인 완벽 구분)
const mySessionId = 'p_' + Math.random().toString(36).substr(2, 9);
const db = firebase.database();
let roomRef = null;
let publicRoomRef = null;
let roomStatus = 'waiting'; // 무한 재시작 방지용 상태 추적기

// 누락된 3D 모델(.glb) 에러 캐싱 (엄청난 렉 방지용)
const missingModels = {};

// 모달 및 UI 관련 전역 함수
window.openCustomModal = function() { document.getElementById('custom-modal').style.display = 'flex'; };
window.closeCustomModal = function() { document.getElementById('custom-modal').style.display = 'none'; };
window.openMultiplayerModal = function() {
    document.getElementById('multiplayer-modal').style.display = 'flex';
    document.getElementById('room-menu-view').style.display = 'block';
    document.getElementById('room-waiting-view').style.display = 'none';
};
window.closeMultiplayerModal = function() { document.getElementById('multiplayer-modal').style.display = 'none'; };

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
        isAlive: true
    };
}

window.createRoom = function() {
    currentRoomCode = Math.floor(1000 + Math.random() * 9000).toString();
    isHost = true;
    document.getElementById('display-room-code').innerText = currentRoomCode;
    document.getElementById('room-menu-view').style.display = 'none';
    document.getElementById('room-waiting-view').style.display = 'flex';
    
    roomPlayers = [getMyPlayerData()];
    roomStatus = 'waiting';
    
    roomRef = db.ref('rooms/' + currentRoomCode);
    roomRef.set({
        status: 'waiting',
        players: roomPlayers,
        gameStates: null
    });

    setupPrivateRoomListener();
    initPrivateChatListener();
    updateRoomPlayerList();
    clearPrivateChat();
    addChatSystemMessage(`Room created! Code: ${currentRoomCode}`);
};

window.joinRoom = function() {
    let code = document.getElementById('room-code-input').value.trim();
    if (code.length !== 4) { alert('Please enter a valid 4-digit room code.'); return; }
    
    currentRoomCode = code;
    isHost = false;
    document.getElementById('display-room-code').innerText = currentRoomCode;
    document.getElementById('room-menu-view').style.display = 'none';
    document.getElementById('room-waiting-view').style.display = 'flex';
    roomStatus = 'waiting';

    roomRef = db.ref('rooms/' + currentRoomCode);
    roomRef.once('value', (snapshot) => {
        let data = snapshot.val();
        if (!data) {
            alert('존재하지 않는 방 코드입니다!');
            window.leaveRoom();
            return;
        }
        roomPlayers = data.players || [];
        if (!roomPlayers.some(p => p.id === mySessionId)) {
            roomPlayers.push(getMyPlayerData());
            roomRef.update({ players: roomPlayers });
        }
        
        setupPrivateRoomListener();
        initPrivateChatListener();
        updateRoomPlayerList();
        clearPrivateChat();
        addChatSystemMessage(`Joined room ${currentRoomCode}`);
    });
};

function setupPrivateRoomListener() {
    roomRef.on('value', (snapshot) => {
        let data = snapshot.val();
        if (!data) return;
        
        if (data.players) {
            roomPlayers = data.players;
            updateRoomPlayerList();
        }
        
        let newStatus = data.status;
        if (newStatus === 'playing' && roomStatus !== 'playing') {
            roomStatus = 'playing';
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
}

window.leaveRoom = function() {
    if (roomRef) {
        roomRef.off();
        if (!isHost) {
            roomRef.once('value', (snap) => {
                let data = snap.val();
                if (data && data.players) {
                    let updatedPlayers = data.players.filter(p => p.id !== mySessionId);
                    roomRef.update({ players: updatedPlayers });
                }
            });
        }
    }
    currentRoomCode = ''; roomRef = null; isHost = false;
    clearPrivateChat();
    document.getElementById('room-waiting-view').style.display = 'none';
    document.getElementById('room-menu-view').style.display = 'block';
};

function updateRoomPlayerList() {
    document.getElementById('player-count').innerText = roomPlayers.length;
    let html = '';
    roomPlayers.forEach(p => {
        html += `<div style="display:flex; justify-content:space-between; font-size:12px; padding:4px 0; border-bottom:1px solid #334155; align-items:center;">
            <span style="color:#f8fafc; font-weight:600;">${p.name} ${p.isHost ? '👑' : ''}</span>
            <span style="color:#10b981; font-weight:bold;">Ready</span>
        </div>`;
    });
    document.getElementById('room-player-list').innerHTML = html;
}

function addChatSystemMessage(msg) {
    let cm = document.getElementById('chat-messages');
    if (cm) {
        cm.innerHTML += `<div style="color:#38bdf8; font-style:italic;">[System] ${msg}</div>`;
        cm.scrollTop = cm.scrollHeight;
    }
}

window.sendChatMessage = function() { sendChatToFirebase('chat-input'); };
window.sendIngameChatMessage = function() { sendChatToFirebase('ingame-chat-input'); };
window.sendResultChatMessage = function() { sendChatToFirebase('result-chat-input'); };

function sendChatToFirebase(inputId) {
    let input = document.getElementById(inputId);
    if (!input) return;
    let text = input.value.trim();
    if (!text) return;
    let nickname = document.getElementById('nickname-input').value || 'Player';
    if (roomRef) {
        roomRef.child('chat').push({ sender: nickname, text: text });
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
            if (cm) {
                cm.innerHTML += `<div><span style="color:#f1c40f; font-weight:bold;">${data.sender}:</span> ${data.text}</div>`;
                cm.scrollTop = cm.scrollHeight;
            }
            let log = document.getElementById('ingame-chat-log');
            if (log && gameMode === 'private') {
                log.innerHTML += `<div><span style="color:#f1c40f;">${data.sender}:</span> ${data.text}</div>`;
                log.scrollTop = log.scrollHeight;
            }
            let rcm = document.getElementById('result-chat-messages');
            if (rcm && gameMode === 'private') {
                rcm.innerHTML += `<div><span style="color:#f1c40f;">${data.sender}:</span> ${data.text}</div>`;
                rcm.scrollTop = rcm.scrollHeight;
            }
        }
    });
}

function clearPrivateChat() {
    let ids = ['chat-messages', 'ingame-chat-log', 'result-chat-messages'];
    ids.forEach(id => { let el = document.getElementById(id); if(el) el.innerHTML = ''; });
}

window.startPrivateGameSession = function() {
    if (!isHost) { alert('방장만 게임을 시작할 수 있습니다!'); return; }
    if (!roomPlayers || roomPlayers.length <= 0) { alert('참가자가 최소 1명 이상 있어야 합니다!'); return; }
    if (roomRef) {
        roomRef.child('gameStates').remove(); 
        roomRef.update({ status: 'playing' });
    }
};

window.startQuickGame = function() {
    gameMode = 'quick';
    isHost = false;
    let myData = getMyPlayerData();

    publicRoomRef = db.ref('rooms/PUBLIC_ARENA');
    publicRoomRef.once('value', (snapshot) => {
        let data = snapshot.val();
        let pList = data && data.players ? data.players : [];
        
        pList = pList.filter(p => p.id !== mySessionId);
        pList.push(myData);

        publicRoomRef.set({ status: 'playing', players: pList });
        roomPlayers = pList;

        // 퀵 아레나 동적 유저 동기화
        publicRoomRef.child('players').on('value', (snap) => {
            let updatedPlayers = snap.val() || [];
            roomPlayers = updatedPlayers;
            if (gamePhase === 'playing' || gamePhase === 'countdown') {
                updatedPlayers.forEach((p) => {
                    let exists = entities.find(e => e.id === p.id);
                    if (!exists && p.id !== mySessionId) {
                        let ent = createEntity(0, 120, p.blade, p.tip, p.zodiac, p.color1, p.color2, p.core, p.name, false, p.id);
                        entities.push(ent);
                        let mesh = createBeybladeMesh(ent.type, ent.tipType, ent.zodiac, ent.bladeColor1, ent.bladeColor2, ent.coreColor);
                        mesh.position.set(ent.x, ent.dropHeight, ent.y);
                        beybladeScene.add(mesh);
                        entityMeshes.push(mesh);
                        let trailData = createDynamicTrail(ent.bladeColor1);
                        beybladeScene.add(trailData.mesh);
                        entityTrails.push(trailData);
                    }
                });
                
                // 나간 유저 3D 모델 제거
                for (let i = entities.length - 1; i >= 0; i--) {
                    if (entities[i].id !== mySessionId && !updatedPlayers.find(up => up.id === entities[i].id)) {
                        if (entityMeshes[i]) beybladeScene.remove(entityMeshes[i]);
                        if (entityTrails[i]) beybladeScene.remove(entityTrails[i].mesh);
                        entities.splice(i, 1);
                        entityMeshes.splice(i, 1);
                        entityTrails.splice(i, 1);
                    }
                }
            }
        });

        startGameSession(roomPlayers, 'quick');
    });
};

const textureLoader = new THREE.TextureLoader();

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

    let img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = `./assets/textures/zodiac/${sign}.png`;
    img.onload = () => {
        let canvas = document.createElement('canvas');
        canvas.width = 256; canvas.height = 256;
        let ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, 256, 256);
        ctx.globalCompositeOperation = 'source-in';
        ctx.fillStyle = hexColor;
        ctx.fillRect(0, 0, 256, 256);
        let texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        zodiacCanvasTextureCache[cacheKey] = texture;
        callback(texture);
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

const gltfLoader = new THREE.GLTFLoader();

const PARTS_STAT = {
    'circle': { speed: 3.7, atk: 1.2, def: 1.2, weight: 1.0, glb: 'custom_balance.glb' },
    'saw':    { speed: 4.3, atk: 1.7, def: 0.6, weight: 0.9, glb: 'custom_attack.glb'  },
    'shield': { speed: 3.0, atk: 0.7, def: 1.8, weight: 1.3, glb: 'custom_defense.glb' },
    'speed':  { speedBonus: 1.25, weight: 0.7, glb: 'custom_tip_speed.glb' },
    'heavy':  { speedBonus: 0.90, weight: 1.5, glb: 'custom_tip_heavy.glb' }
};

let trailTextureCache = {};
function getTrailTexture() {
    if (trailTextureCache['default']) return trailTextureCache['default'];
    let canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 128;
    let ctx = canvas.getContext('2d');
    let grad = ctx.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.9)'); 
    grad.addColorStop(0.35, 'rgba(255, 255, 255, 0.35)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');     
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 128);
    let tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    trailTextureCache['default'] = tex;
    return tex;
}

function createDynamicTrail(bladeColor) {
    const segs = 14;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array((segs + 1) * 2 * 3);
    const uvs = new Float32Array((segs + 1) * 2 * 2);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

    let mat = new THREE.MeshBasicMaterial({ color: bladeColor, map: getTrailTexture(), transparent: true, depthWrite: false, side: THREE.DoubleSide });
    let mesh = new THREE.Mesh(geometry, mat);
    mesh.frustumCulled = false; mesh.visible = false;
    return { mesh, points: [], segs };
}

function createEntity(x, y, type, tipType, zodiac, bladeColor1, bladeColor2, coreColor, name, isPlayer = false, id = null) {
    return {
        id: id,
        x: x, y: y, vx: 0, vz: 0, radius: 28,
        type: type, tipType: tipType, zodiac: zodiac,
        bladeColor1: bladeColor1, bladeColor2: bladeColor2, coreColor: coreColor,
        isDashing: false, dashFrames: 0, dashDirX: 0, dashDirZ: 0, hasHit: false, hasScoredHit: false,
        isStunned: false, stunTimer: 0, staggerTimer: 0,
        comboCount: 0, comboTimer: 0, cooldownTimer: 0, isCooldown: false,
        prevX: x, prevY: y, name: name, isPlayer: isPlayer,
        isAlive: true, dropHeight: 120, survivalTime: 0, targetX: x, targetY: y
    };
}

function startGameSession(playerList, mode) {
    gameMode = mode;
    document.getElementById('lobby-screen').style.display = 'none';
    gameRenderer.domElement.style.display = 'block';
    document.getElementById('game-ui').style.display = 'block';
    document.getElementById('result-modal').style.display = 'none';
    
    let ingameChatLog = document.getElementById('ingame-chat-log');
    let ingameChatBox = document.getElementById('ingame-chat-box');
    if (gameMode === 'private') { if (ingameChatLog) ingameChatLog.style.display = 'flex'; } 
    else { if (ingameChatLog) ingameChatLog.style.display = 'none'; }
    if (ingameChatBox) ingameChatBox.style.display = 'none';

    let myInfo = playerList.find(p => p.id === mySessionId) || playerList[0];
    let cCol = myInfo.core || '#f59e0b';
    let zType = myInfo.zodiac || 'rat';

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

    entities = [];
    entityMeshes.forEach(m => { if (m) beybladeScene.remove(m); }); entityMeshes = [];
    entityTrails.forEach(t => { if (t && t.mesh) beybladeScene.remove(t.mesh); }); entityTrails = [];
    activeSparks.forEach(s => { if (s && s.mesh) beybladeScene.remove(s.mesh); }); activeSparks = [];
    
    eliminationOrder = []; player = null; survivalTime = 0; spectateTargetIndex = 0;
    
    let total = playerList.length;
    let spawnRadius = 140; 

    playerList.forEach((p, idx) => {
        let angle = (idx / total) * Math.PI * 2;
        let sx = Math.cos(angle) * spawnRadius;
        let sy = Math.sin(angle) * spawnRadius;

        let isThisPlayer = (p.id === mySessionId);
        let ent = createEntity(sx, sy, p.blade || 'circle', p.tip || 'speed', p.zodiac || 'rat', p.color1 || '#3b82f6', p.color2 || '#1d4ed8', p.core || '#f59e0b', p.name, isThisPlayer, p.id);
        if (isThisPlayer) player = ent;
        entities.push(ent);

        let mesh = createBeybladeMesh(ent.type, ent.tipType, ent.zodiac, ent.bladeColor1, ent.bladeColor2, ent.coreColor);
        mesh.position.set(ent.x, ent.dropHeight, ent.y);
        beybladeScene.add(mesh);
        entityMeshes.push(mesh);

        let trailData = createDynamicTrail(ent.bladeColor1);
        beybladeScene.add(trailData.mesh);
        entityTrails.push(trailData);
    });

    let activeRef = (gameMode === 'private') ? roomRef : publicRoomRef;
    if (activeRef) {
        activeRef.child('gameStates').on('value', (snapshot) => {
            let states = snapshot.val();
            if (!states) return;
            for (let pid in states) {
                if (pid !== mySessionId) {
                    let targetEnt = entities.find(e => e.id === pid);
                    if (targetEnt && targetEnt.isAlive) {
                        targetEnt.targetX = states[pid].x;
                        targetEnt.targetY = states[pid].y;
                        targetEnt.vx = states[pid].vx;
                        targetEnt.vz = states[pid].vz;
                        targetEnt.isAlive = states[pid].isAlive;
                    }
                }
            }
        });
    }

    gameStarted = true;
    gamePhase = 'countdown';
    countdownTimer = 180; 
    let overlay = document.getElementById('countdown-overlay');
    if (overlay) overlay.style.display = 'flex';
    let numElem = document.getElementById('countdown-number');
    if (numElem) numElem.innerText = '3';
}

window.returnToLobby = function() {
    gameStarted = false; gamePhase = 'waiting'; roomStatus = 'waiting';
    if (roomRef) roomRef.child('gameStates').off();
    if (publicRoomRef) publicRoomRef.child('gameStates').off();
    document.getElementById('game-ui').style.display = 'none';
    document.getElementById('result-modal').style.display = 'none';
    
    let ingameChatLog = document.getElementById('ingame-chat-log');
    let ingameChatBox = document.getElementById('ingame-chat-box');
    if (ingameChatLog) ingameChatLog.style.display = 'none';
    if (ingameChatBox) ingameChatBox.style.display = 'none';
    
    gameRenderer.domElement.style.display = 'none';
    document.getElementById('lobby-screen').style.display = 'flex';
    
    entityMeshes.forEach(bm => { if (bm) beybladeScene.remove(bm); }); entityMeshes = [];
    entityTrails.forEach(t => { if (t && t.mesh) beybladeScene.remove(t.mesh); }); entityTrails = [];
    activeSparks.forEach(s => { if (s && s.mesh) beybladeScene.remove(s.mesh); }); activeSparks = [];
};

window.restartCurrentGame = function() {
    document.getElementById('result-modal').style.display = 'none';
    if (gameMode === 'private') {
        if (isHost) {
            startPrivateGameSession();
        } else {
            alert('방장만 게임을 다시 시작할 수 있습니다.');
        }
    } else {
        startQuickGame();
    }
};

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
        let dx = e.clientX - prevMouseX, dy = e.clientY - prevMouseY;
        showroomVelY = dx * 0.03; showroomVelX = dy * 0.03;
        showroomAngleY += showroomVelY; showroomAngleX += showroomVelX;
        prevMouseX = e.clientX; prevMouseY = e.clientY;
    });
    window.addEventListener('pointerup', () => { isShowroomDragging = false; });
}

// 404 모델 반복 다운로드 렉 방지 최적화 함수
function createBeybladeMesh(bladeType, tipType, zodiacType, bladeCol1, bladeCol2, coreCol) {
    const containerGroup = new THREE.Group();
    const spinGroup = new THREE.Group();       
    const staticCoreGroup = new THREE.Group(); 
    containerGroup.add(spinGroup); containerGroup.add(staticCoreGroup);
    
    let statInfo = PARTS_STAT[bladeType] || PARTS_STAT['circle'];
    let glbPath = `./assets/models/${statInfo.glb || 'custom_balance.glb'}`;

    let loadFallbackBlade = () => {
        let bGeo = bladeType === 'saw' ? new THREE.CylinderGeometry(26, 26, 10, 7) :
                   bladeType === 'shield' ? new THREE.CylinderGeometry(29, 29, 14, 32) :
                   new THREE.CylinderGeometry(26, 26, 10, 32);
        const bladeMat = new THREE.MeshStandardMaterial({ color: bladeCol1, roughness: 0.4, metalness: 0.2 });
        const blade = new THREE.Mesh(bGeo, bladeMat);
        blade.position.y = 10; blade.name = 'blade';
        spinGroup.add(blade);
    };

    if (missingModels[glbPath]) { loadFallbackBlade(); } 
    else {
        gltfLoader.load(glbPath, (gltf) => {
            const model = gltf.scene;
            model.scale.set(50, 50, 50); model.position.y = 10;
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
        }, undefined, () => { missingModels[glbPath] = true; loadFallbackBlade(); });
    }

    let tipStat = PARTS_STAT[tipType] || PARTS_STAT['speed'];
    let tipGlbPath = `./assets/models/${tipStat.glb || 'custom_tip_speed.glb'}`;

    let loadFallbackTip = () => {
        let tipGeo = tipType === 'speed' ? new THREE.ConeGeometry(8, 14, 16) : new THREE.SphereGeometry(10, 16, 16);
        const tipMat = new THREE.MeshStandardMaterial({ color: tipType === 'heavy' ? 0x475569 : 0x94a3b8, roughness: 0.3, metalness: 0.3 });
        const tip = new THREE.Mesh(tipGeo, tipMat);
        if (tipType === 'speed') { tip.rotation.x = Math.PI; tip.position.y = 5; } else { tip.position.y = 5; }
        spinGroup.add(tip);
    };

    if (missingModels[tipGlbPath]) { loadFallbackTip(); } 
    else {
        gltfLoader.load(tipGlbPath, (gltf) => {
            const tipModel = gltf.scene; tipModel.scale.set(50, 50, 50); tipModel.position.y = 5; 
            tipModel.traverse((child) => {
                if (child.isMesh && child.material) {
                    child.material = child.material.clone();
                    child.material.roughness = 0.3; child.material.metalness = 0.3;
                    if (tipType === 'heavy') { child.material.color.set(0x475569); } else { child.material.color.set(0x94a3b8); }
                }
            });
            spinGroup.add(tipModel);
        }, undefined, () => { missingModels[tipGlbPath] = true; loadFallbackTip(); });
    }

    const jewelMaterial = new THREE.MeshPhysicalMaterial({ color: coreCol, metalness: 0.1, roughness: 0.15, transmission: 0.2, opacity: 1.0, transparent: true, ior: 1.5, side: THREE.DoubleSide, clearcoat: 1.0, clearcoatRoughness: 0.05 });
    let coreGlbPath = './assets/models/custom_core.glb';
    let loadFallbackCore = () => {
        let coreGeo = new THREE.CylinderGeometry(14, 10, 13, 6);
        const coreMesh = new THREE.Mesh(coreGeo, jewelMaterial); coreMesh.position.y = 11.5; staticCoreGroup.add(coreMesh);
    };
    if (missingModels[coreGlbPath]) { loadFallbackCore(); }
    else {
        gltfLoader.load(coreGlbPath, (gltf) => {
            const coreModel = gltf.scene; coreModel.scale.set(50, 50, 50); coreModel.position.y = 11.5;
            coreModel.traverse((child) => { if (child.isMesh && child.material) { child.material = jewelMaterial; } });
            staticCoreGroup.add(coreModel);
        }, undefined, () => { missingModels[coreGlbPath] = true; loadFallbackCore(); });
    }

    if (zodiacType) {
        const bitGeo = new THREE.PlaneGeometry(17, 17);
        let visibleIconColor = getVisibleZodiacColor(coreCol);
        const bitMat = new THREE.MeshBasicMaterial({ transparent: true, side: THREE.FrontSide, depthTest: false, depthWrite: false, alphaTest: 0.1 });
        createColorizedZodiacTexture(zodiacType, visibleIconColor, (tex) => {
            if (tex) { tex.center.set(0.5, 0.5); tex.rotation = 0; bitMat.map = tex; bitMat.needsUpdate = true; }
        });
        const bitChip = new THREE.Mesh(bitGeo, bitMat);
        bitChip.rotation.x = -Math.PI / 2; bitChip.position.set(0, 19.8, 0); bitChip.renderOrder = 999; staticCoreGroup.add(bitChip);
    }

    const pGeo = new THREE.BufferGeometry(); const positions = new Float32Array(40 * 3); const particleData = [];
    for (let i = 0; i < 40; i++) {
        let angle = Math.random() * Math.PI * 2, radius = 10 + Math.random() * 12, y = Math.random() * 32, speed = 0.06 + Math.random() * 0.04, riseSpeed = 0.7 + Math.random() * 0.8;
        positions[i * 3] = Math.cos(angle) * radius; positions[i * 3 + 1] = y; positions[i * 3 + 2] = Math.sin(angle) * radius;
        particleData.push({ angle, radius, y, speed, riseSpeed });
    }
    pGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64; const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32); grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.5, 'rgba(255,255,255,0.4)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, 64, 64);
    const pMat = new THREE.PointsMaterial({ color: coreCol, size: 7, map: new THREE.CanvasTexture(canvas), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const tornadoParticles = new THREE.Points(pGeo, pMat); tornadoParticles.name = 'tornadoParticles'; tornadoParticles.userData = { particleData }; spinGroup.add(tornadoParticles);
    containerGroup.userData = { spinGroup }; return containerGroup;
}

let showroomTop = createBeybladeMesh('circle', 'speed', 'rat', '#3b82f6', '#1d4ed8', '#f59e0b');
showroomScene.add(showroomTop);

window.updateShowroom = function() {
    showroomScene.remove(showroomTop);
    showroomTop = createBeybladeMesh(document.getElementById('select-blade').value, document.getElementById('select-tip').value, document.getElementById('select-zodiac').value || 'rat', document.getElementById('blade-color-1').value, document.getElementById('blade-color-2').value, document.getElementById('core-color').value);
    showroomScene.add(showroomTop);
};

const gameScene = new THREE.Scene(); gameScene.background = new THREE.Color('#000000');
const beybladeScene = new THREE.Scene();
const gameCam = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 2000); gameCam.position.set(0, 480, 350); gameCam.lookAt(0, 0, 0);
const gameRenderer = new THREE.WebGLRenderer({ antialias: true }); gameRenderer.setSize(window.innerWidth, window.innerHeight); gameRenderer.autoClear = false; 
document.body.appendChild(gameRenderer.domElement); gameRenderer.domElement.style.display = 'none';

gameScene.add(new THREE.AmbientLight(0xffffff, 0.65));
const gLight = new THREE.DirectionalLight(0xffffff, 0.9); gLight.position.set(150, 350, 150); gameScene.add(gLight);
beybladeScene.add(new THREE.AmbientLight(0xffffff, 0.65));
const bLight = new THREE.DirectionalLight(0xffffff, 0.9); bLight.position.set(150, 350, 150); beybladeScene.add(bLight);

const arenaRadius = 300; 

gltfLoader.load('./assets/models/custom_arena.glb', (gltf) => {
    const arenaModel = gltf.scene; arenaModel.scale.set(25, 25, 25); arenaModel.position.set(0, 0, 0);
    arenaModel.traverse((child) => {
        if (child.isMesh && child.material) {
            let materials = Array.isArray(child.material) ? child.material : [child.material];
            materials.forEach((mat) => {
                let mName = (mat.name || '').toLowerCase();
                if (mName.includes('arena_floor_mat') || mName.includes('floor')) { mat.color.set(0xcccccc); mat.roughness = 0.3; mat.metalness = 0.05; mat.needsUpdate = true; }
                else if (mName.includes('arena_wall_mat') || mName.includes('wall')) { mat.color.set(0x475569); mat.roughness = 0.05; mat.metalness = 0.85; mat.needsUpdate = true; }
            });
        }
    });
    gameScene.add(arenaModel);
}, undefined, (error) => {
    const outerWallGeo = new THREE.CylinderGeometry(arenaRadius + 35, arenaRadius + 45, 45, 64);
    const outerWallMat = new THREE.MeshStandardMaterial({ color: '#cbd5e1', metalness: 0.8, roughness: 0.05 });
    const outerWall = new THREE.Mesh(outerWallGeo, outerWallMat); outerWall.position.y = -22; gameScene.add(outerWall);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(arenaRadius, 5.5, 16, 100), new THREE.MeshStandardMaterial({ color: '#ef4444', emissive: 0x991b1b, emissiveIntensity: 0.9 }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 2; gameScene.add(ring);
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
    if (activeTouchId !== e.pointerId) return;
    let dx = e.clientX - joystickBaseX, dy = e.clientY - joystickBaseY;
    let dist = Math.sqrt(dx * dx + dy * dy); if (dist > maxDist) { dx = (dx / dist) * maxDist; dy = (dy / dist) * maxDist; }
    joystickStick.style.transform = `translate(${dx}px, ${dy}px)`; inputDirX = dx / maxDist; inputDirZ = dy / maxDist;
});
window.addEventListener('pointerup', (e) => {
    if (activeTouchId !== e.pointerId) return;
    activeTouchId = null; inputDirX = 0; inputDirZ = 0; joystickBase.style.display = 'none';
});

const dashBtnElem = document.getElementById('dash-btn');
if (dashBtnElem) { dashBtnElem.addEventListener('pointerdown', (e) => { e.stopPropagation(); handleActionClick(); }); }

function triggerDash() {
    if (!gameStarted || gamePhase !== 'playing' || !player || !player.isAlive || player.isDashing || player.isStunned || player.isCooldown) return;
    let dirX = inputDirX || 0, dirZ = inputDirZ || -1, len = Math.sqrt(dirX * dirX + dirZ * dirZ) || 1;
    player.isDashing = true; player.hasHit = false; player.hasScoredHit = false; player.dashFrames = 10; player.dashDirX = (dirX / len) * 7; player.dashDirZ = (dirZ / len) * 7;
}

window.handleActionClick = function() {
    if (player && !player.isAlive && gameMode === 'private') { switchSpectateTarget(); } else { triggerDash(); }
};

function switchSpectateTarget() {
    let aliveEntities = entities.filter(e => e.isAlive);
    if (aliveEntities.length === 0) return;
    spectateTargetIndex = (spectateTargetIndex + 1) % aliveEntities.length;
}

let keys = {};
window.addEventListener('keydown', (e) => { keys[e.code] = true; if (e.code === 'Space') triggerDash(); });
window.addEventListener('keyup', (e) => { keys[e.code] = false; });

setInterval(() => {
    if (gameStarted && gamePhase === 'playing') {
        entities.forEach(e => { if (e.isAlive) e.survivalTime++; });
        if (gameMode === 'quick') { survivalTime++; }
    }
}, 1000);

function createCollisionSpark(x, y) {
    let spark = new THREE.Mesh(new THREE.SphereGeometry(2.5, 6, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
    spark.position.set(x + (Math.random() - 0.5) * 8, 12, y + (Math.random() - 0.5) * 8);
    beybladeScene.add(spark); activeSparks.push({ mesh: spark, life: 6, maxLife: 6 });
}

function renderLayeredScene() {
    gameRenderer.clear(); gameRenderer.render(gameScene, gameCam); gameRenderer.clearDepth(); gameRenderer.render(beybladeScene, gameCam);
}

let lastNetworkSync = 0; // 초당 동기화 제어 타이머 (렉 방지)

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
                countdownTimer--;
                let numElem = document.getElementById('countdown-number');
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
                entities.forEach((ent, idx) => {
                    if (!ent.isAlive) return;
                    
                    if ((gameMode === 'private' || gameMode === 'quick') && !ent.isPlayer) {
                        if (ent.targetX !== undefined && ent.targetY !== undefined) {
                            ent.prevX = ent.x; ent.prevY = ent.y;
                            ent.x += (ent.targetX - ent.x) * 0.35; ent.y += (ent.targetY - ent.y) * 0.35;
                        }
                        return;
                    }

                    let tipStat = PARTS_STAT[ent.tipType] || PARTS_STAT['speed'];
                    ent.prevX = ent.x; ent.prevY = ent.y;
                    if (ent.staggerTimer > 0) ent.staggerTimer--;

                    if (ent.isPlayer) {
                        if (ent.comboTimer > 0) { ent.comboTimer--; if (ent.comboTimer <= 0) ent.comboCount = 0; }
                        if (ent.isCooldown) { ent.cooldownTimer--; if (ent.cooldownTimer <= 0) ent.isCooldown = false; }
                    }

                    if (ent.isStunned) {
                        ent.stunTimer--; if (ent.stunTimer <= 0) ent.isStunned = false; ent.vx *= 0.88; ent.vz *= 0.88;
                    } else if (ent.isDashing) {
                        ent.vx = ent.dashDirX; ent.vz = ent.dashDirZ; ent.dashFrames--;
                        if (ent.dashFrames <= 0) {
                            ent.isDashing = false;
                            if (!ent.hasHit) { ent.isStunned = true; ent.stunTimer = 60; ent.isCooldown = true; ent.cooldownTimer = 300; ent.comboCount = 0; }
                        }
                    } else {
                        if (ent.isPlayer) {
                            let mx = inputDirX, mz = inputDirZ;
                            if (keys['ArrowLeft'] || keys['KeyA']) mx = -1; if (keys['ArrowRight'] || keys['KeyD']) mx = 1; if (keys['ArrowUp'] || keys['KeyW']) mz = -1; if (keys['ArrowDown'] || keys['KeyS']) mz = 1;
                            let accel = 0.45 * tipStat.speedBonus; ent.vx += mx * accel; ent.vz += mz * accel;
                        }
                        ent.vx *= 0.86; ent.vz *= 0.86;
                    }

                    let distToCenter = Math.sqrt(ent.x * ent.x + ent.y * ent.y);
                    if (distToCenter > 5 && !(ent.isDashing && ent.isPlayer)) { ent.vx -= (ent.x / distToCenter) * 0.07; ent.vz -= (ent.y / distToCenter) * 0.07; }

                    ent.x += ent.vx; ent.y += ent.vz;
                });

                // 네트워크 프레임 최적화 동기화 (초당 12.5번만 전송하여 렉 방지)
                if (player && player.isAlive) {
                    let now = Date.now();
                    if (now - lastNetworkSync > 80) {
                        lastNetworkSync = now;
                        let activeRef = (gameMode === 'private') ? roomRef : publicRoomRef;
                        if (activeRef) {
                            activeRef.child(`gameStates/${mySessionId}`).set({ x: player.x, y: player.y, vx: player.vx, vz: player.vz, isAlive: player.isAlive });
                        }
                    }
                }

                // 강력한 Knockback 충돌 연산
                for (let i = 0; i < entities.length; i++) {
                    for (let j = i + 1; j < entities.length; j++) {
                        let e1 = entities[i], e2 = entities[j];
                        if (!e1.isAlive || !e2.isAlive) continue;
                        let dx = e2.x - e1.x, dz = e2.y - e1.y;
                        let dist = Math.sqrt(dx * dx + dz * dz);
                        let minDistSum = e1.radius + e2.radius;
                        if (dist < minDistSum) {
                            let overlap = minDistSum - dist;
                            let nx = dx / dist, nz = dz / dist;
                            if (e1.isPlayer) { e1.x -= nx * overlap * 0.5; e1.y -= nz * overlap * 0.5; }
                            if (e2.isPlayer) { e2.x += nx * overlap * 0.5; e2.y += nz * overlap * 0.5; }
                            
                            let knockbackForce = 4.0; 
                            if (e1.isDashing || e2.isDashing) knockbackForce *= 1.8;
                            if (e1.isPlayer) { e1.vx -= nx * knockbackForce; e1.vz -= nz * knockbackForce; }
                            if (e2.isPlayer) { e2.vx += nx * knockbackForce; e2.vz += nz * knockbackForce; }
                            createCollisionSpark((e1.x + e2.x) / 2, (e1.y + e2.y) / 2);
                        }
                    }
                }

                entities.forEach((ent, i) => {
                    if (!ent.isAlive) return;
                    let dCenter = Math.sqrt(ent.x * ent.x + ent.y * ent.y);
                    if (dCenter + ent.radius > arenaRadius) {
                        if (gameMode === 'quick') {
                            if (ent.isPlayer) {
                                ent.x = 0; ent.y = 120; ent.vx = 0; ent.vz = 0;
                                survivalTime = 0; ent.survivalTime = 0; ent.isDashing = false; ent.dashFrames = 0; ent.hasHit = false; ent.hasScoredHit = false; ent.isStunned = false; ent.stunTimer = 0; ent.staggerTimer = 0; ent.comboCount = 0; ent.comboTimer = 0; ent.isCooldown = false; ent.cooldownTimer = 0;
                            }
                        } else {
                            ent.isAlive = false; eliminationOrder.unshift(ent);
                            if (entityMeshes[i]) beybladeScene.remove(entityMeshes[i]);
                            if (entityTrails[i]) { beybladeScene.remove(entityTrails[i].mesh); entityTrails[i] = null; }
                        }
                    }
                });

                if (gameMode === 'private') {
                    let aliveEntities = entities.filter(e => e.isAlive);
                    if (aliveEntities.length <= 1) {
                        if (aliveEntities.length === 1) { eliminationOrder.unshift(aliveEntities[0]); }
                        gamePhase = 'gameover';
                        if (isHost && roomRef) { roomRef.update({ status: 'gameover' }); }
                        showResults();
                    }
                }
            }

            for (let s = activeSparks.length - 1; s >= 0; s--) {
                let sp = activeSparks[s]; sp.life--; sp.mesh.scale.multiplyScalar(1.08); sp.mesh.material.opacity = (sp.life / sp.maxLife) * 0.6;
                if (sp.life <= 0) { beybladeScene.remove(sp.mesh); activeSparks.splice(s, 1); }
            }

            // 앞구르기 렉 방지 포함된 애니메이션 로직
            entities.forEach((ent, i) => {
                if (!ent.isAlive || !entityMeshes[i]) return;
                let bm = entityMeshes[i], trail = entityTrails[i];
                let moveVelX = ent.x - ent.prevX, moveVelZ = ent.y - ent.prevY;
                
                // 목표 기울기 한계치 설정 (순간이동 시 팽이가 미친듯이 구르는 것 방지)
                const MAX_TILT = 0.5;
                let targetTiltZ = Math.max(-MAX_TILT, Math.min(MAX_TILT, -moveVelX * 0.15));
                let targetTiltX = Math.max(-MAX_TILT, Math.min(MAX_TILT, moveVelZ * 0.15));

                bm.rotation.z += (targetTiltZ - bm.rotation.z) * 0.15;
                bm.rotation.x += (targetTiltX - bm.rotation.x) * 0.15;
                
                if (bm.userData && bm.userData.spinGroup) {
                    bm.userData.spinGroup.rotation.y -= 0.75;
                    let aura = bm.userData.spinGroup.getObjectByName('tornadoParticles');
                    if (aura) {
                        if (ent.comboCount > 0 && ent.comboTimer > 0) {
                            let progress = ent.comboTimer / 300; aura.material.opacity = Math.min(0.4 + (ent.comboCount * 0.15), 0.95) * progress;
                            let positions = aura.geometry.attributes.position.array, data = aura.userData.particleData;
                            for (let j = 0; j < data.length; j++) {
                                data[j].angle += data[j].speed; data[j].y += data[j].riseSpeed;
                                if (data[j].y > 35) { data[j].y = 0; data[j].radius = 8 + Math.random() * 10; }
                                let currentRadius = data[j].radius * (0.7 + Math.sin(data[j].y / 35 * Math.PI) * 0.5);
                                positions[j * 3] = Math.cos(data[j].angle) * currentRadius; positions[j * 3 + 1] = data[j].y; positions[j * 3 + 2] = Math.sin(data[j].angle) * currentRadius;
                            }
                            aura.geometry.attributes.position.needsUpdate = true;
                        } else { aura.material.opacity = 0; }
                    }
                }
                bm.position.set(ent.x, 0, ent.y);

                if (trail) {
                    let currentPos = new THREE.Vector3(ent.x, 0.6, ent.y), speed = Math.sqrt(ent.vx * ent.vx + ent.vz * ent.vz);
                    if (speed > 0.02) {
                        if (trail.points.length === 0) { for (let k = 0; k <= trail.segs; k++) trail.points.push(currentPos.clone()); } 
                        else { let dist = trail.points[0].distanceTo(currentPos); if (dist > 0.8) { trail.points.unshift(currentPos.clone()); if (trail.points.length > trail.segs + 1) { trail.points.pop(); } } else { trail.points[0].lerp(currentPos, 0.5); } }
                    } else { trail.mesh.visible = false; trail.points = []; }
                    let hasMoved = trail.points.length > 2 && speed > 0.02; trail.mesh.visible = hasMoved;
                    if (hasMoved) {
                        let posAttr = trail.mesh.geometry.attributes.position, uvAttr = trail.mesh.geometry.attributes.uv, lastPerp = null;
                        for (let j = 0; j <= trail.segs; j++) {
                            let ptIndex = Math.min(j, trail.points.length - 1), pt = trail.points[ptIndex];
                            let nextPt = trail.points[Math.min(j + 1, trail.points.length - 1)], dir = new THREE.Vector3().subVectors(pt, nextPt);
                            if (dir.lengthSq() < 0.0001) { dir.set(0, 0, 1); } else { dir.normalize(); }
                            let perp = new THREE.Vector3(-dir.z, 0, dir.x);
                            if (lastPerp) { if (perp.dot(lastPerp) < 0) { perp.negate(); } } lastPerp = perp.clone();
                            let width = 14 * (1.0 - (j / trail.segs));
                            let left = pt.clone().addScaledVector(perp, width * 0.5), right = pt.clone().addScaledVector(perp, -width * 0.5);
                            posAttr.setXYZ(j * 2, left.x, left.y, left.z); posAttr.setXYZ(j * 2 + 1, right.x, right.y, right.z);
                            let v = j / trail.segs; uvAttr.setXY(j * 2, 0.0, v); uvAttr.setXY(j * 2 + 1, 1.0, v);
                        }
                        if (!trail.mesh.geometry.index) {
                            let indices = [];
                            for (let j = 0; j < trail.segs; j++) { let i0 = j * 2, i1 = j * 2 + 1, i2 = (j + 1) * 2, i3 = (j + 1) * 2 + 1; indices.push(i0, i1, i2); indices.push(i1, i3, i2); }
                            trail.mesh.geometry.setIndex(indices);
                        }
                        posAttr.needsUpdate = true; uvAttr.needsUpdate = true; trail.mesh.geometry.computeVertexNormals();
                    }
                }
            });

            if (player) {
                let ingameChatBox = document.getElementById('ingame-chat-box'), dashBtn = document.getElementById('dash-btn'), timerRing = document.getElementById('dash-timer-ring'), textContent = document.getElementById('dash-text-content'), dashIconMask = document.getElementById('dash-icon-mask');
                if (gameMode === 'private') {
                    if (!player.isAlive && gamePhase === 'playing') {
                        if (ingameChatBox) ingameChatBox.style.display = 'block';
                        if (dashBtn && textContent && timerRing) { dashBtn.className = "sub"; dashBtn.style.background = "linear-gradient(135deg, #3b82f6, #1d4ed8)"; dashBtn.style.borderColor = "#1e40af"; dashBtn.style.boxShadow = "none"; if (dashIconMask) dashIconMask.style.display = "none"; textContent.style.display = "block"; textContent.innerHTML = "👁️"; timerRing.style.strokeDashoffset = 264; }
                    } else { if (ingameChatBox) ingameChatBox.style.display = 'none'; }
                }

                if (player.isAlive) {
                    if (dashBtn && timerRing && textContent) {
                        let baseColor = player.coreColor, visibleIconColor = getVisibleZodiacColor(baseColor);
                        if (dashIconMask) dashIconMask.style.display = "block";
                        if (player.isCooldown) {
                            dashBtn.className = "cooldown"; dashBtn.style.background = "#334155"; dashBtn.style.borderColor = "#1e293b"; dashBtn.style.boxShadow = "none"; if (dashIconMask) dashIconMask.style.backgroundColor = "#94a3b8"; 
                            textContent.style.display = "block"; textContent.innerHTML = `${Math.ceil(player.cooldownTimer / 60)}s`; timerRing.style.strokeDashoffset = 264;
                        } else {
                            if (player.comboCount > 0) {
                                dashBtn.className = "glowing"; dashBtn.style.background = baseColor; dashBtn.style.borderColor = "#ffffff"; dashBtn.style.boxShadow = `0 0 20px ${baseColor}`; if (dashIconMask) dashIconMask.style.backgroundColor = "#ffffff"; 
                                textContent.style.display = "block"; textContent.innerHTML = `x${player.comboCount}`; let progressFraction = player.comboTimer / 300; timerRing.style.strokeDashoffset = 264 * (1 - progressFraction);
                            } else {
                                dashBtn.className = ""; dashBtn.style.background = baseColor; dashBtn.style.borderColor = visibleIconColor; dashBtn.style.boxShadow = "none"; if (dashIconMask) dashIconMask.style.backgroundColor = visibleIconColor; 
                                textContent.style.display = "none"; timerRing.style.strokeDashoffset = 264;
                            }
                        }
                    }
                    let targetCamX = player.x, targetCamZ = player.y + 240;
                    gameCam.position.x += (targetCamX - gameCam.position.x) * 0.08; gameCam.position.z += (targetCamZ - gameCam.position.z) * 0.08; gameCam.position.y = 400; gameCam.lookAt(player.x, 0, player.y);
                } else if (gameMode === 'private') {
                    let aliveEntities = entities.filter(e => e.isAlive);
                    if (aliveEntities.length > 0) {
                        if (spectateTargetIndex >= aliveEntities.length) { spectateTargetIndex = 0; }
                        let spectateTarget = aliveEntities[spectateTargetIndex];
                        gameCam.position.x += (spectateTarget.x - gameCam.position.x) * 0.08; gameCam.position.z += ((spectateTarget.y + 240) - gameCam.position.z) * 0.08; gameCam.position.y = 420; gameCam.lookAt(spectateTarget.x, 0, spectateTarget.y);
                    } else {
                        gameCam.position.x += (0 - gameCam.position.x) * 0.08; gameCam.position.z += (300 - gameCam.position.z) * 0.08; gameCam.position.y = 500; gameCam.lookAt(0, 0, 0);
                    }
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
                    let rankData = entities.map(e => ({ name: e.name, time: e.survivalTime || 0, color: e.bladeColor1 }));
                    rankData.sort((a, b) => b.time - a.time);
                    let rankHTML = '';
                    rankData.forEach(r => {
                        let isP = (player && r.name === player.name), col = isP ? '#f1c40f' : '#cbd5e1';
                        rankHTML += `<div class="rank-item"><span>⭐ <span style="color:${r.color}">${r.name}</span></span><span style="color:${col}">${r.time}s</span></div>`;
                    });
                    rankListElem.innerHTML = rankHTML;
                } else {
                    if (leaderboardTitle) leaderboardTitle.innerText = "🏆 BATTLE STATUS";
                    let rankHTML = '';
                    entities.forEach((e) => { let status = e.isAlive ? '<span style="color:#10b981">Alive</span>' : '<span style="color:#ef4444">Out</span>'; rankHTML += `<div class="rank-item"><span>⭐ <span style="color:${e.bladeColor1}">${e.name}</span></span><span>${status}</span></div>`; });
                    rankListElem.innerHTML = rankHTML;
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

    let html = '';
    eliminationOrder.forEach((ent, idx) => {
        let badge = idx === 0 ? '👑 1st' : `${idx + 1}th`;
        html += `<div style="display:flex; justify-content:space-between; font-size:12px; padding:5px 0; border-bottom:1px solid #334155; font-weight:bold;">
            <span>${badge} - <span style="color:${ent.bladeColor1}">${ent.name}</span></span><span>${idx === 0 ? '🏆 WINNER' : 'Eliminated'}</span>
        </div>`;
    });
    let resultList = document.getElementById('result-rank-list'); if (resultList) resultList.innerHTML = html;

    let resultRoomInfo = document.getElementById('result-room-info'), resultChatBox = document.getElementById('result-chat-box'), resultRoomCode = document.getElementById('result-room-code'), replayBtn = document.getElementById('replay-btn');
    if (gameMode === 'private') {
        if (resultRoomInfo) resultRoomInfo.style.display = 'block'; if (resultChatBox) resultChatBox.style.display = 'flex'; if (resultRoomCode) resultRoomCode.innerText = currentRoomCode;
        if (replayBtn) { replayBtn.style.display = isHost ? 'block' : 'none'; }
    } else {
        if (resultRoomInfo) resultRoomInfo.style.display = 'none'; if (resultChatBox) resultChatBox.style.display = 'none'; if (replayBtn) replayBtn.style.display = 'none';
    }
    let resModal = document.getElementById('result-modal'); if (resModal) resModal.style.display = 'flex';
}

window.addEventListener('resize', () => { gameCam.aspect = window.innerWidth / window.innerHeight; gameCam.updateProjectionMatrix(); gameRenderer.setSize(window.innerWidth, window.innerHeight); });

gameLoop();