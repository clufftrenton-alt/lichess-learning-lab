const http = require("http");
const fs = require("fs");
const path = require("path");
const { Chess } = require("chess.js");

const PORT = Number(process.env.PORT || 5177);
const LICHESS = "https://lichess.org";
const PUBLIC_DIR = path.join(__dirname, "public");

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function send(res, status, data, headers = {}) {
  const body = typeof data === "string" ? data : JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": typeof data === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
    ...headers,
  });
  res.end(body);
}

function sendJson(res, status, data) {
  send(res, status, data, { "Content-Type": "application/json; charset=utf-8" });
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  if (!body.trim()) return {};
  return JSON.parse(body);
}

function bearer(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function lichessFetch(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "User-Agent": "LichessLearningLab/0.1 local personal study app",
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  if (!response.ok) {
    const message = text || `${response.status} ${response.statusText}`;
    throw new Error(message.slice(0, 800));
  }
  return text;
}

function parseNdjson(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function evalToPawns(value) {
  if (value === undefined || value === null || Number.isNaN(Number(value))) return null;
  return Number(value) / 100;
}

function scoreForPlayer(point, color) {
  if (!point) return null;
  if (typeof point.mate === "number") {
    const mateScore = point.mate > 0 ? 100 : -100;
    return color === "white" ? mateScore : -mateScore;
  }
  const pawns = evalToPawns(point.eval ?? point.cp ?? point.centipawns);
  if (pawns === null) return null;
  return color === "white" ? pawns : -pawns;
}

function classifyLoss(loss) {
  if (loss >= 2.0) return "Blunder";
  if (loss >= 1.0) return "Mistake";
  if (loss >= 0.45) return "Inaccuracy";
  return null;
}

function severityScore(kind, loss) {
  const base = {
    Blunder: 300,
    Mistake: 200,
    Inaccuracy: 100,
    "Critical moment": 80,
  }[kind] || 0;
  return base + Math.round(Number(loss || 0) * 100);
}

function lessonPrinciple(moment) {
  const phase = moment.moveNumber <= 10 ? "opening" : moment.moveNumber >= 35 ? "endgame" : "middlegame";

  if (moment.kind === "Blunder" || Number(moment.loss || 0) >= 2) {
    return {
      name: "Tactical safety and forcing moves",
      explanation: "Scan checks, captures, threats, and loose pieces before committing. The best move usually works because it changes the forcing sequence, wins material, prevents a tactic, or creates a direct threat.",
    };
  }

  if (phase === "opening") {
    return {
      name: "Opening development and central control",
      explanation: "Improve your pieces, fight for central squares, keep your king safe, and avoid automatic moves that ignore the opponent's last idea.",
    };
  }

  if (phase === "endgame") {
    return {
      name: "Endgame activity and conversion",
      explanation: "Activate the king, improve the worst piece, create or stop passed pawns, and calculate pawn races before choosing a move.",
    };
  }

  return {
    name: "Improve the worst piece and limit counterplay",
    explanation: "Ask what your opponent wants, then choose a move that improves your coordination while reducing their active ideas.",
  };
}

function principleForMoment(game, moment) {
  const principle = lessonPrinciple(moment);
  const best = moment.best ? ` The candidate move Lichess points to is ${moment.best}.` : "";

  return `Key principle: ${principle.name}. ${principle.explanation}${best} After finding the move, say the principle out loud and name the concrete reason it works here.`;
}

function promptForMoment(game, moment) {
  const color = playerColor(game, moment.username || "");
  const side = color === "white" ? "White" : "Black";
  const lossText = moment.loss ? ` The game evaluation dropped by about ${moment.loss} pawns after the move played.` : "";

  if (moment.kind === "Blunder") {
    return `${side} to move. Big tactical moment: what forcing move or defensive resource changes the position?${lossText}`;
  }
  if (moment.kind === "Mistake") {
    return `${side} to move. There is a more principled move here. What improves the position while limiting counterplay?${lossText}`;
  }
  if (moment.kind === "Inaccuracy") {
    return `${side} to move. Small edge to improve: find the cleaner plan before playing automatically.${lossText}`;
  }
  return `${side} to move. Critical decision point: identify the opponent's threat, then choose the most active response.${lossText}`;
}

function playerColor(game, username) {
  const lower = username.toLowerCase();
  const whiteName = game.players?.white?.user?.name?.toLowerCase();
  const blackName = game.players?.black?.user?.name?.toLowerCase();
  if (whiteName === lower) return "white";
  if (blackName === lower) return "black";
  return "white";
}

function resultForPlayer(game, color) {
  if (!game.winner) return "draw";
  return game.winner === color ? "win" : "loss";
}

function makeGameTitle(game, username) {
  const white = game.players?.white?.user?.name || "White";
  const black = game.players?.black?.user?.name || "Black";
  const date = game.createdAt ? new Date(game.createdAt).toISOString().slice(0, 10) : "unknown date";
  const color = playerColor(game, username);
  return `${date} ${white} vs ${black} (${resultForPlayer(game, color)})`;
}

function findMoments(game, username) {
  const moves = String(game.moves || "").split(/\s+/).filter(Boolean);
  const analysis = Array.isArray(game.analysis) ? game.analysis : [];
  const color = playerColor(game, username);
  const moments = [];

  for (let i = 0; i < moves.length; i += 1) {
    const mover = i % 2 === 0 ? "white" : "black";
    const current = analysis[i];
    const previous = i > 0 ? analysis[i - 1] : null;
    const judgment = current?.judgment?.name;
    const best = current?.best || current?.bestMove || current?.variation?.split(" ")?.[0] || "";
    const variation = current?.variation || "";
    let kind = judgment || null;
    let loss = null;

    if (!kind && previous && current) {
      const before = scoreForPlayer(previous, mover);
      const after = scoreForPlayer(current, mover);
      if (before !== null && after !== null) {
        loss = Math.max(0, before - after);
        kind = classifyLoss(loss);
      }
    }

    const isCriticalShift = loss !== null && loss >= 0.45;
    const isLichessJudgment = ["Inaccuracy", "Mistake", "Blunder"].includes(kind);
    if ((isCriticalShift || isLichessJudgment) && mover === color) {
      moments.push({
        ply: i + 1,
        moveNumber: Math.floor(i / 2) + 1,
        san: moves[i],
        kind: kind || "Critical moment",
        loss: loss === null ? null : Number(loss.toFixed(2)),
        score: severityScore(kind || "Critical moment", loss),
        best,
        variation,
        comment: current?.judgment?.comment || "",
      });
    }
  }

  return moments.sort((a, b) => b.score - a.score).slice(0, 12);
}

function escapePgnComment(text) {
  return String(text || "")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function moveNumberForPly(ply) {
  return Math.floor((ply - 1) / 2) + 1;
}

function movePrefixForPly(ply) {
  return ply % 2 === 1 ? `${moveNumberForPly(ply)}.` : `${moveNumberForPly(ply)}...`;
}

function moveTokenToObject(token) {
  const clean = String(token || "").trim();
  const match = clean.match(/^([a-h][1-8])([a-h][1-8])([qrbn])?$/i);
  if (!match) return clean;
  return {
    from: match[1],
    to: match[2],
    promotion: match[3]?.toLowerCase(),
  };
}

function playMove(chess, token) {
  try {
    return chess.move(moveTokenToObject(token));
  } catch {
    return null;
  }
}

function positionBeforePly(moves, ply) {
  const chess = new Chess();
  for (let i = 0; i < ply - 1; i += 1) {
    if (!playMove(chess, moves[i])) return null;
  }
  return chess;
}

function buildLineFromTokens(fen, tokens, maxPlies = 8) {
  const chess = new Chess(fen);
  const sanMoves = [];

  for (const token of tokens.slice(0, maxPlies)) {
    const move = playMove(chess, token);
    if (!move) break;
    sanMoves.push(move.san);
  }

  return sanMoves;
}

function formatLine(startPly, sanMoves, comments = {}) {
  let ply = startPly;
  let text = "";

  for (const san of sanMoves) {
    text += `${movePrefixForPly(ply)} `;
    if (comments.before?.[ply]) text += `{ ${escapePgnComment(comments.before[ply])} } `;
    text += `${san} `;
    if (comments.after?.[ply]) text += `{ ${escapePgnComment(comments.after[ply])} } `;
    ply += 1;
  }

  return text.trim();
}

function arrowFromUci(token) {
  const match = String(token || "").match(/^([a-h][1-8])([a-h][1-8])/i);
  return match ? `{ [%cal G${match[1]}${match[2]}] }` : "";
}

function headersToPgn(headers) {
  return headers.map(([key, value]) => `[${key} "${String(value).replaceAll('"', "'")}"]`).join("\n");
}

async function cloudEvalLine(fen) {
  try {
    const params = new URLSearchParams({
      fen,
      multiPv: "1",
    });
    const text = await lichessFetch(`${LICHESS}/api/cloud-eval?${params}`, {
      headers: {
        Accept: "application/json",
      },
    });
    const data = JSON.parse(text);
    return data.pvs?.[0]?.moves || "";
  } catch {
    return "";
  }
}

async function buildLessonPgn(game, username, moment) {
  const moves = String(game.moves || "").split(/\s+/).filter(Boolean);
  const before = positionBeforePly(moves, Number(moment.ply));
  if (!before) return null;

  const fen = before.fen();
  const engineLine = moment.variation || moment.best || await cloudEvalLine(fen);
  const lineTokens = String(engineLine || "")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  const betterLine = buildLineFromTokens(fen, lineTokens, 8);
  if (!betterLine.length) return null;

  const mistakeLine = buildLineFromTokens(fen, [moment.san], 1);
  const prefix = movePrefixForPly(moment.ply);
  const prompt = promptForMoment(game, { ...moment, username });
  const principle = principleForMoment(game, moment);
  const bestMove = betterLine[0];
  const titleMove = `${moment.kind} m${moment.moveNumber}: ${bestMove} over ${moment.san}`;
  const headers = [
    ["Event", `Lichess Learning Lab: ${titleMove}`],
    ["Site", game.url || `https://lichess.org/${game.id || ""}`],
    ["Date", game.createdAt ? new Date(game.createdAt).toISOString().slice(0, 10).replaceAll("-", ".") : "????.??.??"],
    ["White", game.players?.white?.user?.name || "White"],
    ["Black", game.players?.black?.user?.name || "Black"],
    ["Result", "*"],
    ["Annotator", "Lichess Learning Lab"],
    ["SetUp", "1"],
    ["FEN", fen],
  ];

  const afterBest = [
    `Correct. ${principle}`,
    moment.comment ? `Lichess note: ${moment.comment}` : "",
  ].filter(Boolean).join(" ");
  const comments = {
    before: {
      [moment.ply]: `${prompt} Do not play the game move yet. Calculate the better line first.`,
    },
    after: {
      [moment.ply]: afterBest,
    },
  };
  const mainLine = formatLine(moment.ply, betterLine, comments);
  const mistakeVariation = mistakeLine.length
    ? ` (${prefix} ${mistakeLine[0]} { ${escapePgnComment(`This is what was played in the game. ${moment.kind}: it gives up the better line above.`)} })`
    : "";
  const arrow = arrowFromUci(lineTokens[0]);

  return `${headersToPgn(headers)}\n\n{ ${escapePgnComment(prompt)} } ${arrow} ${mainLine}${mistakeVariation} *\n`;
}

async function handleApi(req, res) {
  const body = await readJson(req);

  if (req.url === "/api/profile" && req.method === "POST") {
    const text = await lichessFetch(`${LICHESS}/api/account`, {
      headers: {
        Accept: "application/json",
        ...bearer(body.token),
      },
    });
    return sendJson(res, 200, JSON.parse(text));
  }

  if (req.url === "/api/games" && req.method === "POST") {
    const username = String(body.username || "").trim();
    if (!username) return sendJson(res, 400, { error: "Missing Lichess username." });
    const params = new URLSearchParams({
      max: String(Math.min(Math.max(Number(body.max || 100), 1), 300)),
      analysed: "true",
      evals: "true",
      opening: "true",
      clocks: "true",
      pgnInJson: "true",
    });
    const since = Date.parse(`${body.since || ""}T00:00:00.000Z`);
    const until = Date.parse(`${body.until || ""}T23:59:59.999Z`);
    if (!Number.isNaN(since)) params.set("since", String(since));
    if (!Number.isNaN(until)) params.set("until", String(until));

    const text = await lichessFetch(`${LICHESS}/api/games/user/${encodeURIComponent(username)}?${params}`, {
      headers: {
        Accept: "application/x-ndjson",
        ...bearer(body.token),
      },
    });
    const games = parseNdjson(text).map((game) => ({
      id: game.id,
      url: game.url,
      rated: game.rated,
      speed: game.speed,
      perf: game.perf,
      opening: game.opening,
      createdAt: game.createdAt,
      title: makeGameTitle(game, username),
      color: playerColor(game, username),
      result: resultForPlayer(game, playerColor(game, username)),
      players: game.players,
      moves: game.moves,
      analysis: game.analysis,
      moments: findMoments(game, username),
    }));
    return sendJson(res, 200, { games });
  }

  if (req.url === "/api/create-study" && req.method === "POST") {
    if (!body.token) return sendJson(res, 400, { error: "A Lichess token with study:write is required." });
    const username = String(body.username || "").trim();
    const selected = Array.isArray(body.selected) ? body.selected : [];
    const games = Array.isArray(body.games) ? body.games : [];
    if (!selected.length) return sendJson(res, 400, { error: "Select at least one game moment." });

    const studyName = String(body.name || `Learning Lab - ${new Date().toISOString().slice(0, 10)}`).slice(0, 80);
    const studyForm = new URLSearchParams({
      name: studyName,
      visibility: "private",
      computer: "owner",
      explorer: "owner",
      chat: "owner",
      shareable: "owner",
      cloneable: "nobody",
    });
    const studyText = await lichessFetch(`${LICHESS}/api/study`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        ...bearer(body.token),
      },
      body: studyForm,
    });
    const study = JSON.parse(studyText);
    const studyId = study.id || study.study?.id;
    if (!studyId) throw new Error("Lichess created a study, but did not return a study id.");

    const byGame = new Map();
    for (const item of selected) {
      const list = byGame.get(item.gameId) || [];
      list.push(item);
      byGame.set(item.gameId, list);
    }

    const chapters = [];
    for (const game of games) {
      const moments = byGame.get(game.id);
      if (!moments?.length) continue;
      const ordered = moments.sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 3);
      for (const moment of ordered) {
        const pgn = await buildLessonPgn(game, username, moment);
        if (!pgn) continue;
        const chapterName = `${moment.kind} m${moment.moveNumber}: ${moment.san}`.slice(0, 80);
        const form = new URLSearchParams({
          name: chapterName,
          pgn,
          mode: "gamebook",
        });
        const chapterText = await lichessFetch(`${LICHESS}/api/study/${studyId}/import-pgn`, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
            ...bearer(body.token),
          },
          body: form,
        });
        chapters.push(JSON.parse(chapterText));
      }
    }

    if (!chapters.length) {
      throw new Error("No lesson chapters could be created because Lichess did not return a usable better line for the selected positions.");
    }

    return sendJson(res, 200, {
      studyId,
      url: `${LICHESS}/study/${studyId}`,
      chaptersCreated: chapters.length,
    });
  }

  return sendJson(res, 404, { error: "Unknown API route." });
}

function serveStatic(req, res) {
  const cleanPath = decodeURIComponent(req.url.split("?")[0]);
  const filePath = cleanPath === "/" ? path.join(PUBLIC_DIR, "index.html") : path.join(PUBLIC_DIR, cleanPath);
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(PUBLIC_DIR)) return send(res, 403, "Forbidden");

  fs.readFile(resolved, (error, data) => {
    if (error) return send(res, 404, "Not found");
    const ext = path.extname(resolved);
    res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith("/api/")) return await handleApi(req, res);
    return serveStatic(req, res);
  } catch (error) {
    return sendJson(res, 500, { error: error.message || "Something went wrong." });
  }
});

server.listen(PORT, () => {
  console.log(`Lichess Learning Lab is running at http://localhost:${PORT}`);
});
