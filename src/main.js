
import "./style.css";

import {
  supabase,
  configured,
  ensureIdentity,
  callGameRpc,
} from "./backend.js";

import {
  TOTAL_TILES,
  MAX_PLAYERS,
  ROUND_SECONDS,
  formatClock,
  remainingSeconds,
  winnerLabel,
  isBonusTile,
  getTileOwner,
  getTileInitial,
} from "./game.js";

const app = document.querySelector("#app");

let playerId = null;
let match = null;
let realtimeChannel = null;
let countdownInterval = null;
let refreshInProgress = false;
let actionInProgress = false;
let notice = "";
let noticeType = "info";

const playerColors = ["#44e7ff", "#b58aff", "#ff7ab6", "#a6ff91"];

/* -------------------- MATCH DATA -------------------- */

function normalizeMatch(data) {
  if (!data || typeof data !== "object") {
    throw new Error("The server returned invalid match data.");
  }

  const players = Array.isArray(data.players) ? data.players : [];

  const board = Array.isArray(data.board)
    ? data.board
    : Array.isArray(data.tiles)
      ? data.tiles
      : [];

  const turnIndex = Number(data.turn_index ?? 0);
  const currentPlayer = players[turnIndex] ?? null;

  const tiles = Array.from({ length: TOTAL_TILES }, (_, index) => {
    const tile = board[index] ?? null;

    if (!tile || typeof tile !== "object") {
      return null;
    }

    return {
      ...tile,
      is_bonus:
        tile.is_bonus === true ||
        tile.isBonus === true ||
        Number(tile.points) >= 3 ||
        Number(tile.bonus_points) > 0,
    };
  });

  return {
    ...data,
    players,
    tiles,
    turn_index: turnIndex,
    status: data.status === "active" ? "playing" : data.status,
    current_player_id:
      data.current_player_id ??
      data.current_turn_player_id ??
      currentPlayer?.id ??
      currentPlayer?.player_id ??
      null,
    ends_at: data.ends_at ?? data.deadline_at ?? null,
  };
}

function getPlayers() {
  return Array.isArray(match?.players) ? match.players : [];
}

function getPlayerId(player) {
  return (
    player?.id ??
    player?.player_id ??
    player?.user_id ??
    player?.auth_user_id ??
    null
  );
}

function getBoard() {
  return Array.isArray(match?.tiles)
    ? match.tiles
    : Array(TOTAL_TILES).fill(null);
}

function getCurrentPlayer() {
  const current = match?.current_player_id;

  if (current == null) return null;

  return (
    getPlayers().find(
      (player) => String(getPlayerId(player)) === String(current),
    ) ?? null
  );
}

function isHost() {
  return Boolean(
    playerId && String(match?.host_id) === String(playerId),
  );
}

function isPlaying() {
  return match?.status === "playing";
}

function isFinished() {
  return match?.status === "finished";
}

function isMyTurn() {
  const currentPlayer = getCurrentPlayer();

  return Boolean(
    isPlaying() &&
    currentPlayer &&
    String(getPlayerId(currentPlayer)) === String(playerId),
  );
}

function getDeadline() {
  return match?.ends_at ?? match?.deadline_at ?? null;
}

function syncServerClock() {
  if (match?.server_now) {
    window.__neonServerTime = new Date(match.server_now).getTime();
    window.__neonServerSyncAt = Date.now();
  }
}

function getRemainingTime() {
  const deadline = getDeadline();

  if (!deadline) {
    return isPlaying() ? ROUND_SECONDS : 0;
  }

  const serverTime =
    Number.isFinite(window.__neonServerTime) &&
    Number.isFinite(window.__neonServerSyncAt)
      ? window.__neonServerTime +
        (Date.now() - window.__neonServerSyncAt)
      : Date.now();

  return remainingSeconds(deadline, serverTime);
}

function setNotice(message, type = "info") {
  notice = message;
  noticeType = type;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };

    return entities[character];
  });
}

function getPlayerColor(index) {
  return playerColors[index % playerColors.length];
}

function getPlayerForTile(tile) {
  const ownerId = getTileOwner(tile);

  return getPlayers().find(
    (player) => String(getPlayerId(player)) === String(ownerId),
  );
}

function getPlayerName(player) {
  return player?.name ?? player?.player_name ?? "Player";
}

