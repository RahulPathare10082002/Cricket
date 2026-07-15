/**
 * Cricket Team Splitter — players.js
 *
 * All player-related constants, validation, rendering, and event handlers.
 * Loaded before app.js. Relies on utilities defined in app.js (esc, generateId,
 * getPlayerById, saveState, render, renderSummary, updateGenerateButton,
 * showToast, showFieldError, clearFieldError, fmtScore).
 */
'use strict';

/* ================================================================
   PLAYER CONSTANTS
   ================================================================ */

const ROLES = {
  normal:     'No role',
  batter:     'Batter',
  bowler:     'Bowler',
  allrounder: 'All-Rounder',
  keeper:     'Keeper',
};

const SKILLS = {
  normal: 'Normal',
  strong: 'Strong',
  weak:   'Weak',
};

/**
 * Skill score model used for team balancing:
 *   strong (any role)            → +3
 *   allrounder (normal/weak)     → +2
 *   batter / bowler / keeper     → +1
 *   normal role + normal skill   →  0
 *   weak (any role)              → -2
 */
function playerScore(player) {
  if (player.skill === 'strong') return 3;
  if (player.skill === 'weak')   return -2;
  if (player.role === 'allrounder') return 2;
  if (player.role === 'batter' || player.role === 'bowler' || player.role === 'keeper') return 1;
  return 0;
}

/* ================================================================
   PLAYER VALIDATION
   ================================================================ */

function validatePlayerName(name, existingPlayers, excludeId) {
  const trimmed = name.trim();
  if (!trimmed) return { valid: false, error: 'Name cannot be empty.' };
  if (trimmed.length > 40) return { valid: false, error: 'Name is too long (max 40 chars).' };
  const lower = trimmed.toLowerCase();
  const dup = existingPlayers.find(p => p.id !== excludeId && p.nameLower === lower);
  if (dup) return { valid: false, error: `"${esc(trimmed)}" is already in the list.` };
  return { valid: true, error: null };
}

/* ================================================================
   PLAYER RENDERING
   ================================================================ */

/** Build a role badge HTML string */
function roleBadge(role) {
  if (role === 'normal') return '';
  return `<span class="badge badge--role-${esc(role)}">${esc(ROLES[role] || role)}</span>`;
}

/** Build a skill badge HTML string */
function skillBadge(skill) {
  if (skill === 'normal') return '';
  return `<span class="badge badge--skill-${esc(skill)}">${esc(SKILLS[skill] || skill)}</span>`;
}

function renderPlayerList(state) {
  const list  = document.getElementById('player-list');
  const badge = document.getElementById('player-count-badge');
  const playingCount = state.players.filter(p => p.playing !== false).length;
  badge.textContent = state.players.length === playingCount
    ? state.players.length
    : `${playingCount}/${state.players.length}`;

  if (state.players.length === 0) {
    list.innerHTML = '<li class="empty-state">No players yet. Add some above!</li>';
    return;
  }

  list.innerHTML = state.players.map(p => {
    const score   = playerScore(p);
    const playing = p.playing !== false;
    return `
      <li class="player-item ${playing ? '' : 'player-item--not-playing'}" data-player-id="${esc(p.id)}">
        <span class="player-name">${esc(p.name)}</span>
        <span class="player-badges">
          ${roleBadge(p.role)}
          ${skillBadge(p.skill)}
        </span>
        <span class="player-score" title="Skill score">${fmtScore(score)}</span>
        <span class="player-actions">
          <button
            class="btn btn--sm ${playing ? 'btn--ghost-green' : 'btn--rest'} playing-toggle"
            title="${playing ? 'Mark as not playing' : 'Mark as playing'}"
            data-action="toggle-playing"
            data-id="${esc(p.id)}"
            aria-label="${playing ? 'Mark not playing' : 'Mark playing'}"
          >${playing ? 'Playing' : 'Resting'}</button>
          <button
            class="btn btn--icon"
            title="Edit player"
            data-action="edit-player"
            data-id="${esc(p.id)}"
            aria-label="Edit ${esc(p.name)}"
          >✎</button>
          <button
            class="btn btn--icon"
            title="Delete player"
            data-action="delete-player"
            data-id="${esc(p.id)}"
            aria-label="Delete ${esc(p.name)}"
          >✕</button>
        </span>
      </li>`;
  }).join('');
}

/** Replace a player list item with an inline edit form */
function renderPlayerEditRow(state, playerId) {
  const item = document.querySelector(`[data-player-id="${playerId}"]`);
  if (!item) return;
  const player = getPlayerById(state, playerId);
  if (!player) return;

  const roleOptions = Object.entries(ROLES).map(([v, l]) =>
    `<option value="${v}" ${player.role === v ? 'selected' : ''}>${esc(l)}</option>`
  ).join('');
  const skillOptions = Object.entries(SKILLS).map(([v, l]) =>
    `<option value="${v}" ${player.skill === v ? 'selected' : ''}>${esc(l)}</option>`
  ).join('');

  item.classList.add('player-item--editing');
  item.innerHTML = `
    <div class="player-edit-row">
      <input
        type="text"
        value="${esc(player.name)}"
        maxlength="40"
        id="edit-name-${esc(playerId)}"
        aria-label="Edit name"
        autocomplete="off"
      />
      <select id="edit-role-${esc(playerId)}" aria-label="Edit role">${roleOptions}</select>
      <select id="edit-skill-${esc(playerId)}" aria-label="Edit skill">${skillOptions}</select>
      <button class="btn btn--primary btn--sm" data-action="save-player" data-id="${esc(playerId)}">Save</button>
      <button class="btn btn--ghost-green btn--sm" data-action="cancel-edit" data-id="${esc(playerId)}">Cancel</button>
    </div>
    <div class="form-error" id="edit-error-${esc(playerId)}"></div>
  `;
  const nameInput = document.getElementById(`edit-name-${playerId}`);
  if (nameInput) { nameInput.focus(); nameInput.select(); }
}

