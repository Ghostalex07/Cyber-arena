import express from "express";
import { createServer } from "http";
import { Server, Socket } from "socket.io";
import { createServer as createViteServer } from "vite";
import { nanoid } from "nanoid";

// --- Types & Constants ---
interface Player {
  id: string;
  name: string;
  x: number;
  y: number;
  angle: number;
  color: string;
  health: number;
  score: number;
  lastShot: number;
  speed: number;
  fireRate: number;
  isShielded: boolean;
}

interface Bullet {
  id: string;
  playerId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  damage: number;
  color: string;
}

interface PowerUp {
  id: string;
  type: "speed" | "fireRate" | "shield" | "health";
  x: number;
  y: number;
}

const ARENA_WIDTH = 2500;
const ARENA_HEIGHT = 2500;
const PLAYER_SIZE = 40;
const BULLET_SPEED = 12;
const POWERUP_SPAWN_INTERVAL = 8000;
const MAX_POWERUPS = 15;

// --- Game Engine ---
class GameEngine {
  players: Record<string, Player> = {};
  bullets: Bullet[] = [];
  powerUps: PowerUp[] = [];
  io: Server;

  constructor(io: Server) {
    this.io = io;
    this.startLoop();
    this.startPowerUpSpawner();
  }

  addPlayer(id: string, name: string) {
    const colors = ["#00f2ff", "#ff00ff", "#00ff00", "#ffff00", "#ff0000", "#ffffff", "#ff8800"];
    this.players[id] = {
      id,
      name: name.slice(0, 15) || `Pilot-${id.slice(0, 4)}`,
      x: Math.random() * (ARENA_WIDTH - 200) + 100,
      y: Math.random() * (ARENA_HEIGHT - 200) + 100,
      angle: 0,
      color: colors[Math.floor(Math.random() * colors.length)],
      health: 100,
      score: 0,
      lastShot: 0,
      speed: 5,
      fireRate: 350,
      isShielded: false,
    };
  }

  removePlayer(id: string) {
    delete this.players[id];
  }

  movePlayer(id: string, data: { x: number; y: number; angle: number }) {
    const player = this.players[id];
    if (player && player.health > 0) {
      player.x = Math.max(PLAYER_SIZE / 2, Math.min(ARENA_WIDTH - PLAYER_SIZE / 2, data.x));
      player.y = Math.max(PLAYER_SIZE / 2, Math.min(ARENA_HEIGHT - PLAYER_SIZE / 2, data.y));
      player.angle = data.angle;
    }
  }

  shoot(id: string) {
    const player = this.players[id];
    if (player && player.health > 0) {
      const now = Date.now();
      if (now - player.lastShot > player.fireRate) {
        player.lastShot = now;
        const vx = Math.cos(player.angle) * BULLET_SPEED;
        const vy = Math.sin(player.angle) * BULLET_SPEED;
        this.bullets.push({
          id: nanoid(),
          playerId: id,
          x: player.x + Math.cos(player.angle) * 35,
          y: player.y + Math.sin(player.angle) * 35,
          vx,
          vy,
          damage: 15,
          color: player.color,
        });
      }
    }
  }

  private startPowerUpSpawner() {
    setInterval(() => {
      if (this.powerUps.length < MAX_POWERUPS) {
        const types: PowerUp["type"][] = ["speed", "fireRate", "shield", "health"];
        this.powerUps.push({
          id: nanoid(),
          type: types[Math.floor(Math.random() * types.length)],
          x: Math.random() * (ARENA_WIDTH - 200) + 100,
          y: Math.random() * (ARENA_HEIGHT - 200) + 100,
        });
      }
    }, POWERUP_SPAWN_INTERVAL);
  }

  private update() {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.x += b.vx;
      b.y += b.vy;

      if (b.x < 0 || b.x > ARENA_WIDTH || b.y < 0 || b.y > ARENA_HEIGHT) {
        this.bullets.splice(i, 1);
        continue;
      }

      let hit = false;
      for (const pid in this.players) {
        const p = this.players[pid];
        if (p.id === b.playerId || p.health <= 0) continue;

        if (Math.hypot(p.x - b.x, p.y - b.y) < PLAYER_SIZE / 2 + 5) {
          hit = true;
          if (p.isShielded) {
            p.isShielded = false;
            this.io.to(p.id).emit("feedback", { type: "shield_break" });
          } else {
            p.health -= b.damage;
            this.io.to(p.id).emit("feedback", { type: "hit", damage: b.damage });
            if (p.health <= 0) {
              p.health = 0;
              const killer = this.players[b.playerId];
              if (killer) {
                killer.score += 100;
                this.io.emit("kill_event", { killer: killer.name, victim: p.name });
              }
              this.respawnPlayer(p.id);
            }
          }
          this.bullets.splice(i, 1);
          break;
        }
      }
    }

    for (const pid in this.players) {
      const p = this.players[pid];
      if (p.health <= 0) continue;
      for (let i = this.powerUps.length - 1; i >= 0; i--) {
        const pu = this.powerUps[i];
        if (Math.hypot(p.x - pu.x, p.y - pu.y) < PLAYER_SIZE) {
          this.applyPowerUp(p, pu.type);
          this.powerUps.splice(i, 1);
          this.io.to(p.id).emit("feedback", { type: "powerup", powerup: pu.type });
        }
      }
    }

    this.io.emit("state", { players: this.players, bullets: this.bullets, powerUps: this.powerUps });
  }

  private applyPowerUp(p: Player, type: PowerUp["type"]) {
    switch (type) {
      case "speed": p.speed = Math.min(p.speed + 1.5, 12); break;
      case "fireRate": p.fireRate = Math.max(p.fireRate - 60, 120); break;
      case "shield": p.isShielded = true; break;
      case "health": p.health = Math.min(p.health + 40, 100); break;
    }
  }

  private respawnPlayer(id: string) {
    setTimeout(() => {
      const p = this.players[id];
      if (p) {
        p.health = 100;
        p.x = Math.random() * (ARENA_WIDTH - 200) + 100;
        p.y = Math.random() * (ARENA_HEIGHT - 200) + 100;
        p.speed = 5;
        p.fireRate = 350;
        p.isShielded = false;
      }
    }, 3000);
  }

  private startLoop() {
    setInterval(() => this.update(), 1000 / 60);
  }
}

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, { cors: { origin: "*" } });
  const game = new GameEngine(io);

  io.on("connection", (socket: Socket) => {
    socket.on("join", (name: string) => {
      game.addPlayer(socket.id, name);
      socket.emit("init", { id: socket.id, arena: { width: ARENA_WIDTH, height: ARENA_HEIGHT } });
    });
    socket.on("move", (data) => game.movePlayer(socket.id, data));
    socket.on("shoot", () => game.shoot(socket.id));
    socket.on("disconnect", () => game.removePlayer(socket.id));
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
  }

  httpServer.listen(3000, "0.0.0.0", () => console.log("Server active on port 3000"));
}

startServer();
