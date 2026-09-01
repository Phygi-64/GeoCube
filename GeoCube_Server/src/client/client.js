// --- GLOBALS & STATE ---
let scene, camera, renderer;

if (!window.isApp) {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB);
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 0.9, 0);
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);
} else {
    // Empty objects to avoid errors in app mode
    scene = { add: () => {}, remove: () => {} };
    camera = { 
        position: { set: () => {}, x: 0, y: 0, z: 0, clone: () => ({ add: () => ({ floor: () => ({ addScalar: () => {} }) }) }), add: () => {} }, 
        quaternion: { setFromEuler: () => {} },
        aspect: 1,
        updateProjectionMatrix: () => {}
    };
    renderer = { render: () => {}, setSize: () => {} };
}

const ASSET_PREFIX = 'assets/textures/';
const loader = new THREE.TextureLoader();
function loadTex(f) {
    const t = loader.load(ASSET_PREFIX + f);
    t.magFilter = THREE.NearestFilter;
    return t;
}

const blockToImage = {
    grass: 'herbe.jpg', herbe: 'herbe.jpg',
    wood: 'wood_side.jpg', bois: 'wood_side.jpg', wood_side: 'wood_side.jpg',
    stone: 'stone.jpg', pierre: 'stone.jpg',
    sand: 'sable.png', sable: 'sable.png',
    neige: 'neige.png', snow: 'neige.png',
    brick: 'Brick.png', Brick: 'Brick.png', brique: 'Brick.png',
    glass: 'glass.png', verre: 'glass.png',
    emerald: 'emeraude.png', emeraude: 'emeraude.png',
    sapphire: 'saphir.png', saphir: 'saphir.png',
    ruby: 'rubis.png', rubis: 'rubis.png',
    obsidienne: 'obsidienne.png',
    gold: 'Gold.png', or: 'Gold.png', Gold: 'Gold.png',
    diamond: 'diamond.png', diamant: 'diamond.png'
};


const textures = {};
for (const type in blockToImage) {
    textures[type] = loadTex(blockToImage[type]);
}

// Special texture for the floor to allow tiling without affecting blocks
const floorTex = loadTex('herbe.jpg');
floorTex.wrapS = THREE.RepeatWrapping; 
floorTex.wrapT = THREE.RepeatWrapping;
floorTex.repeat.set(100, 100);



let isGameActive = false, isSoloMode = false, isInventoryOpen = false, isPauseMenuOpen = false, isSettingsOpen = false, isQuestMenuOpen = false, isChatOpen = false;
let isFlying = false;
let isAdmin = false;
let selectedSlot = 0;
let coins = 0;
let myCards = { blocks: {}, skins: ['#ff0000'] };
let hasLoadedData = false;


const rarities = {
    grass: 'commun', herbe: 'commun', wood: 'commun', bois: 'commun', stone: 'commun', pierre: 'commun',
    sand: 'commun', sable: 'commun', neige: 'commun', snow: 'commun',
    brick: 'rare', glass: 'rare', emerald: 'rare', emeraude: 'rare', sapphire: 'rare',
    ruby: 'epique', obsidienne: 'epique', gold: 'epique', diamond: 'epique'
};
const regenDelay = { commun: 300, rare: 3600, epique: 14400 }; // s (5m, 1h, 4h)


const inventory = new Array(36).fill(null);
let pickedUpItem = null;
const objectsToIntersect = [];
const stats = { 
    distance: 0, 
    blocksPlaced: 0, 
    blocksCollected: 0, 
    blocksDestroyed: 0,
    byType: {
        wood: 0, stone: 0, diamond: 0, gold: 0, obsidienne: 0, emeraude: 0, brick: 0, glass: 0
    }
};
const claimedQuests = {};

const moveState = { w: false, s: false, a: false, d: false, space: false };
const euler = new THREE.Euler(0, 0, 0, 'YXZ');
let velocity = new THREE.Vector3();
let clickerData = {
    total: 0,
    buildings: { pioche: 0, steve: 0, four: 0, mine: 0, villageois: 0, golem: 0, cite: 0, dragon: 0 }
};

const BUILDING_INFO = {
    pioche: { name: "PIOCHE", cost: 15, cps: 0.1, color: "#9e9e9e" },
    steve: { name: "STEVE", cost: 100, cps: 1, color: "#4caf50" },
    four: { name: "FOUR", cost: 1100, cps: 8, color: "#ff9800" },
    mine: { name: "MINE", cost: 12000, cps: 47, color: "#2196f3" },
    villageois: { name: "VILLAGEOIS", cost: 130000, cps: 260, color: "#9c27b0" },
    golem: { name: "GOLEM FER", cost: 750000, cps: 1200, color: "#cfd8dc" },
    cite: { name: "CITÉ D'OR", cost: 4000000, cps: 7500, color: "#ffeb3b" },
    dragon: { name: "DRAGON NÉANT", cost: 25000000, cps: 52000, color: "#673ab7" }
};

const defaultPort = '30001';
const isAppMode = window.isApp;
const defaultHost = isAppMode ? 'geocube.duckdns.org' : window.location.hostname;

/** Options Socket.IO : polling d'abord (WebView Android) puis upgrade websocket ; évite le blocage mixed-content si scheme HTTPS. */
function getSocketIoOptions() {
    return {
        transports: ['polling', 'websocket'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: Infinity,
        timeout: 45000,
        pingTimeout: 60000,
        pingInterval: 25000
    };
}

let socket = (typeof io !== 'undefined') ? io(`http://${defaultHost}:${defaultPort}`, getSocketIoOptions()) : null;

// Register handlers immediately so we don't miss early events
if (socket) setupSocketHandlers();

/** Évite sync avant que checkAuth ait décidé (sinon mauvaises données hors-ligne). */
let skipSyncUntilAuthReady = true;
let connectDeferredSync = false;

/** joinGame doit être envoyé après connexion réelle — sinon le serveur ne reçoit rien au 1er essai. */
let pendingJoinPayload = null;

function getOfflineStorageKey() {
    const u = localStorage.getItem('geocube_username');
    return u ? `geocube_offline_data_${u.replace(/[^a-zA-Z0-9]/g, '_')}` : 'geocube_offline_data_guest';
}

function readLocalOfflineData() {
    const k = getOfflineStorageKey();
    let raw = localStorage.getItem(k);
    if (!raw && k !== 'geocube_offline_data_guest') {
        raw = localStorage.getItem('geocube_offline_data');
    }
    const defaultClicker = { total: 0, buildings: { pioche: 0, steve: 0, four: 0, mine: 0, villageois: 0, golem: 0, cite: 0, dragon: 0 } };
    if (!raw) return { coins: 0, clicker: JSON.parse(JSON.stringify(defaultClicker)) };
    try {
        const p = JSON.parse(raw);
        if (!p.clicker) p.clicker = JSON.parse(JSON.stringify(defaultClicker));
        return p;
    } catch (e) {
        return { coins: 0, clicker: JSON.parse(JSON.stringify(defaultClicker)) };
    }
}

// Persistent Local State (Offline First), par pseudo
let localData = readLocalOfflineData();

function saveLocal() {
    localStorage.setItem(getOfflineStorageKey(), JSON.stringify(localData));
}

function getPersistedStoragePrefix() {
    const u = localStorage.getItem('geocube_username') || 'guest';
    return 'geocube_' + u.replace(/[^a-zA-Z0-9]/g, '_') + '_';
}

window.resetClientStateForUserSwitch = function() {
    console.log("[RESET] Resetting client state for account change...");
    hasLoadedData = false;
    coins = 0;
    clickerData = { total: 0, buildings: { pioche: 0, steve: 0, four: 0, mine: 0, villageois: 0, golem: 0, cite: 0, dragon: 0 } };
    localData = { coins: 0, clicker: JSON.parse(JSON.stringify(clickerData)) };
    myCards = { blocks: {}, skins: ['#ff0000'] };
    for (let i = 0; i < 36; i++) inventory[i] = null;
    stats.distance = 0;
    stats.blocksPlaced = 0;
    stats.blocksCollected = 0;
    stats.blocksDestroyed = 0;
    Object.keys(stats.byType).forEach(k => { stats.byType[k] = 0; });
    for (const k in claimedQuests) delete claimedQuests[k];
    
    // Clear inventory display if it exists
    const grid = document.getElementById('main-inventory-grid');
    if (grid) grid.innerHTML = '';
    
    updateCoinsUI();
    updateHotbarUI();
    updateClickerUI();
};

/** Appelé depuis index.html après enregistrement des identifiants (changement de compte = reset). */
window.onCredentialsChanged = function (newUser) {
    const prev = window._lastKnownUsername;
    if (prev !== newUser) {
        window.resetClientStateForUserSwitch();
    }
    window._lastKnownUsername = newUser;
    localData = readLocalOfflineData();
    updateCoinsUI();
    updateClickerUI();
};

window.syncLastKnownUsernameFromCheck = function (u) {
    window._lastKnownUsername = u;
};

function flushPendingJoin() {
    if (!pendingJoinPayload || !socket) return;
    socket.emit('joinGame', pendingJoinPayload);
    pendingJoinPayload = null;
}

/** Appelé depuis checkAuth quand il n'y a pas de compte (sync hors-ligne une fois le socket prêt). */
window.finishGuestAuthCheck = function () {
    skipSyncUntilAuthReady = false;
    if (connectDeferredSync && socket && socket.connected && !pendingJoinPayload) {
        connectDeferredSync = false;
        if (!hasLoadedData) {
            coins = localData.coins;
            clickerData = localData.clicker;
            updateClickerUI();
            updateCoinsUI();
        }
        socket.emit('syncOfflineData', localData);
    }
};


// --- INITIAL WORLD ---
const floor = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshLambertMaterial({ map: floorTex }));
floor.rotation.x = -Math.PI / 2;

