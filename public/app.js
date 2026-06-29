const state = {
  token: "",
  username: "",
  apiBase: "",
  games: [],
  selected: new Map(),
};

const $ = (id) => document.getElementById(id);

const storageKeys = {
  apiBase: "learningLabApiBase",
  token: "learningLabToken",
  username: "learningLabUsername",
};

function loadSavedSettings() {
  state.apiBase = localStorage.getItem(storageKeys.apiBase) || "";
  state.token = localStorage.getItem(storageKeys.token) || "";
  state.username = localStorage.getItem(storageKeys.username) || "";
  if ($("apiBase")) $("apiBase").value = state.apiBase;
  if ($("token")) $("token").value = state.token;
  if ($("username")) $("username").value = state.username;
}

function saveSettings() {
  state.apiBase = $("apiBase")?.value.trim().replace(/\/$/, "") || "";
  state.token = $("token")?.value.trim() || "";
  state.username = $("username")?.value.trim() || state.username;
  localStorage.setItem(storageKeys.apiBase, state.apiBase);
  localStorage.setItem(storageKeys.token, state.token);
  localStorage.setItem(storageKeys.username, state.username);
}

function clearSettings() {
  Object.values(storageKeys).forEach((key) => localStorage.removeItem(key));
  state.apiBase = "";
  state.token = "";
  state.username = "";
  if ($("apiBase")) $("apiBase").value = "";
  if ($("token")) $("token").value = "";
  if ($("username")) $("username").value = "";
  setConnectionView(false);
}

function setConnectionView(connected) {
  $("setupPanel").hidden = connected;
  $("connectedPanel").hidden = !connected;
  if (!connected) return;

  $("connectedUser").textContent = state.username || "Connected";
  $("connectedBackend").textContent = state.apiBase ? state.apiBase : "Local backend";
}

function setStatus(message, type = "info") {
  const status = $("status");
  status.hidden = !message;
  status.textContent = message || "";
  status.className = `status ${type}`;
}

