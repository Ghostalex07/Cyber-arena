import React, { useEffect, useState, useRef, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import { Stage, Layer, Rect, Circle, Text, Group, Line } from "react-konva";
import { motion, AnimatePresence } from "motion/react";
import { Trophy, Zap, Shield, Heart, Crosshair, Users, Target, MessageSquare, Skull } from "lucide-react";

// --- Types ---
interface Player {
  id: string;
  name: string;
  x: number;
  y: number;
  angle: number;
  color: string;
  health: number;
  score: number;
  speed: number;
  fireRate: number;
  isShielded: boolean;
}

interface Bullet {
  id: string;
  playerId: string;
  x: number;
  y: number;
  color: string;
}

interface PowerUp {
  id: string;
  type: "speed" | "fireRate" | "shield" | "health";
  x: number;
  y: number;
}

interface GameState {
  players: Record<string, Player>;
  bullets: Bullet[];
  powerUps: PowerUp[];
}

interface KillEvent {
  id: string;
  killer: string;
  victim: string;
  timestamp: number;
}

const PLAYER_SIZE = 40;

export default function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [myId, setMyId] = useState<string | null>(null);
  const [arena, setArena] = useState({ width: 2500, height: 2500 });
  const [name, setName] = useState("");
  const [joined, setJoined] = useState(false);
  const [windowSize, setWindowSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [killFeed, setKillFeed] = useState<KillEvent[]>([]);
  const [screenShake, setScreenShake] = useState(0);

  const stageRef = useRef<any>(null);
  const keysPressed = useRef<Record<string, boolean>>({});
  const lastUpdateRef = useRef<number>(Date.now());
  const lerpState = useRef<GameState | null>(null);

  useEffect(() => {
    const handleResize = () => setWindowSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    const newSocket = io();
    setSocket(newSocket);

    newSocket.on("init", (data: { id: string; arena: { width: number; height: number } }) => {
      setMyId(data.id);
      setArena(data.arena);
    });

    newSocket.on("state", (state: GameState) => {
      setGameState(state);
      lastUpdateRef.current = Date.now();
    });

    newSocket.on("kill_event", (data: { killer: string; victim: string }) => {
      const event = { ...data, id: Math.random().toString(), timestamp: Date.now() };
      setKillFeed(prev => [event, ...prev].slice(0, 5));
    });

    newSocket.on("feedback", (data: { type: string; damage?: number; powerup?: string }) => {
      if (data.type === "hit") {
        setScreenShake(10);
        setTimeout(() => setScreenShake(0), 100);
      }
    });

    return () => {
      newSocket.disconnect();
    };
  }, []);

  const handleJoin = () => {
    if (socket && name.trim()) {
      socket.emit("join", name);
      setJoined(true);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    keysPressed.current[e.key.toLowerCase()] = true;
  };

  const handleKeyUp = (e: KeyboardEvent) => {
    keysPressed.current[e.key.toLowerCase()] = false;
  };

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  // Movement loop (Client-side prediction + Server sync)
  useEffect(() => {
    if (!joined || !socket || !gameState || !myId) return;

    const interval = setInterval(() => {
      const me = gameState.players[myId];
      if (!me || me.health <= 0) return;

      let dx = 0;
      let dy = 0;
      if (keysPressed.current["w"] || keysPressed.current["arrowup"]) dy -= me.speed;
      if (keysPressed.current["s"] || keysPressed.current["arrowdown"]) dy += me.speed;
      if (keysPressed.current["a"] || keysPressed.current["arrowleft"]) dx -= me.speed;
      if (keysPressed.current["d"] || keysPressed.current["arrowright"]) dx += me.speed;

      if (dx !== 0 || dy !== 0) {
        if (dx !== 0 && dy !== 0) {
          const factor = 1 / Math.sqrt(2);
          dx *= factor;
          dy *= factor;
        }

        const stage = stageRef.current;
        if (stage) {
          const pointer = stage.getPointerPosition();
          if (pointer) {
            const angle = Math.atan2(
              pointer.y - windowSize.height / 2,
              pointer.x - windowSize.width / 2
            );
            socket.emit("move", { x: me.x + dx, y: me.y + dy, angle });
          }
        }
      }
    }, 1000 / 60);

    return () => clearInterval(interval);
  }, [joined, socket, gameState, myId, windowSize]);

  const handleMouseDown = () => {
    if (socket && joined) {
      socket.emit("shoot");
    }
  };

  const handleMouseMove = useCallback(() => {
    if (!joined || !socket || !gameState || !myId) return;
    const me = gameState.players[myId];
    if (!me || me.health <= 0) return;

    const stage = stageRef.current;
    if (stage) {
      const pointer = stage.getPointerPosition();
      if (pointer) {
        const angle = Math.atan2(
          pointer.y - windowSize.height / 2,
          pointer.x - windowSize.width / 2
        );
        socket.emit("move", { x: me.x, y: me.y, angle });
      }
    }
  }, [joined, socket, gameState, myId, windowSize]);

  if (!joined) {
    return (
      <div className="min-h-screen bg-[#050505] flex items-center justify-center p-4 font-sans text-white overflow-hidden relative">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-cyan-500/10 blur-[120px] rounded-full animate-pulse" />
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-fuchsia-500/10 blur-[120px] rounded-full animate-pulse" />
        </div>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-zinc-900/90 backdrop-blur-2xl p-10 rounded-[2.5rem] border border-white/10 shadow-[0_0_50px_rgba(0,0,0,0.5)] relative z-10"
        >
          <div className="flex justify-center mb-8">
            <div className="p-5 bg-cyan-500/20 rounded-3xl border border-cyan-500/30 shadow-[0_0_20px_rgba(6,182,212,0.2)]">
              <Crosshair className="w-14 h-14 text-cyan-400" />
            </div>
          </div>
          
          <h1 className="text-5xl font-black text-center mb-2 tracking-tighter bg-gradient-to-br from-cyan-400 via-white to-fuchsia-400 bg-clip-text text-transparent italic">
            NEON STRIKE
          </h1>
          <p className="text-zinc-500 text-center mb-10 font-bold uppercase tracking-[0.2em] text-[10px]">Cyber Arena v2.0</p>

          <div className="space-y-6">
            <div className="relative">
              <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 mb-3 ml-1">
                Pilot Callsign
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="IDENTIFY YOURSELF..."
                className="w-full bg-black/60 border border-white/10 rounded-2xl px-6 py-4 text-white placeholder:text-zinc-800 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 transition-all font-mono text-sm tracking-widest"
                onKeyDown={(e) => e.key === "Enter" && handleJoin()}
              />
            </div>
            
            <button
              onClick={handleJoin}
              disabled={!name.trim()}
              className="w-full bg-gradient-to-br from-cyan-400 to-cyan-600 hover:from-cyan-300 hover:to-cyan-500 text-black font-black py-5 rounded-2xl shadow-[0_10px_30px_rgba(6,182,212,0.3)] transition-all active:scale-[0.98] disabled:opacity-30 disabled:cursor-not-allowed uppercase tracking-[0.3em] text-xs"
            >
              Enter Arena
            </button>
          </div>

          <div className="mt-10 pt-8 border-t border-white/5 grid grid-cols-2 gap-4">
            <div className="flex flex-col items-center gap-2 p-4 bg-white/5 rounded-2xl border border-white/5">
              <Users className="w-5 h-5 text-fuchsia-400" />
              <span className="text-[10px] text-zinc-500 font-black uppercase tracking-widest">Global Net</span>
            </div>
            <div className="flex flex-col items-center gap-2 p-4 bg-white/5 rounded-2xl border border-white/5">
              <Zap className="w-5 h-5 text-yellow-400" />
              <span className="text-[10px] text-zinc-500 font-black uppercase tracking-widest">Low Latency</span>
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  const me = myId && gameState?.players[myId];
  const sortedPlayers = gameState ? Object.values(gameState.players).sort((a, b) => b.score - a.score) : [];

  return (
    <div className="h-screen w-screen bg-[#050505] overflow-hidden relative cursor-crosshair font-sans">
      <Stage
        width={windowSize.width}
        height={windowSize.height}
        ref={stageRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        style={{ transform: `translate(${Math.random() * screenShake}px, ${Math.random() * screenShake}px)` }}
      >
        <Layer>
          <Group x={me ? -me.x + windowSize.width / 2 : 0} y={me ? -me.y + windowSize.height / 2 : 0}>
            {/* Grid */}
            {Array.from({ length: 26 }).map((_, i) => (
              <React.Fragment key={i}>
                <Line points={[i * 100, 0, i * 100, arena.height]} stroke="#ffffff0a" strokeWidth={1} />
                <Line points={[0, i * 100, arena.width, i * 100]} stroke="#ffffff0a" strokeWidth={1} />
              </React.Fragment>
            ))}
            
            <Rect x={0} y={0} width={arena.width} height={arena.height} stroke="#00f2ff22" strokeWidth={8} />

            {/* Powerups */}
            {gameState?.powerUps.map((pu) => (
              <Group key={pu.id} x={pu.x} y={pu.y}>
                <Circle
                  radius={18}
                  fill={
                    pu.type === "speed" ? "#eab308" :
                    pu.type === "fireRate" ? "#a855f7" :
                    pu.type === "shield" ? "#3b82f6" : "#ef4444"
                  }
                  shadowBlur={15}
                  shadowColor={
                    pu.type === "speed" ? "#eab308" :
                    pu.type === "fireRate" ? "#a855f7" :
                    pu.type === "shield" ? "#3b82f6" : "#ef4444"
                  }
                />
                <Text text={pu.type[0].toUpperCase()} fontSize={14} fill="white" fontStyle="900" x={-5} y={-7} />
              </Group>
            ))}

            {/* Bullets */}
            {gameState?.bullets.map((b) => (
              <Circle key={b.id} x={b.x} y={b.y} radius={5} fill={b.color} shadowBlur={12} shadowColor={b.color} />
            ))}

            {/* Players */}
            {Object.values(gameState?.players || {}).map((p) => (
              <Group key={p.id} x={p.x} y={p.y} rotation={(p.angle * 180) / Math.PI}>
                <Rect
                  x={-PLAYER_SIZE / 2}
                  y={-PLAYER_SIZE / 2}
                  width={PLAYER_SIZE}
                  height={PLAYER_SIZE}
                  fill={p.health > 0 ? p.color + "11" : "#1a1a1a"}
                  stroke={p.health > 0 ? p.color : "#333"}
                  strokeWidth={3}
                  cornerRadius={6}
                  shadowBlur={p.health > 0 ? 20 : 0}
                  shadowColor={p.color}
                />
                <Rect x={0} y={-5} width={35} height={10} fill={p.health > 0 ? p.color : "#333"} cornerRadius={3} />
                {p.isShielded && <Circle radius={PLAYER_SIZE * 0.9} stroke="#3b82f6" strokeWidth={3} dash={[8, 8]} />}
                
                <Group rotation={-(p.angle * 180) / Math.PI}>
                  <Text
                    text={p.name}
                    y={-PLAYER_SIZE - 15}
                    width={120}
                    align="center"
                    x={-60}
                    fill="white"
                    fontSize={13}
                    fontStyle="900"
                    letterSpacing={1}
                  />
                  <Rect x={-25} y={-PLAYER_SIZE - 2} width={50} height={5} fill="#111" cornerRadius={2} />
                  <Rect
                    x={-25}
                    y={-PLAYER_SIZE - 2}
                    width={(p.health / 100) * 50}
                    height={5}
                    fill={p.health > 50 ? "#22c55e" : p.health > 25 ? "#eab308" : "#ef4444"}
                    cornerRadius={2}
                  />
                </Group>
              </Group>
            ))}
          </Group>
        </Layer>
      </Stage>

      {/* UI: Stats */}
      <div className="absolute top-8 left-8 flex flex-col gap-6 pointer-events-none">
        <div className="bg-black/80 backdrop-blur-xl border border-white/10 p-5 rounded-[2rem] flex items-center gap-5 shadow-2xl">
          <div className="p-3 bg-cyan-500/20 rounded-2xl border border-cyan-500/30">
            <Target className="w-6 h-6 text-cyan-400" />
          </div>
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 mb-1">Combat Score</div>
            <div className="text-3xl font-black text-white tabular-nums italic tracking-tighter">{me?.score || 0}</div>
          </div>
        </div>

        {me && (
          <div className="bg-black/80 backdrop-blur-xl border border-white/10 p-6 rounded-[2rem] flex flex-col gap-5 shadow-2xl w-72">
            <div className="flex items-center gap-4">
              <Heart className={`w-5 h-5 ${me.health > 30 ? "text-green-400" : "text-red-500 animate-pulse"}`} />
              <div className="h-3 flex-1 bg-zinc-900 rounded-full overflow-hidden border border-white/5">
                <motion.div 
                  initial={{ width: "100%" }}
                  animate={{ width: `${me.health}%` }}
                  className={`h-full ${me.health > 50 ? "bg-green-500" : me.health > 25 ? "bg-yellow-500" : "bg-red-500"}`}
                />
              </div>
              <span className="text-xs font-black text-white w-10 tabular-nums">{me.health}%</span>
            </div>
            
            <div className="flex gap-3">
              <div className={`flex-1 p-3 rounded-2xl border flex items-center justify-center transition-all ${me.speed > 5 ? "bg-yellow-500/20 border-yellow-500/30 shadow-[0_0_15px_rgba(234,179,8,0.2)]" : "bg-white/5 border-white/5"}`}>
                <Zap className={`w-5 h-5 ${me.speed > 5 ? "text-yellow-400" : "text-zinc-700"}`} />
              </div>
              <div className={`flex-1 p-3 rounded-2xl border flex items-center justify-center transition-all ${me.isShielded ? "bg-blue-500/20 border-blue-500/30 shadow-[0_0_15px_rgba(59,130,246,0.2)]" : "bg-white/5 border-white/5"}`}>
                <Shield className={`w-5 h-5 ${me.isShielded ? "text-blue-400" : "text-zinc-700"}`} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* UI: Leaderboard */}
      <div className="absolute top-8 right-8 pointer-events-none">
        <div className="bg-black/80 backdrop-blur-xl border border-white/10 p-6 rounded-[2rem] w-72 shadow-2xl">
          <div className="flex items-center gap-3 mb-6">
            <Trophy className="w-5 h-5 text-yellow-400" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">Arena Rankings</span>
          </div>
          <div className="space-y-3">
            {sortedPlayers.slice(0, 5).map((p, i) => (
              <div key={p.id} className={`flex items-center justify-between p-3 rounded-2xl transition-all ${p.id === myId ? "bg-white/10 border border-white/10" : "bg-white/5"}`}>
                <div className="flex items-center gap-4">
                  <span className="text-[10px] font-black text-zinc-600 w-4">{i + 1}</span>
                  <div className="w-3 h-3 rounded-full shadow-[0_0_10px_currentColor]" style={{ backgroundColor: p.color, color: p.color }} />
                  <span className="text-xs font-bold text-white truncate max-w-[110px] tracking-tight">{p.name}</span>
                </div>
                <span className="text-xs font-black text-zinc-500 tabular-nums">{p.score}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* UI: Kill Feed */}
      <div className="absolute bottom-24 right-8 pointer-events-none flex flex-col gap-2 items-end">
        <AnimatePresence>
          {killFeed.map((kill) => (
            <motion.div
              key={kill.id}
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-black/60 backdrop-blur-md border border-white/10 px-4 py-2 rounded-xl flex items-center gap-3 shadow-lg"
            >
              <span className="text-xs font-bold text-cyan-400">{kill.killer}</span>
              <Skull className="w-3 h-3 text-zinc-500" />
              <span className="text-xs font-bold text-fuchsia-400">{kill.victim}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* UI: Controls */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 pointer-events-none">
        <div className="bg-black/60 backdrop-blur-md px-8 py-3 rounded-3xl border border-white/10 flex gap-10 shadow-xl">
          <div className="flex items-center gap-3">
            <div className="flex gap-1">
              {["W","A","S","D"].map(k => <kbd key={k} className="px-2 py-1 bg-white/10 rounded-lg text-[10px] font-black text-white border border-white/5">{k}</kbd>)}
            </div>
            <span className="text-[10px] text-zinc-500 uppercase font-black tracking-widest">Navigate</span>
          </div>
          <div className="flex items-center gap-3">
            <kbd className="px-3 py-1 bg-white/10 rounded-lg text-[10px] font-black text-white border border-white/5">MOUSE1</kbd>
            <span className="text-[10px] text-zinc-500 uppercase font-black tracking-widest">Fire</span>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {me && me.health <= 0 && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-red-950/40 backdrop-blur-md flex items-center justify-center z-50"
          >
            <div className="text-center">
              <motion.div
                animate={{ scale: [1, 1.1, 1] }}
                transition={{ repeat: Infinity, duration: 2 }}
              >
                <h2 className="text-8xl font-black text-red-500 mb-6 tracking-tighter italic drop-shadow-[0_0_30px_rgba(239,68,68,0.5)]">CRITICAL FAILURE</h2>
              </motion.div>
              <p className="text-white/60 font-black uppercase tracking-[0.5em] text-xs">Re-initializing neural link...</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
