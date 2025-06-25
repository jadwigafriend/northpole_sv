const WebSocket = require("ws");
const readline = require("readline");

const wss = new WebSocket.Server({ port: 3000 });
const clients = new Set();

wss.on("connection", ws => {
    clients.add(ws);
    console.log("Client connected. Total:", clients.size);

    ws.on("close", () => {
        clients.delete(ws);
        console.log("Client disconnected. Total:", clients.size);
    });
});

console.log("WebSocket server started on ws://localhost:3000");

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function sendCodeToClients(code, delay = 3) {
    const payload = {
        id: "cmd_" + Date.now(),
        run_at: Math.floor(Date.now() / 1000) + delay, // Unix timestamp
        code
    };

    const json = JSON.stringify(payload);
    for (const client of clients) {
        client.send(json);
    }

    console.log(`Sent command to ${clients.size} client(s). Will run in ${delay} seconds.`);
}

function prompt() {
    rl.question("> Lua Code: ", line => {
        sendCodeToClients(line);
        prompt();
    });
}

prompt();