scene.add(floor);
objectsToIntersect.push(floor);
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const dirLight = new THREE.DirectionalLight(0xffffff, 0.5); dirLight.position.set(10, 20, 10); scene.add(dirLight);

// --- UI EXPORTS ---
// UI Sub-menus are handled in index.html

window.guiShowSettingsMenu = function () {
    isSettingsOpen = true; document.getElementById('settings-menu').style.display = 'flex';
    if (isPauseMenuOpen) document.getElementById('pause-menu').style.display = 'none';
    window.showTab('controls');
    syncMobileHudVisibility();
};

window.guiCloseSettingsMenu = function () {
    isSettingsOpen = false; document.getElementById('settings-menu').style.display = 'none';
    if (isGameActive && isPauseMenuOpen) document.getElementById('pause-menu').style.display = 'flex';
    syncMobileHudVisibility();
};

window.showTab = function (tab) {
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    const content = document.getElementById(tab + '-tab');
    if (content) content.classList.add('active');
    document.getElementById('tab-' + tab + '-btn')?.classList.add('active');
};

window.toggleCommands = function () {
    const el = document.getElementById('commands-overlay');
    el.style.display = (el.style.display === 'none') ? 'block' : 'none';
    if (!el.querySelector('.cmd-info')) {
        const info = document.createElement('div');
        info.className = 'cmd-info';
        info.style.color = '#ccc'; info.style.fontSize = '8px'; info.style.lineHeight = '2';
        info.innerHTML = `Z/Q/S/D : Bouger | ESPACE : Sauter | SOURIS : Regarder<br>CLIC GAUCHE : Casser | CLIC DROIT : Poser | E : Inventaire<br>ENTRÉE : Chat | Q : Quêtes | ² : Menu/Retour`;
        el.insertBefore(info, el.lastChild);
    }
};

window.setGameMode = function (mode) {
    isSoloMode = (mode !== 'multi');
    document.getElementById('play-options-container').style.display = 'block';
    const serverSect = document.getElementById('server-section');
    const multiAuth = document.getElementById('multi-auth-fields');
    const localAuth = document.getElementById('local-auth-fields');
    const desc = document.getElementById('mode-description');
    if (mode === 'multi') {
        serverSect.style.display = 'block'; multiAuth.style.display = 'block'; localAuth.style.display = 'none';
        desc.innerText = "Rejoins le serveur multijoueur.";
    } else {
        serverSect.style.display = 'none'; multiAuth.style.display = 'none'; localAuth.style.display = 'block';
        desc.innerText = mode === 'solo' ? "Mode Créatif." : "Mode Aventure (Survie).";
    }
};
// Hook to update socket when server changes
if (document.getElementById('server-select') && !window._serverSelectHooked) {
    window._serverSelectHooked = true;
    document.getElementById('server-select').addEventListener('change', (e) => {
        const port = e.target.value;
        if (port === 'custom') return;
        if (socket) socket.disconnect();
        socket = io('http://' + defaultHost + ':' + port, getSocketIoOptions());
        setupSocketHandlers();
        // Request menuOnly auth on the new server to load correct coins/cards
        const u = localStorage.getItem('geocube_username');
        const p = localStorage.getItem('geocube_password');
        if(u && p) {
            socket.emit('joinGame', { username: u, password: p, menuOnly: true });
        }
    });
}


window.startBtnAction = function () {
    const pseudo = localStorage.getItem('geocube_username') || "Joueur";
    const password = localStorage.getItem('geocube_password') || "";
    const type = localStorage.getItem('geocube_auth_type') || "login";
    
    let host = window.isApp ? 'geocube.duckdns.org' : window.location.hostname;
    let port = document.getElementById('server-select').value;
    
    if (port === 'custom') {
        const customVal = document.getElementById('server-custom-ip').value.trim();
        if (customVal) {
            if (customVal.includes(':')) {
                const parts = customVal.split(':'); host = parts[0]; port = parts[1];
            } else {
                host = customVal; port = '30000';
            }
        }
    }

    if (socket) socket.disconnect();
    const finalPort = (port === 'custom' || !port) ? '30000' : port;
    pendingJoinPayload = {
        username: pseudo,
        password: password,
        type: type,
        color: document.getElementById('color-input').value,
        menuOnly: false
    };
    socket = io(`http://${host}:${finalPort}`, getSocketIoOptions());
    setupSocketHandlers();
    if (socket.connected) flushPendingJoin();
};

window.verifyCredentials = function (type) {
    skipSyncUntilAuthReady = false;
    // In app mode, always connect to the fixed server
    let host = window.isApp ? 'geocube.duckdns.org' : window.location.hostname;
    let port = '30000';

    if (!window.isApp) {
        // Only allow custom server on web
        const sel = document.getElementById('server-select');
        if (sel) port = sel.value;
        if (port === 'custom') {
            const customVal = document.getElementById('server-custom-ip').value.trim();
            if (customVal) {
                if (customVal.includes(':')) {
                    const parts = customVal.split(':'); host = parts[0]; port = parts[1];
                } else {
                    host = customVal; port = '30000';
                }
            }
        }
        if (port === 'custom' || !port) port = '30000';
    }

    const pseudo = localStorage.getItem('geocube_username');
    const password = localStorage.getItem('geocube_password');
    if (!pseudo || !password) return;
    if (socket) socket.disconnect();
    pendingJoinPayload = {
        username: pseudo,
        password: password,
        type: type || 'login',
        color: '#ff0000',
        menuOnly: true
    };
    socket = io(`http://${host}:${port}`, getSocketIoOptions());
    setupSocketHandlers();
    if (socket.connected) flushPendingJoin();
};

// Note: Auto-auth is handled by checkAuth() in index.html → handleAuth() → verifyCredentials()

function requestPointerLockIfDesktop() {
    if (!window.isMobileGame) document.body.requestPointerLock();
}

function tryLockGameLandscape() {
    if (!window.isMobileGame) return;
    const lock = () => {
        if (screen.orientation && screen.orientation.lock) {
            screen.orientation.lock('landscape').catch(() => {});
        }
    };
    lock();
    setTimeout(lock, 400);
}

function syncMobileHudVisibility() {
    if (!window.isMobileGame) return;
    const hud = document.getElementById('mobile-game-hud');
    const mc = document.getElementById('mobile-controls');
    if (!hud || !mc) return;
    const blocker = isPauseMenuOpen || isInventoryOpen || isQuestMenuOpen || isChatOpen || isSettingsOpen;
    if (!isGameActive) {
        hud.style.display = 'none';
        mc.style.display = 'none';
        return;
    }
    const show = !blocker;
    hud.style.display = show ? 'block' : 'none';
    mc.style.display = show ? 'flex' : 'none';
}

function applyMobileGameHudIfNeeded() {
    if (!window.isMobileGame) return;
    tryLockGameLandscape();
    updateCoinsUI();
    syncMobileHudVisibility();
}

window.startNewWorld = function () {
    isSoloMode = true; isGameActive = true;
    // Clear existing blocks
    objectsToIntersect.filter(o => o !== floor).forEach(o => scene.remove(o));
    objectsToIntersect.length = 0;
    objectsToIntersect.push(floor);
    
    ['auth-screen', 'login-screen', 'profile-corner'].forEach(id => {
        const el = document.getElementById(id); if (el) el.style.display = 'none';
    });
    const topHud = document.getElementById('top-corner-ui');
    if (topHud) topHud.style.display = 'flex';
    document.body.classList.add('game-active');
    document.getElementById('game-ui').style.display = 'block';
    inventory.fill(null);
    updateHotbarUI();
    applyMobileGameHudIfNeeded();
    requestPointerLockIfDesktop();
};


window.togglePauseMenu = function () {
    isPauseMenuOpen = !isPauseMenuOpen;
    document.getElementById('pause-menu').style.display = isPauseMenuOpen ? 'flex' : 'none';
    syncMobileHudVisibility();
    if (!isPauseMenuOpen) requestPointerLockIfDesktop();
    else document.exitPointerLock();
};

window.returnToMainMenu = function () {
    location.reload();
};

// --- QUESTS LOGIC ---
const dailyQuests = [
    { id: 'daily_wood', desc: "Récolte 50 bois aujourd'hui", target: 50, type: 'wood', reward: { type: 'diamond', count: 5 } },
    { id: 'daily_stone', desc: "Récolte 100 pierre aujourd'hui", target: 100, type: 'stone', reward: { type: 'gold', count: 10 } },
    { id: 'daily_dist', desc: "Parcours 2000m aujourd'hui", target: 2000, type: 'dist', reward: { type: 'obsidienne', count: 20 } },
    { id: 'daily_build', desc: "Pose 50 blocs aujourd'hui", target: 50, type: 'build', reward: { type: 'emerald', count: 8 } }
];

