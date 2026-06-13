// socket-server/index.js
// This is a STANDALONE Express + Socket.IO server.
// Deploy this separately to Render, Railway, or Fly.io (all free).
// Your Next.js app on Vercel connects to this server via NEXT_PUBLIC_SOCKET_URL.

const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");

const app = express();
const httpServer = createServer(app);

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";

const io = new Server(httpServer, {
  cors: {
    origin: ALLOWED_ORIGIN,
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["websocket", "polling"],
  pingTimeout: 60000,
  pingInterval: 25000,
});

app.use(express.json());

// Health check endpoint (important for Render free tier keepalive)
app.get("/", (req, res) => res.json({ status: "ok", server: "Mr. Worldwide Socket Server", uptime: process.uptime() }));
app.get("/health", (req, res) => res.json({ status: "ok" }));

// ─── In-Memory Game Store ─────────────────────────────────────────────────────
const games = new Map();       // roomCode → GameState
const playerRooms = new Map(); // socketId → roomCode

// ─── Board Data ───────────────────────────────────────────────────────────────
const TOTAL_TILES = 48;
const PLAYER_COLORS = ["red", "blue", "green", "yellow", "purple", "orange"];
const PLAYER_AVATARS = ["🚀", "🎩", "🦊", "🐉", "🌟", "🏆"];

const BOARD_TILES = [
  { id:  0, type: "start",        name: "START",        subname: "Collect $200", position: "top",    index: -1, color: "none" },
  { id: 12, type: "prison",       name: "In Prison",    subname: "Just Visiting",position: "top",    index: -1, color: "none" },
  { id: 24, type: "vacation",     name: "Vacation",     subname: "Skip 1 Turn",  position: "bottom", index: -1, color: "none" },
  { id: 36, type: "go-to-prison", name: "Go to Prison",                          position: "bottom", index: -1, color: "none" },

  // ── TOP ROW — left→right, ids 1–11 ───────────────────────────────────────
  // From image: Salvador $60, Treasure, Rio $60, Earnings Tax, Tel Aviv $100, TLV Airport $200, Haifa $100, Jerusalem $110, Surprise, Mumbai $120, New Delhi $130
  { id:  1, type: "property", name: "Salvador",  subname: "Brazil",    flagCode: "br", price: 60,  baseRent: 2,  rentLevels: [2,10,30,90,160,250],       color: "brown",    group: "south-america",  mortgageValue: 30,  houseCost: 50,  hotelCost: 50,  position: "top", index: 0 },
  { id:  2, type: "treasure", name: "Treasure",                                                                                                            color: "none",                                                                                                 position: "top", index: 1 },
  { id:  3, type: "property", name: "Rio",       subname: "Brazil",    flagCode: "br", price: 60,  baseRent: 2,  rentLevels: [2,10,30,90,160,250],       color: "brown",    group: "south-america",  mortgageValue: 30,  houseCost: 50,  hotelCost: 50,  position: "top", index: 2 },
  { id:  4, type: "tax",      name: "Earnings Tax", subname: "Pay 10%",               taxAmount: 0.1,                                                     color: "none",                                                                                                 position: "top", index: 3 },
  { id:  5, type: "property", name: "Tel Aviv",  subname: "Israel",    flagCode: "il", price: 100, baseRent: 6,  rentLevels: [6,30,90,270,400,550],      color: "lightblue",group: "israel",         mortgageValue: 50,  houseCost: 50,  hotelCost: 50,  position: "top", index: 4 },
  { id:  6, type: "airport",  name: "TLV Airport", subname: "Ben Gurion", flagCode: "il", price: 200,                                                     color: "none",                                                                                                 position: "top", index: 5 },
  { id:  7, type: "property", name: "Haifa",     subname: "Israel",    flagCode: "il", price: 100, baseRent: 6,  rentLevels: [6,30,90,270,400,550],      color: "lightblue",group: "israel",         mortgageValue: 50,  houseCost: 50,  hotelCost: 50,  position: "top", index: 6 },
  { id:  8, type: "property", name: "Jerusalem", subname: "Israel",    flagCode: "il", price: 110, baseRent: 8,  rentLevels: [8,40,100,300,450,600],     color: "lightblue",group: "israel",         mortgageValue: 55,  houseCost: 50,  hotelCost: 50,  position: "top", index: 7 },
  { id:  9, type: "surprise", name: "Surprise",                                                                                                            color: "none",                                                                                                 position: "top", index: 8 },
  { id: 10, type: "property", name: "Chittagong",    subname: "Bangladesh",     flagCode: "bd", price: 120, baseRent: 8,  rentLevels: [8,40,100,300,450,600],     color: "pink",     group: "india",          mortgageValue: 60,  houseCost: 50,  hotelCost: 50,  position: "top", index: 9 },
  { id: 11, type: "property", name: "Dhaka", subname: "Bangladesh",     flagCode: "bd", price: 130, baseRent: 10, rentLevels: [10,50,150,450,625,750],    color: "pink",     group: "india",          mortgageValue: 65,  houseCost: 50,  hotelCost: 50,  position: "top", index: 10 },

  // ── RIGHT COL — top→bottom, ids 13–23 ────────────────────────────────────
  // From image: Passing By (tax $130), Venice $140, Bologna $140, Electric Company, Milan $160, Rome $160, MUC Airport, Frankfurt $180, Treasure, Munich $180, Gas Company
  { id: 13, type: "tax",     name: "Passing By",    subname: "Pay $130",                             taxAmount: 130,                                      color: "none",                                                                                                 position: "right", index: 0  },
  { id: 14, type: "property",name: "Venice",        subname: "Italy",    flagCode: "it", price: 140, baseRent: 10, rentLevels: [10,50,150,450,625,750],  color: "orange",   group: "italy",          mortgageValue: 70,  houseCost: 100, hotelCost: 100, position: "right", index: 1  },
  { id: 15, type: "property",name: "Bologna",       subname: "Italy",    flagCode: "it", price: 140, baseRent: 10, rentLevels: [10,50,150,450,625,750],  color: "orange",   group: "italy",          mortgageValue: 70,  houseCost: 100, hotelCost: 100, position: "right", index: 2  },
  { id: 16, type: "utility", name: "Electric Company", subname: "Utility", flagCode: "gb", price: 150,                                                    color: "none",                                                                                                 position: "right", index: 3  },
  { id: 17, type: "property",name: "Milan",         subname: "Italy",    flagCode: "it", price: 160, baseRent: 12, rentLevels: [12,60,180,500,700,900],  color: "red",      group: "italy-north",    mortgageValue: 80,  houseCost: 100, hotelCost: 100, position: "right", index: 4  },
  { id: 18, type: "property",name: "Rome",          subname: "Italy",    flagCode: "it", price: 160, baseRent: 12, rentLevels: [12,60,180,500,700,900],  color: "red",      group: "italy-north",    mortgageValue: 80,  houseCost: 100, hotelCost: 100, position: "right", index: 5  },
  { id: 19, type: "airport", name: "MUC Airport",   subname: "Munich",   flagCode: "de", price: 200,                                                      color: "none",                                                                                                 position: "right", index: 6  },
  { id: 20, type: "property",name: "Frankfurt",     subname: "Germany",  flagCode: "de", price: 180, baseRent: 14, rentLevels: [14,70,200,550,750,950],  color: "yellow",   group: "germany",        mortgageValue: 90,  houseCost: 100, hotelCost: 100, position: "right", index: 7  },
  { id: 21, type: "treasure",name: "Treasure",                                                                                                             color: "none",                                                                                                 position: "right", index: 8  },
  { id: 22, type: "property",name: "Munich",        subname: "Germany",  flagCode: "de", price: 180, baseRent: 14, rentLevels: [14,70,200,550,750,950],  color: "yellow",   group: "germany",        mortgageValue: 90,  houseCost: 100, hotelCost: 100, position: "right", index: 9  },
  { id: 23, type: "utility", name: "Gas Company",   subname: "Utility",  flagCode: "de", price: 150,                                                      color: "none",                                                                                                 position: "right", index: 10 },

  // ── BOTTOM ROW — right→left, ids 25–35 ───────────────────────────────────
  // From image (right to left): Berlin $200, Surprise, Beijing $220, Shanghai $240, CDG Airport, Toulouse $260, Paris $260, Water Company, Yokohama $280, Tokyo $280, Treasure
  { id: 25, type: "property",name: "Berlin",        subname: "Germany",  flagCode: "de", price: 200, baseRent: 16, rentLevels: [16,80,220,600,800,1000], color: "yellow",   group: "germany",        mortgageValue: 100, houseCost: 150, hotelCost: 150, position: "bottom", index: 0  },
  { id: 26, type: "surprise",name: "Surprise",                                                                                                             color: "none",                                                                                                 position: "bottom", index: 1  },
  { id: 27, type: "property",name: "Beijing",       subname: "China",    flagCode: "cn", price: 220, baseRent: 18, rentLevels: [18,90,270,700,875,1050], color: "green",    group: "china",          mortgageValue: 110, houseCost: 150, hotelCost: 150, position: "bottom", index: 2  },
  { id: 28, type: "property",name: "Shanghai",      subname: "China",    flagCode: "cn", price: 240, baseRent: 20, rentLevels: [20,100,300,750,925,1100], color: "green",   group: "china",          mortgageValue: 120, houseCost: 150, hotelCost: 150, position: "bottom", index: 3  },
  { id: 29, type: "airport", name: "CDG Airport",   subname: "Paris",    flagCode: "fr", price: 200,                                                      color: "none",                                                                                                 position: "bottom", index: 4  },
  { id: 30, type: "property",name: "Toulouse",      subname: "France",   flagCode: "fr", price: 260, baseRent: 22, rentLevels: [22,110,330,800,975,1150], color: "darkblue", group: "france",        mortgageValue: 130, houseCost: 150, hotelCost: 150, position: "bottom", index: 5  },
  { id: 31, type: "property",name: "Paris",         subname: "France",   flagCode: "fr", price: 260, baseRent: 22, rentLevels: [22,110,330,800,975,1150], color: "darkblue", group: "france",        mortgageValue: 130, houseCost: 150, hotelCost: 150, position: "bottom", index: 6  },
  { id: 32, type: "utility", name: "Water Company", subname: "Utility",  flagCode: "fr", price: 150,                                                      color: "none",                                                                                                 position: "bottom", index: 7  },
  { id: 33, type: "property",name: "Yokohama",      subname: "Japan",    flagCode: "jp", price: 280, baseRent: 24, rentLevels: [24,120,360,850,1025,1200], color: "pink",   group: "japan",          mortgageValue: 140, houseCost: 200, hotelCost: 200, position: "bottom", index: 8  },
  { id: 34, type: "property",name: "Tokyo",         subname: "Japan",    flagCode: "jp", price: 280, baseRent: 24, rentLevels: [24,120,360,850,1025,1200], color: "pink",   group: "japan",          mortgageValue: 140, houseCost: 200, hotelCost: 200, position: "bottom", index: 9  },
  { id: 35, type: "treasure",name: "Treasure",                                                                                                             color: "none",                                                                                                 position: "bottom", index: 10 },

  // ── LEFT COL — bottom→top, ids 37–47 ─────────────────────────────────────
  // From image (bottom to top): Liverpool $240, Manchester $240, Treasure, Birmingham $280, London $320, JFK Airport, Los Angeles $300, Surprise, San Francisco $360, Premium Tax, New York $400
  { id: 37, type: "property",name: "Liverpool",    subname: "UK",       flagCode: "gb", price: 240, baseRent: 20, rentLevels: [20,100,300,750,925,1100],  color: "orange",   group: "uk",             mortgageValue: 120, houseCost: 150, hotelCost: 150, position: "left", index: 0  },
  { id: 38, type: "property",name: "Manchester",   subname: "UK",       flagCode: "gb", price: 240, baseRent: 20, rentLevels: [20,100,300,750,925,1100],  color: "orange",   group: "uk",             mortgageValue: 120, houseCost: 150, hotelCost: 150, position: "left", index: 1  },
  { id: 39, type: "treasure",name: "Treasure",                                                                                                             color: "none",                                                                                                 position: "left", index: 2  },
  { id: 40, type: "property",name: "Birmingham",   subname: "UK",       flagCode: "gb", price: 280, baseRent: 24, rentLevels: [24,120,360,850,1025,1200], color: "orange",   group: "uk",             mortgageValue: 140, houseCost: 200, hotelCost: 200, position: "left", index: 3  },
  { id: 41, type: "property",name: "London",       subname: "UK",       flagCode: "gb", price: 320, baseRent: 28, rentLevels: [28,150,450,1000,1200,1400], color: "red",     group: "uk-premium",     mortgageValue: 160, houseCost: 200, hotelCost: 200, position: "left", index: 4  },
  { id: 42, type: "airport", name: "JFK Airport",  subname: "New York", flagCode: "us", price: 200,                                                        color: "none",                                                                                                position: "left", index: 5  },
  { id: 43, type: "property",name: "Los Angeles",  subname: "USA",      flagCode: "us", price: 300, baseRent: 26, rentLevels: [26,130,390,900,1100,1275],  color: "green",   group: "usa",            mortgageValue: 150, houseCost: 200, hotelCost: 200, position: "left", index: 6  },
  { id: 44, type: "surprise",name: "Surprise",                                                                                                             color: "none",                                                                                                 position: "left", index: 7  },
  { id: 45, type: "property",name: "San Francisco",subname: "USA",      flagCode: "us", price: 360, baseRent: 35, rentLevels: [35,175,500,1100,1300,1500], color: "green",   group: "usa",            mortgageValue: 180, houseCost: 200, hotelCost: 200, position: "left", index: 8  },
  { id: 46, type: "tax",     name: "Premium Tax",  subname: "Pay $75",                              taxAmount: 75,                                         color: "none",                                                                                                 position: "left", index: 9  },
  { id: 47, type: "property",name: "New York",     subname: "USA",      flagCode: "us", price: 400, baseRent: 50, rentLevels: [50,200,600,1400,1700,2000], color: "darkblue",group: "usa-premium",    mortgageValue: 200, houseCost: 200, hotelCost: 200, position: "left", index: 10 },
];

const TREASURE_CARDS = [
  { id: 1, text: "Bank dividend! Collect $50.", action: "collect", amount: 50 },
  { id: 2, text: "Birthday! Collect $10 from each player.", action: "collect-from-all", amount: 10 },
  { id: 3, text: "Tax refund! Collect $20.", action: "collect", amount: 20 },
  { id: 4, text: "Doctor fees. Pay $50.", action: "pay", amount: 50 },
  { id: 5, text: "Sale of stock! Collect $45.", action: "collect", amount: 45 },
  { id: 6, text: "Advance to Start. Collect $200.", action: "move-to-start" },
  { id: 7, text: "Get out of jail free.", action: "jail-free" },
  { id: 8, text: "Consulting fee. Collect $100.", action: "collect", amount: 100 },
];

const SURPRISE_CARDS = [
  { id: 1, text: "Advance to Start. Collect $200.", action: "move-to-start" },
  { id: 2, text: "Go directly to jail.", action: "go-to-prison" },
  { id: 3, text: "Get out of jail free.", action: "jail-free" },
  { id: 4, text: "Go back 3 spaces.", action: "move-back", amount: 3 },
  { id: 5, text: "Speeding fine. Pay $15.", action: "pay", amount: 15 },
  { id: 6, text: "Bank pays dividend of $50.", action: "collect", amount: 50 },
  { id: 7, text: "Your building loan matures. Collect $150.", action: "collect", amount: 150 },
  { id: 8, text: "Drunk in charge. Fine $20.", action: "pay", amount: 20 },
];

// ─── Game Engine ──────────────────────────────────────────────────────────────

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function createGame(roomCode, hostId, hostName, hostColor) {
  return {
    id: uuidv4(),
    roomCode,
    phase: "waiting",
    players: [{
      id: hostId, name: hostName,
      color: hostColor,
      ready: false,
      position: 0, cash: 1500, netWorth: 1500,
      properties: [], inJail: false, jailTurns: 0,
      jailFreeCards: 0, isBankrupt: false, isConnected: true,
      consecutiveDoubles: 0, lastDice: [1, 1],
    }],
    currentPlayerIndex: 0,
    properties: [],
    diceValues: [1, 1],
    diceRolled: false,
    freeParkingPot: 0,
    currentCard: null,
    currentAuction: null,
    pendingTrade: null,
    log: [{ id: uuidv4(), timestamp: Date.now(), type: "system", message: "Game room created! Waiting for players..." }],
    chat: [],
    round: 0, maxRounds: 50,
    startedAt: Date.now(), updatedAt: Date.now(),
    winner: null,
  };
}

function addPlayer(state, playerId, playerName) {
  if (state.players.length >= 6) throw new Error("Room is full");
  if (state.phase !== "waiting") throw new Error("Game already started");
  const i = state.players.length;
  return {
    ...state,
    players: [...state.players, {
      id: playerId, name: playerName,
      color: PLAYER_COLORS[i % PLAYER_COLORS.length],
      avatar: PLAYER_AVATARS[i % PLAYER_AVATARS.length],
      ready: false,
      position: 0, cash: 1500, netWorth: 1500,
      properties: [], inJail: false, jailTurns: 0,
      jailFreeCards: 0, isBankrupt: false, isConnected: true,
      consecutiveDoubles: 0, lastDice: [1, 1],
    }],
    log: [...state.log, log("system", `${playerName} joined the game!`)],
    updatedAt: Date.now(),
  };
}

function log(type, message, playerId, amount) {
  return { id: uuidv4(), timestamp: Date.now(), type, message, playerId, amount };
}

function sendToJail(player) {
  return { ...player, position: 23, inJail: true, jailTurns: 0, consecutiveDoubles: 0 };
}

function calcNetWorth(player, properties) {
  const propVal = properties
    .filter(p => p.ownerId === player.id)
    .reduce((s, p) => {
      const tile = BOARD_TILES.find(t => t.id === p.tileId);
      return s + (tile?.price || 0) + p.houses * 50 + (p.hasHotel ? 250 : 0);
    }, 0);
  return player.cash + propVal;
}

function advanceTurn(state) {
  const cur = state.players[state.currentPlayerIndex];
  const rolled = state.diceValues;
  const isDouble = rolled[0] === rolled[1] && !cur.inJail;

  // Doubles = roll again (same player)
  if (isDouble && !cur.isBankrupt) {
    return { ...state, phase: "rolling", diceRolled: false, updatedAt: Date.now() };
  }

  let next = state.currentPlayerIndex;
  let tries = 0;
  do { next = (next + 1) % state.players.length; tries++; }
  while (state.players[next].isBankrupt && tries < state.players.length);

  const newRound = next <= state.currentPlayerIndex ? state.round + 1 : state.round;

  if (newRound > state.maxRounds) {
    const winner = [...state.players].filter(p => !p.isBankrupt)
      .sort((a, b) => calcNetWorth(b, state.properties) - calcNetWorth(a, state.properties))[0];
    return {
      ...state, phase: "finished", winner: winner?.id, round: newRound,
      log: [...state.log, log("system", `Game over! ${winner?.name} wins!`)], updatedAt: Date.now()
    };
  }

  return { ...state, currentPlayerIndex: next, phase: "rolling", diceRolled: false, round: newRound, updatedAt: Date.now() };
}

function processLanding(state, playerId, position) {
  const tile = BOARD_TILES.find(t => t.id === position);
  if (!tile) return advanceTurn(state);
  const player = state.players.find(p => p.id === playerId);

  switch (tile.type) {
    case "start": return advanceTurn(state);

    case "property": case "airport": case "utility": {
      const owned = state.properties.find(p => p.tileId === position);
      if (!owned) return { ...state, phase: "buying" };
      if (owned.ownerId === playerId || owned.isMortgaged) return advanceTurn(state);
      return payRent(state, playerId, position, owned);
    }

    case "tax": {
      const amount = tile.taxAmount < 1
        ? Math.floor(player.cash * tile.taxAmount)
        : tile.taxAmount;
      const actual = Math.min(amount, player.cash);
      const players = state.players.map(p =>
        p.id === playerId ? { ...p, cash: p.cash - actual } : p);
      return advanceTurn({
        ...state, players,
        freeParkingPot: state.freeParkingPot + actual,
        log: [...state.log, log("tax", `${player.name} paid $${actual} for ${tile.name}`, playerId, actual)],
        updatedAt: Date.now()
      });
    }

    case "treasure": {
      const card = TREASURE_CARDS[Math.floor(Math.random() * TREASURE_CARDS.length)];
      return {
        ...state, phase: "card", currentCard: { type: "treasure", card },
        log: [...state.log, log("card", `${player.name} drew a Treasure card!`, playerId)], updatedAt: Date.now()
      };
    }

    case "surprise": {
      const card = SURPRISE_CARDS[Math.floor(Math.random() * SURPRISE_CARDS.length)];
      return {
        ...state, phase: "card", currentCard: { type: "surprise", card },
        log: [...state.log, log("card", `${player.name} drew a Surprise card!`, playerId)], updatedAt: Date.now()
      };
    }

    case "go-to-prison": {
      const players = state.players.map(p => p.id === playerId ? sendToJail(p) : p);
      return {
        ...state, players, phase: "rolling",
        log: [...state.log, log("jail", `${player.name} goes to jail!`, playerId)], updatedAt: Date.now()
      };
    }

    case "vacation":
      return advanceTurn({
        ...state,
        log: [...state.log, log("system", `${player.name} is on vacation! 🏖️`, playerId)],
        updatedAt: Date.now(),
      });

    default: return advanceTurn(state);
  }
}

function payRent(state, payerId, tileId, ownership) {
  const tile = BOARD_TILES.find(t => t.id === tileId);
  const payer = state.players.find(p => p.id === payerId);
  const owner = state.players.find(p => p.id === ownership.ownerId);

  let rent = 0;
  if (tile.type === "airport") {
    const count = state.properties.filter(p =>
      p.ownerId === ownership.ownerId && BOARD_TILES.find(t => t.id === p.tileId)?.type === "airport"
    ).length;
    rent = 25 * Math.pow(2, count - 1);
  } else if (tile.type === "utility") {
    const count = state.properties.filter(p =>
      p.ownerId === ownership.ownerId && BOARD_TILES.find(t => t.id === p.tileId)?.type === "utility"
    ).length;
    rent = (state.diceValues[0] + state.diceValues[1]) * (count >= 2 ? 10 : 4);
  } else {
    const level = ownership.hasHotel ? 5 : ownership.houses;
    rent = tile.rentLevels?.[level] || tile.baseRent || 0;
    if (level === 0 && tile.group) {
      const group = BOARD_TILES.filter(t => t.group === tile.group);
      const ownsAll = group.every(t =>
        state.properties.some(p => p.tileId === t.id && p.ownerId === ownership.ownerId));
      if (ownsAll) rent *= 2;
    }
  }

  const actual = Math.min(rent, payer.cash);
  const players = state.players.map(p => {
    if (p.id === payerId) return { ...p, cash: p.cash - actual };
    if (p.id === ownership.ownerId) return { ...p, cash: p.cash + actual };
    return p;
  });

  const newState = {
    ...state, players,
    log: [...state.log, log("rent", `${payer.name} paid $${actual} rent to ${owner.name} for ${tile.name}`, payerId, actual)],
    updatedAt: Date.now()
  };

  if (payer.cash - actual <= 0) return handleBankruptcy(newState, payerId, ownership.ownerId);
  return advanceTurn(newState);
}

function handleBankruptcy(state, bankruptId, creditorId) {
  const bankrupt = state.players.find(p => p.id === bankruptId);
  const players = state.players.map(p => p.id === bankruptId ? { ...p, isBankrupt: true, cash: 0 } : p);
  const properties = creditorId
    ? state.properties.map(p => p.ownerId === bankruptId ? { ...p, ownerId: creditorId } : p)
    : state.properties.filter(p => p.ownerId !== bankruptId);

  const active = players.filter(p => !p.isBankrupt);
  const winner = active.length === 1 ? active[0].id : null;

  return {
    ...state, players, properties, phase: winner ? "finished" : "rolling", winner,
    log: [...state.log,
    log("bankrupt", `${bankrupt.name} has gone bankrupt! 💀`, bankruptId),
    ...(winner ? [log("system", `${active[0].name} wins the game! 🏆`)] : [])
    ], updatedAt: Date.now()
  };
}

// ─── Socket.IO Event Handlers ─────────────────────────────────────────────────

io.on("connection", (socket) => {
  console.log(`+ Connected: ${socket.id}`);

  socket.on("create-room", ({ playerName, color }) => {
    try {
      const roomCode = generateRoomCode();
      const assignedColor = color || PLAYER_COLORS[0];
      const state = createGame(roomCode, socket.id, playerName, assignedColor);
      games.set(roomCode, state);
      playerRooms.set(socket.id, roomCode);
      socket.join(roomCode);
      socket.emit("room-created", { roomCode, gameState: state });
      console.log(`Room ${roomCode} created by ${playerName}`);
    } catch (e) { socket.emit("error", { message: e.message }); }
  });

  socket.on("join-room", ({ roomCode, playerName }) => {
    try {
      let state = games.get(roomCode);
      if (!state) { socket.emit("error", { message: "Room not found" }); return; }

      const existing = state.players.find(p => p.id === socket.id);
      if (!existing) {
        state = addPlayer(state, socket.id, playerName);
      } else {
        state = { ...state, players: state.players.map(p => p.id === socket.id ? { ...p, isConnected: true } : p) };
      }

      games.set(roomCode, state);
      playerRooms.set(socket.id, roomCode);
      socket.join(roomCode);
      io.to(roomCode).emit("game-state", state);
      io.to(roomCode).emit("player-joined", { playerName, gameState: state });
    } catch (e) { socket.emit("error", { message: e.message }); }
  });

socket.on("set-color", ({ color }) => {
  const roomCode = playerRooms.get(socket.id);
  if (!roomCode) {
    console.log(`❌ set-color: no room for ${socket.id}`);
    return;
  }
  let state = games.get(roomCode);
  const playerIndex = state.players.findIndex(p => p.id === socket.id);
  if (playerIndex === -1) {
    console.log(`❌ set-color: player ${socket.id} not found in room`);
    return;
  }

  const currentColor = state.players[playerIndex].color;
  console.log(`🎨 set-color: player ${socket.id} wants ${color}, currently ${currentColor}`);

  // Allow if the player is setting the same color they already have
  if (currentColor !== color && state.players.some(p => p.color === color && p.id !== socket.id)) {
    console.log(`❌ set-color: color ${color} already taken by another player`);
    socket.emit("error", { message: "Color already taken" });
    return;
  }

  const updatedPlayer = { ...state.players[playerIndex], color, ready: true };
  const players = [...state.players];
  players[playerIndex] = updatedPlayer;
  state = { ...state, players, updatedAt: Date.now() };
  games.set(roomCode, state);
  io.to(roomCode).emit("game-state", state);
  console.log(`✅ set-color: player ${socket.id} is now ready with color ${color}`);
});

  socket.on("start-game", () => {
    try {
      const roomCode = playerRooms.get(socket.id);
      if (!roomCode) return;
      let state = games.get(roomCode);
      if (state.players[0].id !== socket.id) { socket.emit("error", { message: "Only the host can start" }); return; }
      state = {
        ...state, phase: "rolling", round: 1,
        log: [...state.log, log("system", "Game started! Good luck everyone! 🌍")], updatedAt: Date.now()
      };
      games.set(roomCode, state);
      io.to(roomCode).emit("game-state", state);
    } catch (e) { socket.emit("error", { message: e.message }); }
  });

  socket.on("roll-dice", () => {
    try {
      const roomCode = playerRooms.get(socket.id);
      if (!roomCode) return;
      let state = games.get(roomCode);
      if (state.phase !== "rolling") return;
      const cur = state.players[state.currentPlayerIndex];
      if (cur.id !== socket.id) { socket.emit("error", { message: "Not your turn" }); return; }

      const d1 = Math.floor(Math.random() * 6) + 1;
      const d2 = Math.floor(Math.random() * 6) + 1;
      const isDouble = d1 === d2;
      const total = d1 + d2;

      let player = {
        ...cur, lastDice: [d1, d2],
        consecutiveDoubles: isDouble ? cur.consecutiveDoubles + 1 : 0
      };

      // 3 doubles = jail
      if (player.consecutiveDoubles >= 3) {
        player = sendToJail(player);
        state = {
          ...state, players: state.players.map(p => p.id === socket.id ? player : p),
          diceValues: [d1, d2], diceRolled: true, phase: "rolling",
          log: [...state.log, log("jail", `${cur.name} rolled 3 doubles → jail!`, socket.id)],
          updatedAt: Date.now()
        };
        games.set(roomCode, state);
        io.to(roomCode).emit("game-state", state);
        return;
      }

      // Jail handling
      if (player.inJail) {
        if (isDouble) {
          player = { ...player, inJail: false, jailTurns: 0 };
        } else if (player.jailTurns >= 2) {
          player = { ...player, cash: player.cash - 50, inJail: false, jailTurns: 0 };
        } else {
          player = { ...player, jailTurns: player.jailTurns + 1 };
          state = {
            ...state, players: state.players.map(p => p.id === socket.id ? player : p),
            diceValues: [d1, d2], diceRolled: true, updatedAt: Date.now()
          };
          state = advanceTurn(state);
          games.set(roomCode, state);
          io.to(roomCode).emit("game-state", state);
          return;
        }
      }

      const newPos = (player.position + total) % TOTAL_TILES;
      const passedStart = newPos < player.position && !cur.inJail;
      if (passedStart) player = { ...player, cash: player.cash + 200 };
      player = { ...player, position: newPos };

      state = {
        ...state,
        players: state.players.map(p => p.id === socket.id ? player : p),
        diceValues: [d1, d2], diceRolled: true, phase: "action",
        log: [...state.log, log("move",
          `${cur.name} rolled ${d1}+${d2}=${total}${isDouble ? " 🎲 DOUBLE!" : ""}${passedStart ? " • Collected $200" : ""}`,
          socket.id, passedStart ? 200 : undefined)],
        updatedAt: Date.now()
      };

      state = processLanding(state, socket.id, newPos);
      games.set(roomCode, state);
      io.to(roomCode).emit("game-state", state);
    } catch (e) { socket.emit("error", { message: e.message }); }
  });

  socket.on("buy-property", () => {
    try {
      const roomCode = playerRooms.get(socket.id);
      if (!roomCode) return;
      let state = games.get(roomCode);
      const player = state.players.find(p => p.id === socket.id);
      const tile = BOARD_TILES.find(t => t.id === player.position);
      if (!tile?.price || player.cash < tile.price) { socket.emit("error", { message: "Cannot buy" }); return; }

      const players = state.players.map(p =>
        p.id === socket.id ? { ...p, cash: p.cash - tile.price, properties: [...p.properties, tile.id] } : p);
      state = {
        ...state, players,
        properties: [...state.properties, { tileId: tile.id, ownerId: socket.id, houses: 0, hasHotel: false, isMortgaged: false, purchasePrice: tile.price }],
        log: [...state.log, log("purchase", `${player.name} bought ${tile.name} for $${tile.price} 🏙️`, socket.id, tile.price)],
        updatedAt: Date.now()
      };
      state = advanceTurn(state);
      games.set(roomCode, state);
      io.to(roomCode).emit("game-state", state);
    } catch (e) { socket.emit("error", { message: e.message }); }
  });

  socket.on("decline-purchase", () => {
    try {
      const roomCode = playerRooms.get(socket.id);
      if (!roomCode) return;
      let state = games.get(roomCode);
      const cur = state.players[state.currentPlayerIndex];
      const tile = BOARD_TILES.find(t => t.id === cur.position);
      state = {
        ...state, phase: "auction",
        currentAuction: {
          tileId: cur.position, currentBid: 0, currentBidderId: null, bids: [],
          endsAt: Date.now() + 30000, status: "active"
        },
        log: [...state.log, log("system", `Auction started for ${tile?.name}! 🔨`)], updatedAt: Date.now()
      };
      games.set(roomCode, state);
      io.to(roomCode).emit("game-state", state);

      // Auto-finish auction after 30s
      setTimeout(() => {
        const s = games.get(roomCode);
        if (s?.currentAuction?.status === "active") {
          finishAuction(roomCode);
        }
      }, 30000);
    } catch (e) { socket.emit("error", { message: e.message }); }
  });

  socket.on("auction-bid", ({ amount }) => {
    try {
      const roomCode = playerRooms.get(socket.id);
      if (!roomCode) return;
      let state = games.get(roomCode);
      if (!state.currentAuction) return;
      const player = state.players.find(p => p.id === socket.id);
      if (amount <= state.currentAuction.currentBid) { socket.emit("error", { message: "Bid too low" }); return; }
      if (amount > player.cash) { socket.emit("error", { message: "Not enough cash" }); return; }

      state = {
        ...state, currentAuction: {
          ...state.currentAuction,
          currentBid: amount, currentBidderId: socket.id,
          bids: [...state.currentAuction.bids, { playerId: socket.id, amount, timestamp: Date.now() }]
        },
        log: [...state.log, log("system", `${player.name} bids $${amount}`, socket.id, amount)],
        updatedAt: Date.now()
      };
      games.set(roomCode, state);
      io.to(roomCode).emit("game-state", state);
    } catch (e) { socket.emit("error", { message: e.message }); }
  });

  function finishAuction(roomCode) {
    let state = games.get(roomCode);
    if (!state?.currentAuction) return;
    const { currentAuction: auction } = state;

    if (!auction.currentBidderId) {
      state = advanceTurn({ ...state, currentAuction: null, phase: "rolling" });
    } else {
      const winner = state.players.find(p => p.id === auction.currentBidderId);
      const tile = BOARD_TILES.find(t => t.id === auction.tileId);
      const players = state.players.map(p =>
        p.id === winner.id ? { ...p, cash: p.cash - auction.currentBid, properties: [...p.properties, tile.id] } : p);
      state = advanceTurn({
        ...state, players,
        properties: [...state.properties, { tileId: tile.id, ownerId: winner.id, houses: 0, hasHotel: false, isMortgaged: false, purchasePrice: auction.currentBid }],
        currentAuction: { ...auction, status: "finished" },
        log: [...state.log, log("purchase", `${winner.name} won auction for ${tile.name} at $${auction.currentBid}! 🔨`, winner.id, auction.currentBid)],
        updatedAt: Date.now()
      });
    }
    games.set(roomCode, state);
    io.to(roomCode).emit("game-state", state);
  }

  socket.on("finish-auction", () => {
    const roomCode = playerRooms.get(socket.id);
    if (roomCode) finishAuction(roomCode);
  });

  socket.on("build-house", ({ tileId }) => {
    try {
      const roomCode = playerRooms.get(socket.id);
      if (!roomCode) return;
      let state = games.get(roomCode);
      const ownership = state.properties.find(p => p.tileId === tileId && p.ownerId === socket.id);
      if (!ownership || ownership.hasHotel || ownership.houses >= 4 || ownership.isMortgaged) { socket.emit("error", { message: "Cannot build house here" }); return; }
      const tile = BOARD_TILES.find(t => t.id === tileId);
      const player = state.players.find(p => p.id === socket.id);
      if (player.cash < tile.houseCost) { socket.emit("error", { message: "Not enough cash" }); return; }

      const players = state.players.map(p => p.id === socket.id ? { ...p, cash: p.cash - tile.houseCost } : p);
      const properties = state.properties.map(p => p.tileId === tileId ? { ...p, houses: p.houses + 1 } : p);
      state = {
        ...state, players, properties,
        log: [...state.log, log("upgrade", `${player.name} built a house on ${tile.name} 🏠`, socket.id, tile.houseCost)],
        updatedAt: Date.now()
      };
      games.set(roomCode, state);
      io.to(roomCode).emit("game-state", state);
    } catch (e) { socket.emit("error", { message: e.message }); }
  });

  socket.on("build-hotel", ({ tileId }) => {
    try {
      const roomCode = playerRooms.get(socket.id);
      if (!roomCode) return;
      let state = games.get(roomCode);
      const ownership = state.properties.find(p => p.tileId === tileId && p.ownerId === socket.id);
      if (!ownership || ownership.houses < 4) { socket.emit("error", { message: "Need 4 houses first" }); return; }
      const tile = BOARD_TILES.find(t => t.id === tileId);
      const player = state.players.find(p => p.id === socket.id);
      if (player.cash < tile.hotelCost) { socket.emit("error", { message: "Not enough cash" }); return; }

      const players = state.players.map(p => p.id === socket.id ? { ...p, cash: p.cash - tile.hotelCost } : p);
      const properties = state.properties.map(p => p.tileId === tileId ? { ...p, houses: 0, hasHotel: true } : p);
      state = {
        ...state, players, properties,
        log: [...state.log, log("upgrade", `${player.name} built a hotel on ${tile.name}! 🏨`, socket.id, tile.hotelCost)],
        updatedAt: Date.now()
      };
      games.set(roomCode, state);
      io.to(roomCode).emit("game-state", state);
    } catch (e) { socket.emit("error", { message: e.message }); }
  });

  socket.on("mortgage-property", ({ tileId }) => {
    try {
      const roomCode = playerRooms.get(socket.id);
      if (!roomCode) return;
      let state = games.get(roomCode);
      const ownership = state.properties.find(p => p.tileId === tileId && p.ownerId === socket.id);
      if (!ownership || ownership.isMortgaged) { socket.emit("error", { message: "Cannot mortgage" }); return; }
      const tile = BOARD_TILES.find(t => t.id === tileId);
      const mv = tile.mortgageValue || Math.floor((tile.price || 0) / 2);
      const player = state.players.find(p => p.id === socket.id);

      const players = state.players.map(p => p.id === socket.id ? { ...p, cash: p.cash + mv } : p);
      const properties = state.properties.map(p => p.tileId === tileId ? { ...p, isMortgaged: true } : p);
      state = {
        ...state, players, properties,
        log: [...state.log, log("system", `${player.name} mortgaged ${tile.name} for $${mv}`, socket.id, mv)],
        updatedAt: Date.now()
      };
      games.set(roomCode, state);
      io.to(roomCode).emit("game-state", state);
    } catch (e) { socket.emit("error", { message: e.message }); }
  });

  socket.on("process-card", () => {
    try {
      const roomCode = playerRooms.get(socket.id);
      if (!roomCode) return;
      let state = games.get(roomCode);
      if (!state.currentCard) { state = advanceTurn(state); games.set(roomCode, state); io.to(roomCode).emit("game-state", state); return; }

      const { card } = state.currentCard;
      const player = state.players.find(p => p.id === socket.id);
      let players = state.players;

      switch (card.action) {
        case "collect":
          players = players.map(p => p.id === socket.id ? { ...p, cash: p.cash + card.amount } : p);
          state = { ...state, players, log: [...state.log, log("card", `${player.name}: ${card.text}`, socket.id, card.amount)] };
          break;
        case "pay":
          players = players.map(p => p.id === socket.id ? { ...p, cash: p.cash - card.amount } : p);
          state = { ...state, players, log: [...state.log, log("card", `${player.name}: ${card.text}`, socket.id, card.amount)] };
          break;
        case "collect-from-all":
          const total = card.amount * (players.length - 1);
          players = players.map(p => p.id === socket.id ? { ...p, cash: p.cash + total } : { ...p, cash: p.cash - card.amount });
          state = { ...state, players, log: [...state.log, log("card", `${player.name} collected $${card.amount} from each player!`, socket.id, total)] };
          break;
        case "go-to-prison":
          players = players.map(p => p.id === socket.id ? sendToJail(p) : p);
          state = { ...state, players, log: [...state.log, log("jail", `${player.name} goes to jail! (card)`, socket.id)] };
          break;
        case "jail-free":
          players = players.map(p => p.id === socket.id ? { ...p, jailFreeCards: p.jailFreeCards + 1 } : p);
          state = { ...state, players, log: [...state.log, log("card", `${player.name} got a Get Out of Jail Free card! 🎫`, socket.id)] };
          break;
        case "move-to-start":
          players = players.map(p => p.id === socket.id ? { ...p, position: 0, cash: p.cash + 200 } : p);
          state = { ...state, players, log: [...state.log, log("card", `${player.name} advances to START! Collects $200`, socket.id, 200)] };
          break;
        case "move-back":
          const newPos = Math.max(0, player.position - card.amount);
          players = players.map(p => p.id === socket.id ? { ...p, position: newPos } : p);
          state = { ...state, players, log: [...state.log, log("card", `${player.name} moves back ${card.amount} spaces`, socket.id)] };
          break;
      }

      state = advanceTurn({ ...state, currentCard: null, updatedAt: Date.now() });
      games.set(roomCode, state);
      io.to(roomCode).emit("game-state", state);
    } catch (e) { socket.emit("error", { message: e.message }); }
  });

  socket.on("use-jail-card", () => {
    try {
      const roomCode = playerRooms.get(socket.id);
      if (!roomCode) return;
      let state = games.get(roomCode);
      const player = state.players.find(p => p.id === socket.id);
      if (!player?.inJail || player.jailFreeCards < 1) return;
      const players = state.players.map(p =>
        p.id === socket.id ? { ...p, inJail: false, jailTurns: 0, jailFreeCards: p.jailFreeCards - 1 } : p);
      state = {
        ...state, players,
        log: [...state.log, log("jail", `${player.name} used a Get Out of Jail Free card! 🎫`, socket.id)],
        updatedAt: Date.now()
      };
      games.set(roomCode, state);
      io.to(roomCode).emit("game-state", state);
    } catch (e) { socket.emit("error", { message: e.message }); }
  });
  socket.on("start-game", () => {
    try {
      const roomCode = playerRooms.get(socket.id);
      if (!roomCode) return;
      let state = games.get(roomCode);
      if (state.players[0].id !== socket.id) { socket.emit("error", { message: "Only the host can start" }); return; }
      state = {
        ...state, phase: "rolling", round: 1,
        log: [...state.log, log("system", "Game started! Good luck everyone! 🌍")], updatedAt: Date.now()
      };
      games.set(roomCode, state);
      io.to(roomCode).emit("game-state", state);
    } catch (e) { socket.emit("error", { message: e.message }); }
  });
  socket.on("pay-jail-fine", () => {
    try {
      const roomCode = playerRooms.get(socket.id);
      if (!roomCode) return;
      let state = games.get(roomCode);
      const player = state.players.find(p => p.id === socket.id);
      if (!player?.inJail || player.cash < 50) return;
      const players = state.players.map(p =>
        p.id === socket.id ? { ...p, inJail: false, jailTurns: 0, cash: p.cash - 50 } : p);
      state = {
        ...state, players,
        log: [...state.log, log("jail", `${player.name} paid $50 to get out of jail`, socket.id, 50)],
        updatedAt: Date.now()
      };
      games.set(roomCode, state);
      io.to(roomCode).emit("game-state", state);
    } catch (e) { socket.emit("error", { message: e.message }); }
  });

  socket.on("propose-trade", (tradeData) => {
    try {
      const roomCode = playerRooms.get(socket.id);
      if (!roomCode) return;
      let state = games.get(roomCode);
      const trade = { id: uuidv4(), fromPlayerId: socket.id, status: "pending", ...tradeData };
      state = { ...state, pendingTrade: trade, phase: "trading", updatedAt: Date.now() };
      games.set(roomCode, state);
      io.to(roomCode).emit("game-state", state);
    } catch (e) { socket.emit("error", { message: e.message }); }
  });

  socket.on("respond-trade", ({ accept }) => {
    try {
      const roomCode = playerRooms.get(socket.id);
      if (!roomCode) return;
      let state = games.get(roomCode);
      const trade = state.pendingTrade;
      if (!trade || trade.toPlayerId !== socket.id) return;

      if (accept) {
        const players = state.players.map(p => {
          if (p.id === trade.fromPlayerId) return {
            ...p,
            cash: p.cash - trade.fromCash + trade.toCash,
            properties: [...p.properties.filter(id => !trade.fromProperties.includes(id)), ...trade.toProperties]
          };
          if (p.id === trade.toPlayerId) return {
            ...p,
            cash: p.cash - trade.toCash + trade.fromCash,
            properties: [...p.properties.filter(id => !trade.toProperties.includes(id)), ...trade.fromProperties]
          };
          return p;
        });
        const properties = state.properties.map(p => {
          if (trade.fromProperties.includes(p.tileId)) return { ...p, ownerId: trade.toPlayerId };
          if (trade.toProperties.includes(p.tileId)) return { ...p, ownerId: trade.fromPlayerId };
          return p;
        });
        const from = state.players.find(p => p.id === trade.fromPlayerId);
        const to = state.players.find(p => p.id === trade.toPlayerId);
        state = {
          ...state, players, properties, pendingTrade: null, phase: "rolling",
          log: [...state.log, log("trade", `Trade completed between ${from.name} and ${to.name}! 🤝`)],
          updatedAt: Date.now()
        };
      } else {
        state = { ...state, pendingTrade: null, phase: "rolling", updatedAt: Date.now() };
      }
      games.set(roomCode, state);
      io.to(roomCode).emit("game-state", state);
    } catch (e) { socket.emit("error", { message: e.message }); }
  });

  socket.on("send-chat", ({ message }) => {
    try {
      const roomCode = playerRooms.get(socket.id);
      if (!roomCode) return;
      let state = games.get(roomCode);
      const player = state.players.find(p => p.id === socket.id);
      if (!player || !message?.trim()) return;
      const msg = {
        id: uuidv4(), playerId: socket.id, playerName: player.name,
        playerColor: player.color, message: message.trim().substring(0, 200), timestamp: Date.now()
      };
      state = { ...state, chat: [...state.chat.slice(-99), msg], updatedAt: Date.now() };
      games.set(roomCode, state);
      io.to(roomCode).emit("game-state", state);
    } catch (e) { socket.emit("error", { message: e.message }); }
  });

  socket.on("get-state", () => {
    const roomCode = playerRooms.get(socket.id);
    if (roomCode) {
      const state = games.get(roomCode);
      if (state) socket.emit("game-state", state);
    }
  });

  socket.on("disconnect", () => {
    const roomCode = playerRooms.get(socket.id);
    if (roomCode) {
      let state = games.get(roomCode);
      if (state) {
        const player = state.players.find(p => p.id === socket.id);
        state = {
          ...state,
          players: state.players.map(p => p.id === socket.id ? { ...p, isConnected: false } : p),
          updatedAt: Date.now()
        };
        games.set(roomCode, state);
        if (player) io.to(roomCode).emit("player-left", { playerId: socket.id, playerName: player.name, gameState: state });
      }
      playerRooms.delete(socket.id);
    }
    console.log(`- Disconnected: ${socket.id}`);
  });
});

// ─── Start Server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => {
  console.log(`✅ Mr. Worldwide Socket Server running on port ${PORT}`);
  console.log(`   Allowed origin: ${ALLOWED_ORIGIN}`);
});
