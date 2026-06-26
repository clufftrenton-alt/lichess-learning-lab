const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 5177);
const LICHESS = "https://lichess.org";
const PUBLIC_DIR = path.join(__dirname, "public");

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
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

function buildAnnotatedPgn(game, username, selectedMoments) {
  const moves = String(game.moves || "").split(/\s+/).filter(Boolean);
  const momentMap = new Map(selectedMoments.map((moment) => [Number(moment.ply), moment]));
  const headers = [
    ["Event", "Lichess Learning Lab"],
    ["Site", game.url || `https://lichess.org/${game.id || ""}`],
    ["Date", game.createdAt ? new Date(game.createdAt).toISOString().slice(0, 10).replaceAll("-", ".") : "????.??.??"],
    ["White", game.players?.white?.user?.name || "White"],
    ["Black", game.players?.black?.user?.name || "Black"],
    ["Result", game.status === "draw" ? "1/2-1/2" : game.winner === "white" ? "1-0" : game.winner === "black" ? "0-1" : "*"],
    ["Annotator", "Lichess Learning Lab"],
  ];

  let movetext = "";
  for (let i = 0; i < moves.length; i += 1) {
    if (i % 2 === 0) movetext += `${Math.floor(i / 2) + 1}. `;
    movetext += `${moves[i]} `;
    const moment = momentMap.get(i + 1);
    if (moment) {
      const parts = [
        `${moment.kind} on move ${moment.moveNumber}`,
        moment.loss ? `eval dropped about ${moment.loss} pawns` : "",
        moment.best ? `candidate: ${moment.best}` : "",
        moment.comment || "",
      ].filter(Boolean);
      movetext += `{ ${escapePgnComment(parts.join(". "))} } `;
    }
  }

  const result = headers.find(([name]) => name === "Result")[1];
  return `${headers.map(([key, value]) => `[${key} "${String(value).replaceAll('"', "'")}"]`).join("\n")}\n\n${movetext.trim()} ${result}\n`;
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
      computer: "true",
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
      const pgn = buildAnnotatedPgn(game, username, moments);
      const form = new URLSearchParams({
        name: game.title.slice(0, 80),
        pgn,
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