/* -------------------- LOBBY -------------------- */

function renderLobby() {
  app.innerHTML = `
    <main class="app-shell">
      <header class="topbar">
        <a class="brand" href="#" aria-label="Neon Grid Clash home">
          <span class="brand-mark">N</span>
          <span>NEON GRID <strong>CLASH</strong></span>
        </a>

        <span class="connection-pill">
          <span class="status-dot"></span>
          ONLINE MULTIPLAYER
        </span>
      </header>

      <section class="hero">
        <div class="eyebrow">
          <span></span> STRATEGY. CLAIM. CONQUER.
        </div>

        <h1>Own the grid.<br /><span>Win the clash.</span></h1>

        <p class="hero-copy">
          Challenge your friends in a real-time multiplayer strategy battle.
          Claim tiles, collect bonus points, and finish on top.
        </p>

        <div class="game-facts">
          <div><strong>5 × 5</strong><span>GAME GRID</span></div>
          <div><strong>3:00</strong><span>ROUND TIMER</span></div>
          <div><strong>${MAX_PLAYERS}</strong><span>PLAYERS MAX</span></div>
        </div>
      </section>

      <section class="lobby-panel">
        <div class="section-heading">
          <span class="section-number">01</span>
          <div>
            <h2>Enter the arena</h2>
            <p>Choose a callsign, then create a room or join a friend.</p>
          </div>
        </div>

        <div class="shared-name">
          <label for="player-name">YOUR PLAYER NAME</label>
          <input
            id="player-name"
            type="text"
            maxlength="18"
            minlength="1"
            placeholder="Enter your callsign"
            autocomplete="nickname"
            required
          />
          <span class="field-hint">1–18 characters</span>
        </div>

        <div class="lobby-actions">
          <form id="create-form" class="action-card">
            <div class="action-icon create-icon">＋</div>
            <h3>Create a room</h3>
            <p>Host a new match and invite your opponents with a room code.</p>
            <button class="button button-primary" type="submit">
              Create room <span aria-hidden="true">↗</span>
            </button>
          </form>

          <form id="join-form" class="action-card">
            <div class="action-icon join-icon">⌁</div>
            <h3>Join a room</h3>
            <p>Have a room code? Enter it below to join the match.</p>

            <label for="room-code">ROOM CODE</label>
            <input
              id="room-code"
              name="code"
              type="text"
              maxlength="6"
              placeholder="e.g. A1B2C3"
              autocomplete="off"
              autocapitalize="characters"
              required
            />

            <button class="button button-secondary" type="submit">
              Join match <span aria-hidden="true">→</span>
            </button>
          </form>
        </div>

        <div id="notice-area">${renderNotice()}</div>
      </section>

      <section class="rules-strip">
        <div class="rules-heading">
          <span class="section-number">02</span>
          <h2>Know the rules</h2>
        </div>

        <div class="rules-grid">
          <article class="rule-item">
            <span class="rule-symbol">01</span>
            <div>
              <h3>Take turns</h3>
              <p>Claim one unoccupied tile on your turn.</p>
            </div>
          </article>

          <article class="rule-item">
            <span class="rule-symbol bonus-symbol">+3</span>
            <div>
              <h3>Find bonus tiles</h3>
              <p>Standard tiles score 1 point. Bonus tiles score 3.</p>
            </div>
          </article>

          <article class="rule-item">
            <span class="rule-symbol timer-symbol">3:00</span>
            <div>
              <h3>Beat the clock</h3>
              <p>When the round ends, the highest score wins.</p>
            </div>
          </article>
        </div>
      </section>

      <footer class="site-footer">
        <span>NEON GRID CLASH</span>
        <span>THINK FAST. PLAY SMART.</span>
      </footer>
    </main>
  `;

  document.querySelector("#create-form").addEventListener("submit", createRoom);
  document.querySelector("#join-form").addEventListener("submit", joinRoom);

  const nameInput = document.querySelector("#player-name");

  nameInput.addEventListener("input", () => {
    nameInput.classList.remove("input-error");
  });
}

/* -------------------- MATCH SCREEN -------------------- */

