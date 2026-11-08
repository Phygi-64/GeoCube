const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');

const app = express();
const server = http.createServer(app);
const io = require('socket.io')(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    pingTimeout: 60000,
    pingInterval: 25000,
    connectTimeout: 45000
});

const PORT = process.env.PORT || 30000;
const DATA_DIR = __dirname;
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const WORLD_ALPHA_FILE = path.join(DATA_DIR, 'world_alpha.json');
const WORLD_BETA_FILE = path.join(DATA_DIR, 'world_beta.json');

// --- MIDDLEWARES & STATICS ---
app.use(express.json());

// Serve client web files
const clientDir = path.join(__dirname, '../client');
app.use(express.static(clientDir));

// Fallback for assets if referenced at root or /assets
app.use('/assets', express.static(path.join(clientDir, 'assets')));
const rootResources = path.join(__dirname, '../../resources');
if (fs.existsSync(rootResources)) {
    app.use('/resources', express.static(rootResources));
}

// Health check endpoint for cloud hosting (Render, Koyeb, UptimeRobot, etc.)
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        game: 'GeoCube',
        uptime: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
        activePlayers: Object.keys(players).length,
        worlds: {
            alpha: worlds.Alpha ? worlds.Alpha.length : 0,
            beta: worlds.Beta ? worlds.Beta.length : 0
        }
    });
});

// --- IN-MEMORY DATA STORES ---
const players = {}; // socket.id -> player object
const worlds = {
    Alpha: [],
    Beta: []
};
let users = {};

// --- LOAD DATA ---
function loadJsonFile(filepath, fallback) {
    if (fs.existsSync(filepath)) {
        try {
            return JSON.parse(fs.readFileSync(filepath, 'utf8'));
        } catch (err) {
            console.error(`Erreur lecture ${filepath}:`, err);
        }
    }
    return fallback;
}

// Load Users
users = loadJsonFile(USERS_FILE, {});

// Load Worlds
worlds.Alpha = loadJsonFile(WORLD_ALPHA_FILE, []);
worlds.Beta = loadJsonFile(WORLD_BETA_FILE, []);

console.log(`[DATA] Utilisateurs chargés : ${Object.keys(users).length}`);
console.log(`[DATA] Monde Alpha : ${worlds.Alpha.length} blocs | Monde Beta : ${worlds.Beta.length} blocs`);

// --- SAVE FUNCTIONS ---
function saveUsers() {
    try {
        fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
    } catch (e) {
        console.error("Erreur sauvegarde users.json:", e);
    }
}

function saveWorlds() {
    try {
        fs.writeFileSync(WORLD_ALPHA_FILE, JSON.stringify(worlds.Alpha), 'utf8');
        fs.writeFileSync(WORLD_BETA_FILE, JSON.stringify(worlds.Beta), 'utf8');
    } catch (e) {
        console.error("Erreur sauvegarde des mondes:", e);
    }
}

// Periodic auto-save every 60s
setInterval(() => {
    saveUsers();
    saveWorlds();
}, 60000);