let currentDaily = null;
function initDailyQuest() {
    const day = new Date().getDate();
    const month = new Date().getMonth();
    const seed = day + month;
    currentDaily = dailyQuests[seed % dailyQuests.length];
    const descEl = document.getElementById('daily-quest-desc');
    if (descEl) descEl.innerText = currentDaily.desc;
}
initDailyQuest();

window.claimDailyQuest = function() {
    if (!currentDaily) return;
    const btn = document.getElementById('quest-daily-btn');
    if (btn && !btn.hasAttribute('disabled')) {
        addCoins(currentDaily.reward.count * 10);
        btn.setAttribute('disabled', 'true');
        btn.innerText = "RÉCUPÉRÉ";
        claimedQuests['daily_' + new Date().toDateString()] = true;
        alert(`Félicitations ! Tu as reçu ${currentDaily.reward.count * 10} 🪙 !`);
        saveData();
    }

};

window.claimQuest = function(type) {
    const rewards = {
        build_10: { count: 50 },
        build_50: { count: 100 },
        build_100: { count: 200 },
        build_250: { count: 500 },
        build_500: { count: 1000 },
        dist: { count: 150 }
    };
    const reward = rewards[type];
    if (!reward) return;
    const btn = document.getElementById(`quest-${type}-btn`);
    if (btn && !btn.hasAttribute('disabled')) {
        addCoins(reward.count);
        btn.setAttribute('disabled', 'true');
        btn.innerText = "RÉUSSI";
        claimedQuests[type] = true;
        alert(`Bâtisseur de génie ! Voici ${reward.count} 🪙.`);
        saveData();
    }

};

function addCoins(amount) {
    coins += amount;
    updateCoinsUI();
    saveData();
}

function updateCoinsUI() {
    const el = document.getElementById('coin-count');
    if (el) el.innerText = coins;
    const m = document.getElementById('mobile-hud-coin-count');
    if (m) m.innerText = coins;
    // Local copy for offline sync
    localData.coins = coins;
    saveLocal();
}

function addToInventory(type, count) {
    // 1. If it's a known card, update stock
    if (myCards.blocks[type]) {
        myCards.blocks[type].count += count;
        updateMenuInventoryCardsUI();
    } else {
        // 2. Otherwise, find in inventory slots
        let found = false;
        for (let i = 0; i < inventory.length; i++) {
            if (inventory[i] && inventory[i].type === type && !inventory[i].isCard) {
                inventory[i].count += count;
                found = true;
                break;
            }
        }
        // 3. If not found, add to first empty slot
        if (!found) {
            let idx = inventory.findIndex(slot => !slot);
            if (idx !== -1) {
                inventory[idx] = { type: type, count: count, isCard: false };
            }
        }
    }
    
    saveData();
    updateHotbarUI();
    if (isInventoryOpen) updateInventoryUI();
}



window.claimStarterKit = function () {
    inventory[1] = { type: 'stone', count: 64 };
    inventory[2] = { type: 'wood', count: 64 };
    inventory[3] = { type: 'glass', count: 32 };
    updateHotbarUI();
    document.getElementById('quest-claim-btn').setAttribute('disabled', 'true');
    claimedQuests['starter'] = true;
    saveData();
};



window.downloadSave = function () {
    const blocks = objectsToIntersect.filter(o => o !== floor).map(o => ({ x: o.position.x, y: o.position.y, z: o.position.z, type: o.userData.type }));
    const data = JSON.stringify({ blocks });
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'geocube_world.json'; a.click();
};

window.loadWorldFromFile = function (el) {
    const file = el.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const data = JSON.parse(e.target.result);
        if (data.blocks) data.blocks.forEach(b => createBlockMesh(b.x, b.y, b.z, b.type));
        window.startNewWorld();
    };
    reader.readAsText(file);
};

// --- GAMEPLAY MAPPING ---
function createBlockMesh(x, y, z, type) {
    const mat = new THREE.MeshLambertMaterial({ map: textures[type] || textures.stone });
    if (type === 'glass') { mat.transparent = true; mat.opacity = 0.6; }
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
    mesh.position.set(x, y, z); mesh.userData.type = type;
    scene.add(mesh); objectsToIntersect.push(mesh);
}

const raycaster = new THREE.Raycaster();
document.addEventListener('mousedown', (e) => {
    if (!isGameActive || isInventoryOpen || isPauseMenuOpen || isSettingsOpen || isQuestMenuOpen || isChatOpen) return;
    if (document.pointerLockElement !== document.body) return;
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const hits = raycaster.intersectObjects(objectsToIntersect);
    if (hits.length > 0) {
        const hit = hits[0];
        if (e.button === 0 && hit.object !== floor) {
            const type = hit.object.userData.type;
            scene.remove(hit.object); objectsToIntersect.splice(objectsToIntersect.indexOf(hit.object), 1);
            stats.blocksDestroyed++; stats.blocksCollected++;
            if (stats.byType[type] !== undefined) stats.byType[type]++;
            
            // Re-gain card stock
            addToInventory(type, 1);
            
            document.getElementById('stats-destroyed').innerText = `Détruits: ${stats.blocksDestroyed}`;
            document.getElementById('stats-collected').innerText = `Collectés: ${stats.blocksCollected}`;
            if (!isSoloMode && socket) socket.emit('removeBlock', { x: hit.object.position.x, y: hit.object.position.y, z: hit.object.position.z });
        } else if (e.button === 2) {
            const slotItem = inventory[selectedSlot];
            if (slotItem) {
                if (slotItem.isCard) {
                    const card = myCards.blocks[slotItem.type];
                    if (card && card.count > 0) {
                        const nextPos = hit.point.clone().add(hit.face.normal.clone().multiplyScalar(0.5)).floor().addScalar(0.5);
                        if (hit.object === floor) nextPos.y = Math.max(nextPos.y, 0.5);
                        if (!checkCollision(nextPos)) {
                            createBlockMesh(nextPos.x, nextPos.y, nextPos.z, slotItem.type);
                            card.count--;
                            if (card.count <= 0) {
                                inventory[selectedSlot] = null; // Auto-unequip if empty
                            }
                            if (card.count < card.max && card.nextRegen === 0) {
                                const rarity = rarities[slotItem.type] || 'commun';
                                card.nextRegen = Date.now() + (regenDelay[rarity] * 1000);
                            }
                            stats.blocksPlaced++;
                            document.getElementById('stats-build').innerText = `Blocs: ${stats.blocksPlaced}`;
                            if (!isSoloMode && socket) socket.emit('placeBlock', { x: nextPos.x, y: nextPos.y, z: nextPos.z, type: slotItem.type });
                            updateHotbarUI();
                            saveData();
                        }
                    } else {
                        inventory[selectedSlot] = null; // Gone if 0
                        updateHotbarUI();
                    }

                } else {
                    // It's a real block (e.g. from quest)
                    if (slotItem.count > 0) {
                        const nextPos = hit.point.clone().add(hit.face.normal.clone().multiplyScalar(0.5)).floor().addScalar(0.5);
                        if (hit.object === floor) nextPos.y = Math.max(nextPos.y, 0.5);
                        if (!checkCollision(nextPos)) {
                            createBlockMesh(nextPos.x, nextPos.y, nextPos.z, slotItem.type);
                            slotItem.count--;
                            if (slotItem.count <= 0) {
                                inventory[selectedSlot] = null; // DISAPPEAR if no more blocks
                            }
                            stats.blocksPlaced++;
                            document.getElementById('stats-build').innerText = `Blocs: ${stats.blocksPlaced}`;
                            if (!isSoloMode && socket) socket.emit('placeBlock', { x: nextPos.x, y: nextPos.y, z: nextPos.z, type: slotItem.type });
                            updateHotbarUI();
                            saveData();
                        }
                    }
                }
            }

        }


    }
});

// --- INVENTORY ---
function updateHotbarUI() {
    for (let i = 0; i < 9; i++) {
        const el = document.getElementById(`slot-${i}`); if (!el) continue;
        el.className = 'slot' + (i === selectedSlot ? ' selected' : '');
        el.innerHTML = '';
        if (inventory[i]) {
            const item = inventory[i];
            const type = item.type;
            const card = item.isCard ? myCards.blocks[type] : null;

            // Cleanup if 0 or missing card
            if (item.isCard && (!card || card.count <= 0)) { inventory[i] = null; continue; }
            if (!item.isCard && item.count <= 0) { inventory[i] = null; continue; }


            const img = document.createElement('img');
            img.src = ASSET_PREFIX + (blockToImage[type] || 'stone.jpg');
            el.appendChild(img);
            
            const span = document.createElement('span'); 
            if (item.isCard) {
                span.innerText = card ? card.count : 0;
                span.style.color = '#ffeb3b';
            } else {
                span.innerText = item.count;
            }
            el.appendChild(span);
        }




    }
}

