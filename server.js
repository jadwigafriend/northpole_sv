const express = require("express");
const WebSocket = require("ws");
const http = require("http");
const fs = require("fs");
const path = require("path");
const axios = require("axios");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT;
const STEAM_API_KEY = "YOUR_STEAM_API_KEY"; // 🔁 Replace this with your actual key

let clientCounter = 1;
const clients = new Map(); // clientId -> { socket, steamID, playerName, steamName, alias }

const LOG_FILE = path.join(__dirname, "commands.log");
const HISTORY_FILE = path.join(__dirname, "history.json");

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Fetch Steam name using Steam Web API
async function resolveSteamName(steamID) {
    if (!STEAM_API_KEY || steamID.startsWith("STEAM_")) return "Unavailable";
    try {
        const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${STEAM_API_KEY}&steamids=${steamID}`;
        const res = await axios.get(url);
        return res.data.response.players?.[0]?.personaname || "Unknown";
    } catch {
        return "Unknown";
    }
}

// Log command and append to history
function logCommand(entry) {
    const log = `[${entry.timestamp}] Delay: ${entry.delay}s\n${entry.code}\n\n`;
    fs.appendFileSync(LOG_FILE, log);
    let history = [];
    if (fs.existsSync(HISTORY_FILE)) {
        try {
            history = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf-8"));
        } catch {}
    }
    history.push(entry);
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}

// WebSocket connection handler
wss.on("connection", (ws) => {
    const clientId = `client_${clientCounter++}`;
    clients.set(clientId, {
        socket: ws,
        steamID: "Unknown",
        playerName: "Unknown",
        steamName: "Resolving...",
        alias: ""
    });

    console.log(`[WebSocket] ${clientId} connected.`);

    ws.clientId = clientId;

    ws.on("message", async (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === "identify") {
                const client = clients.get(clientId);
                client.playerName = data.playerName || "Unknown";
                client.steamID = data.steamID || "Unknown";
                client.steamName = await resolveSteamName(data.steamID);
                console.log(`[Client ${clientId}] Identified as ${client.steamName} (${client.playerName})`);
            }
        } catch (err) {
            console.warn(`[Client ${clientId}] Invalid message.`);
        }
    });

    ws.on("close", () => {
        clients.delete(clientId);
        console.log(`[WebSocket] ${clientId} disconnected.`);
    });
});

// POST /send — broadcast Lua code to all clients
app.post("/send", (req, res) => {
    const { code, delay } = req.body;
    if (!code || typeof code !== "string") return res.status(400).send("Invalid code.");

    const payload = {
        id: "cmd_" + Date.now(),
        run_at: Math.floor(Date.now() / 1000) + (delay || 0),
        code
    };

    const entry = {
        code,
        delay: delay || 0,
        timestamp: new Date().toISOString()
    };

    const json = JSON.stringify(payload);
    for (const [, client] of clients.entries()) {
        try {
            client.socket.send(json);
        } catch (err) {
            console.warn(`Failed to send to ${client.clientId}:`, err);
        }
    }

    logCommand(entry);
    res.send("OK");
});

// POST /terminate — send kill signal and disconnect a client
app.post("/terminate", (req, res) => {
    const { clientId } = req.body;
    const client = clients.get(clientId);
    if (!client) return res.status(404).send("Client not found");

    try {
        client.socket.send(JSON.stringify({ kill: true }));
        client.socket.close();
        clients.delete(clientId);
        res.send("Terminated");
    } catch (err) {
        console.error(`Failed to terminate ${clientId}:`, err);
        res.status(500).send("Termination failed");
    }
});

// POST /alias — set custom alias for a client
app.post("/alias", (req, res) => {
    const { clientId, alias } = req.body;
    const client = clients.get(clientId);
    if (!client) return res.status(404).send("Client not found");
    client.alias = alias || "";
    res.send("Alias set");
});

// GET /clients — return metadata for each connected client
app.get("/clients", (req, res) => {
    const result = [];
    for (const [id, info] of clients.entries()) {
        result.push({
            id,
            steamID: info.steamID,
            playerName: info.playerName,
            steamName: info.steamName,
            alias: info.alias
        });
    }
    res.json(result);
});

// GET /history — get command history
app.get("/history", (req, res) => {
    if (fs.existsSync(HISTORY_FILE)) {
        try {
            const history = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf-8"));
            return res.json(history);
        } catch {}
    }
    res.json([]);
});

// Start server
server.listen(PORT, () => {
    console.log(`🧠 RemoteExec server running at http://localhost:${PORT}`);
});