function renderMatch() {
  const players = getPlayers();
  const currentPlayer = getCurrentPlayer();
  const board = getBoard();
  const remaining = getRemainingTime();

  const statusLabel = isFinished()
    ? "MATCH COMPLETE"
    : isPlaying()
      ? "MATCH IN PROGRESS"
      : "WAITING FOR PLAYERS";

  const statusClass = isFinished()
    ? "status-finished"
    : isPlaying()
      ? "status-active"
      : "status-waiting";

  const currentName = currentPlayer
    ? getPlayerName(currentPlayer)
    : "Waiting for players";

  const timerClass = remaining <= 30 ? "timer-warning" : "";

  const playersHtml = players
    .map((player, index) => {
      const playerIsCurrent =
        isPlaying() &&
        String(getPlayerId(player)) ===
          String(getPlayerId(currentPlayer));

      const playerIsYou =
        String(getPlayerId(player)) === String(playerId);

      return `
        <article class="leader-row ${playerIsCurrent ? "leader-current" : ""}">
          <span class="player-color"
            style="--player-color:${getPlayerColor(index)}"></span>

          <div class="leader-details">
            <strong>
              ${escapeHtml(getPlayerName(player))}
              ${playerIsYou ? ' <span class="you-tag">YOU</span>' : ""}
            </strong>

            <span class="leader-state">
              ${
                playerIsCurrent
                  ? "CURRENT TURN"
                  : playerIsYou
                    ? "YOUR PLAYER"
                    : "IN THE ARENA"
              }
            </span>
          </div>

          <strong class="leader-score">
            ${Number(player.score) || 0}<small>PTS</small>
          </strong>
        </article>
      `;
    })
    .join("");

  /* -------------------- HIDDEN BONUS TILE LOGIC -------------------- */

  const tilesHtml = Array.from({ length: TOTAL_TILES }, (_, index) => {
    const tile = board[index] ?? null;

    const claimed = Boolean(tile && typeof tile === "object");

    const owner = claimed ? getPlayerForTile(tile) : null;

    const ownerIndex = owner
      ? players.findIndex(
          (player) =>
            String(getPlayerId(player)) === String(getPlayerId(owner)),
        )
      : -1;

    // IMPORTANT:
    // Bonus information is shown ONLY for claimed tiles.
    // Every unclaimed tile looks exactly the same.

    const bonus = claimed && (
      isBonusTile(tile) ||
      Number(tile.points) >= 3
    );

    const points = claimed
      ? Number(tile.points) || 1
      : 1;

    const canClaim = !claimed && isMyTurn() && !actionInProgress;

    let tileContent = "";

    if (claimed) {
      const initial = getTileInitial(tile, players) || "•";

      tileContent = `
        <span class="tile-initial">${escapeHtml(initial)}</span>
        <span class="tile-points">+${points}</span>
      `;
    } else {
      // No star, no bonus points, no bonus color.
      tileContent = `
        <span class="tile-number">${String(index + 1).padStart(2, "0")}</span>
        <span class="tile-empty-mark">＋</span>
      `;
    }

    const classes = [
      "board-tile",
      claimed ? "tile-claimed" : "",
      bonus ? "tile-bonus" : "",
      canClaim ? "tile-available" : "",
      claimed ? `tile-owner-${Math.max(0, ownerIndex)}` : "",
    ]
      .filter(Boolean)
      .join(" ");

    const ownerColor = claimed
      ? getPlayerColor(Math.max(0, ownerIndex))
      : "";

    const label = claimed
      ? `${getPlayerName(owner)}, ${points} points`
      : `Unclaimed tile ${index + 1}`;

    return `
      <button
        class="${classes}"
        type="button"
        data-tile-index="${index}"
        aria-label="${escapeHtml(label)}"
        ${claimed || !canClaim ? "disabled" : ""}
        style="${claimed ? `--tile-color:${ownerColor}` : ""}"
      >
        ${tileContent}
      </button>
    `;
  }).join("");

  /* -------------------- ACTION PANEL -------------------- */

  let actionPanel = "";

  if (isFinished()) {
    actionPanel = `
      <div class="result-banner">
        <span class="result-icon">✦</span>
        <div>
          <strong>${escapeHtml(winnerLabel(players))}</strong>
          <p>The round has ended. Check the final scores above.</p>
        </div>
      </div>

      <button class="button button-secondary" id="leave-button" type="button">
        Back to lobby
      </button>
    `;
  } else if (!isPlaying()) {
    actionPanel = `
      <div class="waiting-panel">
        <span class="waiting-pulse"></span>
        <div>
          <strong>
            ${players.length < 2 ? "Waiting for an opponent" : "Ready to start?"}
          </strong>
          <p>
            ${
              players.length < 2
                ? "Share the room code with another player. At least two players are needed."
                : "All players are in. The host can start the round."
            }
          </p>
        </div>
      </div>

      ${
        isHost()
          ? `<button class="button button-primary" id="start-button"
               type="button"
               ${players.length < 2 || actionInProgress ? "disabled" : ""}>
               Start match <span aria-hidden="true">↗</span>
             </button>`
          : `<p class="host-hint">The room host will start the round.</p>`
      }

      <button class="button button-quiet" id="leave-button" type="button">
        Leave room
      </button>
    `;
  } else {
    actionPanel = `
      <div class="turn-panel ${isMyTurn() ? "your-turn-panel" : ""}">
        <span class="turn-icon">${isMyTurn() ? "◎" : "◷"}</span>
        <div>
          <strong>
            ${
              isMyTurn()
                ? "Your turn — claim a tile"
                : `${escapeHtml(currentName)} is choosing`
            }
          </strong>

          <p>
            ${
              isMyTurn()
                ? "Select any unclaimed tile on the board."
                : "The board will update automatically after the move."
            }
          </p>
        </div>
      </div>

      <button class="button button-quiet" id="leave-button" type="button">
        Leave match
      </button>
    `;
  }

  /* -------------------- MATCH HTML -------------------- */

  app.innerHTML = `
    <main class="app-shell match-shell">

      <header class="topbar">
        <a class="brand" href="#" id="home-link"
          aria-label="Neon Grid Clash home">
          <span class="brand-mark">N</span>
          <span>NEON GRID <strong>CLASH</strong></span>
        </a>

        <span class="connection-pill">
          <span class="status-dot"></span>
          MULTIPLAYER
        </span>
      </header>

      <section class="match-header">
        <div>
          <div class="eyebrow">
            <span></span> THE ARENA IS YOURS
          </div>

          <h1 class="match-title">Grid <span>battle.</span></h1>
          <p class="match-subtitle">Claim your tiles. Outsmart your opponents.</p>
        </div>

        <div class="room-code-card">
          <span>ROOM CODE</span>
          <strong id="room-code-display">
            ${escapeHtml(match.room_code ?? "")}
          </strong>
          <button id="copy-code-button" class="copy-code-button" type="button">
            Copy code ⧉
          </button>
        </div>
      </section>

      <div id="match-notice">${renderNotice()}</div>

      <div class="match-layout">

        <section class="board-panel">
          <div class="panel-topline">
            <div>
              <span class="panel-kicker">LIVE MATCH</span>
              <h2>Battle grid</h2>
            </div>

            <span class="match-status ${statusClass}">
              <span></span>${statusLabel}
            </span>
          </div>

          <div class="timer-card">
            <div>
              <span class="timer-label">TIME REMAINING</span>
              <strong id="match-timer" class="${timerClass}">
                ${formatClock(remaining)}
              </strong>
            </div>

            <div class="timer-side">
              <span class="timer-ring">◷</span>
              <span>3-MINUTE ROUND</span>
            </div>
          </div>

          <div class="board-frame">
            <div class="board-grid" aria-label="5 by 5 battle grid">
              ${tilesHtml}
            </div>
          </div>

          <div class="board-legend">
            <span><i class="legend-standard"></i> Standard · 1 point</span>
            <span><i class="legend-bonus"></i> Bonus · 3 points</span>
          </div>

          <div class="action-area">${actionPanel}</div>
        </section>

        <aside class="sidebar">

          <section class="side-panel">
            <div class="panel-topline">
              <div>
                <span class="panel-kicker">RANKINGS</span>
                <h2>Scoreboard</h2>
              </div>

              <span class="player-count">
                ${players.length}/${MAX_PLAYERS}
              </span>
            </div>

            <div class="leaderboard">
              ${
                playersHtml ||
                '<p class="empty-state">Players will appear here.</p>'
              }
            </div>
          </section>

          <section class="side-panel rules-panel">
            <span class="panel-kicker">HOW TO PLAY</span>
            <h2>Game rules</h2>

            <ul class="rules-list">
              <li><span>01</span><p>Players take turns claiming one tile.</p></li>
              <li><span>02</span><p>Standard tiles give <strong>1 point</strong>.</p></li>
              <li><span>03</span><p>Hidden bonus tiles give <strong>3 points</strong>.</p></li>
              <li><span>04</span><p>The round lasts three minutes or until the board is full.</p></li>
              <li><span>05</span><p>The player with the highest score wins.</p></li>
            </ul>
          </section>

        </aside>
      </div>

      <footer class="site-footer">
        <span>NEON GRID CLASH</span>
        <span>THINK FAST. PLAY SMART.</span>
      </footer>
    </main>
  `;

  document.querySelector("#copy-code-button")
    ?.addEventListener("click", copyRoomCode);

  document.querySelector("#start-button")
    ?.addEventListener("click", startMatch);

  document.querySelector("#leave-button")
    ?.addEventListener("click", leaveRoom);

  document.querySelector("#home-link")
    ?.addEventListener("click", (event) => {
      event.preventDefault();
      setNotice("Use Leave room to return to the lobby.", "info");
      render();
    });

  document.querySelectorAll("[data-tile-index]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.tileIndex);
      claimTile(index);
    });
  });
}