function updateInventoryUI() {
    const grid = document.getElementById('main-inventory-grid');
    const hb = document.getElementById('inventory-hotbar-copy');
    grid.innerHTML = ''; hb.innerHTML = '';
    
    const createSlot = (i) => {
        const d = document.createElement('div'); d.className = 'slot';
        d.onclick = () => {
            if (!pickedUpItem) { if (inventory[i]) { pickedUpItem = inventory[i]; inventory[i] = null; } }
            else { if (inventory[i]?.type === pickedUpItem.type && !inventory[i].infinite && !pickedUpItem.infinite) { inventory[i].count += pickedUpItem.count; pickedUpItem = null; } else { const t = inventory[i]; inventory[i] = pickedUpItem; pickedUpItem = t; } }
            updateHotbarUI(); updateInventoryUI(); updateMouseItem(); saveData();
        };

        if (inventory[i]) {
            const item = inventory[i];
            const type = item.type;
            const card = item.isCard ? myCards.blocks[type] : null;

            // Cleanup if 0 or missing card
            if (item.isCard && (!card || card.count <= 0)) { inventory[i] = null; return d; }
            if (!item.isCard && item.count <= 0) { inventory[i] = null; return d; }


            const img = document.createElement('img');
            img.src = ASSET_PREFIX + (blockToImage[type] || 'stone.jpg');
            d.appendChild(img);
            
            const span = document.createElement('span'); 
            if (item.isCard) {
                span.innerText = card ? card.count : 0;
                span.style.color = '#ffeb3b'; // Highlight card usage
            } else {
                span.innerText = item.count;
            }
            d.appendChild(span);
        }




        return d;
    };
    for (let i = 9; i < 36; i++) grid.appendChild(createSlot(i));
    for (let i = 0; i < 9; i++) hb.appendChild(createSlot(i));
}

function updateMenuInventoryCardsUI() {
    const cblocks = document.getElementById('menu-inventory-cards-blocks');
    const cskins = document.getElementById('menu-inventory-cards-skins');
    if (!cblocks || !cskins) return;

    cblocks.innerHTML = ''; cskins.innerHTML = '';

    Object.keys(myCards.blocks).forEach(b => {
        const data = myCards.blocks[b];
        let label = `${data.count}/${data.max}`;
        if (data.count === 0 && data.nextRegen > 0) {
             const left = Math.ceil((data.nextRegen - Date.now()) / 1000);
             if (left > 0) {
                 const h = Math.floor(left / 3600);
                 const m = Math.floor((left % 3600) / 60);
                 const s = left % 60;
                 label = h > 0 ? `${h}h ${m}m` : `${m}m ${s}s`;
             }
        }
        
        const el = createCardElement(b, false, '120px', label); // Bigger card
        el.style.flexShrink = '0';
        el.style.position = 'relative';
        el.style.flexDirection = 'column';
        el.style.height = 'auto';
        if (data.count === 0) el.style.opacity = '0.5';

        const equipBtn = document.createElement('button');
        equipBtn.className = 'pixel-btn';
        equipBtn.innerText = 'ÉQUIPER';
        equipBtn.style.fontSize = '8px';
        equipBtn.style.padding = '5px';
        equipBtn.style.marginTop = '10px';
        equipBtn.onclick = (e) => {
            e.stopPropagation();
            // assign to first empty slot or find better logic
            let idx = inventory.findIndex(slot => !slot);
            if (idx === -1) idx = 0; // replace first if full
            inventory[idx] = { type: b, isCard: true };

            alert(`Bloc ${b} équipé dans l'emplacement ${idx + 1} !`);
            updateInventoryUI();
            updateHotbarUI();
            saveData();
        };
        el.appendChild(equipBtn);

        cblocks.appendChild(el);
    });


    
    myCards.skins.forEach(s => {
        const el = createCardElement(s, true, '100px');
        el.style.flexShrink = '0';
        el.style.cursor = 'pointer';
        el.onclick = () => {
            document.getElementById('color-input').value = s;
            playerColor = s;
            saveData();
            // update running game
            if (isGameActive && socket) {
                socket.emit('playerMoved', { x: camera.position.x, y: camera.position.y, z: camera.position.z,  color: s}); 
            }
            alert('Apparence appliquée !');
            updateMenuInventoryCardsUI(); // refresh highlight if needed
        };

        cskins.appendChild(el);
    });
}

function updateMouseItem() {
    const m = document.getElementById('picked-item-mouse');
    if (!pickedUpItem) { m.style.display = 'none'; return; }
    m.style.display = 'flex'; m.innerHTML = '';
    const img = document.createElement('img');
    img.src = ASSET_PREFIX + (blockToImage[pickedUpItem.type] || 'stone.jpg');
    m.appendChild(img);
    const span = document.createElement('span'); span.innerText = pickedUpItem.infinite ? '∞' : pickedUpItem.count; m.appendChild(span);

}

// Cards / Shop logic
function createCardElement(type, isSkin=false, size='50px', countLabel='', transparent = false) {
    const d = document.createElement('div');
    d.className = 'slot';
    d.style.width = size;
    d.style.height = size;
    if (transparent) d.style.background = 'none';
    if (isSkin) {
        d.style.background = type;
        d.style.border = '2px solid #fff';
        d.style.borderRadius = '50%';
    } else {
        const img = document.createElement('img');
        img.src = ASSET_PREFIX + (blockToImage[type] || 'stone.jpg');
        d.appendChild(img);
    }

    if (countLabel) {
        const span = document.createElement('span'); span.innerText = countLabel; d.appendChild(span);
    }
    return d;
}

window.adminGiveCoins = function() {
    const amount = parseInt(document.getElementById('admin-coins-amount').value) || 0;
    addCoins(amount);
    saveData();
    alert(`Ajout de ${amount} pièces !`);
};

window.adminGiveAllBlocks = function() {
    BLOCK_POOL.forEach(b => {
        const r = rarities[b] || 'commun';
        const amt = (r === 'commun' ? 64 : (r === 'rare' ? 16 : 8));
        myCards.blocks[b] = { count: amt, max: amt, nextRegen: 0 };
    });
    saveData();
    updateMenuInventoryCardsUI();
    alert("Tous les blocs débloqués (quantités normales) !");
};




window.adminGiveAllSkins = function() {
    myCards.skins = [...SKIN_POOL];
    saveData();
    updateMenuInventoryCardsUI();
    alert("Tous les skins débloqués !");
};

// --- CLICKER FUNCTIONS ---
window.handleLogoClick = function(event) {
    console.log("[CLICKER] Logo cliqué !");
    clickerData.total++;
    localData.clicker.total = clickerData.total;
    saveLocal();

    const logo = document.getElementById('clicker-cube');
    if (logo) {
        logo.style.transform = 'scale(0.9)';
        setTimeout(() => logo.style.transform = 'scale(1)', 50);
    }
    // ... rest of floating text logic

    // Cookie Clicker style floating text
    if (event) {
        spawnFloatingText(event.clientX, event.clientY, "+1");
    }

    updateClickerUI();
};

function spawnFloatingText(x, y, text) {
    const el = document.createElement('div');
    el.innerText = text;
    el.style.position = 'fixed';
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.color = '#4caf50';
    el.style.fontFamily = "'Press Start 2P'";
    el.style.fontSize = '20px';
    el.style.pointerEvents = 'none';
    el.style.zIndex = '3000';
    el.style.textShadow = '2px 2px #000';
    el.style.animation = 'floatUp 1s forwards';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1000);
}

// Add CSS for floating text animation if not present
if (!document.getElementById('clicker-styles')) {
    const style = document.createElement('style');
    style.id = 'clicker-styles';
    style.innerHTML = `
        @keyframes floatUp {
            0% { transform: translateY(0); opacity: 1; }
            100% { transform: translateY(-100px); opacity: 0; }
        }
        .app-mode #mobile-controls { display: none !important; }
    `;
    document.head.appendChild(style);
}

window.updateClickerUI = function() {
    console.log("[CLICKER] Mise à jour UI. Total:", clickerData.total.toFixed(0));
    const countEl = document.getElementById('clicker-count');
    const cpsEl = document.getElementById('clicker-cps');
    if (countEl) countEl.innerText = Math.floor(clickerData.total).toLocaleString();
    
    let totalCps = 0;
    for (const type in clickerData.buildings) {
        totalCps += clickerData.buildings[type] * BUILDING_INFO[type].cps;
    }
    if (cpsEl) cpsEl.innerText = `CPS: ${totalCps.toFixed(1)}`;
    
    const buildingsContainer = document.getElementById('clicker-buildings');
    if (buildingsContainer && buildingsContainer.innerHTML === '') {
        renderClickerBuildings();
    } else if (buildingsContainer) {
        // Refresh costs/counts on existing buttons
        for (const type in BUILDING_INFO) {
            const btn = document.getElementById(`building-${type}-btn`);
            if (btn) {
                const count = clickerData.buildings[type];
                const cost = Math.floor(BUILDING_INFO[type].cost * Math.pow(1.15, count));
                btn.querySelector('.b-cost').innerText = `PRIX: ${cost.toLocaleString()} C`;
                btn.querySelector('.b-count').innerText = count;
                btn.classList.toggle('disabled-mode', clickerData.total < cost);
            }
        }
    }
};

