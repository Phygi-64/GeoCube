const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    pingTimeout: 60000,
    pingInterval: 25000,
    connectTimeout: 45000
});
const path = require('path');
const fs = require('fs');

const PORT = 30001;
const SERVER_NAME = "Alpha";

app.use(express.static(path.join(__dirname, '../client')));
app.use('/assets', express.static(path.join(__dirname, '../../assets')));

const players = {};
const worldBlocks = []; // {x, y, z, type}
let bornes = [];
const WORLD_FILE = path.join(__dirname, 'world_alpha.json');
const BORNES_FILE = path.join(__dirname, 'bornes.json');

if (fs.existsSync(BORNES_FILE)) {
    try {
        bornes = JSON.parse(fs.readFileSync(BORNES_FILE, 'utf8'));
    } catch (e) { console.log("Bornes file error:", e); }
}

function saveBornes() {
    fs.writeFileSync(BORNES_FILE, JSON.stringify(bornes, null, 2));
}

// --- LOAD WORLD ---
if (fs.existsSync(WORLD_FILE)) {
    try {
        const data = fs.readFileSync(WORLD_FILE, 'utf8');
        const loaded = JSON.parse(data);
        if (Array.isArray(loaded)) {
            loaded.forEach(b => worldBlocks.push(b));
            console.log(`Monde chargé : ${worldBlocks.length} blocs.`);
        }
    } catch (e) {
        console.error("Erreur chargement monde:", e);
    }
}

function saveWorld() {
    try {
        fs.writeFileSync(WORLD_FILE, JSON.stringify(worldBlocks));
        console.log("Monde sauvegardé.");
    } catch (e) {
        console.error("Erreur sauvegarde monde:", e);
    }
}

// Auto-save every minute
setInterval(saveWorld, 60000);

// Save on exit
process.on('SIGINT', () => {
    console.log("Arrêt du serveur... Sauvegarde...");
    saveWorld();
    process.exit();
});

process.on('uncaughtException', (err) => {
    console.error("ERREUR CRITIQUE (Non gérée):", err);
    saveWorld(); // Sauvegarde par précaution
});

process.on('unhandledRejection', (reason, promise) => {
    console.error("REJECTION NON GÉRÉE:", reason);
});

// --- AUTHENTICATION ---
const USERS_FILE = path.join(__dirname, 'users.json');
let users = {};

function migrateUser(u) {
    if (!users[u].v5_reset) {
        users[u].v5_reset = true;
        users[u].inventory = new Array(36).fill(null);
        users[u].cards = { blocks: {}, skins: ['#ff0000'] };
        users[u].coins = users[u].coins || 100;
        return true;
    }
    return false;
}

if (fs.existsSync(USERS_FILE)) {
    try {
        users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
        let modified = false;
        for (let u in users) {
             if (migrateUser(u)) modified = true;
        }
        if (modified) fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    } catch (e) {
        console.error("Erreur lors de la lecture de users.json", e);
    }
}