/* -------------------- NOTICES AND RENDERING -------------------- */

function renderNotice() {
  if (!notice) return "";

  return `
    <div class="notice notice-${escapeHtml(noticeType)}" role="status">
      <span>
        ${
          noticeType === "error"
            ? "!"
            : noticeType === "success"
              ? "✓"
              : "i"
        }
      </span>

      <p>${escapeHtml(notice)}</p>

      <button type="button" class="notice-close"
        aria-label="Dismiss notice">×</button>
    </div>
  `;
}

function render() {
  if (!configured) {
    app.innerHTML = `
      <main class="setup-screen">
        <div class="setup-card">
          <span class="brand-mark">N</span>
          <h1>Connect your arena</h1>

          <p>
            Supabase is not configured yet. Add your project URL and anon key
            to the local environment file, then restart the development server.
          </p>

          <code>.env.local</code>

          <p class="setup-small">
            VITE_SUPABASE_URL=your_project_url<br />
            VITE_SUPABASE_ANON_KEY=your_anon_key
          </p>
        </div>
      </main>
    `;

    return;
  }

  if (match) {
    renderMatch();
  } else {
    renderLobby();
  }

  document.querySelectorAll(".notice-close").forEach((button) => {
    button.addEventListener("click", () => {
      notice = "";
      const noticeElement = button.closest(".notice");
      noticeElement?.remove();
    });
  });
}