function renderClickerBuildings() {
    const container = document.getElementById('clicker-buildings');
    if (!container) return;
    container.innerHTML = '';
    
    for (const type in BUILDING_INFO) {
        const info = BUILDING_INFO[type];
        const count = clickerData.buildings[type];
        const cost = Math.floor(info.cost * Math.pow(1.15, count));
        
        const b = document.createElement('div');
        b.id = `building-${type}-btn`;
        b.className = 'pixel-btn-simple';
        b.style.display = 'flex'; b.style.justifyContent = 'space-between'; b.style.alignItems = 'center';
        b.style.padding = '10px'; b.style.background = 'rgba(255,255,255,0.05)';
        b.style.border = `1px solid ${info.color}`;
        b.style.cursor = 'pointer';
        
        b.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:5px;">
                <span style="color:${info.color}; font-size:10px; font-weight:bold;">${info.name}</span>
                <span class="b-cost" style="font-size:7px; color:#aaa;">PRIX: ${cost.toLocaleString()} C</span>
            </div>
            <div style="text-align:right;">
                <div class="b-count" style="font-size:14px; color:#fff;">${count}</div>
                <div style="font-size:6px; color:#888;">+${info.cps}/s</div>
            </div>
        `;
        
        b.onclick = () => purchaseBuilding(type);
        container.appendChild(b);
    }
}

window.purchaseBuilding = function(type) {
    console.log("[CLICKER] Tentative d'achat:", type);
    const count = clickerData.buildings[type] || 0;
    const info = BUILDING_INFO[type];
    if (!info) { console.error("[CLICKER] Bâtiment inconnu:", type); return; }
    
    const cost = Math.floor(info.cost * Math.pow(1.15, count));
    console.log(`[CLICKER] Coût: ${cost}, Possédé: ${clickerData.total}`);
    
    if (clickerData.total >= cost) {
        clickerData.total -= cost;
        clickerData.buildings[type]++;
        console.log(`[CLICKER] Acheté! Nouveau compte: ${clickerData.buildings[type]}`);
        updateClickerUI();
        saveData();
    } else {
        console.warn("[CLICKER] Pas assez de clics!");
        alert(`Pas assez de clics! Il en faut ${cost.toLocaleString()}.`);
    }
};

window.exchangeClicks = function(target) {
    const rates = { 
        coins: 10000, 
        coins_large: 100000,
        common: 50000, 
        rare: 200000, 
        epic: 1000000,
        geo_gold: 5000000,
        divine: 10000000
    };
    const cost = rates[target.trim()];
    if (!cost) return;
    
    if (clickerData.total < cost) {
        alert("Pas assez de clics !");
        return;
    }
    
    clickerData.total -= cost;
    if (target === 'coins') addCoins(100);
    else if (target === 'coins_large') addCoins(1500);
    else if (target === 'geo_gold') {
        if (!myCards.blocks['gold']) myCards.blocks['gold'] = { count: 0, max: 0, nextRegen: 0 };
        myCards.blocks['gold'].count += 500;
        myCards.blocks['gold'].max += 500;
        alert("500 Blocs d'Or reçus !");
    }
    else if (target === 'divine') {
        // Special massive booster logic
        for(let i=0; i<5; i++) buyBooster('epic', 'mixed', 0, true);
        alert("5 PACKS ÉPIQUES OUVERTS !");
    }
    else {
        buyBooster(target, 'blocks', 0, true);
    }
    updateClickerUI();
};


window.buyBooster = function(rarity, category, price) {
    if (coins < price) {
        alert("Pas assez de pièces !");
        return;
    }
    addCoins(-price);
    saveData();
    openBoosterAnimation(rarity, category);
};

function openBoosterAnimation(rarity, category) {
    const drops = generateBoosterDrops(rarity, category);
    const overlay = document.getElementById('booster-open-overlay');
    const container = document.getElementById('booster-cards');
    const btn = document.getElementById('booster-close-btn');
    
    overlay.style.display = 'flex';
    container.innerHTML = '';
    btn.style.display = 'none';
    
    // Process drops into owned cards
    drops.forEach(d => {
        if(d.isSkin) { if(!myCards.skins.includes(d.id)) myCards.skins.push(d.id); }
        else { 
            if(!myCards.blocks[d.id]) myCards.blocks[d.id] = { count: 0, max: 0, nextRegen: 0 };
            const r = rarities[d.id] || 'commun';
            const bonus = (r === 'commun' ? 32 : (r === 'rare' ? 16 : 8));
            myCards.blocks[d.id].max += bonus;
            myCards.blocks[d.id].count += bonus;
        }
    });


    saveData();
    updateMenuInventoryCardsUI();

    // Reveal one by one
    drops.forEach((d, i) => {
        setTimeout(() => {
            const card = createCardElement(d.id, d.isSkin, '80px', d.isSkin ? 'SKIN' : 'BLOC', true);
            card.style.transform = 'scale(0)';
            card.style.transition = 'transform 0.5s bounce';
            container.appendChild(card);
            setTimeout(() => card.style.transform = 'scale(1)', 50);
        }, 500 * (i + 1));
    });

    setTimeout(() => { btn.style.display = 'inline-block'; }, 500 * (drops.length + 1));
}

window.closeBooster = function() {
    document.getElementById('booster-open-overlay').style.display = 'none';
};

const BLOCK_POOL = ['grass', 'wood', 'stone', 'sand', 'neige', 'brick', 'glass', 'emerald', 'sapphire', 'ruby', 'obsidienne', 'gold', 'diamond'];
const SKIN_POOL = ['#ff0000', '#00ff00', '#0000ff', '#ff00ff', '#ffff00', '#00ffff', '#ffffff', '#000000', '#800080', '#ffa500'];

function generateBoosterDrops(rarity, category) {
    const drops = [];
    let numCards = category === 'mixed' ? 3 : (category === 'skins' ? 1 : 3);
    
    let pool = BLOCK_POOL;
    let isSkinChance = category === 'skins' ? 1.0 : (category === 'blocks' ? 0.0 : 0.2);

    if (rarity === 'common') { pool = BLOCK_POOL.slice(0, 5); }
    if (rarity === 'rare') { pool = BLOCK_POOL.slice(3, 9); if (category === 'mixed') isSkinChance = 0.4; }
    if (rarity === 'epic') { pool = BLOCK_POOL.slice(7); if (category === 'mixed') isSkinChance = 0.6; }

    for(let i=0; i<numCards; i++) {
        let isSkin = Math.random() < isSkinChance;
        let p = isSkin ? SKIN_POOL : pool;
        let item = p[Math.floor(Math.random() * p.length)];
        drops.push({ id: item, isSkin: isSkin });
    }
    return drops;
}

function saveData() {
    if (!hasLoadedData) return; // Prevent overwriting with empty data
    if (!isSoloMode && socket && socket.connected) {
        socket.emit('saveCoinsCards', { 
            coins: coins, 
            cards: myCards, 
            color: document.getElementById('color-input').value,
            clicker: clickerData
        });
        socket.emit('saveInventory', inventory);
        socket.emit('saveQuests', { stats: stats, claimedQuests: claimedQuests });
    }
    // Always save to localStorage as backup/solo (clé par compte)
    const pfx = getPersistedStoragePrefix();
    localStorage.setItem(pfx + 'coins', coins);
    localStorage.setItem(pfx + 'cards', JSON.stringify(myCards));
    localStorage.setItem(pfx + 'inventory', JSON.stringify(inventory));
    localStorage.setItem(pfx + 'stats', JSON.stringify(stats));
    localStorage.setItem(pfx + 'claimed_quests', JSON.stringify(claimedQuests));
    localStorage.setItem(pfx + 'clicker', JSON.stringify(clickerData));
}




// Auto-save every 30 seconds if logged in
setInterval(() => {
    if (hasLoadedData) saveData();
}, 30000);

// Clicker Idle Loop
setInterval(() => {
    let totalCps = 0;
    for (const type in clickerData.buildings) {
        totalCps += (clickerData.buildings[type] || 0) * BUILDING_INFO[type].cps;
    }
    if (totalCps > 0) {
        clickerData.total += totalCps / 10;
        if (document.getElementById('clicker-menu').style.display === 'flex' || document.getElementById('clicker-menu').style.display === 'row') {
            updateClickerUI();
        }
    }
}, 100);



// Regeneration Loop
setInterval(() => {
    let changed = false;
    for (const b in myCards.blocks) {
        const data = myCards.blocks[b];
        if (data.count < data.max && data.nextRegen > 0 && Date.now() >= data.nextRegen) {
            data.count++;
            if (data.count < data.max) {
                const rarity = rarities[b] || 'commun';
                data.nextRegen = Date.now() + (regenDelay[rarity] * 1000);
            } else {
                data.nextRegen = 0;
            }
            changed = true;
        }
    }
    if (changed) {
        saveData();
        if (document.getElementById('my-inventory-menu').style.display === 'flex') updateMenuInventoryCardsUI();
    }
}, 1000);



// --- INPUT HANDLERS ---
document.addEventListener('keydown', (e) => {
    if (isChatOpen && e.code !== 'Enter') return;
    const c = e.code;
    if (c === 'KeyW') moveState.w = true; if (c === 'KeyS') moveState.s = true;
    if (c === 'KeyA') moveState.a = true; if (c === 'KeyD') moveState.d = true;
    if (c === 'Space') moveState.space = true;
    if (c.startsWith('Digit')) { selectedSlot = parseInt(c.replace('Digit', '')) - 1; updateHotbarUI(); }
    if (c === 'KeyE' && isGameActive) {
        isInventoryOpen = !isInventoryOpen;
        document.getElementById('main-inventory').style.display = isInventoryOpen ? 'flex' : 'none';
        if (isInventoryOpen) { updateInventoryUI(); document.exitPointerLock(); }
        else if (isGameActive) requestPointerLockIfDesktop();
        syncMobileHudVisibility();
    }
    if (c === 'KeyQ' && isGameActive) {
        isQuestMenuOpen = !isQuestMenuOpen;
        document.getElementById('quest-menu').style.display = isQuestMenuOpen ? 'flex' : 'none';
        if (isQuestMenuOpen) document.exitPointerLock();
        else requestPointerLockIfDesktop();
        syncMobileHudVisibility();
    }
    if (c === 'Tab' && isGameActive) { e.preventDefault(); document.getElementById('player-list-container').style.display = 'flex'; updatePlayerListUI(); }
    if (c === 'Enter' && isGameActive) {
        const input = document.getElementById('chat-input');
        if (!isChatOpen) { isChatOpen = true; input.style.display = 'block'; input.focus(); document.exitPointerLock(); }
        else {
            isChatOpen = false; input.style.display = 'none';
            if (input.value.trim()) { if (!isSoloMode && socket) socket.emit('chatMessage', { user: window.myUsername || "Joueur", text: input.value }); else addChatMessage("Moi", input.value); }
            input.value = ''; if (isGameActive) requestPointerLockIfDesktop();
        }
    }
    if (c === 'KeyF' && isGameActive && isAdmin) {
        isFlying = !isFlying;
        velocity.set(0,0,0);
        addChatMessage("Système", `Fly mode: ${isFlying ? 'Activé' : 'Désactivé'}`);
    }
    if (c === 'ControlLeft' || c === 'ControlRight') moveState.ctrl = true;
    if (c === 'Backquote' || c === 'Escape') {
        if (isInventoryOpen) { isInventoryOpen = false; document.getElementById('main-inventory').style.display = 'none'; if (isGameActive) requestPointerLockIfDesktop(); syncMobileHudVisibility(); }
        else if (isQuestMenuOpen) { isQuestMenuOpen = false; document.getElementById('quest-menu').style.display = 'none'; if (isGameActive) requestPointerLockIfDesktop(); syncMobileHudVisibility(); }
        else if (isSettingsOpen) window.guiCloseSettingsMenu();
        else window.togglePauseMenu();
    }
});
document.addEventListener('wheel', (e) => {
    if (!isGameActive || isChatOpen || isInventoryOpen || isQuestMenuOpen) return;
    if (e.deltaY > 0) selectedSlot = (selectedSlot + 1) % 9;
    else selectedSlot = (selectedSlot - 1 + 9) % 9;
    updateHotbarUI();
});

document.addEventListener('keyup', (e) => {
    const c = e.code;
    if (c === 'KeyW') moveState.w = false; if (c === 'KeyS') moveState.s = false;
    if (c === 'KeyA') moveState.a = false; if (c === 'KeyD') moveState.d = false;
    if (c === 'Space') moveState.space = false;
    if (c === 'ControlLeft' || c === 'ControlRight') moveState.ctrl = false;
    if (c === 'Tab') document.getElementById('player-list-container').style.display = 'none';
});
document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement === document.body) {
        euler.setFromQuaternion(camera.quaternion);
        euler.y -= e.movementX * 0.002; euler.x -= e.movementY * 0.002;
        euler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, euler.x));
        camera.quaternion.setFromEuler(euler);
    }
    if (isInventoryOpen && pickedUpItem) {
        const m = document.getElementById('picked-item-mouse');
        m.style.left = e.clientX + 5 + 'px'; m.style.top = e.clientY + 5 + 'px';
    }
});

function addChatMessage(u, t, adminTag = false) {
    const hist = document.getElementById('chat-history');
    const d = document.createElement('div'); d.className = 'chat-msg'; 
    const roleText = adminTag ? '<span style="color: #ff3333; font-weight: bold;">[ADMIN] </span>' : '';
    d.innerHTML = `${roleText}<b>${u}:</b> ${t}`;
    hist.appendChild(d); hist.scrollTop = hist.scrollHeight;
}

function setupSocketHandlers() {
    socket.on('connect', () => {
        console.log("Connecté au serveur ! Sync...");
        const status = document.getElementById('connection-status');
        if (status) {
            status.innerText = "EN LIGNE"; status.style.color = "#4caf50"; status.style.borderColor = "#4caf50";
        }
        if (pendingJoinPayload) {
            flushPendingJoin();
            return;
        }
        if (skipSyncUntilAuthReady) {
            connectDeferredSync = true;
            return;
        }
        // Utiliser les données locales si le serveur n'a pas encore répondu
        if (!hasLoadedData) {
            coins = localData.coins;
            clickerData = localData.clicker;
            updateClickerUI();
            updateCoinsUI();
        }
        socket.emit('syncOfflineData', localData);
    });

    socket.on('disconnect', () => {
        const status = document.getElementById('connection-status');
        if (status) {
            status.innerText = "HORS LIGNE"; status.style.color = "#ff3333"; status.style.borderColor = "#ff3333";
        }
    });

    socket.on('syncResult', (data) => {
        console.log("Sync terminée avec le serveur:", data);
        hasLoadedData = true;
        if (data.coins !== undefined) coins = data.coins;
        if (data.clicker) clickerData = data.clicker;
        localData.coins = coins;
        localData.clicker = clickerData;
        saveLocal();
        updateClickerUI();
        updateCoinsUI();
    });

    

    

    socket.on('authSuccess', (data) => {
        isAdmin = data.isAdmin || false;
        if (isAdmin) {
            document.getElementById('admin-menu-btn').style.display = 'block';
            
        }
        
        if (data && data.menuOnly) {
            window.myUsername = data.username;
            const errEl = document.getElementById('global-auth-error');
            if (errEl) errEl.style.display = 'none';
            const authScreen = document.getElementById('auth-screen');
            const loginScreen = document.getElementById('login-screen');
            const profileCorner = document.getElementById('profile-corner');
            const pseudoEl = document.getElementById('profile-pseudo');
            if (authScreen) authScreen.style.display = 'none';
            if (loginScreen) loginScreen.style.display = 'block';
            if (profileCorner) profileCorner.style.display = 'block';
            if (pseudoEl) pseudoEl.textContent = data.username;
            if (typeof showLoginSubMenu === 'function') showLoginSubMenu('main-menu');
            localData.coins = coins;
            localData.clicker = clickerData;
            saveLocal();
            socket.emit('syncOfflineData', localData);
            return;
        }
        isGameActive = true;
        document.getElementById('auth-screen').style.display = 'none';
        document.getElementById('login-screen').style.display = 'none';
        const topHudGame = document.getElementById('top-corner-ui');
        if (topHudGame) topHudGame.style.display = 'flex';
        document.body.classList.add('game-active');
        document.getElementById('game-ui').style.display = 'block';
        if (data.x !== undefined && data.y !== undefined && data.z !== undefined) {
            camera.position.set(data.x, data.y, data.z);
        }
        applyMobileGameHudIfNeeded();
        requestPointerLockIfDesktop();
        updateHotbarUI();

    });
    socket.on('authError', (msg) => {
        if (window.showAuthError) window.showAuthError(msg);
        else alert(msg);
        socket.disconnect();
    });
    socket.on('currentBlocks', (bs) => bs.forEach(b => createBlockMesh(b.x, b.y, b.z, b.type)));
    socket.on('blockPlaced', (b) => createBlockMesh(b.x, b.y, b.z, b.type));
    socket.on('blockRemoved', (p) => {
        const o = objectsToIntersect.find(obj => obj !== floor && Math.abs(obj.position.x - p.x) < 0.1 && Math.abs(obj.position.y - p.y) < 0.1 && Math.abs(obj.position.z - p.z) < 0.1);
        if (o) { scene.remove(o); objectsToIntersect.splice(objectsToIntersect.indexOf(o), 1); }
    });
    socket.on('chatMessage', (m) => addChatMessage(m.user, m.text, m.isAdmin));
    socket.on('currentPlayers', (ps) => { for (const id in ps) if (id !== socket.id) createRemotePlayer(id, ps[id]); });
    socket.on('playerJoined', (p) => { if (p.id !== socket.id) createRemotePlayer(p.id, p); });
    socket.on('playerMoved', (p) => { if (remotePlayers[p.id]) { remotePlayers[p.id].position.set(p.x, p.y - 0.9, p.z); if (p.rotation) remotePlayers[p.id].rotation.order = 'YXZ'; remotePlayers[p.id].rotation.y = p.rotation.y; } });
    socket.on('playerLeft', (id) => removeRemotePlayer(id));

    socket.on('loadCoinsCards', (data) => {
        console.log("[CLIENT] loadCoinsCards reçu:", data);
        hasLoadedData = true;
        coins = data.coins || 0;
        if (data.clicker) {
            clickerData = data.clicker;
            // Ensure all building types exist in the loaded data
            for (const type in BUILDING_INFO) {
                if (clickerData.buildings[type] === undefined) clickerData.buildings[type] = 0;
            }
        }

        myCards = data.cards || { blocks: {}, skins: ['#ff0000'] };
        if (data.color) {
            document.getElementById('color-input').value = data.color;
            playerColor = data.color;
        }
        // Ensure blocks is an object
        if (Array.isArray(myCards.blocks)) {
             const bArr = myCards.blocks; myCards.blocks = {};
             bArr.forEach(b => myCards.blocks[b] = { count: 64, max: 64, nextRegen: 0 });
        }
        updateMenuInventoryCardsUI();
        updateClickerUI();
        updateCoinsUI();
    });





    socket.on('loadInventory', (data) => {
        if (data && Array.isArray(data)) {
            for (let i = 0; i < 36; i++) {
                inventory[i] = data[i] || null;
            }
            updateHotbarUI();
            if (isInventoryOpen) updateInventoryUI();
        }
    });

    socket.on('loadQuests', (data) => {
        if (data) {
            if (data.stats) {
                Object.assign(stats, data.stats);
                document.getElementById('stats-destroyed').innerText = `Détruits: ${stats.blocksDestroyed || 0}`;
                document.getElementById('stats-collected').innerText = `Collectés: ${stats.blocksCollected || 0}`;
                document.getElementById('stats-build').innerText = `Blocs: ${stats.blocksPlaced || 0}`;
                document.getElementById('stats-dist').innerText = `Distance: ${Math.floor(stats.distance || 0)}m`;
            }
            if (data.claimedQuests) {
                Object.assign(claimedQuests, data.claimedQuests);
                for (const qId in claimedQuests) {
                    const btn = document.getElementById(`quest-${qId}-btn`);
                    if (btn) {
                        btn.setAttribute('disabled', 'true');
                        btn.innerText = "RÉUSSI";
                    }
                    if (qId === 'daily_' + new Date().toDateString()) {
                        const dBtn = document.getElementById('quest-daily-btn');
                        if (dBtn) {
                            dBtn.setAttribute('disabled', 'true');
                            dBtn.innerText = "RÉCUPÉRÉ";
                        }
                    }
                    if (qId === 'starter') {
                        const sBtn = document.getElementById('quest-claim-btn');
                        if (sBtn) {
                            sBtn.setAttribute('disabled', 'true');
                        }
                    }
                }
            }

        }
    });



    socket.on('searchResults', (results) => {
        const display = document.getElementById('search-results-display');
        display.innerHTML = '';
        results.forEach(u => {
            const isFriend = (window.myFriends || []).some(f => f.name === u);
            const isPending = (window.myRequests || []).includes(u);
            
            let actionHtml = `<button class="pixel-btn" style="width:auto; padding:5px 10px" onclick="socket.emit('sendFriendRequest', '${u}')">+</button>`;
            if (isFriend) actionHtml = `<span style="color:#4caf50; font-size:8px">AMI</span>`;
            else if (isPending) actionHtml = `<span style="color:#aaa; font-size:8px">DEMANDE REÇUE</span>`;

            const div = document.createElement('div');
            div.className = 'friend-item';
            div.innerHTML = `
                <div class="friend-info">
                    <span class="friend-name-text">${u}</span>
                </div>
                <div class="friend-actions">
                    ${actionHtml}
                </div>`;
            display.appendChild(div);
        });
    });

    socket.on('updateFriendsData', (data) => {
        if (data.friends) window.myFriends = data.friends;
        if (data.requests) window.myRequests = data.requests;
        updateFriendsUI();
    });

    socket.on('friendRequestSent', (target) => {
        const btn = document.querySelector(`button[onclick="socket.emit('sendFriendRequest', '${target}')"]`);
        if (btn) {
            btn.innerText = 'DEMANDE ENVOYÉE';
            btn.style.background = '#888';
            btn.style.fontSize = '8px';
            btn.disabled = true;
        }
    });

    // --- TRADING SOCKET LISTENERS ---
    socket.on('tradeRequestReceived', (sender) => {
        if (confirm(`${sender} veut faire un échange avec vous ! Accepter ?`)) {
            socket.emit('tradeAcceptInitial', sender);
        }
    });

    socket.on('tradeStarted', (data) => {
        tradePartner = data.partner;
        tradeMyOffer = [];
        tradeTheirOffer = [];
        tradeMyReady = false;
        document.getElementById('trade-ui').style.display = 'flex';
        document.getElementById('trade-partner-name').innerText = data.partner;
        document.getElementById('trade-their-ready').innerText = "NON";
        document.getElementById('trade-their-ready').style.color = "#f44336";
        document.getElementById('trade-my-ready').checked = false;
        document.getElementById('trade-accept-btn').disabled = true;
        renderTradeUI();
    });

    socket.on('tradePartnerUpdatedOffer', (offer) => {
        tradeTheirOffer = offer;
        renderTradeUI();
    });

    socket.on('tradePartnerReady', (isReady) => {
        document.getElementById('trade-their-ready').innerText = isReady ? "OUI" : "NON";
        document.getElementById('trade-their-ready').style.color = isReady ? "#4caf50" : "#f44336";
        checkTradeExecution();
    });

    socket.on('tradeCompleted', (data) => {
        alert("Échange réussi !");
        // add received items
        data.received.forEach(item => {
            if (item.isSkin) { if(!myCards.skins.includes(item.id)) myCards.skins.push(item.id); }
            else { 
                if(!myCards.blocks[item.id]) myCards.blocks[item.id] = { count:1, max:1, nextRegen:0 };
                else { myCards.blocks[item.id].count++; myCards.blocks[item.id].max++; }
            }
        });
        // remove given items
        tradeMyOffer.forEach(item => {
            if (item.isSkin) myCards.skins = myCards.skins.filter(s => s !== item.id);
            else {
                if(myCards.blocks[item.id]) {
                    myCards.blocks[item.id].max--;
                    myCards.blocks[item.id].count = Math.max(0, myCards.blocks[item.id].count - 1);
                }
            }
        });
        saveData();
        cancelTrade(true);
    });


    socket.on('tradeCanceled', () => {
        alert("L'échange a été annulé.");
        cancelTrade(true);
    });
}

// --- TRADING LOGIC ---
let tradePartner = null;
let tradeMyOffer = [];
let tradeTheirOffer = [];
let tradeMyReady = false;

window.sendTradeRequest = function(partner) {
    socket.emit('tradeRequest', partner);
    alert(`Demande d'échange envoyée à ${partner}.`);
};

window.openTradeSelection = function() {
    const ui = document.getElementById('trade-selection-ui');
    const container = document.getElementById('trade-selection-list');
    container.innerHTML = '';
    
    myCards.blocks.forEach(b => {
        const el = createCardElement(b, false, '50px');
        el.style.cursor = 'pointer';
        el.onclick = () => { addCardToTrade({id: b, isSkin: false}); ui.style.display = 'none'; };
        container.appendChild(el);
    });
    myCards.skins.forEach(s => {
        const el = createCardElement(s, true, '50px');
        el.style.cursor = 'pointer';
        el.onclick = () => { addCardToTrade({id: s, isSkin: true}); ui.style.display = 'none'; };
        container.appendChild(el);
    });
    
    ui.style.display = 'flex';
};

function addCardToTrade(card) {
    if (!tradeMyOffer.some(c => c.id === card.id && c.isSkin === card.isSkin)) {
        tradeMyOffer.push(card);
        socket.emit('tradeUpdateOffer', { partner: tradePartner, offer: tradeMyOffer });
        renderTradeUI();
    }
}

function renderTradeUI() {
    const myContainer = document.getElementById('trade-my-offer');
    const theirContainer = document.getElementById('trade-their-offer');
    myContainer.innerHTML = '';
    theirContainer.innerHTML = '';

    tradeMyOffer.forEach((item, index) => {
        const el = createCardElement(item.id, item.isSkin, '50px');
        el.style.cursor = 'pointer';
        el.onclick = () => {
             tradeMyOffer.splice(index, 1);
             socket.emit('tradeUpdateOffer', { partner: tradePartner, offer: tradeMyOffer });
             renderTradeUI();
        };
        myContainer.appendChild(el);
    });

    tradeTheirOffer.forEach(item => {
        const el = createCardElement(item.id, item.isSkin, '50px');
        theirContainer.appendChild(el);
    });
}

window.toggleTradeReady = function() {
    tradeMyReady = document.getElementById('trade-my-ready').checked;
    socket.emit('tradeReady', { partner: tradePartner, isReady: tradeMyReady });
    checkTradeExecution();
};

function checkTradeExecution() {
    const theirReadyText = document.getElementById('trade-their-ready').innerText;
    const btn = document.getElementById('trade-accept-btn');
    if (tradeMyReady && theirReadyText === "OUI") {
        btn.disabled = false;
        btn.onclick = () => {
            socket.emit('tradeExecute', { partner: tradePartner, myFinalOffer: tradeMyOffer, theirFinalOffer: tradeTheirOffer });
        };
    } else {
        btn.disabled = true;
    }
}

window.cancelTrade = function(quiet = false) {
    document.getElementById('trade-ui').style.display = 'none';
    if (!quiet && tradePartner) {
        socket.emit('tradeCancel', { partner: tradePartner });
    }
    tradePartner = null;
};

window.searchFriends = function () {
    const val = document.getElementById('friend-search-input').value;
    if (val) socket.emit('searchPlayer', val);
};

function updateFriendsUI() {
    const listDisp = document.getElementById('friends-display');
    const reqDisp = document.getElementById('requests-display');
    if (listDisp) {
        listDisp.innerHTML = '';
        (window.myFriends || []).forEach(f => {
            const statusColor = f.online ? '#4caf50' : '#f44336';
            const serverInfo = f.server ? `<span class="server-label">(${f.server})</span>` : '';
            const tradeBtn = (f.online && f.server) ? `<button class="pixel-btn" style="width: auto; padding: 5px; font-size: 8px; margin-left: 10px;" onclick="sendTradeRequest('${f.name}')">ÉCHANGER</button>` : '';

            listDisp.innerHTML += `
                <div class="friend-item">
                    <div class="friend-info">
                        <div class="status-dot" style="background:${statusColor}"></div>
                        <span class="friend-name-text">${f.name}</span>
                        ${serverInfo}
                        ${tradeBtn}
                    </div>
                </div>`;
        });
    }
    if (reqDisp) {
        reqDisp.innerHTML = '';
        (window.myRequests || []).forEach(r => {
            const div = document.createElement('div');
            div.className = 'friend-item';
            div.innerHTML = `
                <div class="friend-info">
                    <span class="friend-name-text">${r}</span>
                </div>
                <div class="friend-actions">
                    <button class="pixel-btn" style="width:auto; margin-right:5px; background:#4caf50; border-color:#2e7d32; padding:5px 10px" onclick="socket.emit('handleFriendRequest', {target:'${r}', action:'accept'})">V</button>
                    <button class="pixel-btn" style="width:auto; background:#f44336; border-color:#c62828; padding:5px 10px" onclick="socket.emit('handleFriendRequest', {target:'${r}', action:'decline'})">X</button>
                </div>`;
            reqDisp.appendChild(div);
        });
    }
}

const remotePlayers = {};
function createRemotePlayer(id, data) {
    if (remotePlayers[id]) return;
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1, 0.6), new THREE.MeshLambertMaterial({ color: data.color || 0xff0000 }));
    mesh.position.y = 0.5; group.add(mesh);
    const sprite = createTextSprite(data.username); sprite.position.y = 1.3; group.add(sprite);
    group.position.set(data.x || 0, (data.y || 1) - 0.9, data.z || 0);
    scene.add(group); remotePlayers[id] = group;
    group.userData = data; objectsToIntersect.push(mesh); // For player interaction
}
function removeRemotePlayer(id) { if (remotePlayers[id]) { const mesh = remotePlayers[id].children[0]; const idx = objectsToIntersect.indexOf(mesh); if (idx !== -1) objectsToIntersect.splice(idx, 1); scene.remove(remotePlayers[id]); delete remotePlayers[id]; } }
function createTextSprite(text) {
    const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d');
    canvas.width = 256; canvas.height = 64; ctx.fillStyle = 'white'; ctx.font = '22px "Press Start 2P"'; ctx.textAlign = 'center'; ctx.fillText(text, 128, 40);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas) }));
    sprite.scale.set(1.5, 0.4, 1); return sprite;
}
function updatePlayerListUI() {
    const list = document.getElementById('player-list'); if (!list) return;
    const myAdminTag = isAdmin ? '<span style="color:#ff3333; font-weight:bold;"> [ADMIN]</span>' : '';
    list.innerHTML = `<div class="player-list-item"><div class="player-color-dot" style="background:${document.getElementById('color-input').value}"></div><span class="player-name">${window.myUsername || "Moi"}${myAdminTag} (Toi)</span></div>`;
    for (const id in remotePlayers) {
        const p = remotePlayers[id].userData;
        const pAdminTag = p.isAdmin ? '<span style="color:#ff3333; font-weight:bold;"> [ADMIN]</span>' : '';
        const isFriend = (window.myFriends || []).some(f => f.name === p.username);
        const addBtn = !isFriend ? `<button class="pixel-btn" style="width:auto; padding:2px 8px; margin-left:auto" onclick="socket.emit('sendFriendRequest', '${p.username}')">+</button>` : '';
        list.innerHTML += `<div class="player-list-item"><div class="player-color-dot" style="background:${p.color}"></div><span class="player-name">${p.username}${pAdminTag}</span> ${addBtn}</div>`;
    }
}
function checkCollision(pos) {
    const playerBox = new THREE.Box3().setFromCenterAndSize(pos.clone().add(new THREE.Vector3(0, -0.45, 0)), new THREE.Vector3(0.6, 0.9, 0.6));
    for (const o of objectsToIntersect) if (o !== floor && playerBox.intersectsBox(new THREE.Box3().setFromObject(o))) return true;
    for (const id in remotePlayers) {
        const remoteMesh = remotePlayers[id].children[0];
        const remoteBox = new THREE.Box3().setFromObject(remoteMesh);
        if (playerBox.intersectsBox(remoteBox)) return true;
    }
    return false;
}