function saveUsers() {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// Function to safely update a single user in the file (merging with latest disk state)
function updateUserRaw(username, updateFn) {
    let currentUsers = {};
    if (fs.existsSync(USERS_FILE)) {
        try {
            currentUsers = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
        } catch (e) { console.error("Update error: Failed to read users.json", e); }
    }
    if (currentUsers[username] || username) {
        if (!currentUsers[username]) currentUsers[username] = {};
        updateFn(currentUsers[username]);
        fs.writeFileSync(USERS_FILE, JSON.stringify(currentUsers, null, 2));
        users = currentUsers; // Sync memory
    }
}


function notifyFriendsStatus(username, online) {
    if (!users[username] || !users[username].friends) return;
    users[username].friends.forEach(friendName => {
        const friendSocketId = Object.keys(io.sockets.sockets).find(id => io.sockets.sockets[id].username === friendName);
        if (friendSocketId) {
            const friendData = users[friendName];
            const friendsWithStatus = friendData.friends.map(f => {
                const isOnline = Object.values(players).some(p => p.username === f);
                const isConnected = Object.values(io.sockets.sockets).some(s => s.username === f);
                return { 
                    name: f, 
                    online: isConnected, 
                    server: isOnline ? SERVER_NAME : (isConnected ? "Menu" : null) 
                };
            });
            io.to(friendSocketId).emit('updateFriendsData', { friends: friendsWithStatus });
        }
    });
}

io.on('connection', (socket) => {
    socket.on('joinGame', (data) => {
        // Always re-read to allow for manual edits in the file
        if (fs.existsSync(USERS_FILE)) {
            try {
                users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
            } catch (e) { console.error("Login read error:", e); }
        }
        const username = data.username ? data.username.trim() : "";
        if (username && users[username]) {
            if (migrateUser(username)) saveUsers();
        }




        const password = data.password;
        const color = data.color || '#ff0000ff';
        const type = data.type || 'login';
        const menuOnly = data.menuOnly || false;

        if (!username) {
            socket.emit('authError', 'Pseudo requis');
            return;
        }

        if (type === 'register') {
            if (users[username]) {
                socket.emit('authError', 'Ce pseudo est déjà pris.');
                return;
            }
            updateUserRaw(username, (u) => {
                u.password = password;
                u.coins = 100;
                u.cards = { blocks: {}, skins: ['#ff0000'] };
                u.color = '#ff0000ff';
                u.inventory = new Array(36).fill(null);
                u.v5_reset = true;
            });
            console.log(`Nouvel utilisateur enregistré : ${username}`);
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

        // If just verifying credentials for the menu
        if (menuOnly) {
            socket.username = username;
            if (!users[username].friends) users[username].friends = [];
            if (!users[username].friendRequests) users[username].friendRequests = [];
            
            // Build friends list with status
            const friendsWithStatus = users[username].friends.map(f => {
                const isOnline = Object.values(players).some(p => p.username === f);
                const isConnected = Object.values(io.sockets.sockets).some(s => s.username === f);
                return { 
                    name: f, 
                    online: isConnected, 
                    server: isOnline ? SERVER_NAME : (isConnected ? "Menu" : null) 
                };
            });
            
            socket.emit('updateFriendsData', { friends: friendsWithStatus, requests: users[username].friendRequests });
            notifyFriendsStatus(username, true);
            console.log(`[LOGIN] Envoi des données pour ${username}: Coins=${users[username].coins || 0}, Cards=${Object.keys(users[username].cards?.blocks || {}).length} blocs`);
            socket.emit('loadCoinsCards', { 
                coins: users[username].coins || 0, 
                cards: users[username].cards || { blocks: {}, skins: ['#ff0000'] },
                color: users[username].color || '#ff0000ff',
                clicker: users[username].clicker || { total: 0, buildings: { pioche: 0, steve: 0, four: 0, mine: 0, villageois: 0 } }
            });
            socket.emit('bornesData', bornes);
            socket.emit('authSuccess', { username: username, isAdmin: users[username].isAdmin || false, menuOnly: true });


            return;
        }

        // Prevent double login
        const existing = Object.values(players).find(p => p.username === username);
        if (existing) {
            socket.emit('authError', 'Ce compte est déjà connecté.');
            return;
        }

        players[socket.id] = {
            id: socket.id,
            username: username,
            color: color,
            isAdmin: users[username].isAdmin || false,
            x: users[username].x || 0,
            y: users[username].y || 1.7,
            z: users[username].z || 0
        };

        socket.username = username;
        console.log(`${username} a rejoint (${color})`);

        socket.emit('currentPlayers', players);
        socket.emit('currentBlocks', worldBlocks);
        socket.emit('bornesData', bornes);

        // --- PERSISTENT INVENTORY ---
        if (users[username].inventory) {
            socket.emit('loadInventory', users[username].inventory);
        }

        // --- PERSISTENT QUESTS ---
        if (users[username].quests) {
            socket.emit('loadQuests', users[username].quests);
        }

        // --- PERSISTENT COINS AND CARDS ---
        socket.emit('loadCoinsCards', {
            coins: users[username].coins || 0,
            cards: users[username].cards || { blocks: {}, skins: ['#ff0000'] },
            color: users[username].color || '#ff0000ff',
            clicker: users[username].clicker || { total: 0, buildings: { pioche: 0, steve: 0, four: 0, mine: 0, villageois: 0 } }
        });


        // --- FRIENDS & REQUESTS ---
        if (!users[username].friends) users[username].friends = [];
        if (!users[username].friendRequests) users[username].friendRequests = [];
        
        const friendsWithStatus = users[username].friends.map(f => {
            const isOnline = Object.values(players).some(p => p.username === f);
            const isConnected = Object.values(io.sockets.sockets).some(s => s.username === f);
            return { 
                name: f, 
                online: isConnected, 
                server: isOnline ? SERVER_NAME : (isConnected ? "Menu" : null) 
            };
        });
        
        socket.emit('updateFriendsData', { friends: friendsWithStatus, requests: users[username].friendRequests });
        notifyFriendsStatus(username, true);

        socket.broadcast.emit('playerJoined', players[socket.id]);

        io.emit('chatMessage', { user: 'Système', text: `${username} a rejoint l'aventure !` });
        socket.emit('authSuccess', players[socket.id]);
    });

    socket.on('syncOfflineData', (data) => {
        const username = socket.username || players[socket.id]?.username;
        if (!username || !users[username]) return;

        console.log(`[SYNC] Synchronisation pour ${username}...`);
        
        let changed = false;
        // Coins sync (Keep the highest)
        if (data.coins !== undefined && data.coins > (users[username].coins || 0)) {
            users[username].coins = data.coins;
            changed = true;
        }

        // Clicker sync (Keep physical items from server, but total clicks can be synced if higher)
        if (data.clicker && data.clicker.total > (users[username].clicker?.total || 0)) {
            if (!users[username].clicker) users[username].clicker = { total: 0, buildings: {} };
            users[username].clicker.total = data.clicker.total;
            // Merging buildings: keep the maximum count for each type
            for (const type in data.clicker.buildings) {
                if (data.clicker.buildings[type] > (users[username].clicker.buildings[type] || 0)) {
                    users[username].clicker.buildings[type] = data.clicker.buildings[type];
                }
            }
            changed = true;
        }

        if (changed) {
            saveUsers();
            console.log(`[SYNC] Données mises à jour pour ${username}.`);
        }

        socket.emit('syncResult', {
            coins: users[username].coins,
            clicker: users[username].clicker
        });
    });

    socket.on('searchPlayer', (query) => {
        const myName = socket.username || players[socket.id]?.username;
        const results = Object.keys(users).filter(u => u.toLowerCase().includes(query.toLowerCase()) && u !== myName);
        socket.emit('searchResults', results);
    });

    socket.on('sendFriendRequest', (target) => {
        const sender = socket.username || players[socket.id]?.username;
        if (!sender) return;
        
        if (users[target]) {
            if (!users[target].friendRequests) users[target].friendRequests = [];
            if (!users[target].friends) users[target].friends = [];
            
            if (!users[target].friendRequests.includes(sender) && !users[target].friends.includes(sender)) {
                users[target].friendRequests.push(sender);
                saveUsers();
                // Notify target if online
                const targetSocketId = Object.keys(io.sockets.sockets).find(id => io.sockets.sockets[id].username === target);
                if (targetSocketId) {
                    io.to(targetSocketId).emit('updateFriendsData', { requests: users[target].friendRequests });
                }
                socket.emit('chatMessage', { user: 'Système', text: `Demande envoyée à ${target}.` });
                socket.emit('friendRequestSent', target);
            }
        }
    });

    socket.on('handleFriendRequest', (data) => {
        // data = { target: 'username', action: 'accept' or 'decline' }
        const me = socket.username || players[socket.id]?.username;
        if (!me) return;
        
        if (data.action === 'accept') {
            if (!users[me].friends) users[me].friends = [];
            if (!users[me].friends.includes(data.target)) users[me].friends.push(data.target);
            
            if (!users[data.target].friends) users[data.target].friends = [];
            if (!users[data.target].friends.includes(me)) users[data.target].friends.push(me);
            
            users[me].friendRequests = users[me].friendRequests.filter(r => r !== data.target);
            saveUsers();
            
            // Refresh my data
            const myFriendsWithStatus = users[me].friends.map(f => {
                const isOnline = Object.values(players).some(p => p.username === f);
                return { name: f, online: isOnline, server: isOnline ? "Alpha" : null };
            });
            socket.emit('updateFriendsData', { friends: myFriendsWithStatus, requests: users[me].friendRequests });
            
            // Notify target if online
            const targetSocketId = Object.keys(io.sockets.sockets).find(id => io.sockets.sockets[id].username === data.target);
            if (targetSocketId) {
                const targetFriendsWithStatus = users[data.target].friends.map(f => {
                    const isOnline = Object.values(players).some(p => p.username === f);
                    return { name: f, online: isOnline, server: isOnline ? "Alpha" : null };
                });
                io.to(targetSocketId).emit('updateFriendsData', { friends: targetFriendsWithStatus });
            }
        } else {
            users[me].friendRequests = users[me].friendRequests.filter(r => r !== data.target);
            saveUsers();
            socket.emit('updateFriendsData', { requests: users[me].friendRequests });
        }
    });

    socket.on('saveInventory', (invData) => {
        const username = socket.username || players[socket.id]?.username;
        if (username) {
            updateUserRaw(username, (u) => { u.inventory = invData; });
            console.log(`[SAVE] Inventaire enregistré pour ${username}`);
        }
    });




    socket.on('saveQuests', (data) => {
        const { stats: statsData, claimedQuests: questData } = data;
        const username = socket.username || players[socket.id]?.username;
        if (username) {
            updateUserRaw(username, (u) => {
                u.stats = statsData;
                u.quests = questData;
            });
            console.log(`[SAVE] Quêtes enregistrées pour ${username}`);
        }
    });



    socket.on('saveCoinsCards', (data) => {
        const username = socket.username || players[socket.id]?.username;
        if (username) {
            updateUserRaw(username, (u) => {
                if (data.coins !== undefined) u.coins = data.coins;
                if (data.cards !== undefined) u.cards = data.cards;
                if (data.color) u.color = data.color;
                if (data.clicker) u.clicker = data.clicker;
            });
            console.log(`[SAVE] Coins/Cards/Clicker enregistrées pour ${username}`);
        }
    });





    // --- TRADING SYSTEM ---
    socket.on('tradeRequest', (targetName) => {
        const targetSocketId = Object.keys(io.sockets.sockets).find(id => io.sockets.sockets[id].username === targetName);
        if (targetSocketId) {
            io.to(targetSocketId).emit('tradeRequestReceived', socket.username);
        }
    });

    socket.on('tradeAcceptInitial', (senderName) => {
        const senderSocketId = Object.keys(io.sockets.sockets).find(id => io.sockets.sockets[id].username === senderName);
        if (senderSocketId) {
            io.to(senderSocketId).emit('tradeStarted', { partner: socket.username });
            socket.emit('tradeStarted', { partner: senderName });
        }
    });

    socket.on('tradeUpdateOffer', (data) => {
        // data.partner, data.offer (array of items)
        const partnerSocketId = Object.keys(io.sockets.sockets).find(id => io.sockets.sockets[id].username === data.partner);
        if (partnerSocketId) {
            io.to(partnerSocketId).emit('tradePartnerUpdatedOffer', data.offer);
        }
    });

    socket.on('tradeReady', (data) => {
        // data.partner, data.isReady
        const partnerSocketId = Object.keys(io.sockets.sockets).find(id => io.sockets.sockets[id].username === data.partner);
        if (partnerSocketId) {
            io.to(partnerSocketId).emit('tradePartnerReady', data.isReady);
        }
    });

    socket.on('tradeExecute', (data) => {
        // data.partner, data.myFinalOffer, data.theirFinalOffer
        const partnerSocketId = Object.keys(io.sockets.sockets).find(id => io.sockets.sockets[id].username === data.partner);
        if (partnerSocketId) {
            io.to(partnerSocketId).emit('tradeCompleted', { received: data.myFinalOffer });
            socket.emit('tradeCompleted', { received: data.theirFinalOffer });
        }
    });

    socket.on('tradeCancel', (data) => {
        const partnerSocketId = Object.keys(io.sockets.sockets).find(id => io.sockets.sockets[id].username === data.partner);
        if (partnerSocketId) {
            io.to(partnerSocketId).emit('tradeCanceled');
        }
    });

    socket.on('playerMove', (data) => {
        if (players[socket.id]) {
            players[socket.id].x = data.x;
            players[socket.id].y = data.y;
            players[socket.id].z = data.z;
            players[socket.id].rotation = data.rotation; // {x, y, z}
            socket.broadcast.emit('playerMoved', { id: socket.id, ...data });
        }
    });

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
            io.emit('chatMessage', { user: 'Système', text: `${players[socket.id].username} est parti.` });
            io.emit('playerLeft', socket.id);
            delete players[socket.id];
        }

        if (username) {
            // Wait a bit to ensure socket is removed from lists if we check them
            setTimeout(() => notifyFriendsStatus(username, false), 100);
        }
    });

    socket.on('chatMessage', (msg) => {
        if (players[socket.id]) {
            msg.isAdmin = players[socket.id].isAdmin;
        }
        io.emit('chatMessage', msg);
    });

    // --- BLOCK SYNC ---
    socket.on('placeBlock', (block) => {
        // block = {x, y, z, type}
        worldBlocks.push(block);
        socket.broadcast.emit('blockPlaced', block);
    });

    socket.on('removeBlock', (pos) => {
        // pos = {x, y, z}
        const idx = worldBlocks.findIndex(b => b.x === pos.x && b.y === pos.y && b.z === pos.z);
        if (idx !== -1) {
            worldBlocks.splice(idx, 1);
            socket.broadcast.emit('blockRemoved', pos);
        }
    });
});

// --- 404 PAGE: NO FILES ---
// --- 404 PAGE: NO FILES ---
app.get(/(.*)/, (req, res) => {
    res.sendFile(path.join(__dirname, 'no_files.html'));
});

http.listen(PORT, () => console.log(`GéoCube Serveur Alpha tourne sur le port ${PORT}`));