export const BOARD_SIZE = 5;
export const TOTAL_TILES = BOARD_SIZE * BOARD_SIZE;
export const MAX_PLAYERS = 4;
export const ROUND_SECONDS = 180;

// These positions are used by the backend game rules.
// The frontend does not reveal bonus locations before a tile is claimed.
export const BONUS_TILES = new Set([2, 6, 8, 12, 16, 18, 22]);

export function initialBoard() {
  return Array.from({ length: TOTAL_TILES }, () => null);
}

export function remainingSeconds(deadline, serverNow = Date.now()) {
  if (!deadline) return 0;

  const endTime = new Date(deadline).getTime();

  if (!Number.isFinite(endTime)) return 0;

  return Math.max(0, Math.ceil((endTime - serverNow) / 1000));
}

export function formatClock(seconds) {
  const safeSeconds = Math.max(0, seconds);

  const minutes = Math.floor(safeSeconds / 60);
  const remaining = safeSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}

export function winnerLabel(players = []) {
  if (!players.length) return "No winner";

  const highestScore = Math.max(
    ...players.map((player) => Number(player.score) || 0)
  );

  const winners = players.filter(
    (player) => (Number(player.score) || 0) === highestScore
  );

  if (winners.length === 1) {
    return `${winners[0].name} wins!`;
  }

  return `Tie game · ${winners.map((player) => player.name).join(" & ")}`;
}

export function isBonusTile(tile) {
  if (!tile || typeof tile !== "object") return false;

  return (
    tile.is_bonus === true ||
    tile.isBonus === true ||
    tile.bonus === true ||
    Number(tile.bonus_points) > 0 ||
    Number(tile.bonusPoints) > 0
  );
}

export function getTileOwner(tile) {
  if (!tile || typeof tile !== "object") return null;

  return (
    tile.player_id ??
    tile.playerId ??
    tile.owner_id ??
    tile.ownerId ??
    null
  );
}

export function getTilePlayerName(tile, players = []) {
  if (!tile || typeof tile !== "object") return "";

  if (tile.player_name || tile.playerName || tile.name) {
    return tile.player_name || tile.playerName || tile.name;
  }

  const ownerId = getTileOwner(tile);

  const owner = players.find((player) => player.id === ownerId);

  return owner?.name ?? "";
}

export function getTileInitial(tile, players = []) {
  const name = getTilePlayerName(tile, players);

  return name ? name.trim().charAt(0).toUpperCase() : "";
}