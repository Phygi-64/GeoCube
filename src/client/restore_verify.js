const fs = require('fs');
const path = require('path');
const clientJsPath = path.join(__dirname, 'client.js');
let content = fs.readFileSync(clientJsPath, 'utf8');

content = content.replace(/    if \(socket\.connected\) flushPendingJoin\(\);\n    if \(socket\) socket\.disconnect\(\);/, 
`    if (socket.connected) flushPendingJoin();
};

window.verifyCredentials = function (type) {
    skipSyncUntilAuthReady = false;
    // In app mode, always connect to the fixed server
    let host = window.isApp ? 'geocube.duckdns.org' : window.location.hostname;
    let port = '30001';

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
                    host = customVal; port = '30001';
                }
            }
        }
        if (port === 'custom' || !port) port = '30001';
    }

    const pseudo = localStorage.getItem('geocube_username');
    const password = localStorage.getItem('geocube_password');
    if (!pseudo || !password) return;
    if (socket) socket.disconnect();`);

fs.writeFileSync(clientJsPath, content);
console.log("Restored verifyCredentials.");