// --- ANIMATION ---
let lastTime = performance.now();
function animate() {
    requestAnimationFrame(animate);
    const time = performance.now();
    const dt = (time - lastTime) / 1000; lastTime = time;
    if (isGameActive && !isInventoryOpen && !isPauseMenuOpen && !isSettingsOpen && !isQuestMenuOpen && !isChatOpen) {
        if (!isFlying) {
            velocity.y -= 9.8 * 2 * dt;
        } else {
            velocity.y = 0;
            if (moveState.space) velocity.y = 10;
            if (moveState.ctrl) velocity.y = -10;
        }

        const forward = new THREE.Vector3(-Math.sin(euler.y), 0, -Math.cos(euler.y));
        const right = new THREE.Vector3(-Math.sin(euler.y - Math.PI / 2), 0, -Math.cos(euler.y - Math.PI / 2));
        const moveVector = new THREE.Vector3();
        if (moveState.w) moveVector.add(forward); if (moveState.s) moveVector.sub(forward);
        if (moveState.a) moveVector.sub(right); if (moveState.d) moveVector.add(right);
        moveVector.normalize();

        const speed = isFlying ? 15 : 5;

        const nextPosY = camera.position.clone().add(new THREE.Vector3(0, velocity.y * dt, 0));
        if (isFlying || !checkCollision(nextPosY)) {
            camera.position.y = nextPosY.y;
            if (!isFlying && camera.position.y < 0.9) { camera.position.y = 0.9; velocity.y = 0; if (moveState.space) velocity.y = 8; }
        } else {
            velocity.y = 0;
            if (moveState.space && camera.position.y <= 0.95) velocity.y = 8;
        }

        const nextPosX = camera.position.clone().add(new THREE.Vector3(moveVector.x * speed * dt, 0, 0));
        if (!checkCollision(nextPosX)) camera.position.x = nextPosX.x;
        const nextPosZ = camera.position.clone().add(new THREE.Vector3(0, 0, moveVector.z * 5 * dt));
        if (!checkCollision(nextPosZ)) camera.position.z = nextPosZ.z;

        stats.distance += moveVector.length() * 5 * dt;
        document.getElementById('stats-dist').innerText = `Distance: ${Math.floor(stats.distance)}m`;

        // Progression Quests (Focus on Placement)
        if (stats.blocksPlaced >= 10) document.getElementById('quest-build_10-btn')?.removeAttribute('disabled');
        if (stats.blocksPlaced >= 50) document.getElementById('quest-build_50-btn')?.removeAttribute('disabled');
        if (stats.blocksPlaced >= 100) document.getElementById('quest-build_100-btn')?.removeAttribute('disabled');
        if (stats.blocksPlaced >= 250) document.getElementById('quest-build_250-btn')?.removeAttribute('disabled');
        if (stats.blocksPlaced >= 500) document.getElementById('quest-build_500-btn')?.removeAttribute('disabled');
        if (stats.distance >= 300) document.getElementById('quest-dist-btn')?.removeAttribute('disabled');

        // Daily Quest check
        if (currentDaily) {
            let progress = 0;
            if (currentDaily.type === 'wood') progress = stats.byType.wood;
            else if (currentDaily.type === 'stone') progress = stats.byType.stone;
            else if (currentDaily.type === 'dist') progress = stats.distance;
            else if (currentDaily.type === 'build') progress = stats.blocksPlaced;

            if (progress >= currentDaily.target) {
                document.getElementById('quest-daily-btn')?.removeAttribute('disabled');
            }
        }

        if (!isSoloMode && socket && socket.connected) socket.emit('playerMove', { x: camera.position.x, y: camera.position.y, z: camera.position.z, rotation: { x: euler.x, y: euler.y, z: euler.z } });
    }
    renderer.render(scene, camera);
}
// --- WALKING MODE (MARCHE) & MAP ---
let isWalkTracking = window.isApp || true; // Always true in app
let walkSteps = 0;
let lastAccelTime = 0;
let lastRewardDistance = 0;
let map, playerMarker;

let userLocation = { lat: 0, lon: 0 };