/* -------------------- CREATE AND JOIN -------------------- */

function readPlayerName() {
  const input = document.querySelector("#player-name");
  const name = input?.value.trim() ?? "";

  if (!name) {
    input?.classList.add("input-error");
    input?.focus();
    throw new Error("Enter your player name first.");
  }

  if (name.length > 18) {
    throw new Error("Your player name must be 18 characters or fewer.");
  }

  return name;
}

async function createRoom(event) {
  event.preventDefault();

  if (actionInProgress) return;

  try {
    const name = readPlayerName();

    actionInProgress = true;
    setNotice("Creating your room…");
    render();

    playerId = await ensureIdentity();

    const result = await callGameRpc("create_match", {
      p_name: name,
    });

    match = normalizeMatch(result);

    syncServerClock();
    await attachRealtime();
    startClock();

    setNotice(`Room ${match.room_code} created. Invite another player!`, "success");

    actionInProgress = false;
    render();

  } catch (error) {
    actionInProgress = false;
    setNotice(error.message || "Could not create the room.", "error");
    render();
  }
}

async function joinRoom(event) {
  event.preventDefault();

  if (actionInProgress) return;

  try {
    const name = readPlayerName();

    const code = document.querySelector("#room-code")
      ?.value.trim().toUpperCase();

    if (!code || code.length !== 6) {
      throw new Error("Enter the six-character room code.");
    }

    actionInProgress = true;
    setNotice("Joining the room…");
    render();

    playerId = await ensureIdentity();

    const result = await callGameRpc("join_match", {
      p_code: code,
      p_name: name,
    });

    match = normalizeMatch(result);

    syncServerClock();
    await attachRealtime();
    startClock();

    setNotice(`You joined room ${match.room_code}.`, "success");

    actionInProgress = false;
    render();

  } catch (error) {
    actionInProgress = false;
    setNotice(error.message || "Could not join the room.", "error");
    render();
  }
}

