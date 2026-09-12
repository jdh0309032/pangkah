// 고유 세션 ID 생성 (동명이인 완벽 구분 및 유령 팽이 방지)
const mySessionId = 'p_' + Math.random().toString(36).substr(2, 9);
const db = firebase.database();
let roomRef = null;
let publicRoomRef = null;
let activeGameRef = null;
let roomStatus = 'waiting'; 

// 404 모델 로딩 실패 시 렉 방지용 캐싱 및 헬퍼 함수
const missingModels = {};
function loadGLTF(path, onSuccess, onFallback) {
    if (missingModels[path]) { onFallback(); return; }
    gltfLoader.load(path, onSuccess, undefined, () => {
        missingModels[path] = true;
        onFallback();
    });
}

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

// ==========================================
// 1. 프라이빗 룸(방 만들기/참가) 시스템
// ==========================================
window.createRoom = function() {
    currentRoomCode = Math.floor(1000 + Math.random() * 9000).toString();
    isHost = true;
    document.getElementById('display-room-code').innerText = currentRoomCode;
    document.getElementById('room-menu-view').style.display = 'none';
    document.getElementById('room-waiting-view').style.display = 'flex';
    
    roomRef = db.ref('rooms/' + currentRoomCode);
    
    // 연결 끊기면 자동 퇴장
    roomRef.child('players/' + mySessionId).onDisconnect().remove();
    roomRef.child('gameStates/' + mySessionId).onDisconnect().remove();
    
    roomRef.set({ status: 'waiting' });
    roomRef.child('players/' + mySessionId).set(getMyPlayerData());
    
    setupPrivateRoomListener();
    initPrivateChatListener();
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

    roomRef = db.ref('rooms/' + currentRoomCode);
    
    roomRef.child('players/' + mySessionId).onDisconnect().remove();
    roomRef.child('gameStates/' + mySessionId).onDisconnect().remove();
    
    roomRef.once('value', (snapshot) => {
        if (!snapshot.val()) {
            alert('존재하지 않는 방입니다!');
            window.leaveRoom();
            return;
        }
        roomRef.child('players/' + mySessionId).set(getMyPlayerData());
        setupPrivateRoomListener();
        initPrivateChatListener();
        addChatSystemMessage(`Joined room ${currentRoomCode}`);
    });
};

