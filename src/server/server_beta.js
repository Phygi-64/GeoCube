const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});
const path = require('path');
const fs = require('fs');

const PORT = 30002; // Serveur 2 sur port différent

app.use(express.static(path.join(__dirname, '../client')));
app.use('/assets', express.static(path.join(__dirname, '../../assets')));

const players = {};
const worldBlocks = []; // {x, y, z, type}
const WORLD_FILE = path.join(__dirname, 'world2.json');

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
        console.error("Erreur chargement monde 2:", e);
    }
}

function saveWorld() {
    try {
        fs.writeFileSync(WORLD_FILE, JSON.stringify(worldBlocks));
        console.log("Monde 2 sauvegardé.");
    } catch (e) {
        console.error("Erreur sauvegarde monde 2:", e);
    }
}

// Auto-save every minute
setInterval(saveWorld, 60000);

// Save on exit
process.on('SIGINT', () => {
    console.log("Arrêt du serveur 2... Sauvegarde...");
    saveWorld();
    process.exit();
});

// --- AUTHENTICATION ---
const USERS_FILE = path.join(__dirname, 'users2.json');
let users = {};

if (fs.existsSync(USERS_FILE)) {
    try {
        users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    } catch (e) {
        console.error("Erreur lors de la lecture de users2.json", e);
    }
}

function saveUsers() {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

io.on('connection', (socket) => {
    socket.on('joinGame', (data) => {
        // Recharge les utilisateurs depuis le fichier pour prendre en compte les modifs manuelles (Admin)
        if (fs.existsSync(USERS_FILE)) {
            try {
                users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
            } catch (e) {
                console.error("Erreur lors de la relecture de users2.json", e);
            }
        }

        const username = data.username.trim();
        const password = data.password;
        const color = data.color || '#ff0000';

        if (!username) {
            socket.emit('authError', 'Pseudo requis');
            return;
        }

        // Check if user exists
        if (!users[username]) {
            // New user, set password
            users[username] = { password: password };
            saveUsers();
            console.log(`Nouvel utilisateur enregistré : ${username}`);
        } else {
            // Existing user, check password
            if (users[username].password !== password) {
                socket.emit('authError', 'Mot de passe incorrect');
                return;
            }
        }

        // Prevent double login
        const existing = Object.values(players).find(p => p.username === username);
        if (existing) {
            socket.emit('authError', 'Ce compte est déjà connecté');
            return;
        }

        players[socket.id] = {
            id: socket.id,
            username: username,
            color: color,
            isAdmin: users[username].isAdmin || false,
            x: 0, y: 1.7, z: 0
        };
        console.log(`${username} a rejoint (${color})`);

        socket.emit('currentPlayers', players);
        socket.emit('currentBlocks', worldBlocks);

        // --- PERSISTENT INVENTORY ---
        if (users[username].inventory) {
            socket.emit('loadInventory', users[username].inventory);
        }

        // --- PERSISTENT QUESTS ---
        if (users[username].quests) {
            socket.emit('loadQuests', users[username].quests);
        }

        socket.broadcast.emit('playerJoined', players[socket.id]);

        io.emit('chatMessage', { user: 'Système', text: `${username} a rejoint l'aventure !` });
        socket.emit('authSuccess', players[socket.id]);
    });

    socket.on('saveInventory', (invData) => {
        if (players[socket.id]) {
            const username = players[socket.id].username;
            if (users[username]) {
                users[username].inventory = invData;
                saveUsers();
            }
        }
    });

    socket.on('saveQuests', (questData) => {
        if (players[socket.id]) {
            const username = players[socket.id].username;
            if (users[username]) {
                users[username].quests = questData;
                saveUsers();
            }
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
        if (players[socket.id]) {
            io.emit('chatMessage', { user: 'Système', text: `${players[socket.id].username} est parti.` });
            io.emit('playerLeft', socket.id);
            delete players[socket.id];
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
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'no_files.html'));
});

http.listen(PORT, () => console.log(`GéoCube Serveur Beta tourne sur le port ${PORT}`));