/* ================================================================
   PLAYER EVENT HANDLERS
   ================================================================ */

function onAddPlayer(e, state) {
  e.preventDefault();
  clearFieldError('add-player-name-wrap');

  const nameInput   = document.getElementById('input-player-name');
  const roleSelect  = document.getElementById('select-role');
  const skillSelect = document.getElementById('select-skill');
  const name = nameInput.value.trim();

  const v = validatePlayerName(name, state.players, null);
  if (!v.valid) {
    showFieldError('add-player-name-wrap', v.error);
    nameInput.focus();
    return;
  }

  state.players.push({
    id:        generateId(),
    name:      name,
    nameLower: name.toLowerCase(),
    role:      roleSelect.value,
    skill:     skillSelect.value,
    playing:   true,
    addedAt:   Date.now(),
  });

  state.lastResult = null;
  saveState(state);
  render(state);

  nameInput.value = '';
  nameInput.focus();
}

function onBulkAdd(state) {
  const textarea    = document.getElementById('bulk-textarea');
  const roleSelect  = document.getElementById('bulk-role');
  const skillSelect = document.getElementById('bulk-skill');
  const raw = textarea.value;

  if (!raw.trim()) {
    showToast('No names entered.', 'warning');
    return;
  }

  const names = raw.split(/[\n,;]/).map(n => n.trim()).filter(n => n.length > 0);
  if (names.length === 0) {
    showToast('No valid names found.', 'warning');
    return;
  }

  let added = 0, skipped = 0;
  const role  = roleSelect.value;
  const skill = skillSelect.value;

  names.forEach(name => {
    const v = validatePlayerName(name, state.players, null);
    if (!v.valid) { skipped++; return; }
    state.players.push({
      id:        generateId(),
      name:      name,
      nameLower: name.toLowerCase(),
      role,
      skill,
      playing:   true,
      addedAt:   Date.now(),
    });
    added++;
  });

  state.lastResult = null;
  saveState(state);
  render(state);
  textarea.value = '';

  if (skipped > 0) {
    showToast(`Added ${added} player(s). Skipped ${skipped} duplicate/invalid name(s).`, 'warning');
  } else {
    showToast(`Added ${added} player(s).`, 'success');
  }
}

function onTogglePlaying(playerId, state) {
  const player = getPlayerById(state, playerId);
  if (!player) return;
  player.playing = player.playing === false ? true : false;
  saveState(state);
  renderPlayerList(state);
  renderSummary(state);
  updateGenerateButton(state);
}

function onDeletePlayer(playerId, state) {
  if (!window.confirm('Remove this player?')) return;
  state.players = state.players.filter(p => p.id !== playerId);
  state.constraints = state.constraints.filter(
    c => c.playerAId !== playerId && c.playerBId !== playerId
  );
  state.lastResult = null;
  saveState(state);
  render(state);
}

function onEditPlayer(playerId, state) {
  renderPlayerEditRow(state, playerId);
}

function onSavePlayer(playerId, state) {
  const nameInput   = document.getElementById(`edit-name-${playerId}`);
  const roleSelect  = document.getElementById(`edit-role-${playerId}`);
  const skillSelect = document.getElementById(`edit-skill-${playerId}`);
  const errorEl     = document.getElementById(`edit-error-${playerId}`);

  if (!nameInput) return;
  const name = nameInput.value.trim();
  const v = validatePlayerName(name, state.players, playerId);
  if (!v.valid) {
    if (errorEl) errorEl.textContent = v.error;
    nameInput.focus();
    return;
  }

  const player = getPlayerById(state, playerId);
  if (player) {
    player.name      = name;
    player.nameLower = name.toLowerCase();
    player.role      = roleSelect.value;
    player.skill     = skillSelect.value;
  }

  state.lastResult = null;
  saveState(state);
  render(state);
}

function onCancelEdit(state) {
  render(state);
}

/* ================================================================
   PLAYER EVENT BINDING
   ================================================================ */

function bindPlayerEvents(state) {
  document.getElementById('add-player-form')
    .addEventListener('submit', e => onAddPlayer(e, state));

  document.getElementById('btn-bulk-add')
    .addEventListener('click', () => onBulkAdd(state));

  document.getElementById('player-list').addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const id     = btn.dataset.id;
    if (action === 'delete-player')  onDeletePlayer(id, state);
    if (action === 'edit-player')    onEditPlayer(id, state);
    if (action === 'save-player')    onSavePlayer(id, state);
    if (action === 'cancel-edit')    onCancelEdit(state);
    if (action === 'toggle-playing') onTogglePlaying(id, state);
  });

  document.getElementById('player-list').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const saveBtn = e.target.closest('.player-edit-row')?.querySelector('[data-action="save-player"]');
      if (saveBtn) { e.preventDefault(); saveBtn.click(); }
    }
  });
}