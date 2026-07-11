import express from 'express';
import http from 'http';
import path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const PORT = 3000;

  // Signalling variables
  interface Client {
    ws: WebSocket;
    id: string;
    username: string;
    room: string;
  }

  const rooms: { [roomCode: string]: Client[] } = {};

  // Setup WS Server
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws: WebSocket) => {
    let clientInfo: Client | null = null;

    ws.on('message', (messageBuffer) => {
      try {
        const message = JSON.parse(messageBuffer.toString());
        
        if (message.type === 'join') {
          const { room, username } = message;
          const roomCode = String(room).trim().toLowerCase();
          const user = String(username).trim();

          if (!roomCode || !user) {
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid room code or username' }));
            return;
          }

          // Check if room already has 2 clients
          const existingRoom = rooms[roomCode] || [];
          if (existingRoom.length >= 2) {
            ws.send(JSON.stringify({ type: 'room-full', room: roomCode }));
            return;
          }

          const clientId = Math.random().toString(36).substring(2, 9);
          clientInfo = {
            ws,
            id: clientId,
            username: user,
            room: roomCode
          };

          // Register
          if (!rooms[roomCode]) {
            rooms[roomCode] = [];
          }
          rooms[roomCode].push(clientInfo);

          // Reply to joined client
          ws.send(JSON.stringify({
            type: 'joined',
            clientId,
            room: roomCode,
            peers: existingRoom.map(p => ({ id: p.id, username: p.username }))
          }));

          // Notify other peer
          existingRoom.forEach(peer => {
            peer.ws.send(JSON.stringify({
              type: 'peer-joined',
              peer: { id: clientId, username: user }
            }));
          });
          
          console.log(`[WS] ${user} (${clientId}) joined room: ${roomCode}`);
        } else if (clientInfo) {
          // Forward P2P signaling, call management, or fallback chat messages
          const { type } = message;
          if (['offer', 'answer', 'candidate', 'chat-fallback', 'toggle-media', 'call-ended', 'typing'].includes(type)) {
            const roomCode = clientInfo.room;
            const currentRoom = rooms[roomCode] || [];
            const otherPeer = currentRoom.find(p => p.id !== clientInfo!.id);
            if (otherPeer) {
              otherPeer.ws.send(JSON.stringify({
                senderId: clientInfo.id,
                senderUsername: clientInfo.username,
                ...message
              }));
            }
          }
        }
      } catch (err) {
        console.error('[WS] Error processing message:', err);
      }
    });

    ws.on('close', () => {
      if (clientInfo) {
        const roomCode = clientInfo.room;
        const currentRoom = rooms[roomCode] || [];
        // Remove client
        rooms[roomCode] = currentRoom.filter(p => p.id !== clientInfo!.id);
        
        console.log(`[WS] ${clientInfo.username} (${clientInfo.id}) left room: ${roomCode}`);

        // Notify other peer
        if (rooms[roomCode].length > 0) {
          rooms[roomCode].forEach(peer => {
            peer.ws.send(JSON.stringify({
              type: 'peer-left',
              peerId: clientInfo!.id,
              username: clientInfo!.username
            }));
          });
        } else {
          delete rooms[roomCode];
        }
      }
    });

    ws.on('error', (err) => {
      console.error('[WS] Client error:', err);
    });
  });

  // Upgrade handler
  server.on('upgrade', (request, socket, head) => {
    const url = request.url || '';
    if (url.includes('/ws')) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else {
      // Allow other protocols or let them hang. Since HMR is disabled,
      // other upgrade requests should be rare or benign.
    }
  });

  // API Route for system status/statistics
  app.get('/api/status', (req, res) => {
    const stats = Object.keys(rooms).map(code => ({
      room: code,
      users: rooms[code].map(p => p.username),
      count: rooms[code].length
    }));
    res.json({
      status: 'online',
      activeRooms: stats.length,
      rooms: stats
    });
  });

  let vite: any = null;
  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`[SERVER] Ready at http://0.0.0.0:${PORT} (env: ${process.env.NODE_ENV || 'development'})`);
  });
}

startServer().catch(err => {
  console.error('[SERVER] Critical startup error:', err);
});
