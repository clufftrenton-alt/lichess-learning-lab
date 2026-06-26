const state = {
  token: "",
  username: "",
  games: [],
  selected: new Map(),
};

const $ = (id) => document.getElementById(id);

function setStatus(message, type = "info") {
  const status = $("status");
  status.hidden = !message;
  status.textContent = message || "";
  status.className = `status ${type}`;
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

function selectedItems() {
  return Array.from(state.selected.values());
}

function momentKey(gameId, ply) {
  return `${gameId}:${ply}`;
}

function updateSummary() {
  const momentCount = state.games.reduce((total, game) => total + game.moments.length, 0);
  const selected = selectedItems().length;
  $("summary").textContent = state.games.length
    ? `${state.games.length} analysed games, ${momentCount} learnable moments, ${selected} selected.`
    : "Connect, load games, then choose what belongs in your study.";
}

function renderGames() {
  const root = $("games");
  root.innerHTML = "";
  root.className = state.games.length ? "games" : "games empty";

  if (!state.games.length) {
    root.innerHTML = `
      <div class="empty-state">
        <h3>No games loaded yet</h3>
        <p>Analysed Lichess games will appear here with blunders, mistakes, inaccuracies, and sharp evaluation swings.</p>
      </div>
    `;
    updateSummary();
    return;
  }

  for (const game of state.games) {
    const article = document.createElement("article");
    article.className = "game-card";
    const opening = game.opening?.name ? `<span>${game.opening.name}</span>` : "";
    article.innerHTML = `
      <header>
        <div>
          <h3>${escapeHtml(game.title)}</h3>
          <p>${escapeHtml(game.color)} · ${escapeHtml(game.speed || "game")} · ${escapeHtml(game.result)}</p>
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
        const item = document.createElement("label");
        item.className = "moment";
        item.innerHTML = `
          <input type="checkbox" data-game="${game.id}" data-ply="${moment.ply}" ${checked}>
          <div>
            <strong>${escapeHtml(moment.kind)}: ${moment.moveNumber}. ${escapeHtml(moment.san)}</strong>
            <p>${loss}${best}</p>
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

$("connect").addEventListener("click", async () => {
  state.token = $("token").value.trim();
  if (!state.token) return setStatus("Paste a Lichess token first.", "error");
  setStatus("Connecting to Lichess...");
  try {
    const profile = await postJson("/api/profile", { token: state.token });
    state.username = profile.username || profile.id || "";
    $("username").value = state.username;
    setStatus(`Connected as ${state.username}.`, "success");
  } catch (error) {
    setStatus(error.message, "error");
  }
});

$("loadGames").addEventListener("click", async () => {
  state.token = $("token").value.trim();
  state.username = $("username").value.trim();
  if (!state.username) return setStatus("Enter your Lichess username.", "error");
  setStatus("Loading analysed games from Lichess...");
  try {
    const data = await postJson("/api/games", {
      token: state.token,
      username: state.username,
      max: $("maxGames").value,
    });
    state.games = data.games;
    state.selected.clear();
    renderGames();
    setStatus(`Loaded ${state.games.length} games.`, "success");
  } catch (error) {
    setStatus(error.message, "error");
  }
});

$("createStudy").addEventListener("click", async () => {
  state.token = $("token").value.trim();
  state.username = $("username").value.trim();
  const selected = selectedItems();
  if (!state.token) return setStatus("A Lichess token is needed to create a study.", "error");
  if (!selected.length) return setStatus("Select at least one moment first.", "error");
  setStatus("Creating your Lichess study...");
  try {
    const data = await postJson("/api/create-study", {
      token: state.token,
      username: state.username,
      name: $("studyName").value,
      selected,
      games: state.games,
    });
    setStatus(`Created ${data.chaptersCreated} chapters: ${data.url}`, "success");
    window.open(data.url, "_blank", "noreferrer");
  } catch (error) {
    setStatus(error.message, "error");
  }
});

renderGames();