function gracefulShutdown() {
    console.log("\n[SERVEUR] Sauvegarde avant arrêt...");
    saveUsers();
    saveWorlds();
    process.exit(0);
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
process.on('uncaughtException', (err) => {
    console.error("[CRITIQUE] uncaughtException:", err);
    saveUsers();
    saveWorlds();
});
process.on('unhandledRejection', (reason) => {
    console.error("[CRITIQUE] unhandledRejection:", reason);
});

// Safe helper to update a user profile
function updateUserRaw(username, updateFn) {
    if (!username) return;
    if (!users[username]) users[username] = {};
    updateFn(users[username]);
    saveUsers();
}

function migrateUser(u) {
    if (!users[u]) return false;
    let modified = false;
    if (!users[u].v5_reset) {
        users[u].v5_reset = true;
        users[u].inventory = new Array(36).fill(null);
        users[u].cards = { blocks: {}, skins: ['#ff0000'] };
        users[u].coins = users[u].coins || 100;
        modified = true;
    }
    return modified;
}

// Initial migration for all existing users
for (const u in users) {
    migrateUser(u);
}
saveUsers();

// Notify friends status helper
function notifyFriendsStatus(username, online) {
    if (!users[username] || !users[username].friends) return;
    users[username].friends.forEach(friendName => {
        const friendSockets = Object.values(io.sockets.sockets).filter(s => s.username === friendName);
        friendSockets.forEach(friendSocket => {
            const friendData = users[friendName];
            if (!friendData) return;
            const friendsWithStatus = (friendData.friends || []).map(f => {
                const isOnline = Object.values(players).some(p => p.username === f);
                const isConnected = Object.values(io.sockets.sockets).some(s => s.username === f);
                const playerObj = Object.values(players).find(p => p.username === f);
                return {
                    name: f,
                    online: isConnected,
                    server: isOnline ? (playerObj?.world || "Alpha") : (isConnected ? "Menu" : null)
                };
            });
            friendSocket.emit('updateFriendsData', { friends: friendsWithStatus });
        });
    });
}

// --- SOCKET.IO HANDLING ---
io.on('connection', (socket) => {
    socket.currentWorld = "Alpha";

    // --- AUTH / JOIN GAME ---
    socket.on('joinGame', (data) => {
        data = data || {};
        const username = data.username ? data.username.trim() : "";
        const password = data.password;
        const color = data.color || '#ff0000ff';
        const type = data.type || 'login';
        const menuOnly = !!data.menuOnly;
        const requestedWorld = (data.serverName === 'Beta' || data.world === 'Beta' || data.serverPort === '30002') ? 'Beta' : 'Alpha';

        if (!username) {
            socket.emit('authError', 'Pseudo requis');
            return;
        }

        if (type === 'register') {
            if (users[username]) {
                socket.emit('authError', 'Ce pseudo est déjà pris.');
                return;
            }
            users[username] = {
                password: password,
                coins: 100,
                cards: { blocks: {}, skins: ['#ff0000'] },
                color: color,
                inventory: new Array(36).fill(null),
                v5_reset: true,
                friends: [],
                friendRequests: [],
                stats: {
                    distance: 0,
                    blocksPlaced: 0,
                    blocksCollected: 0,
                    blocksDestroyed: 0,
                    byType: { wood: 0, stone: 0, diamond: 0, gold: 0, obsidienne: 0, emeraude: 0, brick: 0, glass: 0 }
                },
                clicker: { total: 0, buildings: { pioche: 0, steve: 0, four: 0, mine: 0, villageois: 0, golem: 0, cite: 0, dragon: 0 } }
            };
            saveUsers();
            console.log(`[AUTH] Nouvel utilisateur inscrit : ${username}`);
        } else {
            if (!users[username]) {
                socket.emit('authError', 'Compte inexistant. Inscris-toi !');
                return;
            }
            if (users[username].password !== password) {
                socket.emit('authError', 'Mot de passe incorrect.');
                return;
            }
        }

        migrateUser(username);
        socket.username = username;
        socket.currentWorld = requestedWorld;

        // If Menu only (loading data for the client UI before joining 3D world)
        if (menuOnly) {
            const friendsWithStatus = (users[username].friends || []).map(f => {
                const isOnline = Object.values(players).some(p => p.username === f);
                const isConnected = Object.values(io.sockets.sockets).some(s => s.username === f);
                const pObj = Object.values(players).find(p => p.username === f);
                return {
                    name: f,
                    online: isConnected,
                    server: isOnline ? (pObj?.world || "Alpha") : (isConnected ? "Menu" : null)
                };
            });

            socket.emit('updateFriendsData', { friends: friendsWithStatus, requests: users[username].friendRequests || [] });
            notifyFriendsStatus(username, true);

            socket.emit('loadCoinsCards', {
                coins: users[username].coins || 0,
                cards: users[username].cards || { blocks: {}, skins: ['#ff0000'] },
                color: users[username].color || color,
                clicker: users[username].clicker || { total: 0, buildings: { pioche: 0, steve: 0, four: 0, mine: 0, villageois: 0 } }
            });

            socket.emit('authSuccess', { username: username, isAdmin: !!users[username].isAdmin, menuOnly: true });
            return;
        }

        // Active Player joining the 3D world
        const existingId = Object.keys(players).find(id => players[id].username === username);
        if (existingId && existingId !== socket.id) {
            delete players[existingId];
        }

        players[socket.id] = {
            id: socket.id,
            username: username,
            color: color,
            world: requestedWorld,
            isAdmin: !!users[username].isAdmin,
            x: users[username].x || 0,
            y: users[username].y || 1.7,
            z: users[username].z || 0
        };

        socket.join(`world_${requestedWorld}`);

        console.log(`[JOIN] ${username} a rejoint le monde ${requestedWorld}`);

        // Send current world blocks and players in the same world
        const worldPlayers = {};
        for (const pid in players) {
            if (players[pid].world === requestedWorld) {
                worldPlayers[pid] = players[pid];
            }
        }

        socket.emit('currentPlayers', worldPlayers);
        socket.emit('currentBlocks', worlds[requestedWorld] || []);

        if (users[username].inventory) {
            socket.emit('loadInventory', users[username].inventory);
        }
        if (users[username].quests) {
            socket.emit('loadQuests', users[username].quests);
        }
        socket.emit('loadCoinsCards', {
            coins: users[username].coins || 0,
            cards: users[username].cards || { blocks: {}, skins: ['#ff0000'] },
            color: users[username].color || color,
            clicker: users[username].clicker || { total: 0, buildings: { pioche: 0, steve: 0, four: 0, mine: 0, villageois: 0 } }
        });

        const friendsWithStatus = (users[username].friends || []).map(f => {
            const isOnline = Object.values(players).some(p => p.username === f);
            const isConnected = Object.values(io.sockets.sockets).some(s => s.username === f);
            const pObj = Object.values(players).find(p => p.username === f);
            return {
                name: f,
                online: isConnected,
                server: isOnline ? (pObj?.world || "Alpha") : (isConnected ? "Menu" : null)
            };
        });
        socket.emit('updateFriendsData', { friends: friendsWithStatus, requests: users[username].friendRequests || [] });
        notifyFriendsStatus(username, true);

        socket.to(`world_${requestedWorld}`).emit('playerJoined', players[socket.id]);
        io.to(`world_${requestedWorld}`).emit('chatMessage', { user: 'Système', text: `${username} a rejoint le monde ${requestedWorld} !` });
        socket.emit('authSuccess', players[socket.id]);
    });

    // --- PLAYER MOVEMENT ---
    socket.on('playerMove', (data) => {
        if (players[socket.id]) {
            players[socket.id].x = data.x;
            players[socket.id].y = data.y;
            players[socket.id].z = data.z;
            players[socket.id].rotation = data.rotation;
            socket.to(`world_${players[socket.id].world}`).emit('playerMoved', { id: socket.id, ...data });
        }
    });

    // --- BLOCKS (VOXEL ENGINE) ---
    socket.on('placeBlock', (block) => {
        const w = players[socket.id]?.world || socket.currentWorld || "Alpha";
        if (!worlds[w]) worlds[w] = [];
        worlds[w].push(block);
        socket.to(`world_${w}`).emit('blockPlaced', block);
    });

    socket.on('removeBlock', (pos) => {
        const w = players[socket.id]?.world || socket.currentWorld || "Alpha";
        if (!worlds[w]) return;
        const idx = worlds[w].findIndex(b => b.x === pos.x && b.y === pos.y && b.z === pos.z);
        if (idx !== -1) {
            worlds[w].splice(idx, 1);
            socket.to(`world_${w}`).emit('blockRemoved', pos);
        }
    });

    // --- CHAT ---
    socket.on('chatMessage', (msg) => {
        if (players[socket.id]) {
            msg.isAdmin = players[socket.id].isAdmin;
            const w = players[socket.id].world || "Alpha";
            io.to(`world_${w}`).emit('chatMessage', msg);
        } else {
            io.emit('chatMessage', msg);
        }
    });

    // --- INVENTORY & SAVE ---
    socket.on('saveInventory', (invData) => {
        const username = socket.username || players[socket.id]?.username;
        if (username) {
            updateUserRaw(username, (u) => { u.inventory = invData; });
        }
    });

    socket.on('saveQuests', (data) => {
        const username = socket.username || players[socket.id]?.username;
        if (username && data) {
            updateUserRaw(username, (u) => {
                if (data.stats) u.stats = data.stats;
                if (data.claimedQuests) u.quests = data.claimedQuests;
            });
        }
    });

    socket.on('saveCoinsCards', (data) => {
        const username = socket.username || players[socket.id]?.username;
        if (username && data) {
            updateUserRaw(username, (u) => {
                if (data.coins !== undefined) u.coins = data.coins;
                if (data.cards !== undefined) u.cards = data.cards;
                if (data.color) u.color = data.color;
                if (data.clicker) u.clicker = data.clicker;
            });
        }
    });

    socket.on('syncOfflineData', (data) => {
        const username = socket.username || players[socket.id]?.username;
        if (!username || !users[username]) return;

        let changed = false;
        if (data.coins !== undefined && data.coins > (users[username].coins || 0)) {
            users[username].coins = data.coins;
            changed = true;
        }
        if (data.clicker && data.clicker.total > (users[username].clicker?.total || 0)) {
            if (!users[username].clicker) users[username].clicker = { total: 0, buildings: {} };
            users[username].clicker.total = data.clicker.total;
            for (const type in data.clicker.buildings) {
                if (data.clicker.buildings[type] > (users[username].clicker.buildings[type] || 0)) {
                    users[username].clicker.buildings[type] = data.clicker.buildings[type];
                }
            }
            changed = true;
        }
        if (changed) saveUsers();
        socket.emit('syncResult', { coins: users[username].coins, clicker: users[username].clicker });
    });

    // --- FRIENDS & TRADES ---
    socket.on('searchPlayer', (query) => {
        const myName = socket.username || players[socket.id]?.username;
        const results = Object.keys(users).filter(u => u.toLowerCase().includes((query || '').toLowerCase()) && u !== myName);
        socket.emit('searchResults', results);
    });

    socket.on('sendFriendRequest', (target) => {
        const sender = socket.username || players[socket.id]?.username;
        if (!sender || !users[target]) return;

        if (!users[target].friendRequests) users[target].friendRequests = [];
        if (!users[target].friends) users[target].friends = [];

        if (!users[target].friendRequests.includes(sender) && !users[target].friends.includes(sender)) {
            users[target].friendRequests.push(sender);
            saveUsers();
            const targetSockets = Object.values(io.sockets.sockets).filter(s => s.username === target);
            targetSockets.forEach(s => s.emit('updateFriendsData', { requests: users[target].friendRequests }));
            socket.emit('chatMessage', { user: 'Système', text: `Demande d'ami envoyée à ${target}.` });
        }
    });

    socket.on('handleFriendRequest', (data) => {
        const me = socket.username || players[socket.id]?.username;
        if (!me || !users[me]) return;

        if (data.action === 'accept') {
            if (!users[me].friends) users[me].friends = [];
            if (!users[me].friends.includes(data.target)) users[me].friends.push(data.target);

            if (users[data.target]) {
                if (!users[data.target].friends) users[data.target].friends = [];
                if (!users[data.target].friends.includes(me)) users[data.target].friends.push(me);
            }

            users[me].friendRequests = (users[me].friendRequests || []).filter(r => r !== data.target);
            saveUsers();

            notifyFriendsStatus(me, true);
            notifyFriendsStatus(data.target, true);
        } else {
            users[me].friendRequests = (users[me].friendRequests || []).filter(r => r !== data.target);
            saveUsers();
            socket.emit('updateFriendsData', { requests: users[me].friendRequests });
        }
    });

    // Trades
    socket.on('tradeRequest', (targetName) => {
        const targetSocket = Object.values(io.sockets.sockets).find(s => s.username === targetName);
        if (targetSocket) {
            targetSocket.emit('tradeRequestReceived', socket.username);
        }
    });

    socket.on('tradeAcceptInitial', (senderName) => {
        const senderSocket = Object.values(io.sockets.sockets).find(s => s.username === senderName);
        if (senderSocket) {
            senderSocket.emit('tradeStarted', { partner: socket.username });
            socket.emit('tradeStarted', { partner: senderName });
        }
    });

    socket.on('tradeUpdateOffer', (data) => {
        const partnerSocket = Object.values(io.sockets.sockets).find(s => s.username === data.partner);
        if (partnerSocket) partnerSocket.emit('tradePartnerUpdatedOffer', data.offer);
    });

    socket.on('tradeReady', (data) => {
        const partnerSocket = Object.values(io.sockets.sockets).find(s => s.username === data.partner);
        if (partnerSocket) partnerSocket.emit('tradePartnerReady', data.isReady);
    });

    socket.on('tradeExecute', (data) => {
        const partnerSocket = Object.values(io.sockets.sockets).find(s => s.username === data.partner);
        if (partnerSocket) {
            partnerSocket.emit('tradeCompleted', { received: data.myFinalOffer });
            socket.emit('tradeCompleted', { received: data.theirFinalOffer });
        }
    });

    socket.on('tradeCancel', (data) => {
        const partnerSocket = Object.values(io.sockets.sockets).find(s => s.username === data?.partner);
        if (partnerSocket) partnerSocket.emit('tradeCanceled');
    });

    // --- DISCONNECT ---
    socket.on('disconnect', () => {
        const username = socket.username || players[socket.id]?.username;
        if (players[socket.id]) {
            const p = players[socket.id];
            if (users[p.username]) {
                users[p.username].x = p.x;
                users[p.username].y = p.y;
                users[p.username].z = p.z;
                saveUsers();
            }
            io.to(`world_${p.world}`).emit('chatMessage', { user: 'Système', text: `${p.username} est parti.` });
            io.to(`world_${p.world}`).emit('playerLeft', socket.id);
            delete players[socket.id];
        }

        if (username) {
            setTimeout(() => notifyFriendsStatus(username, false), 150);
        }
    });
});

// Fallback index.html for SPA routing
app.get(/(.*)/, (req, res) => {
    const indexPath = path.join(clientDir, 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.sendFile(path.join(__dirname, 'no_files.html'));
    }
});

// Start listening
server.listen(PORT, () => {
    console.log(`===============================================`);
    console.log(`   🌍 GÉOCUBE SERVEUR EN LIGNE SUR LE PORT ${PORT} `);
    console.log(`   URL Locale : http://localhost:${PORT}`);
    console.log(`   Health Check : http://localhost:${PORT}/health`);
    console.log(`===============================================`);
});