/* -------------------- MATCH ACTIONS -------------------- */

async function startMatch() {
  if (!match || actionInProgress) return;

  actionInProgress = true;
  setNotice("Starting the match…");
  render();

  try {
    const result = await callGameRpc("start_match", {
      p_code: match.room_code,
    });

    match = normalizeMatch(result);

    syncServerClock();
    await refreshMatch(false);
    startClock();

    setNotice("Match started. Make your move!", "success");

  } catch (error) {
    setNotice(error.message || "Could not start the match.", "error");

  } finally {
    actionInProgress = false;
    render();
  }
}

async function claimTile(index) {
  if (!match || !isPlaying() || actionInProgress) return;

  if (!Number.isInteger(index) || index < 0 || index >= TOTAL_TILES) {
    setNotice("That tile is not valid.", "error");
    render();
    return;
  }

  if (!isMyTurn()) {
    setNotice("Wait for your turn before claiming a tile.", "error");
    render();
    return;
  }

  if (getBoard()[index]) {
    setNotice("That tile has already been claimed.", "error");
    render();
    return;
  }

  actionInProgress = true;

  try {
    const result = await callGameRpc("claim_tile", {
      p_code: match.room_code,
      p_index: index,
    });

    match = normalizeMatch(result);
    syncServerClock();

    setNotice("Tile claimed!", "success");

  } catch (error) {
    setNotice(error.message || "Could not claim that tile.", "error");

    await refreshMatch(false).catch(() => {});

  } finally {
    actionInProgress = false;
    render();
  }
}

async function copyRoomCode() {
  const code = match?.room_code;

  if (!code) return;

  try {
    await navigator.clipboard.writeText(code);
    setNotice("Room code copied. Send it to your opponent.", "success");

  } catch {
    setNotice(
      `Share this room code with your opponent: ${code}`,
      "info",
    );
  }

  render();
}

async function leaveRoom() {
  stopClock();

  if (realtimeChannel && supabase) {
    try {
      await supabase.removeChannel(realtimeChannel);

    } catch (error) {
      console.warn("Could not close the realtime channel:", error);
    }
  }

  realtimeChannel = null;
  match = null;
  playerId = null;
  refreshInProgress = false;
  actionInProgress = false;

  setNotice("You have left the room.", "info");
  render();
}

/* -------------------- REALTIME AND REFRESH -------------------- */

async function attachRealtime() {
  if (!supabase || !match?.id) return;

  if (realtimeChannel) {
    await supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }

  realtimeChannel = supabase
    .channel(`neon-match-${match.id}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "matches",
        filter: `id=eq.${match.id}`,
      },
      async () => {
        try {
          await refreshMatch();

        } catch (error) {
          console.error("Realtime refresh failed:", error);
        }
      },
    )
    .subscribe((status) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.warn("Realtime connection status:", status);
      }
    });
}

async function refreshMatch(shouldRender = true) {
  if (!match?.room_code || refreshInProgress) return;

  refreshInProgress = true;

  try {
    const updated = await callGameRpc("get_match", {
      p_code: match.room_code,
    });

    match = normalizeMatch(updated);

    syncServerClock();

    if (isFinished()) {
      stopClock();
    }

    if (shouldRender) render();

  } finally {
    refreshInProgress = false;
  }
}

/* -------------------- TIMER -------------------- */

function startClock() {
  stopClock();

  if (!match) return;

  countdownInterval = window.setInterval(async () => {
    if (!match) {
      stopClock();
      return;
    }

    const timer = document.querySelector("#match-timer");
    const seconds = getRemainingTime();

    if (timer) {
      timer.textContent = formatClock(seconds);
      timer.classList.toggle("timer-warning", seconds <= 30);
    }

    if (isPlaying() && seconds <= 0) {
      try {
        await refreshMatch();

      } catch (error) {
        console.error("Could not refresh the match timer:", error);
      }
    }
  }, 1000);
}

function stopClock() {
  if (countdownInterval !== null) {
    window.clearInterval(countdownInterval);
    countdownInterval = null;
  }
}

/* -------------------- START APP -------------------- */

render();