function setupPrivateRoomListener() {
    if (!roomRef) return;
    roomRef.on('value', (snapshot) => {
        let data = snapshot.val();
        if (!data) return;
        
        if (data.players) {
            roomPlayers = Object.values(data.players);
            updateRoomPlayerList();
        } else {
            roomPlayers = [];
            updateRoomPlayerList();
        }
        
        let newStatus = data.status;
        if (newStatus === 'playing' && roomStatus !== 'playing') {
            roomStatus = 'playing';
            closeMultiplayerModal();
            let resModal = document.getElementById('result-modal');
            if (resModal) resModal.style.display = 'none';
            
            activeGameRef = roomRef.child('gameStates');
            setupGameStateListener();
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
        roomRef.child('players/' + mySessionId).remove();
        roomRef.child('gameStates/' + mySessionId).remove();
        roomRef.off();
    }
    currentRoomCode = ''; roomRef = null; activeGameRef = null; isHost = false;
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

window.startPrivateGameSession = function() {
    if (!isHost) { alert('방장만 시작할 수 있습니다!'); return; }
    if (roomPlayers.length <= 0) { alert('참가자가 없습니다!'); return; }
    if (roomRef) {
        roomRef.child('gameStates').remove().then(() => {
            roomRef.update({ status: 'playing' });
        });
    }
};

// ==========================================
// 2. 퀵 아레나 (오픈월드 난입) 시스템
// ==========================================
window.startQuickGame = function() {
    gameMode = 'quick';
    isHost = false;
    roomStatus = 'playing';

    publicRoomRef = db.ref('rooms/PUBLIC_ARENA');
    
    // 유령 팽이 방지를 위한 자동 삭제 설정
    publicRoomRef.child('players/' + mySessionId).onDisconnect().remove();
    publicRoomRef.child('gameStates/' + mySessionId).onDisconnect().remove();

    publicRoomRef.child('players/' + mySessionId).set(getMyPlayerData());
    publicRoomRef.child('gameStates/' + mySessionId).set({ x: 0, y: 120, vx: 0, vz: 0, isAlive: true });

    // 실시간 유저 리스트 동기화 및 3D 모델 소환/제거
    publicRoomRef.child('players').on('value', (snap) => {
        let pObj = snap.val() || {};
        roomPlayers = Object.values(pObj);

        if (gamePhase === 'playing' || gamePhase === 'countdown') {
            // 새로운 유저 난입 시 소환
            Object.keys(pObj).forEach(pid => {
                if (pid !== mySessionId && !entities.find(e => e.id === pid)) {
                    let pd = pObj[pid];
                    let ent = createEntity(0, 120, pd.blade, pd.tip, pd.zodiac, pd.color1, pd.color2, pd.core, pd.name, false, pid);
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
            // 나간 유저 3D 모델 파괴
            for (let i = entities.length - 1; i >= 0; i--) {
                if (entities[i].id !== mySessionId && !pObj[entities[i].id]) {
                    if (entityMeshes[i]) beybladeScene.remove(entityMeshes[i]);
                    if (entityTrails[i]) beybladeScene.remove(entityTrails[i].mesh);
                    entities.splice(i, 1);
                    entityMeshes.splice(i, 1);
                    entityTrails.splice(i, 1);
                }
            }
        }
    });

    activeGameRef = publicRoomRef.child('gameStates');
    setupGameStateListener();
    startGameSession(roomPlayers, 'quick');
};

// ==========================================
// 3. 실시간 위치 동기화 리스너
// ==========================================
function setupGameStateListener() {
    if (!activeGameRef) return;
    activeGameRef.on('value', (snap) => {
        let states = snap.val() || {};
        for (let pid in states) {
            if (pid !== mySessionId) {
                let ent = entities.find(e => e.id === pid);
                if (ent && ent.isAlive) {
                    ent.targetX = states[pid].x;
                    ent.targetY = states[pid].y;
                    ent.vx = states[pid].vx;
                    ent.vz = states[pid].vz;
                    ent.isAlive = states[pid].isAlive;
                }
            }
        }
    });
}

// ==========================================
// 4. 채팅 시스템
// ==========================================
function addChatSystemMessage(msg) {
    let cm = document.getElementById('chat-messages');
    if (cm) { cm.innerHTML += `<div style="color:#38bdf8; font-style:italic;">[System] ${msg}</div>`; cm.scrollTop = cm.scrollHeight; }
}
window.sendChatMessage = function() { sendChatToFirebase('chat-input'); };
window.sendIngameChatMessage = function() { sendChatToFirebase('ingame-chat-input'); };
window.sendResultChatMessage = function() { sendChatToFirebase('result-chat-input'); };

function sendChatToFirebase(inputId) {
    let input = document.getElementById(inputId);
    if (!input || !input.value.trim() || !roomRef) return;
    let nickname = document.getElementById('nickname-input').value || 'Player';
    roomRef.child('chat').push({ sender: nickname, text: input.value.trim() });
    input.value = '';
}

function initPrivateChatListener() {
    if (!roomRef) return;
    roomRef.child('chat').off();
    roomRef.child('chat').on('child_added', (snapshot) => {
        let data = snapshot.val();
        if (data) {
            let ids = ['chat-messages', 'ingame-chat-log', 'result-chat-messages'];
            ids.forEach(id => {
                let el = document.getElementById(id);
                if (el) { el.innerHTML += `<div><span style="color:#f1c40f; font-weight:bold;">${data.sender}:</span> ${data.text}</div>`; el.scrollTop = el.scrollHeight; }
            });
        }
    });
}
function clearPrivateChat() {
    ['chat-messages', 'ingame-chat-log', 'result-chat-messages'].forEach(id => {
        let el = document.getElementById(id); if (el) el.innerHTML = '';
    });
}

// ==========================================
// 5. 3D 그래픽 설정 및 렌더링
// ==========================================
const textureLoader = new THREE.TextureLoader();
const gltfLoader = new THREE.GLTFLoader();

function getVisibleZodiacColor(hexString) {
    let color = new THREE.Color(hexString); let hsl = { h: 0, s: 0, l: 0 }; color.getHSL(hsl);
    if (hsl.l > 0.55) color.setHSL(hsl.h, Math.min(1.0, hsl.s + 0.2), Math.max(0.12, hsl.l - 0.45));
    else color.setHSL(hsl.h, Math.min(1.0, hsl.s + 0.2), Math.min(0.92, hsl.l + 0.45));
    return color.getStyle();
}

const zodiacCanvasTextureCache = {};
function createColorizedZodiacTexture(sign, hexColor, callback) {
    let cacheKey = `${sign}_${hexColor}`;
    if (zodiacCanvasTextureCache[cacheKey]) { callback(zodiacCanvasTextureCache[cacheKey]); return; }
    let img = new Image(); img.crossOrigin = 'anonymous'; img.src = `./assets/textures/zodiac/${sign}.png`;
    img.onload = () => {
        let canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 256;
        let ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, 256, 256);
        ctx.globalCompositeOperation = 'source-in'; ctx.fillStyle = hexColor; ctx.fillRect(0, 0, 256, 256);
        let texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
        zodiacCanvasTextureCache[cacheKey] = texture; callback(texture);
    };
    img.onerror = () => { callback(null); };
}

const PARTS_STAT = {
    'circle': { speed: 3.7, atk: 1.2, def: 1.2, weight: 1.0, glb: 'custom_balance.glb' },
    'saw':    { speed: 4.3, atk: 1.7, def: 0.6, weight: 0.9, glb: 'custom_attack.glb'  },
    'shield': { speed: 3.0, atk: 0.7, def: 1.8, weight: 1.3, glb: 'custom_defense.glb' },
    'speed':  { speedBonus: 1.25, weight: 0.7, glb: 'custom_tip_speed.glb' },
    'heavy':  { speedBonus: 0.90, weight: 1.5, glb: 'custom_tip_heavy.glb' }
};

function getTrailTexture() {
    let canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 128;
    let ctx = canvas.getContext('2d'), grad = ctx.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.9)'); grad.addColorStop(0.35, 'rgba(255, 255, 255, 0.35)'); grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, 64, 128);
    let tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; return tex;
}

function createDynamicTrail(bladeColor) {
    const segs = 14; const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array((segs + 1) * 2 * 3), uvs = new Float32Array((segs + 1) * 2 * 2);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    let mat = new THREE.MeshBasicMaterial({ color: bladeColor, map: getTrailTexture(), transparent: true, depthWrite: false, side: THREE.DoubleSide });
    let mesh = new THREE.Mesh(geometry, mat); mesh.frustumCulled = false; mesh.visible = false;
    return { mesh, points: [], segs };
}

function createEntity(x, y, type, tipType, zodiac, bladeColor1, bladeColor2, coreColor, name, isPlayer = false, id = null) {
    return {
        id: id, x: x, y: y, vx: 0, vz: 0, radius: 28,
        type: type, tipType: tipType, zodiac: zodiac,
        bladeColor1: bladeColor1, bladeColor2: bladeColor2, coreColor: coreColor,
        isDashing: false, dashFrames: 0, dashDirX: 0, dashDirZ: 0, hasHit: false,
        isStunned: false, stunTimer: 0, staggerTimer: 0,
        comboCount: 0, comboTimer: 0, cooldownTimer: 0, isCooldown: false,
        prevX: x, prevY: y, name: name, isPlayer: isPlayer,
        isAlive: true, dropHeight: 120, survivalTime: 0, targetX: x, targetY: y
    };
}

function createBeybladeMesh(bladeType, tipType, zodiacType, bladeCol1, bladeCol2, coreCol) {
    const containerGroup = new THREE.Group();
    const spinGroup = new THREE.Group();       
    const staticCoreGroup = new THREE.Group(); 
    containerGroup.add(spinGroup); containerGroup.add(staticCoreGroup);
    
    let statInfo = PARTS_STAT[bladeType] || PARTS_STAT['circle'];
    
    loadGLTF(`./assets/models/${statInfo.glb || 'custom_balance.glb'}`, (gltf) => {
        const model = gltf.scene; model.scale.set(50, 50, 50); model.position.y = 10;
        model.traverse((child) => {
            if (child.isMesh && child.material) {
                child.material = child.material.clone();
                let mName = (child.material.name || '').toLowerCase();
                if (mName.includes('main') || mName.includes('1') || mName.includes('body')) child.material.color.set(bladeCol1);
                else if (mName.includes('accent') || mName.includes('2')) child.material.color.set(bladeCol2);
                else child.material.color.set(bladeCol1);
                child.material.roughness = 0.4; child.material.metalness = 0.2;
            }
        });
        spinGroup.add(model);
    }, () => {
        let bGeo = bladeType === 'saw' ? new THREE.CylinderGeometry(26, 26, 10, 7) : new THREE.CylinderGeometry(26, 26, 10, 32);
        const blade = new THREE.Mesh(bGeo, new THREE.MeshStandardMaterial({ color: bladeCol1, roughness: 0.4, metalness: 0.2 }));
        blade.position.y = 10; spinGroup.add(blade);
    });

    let tipStat = PARTS_STAT[tipType] || PARTS_STAT['speed'];
    loadGLTF(`./assets/models/${tipStat.glb || 'custom_tip_speed.glb'}`, (gltf) => {
        const tipModel = gltf.scene; tipModel.scale.set(50, 50, 50); tipModel.position.y = 5; 
        tipModel.traverse((child) => {
            if (child.isMesh && child.material) {
                child.material = child.material.clone();
                child.material.roughness = 0.3; child.material.metalness = 0.3;
                child.material.color.set(tipType === 'heavy' ? 0x475569 : 0x94a3b8);
            }
        });
        spinGroup.add(tipModel);
    }, () => {
        let tipGeo = tipType === 'speed' ? new THREE.ConeGeometry(8, 14, 16) : new THREE.SphereGeometry(10, 16, 16);
        const tip = new THREE.Mesh(tipGeo, new THREE.MeshStandardMaterial({ color: tipType === 'heavy' ? 0x475569 : 0x94a3b8 }));
        if (tipType === 'speed') tip.rotation.x = Math.PI; tip.position.y = 5; spinGroup.add(tip);
    });

    const jewelMaterial = new THREE.MeshPhysicalMaterial({ color: coreCol, metalness: 0.1, roughness: 0.15, transmission: 0.2, transparent: true, ior: 1.5 });
    loadGLTF('./assets/models/custom_core.glb', (gltf) => {
        const coreModel = gltf.scene; coreModel.scale.set(50, 50, 50); coreModel.position.y = 11.5;
        coreModel.traverse((child) => { if (child.isMesh && child.material) child.material = jewelMaterial; });
        staticCoreGroup.add(coreModel);
    }, () => {
        const coreMesh = new THREE.Mesh(new THREE.CylinderGeometry(14, 10, 13, 6), jewelMaterial);
        coreMesh.position.y = 11.5; staticCoreGroup.add(coreMesh);
    });

    if (zodiacType) {
        let visibleIconColor = getVisibleZodiacColor(coreCol);
        const bitMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, alphaTest: 0.1 });
        createColorizedZodiacTexture(zodiacType, visibleIconColor, (tex) => { if (tex) { tex.center.set(0.5, 0.5); bitMat.map = tex; bitMat.needsUpdate = true; } });
        const bitChip = new THREE.Mesh(new THREE.PlaneGeometry(17, 17), bitMat);
        bitChip.rotation.x = -Math.PI / 2; bitChip.position.set(0, 19.8, 0); staticCoreGroup.add(bitChip);
    }

    containerGroup.userData = { spinGroup };
    return containerGroup;
}

// 씬 초기화
const showroomScene = new THREE.Scene(); showroomScene.background = new THREE.Color('#000000');
const showroomCam = new THREE.PerspectiveCamera(40, 1, 0.1, 1000); showroomCam.position.set(0, 60, 95); showroomCam.lookAt(0, 0, 0);
const showroomRenderer = new THREE.WebGLRenderer({ antialias: true }); showroomRenderer.setSize(180, 180);
document.getElementById('showroom-container').appendChild(showroomRenderer.domElement);
showroomScene.add(new THREE.AmbientLight(0xffffff, 0.65)); showroomScene.add(new THREE.DirectionalLight(0xffffff, 0.75)).position.set(50, 150, 50);

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

gameScene.add(new THREE.AmbientLight(0xffffff, 0.65)); gameScene.add(new THREE.DirectionalLight(0xffffff, 0.9)).position.set(150, 350, 150);
beybladeScene.add(new THREE.AmbientLight(0xffffff, 0.65)); beybladeScene.add(new THREE.DirectionalLight(0xffffff, 0.9)).position.set(150, 350, 150);

const arenaRadius = 300; 
loadGLTF('./assets/models/custom_arena.glb', (gltf) => {
    const arenaModel = gltf.scene; arenaModel.scale.set(25, 25, 25);
    arenaModel.traverse((child) => {
        if (child.isMesh && child.material) {
            let mats = Array.isArray(child.material) ? child.material : [child.material];
            mats.forEach((mat) => {
                let mName = (mat.name || '').toLowerCase();
                if (mName.includes('floor')) { mat.color.set(0xcccccc); mat.roughness = 0.3; mat.metalness = 0.05; }
                else if (mName.includes('wall')) { mat.color.set(0x475569); mat.roughness = 0.05; mat.metalness = 0.85; }
            });
        }
    });
    gameScene.add(arenaModel);
}, () => {
    const outerWall = new THREE.Mesh(new THREE.CylinderGeometry(335, 345, 45, 64), new THREE.MeshStandardMaterial({ color: '#cbd5e1', metalness: 0.8 }));
    outerWall.position.y = -22; gameScene.add(outerWall);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(300, 5.5, 16, 100), new THREE.MeshStandardMaterial({ color: '#ef4444', emissive: 0x991b1b }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 2; gameScene.add(ring);
});

// ==========================================
// 6. 조작 및 게임 로직
// ==========================================
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
if (dashBtnElem) dashBtnElem.addEventListener('pointerdown', (e) => { e.stopPropagation(); handleActionClick(); });

function triggerDash() {
    if (!gameStarted || gamePhase !== 'playing' || !player || !player.isAlive || player.isDashing || player.isStunned || player.isCooldown) return;
    let dirX = inputDirX || 0, dirZ = inputDirZ || -1, len = Math.sqrt(dirX * dirX + dirZ * dirZ) || 1;
    player.isDashing = true; player.hasHit = false; player.dashFrames = 10; player.dashDirX = (dirX / len) * 7; player.dashDirZ = (dirZ / len) * 7;
}

window.handleActionClick = function() {
    if (player && !player.isAlive) { switchSpectateTarget(); } else { triggerDash(); }
};

let gameStarted = false, gameMode = 'quick', gamePhase = 'waiting', countdownTimer = 0, survivalTime = 0;
let entities = [], entityMeshes = [], entityTrails = [], eliminationOrder = [], player = null, spectateTargetIndex = 0, activeSparks = [];
let keys = {}; window.addEventListener('keydown', (e) => { keys[e.code] = true; if (e.code === 'Space') triggerDash(); }); window.addEventListener('keyup', (e) => { keys[e.code] = false; });

function startGameSession(playerList, mode) {
    gameMode = mode;
    document.getElementById('lobby-screen').style.display = 'none';
    gameRenderer.domElement.style.display = 'block';
    document.getElementById('game-ui').style.display = 'block';
    document.getElementById('result-modal').style.display = 'none';

    entities = [];
    entityMeshes.forEach(m => { if (m) beybladeScene.remove(m); }); entityMeshes = [];
    entityTrails.forEach(t => { if (t && t.mesh) beybladeScene.remove(t.mesh); }); entityTrails = [];
    
    eliminationOrder = []; player = null; survivalTime = 0; spectateTargetIndex = 0;

    let total = playerList.length;
    playerList.forEach((p, idx) => {
        let angle = (idx / total) * Math.PI * 2;
        let ent = createEntity(Math.cos(angle) * 140, Math.sin(angle) * 140, p.blade || 'circle', p.tip || 'speed', p.zodiac || 'rat', p.color1 || '#3b82f6', p.color2 || '#1d4ed8', p.core || '#f59e0b', p.name, p.id === mySessionId, p.id);
        if (ent.isPlayer) player = ent;
        entities.push(ent);

        let mesh = createBeybladeMesh(ent.type, ent.tipType, ent.zodiac, ent.bladeColor1, ent.bladeColor2, ent.coreColor);
        mesh.position.set(ent.x, ent.dropHeight, ent.y); beybladeScene.add(mesh); entityMeshes.push(mesh);
        let trailData = createDynamicTrail(ent.bladeColor1); beybladeScene.add(trailData.mesh); entityTrails.push(trailData);
    });

    gameStarted = true; gamePhase = 'countdown'; countdownTimer = 180; 
    let overlay = document.getElementById('countdown-overlay'); if (overlay) overlay.style.display = 'flex';
}

function switchSpectateTarget() {
    let aliveEntities = entities.filter(e => e.isAlive);
    if (aliveEntities.length > 0) {
        spectateTargetIndex = (spectateTargetIndex + 1) % aliveEntities.length;
    }
}

function createCollisionSpark(x, y) {
    let spark = new THREE.Mesh(new THREE.SphereGeometry(3.5, 6, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    spark.position.set(x, 12, y); beybladeScene.add(spark); activeSparks.push({ mesh: spark, life: 8, maxLife: 8 });
}

let lastNetworkSync = 0;

function gameLoop() {
    try {
        if (!gameStarted) {
            if (document.getElementById('lobby-screen').style.display !== 'none') {
                if (showroomTop && showroomTop.userData.spinGroup) { showroomTop.userData.spinGroup.rotation.y -= 0.05; }
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
                    if (ent.dropHeight > 0) ent.dropHeight -= 6;
                    if (entityMeshes[i]) { entityMeshes[i].position.set(ent.x, Math.max(0, ent.dropHeight), ent.y); if (entityMeshes[i].userData.spinGroup) entityMeshes[i].userData.spinGroup.rotation.y -= 0.5; }
                });
            } else if (gamePhase === 'playing') {
                entities.forEach((ent, idx) => {
                    if (!ent.isAlive) return;

                    if (!ent.isPlayer) {
                        ent.prevX = ent.x; ent.prevY = ent.y;
                        // 예측 보간(Lerp + Dead Reckoning)으로 부드럽게 이동
                        ent.x += ent.vx; ent.y += ent.vz; 
                        if (ent.targetX !== undefined) {
                            ent.x += (ent.targetX - ent.x) * 0.15;
                            ent.y += (ent.targetY - ent.y) * 0.15;
                        }
                        return;
                    }

                    ent.prevX = ent.x; ent.prevY = ent.y;
                    
                    if (ent.isStunned) {
                        ent.stunTimer--; if (ent.stunTimer <= 0) ent.isStunned = false; ent.vx *= 0.88; ent.vz *= 0.88;
                    } else if (ent.isDashing) {
                        ent.vx = ent.dashDirX; ent.vz = ent.dashDirZ; ent.dashFrames--;
                        if (ent.dashFrames <= 0) {
                            ent.isDashing = false;
                            if (!ent.hasHit) { ent.isStunned = true; ent.stunTimer = 60; ent.isCooldown = true; ent.cooldownTimer = 300; }
                        }
                    } else {
                        let mx = inputDirX, mz = inputDirZ;
                        if (keys['ArrowLeft'] || keys['KeyA']) mx = -1; if (keys['ArrowRight'] || keys['KeyD']) mx = 1;
                        if (keys['ArrowUp'] || keys['KeyW']) mz = -1; if (keys['ArrowDown'] || keys['KeyS']) mz = 1;
                        
                        let accel = 0.45 * (PARTS_STAT[ent.tipType]?.speedBonus || 1.0);
                        ent.vx += mx * accel; ent.vz += mz * accel;
                        ent.vx *= 0.86; ent.vz *= 0.86;
                    }

                    let dC = Math.sqrt(ent.x * ent.x + ent.y * ent.y);
                    if (dC > 5 && !ent.isDashing) { ent.vx -= (ent.x / dC) * 0.07; ent.vz -= (ent.y / dC) * 0.07; }
                    ent.x += ent.vx; ent.y += ent.vz;
                });

                // 프레임 최적화 동기화
                if (player && player.isAlive && activeGameRef) {
                    let now = Date.now();
                    if (now - lastNetworkSync > 50) { // 초당 20번 전송
                        lastNetworkSync = now;
                        activeGameRef.child(mySessionId).set({ x: player.x, y: player.y, vx: player.vx, vz: player.vz, isAlive: player.isAlive });
                    }
                }

                // 타격감 넘치는 강력한 충돌 판정 (Impulse Knockback)
                for (let i = 0; i < entities.length; i++) {
                    for (let j = i + 1; j < entities.length; j++) {
                        let e1 = entities[i], e2 = entities[j];
                        if (!e1.isAlive || !e2.isAlive) continue;
                        
                        let dx = e2.x - e1.x, dz = e2.y - e1.y;
                        let dist = Math.sqrt(dx * dx + dz * dz), minDist = e1.radius + e2.radius;
                        
                        if (dist < minDist) {
                            let overlap = minDist - dist, nx = dx / dist, nz = dz / dist;
                            
                            // 겹침 방지 (로컬 유저만 적용)
                            if (e1.isPlayer) { e1.x -= nx * overlap * 0.5; e1.y -= nz * overlap * 0.5; }
                            if (e2.isPlayer) { e2.x += nx * overlap * 0.5; e2.y += nz * overlap * 0.5; }
                            
                            // 튕겨나감(반발력) 수치 대폭 상승
                            let force = 8.5; 
                            if (e1.isDashing || e2.isDashing) force = 14.0;
                            
                            if (e1.isPlayer) { e1.vx -= nx * force; e1.vz -= nz * force; }
                            if (e2.isPlayer) { e2.vx += nx * force; e2.vz += nz * force; }
                            
                            createCollisionSpark((e1.x + e2.x) / 2, (e1.y + e2.y) / 2);
                        }
                    }
                }

                // 아레나 밖 이탈 처리 (죽음)
                entities.forEach((ent, i) => {
                    if (!ent.isAlive) return;
                    let dC = Math.sqrt(ent.x * ent.x + ent.y * ent.y);
                    if (dC + ent.radius > arenaRadius) {
                        if (gameMode === 'quick') {
                            if (ent.isPlayer) {
                                ent.x = 0; ent.y = 120; ent.vx = 0; ent.vz = 0; ent.isDashing = false; ent.isStunned = false; ent.isCooldown = false;
                                activeGameRef.child(mySessionId).update({ x: 0, y: 120, vx: 0, vz: 0 }); // 즉시 강제 부활 동기화
                            }
                        } else {
                            ent.isAlive = false; 
                            if (!eliminationOrder.includes(ent)) eliminationOrder.unshift(ent);
                            // 화면에서 안전하게 숨김 (오류 방지)
                            if (entityMeshes[i]) entityMeshes[i].visible = false;
                            if (entityTrails[i]) entityTrails[i].mesh.visible = false;
                        }
                    }
                });

                // 프라이빗 룸 종료 판정
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

            for (let s = activeSparks.length - 1; s >= 0; s--) {
                let sp = activeSparks[s]; sp.life--; sp.mesh.scale.multiplyScalar(1.08); sp.mesh.material.opacity = (sp.life / sp.maxLife) * 0.6;
                if (sp.life <= 0) { beybladeScene.remove(sp.mesh); activeSparks.splice(s, 1); }
            }

            // 회전 및 잔상 애니메이션 루프
            entities.forEach((ent, i) => {
                if (!ent.isAlive || !entityMeshes[i] || !entityMeshes[i].visible) return;
                let bm = entityMeshes[i], trail = entityTrails[i];
                let moveVelX = ent.x - ent.prevX, moveVelZ = ent.y - ent.prevY;
                
                let targetTiltZ = Math.max(-0.5, Math.min(0.5, -moveVelX * 0.15));
                let targetTiltX = Math.max(-0.5, Math.min(0.5, moveVelZ * 0.15));
                bm.rotation.z += (targetTiltZ - bm.rotation.z) * 0.15;
                bm.rotation.x += (targetTiltX - bm.rotation.x) * 0.15;
                
                if (bm.userData.spinGroup) bm.userData.spinGroup.rotation.y -= 0.75;
                bm.position.set(ent.x, 0, ent.y);

                if (trail && trail.mesh.visible !== false) {
                    let currentPos = new THREE.Vector3(ent.x, 0.6, ent.y), speed = Math.sqrt(ent.vx * ent.vx + ent.vz * ent.vz);
                    if (speed > 0.02) {
                        if (trail.points.length === 0) { for (let k = 0; k <= trail.segs; k++) trail.points.push(currentPos.clone()); } 
                        else { let dist = trail.points[0].distanceTo(currentPos); if (dist > 0.8) { trail.points.unshift(currentPos.clone()); if (trail.points.length > trail.segs + 1) trail.points.pop(); } else { trail.points[0].lerp(currentPos, 0.5); } }
                    } else { trail.mesh.visible = false; trail.points = []; }
                    
                    if (trail.points.length > 2 && speed > 0.02) {
                        trail.mesh.visible = true;
                        let posAttr = trail.mesh.geometry.attributes.position, uvAttr = trail.mesh.geometry.attributes.uv, lastPerp = null;
                        for (let j = 0; j <= trail.segs; j++) {
                            let pt = trail.points[Math.min(j, trail.points.length - 1)];
                            let nextPt = trail.points[Math.min(j + 1, trail.points.length - 1)], dir = new THREE.Vector3().subVectors(pt, nextPt);
                            if (dir.lengthSq() < 0.0001) dir.set(0, 0, 1); else dir.normalize();
                            let perp = new THREE.Vector3(-dir.z, 0, dir.x);
                            if (lastPerp && perp.dot(lastPerp) < 0) perp.negate(); 
                            lastPerp = perp.clone();
                            let width = 14 * (1.0 - (j / trail.segs)), left = pt.clone().addScaledVector(perp, width * 0.5), right = pt.clone().addScaledVector(perp, -width * 0.5);
                            posAttr.setXYZ(j * 2, left.x, left.y, left.z); posAttr.setXYZ(j * 2 + 1, right.x, right.y, right.z);
                            uvAttr.setXY(j * 2, 0.0, j / trail.segs); uvAttr.setXY(j * 2 + 1, 1.0, j / trail.segs);
                        }
                        posAttr.needsUpdate = true; uvAttr.needsUpdate = true;
                    }
                }
            });

            // 카메라 로직
            if (player && player.isAlive) {
                gameCam.position.x += (player.x - gameCam.position.x) * 0.08;
                gameCam.position.z += ((player.y + 240) - gameCam.position.z) * 0.08;
                gameCam.position.y = 400; gameCam.lookAt(player.x, 0, player.y);
            } else {
                let aliveEntities = entities.filter(e => e.isAlive);
                if (aliveEntities.length > 0) {
                    if (spectateTargetIndex >= aliveEntities.length) spectateTargetIndex = 0;
                    let target = aliveEntities[spectateTargetIndex];
                    if (target) {
                        gameCam.position.x += (target.x - gameCam.position.x) * 0.08;
                        gameCam.position.z += ((target.y + 240) - gameCam.position.z) * 0.08;
                        gameCam.position.y = 420; gameCam.lookAt(target.x, 0, target.y);
                    }
                } else {
                    gameCam.position.x += (0 - gameCam.position.x) * 0.08;
                    gameCam.position.z += (300 - gameCam.position.z) * 0.08;
                    gameCam.position.y = 500; gameCam.lookAt(0, 0, 0);
                }
            }

            // 상태 표시 UI 업데이트
            const statusText = document.getElementById('status-text');
            if (statusText && gamePhase === 'playing' && player) {
                if (!player.isAlive) { statusText.innerHTML = "💀 SPECTATING - Click VIEW button to switch targets!"; statusText.style.color = "#ef4444"; } 
                else if (player.isDashing) { statusText.innerHTML = "⚡ DASHING!"; statusText.style.color = "#f59e0b"; } 
                else { statusText.innerHTML = gameMode === 'quick' ? "Survive as long as you can!" : "Last one standing wins!"; statusText.style.color = "#f8fafc"; }
            }

            // 랭킹 리스트 업데이트
            let rankListElem = document.getElementById('rank-list');
            if (rankListElem) {
                let rankHTML = '';
                if (gameMode === 'quick') {
                    let rankData = entities.map(e => ({ name: e.name, time: e.survivalTime || 0, color: e.bladeColor1 }));
                    rankData.sort((a, b) => b.time - a.time);
                    rankData.forEach(r => { rankHTML += `<div class="rank-item"><span>⭐ <span style="color:${r.color}">${r.name}</span></span><span>${r.time}s</span></div>`; });
                } else {
                    entities.forEach((e) => {
                        let status = e.isAlive ? '<span style="color:#10b981">Alive</span>' : '<span style="color:#ef4444">Out</span>';
                        rankHTML += `<div class="rank-item"><span>⭐ <span style="color:${e.bladeColor1}">${e.name}</span></span><span>${status}</span></div>`; 
                    });
                }
                rankListElem.innerHTML = rankHTML;
            }

            gameRenderer.clear(); gameRenderer.render(gameScene, gameCam); gameRenderer.clearDepth(); gameRenderer.render(beybladeScene, gameCam);
        }
    } catch (err) { console.error("Game loop error:", err); }
    requestAnimationFrame(gameLoop);
}

function showResults() {
    let html = '';
    eliminationOrder.forEach((ent, idx) => {
        let badge = idx === 0 ? '👑 1st' : `${idx + 1}th`;
        html += `<div style="display:flex; justify-content:space-between; font-size:12px; padding:5px 0; border-bottom:1px solid #334155; font-weight:bold;">
            <span>${badge} - <span style="color:${ent.bladeColor1}">${ent.name}</span></span><span>${idx === 0 ? '🏆 WINNER' : 'Eliminated'}</span>
        </div>`;
    });
    let resultList = document.getElementById('result-rank-list'); if (resultList) resultList.innerHTML = html;

    let resultRoomInfo = document.getElementById('result-room-info'), resultChatBox = document.getElementById('result-chat-box'), replayBtn = document.getElementById('replay-btn');
    if (gameMode === 'private') {
        if (resultRoomInfo) { resultRoomInfo.style.display = 'block'; document.getElementById('result-room-code').innerText = currentRoomCode; }
        if (resultChatBox) resultChatBox.style.display = 'flex';
        if (replayBtn) replayBtn.style.display = isHost ? 'block' : 'none';
    } else {
        if (resultRoomInfo) resultRoomInfo.style.display = 'none';
        if (resultChatBox) resultChatBox.style.display = 'none';
        if (replayBtn) replayBtn.style.display = 'none';
    }
    let resModal = document.getElementById('result-modal'); if (resModal) resModal.style.display = 'flex';
}

window.restartCurrentGame = function() {
    document.getElementById('result-modal').style.display = 'none';
    if (gameMode === 'private') {
        if (isHost && roomRef) {
            roomRef.child('gameStates').remove().then(() => { roomRef.update({ status: 'playing' }); });
        }
    } else { startQuickGame(); }
};

window.returnToLobby = function() {
    gameStarted = false; gamePhase = 'waiting'; roomStatus = 'waiting';
    if (roomRef) { roomRef.child('players/' + mySessionId).remove(); roomRef.child('gameStates/' + mySessionId).remove(); roomRef.off(); }
    if (publicRoomRef) { publicRoomRef.child('players/' + mySessionId).remove(); publicRoomRef.child('gameStates/' + mySessionId).remove(); }
    
    document.getElementById('game-ui').style.display = 'none';
    document.getElementById('result-modal').style.display = 'none';
    gameRenderer.domElement.style.display = 'none';
    document.getElementById('lobby-screen').style.display = 'flex';
    
    entityMeshes.forEach(bm => { if (bm) beybladeScene.remove(bm); }); entityMeshes = [];
    entityTrails.forEach(t => { if (t && t.mesh) beybladeScene.remove(t.mesh); }); entityTrails = [];
    activeSparks.forEach(s => { if (s && s.mesh) beybladeScene.remove(s.mesh); }); activeSparks = [];
};

window.addEventListener('resize', () => { gameCam.aspect = window.innerWidth / window.innerHeight; gameCam.updateProjectionMatrix(); gameRenderer.setSize(window.innerWidth, window.innerHeight); });

gameLoop();