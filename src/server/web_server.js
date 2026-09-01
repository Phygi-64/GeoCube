const express = require('express');
const path = require('path');
const app = express();
const PORT = 30000;

app.use(express.static(path.join(__dirname, '../client')));
app.use('/assets', express.static(path.join(__dirname, '../../assets')));

app.get(/(.*)/, (req, res) => {
    res.sendFile(path.join(__dirname, '../client/index.html'));
});

app.listen(PORT, () => {
    console.log(`GéoCube Web Server tourne sur http://geocube.duckdns.org:${PORT}`);
});