async function postJson(url, body) {
  saveSettings();
  const target = `${state.apiBase}${url}`;
  let response;
  try {
    response = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    const backend = state.apiBase || "this app's built-in local backend";
    throw new Error(`Could not reach the backend at ${backend}. Check the Backend URL, make sure it starts with https://, and wait a minute if the host is waking up.`);
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

async function connectToLichess({ silent = false } = {}) {
  state.token = $("token").value.trim();
  if (!state.token) {
    setConnectionView(false);
    if (!silent) setStatus("Paste a Lichess token first.", "error");
    return false;
  }

  if (!silent) setStatus("Connecting to Lichess...");
  const profile = await postJson("/api/profile", { token: state.token });
  state.username = profile.username || profile.id || $("username").value.trim();
  $("username").value = state.username;
  saveSettings();
  setConnectionView(true);
  setStatus(`Connected as ${state.username}.`, "success");
  return true;
}

function selectedItems() {
  return Array.from(state.selected.values());
}

function dateRangeLabel() {
  const start = $("startDate").value;
  const end = $("endDate").value;
  if (start && end) return `${start} to ${end}`;
  if (start) return `from ${start}`;
  if (end) return `through ${end}`;
  return "latest games";
}

function momentKey(gameId, ply) {
  return `${gameId}:${ply}`;
}

function updateSummary() {
  const momentCount = state.games.reduce((total, game) => total + game.moments.length, 0);
  const selected = selectedItems().length;
  $("summary").textContent = state.games.length
    ? `${state.games.length} analysed games, ${momentCount} learnable moments, ${selected} auto-selected.`
    : "Connect, choose a date range, then auto-create a lesson from your most important moments.";
}

function toDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function setDefaultDateRange() {
  const today = new Date();
  const monthAgo = new Date(today);
  monthAgo.setDate(today.getDate() - 30);
  $("startDate").value = toDateInputValue(monthAgo);
  $("endDate").value = toDateInputValue(today);
}

function autoSelectMoments() {
  state.selected.clear();

  for (const game of state.games) {
    const sorted = [...game.moments].sort((a, b) => (b.score || 0) - (a.score || 0));
    const serious = sorted.filter((moment) => ["Blunder", "Mistake"].includes(moment.kind));
    const chosen = serious.length ? serious.slice(0, 3) : sorted.slice(0, 1);

    for (const moment of chosen) {
      state.selected.set(momentKey(game.id, moment.ply), { ...moment, gameId: game.id });
    }
  }
}

function renderGames() {
  const root = $("games");
  root.innerHTML = "";
  root.className = state.games.length ? "games" : "games empty";

  if (!state.games.length) {
    root.innerHTML = `
      <div class="empty-state">
        <h3>No games loaded yet</h3>
        <p>Analysed Lichess games in your date range will appear here with the most important moments selected automatically.</p>
      </div>
    `;
    updateSummary();
    return;
  }

  for (const game of state.games) {
    const article = document.createElement("article");
    article.className = "game-card";
    const opening = game.opening?.name ? `<span>${escapeHtml(game.opening.name)}</span>` : "";
    article.innerHTML = `
      <header>
        <div>
          <h3>${escapeHtml(game.title)}</h3>
          <p>${escapeHtml(game.color)} - ${escapeHtml(game.speed || "game")} - ${escapeHtml(game.result)}</p>
        </div>
        <a href="${game.url}" target="_blank" rel="noreferrer">Open</a>
      </header>
      <div class="opening">${opening}</div>
      <div class="moments"></div>
    `;

    const list = article.querySelector(".moments");
    if (!game.moments.length) {
      list.innerHTML = `<p class="quiet">No blunders or mistake-level swings were found in this analysed game.</p>`;
    } else {
      for (const moment of game.moments) {
        const key = momentKey(game.id, moment.ply);
        const checked = state.selected.has(key) ? "checked" : "";
        const best = moment.best ? `<span>Candidate: ${escapeHtml(moment.best)}</span>` : "";
        const loss = moment.loss ? `<span>Drop: ${moment.loss} pawns</span>` : "";
        const priority = Math.round(moment.score || 0);
        const item = document.createElement("label");
        item.className = "moment";
        item.innerHTML = `
          <input type="checkbox" data-game="${game.id}" data-ply="${moment.ply}" ${checked}>
          <div>
            <strong>${escapeHtml(moment.kind)}: ${moment.moveNumber}. ${escapeHtml(moment.san)}</strong>
            <p>${loss}${best}<span>Priority: ${priority}</span></p>
            ${moment.comment ? `<small>${escapeHtml(moment.comment)}</small>` : ""}
          </div>
        `;
        list.appendChild(item);
      }
    }

    root.appendChild(article);
  }

  root.querySelectorAll("input[type='checkbox']").forEach((input) => {
    input.addEventListener("change", () => {
      const game = state.games.find((item) => item.id === input.dataset.game);
      const moment = game?.moments.find((item) => String(item.ply) === input.dataset.ply);
      const key = momentKey(input.dataset.game, input.dataset.ply);
      if (input.checked && moment) state.selected.set(key, { ...moment, gameId: game.id });
      else state.selected.delete(key);
      updateSummary();
    });
  });

  updateSummary();
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}

async function loadGames({ autoSelect = true } = {}) {
  state.token = $("token").value.trim();
  state.username = $("username").value.trim();
  if (!state.username) {
    setStatus("Enter your Lichess username.", "error");
    return false;
  }
  if ($("startDate").value && $("endDate").value && $("startDate").value > $("endDate").value) {
    setStatus("The start date needs to be before the end date.", "error");
    return false;
  }

  const range = dateRangeLabel();
  setStatus(`Loading analysed games from ${range}...`);
  const data = await postJson("/api/games", {
    token: state.token,
    username: state.username,
    max: $("maxGames").value,
    since: $("startDate").value,
    until: $("endDate").value,
  });
  state.games = data.games;
  state.selected.clear();
  if (autoSelect) autoSelectMoments();
  renderGames();
  setStatus(`Loaded ${state.games.length} games from ${range}.`, "success");
  return true;
}

async function createStudy() {
  state.token = $("token").value.trim();
  state.username = $("username").value.trim();
  const selected = selectedItems();
  if (!state.token) return setStatus("A Lichess token is needed to create a study.", "error");
  if (!selected.length) return setStatus("No critical moments were found to add to a study.", "error");

  const studyName = $("studyName").value || `Learning Lab - ${dateRangeLabel()}`;
  setStatus(`Creating short interactive lesson chapters from ${selected.length} selected moments...`);
  const data = await postJson("/api/create-study", {
    token: state.token,
    username: state.username,
    name: studyName,
    selected,
    games: state.games,
  });
  setStatus(`Created ${data.chaptersCreated} chapters: ${data.url}`, "success");
  window.open(data.url, "_blank", "noreferrer");
}

$("connect").addEventListener("click", async () => {
  try {
    await connectToLichess();
  } catch (error) {
    setConnectionView(false);
    setStatus(error.message, "error");
  }
});

$("editConnection").addEventListener("click", () => {
  setConnectionView(false);
  setStatus("Connection settings are open.", "info");
});

$("clearConnection").addEventListener("click", () => {
  clearSettings();
  setStatus("This device forgot the saved connection.", "success");
});

$("loadGames").addEventListener("click", async () => {
  try {
    await loadGames({ autoSelect: true });
  } catch (error) {
    setStatus(error.message, "error");
  }
});

$("createStudy").addEventListener("click", async () => {
  try {
    await createStudy();
  } catch (error) {
    setStatus(error.message, "error");
  }
});

$("autoStudy").addEventListener("click", async () => {
  try {
    const loaded = await loadGames({ autoSelect: true });
    if (loaded) await createStudy();
  } catch (error) {
    setStatus(error.message, "error");
  }
});

setDefaultDateRange();
loadSavedSettings();
if (state.token) {
  setConnectionView(true);
  connectToLichess({ silent: true }).catch((error) => {
    setConnectionView(false);
    setStatus(`Saved connection needs attention: ${error.message}`, "error");
  });
} else {
  setConnectionView(false);
}
renderGames();
