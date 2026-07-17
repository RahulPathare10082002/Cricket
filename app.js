/**
 * Cricket Team Splitter — app.js
 *
 * Core application logic: state management, utilities, team generation,
 * rendering, and event binding. Player-specific code lives in players.js
 * which must be loaded first.
 *
 * Sections:
 * A. Constants & Configuration
 * B. State Management
 * C. Utility Functions
 * D. Validation
 * E. Team Generation Algorithm
 * F. Rendering
 * G. Event Binding
 * H–L. Match Scoring
 * M. Bootstrap
 */
'use strict';

/* ================================================================
 A. CONSTANTS & CONFIGURATION
 ================================================================ */

const STORAGE_KEY = 'cricketTeamSplitter_v1';
const MIN_PLAYERS = 2;
const SCHEMA_VERSION = 1;

 /* ================================================================
 B. STATE MANAGEMENT
 ================================================================ */

 function getDefaultState() {
 return {
 version: SCHEMA_VERSION,
 settings: {
 teamSize: null, // null = auto
 seed: '',
 lastSeedUsed: '',
 },
 players: [],
 constraints: [],
 lastResult: null,
 captainStats: {}, // keyed by playerId: { playerId, wins, losses, ties, matches }
 };
 }

 function loadState() {
 try {
 const raw = localStorage.getItem(STORAGE_KEY);
 if (!raw) return getDefaultState();
 const parsed = JSON.parse(raw);
 if (!parsed || parsed.version !== SCHEMA_VERSION) return getDefaultState();
 // Ensure required arrays exist (guard against partial corruption)
 parsed.players = Array.isArray(parsed.players) ? parsed.players : [];
 parsed.constraints = Array.isArray(parsed.constraints) ? parsed.constraints : [];
 parsed.settings = parsed.settings || {};
 parsed.settings.teamSize = parsed.settings.teamSize ?? null;
 parsed.settings.seed = parsed.settings.seed ?? '';
 parsed.settings.lastSeedUsed = parsed.settings.lastSeedUsed ?? '';
 // Migrate: ensure every player has playing and teamPin fields
 parsed.players.forEach(p => {
 if (p.playing === undefined) p.playing = true;
 if (p.teamPin === undefined) p.teamPin = null; // null = Auto, 'A', 'B', 'bench'
 });
 // Migrate: ensure captainStats exists
 if (!parsed.captainStats || typeof parsed.captainStats !== 'object') {
 parsed.captainStats = {};
 }
 return parsed;
 } catch (_) {
 return getDefaultState();
 }
 }

 function saveState(state) {
 try {
 localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
 } catch (e) {
 // localStorage may be full or disabled — fail silently but warn
 console.warn('Could not save state to localStorage:', e);
 }
 }

 /* ================================================================
 C. UTILITY FUNCTIONS
 ================================================================ */

 function generateId() {
 if (typeof crypto !== 'undefined' && crypto.randomUUID) {
 return crypto.randomUUID();
 }
 // Fallback for very old browsers
 return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
 const r = (Math.random() * 16) | 0;
 return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
 });
 }

 /** djb2 string → 32-bit unsigned integer hash */
 function djb2Hash(str) {
 let hash = 5381;
 for (let i = 0; i < str.length; i++) {
 hash = ((hash << 5) + hash) + str.charCodeAt(i);
 hash = hash >>> 0; // keep as 32-bit unsigned
 }
 return hash;
 }

 /** mulberry32 PRNG — returns a closure () → float [0, 1) */
 function mulberry32(seed) {
 let s = seed >>> 0;
 return function () {
 s += 0x6d2b79f5;
 let t = s;
 t = Math.imul(t ^ (t >>> 15), t | 1);
 t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
 t = (t ^ (t >>> 14)) >>> 0;
 return t / 4294967296;
 };
 }

 /** Fisher-Yates in-place shuffle using a provided random function */
 function shuffleArray(arr, randFn) {
 for (let i = arr.length - 1; i > 0; i--) {
 const j = Math.floor(randFn() * (i + 1));
 [arr[i], arr[j]] = [arr[j], arr[i]];
 }
 return arr;
 }

 /** Safe HTML escaping */
 function esc(str) {
 return String(str)
 .replace(/&/g, '&amp;')
 .replace(/</g, '&lt;')
 .replace(/>/g, '&gt;')
 .replace(/"/g, '&quot;');
 }

 function getPlayerById(state, id) {
 return state.players.find(p => p.id === id) || null;
 }

 function getPlayerName(state, id) {
 const p = getPlayerById(state, id);
 return p ? p.name : '(unknown)';
 }

 /** Format a score as "+3", "-2", "0" */
 function fmtScore(n) {
 if (n > 0) return '+' + n;
 return String(n);
 }

 /** Format timestamp to readable local time */
 function fmtTime(ts) {
 if (!ts) return 'Never';
 return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
 }

 /* ================================================================
 D. VALIDATION
 ================================================================ */

 function validateConstraint(state, aId, bId, type) {
 if (!aId || !bId) return { valid: false, error: 'Select both players.' };
 if (aId === bId) return { valid: false, error: 'Choose two different players.' };

 const exists = state.constraints.find(c =>
 ((c.playerAId === aId && c.playerBId === bId) ||
 (c.playerAId === bId && c.playerBId === aId)) &&
 c.type === type
 );
 if (exists) return { valid: false, error: 'This constraint already exists.' };

 // Detect direct contradiction: same pair, opposite type already exists
 const opposite = state.constraints.find(c =>
 ((c.playerAId === aId && c.playerBId === bId) ||
 (c.playerAId === bId && c.playerBId === aId)) &&
 c.type !== type
 );
 if (opposite) {
 const na = getPlayerName(state, aId);
 const nb = getPlayerName(state, bId);
 return {
 valid: false,
 error: `${na} and ${nb} already have the opposite constraint. Remove it first.`,
 };
 }
 return { valid: true, error: null };
 }

 function validateGenerationPreconditions(state) {
 const errors = [];
 const playing = state.players.filter(p => p.playing !== false);
 if (playing.length < MIN_PLAYERS) {
 errors.push(`Need at least ${MIN_PLAYERS} playing players.`);
 }
 if (state.settings.teamSize !== null) {
 const ts = state.settings.teamSize;
 if (ts < 1 || ts > 20) errors.push('Team size must be between 1 and 20.');
 if (ts * 2 > playing.length) {
 errors.push(`Team size ${ts} requires at least ${ts * 2} playing players (you have ${playing.length}).`);
 }
 }
 return { valid: errors.length === 0, errors };
 }

 /* ================================================================
 E. TEAM GENERATION ALGORITHM
 ================================================================ */

 /**
 * Simple Union-Find (disjoint set) with path compression + union by rank.
 */
 function UnionFind(ids) {
 this.parent = {};
 this.rank = {};
 ids.forEach(id => { this.parent[id] = id; this.rank[id] = 0; });
 }
 UnionFind.prototype.find = function (x) {
 if (this.parent[x] !== x) this.parent[x] = this.find(this.parent[x]); // path compression
 return this.parent[x];
 };
 UnionFind.prototype.union = function (x, y) {
 const px = this.find(x), py = this.find(y);
 if (px === py) return;
 if (this.rank[px] < this.rank[py]) { this.parent[px] = py; }
 else if (this.rank[px] > this.rank[py]) { this.parent[py] = px; }
 else { this.parent[py] = px; this.rank[px]++; }
 };
 UnionFind.prototype.same = function (x, y) { return this.find(x) === this.find(y); };

 /**
 * Main team generation entry point.
 * Returns { teamA, teamB, bench, teamAScore, teamBScore, warnings, seedUsed, generatedAt }
 * Throws a string on hard precondition failure.
 */
 function generateTeams(state) {
 // Step 1: Preconditions
 const pre = validateGenerationPreconditions(state);
 if (!pre.valid) throw pre.errors.join(' ');

 const warnings = [];

 // Step 2: PRNG
 const seedStr = state.settings.seed.trim() !== '' ? state.settings.seed.trim() : String(Date.now());
 const randFn = mulberry32(djb2Hash(seedStr));

 // Step 3: Team size — use only playing players
 const activePlayers = state.players.filter(p => p.playing !== false);
 const playerCount = activePlayers.length;
 const teamSize = (state.settings.teamSize !== null)
 ? state.settings.teamSize
 : Math.floor(playerCount / 2);

 // Step 4: Build Union-Find; apply "same" constraints (playing players only)
 const uf = new UnionFind(activePlayers.map(p => p.id));
 state.constraints.forEach(c => {
 if (c.type === 'same') uf.union(c.playerAId, c.playerBId);
 });

 // Step 5: Detect indirect conflicts (same-group but also opposite constraint)
 const ignoredConstraintIds = new Set();
 state.constraints.forEach(c => {
 if (c.type === 'opposite' && uf.same(c.playerAId, c.playerBId)) {
 const na = getPlayerName(state, c.playerAId);
 const nb = getPlayerName(state, c.playerBId);
 warnings.push(
 `Cannot separate ${na} and ${nb}: they are linked by "same team" constraints. ` +
 `The "opposite" constraint between them will be ignored.`
 );
 ignoredConstraintIds.add(c.id);
 }
 });

 // Step 6: Extract groups from Union-Find (playing players only)
 const groupMap = {}; // rootId → { ids, score }
 activePlayers.forEach(p => {
 const root = uf.find(p.id);
 if (!groupMap[root]) groupMap[root] = { ids: [], score: 0, pinnedTo: null };
 groupMap[root].ids.push(p.id);
 groupMap[root].score += playerScore(p);
 });
 let groups = Object.values(groupMap);

 // Step 7: Warn about oversized groups
 groups.forEach(g => {
 if (g.ids.length > teamSize) {
 const names = g.ids.map(id => getPlayerName(state, id)).join(', ');
 warnings.push(
 `A group of ${g.ids.length} players (${names}) exceeds the team size of ${teamSize}. ` +
 `They cannot all fit on a single team; some will go to the bench.`
 );
 }
 });

 // Step 7b: Apply manual team pins (teamPin overrides everything)
 groups.forEach(g => {
 g.ids.forEach(id => {
 const p = getPlayerById(state, id);
 if (!p || !p.teamPin) return;
 if (p.teamPin === 'A') g.pinnedTo = 'A';
 else if (p.teamPin === 'B') g.pinnedTo = 'B';
 else if (p.teamPin === 'bench') g.pinnedTo = 'bench';
 });
 });

 // Shuffle groups to randomize assignment order
 shuffleArray(groups, randFn);

 // Step 8: Pin groups via "opposite" constraints
 // For each valid opposite constraint, find the groups and pin them to A/B.
 const activeOpposite = state.constraints.filter(
 c => c.type === 'opposite' && !ignoredConstraintIds.has(c.id)
 );
 activeOpposite.forEach(c => {
 const rootA = uf.find(c.playerAId);
 const rootB = uf.find(c.playerBId);
 const ga = groups.find(g => g.ids.includes(c.playerAId));
 const gb = groups.find(g => g.ids.includes(c.playerBId));
 if (!ga || !gb || ga === gb) return; // same group (should be caught above)

 if (ga.pinnedTo === null && gb.pinnedTo === null) {
 ga.pinnedTo = 'A'; gb.pinnedTo = 'B';
 } else if (ga.pinnedTo === 'A' && gb.pinnedTo === null) {
 gb.pinnedTo = 'B';
 } else if (ga.pinnedTo === 'B' && gb.pinnedTo === null) {
 gb.pinnedTo = 'A';
 } else if (ga.pinnedTo === null && gb.pinnedTo === 'A') {
 ga.pinnedTo = 'B';
 } else if (ga.pinnedTo === null && gb.pinnedTo === 'B') {
 ga.pinnedTo = 'A';
 } else if (ga.pinnedTo !== null && gb.pinnedTo !== null) {
 // Both already pinned
 if (ga.pinnedTo === gb.pinnedTo) {
 // Conflict: both ended up on the same side
 const na = getPlayerName(state, c.playerAId);
 const nb = getPlayerName(state, c.playerBId);
 warnings.push(
 `Constraint conflict: ${na} and ${nb} must be on opposite teams, ` +
 `but earlier constraints placed them on the same side. Doing best effort.`
 );
 }
 }
 });

 // Step 9: Separate pinned, bench-pinned, and unassigned groups
 const pinnedA = groups.filter(g => g.pinnedTo === 'A');
 const pinnedB = groups.filter(g => g.pinnedTo === 'B');
 const pinnedBench = groups.filter(g => g.pinnedTo === 'bench');
 const unassigned = groups.filter(g => g.pinnedTo === null);

 // Sort unassigned by score descending for snake draft
 unassigned.sort((a, b) => b.score - a.score);

 // Step 10: Snake-draft assign unassigned groups
 // Running totals start from pinned groups
 let scoreA = pinnedA.reduce((s, g) => s + g.score, 0);
 let scoreB = pinnedB.reduce((s, g) => s + g.score, 0);
 let sizeA = pinnedA.reduce((s, g) => s + g.ids.length, 0);
 let sizeB = pinnedB.reduce((s, g) => s + g.ids.length, 0);

 const assignedToA = [...pinnedA];
 const assignedToB = [...pinnedB];
 const benchGroups = [...pinnedBench];

 for (const group of unassigned) {
 const fitsA = sizeA + group.ids.length <= teamSize;
 const fitsB = sizeB + group.ids.length <= teamSize;

 if (!fitsA && !fitsB) {
 benchGroups.push(group);
 continue;
 }
 if (fitsA && !fitsB) {
 assignedToA.push(group); sizeA += group.ids.length; scoreA += group.score;
 continue;
 }
 if (fitsB && !fitsA) {
 assignedToB.push(group); sizeB += group.ids.length; scoreB += group.score;
 continue;
 }
 // Both fit — assign to the team with lower score; break tie by assigning to A
 if (scoreA <= scoreB) {
 assignedToA.push(group); sizeA += group.ids.length; scoreA += group.score;
 } else {
 assignedToB.push(group); sizeB += group.ids.length; scoreB += group.score;
 }
 }

 // Step 11: Flatten to player ID arrays
 const teamA = assignedToA.flatMap(g => g.ids);
 const teamB = assignedToB.flatMap(g => g.ids);
 const bench = benchGroups.flatMap(g => g.ids);

 // Any playing player not yet placed (should be rare; safety net)
 const placed = new Set([...teamA, ...teamB, ...bench]);
 activePlayers.forEach(p => { if (!placed.has(p.id)) bench.push(p.id); });

 // Step 12: Compute final scores
 const computeScore = ids =>
 ids.reduce((s, id) => {
 const p = getPlayerById(state, id);
 return s + (p ? playerScore(p) : 0);
 }, 0);

 return {
 teamA,
 teamB,
 bench,
 teamAScore: computeScore(teamA),
 teamBScore: computeScore(teamB),
 warnings,
 seedUsed: seedStr,
 generatedAt: Date.now(),
 };
 }

 /* ================================================================
 F. RENDERING
 ================================================================ */

 /** Render the constraints list */
 function renderConstraintList(state) {
 const list = document.getElementById('constraint-list');
 const badge = document.getElementById('constraint-count-badge');
 badge.textContent = state.constraints.length;

 if (state.constraints.length === 0) {
 list.innerHTML = '<li class="empty-state">No constraints added.</li>';
 return;
 }

 list.innerHTML = state.constraints.map(c => {
 const na = esc(getPlayerName(state, c.playerAId));
 const nb = esc(getPlayerName(state, c.playerBId));
 const label = c.type === 'same' ? 'same team' : 'opposite teams';
 const cls = c.type === 'same' ? 'same' : 'opposite';
 return `
 <li class="constraint-item" data-constraint-id="${esc(c.id)}">
 <span class="constraint-text">
 <strong>${na}</strong>
 &nbsp;<span class="badge badge--${cls}">${esc(label)}</span>&nbsp;
 <strong>${nb}</strong>
 </span>
 <button
 class="btn btn--icon"
 data-action="delete-constraint"
 data-id="${esc(c.id)}"
 title="Remove constraint"
 aria-label="Remove constraint between ${na} and ${nb}"
 >✕</button>
 </li>`;
 }).join('');
 }

 /** Populate the constraint player dropdowns */
 function renderConstraintDropdowns(state) {
 const selA = document.getElementById('constraint-a');
 const selB = document.getElementById('constraint-b');
 const opts = state.players.length === 0
 ? '<option value="">— add players first —</option>'
 : '<option value="">Select player…</option>' +
 state.players.map(p =>
 `<option value="${esc(p.id)}">${esc(p.name)}</option>`
 ).join('');

 selA.innerHTML = opts;
 selB.innerHTML = opts;
 }

 /** Render settings inputs from state */
 function renderSettings(state) {
 const tsInput = document.getElementById('input-team-size');
 const seedInput = document.getElementById('input-seed');
 tsInput.value = state.settings.teamSize !== null ? state.settings.teamSize : '';
 seedInput.value = state.settings.seed;
 }

 /** Render summary stats bar */
 function renderSummary(state) {
 const pc = state.players.filter(p => p.playing !== false).length;
 const cc = state.constraints.length;
 const ts = state.settings.teamSize !== null
 ? state.settings.teamSize
 : (pc >= 2 ? Math.floor(pc / 2) : '—');
 const bench = (typeof ts === 'number' && pc >= 2) ? Math.max(0, pc - ts * 2) : 0;

 document.getElementById('summary-players').textContent = pc;
 document.getElementById('summary-constraints').textContent = cc;
 document.getElementById('summary-team-size').textContent = ts;
 document.getElementById('summary-bench').textContent = bench;
 }

 /** Enable/disable generate button and update hint */
 function updateGenerateButton(state) {
 const btn = document.getElementById('btn-generate');
 const hint = document.getElementById('generate-hint');
 const pre = validateGenerationPreconditions(state);
 btn.disabled = !pre.valid;
 hint.textContent = pre.valid
 ? 'Ready to generate. Click to split teams.'
 : pre.errors[0] || '';
 }

 /** Render the results section */
 function renderResults(state) {
 const container = document.getElementById('results-content');
 if (!state.lastResult) {
 container.innerHTML = '<p class="empty-state">Generate teams to see results here.</p>';
 return;
 }

 const r = state.lastResult;
 const totalScore = Math.abs(r.teamAScore) + Math.abs(r.teamBScore);
 const aFrac = totalScore > 0
 ? Math.round((Math.max(0, r.teamAScore + totalScore / 2) / totalScore) * 100)
 : 50;

 const teamAPlayers = r.teamA.map(id => getPlayerById(state, id)).filter(Boolean);
 const teamBPlayers = r.teamB.map(id => getPlayerById(state, id)).filter(Boolean);
 const benchPlayers = r.bench.map(id => getPlayerById(state, id)).filter(Boolean);

 function playerRow(p) {
 return `
 <li class="team-player-item">
 <span>${esc(p.name)}</span>
 <span class="player-badges">${roleBadge(p.role)}${skillBadge(p.skill)}</span>
 </li>`;
 }

 const benchSection = benchPlayers.length > 0 ? `
 <div class="team-card team-card--bench bench-card">
 <div class="team-header team-header--bench">
 <span>Common (${benchPlayers.length})</span>
 </div>
 <ul class="team-player-list">
 ${benchPlayers.map(playerRow).join('')}
 </ul>
 </div>` : '';

 const warningsSection = r.warnings.length > 0 ? `
 <div class="warnings-panel" role="alert">
 <div class="warnings-title">Notices (${r.warnings.length})</div>
 <ul class="warnings-list">
 ${r.warnings.map(w => `<li class="warning-item">${esc(w)}</li>`).join('')}
 </ul>
 </div>` : '';

 container.innerHTML = `
 <div class="results-reveal">
 <div class="results-meta">
 <span class="results-meta-text">
 Generated at ${fmtTime(r.generatedAt)} &bull; Seed: <code>${esc(r.seedUsed)}</code>
 </span>
 <div class="results-actions">
 <button class="btn btn--ghost-green btn--sm" id="btn-reshuffle">Reshuffle</button>
 <button class="btn btn--ghost-green btn--sm" id="btn-copy-result">Copy</button>
 <button class="btn btn--ghost-green btn--sm" id="btn-export-text">Export text</button>
 </div>
 </div>

 <div class="score-bar" title="Team A score vs Team B score" aria-hidden="true">
 <div class="score-bar-a" style="width:${aFrac}%"></div>
 <div class="score-bar-b"></div>
 </div>
 <div class="score-labels">
 <span>Team A: ${fmtScore(r.teamAScore)}</span>
 <span>Team B: ${fmtScore(r.teamBScore)}</span>
 </div>

 <div class="results-grid">
 <div class="team-card team-card--a">
 <div class="team-header team-header--a">
 <span>Team A (${teamAPlayers.length})</span>
 <span class="team-score">Score ${fmtScore(r.teamAScore)}</span>
 </div>
 <ul class="team-player-list">
 ${teamAPlayers.map(playerRow).join('')}
 </ul>
 </div>
 <div class="team-card team-card--b">
 <div class="team-header team-header--b">
 <span>Team B (${teamBPlayers.length})</span>
 <span class="team-score">Score ${fmtScore(r.teamBScore)}</span>
 </div>
 <ul class="team-player-list">
 ${teamBPlayers.map(playerRow).join('')}
 </ul>
 </div>
 ${benchSection}
 </div>
 ${warningsSection}
 </div>`;

 // Bind results action buttons (dynamically added)
 document.getElementById('btn-reshuffle').addEventListener('click', () => onReshuffle(state));
 document.getElementById('btn-copy-result').addEventListener('click', () => onCopyResult(state));
 document.getElementById('btn-export-text').addEventListener('click', () => onExportText(state));
 }

 /** Master render — call after every state mutation */
 function render(state) {
 renderPlayerList(state);
 renderConstraintList(state);
 renderConstraintDropdowns(state);
 renderSettings(state);
 renderSummary(state);
 updateGenerateButton(state);
 renderResults(state);
 }

 /** Show/clear a form field error */
 function showFieldError(wrapId, message) {
 let el = document.getElementById(`${wrapId}-error`);
 if (!el) {
 el = document.createElement('div');
 el.className = 'form-error';
 el.id = `${wrapId}-error`;
 const wrap = document.getElementById(wrapId);
 if (wrap) wrap.appendChild(el);
 }
 el.textContent = message;
 }

 function clearFieldError(wrapId) {
 const el = document.getElementById(`${wrapId}-error`);
 if (el) el.textContent = '';
 }

 /** Toast notification — auto-dismissed */
 function showToast(message, type) {
 const container = document.getElementById('toast-container');
 const toast = document.createElement('div');
 toast.className = `toast toast--${type}`;
 toast.textContent = message;
 container.appendChild(toast);
 setTimeout(() => {
 toast.style.transition = 'opacity 0.3s';
 toast.style.opacity = '0';
 setTimeout(() => toast.remove(), 350);
 }, 3000);
 }

 /* ================================================================
 G. EVENT HANDLERS
 ================================================================ */

 function onAddConstraint(e, state) {
 e.preventDefault();
 const aId = document.getElementById('constraint-a').value;
 const bId = document.getElementById('constraint-b').value;
 const type = document.getElementById('constraint-type').value;

 clearFieldError('constraint-form-wrap');
 const v = validateConstraint(state, aId, bId, type);
 if (!v.valid) {
 showFieldError('constraint-form-wrap', v.error);
 return;
 }

 state.constraints.push({ id: generateId(), playerAId: aId, playerBId: bId, type, addedAt: Date.now() });
 state.lastResult = null;
 saveState(state);
 render(state);
 showToast('Constraint added.', 'success');
 }

 function onDeleteConstraint(constraintId, state) {
 state.constraints = state.constraints.filter(c => c.id !== constraintId);
 state.lastResult = null;
 saveState(state);
 render(state);
 }

 function onSettingsChange(state) {
 const tsVal = document.getElementById('input-team-size').value.trim();
 const seedVal = document.getElementById('input-seed').value;
 state.settings.teamSize = tsVal === '' ? null : parseInt(tsVal, 10) || null;
 state.settings.seed = seedVal;
 saveState(state);
 renderSummary(state);
 updateGenerateButton(state);
 }

 function onClearTeamSize(state) {
 document.getElementById('input-team-size').value = '';
 state.settings.teamSize = null;
 saveState(state);
 renderSummary(state);
 updateGenerateButton(state);
 }

 function onGenerateTeams(state) {
 try {
 const result = generateTeams(state);
 state.lastResult = result;
 state.settings.lastSeedUsed = result.seedUsed;
 saveState(state);
 renderResults(state);
 renderSummary(state);
 if (result.warnings.length > 0) {
 showToast(`Teams generated with ${result.warnings.length} notice(s).`, 'warning');
 } else {
 showToast('Teams generated!', 'success');
 }
 // Scroll to results
 document.getElementById('section-results').scrollIntoView({ behavior: 'smooth', block: 'start' });
 } catch (err) {
 showToast(String(err), 'error');
 }
 }

 function onReshuffle(state) {
 // Use a new random seed unless a fixed seed is set
 if (state.settings.seed.trim() === '') {
 state.settings.seed = '';
 }
 onGenerateTeams(state);
 }

 function onResetAll(state) {
 if (!window.confirm('This will remove all players, constraints, and results. Are you sure?')) return;
 const fresh = getDefaultState();
 Object.assign(state, fresh);
 saveState(state);
 render(state);
 showToast('All data cleared.', 'info');
 }

 function onResetCaptainStats(state) {
 if (!window.confirm('This will permanently clear all captain win/loss records. Are you sure?')) return;
 state.captainStats = {};
 // Also clear the recorded flag so stats re-accumulate from current matches if needed
 state.matches.forEach(m => { delete m.captainStatsRecorded; });
 saveState(state);
 renderDayStats(state);
 showToast('Captain stats cleared.', 'info');
 }

 function onResetMatches(state) {
 if (!window.confirm('This will delete all matches and scoring data. Captain stats are kept. Are you sure?')) return;
 state.matches = [];
 state.settings.activeMatchId = null;
 // captainStats intentionally preserved — they represent cross-day history
 saveState(state);
 renderMatchList(state);
 renderCreateMatchForm(state);
 renderScoringPanel(state);
 renderDayStats(state);
 showToast('All matches cleared. Captain stats preserved.', 'info');
 }

 /** Build a plain-text result string */
 function buildResultText(state) {
 if (!state.lastResult) return 'No results generated yet.';
 const r = state.lastResult;
 const teamANames = r.teamA.map(id => getPlayerName(state, id));
 const teamBNames = r.teamB.map(id => getPlayerName(state, id));
 const benchNames = r.bench.map(id => getPlayerName(state, id));

 let txt = `Cricket Team Split\n`;
 txt += `Generated: ${new Date(r.generatedAt).toLocaleString()}\n`;
 txt += `Seed: ${r.seedUsed}\n\n`;
 txt += `Team A (${teamANames.length}) — Score ${fmtScore(r.teamAScore)}\n`;
 teamANames.forEach((n, i) => { txt += ` ${i + 1}. ${n}\n`; });
 txt += `\nTeam B (${teamBNames.length}) — Score ${fmtScore(r.teamBScore)}\n`;
 teamBNames.forEach((n, i) => { txt += ` ${i + 1}. ${n}\n`; });
 if (benchNames.length > 0) {
 txt += `\nCommon (${benchNames.length})\n`;
 benchNames.forEach((n, i) => { txt += ` ${i + 1}. ${n}\n`; });
 }
 if (r.warnings.length > 0) {
 txt += '\nNotices:\n';
 r.warnings.forEach(w => { txt += ` - ${w}\n`; });
 }
 return txt;
 }

 function onCopyResult(state) {
 const txt = buildResultText(state);
 if (navigator.clipboard && navigator.clipboard.writeText) {
 navigator.clipboard.writeText(txt)
 .then(() => showToast('Copied to clipboard!', 'success'))
 .catch(() => fallbackCopy(txt));
 } else {
 fallbackCopy(txt);
 }
 }

 function fallbackCopy(text) {
 const ta = document.createElement('textarea');
 ta.value = text;
 ta.style.position = 'fixed';
 ta.style.opacity = '0';
 document.body.appendChild(ta);
 ta.select();
 try {
 document.execCommand('copy');
 showToast('Copied to clipboard!', 'success');
 } catch (_) {
 showToast('Copy failed — try Export Text.', 'error');
 }
 document.body.removeChild(ta);
 }

 function onExportText(state) {
 const txt = buildResultText(state);
 const blob = new Blob([txt], { type: 'text/plain' });
 const url = URL.createObjectURL(blob);
 const a = document.createElement('a');
 a.href = url;
 a.download = 'cricket-teams.txt';
 a.click();
 setTimeout(() => URL.revokeObjectURL(url), 2000);
 showToast('Text file downloaded.', 'success');
 }

 function onExportJSON(state) {
 const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
 const url = URL.createObjectURL(blob);
 const a = document.createElement('a');
 a.href = url;
 a.download = 'cricket-data.json';
 a.click();
 setTimeout(() => URL.revokeObjectURL(url), 2000);
 showToast('JSON file downloaded.', 'success');
 }

 function onImportJSON(e, state) {
 const file = e.target.files[0];
 if (!file) return;
 const reader = new FileReader();
 reader.onload = function (ev) {
 try {
 const parsed = JSON.parse(ev.target.result);
 if (!parsed || parsed.version !== SCHEMA_VERSION) {
 showToast('Invalid or incompatible file.', 'error');
 return;
 }

 // Merge captainStats from the imported file into the current state
 // instead of replacing, so data from multiple days accumulates.
 const incoming = parsed.captainStats || {};
 const existing = state.captainStats || {};
 const merged = Object.assign({}, existing);
 Object.values(incoming).forEach(s => {
 if (!merged[s.playerId]) {
 merged[s.playerId] = { playerId: s.playerId, wins: 0, losses: 0, ties: 0, matches: 0 };
 }
 merged[s.playerId].wins += s.wins || 0;
 merged[s.playerId].losses += s.losses || 0;
 merged[s.playerId].ties += s.ties || 0;
 merged[s.playerId].matches += s.matches || 0;
 });

 Object.assign(state, parsed);
 state.captainStats = merged;
 saveState(state);
 render(state);
 showToast('Data imported and captain stats merged.', 'success');
 } catch (_) {
 showToast('Could not parse the file.', 'error');
 }
 };
 reader.readAsText(file);
 e.target.value = '';
 }

 /* ================================================================
 G. EVENT BINDING
 ================================================================ */

 function bindEvents(state) {
 // Player events are handled in players.js
 bindPlayerEvents(state);

 // Constraint form
 document.getElementById('constraint-form')
 .addEventListener('submit', e => onAddConstraint(e, state));

 // Constraint list — event delegation
 document.getElementById('constraint-list').addEventListener('click', e => {
 const btn = e.target.closest('[data-action]');
 if (!btn) return;
 if (btn.dataset.action === 'delete-constraint') onDeleteConstraint(btn.dataset.id, state);
 });

 // Settings
 document.getElementById('input-team-size')
 .addEventListener('change', () => onSettingsChange(state));
 document.getElementById('input-seed')
 .addEventListener('input', () => onSettingsChange(state));
 document.getElementById('btn-clear-team-size')
 .addEventListener('click', () => onClearTeamSize(state));

 // Generate
 document.getElementById('btn-generate')
 .addEventListener('click', () => onGenerateTeams(state));

 // Header actions
 document.getElementById('btn-reset')
 .addEventListener('click', () => onResetAll(state));
 document.getElementById('btn-reset-matches')
 .addEventListener('click', () => onResetMatches(state));
 document.getElementById('btn-reset-captain-stats')
 .addEventListener('click', () => onResetCaptainStats(state));
 document.getElementById('btn-export-json')
 .addEventListener('click', () => onExportJSON(state));
 document.getElementById('btn-import-json')
 .addEventListener('click', () => document.getElementById('file-import').click());
 document.getElementById('file-import')
 .addEventListener('change', e => onImportJSON(e, state));
 }

 /* ================================================================
 H. MATCH SCORING — STATE HELPERS
 ================================================================ */

 /** Migrate existing v1 state to include matches array */
 function ensureMatchesInState(state) {
 if (!Array.isArray(state.matches)) state.matches = [];
 if (!('activeMatchId' in state.settings)) state.settings.activeMatchId = null;
 }

 function getMatchById(state, matchId) {
 return state.matches.find(m => m.id === matchId) || null;
 }

 function getActiveMatch(state) {
 if (!state.settings.activeMatchId) return null;
 return getMatchById(state, state.settings.activeMatchId);
 }

 /** Get the innings currently being played (status !== completed, in order) */
 function getActiveInnings(match) {
 if (!match || !match.innings) return null;
 return match.innings.find(inn => inn.status !== 'completed') || null;
 }

 function getInningsByIndex(match, idx) {
 return match.innings[idx] || null;
 }

 /** Players not yet dismissed and not currently batting */
 function getRemainingBatters(innings, teamPlayerIds) {
 const dismissed = new Set(Object.keys(innings.dismissals || {}));
 const batting = new Set(innings.batterIds.filter(Boolean));
 return teamPlayerIds.filter(id => !dismissed.has(id) && !batting.has(id));
 }

 /** All-out threshold: need 2 to bat, so out at (n-1) wickets */
 function allOutThreshold(teamSize) {
 return Math.max(1, teamSize - 1);
 }

 function getTeamPlayerIds(match, teamId) {
 return teamId === 'A' ? match.teamA.playerIds : match.teamB.playerIds;
 }

 function getTeamName(match, teamId) {
 return teamId === 'A' ? match.teamA.name : match.teamB.name;
 }

 /** Compute overs label from legal ball count — e.g. 14 → "2.2" */
 function oversLabel(legalBalls) {
 return `${Math.floor(legalBalls / 6)}.${legalBalls % 6}`;
 }

 /* ================================================================
 I. MATCH SCORING — CORE LOGIC
 ================================================================ */

 /**
 * Create a new match object (status: "setup" with both innings ready).
 * Returns the match object — caller must push to state.matches.
 */
 function createMatch(name, maxOvers, teamAIds, teamBIds, teamAName, teamBName) {
 const id = 'match_' + Date.now();
 // Assign a random captain from each team
 const captainA = teamAIds[Math.floor(Math.random() * teamAIds.length)] || null;
 const captainB = teamBIds[Math.floor(Math.random() * teamBIds.length)] || null;
 return {
 id,
 name,
 status: 'toss',
 toss: null, // { winner: 'A'|'B', choice: 'bat'|'bowl' }
 maxOvers,
 teamA: { id: 'A', name: teamAName || 'Team A', playerIds: teamAIds, captainId: captainA },
 teamB: { id: 'B', name: teamBName || 'Team B', playerIds: teamBIds, captainId: captainB },
 innings: [
 makeInnings(id, 0, 'A', 'B', maxOvers),
 makeInnings(id, 1, 'B', 'A', maxOvers),
 ],
 createdAt: Date.now(),
 completedAt: null,
 };
 }

 function getCaptainId(match, teamId) {
 return teamId === 'A' ? match.teamA.captainId : match.teamB.captainId;
 }

 /**
 * Returns 'A', 'B', 'tie', or null (match not yet complete / only 1 innings).
 */
 function getMatchWinner(match) {
 const inn0 = match.innings[0];
 const inn1 = match.innings[1];
 if (!inn0 || !inn1 || inn1.status !== 'completed') return null;
 const t0 = inn0.totalRuns;
 const t1 = inn1.totalRuns;
 if (t0 === t1) return 'tie';
 // inn0 batting team wins if t0 > t1; inn1 batting team wins if t1 >= target
 const inn0BatTeam = inn0.battingTeamId; // 'A' or 'B'
 const inn1BatTeam = inn1.battingTeamId;
 if (t1 >= inn1.target) return inn1BatTeam;
 return inn0BatTeam;
 }

 /**
 * Accumulate captain win/loss/tie into state.captainStats for a completed match.
 * Only records once (guarded by match.captainStatsRecorded flag).
 */
 function recordCaptainStats(state, match) {
 if (match.captainStatsRecorded) return;
 const winner = getMatchWinner(match);
 if (winner === null) return;

 function ensure(id) {
 if (!state.captainStats[id]) {
 state.captainStats[id] = { playerId: id, wins: 0, losses: 0, ties: 0, matches: 0 };
 }
 return state.captainStats[id];
 }

 const capA = match.teamA.captainId;
 const capB = match.teamB.captainId;

 if (capA) {
 const s = ensure(capA);
 s.matches++;
 if (winner === 'tie') s.ties++;
 else if (winner === match.teamA.id) s.wins++;
 else s.losses++;
 }
 if (capB) {
 const s = ensure(capB);
 s.matches++;
 if (winner === 'tie') s.ties++;
 else if (winner === match.teamB.id) s.wins++;
 else s.losses++;
 }

 match.captainStatsRecorded = true;
 }

 function makeInnings(matchId, index, battingTeamId, bowlingTeamId, maxOvers) {
 return {
 id: `inn_${matchId}_${index}`,
 index,
 battingTeamId,
 bowlingTeamId,
 status: index === 0 ? 'setup' : 'setup',
 maxOvers,
 target: null,
 balls: [],
 batterIds: [null, null],
 currentBowlerId: null,
 lastBowlerId: null,
 overEndedWithWicket: false,
 dismissals: {}, // { playerId: { type, bowlerCreditId, fielderCreditId, runs, wasOnStrike } }
 battingOrder: [], // filled during setup
 legalBallsThisOver: 0,
 totalRuns: 0,
 totalWickets: 0,
 extras: { wides: 0, noBalls: 0, byes: 0, legByes: 0 },
 completedAt: null,
 };
 }

 /**
 * Confirm innings setup: set openers, first bowler, batting order.
 * Returns updated innings (mutates in place).
 */
 function setupInnings(innings, opener1Id, opener2Id, bowlerId, fullOrder) {
 innings.batterIds = [opener1Id, opener2Id];
 innings.currentBowlerId = bowlerId;
 innings.lastBowlerId = null;
 innings.battingOrder = fullOrder;
 innings.status = 'active';
 }

 /**
 * Record a ball. Mutates innings in place.
 * ballData: { type: 'normal'|'wide'|'noball'|'wicket'|'bye'|'legbye', batRuns: number, dismissal: object|null }
 * Byes and leg byes are LEGAL deliveries — count toward the over but runs go to extras not batsman.
 * Returns { warnings: string[] }
 */
 function recordBall(innings, ballData, teamSize) {
 if (innings.status !== 'active') return { warnings: [] };

 const warnings = [];
 const isBye = ballData.type === 'bye' || ballData.type === 'legbye';
 const isLegal = ballData.type !== 'wide' && ballData.type !== 'noball';
 // Extra penalty run: wides and no-balls cost 1 extra run; byes/legbyes do not
 const extraRuns = (ballData.type === 'wide' || ballData.type === 'noball') ? 1 : 0;
 // Runs scored: byes/legbyes use batRuns as the bye runs (they go to extras, not batter)
 const batRuns = (ballData.type === 'wide') ? 0 : (ballData.batRuns || 0);
 const totalRuns = batRuns + extraRuns;

 const ball = {
 id: 'b_' + innings.balls.length,
 overNumber: Math.floor(innings.balls.filter(b => b.isLegal).length / 6),
 ballInOver: innings.legalBallsThisOver,
 isLegal,
 type: ballData.type,
 batRuns,
 extraRuns,
 totalRuns,
 strikerId: innings.batterIds[0],
 nonStrikerId: innings.batterIds[1],
 bowlerId: innings.currentBowlerId,
 dismissal: ballData.dismissal || null,
 strikeRotatedBat: false,
 strikeRotatedOver: false,
 timestamp: Date.now(),
 };
 innings.balls.push(ball);

 // Update totals
 innings.totalRuns += totalRuns;
 if (isLegal) innings.legalBallsThisOver++;
 if (ball.type === 'wide') innings.extras.wides += extraRuns;
 if (ball.type === 'noball') innings.extras.noBalls += extraRuns;
 if (ball.type === 'bye') innings.extras.byes = (innings.extras.byes || 0) + batRuns;
 if (ball.type === 'legbye') innings.extras.legByes = (innings.extras.legByes || 0) + batRuns;

 // Handle dismissal
 if (ball.dismissal) {
 const d = ball.dismissal;
 innings.dismissals[d.dismissedPlayerId] = d;
 innings.totalWickets++;

 const remaining = getRemainingBatters(innings, innings.battingOrder);
 const canContinue = remaining.length > 0;

 if (!canContinue) {
 // All out
 innings.status = 'completed';
 innings.completedAt = Date.now();
 } else {
 // Remove dismissed player from batterIds
 const slot = d.wasOnStrike ? 0 : 1;
 innings.batterIds[slot] = null;

 if (isLegal && innings.legalBallsThisOver >= 6) {
 // Wicket on last ball of over
 innings.overEndedWithWicket = true;
 }
 innings.status = 'needs_batsman';
 }
 }

 // Strike rotation (bat runs) — only if no wicket or it was non-striker run-out
 if (innings.status === 'active' || (ball.dismissal && !ball.dismissal.wasOnStrike)) {
 if (batRuns % 2 === 1) {
 // Odd runs: swap strike (unless striker just got out)
 if (!ball.dismissal || !ball.dismissal.wasOnStrike) {
 [innings.batterIds[0], innings.batterIds[1]] = [innings.batterIds[1], innings.batterIds[0]];
 ball.strikeRotatedBat = true;
 }
 }
 }

 // Check over complete (after possible dismissal processing)
 if (innings.status === 'active' && innings.legalBallsThisOver >= 6) {
 ball.strikeRotatedOver = true;
 [innings.batterIds[0], innings.batterIds[1]] = [innings.batterIds[1], innings.batterIds[0]];
 innings.legalBallsThisOver = 0;
 innings.lastBowlerId = innings.currentBowlerId;
 innings.currentBowlerId = null;

 // Check max overs — if this was the last over, complete the innings instead of asking for bowler
 const totalLegal = innings.balls.filter(b => b.isLegal).length;
 if (totalLegal >= innings.maxOvers * 6) {
 innings.status = 'completed';
 innings.completedAt = Date.now();
 } else {
 innings.status = 'needs_bowler';
 }
 }

 // Check max overs (catches mid-over target/all-out edge cases)
 if (innings.status === 'active') {
 const totalLegal = innings.balls.filter(b => b.isLegal).length;
 if (totalLegal >= innings.maxOvers * 6) {
 innings.status = 'completed';
 innings.completedAt = Date.now();
 }
 }

 // Check target (2nd innings)
 if (innings.target !== null && innings.status !== 'completed') {
 if (innings.totalRuns >= innings.target) {
 innings.status = 'completed';
 innings.completedAt = Date.now();
 }
 }

 return { warnings };
 }

 /** Select next batsman after a wicket. Returns warning string if consecutive bowler issue arises. */
 function selectNextBatsman(innings, batsmanId) {
 // Find the null slot
 const slot = innings.batterIds[0] === null ? 0 : 1;
 innings.batterIds[slot] = batsmanId;

 if (innings.overEndedWithWicket) {
 innings.overEndedWithWicket = false;
 innings.legalBallsThisOver = 0;
 innings.lastBowlerId = innings.currentBowlerId;
 innings.currentBowlerId = null;
 // Only ask for next bowler if there are overs remaining
 const totalLegal = innings.balls.filter(b => b.isLegal).length;
 if (totalLegal >= innings.maxOvers * 6) {
 innings.status = 'completed';
 innings.completedAt = Date.now();
 } else {
 innings.status = 'needs_bowler';
 }
 } else {
 innings.status = 'active';
 }
 }

 /** Select next bowler. Returns { consecutiveWarning: bool } */
 function selectNextBowler(innings, bowlerId) {
 const consecutive = bowlerId === innings.lastBowlerId;
 innings.currentBowlerId = bowlerId;
 innings.status = 'active';
 return { consecutiveWarning: consecutive };
 }

 /** Get label string for a ball dot */
 function getBallLabel(ball) {
 if (ball.type === 'wide') return 'Wd';
 if (ball.type === 'noball') return ball.batRuns > 0 ? `Nb+${ball.batRuns}` : 'Nb';
 if (ball.type === 'bye') return ball.batRuns > 0 ? `B${ball.batRuns}` : 'B';
 if (ball.type === 'legbye') return ball.batRuns > 0 ? `Lb${ball.batRuns}` : 'Lb';
 if (ball.dismissal) {
 return ball.batRuns > 0 ? `${ball.batRuns}W` : 'W';
 }
 if (ball.batRuns === 0) return '·';
 return String(ball.batRuns);
 }

 /** CSS modifier class for a ball dot */
 function getBallDotClass(ball) {
 if (ball.dismissal) return 'ball-dot--wicket';
 if (ball.type === 'wide' || ball.type === 'noball') return 'ball-dot--extra';
 if (ball.type === 'bye' || ball.type === 'legbye') return 'ball-dot--bye';
 if (ball.batRuns === 4) return 'ball-dot--four';
 if (ball.batRuns === 6) return 'ball-dot--six';
 if (ball.batRuns === 0) return 'ball-dot--dot';
 return 'ball-dot--run';
 }

 /** Batting stats for one player across one innings */
 function getBatsmanInningsStats(innings, playerId) {
 let runs = 0, balls = 0, fours = 0, sixes = 0;
 innings.balls.forEach(b => {
 if (b.strikerId !== playerId) return;
 if (b.type === 'wide') return; // wide: batter didn't face
 balls++;
 // Byes and leg-byes: ball counts toward balls faced but runs go to extras, not batter
 if (b.type === 'bye' || b.type === 'legbye') return;
 runs += b.batRuns;
 if (b.batRuns === 4) fours++;
 if (b.batRuns === 6) sixes++;
 });
 const d = innings.dismissals[playerId];
 return {
 runs, balls, fours, sixes,
 strikeRate: balls > 0 ? +(runs / balls * 100).toFixed(1) : 0,
 howOut: d ? d.type : 'not out',
 notOut: !d,
 didBat: balls > 0 || !!d || innings.batterIds.includes(playerId),
 };
 }

 /** Bowling stats for one player across one innings */
 function getBowlerInningsStats(innings, playerId) {
 let legalBalls = 0, runs = 0, wickets = 0;
 innings.balls.forEach(b => {
 if (b.bowlerId !== playerId) return;
 if (b.isLegal) legalBalls++;
 // Byes and leg-byes not charged to bowler; run-out nb bat runs also excluded
 let conceded = b.totalRuns;
 if (b.type === 'bye' || b.type === 'legbye') {
 conceded = 0;
 } else if (b.type === 'noball' && b.dismissal && b.dismissal.type === 'runout') {
 conceded = b.extraRuns;
 }
 runs += conceded;
 if (b.dismissal && b.dismissal.bowlerCreditId === playerId) wickets++;
 });
 const oFull = Math.floor(legalBalls / 6);
 const oBalls = legalBalls % 6;
 return {
 legalBalls, runs, wickets,
 oversLabel: `${oFull}.${oBalls}`,
 economy: legalBalls > 0 ? +(runs / (legalBalls / 6)).toFixed(2) : null,
 figures: `${wickets}/${runs}`,
 };
 }

 /**
 * Aggregate stats for all players across all matches.
 * Returns { batting: Map<playerId, stats>, bowling: Map<playerId, stats> }
 */
 function getDayStats(state) {
 const batting = {};
 const bowling = {};

 function ensureBat(id) {
 if (!batting[id]) batting[id] = {
 playerId: id,
 matches: 0, innings: 0,
 runs: 0, balls: 0,
 fours: 0, sixes: 0,
 highScore: 0, highScoreNotOut: false,
 dismissals: 0,
 notOuts: 0,
 ducks: 0, // dismissed for 0
 fifties: 0, // 50–99
 hundreds: 0, // 100+
 dotBallsFaced: 0, // balls faced where no run scored
 };
 return batting[id];
 }
 function ensureBowl(id) {
 if (!bowling[id]) bowling[id] = {
 playerId: id,
 matches: 0,
 legalBalls: 0, runs: 0, wickets: 0,
 bestWkts: 0, bestRuns: Infinity,
 maidens: 0,
 dotBalls: 0, // legal balls conceding 0 runs
 wides: 0,
 noBalls: 0,
 };
 return bowling[id];
 }

 state.matches.forEach(match => {
 const seenBat = new Set();
 const seenBowl = new Set();

 match.innings.forEach(inn => {
 if (inn.status === 'setup') return;
 const batTeam = getTeamPlayerIds(match, inn.battingTeamId);
 const bowlTeam = getTeamPlayerIds(match, inn.bowlingTeamId);

 // ── Batting aggregation ──
 batTeam.forEach(id => {
 const s = getBatsmanInningsStats(inn, id);
 if (!s.didBat) return;
 const agg = ensureBat(id);
 if (!seenBat.has(id)) { agg.matches++; seenBat.add(id); }
 agg.innings++;
 agg.runs += s.runs;
 agg.balls += s.balls;
 agg.fours += s.fours;
 agg.sixes += s.sixes;
 if (s.notOut) { agg.notOuts++; } else { agg.dismissals++; }
 if (!s.notOut && s.runs === 0) agg.ducks++;
 if (s.runs >= 100) agg.hundreds++;
 else if (s.runs >= 50) agg.fifties++;
 // Dot balls faced: legal balls with 0 bat runs
 inn.balls.forEach(b => {
 if (b.strikerId === id && b.isLegal && b.batRuns === 0 && !b.dismissal) agg.dotBallsFaced++;
 });
 if (s.runs > agg.highScore || (s.runs === agg.highScore && s.notOut)) {
 agg.highScore = s.runs;
 agg.highScoreNotOut = s.notOut;
 }
 });

 // ── Bowling aggregation ──
 // Build over-by-over structure for maidens
 const overMap = {}; // overNumber → { runs, balls }
 inn.balls.forEach(b => {
 if (!b.isLegal) return;
 const key = `${b.bowlerId}_${b.overNumber}`;
 if (!overMap[key]) overMap[key] = { bowlerId: b.bowlerId, runs: 0, balls: 0 };
 // Byes/legbyes not charged to bowler for maiden calculation
 const charged = (b.type === 'bye' || b.type === 'legbye') ? 0 : b.totalRuns;
 overMap[key].runs += charged;
 overMap[key].balls += 1;
 });

 bowlTeam.forEach(id => {
 const s = getBowlerInningsStats(inn, id);
 if (s.legalBalls === 0 && !inn.balls.some(b => b.bowlerId === id)) return;
 const agg = ensureBowl(id);
 if (!seenBowl.has(id)) { agg.matches++; seenBowl.add(id); }
 agg.legalBalls += s.legalBalls;
 agg.runs += s.runs;
 agg.wickets += s.wickets;

 // Maidens: completed 6-ball overs with 0 runs
 Object.values(overMap).forEach(ov => {
 if (ov.bowlerId === id && ov.balls === 6 && ov.runs === 0) agg.maidens++;
 });

 // Dot balls bowled
 inn.balls.forEach(b => {
 if (b.bowlerId === id && b.isLegal && b.totalRuns === 0 && !b.dismissal) agg.dotBalls++;
 });

 // Wides and no-balls
 inn.balls.forEach(b => {
 if (b.bowlerId !== id) return;
 if (b.type === 'wide') agg.wides++;
 if (b.type === 'noball') agg.noBalls++;
 });

 if (s.wickets > agg.bestWkts || (s.wickets === agg.bestWkts && s.runs < agg.bestRuns)) {
 agg.bestWkts = s.wickets;
 agg.bestRuns = s.runs;
 }
 });
 });
 });

 // ── Derived fields ──
 Object.values(batting).forEach(a => {
 a.average = a.dismissals > 0 ? +(a.runs / a.dismissals).toFixed(2) : null;
 a.strikeRate = a.balls > 0 ? +(a.runs / a.balls * 100).toFixed(1) : 0;
 a.dotPct = a.balls > 0 ? +(a.dotBallsFaced / a.balls * 100).toFixed(0) : 0;
 });
 Object.values(bowling).forEach(a => {
 const overs = a.legalBalls / 6;
 a.economy = overs > 0 ? +(a.runs / overs).toFixed(2) : null;
 a.average = a.wickets > 0 ? +(a.runs / a.wickets).toFixed(2) : null;
 a.strikeRate = a.wickets > 0 ? +(a.legalBalls / a.wickets).toFixed(1) : null;
 a.oversLabel = `${Math.floor(a.legalBalls / 6)}.${a.legalBalls % 6}`;
 a.best = a.bestWkts > 0 ? `${a.bestWkts}/${a.bestRuns}` : '-';
 a.dotPct = a.legalBalls > 0 ? +(a.dotBalls / a.legalBalls * 100).toFixed(0) : 0;
 });

 return { batting, bowling };
 }

 /**
 * Derive the Day Awards — each award is { label, winner: name, value, icon }.
 * Returns an array of award objects. Empty if no data yet.
 */
 function getDayAwards(state) {
 const { batting, bowling } = getDayStats(state);
 const batArr = Object.values(batting);
 const bowlArr = Object.values(bowling);
 const awards = [];

 function name(id) { return getPlayerName(state, id); }

 function best(arr, compareFn, label, valueFn, icon) {
 const filtered = arr.filter(a => compareFn(a) !== null && compareFn(a) !== undefined);
 if (!filtered.length) return;
 filtered.sort((a, b) => compareFn(b) - compareFn(a));
 const winner = filtered[0];
 awards.push({ label, winner: name(winner.playerId), value: valueFn(winner), icon });
 }

 function bestLow(arr, compareFn, label, valueFn, icon, minFilter) {
 const filtered = arr.filter(a => minFilter(a) && compareFn(a) !== null);
 if (!filtered.length) return;
 filtered.sort((a, b) => compareFn(a) - compareFn(b));
 const winner = filtered[0];
 awards.push({ label, winner: name(winner.playerId), value: valueFn(winner), icon });
 }

 // ── Batting awards ──
 best(batArr, a => a.runs,
 'Top Run Scorer', a => `${a.runs} runs`, ' ');

 best(batArr, a => a.highScore,
 'Highest Score', a => `${a.highScore}${a.highScoreNotOut ? '*' : ''}`, ' ');

 best(batArr.filter(a => a.dismissals >= 1), a => a.average,
 'Best Batting Avg', a => a.average, ' ');

 best(batArr.filter(a => a.balls >= 6), a => a.strikeRate,
 'Fastest Striker', a => `SR ${a.strikeRate}`, ' ');

 best(batArr, a => a.sixes,
 'Six Machine', a => `${a.sixes} sixes`, ' ');

 best(batArr, a => a.fours,
 'Boundary King', a => `${a.fours} fours`, ' ');

 best(batArr.filter(a => a.innings >= 2), a => a.notOuts,
 'Most Not Outs', a => `${a.notOuts} times`, ' ');

 if (batArr.some(a => a.fifties + a.hundreds > 0)) {
 best(batArr, a => a.fifties + a.hundreds,
 'Most 50+ Scores', a => `${a.fifties + a.hundreds} times`, ' ');
 }

 // ── Bowling awards ──
 best(bowlArr, a => a.wickets,
 'Top Wicket Taker', a => `${a.wickets} wickets`, ' ');

 best(bowlArr.filter(a => a.wickets >= 1), a => a.bestWkts * 1000 - a.bestRuns,
 'Best Figures', a => a.best, ' ');

 bestLow(bowlArr,
 a => a.economy,
 'Best Economy', a => `${a.economy} RPO`,
 ' ',
 a => a.legalBalls >= 6);

 bestLow(bowlArr.filter(a => a.wickets >= 1),
 a => a.average,
 'Best Bowling Avg', a => `${a.average}`,
 ' ',
 a => a.wickets >= 1);

 bestLow(bowlArr.filter(a => a.wickets >= 1),
 a => a.strikeRate,
 'Best Bowling SR', a => `${a.strikeRate} balls/wkt`,
 ' ',
 a => a.wickets >= 1);

 best(bowlArr.filter(a => a.legalBalls >= 6), a => a.dotPct,
 'Dot Ball Specialist', a => `${a.dotPct}% dots`, ' ');

 if (bowlArr.some(a => a.maidens > 0)) {
 best(bowlArr, a => a.maidens,
 'Most Maidens', a => `${a.maidens} maidens`, ' ');
 }

 return awards;
 }

 /* ================================================================
 J. MATCH SCORING — RENDERING
 ================================================================ */

 function renderMatchList(state) {
 const list = document.getElementById('match-list');
 const badge = document.getElementById('match-count-badge');
 badge.textContent = state.matches.length;

 if (state.matches.length === 0) {
 list.innerHTML = '<p class="empty-state">No matches yet. Create one below.</p>';
 return;
 }

 list.innerHTML = state.matches.map(m => {
 const inn0 = m.innings[0];
 const inn1 = m.innings[1];
 let scoreText = '';
 if (m.status === 'toss') {
 scoreText = 'Toss pending';
 } else {
 const t0 = inn0.status !== 'setup' ? `${getTeamName(m, inn0.battingTeamId)}: ${inn0.totalRuns}/${inn0.totalWickets}` : '';
 const t1 = inn1.status !== 'setup' ? ` | ${getTeamName(m, inn1.battingTeamId)}: ${inn1.totalRuns}/${inn1.totalWickets}` : '';
 scoreText = t0 + t1;
 }
 const isActive = state.settings.activeMatchId === m.id;
 const statusLabel = m.status === 'toss' ? 'toss' : m.status;
 return `
 <div class="match-card ${isActive ? 'match-card--active' : ''} ${m.status === 'completed' ? 'match-card--completed' : ''}">
 <span class="match-card-name">${esc(m.name)}</span>
 <span class="match-card-score">${esc(scoreText)}</span>
 <span class="match-status-badge match-status-badge--${statusLabel}">${esc(statusLabel)}</span>
 <button class="btn btn--sm btn--ghost-green" data-action="open-match" data-id="${esc(m.id)}">
 ${isActive ? 'Scoring' : 'Open'}
 </button>
 ${m.status === 'completed' ? '' : `<button class="btn btn--sm btn--icon" data-action="delete-match" data-id="${esc(m.id)}" title="Delete match">✕</button>`}
 </div>`;
 }).join('');
 }

 function renderCreateMatchForm(state) {
 const aList = document.getElementById('match-team-a-picks');
 const bList = document.getElementById('match-team-b-picks');
 if (!aList || !bList) return;

 if (state.players.length === 0) {
 aList.innerHTML = '<p class="empty-state" style="padding:0.4rem">No players added yet.</p>';
 bList.innerHTML = '<p class="empty-state" style="padding:0.4rem">No players added yet.</p>';
 return;
 }

 function makeItems(teamSide) {
 return state.players.map(p => `
 <label class="player-pick-item" data-player-id="${esc(p.id)}" data-team="${teamSide}">
 <input type="checkbox" class="pick-cb pick-cb-${teamSide}" value="${esc(p.id)}" />
 ${esc(p.name)}
 <span class="player-badges">${roleBadge(p.role)}${skillBadge(p.skill)}</span>
 </label>`).join('');
 }
 aList.innerHTML = makeItems('a');
 bList.innerHTML = makeItems('b');

 // Mutual exclusion between A and B checkboxes
 aList.querySelectorAll('.pick-cb-a').forEach(cb => {
 cb.addEventListener('change', () => {
 if (cb.checked) {
 const matchingB = bList.querySelector(`.pick-cb-b[value="${cb.value}"]`);
 if (matchingB) { matchingB.checked = false; matchingB.parentElement.classList.toggle('player-pick-item--disabled', true); }
 } else {
 const matchingB = bList.querySelector(`.pick-cb-b[value="${cb.value}"]`);
 if (matchingB) matchingB.parentElement.classList.remove('player-pick-item--disabled');
 }
 });
 });
 bList.querySelectorAll('.pick-cb-b').forEach(cb => {
 cb.addEventListener('change', () => {
 if (cb.checked) {
 const matchingA = aList.querySelector(`.pick-cb-a[value="${cb.value}"]`);
 if (matchingA) { matchingA.checked = false; matchingA.parentElement.classList.toggle('player-pick-item--disabled', true); }
 } else {
 const matchingA = aList.querySelector(`.pick-cb-a[value="${cb.value}"]`);
 if (matchingA) matchingA.parentElement.classList.remove('player-pick-item--disabled');
 }
 });
 });
 }

 /** Pre-fill create-match form from last generated teams */
 function prefillFromLastResult(state) {
 const r = state.lastResult;
 if (!r) return;
 const aList = document.getElementById('match-team-a-picks');
 const bList = document.getElementById('match-team-b-picks');
 if (!aList || !bList) return;

 aList.querySelectorAll('.pick-cb-a').forEach(cb => { cb.checked = r.teamA.includes(cb.value); });
 bList.querySelectorAll('.pick-cb-b').forEach(cb => { cb.checked = r.teamB.includes(cb.value); });

 // Apply mutual exclusion styling
 r.teamA.forEach(id => {
 const bCb = bList.querySelector(`.pick-cb-b[value="${esc(id)}"]`);
 if (bCb) bCb.parentElement.classList.add('player-pick-item--disabled');
 });
 r.teamB.forEach(id => {
 const aCb = aList.querySelector(`.pick-cb-a[value="${esc(id)}"]`);
 if (aCb) aCb.parentElement.classList.add('player-pick-item--disabled');
 });
 }

 /**
 * Build HTML for the "Add substitute player" collapsible panel.
 * teamId: 'A' or 'B' — the team to add the sub to.
 */
 function buildAddSubPanel(teamId) {
 return `
 <details class="add-sub-panel" id="add-sub-details-${teamId}">
 <summary class="bulk-toggle" style="font-size:var(--font-size-sm)">+ Add new player to ${teamId === 'A' ? 'Team A' : 'Team B'}</summary>
 <div class="bulk-body">
 <div class="form-row">
 <div class="form-group flex-grow">
 <label for="sub-name-${teamId}">Name</label>
 <input type="text" id="sub-name-${teamId}" placeholder="Player name" maxlength="40" autocomplete="off" spellcheck="false" />
 </div>
 <div class="form-group">
 <label for="sub-role-${teamId}">Role</label>
 <select id="sub-role-${teamId}">
 <option value="normal">No role</option>
 <option value="batter">Batter</option>
 <option value="bowler">Bowler</option>
 <option value="allrounder">All-Rounder</option>
 <option value="keeper">Keeper</option>
 </select>
 </div>
 <div class="form-group">
 <label for="sub-skill-${teamId}">Skill</label>
 <select id="sub-skill-${teamId}">
 <option value="normal">Normal</option>
 <option value="strong">Strong</option>
 <option value="weak">Weak</option>
 </select>
 </div>
 <div class="form-group form-group--action">
 <label class="visually-hidden">Add sub</label>
 <button class="btn btn--primary" id="btn-add-sub-${teamId}" data-team="${esc(teamId)}">Add</button>
 </div>
 </div>
 <div class="form-error" id="sub-error-${teamId}"></div>
 </div>
 </details>`;
 }

 /** Bind the add-sub button for a given team panel. Call after innerHTML is set. */
 function bindAddSubPanel(state, match, inn, teamId) {
 const btn = document.getElementById(`btn-add-sub-${teamId}`);
 if (!btn) return;
 btn.addEventListener('click', () => onAddSubPlayer(state, match, inn, teamId));
 }

 function onAddSubPlayer(state, match, inn, teamId) {
 const nameInput = document.getElementById(`sub-name-${teamId}`);
 const roleSelect = document.getElementById(`sub-role-${teamId}`);
 const skillSelect = document.getElementById(`sub-skill-${teamId}`);
 const errorEl = document.getElementById(`sub-error-${teamId}`);

 const name = nameInput.value.trim();
 if (!name) { errorEl.textContent = 'Name cannot be empty.'; return; }

 // Check for duplicate name across all players
 const lower = name.toLowerCase();
 const dup = state.players.find(p => p.nameLower === lower);
 if (dup) { errorEl.textContent = `"${esc(name)}" is already in the squad.`; return; }

 errorEl.textContent = '';

 // Create and save the new player
 const newPlayer = {
 id: generateId(),
 name: name,
 nameLower: lower,
 role: roleSelect.value,
 skill: skillSelect.value,
 playing: true,
 teamPin: null,
 addedAt: Date.now(),
 };
 state.players.push(newPlayer);

 // Add to the match team roster
 const team = teamId === 'A' ? match.teamA : match.teamB;
 team.playerIds.push(newPlayer.id);

 // If added to the batting team, also add to the innings batting order
 // so they appear in the batsman selector and scoreboard
 if (inn.battingTeamId === teamId) {
 inn.battingOrder.push(newPlayer.id);
 }

 saveState(state);
 renderScoringPanel(state);
 renderPlayerList(state);
 showToast(`${name} added to ${team.name}.`, 'success');
 }

 /** Main scoring panel dispatcher */
 function renderScoringPanel(state) {
 const panel = document.getElementById('scoring-panel');
 const match = getActiveMatch(state);

 if (!match) {
 panel.innerHTML = '<p class="empty-state">Open a match above to start scoring.</p>';
 return;
 }

 const inn = getActiveInnings(match);

 if (!inn) {
 // All innings completed
 renderMatchCompleted(panel, state, match);
 return;
 }

 if (match.status === 'toss') {
 renderToss(panel, state, match);
 return;
 }

 switch (inn.status) {
 case 'setup': renderInningsSetup(panel, state, match, inn); break;
 case 'active': renderActiveScoring(panel, state, match, inn); break;
 case 'needs_batsman': renderNeedsBatsman(panel, state, match, inn); break;
 case 'needs_bowler': renderNeedsBowler(panel, state, match, inn); break;
 case 'completed':
 // Inn 0 complete, inn 1 in setup
 if (inn.index === 0) renderBetweenInnings(panel, state, match);
 break;
 default:
 panel.innerHTML = '<p class="empty-state">Unknown state.</p>';
 }
 }

 function scoringHeader(match, inn) {
 const battingName = getTeamName(match, inn.battingTeamId);
 const totalLegal = inn.balls.filter(b => b.isLegal).length;
 const targetLine = inn.target !== null
 ? `<div class="scoring-target">Need ${inn.target - inn.totalRuns} more</div>` : '';
 return `
 <div class="scoring-header">
 <div class="scoring-header-left">
 <div class="scoring-match-name">${esc(match.name)} — Innings ${inn.index + 1}</div>
 <div class="scoring-score">${inn.totalRuns}/${inn.totalWickets}</div>
 <div class="scoring-innings-label">${esc(battingName)} batting</div>
 </div>
 <div class="scoring-header-right">
 <div class="scoring-overs">Ov ${oversLabel(totalLegal)}/${inn.maxOvers}</div>
 ${targetLine}
 </div>
 </div>`;
 }

 function renderToss(panel, state, match) {
 const nameA = esc(match.teamA.name);
 const nameB = esc(match.teamB.name);
 const capA = match.teamA.captainId ? esc(getPlayerName(state, match.teamA.captainId)) : '—';
 const capB = match.teamB.captainId ? esc(getPlayerName(state, match.teamB.captainId)) : '—';
 panel.innerHTML = `
 <div class="selector-panel toss-panel">
 <h3 class="toss-title"> Toss — ${esc(match.name)}</h3>
 <div class="captain-strip">
 <span class="captain-chip captain-chip--a">© ${nameA}: <strong>${capA}</strong></span>
 <span class="captain-chip captain-chip--b">© ${nameB}: <strong>${capB}</strong></span>
 </div>
 <div class="form-group">
 <label for="toss-winner">Who won the toss?</label>
 <select id="toss-winner">
 <option value="">Select team…</option>
 <option value="A">${nameA}</option>
 <option value="B">${nameB}</option>
 </select>
 </div>
 <div class="form-group" id="toss-choice-group" style="display:none">
 <label>They choose to…</label>
 <div class="toss-choice-btns">
 <button class="btn btn--ghost-green toss-choice-btn" data-choice="bat">Bat first</button>
 <button class="btn btn--ghost-green toss-choice-btn" data-choice="bowl">Bowl first</button>
 </div>
 </div>
 <div class="toss-summary" id="toss-summary" style="display:none"></div>
 <button class="btn btn--primary btn--full" id="btn-confirm-toss" style="margin-top:0.9rem" disabled>
 Start Match
 </button>
 <div class="form-error" id="toss-error"></div>
 </div>`;

 let selectedWinner = '';
 let selectedChoice = '';

 const winnerSel = document.getElementById('toss-winner');
 const choiceGroup = document.getElementById('toss-choice-group');
 const summary = document.getElementById('toss-summary');
 const confirmBtn = document.getElementById('btn-confirm-toss');

 function updateSummary() {
 if (!selectedWinner || !selectedChoice) return;
 const winnerName = selectedWinner === 'A' ? match.teamA.name : match.teamB.name;
 const loserName = selectedWinner === 'A' ? match.teamB.name : match.teamA.name;
 const battingTeam = selectedChoice === 'bat' ? winnerName : loserName;
 const bowlingTeam = selectedChoice === 'bat' ? loserName : winnerName;
 summary.innerHTML = `<strong>${esc(winnerName)}</strong> won the toss and chose to <strong>${selectedChoice} first</strong>.<br>
 <span style="color:var(--color-text-muted);font-size:0.85rem">${esc(battingTeam)} will bat · ${esc(bowlingTeam)} will bowl</span>`;
 summary.style.display = '';
 confirmBtn.disabled = false;
 }

 winnerSel.addEventListener('change', function () {
 selectedWinner = this.value;
 selectedChoice = '';
 choiceGroup.style.display = selectedWinner ? '' : 'none';
 summary.style.display = 'none';
 confirmBtn.disabled = true;
 choiceGroup.querySelectorAll('.toss-choice-btn').forEach(b => b.classList.remove('toss-choice-btn--active'));
 });

 choiceGroup.addEventListener('click', e => {
 const btn = e.target.closest('.toss-choice-btn');
 if (!btn) return;
 selectedChoice = btn.dataset.choice;
 choiceGroup.querySelectorAll('.toss-choice-btn').forEach(b => b.classList.remove('toss-choice-btn--active'));
 btn.classList.add('toss-choice-btn--active');
 updateSummary();
 });

 confirmBtn.addEventListener('click', () => {
 if (!selectedWinner || !selectedChoice) return;
 onConfirmToss(state, match, selectedWinner, selectedChoice);
 });
 }

 function onConfirmToss(state, match, winner, choice) {
 match.toss = { winner, choice };

 // Determine who bats first
 const tossWinnerBats = choice === 'bat';
 // winner 'A' bats → innings[0] = A bat, B bowl (default) — no swap needed
 // winner 'A' bowls → innings[0] should be B bat, A bowl — swap
 // winner 'B' bats → innings[0] should be B bat, A bowl — swap
 // winner 'B' bowls → innings[0] = A bat, B bowl (default) — no swap needed
 const needsSwap = (winner === 'A' && !tossWinnerBats) || (winner === 'B' && tossWinnerBats);
 if (needsSwap) {
 // Swap batting/bowling teams for both innings
 match.innings[0].battingTeamId = 'B';
 match.innings[0].bowlingTeamId = 'A';
 match.innings[1].battingTeamId = 'A';
 match.innings[1].bowlingTeamId = 'B';
 }

 match.status = 'active';
 saveState(state);
 renderMatchList(state);
 renderScoringPanel(state);
 }

 function renderInningsSetup(panel, state, match, inn) {
 const battingTeam = getTeamPlayerIds(match, inn.battingTeamId);
 const bowlingTeam = getTeamPlayerIds(match, inn.bowlingTeamId);
 const battingName = getTeamName(match, inn.battingTeamId);
 const bowlingName = getTeamName(match, inn.bowlingTeamId);

 const playerOpts = (ids, placeholder) =>
 `<option value="">${placeholder}</option>` +
 ids.map(id => `<option value="${esc(id)}">${esc(getPlayerName(state, id))}</option>`).join('');

 const targetInfo = inn.target !== null
 ? `<div class="innings-target-bar"><span>${esc(battingName)} need ${inn.target} runs to win</span></div>`
 : '';

 panel.innerHTML = `
 ${scoringHeader(match, inn)}
 ${targetInfo}
 <div class="selector-panel">
 <h3>Innings ${inn.index + 1} Setup — ${esc(battingName)} batting</h3>
 <div class="form-row">
 <div class="form-group flex-grow">
 <label for="setup-opener1">Opener 1 (on strike)</label>
 <select id="setup-opener1">${playerOpts(battingTeam, 'Select opener…')}</select>
 </div>
 <div class="form-group flex-grow">
 <label for="setup-opener2">Opener 2</label>
 <select id="setup-opener2">${playerOpts(battingTeam, 'Select opener…')}</select>
 </div>
 </div>
 <div class="form-group">
 <label for="setup-bowler">First Bowler (${esc(bowlingName)})</label>
 <select id="setup-bowler">${playerOpts(bowlingTeam, 'Select bowler…')}</select>
 </div>
 <button class="btn btn--primary btn--full" id="btn-confirm-setup" style="margin-top:0.7rem">
 Start Innings
 </button>
 <div class="form-error" id="setup-error"></div>
 </div>`;

 // When opener 1 changes, rebuild opener 2 options excluding the chosen player
 const opener1Sel = document.getElementById('setup-opener1');
 const opener2Sel = document.getElementById('setup-opener2');

 opener1Sel.addEventListener('change', function () {
 const chosen = this.value;
 const current2 = opener2Sel.value;
 opener2Sel.innerHTML =
 `<option value="">Select opener…</option>` +
 battingTeam
 .filter(id => id !== chosen)
 .map(id => `<option value="${esc(id)}" ${id === current2 ? 'selected' : ''}>${esc(getPlayerName(state, id))}</option>`)
 .join('');
 });

 document.getElementById('btn-confirm-setup').addEventListener('click', () => {
 onConfirmInningsSetup(state, match, inn);
 });
 }

 function renderActiveScoring(panel, state, match, inn) {
 const [strikerId, nonStrikerId] = inn.batterIds;
 const strikerName = strikerId ? getPlayerName(state, strikerId) : '—';
 const nonStrikerName = nonStrikerId ? getPlayerName(state, nonStrikerId) : '—';
 const bowlerName = inn.currentBowlerId ? getPlayerName(state, inn.currentBowlerId) : '—';

 const sStats = strikerId ? getBatsmanInningsStats(inn, strikerId) : null;
 const nsStats = nonStrikerId ? getBatsmanInningsStats(inn, nonStrikerId) : null;
 const bStats = inn.currentBowlerId ? getBowlerInningsStats(inn, inn.currentBowlerId) : null;

 // Current over balls (only balls from current over)
 const totalLegal = inn.balls.filter(b => b.isLegal).length;
 const curOverNum = Math.floor(totalLegal / 6);
 const overBalls = inn.balls.filter(b => b.overNumber === curOverNum);

 const dotHtml = overBalls.map(b =>
 `<span class="ball-dot ${getBallDotClass(b)}" title="${esc(getBallLabel(b))}">${esc(getBallLabel(b))}</span>`
 ).join('');

 panel.innerHTML = `
 ${scoringHeader(match, inn)}
 <div class="batter-row">
 <div class="batter-card batter-card--on-strike" id="batter-card-striker" title="On strike — tap other batter to swap">
 <div class="batter-card-name">
 <span class="strike-marker">★</span>${esc(strikerName)}
 </div>
 <div class="batter-card-stats">
 ${sStats ? `${sStats.runs}* (${sStats.balls}b) · 4s:${sStats.fours} 6s:${sStats.sixes}` : ''}
 </div>
 </div>
 <div class="batter-card batter-card--tap" id="batter-card-nonstruiker" title="Tap to move strike here" style="cursor:pointer">
 <div class="batter-card-name">${esc(nonStrikerName)} <span class="swap-hint">⇌</span></div>
 <div class="batter-card-stats">
 ${nsStats ? `${nsStats.runs} (${nsStats.balls}b) · 4s:${nsStats.fours} 6s:${nsStats.sixes}` : ''}
 </div>
 </div>
 </div>
 <div class="bowler-card">
 <span class="bowler-card-name">${esc(bowlerName)}</span>
 <span class="bowler-card-stats">${bStats ? `${bStats.oversLabel} ov · ${bStats.runs} runs · ${bStats.wickets}W` : ''}</span>
 </div>
 <div class="over-dots">
 <span class="over-label">This over:</span>
 ${dotHtml || '<span style="color:var(--color-text-muted);font-size:0.75rem">No balls yet</span>'}
 </div>

 <div class="ball-buttons" id="ball-btn-grid">
 <button class="ball-btn" data-runs="0">·</button>
 <button class="ball-btn" data-runs="1">1</button>
 <button class="ball-btn" data-runs="2">2</button>
 <button class="ball-btn" data-runs="3">3</button>
 <button class="ball-btn ball-btn--four" data-runs="4">4</button>
 <button class="ball-btn ball-btn--six" data-runs="6">6</button>
 <button class="ball-btn ball-btn--wide" data-extra="wide">Wd</button>
 <button class="ball-btn ball-btn--noball" data-extra="noball" data-nb-runs="0">Nb</button>
 <button class="ball-btn ball-btn--noball" data-extra="noball" data-nb-runs="1">Nb+1</button>
 <button class="ball-btn ball-btn--noball" data-extra="noball" data-nb-runs="2">Nb+2</button>
 <button class="ball-btn ball-btn--noball" data-extra="noball" data-nb-runs="4">Nb+4</button>
 <button class="ball-btn ball-btn--noball" data-extra="noball" data-nb-runs="6">Nb+6</button>
 <button class="ball-btn ball-btn--bye" data-extra="bye" data-bye-runs="1">B</button>
 <button class="ball-btn ball-btn--bye" data-extra="bye" data-bye-runs="2">B2</button>
 <button class="ball-btn ball-btn--bye" data-extra="bye" data-bye-runs="4">B4</button>
 <button class="ball-btn ball-btn--legbye" data-extra="legbye" data-bye-runs="1">Lb</button>
 <button class="ball-btn ball-btn--legbye" data-extra="legbye" data-bye-runs="2">Lb2</button>
 <button class="ball-btn ball-btn--legbye" data-extra="legbye" data-bye-runs="4">Lb4</button>
 <button class="ball-btn ball-btn--wicket" data-wicket="1">Wicket</button>
 <button class="ball-btn ball-btn--undo" data-undo="1">↩ Undo</button>
 </div>

 <div class="wicket-subpanel" id="wicket-subpanel">
 <h4>Wicket — How Out?</h4>
 <div class="form-row">
 <div class="form-group flex-grow">
 <label for="wicket-type">Mode of dismissal</label>
 <select id="wicket-type">
 <option value="bowled">Bowled</option>
 <option value="caught">Caught</option>
 <option value="lbw">LBW</option>
 <option value="runout">Run Out</option>
 <option value="stumped">Stumped</option>
 <option value="hitwicket">Hit Wicket</option>
 </select>
 </div>
 <div class="form-group flex-grow" id="wicket-fielder-group">
 <label for="wicket-fielder">Fielder (optional)</label>
 <select id="wicket-fielder">
 <option value="">None</option>
 ${getTeamPlayerIds(match, inn.bowlingTeamId).map(id =>
 `<option value="${esc(id)}">${esc(getPlayerName(state, id))}</option>`
 ).join('')}
 </select>
 </div>
 <div class="form-group" id="wicket-runout-group" style="display:none">
 <label for="wicket-runout-runs">Runs completed</label>
 <input type="number" id="wicket-runout-runs" value="0" min="0" max="6" style="width:70px" />
 <label style="margin-top:4px">
 <input type="checkbox" id="wicket-runout-striker" checked />
 Striker out
 </label>
 </div>
 </div>
 <div class="form-row" style="margin-top:0.5rem">
 <div class="form-group flex-grow">
 <label for="wicket-bat-runs">Bat runs before wicket</label>
 <input type="number" id="wicket-bat-runs" value="0" min="0" max="6" style="width:70px" />
 </div>
 </div>
 <button class="btn btn--danger" id="btn-confirm-wicket" style="margin-top:0.6rem">
 Confirm Wicket
 </button>
 <button class="btn btn--ghost-green btn--sm" id="btn-cancel-wicket" style="margin-top:0.6rem;margin-left:0.5rem">
 Cancel
 </button>
 </div>

 ${buildLiveScoreboard(state, match, inn)}
 ${buildAddSubPanel(inn.battingTeamId)}
 ${buildAddSubPanel(inn.bowlingTeamId)}`;

 // Tap non-striker card to manually swap strike
 const nonStrikerCard = document.getElementById('batter-card-nonstruiker');
 if (nonStrikerCard && nonStrikerId) {
 nonStrikerCard.addEventListener('click', () => {
 [inn.batterIds[0], inn.batterIds[1]] = [inn.batterIds[1], inn.batterIds[0]];
 if (navigator.vibrate) navigator.vibrate(30);
 saveState(state);
 renderScoringPanel(state);
 });
 }

 // Run buttons
 document.getElementById('ball-btn-grid').addEventListener('click', e => {
 const btn = e.target.closest('[data-runs],[data-extra],[data-wicket],[data-undo]');
 if (!btn) return;
 // Haptic feedback on every ball tap
 if (navigator.vibrate) navigator.vibrate(40);
 if (btn.dataset.runs !== undefined) {
 onRecordBall(state, match, inn, { type: 'normal', batRuns: parseInt(btn.dataset.runs) });
 } else if (btn.dataset.extra === 'wide') {
 onRecordBall(state, match, inn, { type: 'wide', batRuns: 0 });
 } else if (btn.dataset.extra === 'noball') {
 onRecordBall(state, match, inn, { type: 'noball', batRuns: parseInt(btn.dataset.nbRuns || '0') });
 } else if (btn.dataset.extra === 'bye') {
 onRecordBall(state, match, inn, { type: 'bye', batRuns: parseInt(btn.dataset.byeRuns || '1') });
 } else if (btn.dataset.extra === 'legbye') {
 onRecordBall(state, match, inn, { type: 'legbye', batRuns: parseInt(btn.dataset.byeRuns || '1') });
 } else if (btn.dataset.wicket) {
 document.getElementById('wicket-subpanel').classList.add('wicket-subpanel--open');
 } else if (btn.dataset.undo) {
 onUndoBall(state, match, inn);
 }
 });

 // Wicket type toggle
 document.getElementById('wicket-type').addEventListener('change', function () {
 const isRunout = this.value === 'runout';
 document.getElementById('wicket-runout-group').style.display = isRunout ? '' : 'none';
 document.getElementById('wicket-fielder-group').style.display = isRunout ? 'none' : '';
 });

 document.getElementById('btn-confirm-wicket').addEventListener('click', () => {
 onConfirmWicket(state, match, inn);
 });
 document.getElementById('btn-cancel-wicket').addEventListener('click', () => {
 document.getElementById('wicket-subpanel').classList.remove('wicket-subpanel--open');
 });

 bindAddSubPanel(state, match, inn, inn.battingTeamId);
 bindAddSubPanel(state, match, inn, inn.bowlingTeamId);
 }

 /**
 * Build the collapsible live scoreboard HTML for the active innings.
 * Shows: full batting card for dismissed + current batsmen,
 * full bowling card for all bowlers used so far.
 */
 function buildLiveScoreboard(state, match, inn) {
 const batTeam = getTeamPlayerIds(match, inn.battingTeamId);
 const bowlTeam = getTeamPlayerIds(match, inn.bowlingTeamId);
 const batCaptainId = getCaptainId(match, inn.battingTeamId);
 const bowlCaptainId = getCaptainId(match, inn.bowlingTeamId);

 // Batting rows — everyone who has batted or is batting
 const activeBatterIds = new Set(inn.batterIds.filter(Boolean));
 const dismissedIds = new Set(Object.keys(inn.dismissals));

 const batRows = batTeam.map(id => {
 const s = getBatsmanInningsStats(inn, id);
 const isDismissed = dismissedIds.has(id);
 const isBatting = activeBatterIds.has(id);
 const isOnStrike = inn.batterIds[0] === id;
 const isCaptain = id === batCaptainId;
 const capMark = isCaptain ? ' <span class="captain-marker">(C)</span>' : '';

 if (!s.didBat && !isDismissed && !isBatting) {
 // Yet to bat
 return `<tr class="dnb-row">
 <td>${esc(getPlayerName(state, id))}${capMark}</td>
 <td colspan="6" style="color:var(--color-text-muted);font-style:italic">yet to bat</td>
 </tr>`;
 }

 const howOut = isDismissed
 ? esc(inn.dismissals[id].type)
 : (isBatting ? (isOnStrike ? '★ batting' : 'batting') : '');
 const notOutMark = (!isDismissed && isBatting) ? '*' : '';

 return `<tr class="${isDismissed ? '' : 'not-out'}">
 <td>${esc(getPlayerName(state, id))}${isOnStrike ? ' <span class="strike-marker">★</span>' : ''}${capMark}</td>
 <td style="color:var(--color-text-muted);font-size:0.7rem">${howOut}</td>
 <td class="num"><strong>${s.runs}${notOutMark}</strong></td>
 <td class="num">${s.balls}</td>
 <td class="num">${s.fours}</td>
 <td class="num">${s.sixes}</td>
 <td class="num">${s.balls > 0 ? s.strikeRate : '-'}</td>
 </tr>`;
 }).join('');

 const extrasTotal = inn.extras.wides + inn.extras.noBalls + (inn.extras.byes || 0) + (inn.extras.legByes || 0);
 const totalLegal = inn.balls.filter(b => b.isLegal).length;

 // Bowling rows — everyone who has bowled at least 1 ball
 const bowlerIds = [...new Set(inn.balls.map(b => b.bowlerId).filter(Boolean))];
 const bowlRows = bowlTeam
 .filter(id => bowlerIds.includes(id))
 .map(id => {
 const s = getBowlerInningsStats(inn, id);
 const isCurrent = id === inn.currentBowlerId;
 const isBowlCap = id === bowlCaptainId;
 const capMarkB = isBowlCap ? ' <span class="captain-marker">(C)</span>' : '';
 return `<tr class="${isCurrent ? 'current-bowler-row' : ''}">
 <td>${esc(getPlayerName(state, id))}${isCurrent ? ' <span style="font-size:0.65rem;color:var(--color-primary)"> </span>' : ''}${capMarkB}</td>
 <td class="num">${s.oversLabel}</td>
 <td class="num">${s.runs}</td>
 <td class="num"><strong>${s.wickets}</strong></td>
 <td class="num">${s.economy !== null ? s.economy : '-'}</td>
 </tr>`;
 }).join('');

 // Over-by-over summary (last 6 completed overs)
 const allLegalBalls = inn.balls.filter(b => b.isLegal);
 const completedOvers = Math.floor(allLegalBalls.length / 6);
 const overSummaries = [];
 for (let ov = Math.max(0, completedOvers - 5); ov < completedOvers; ov++) {
 const allOverBalls = inn.balls.filter(b => b.overNumber === ov);
 const runs = allOverBalls.reduce((s, b) => s + b.totalRuns, 0);
 const wkts = allOverBalls.filter(b => b.dismissal).length;
 const dots = [ ...allOverBalls ]
 .map(b => `<span class="ball-dot ball-dot--sm ${getBallDotClass(b)}" title="${getBallLabel(b)}">${getBallLabel(b)}</span>`)
 .join('');
 overSummaries.push(`
 <div class="over-summary-row">
 <span class="over-summary-num">Ov ${ov + 1}</span>
 <span class="over-summary-dots">${dots}</span>
 <span class="over-summary-total">${runs} run${runs !== 1 ? 's' : ''}${wkts ? `, ${wkts}W` : ''}</span>
 </div>`);
 }

 return `
 <details class="live-scoreboard" id="live-scoreboard-details">
 <summary class="live-scoreboard-toggle">
 Scoreboard — ${inn.totalRuns}/${inn.totalWickets} (${oversLabel(totalLegal)} ov)
 </summary>
 <div class="live-scoreboard-body">

 <div class="live-sb-section">
 <div class="live-sb-heading">
 ${esc(getTeamName(match, inn.battingTeamId))} Batting
 </div>
 <div class="table-wrapper">
 <table class="scorecard live-scorecard">
 <thead><tr>
 <th>Batsman</th><th>How Out</th>
 <th class="num">R</th><th class="num">B</th>
 <th class="num">4s</th><th class="num">6s</th>
 <th class="num">SR</th>
 </tr></thead>
 <tbody>
 ${batRows}
 <tr class="extras-row">
 <td colspan="2">Extras (Wd:${inn.extras.wides} Nb:${inn.extras.noBalls} B:${inn.extras.byes||0} Lb:${inn.extras.legByes||0})</td>
 <td class="num">${extrasTotal}</td><td colspan="4"></td>
 </tr>
 <tr class="total-row">
 <td colspan="2"><strong>Total</strong></td>
 <td class="num"><strong>${inn.totalRuns}/${inn.totalWickets}</strong></td>
 <td colspan="4">(${oversLabel(totalLegal)} ov)</td>
 </tr>
 </tbody>
 </table>
 </div>
 </div>

 ${bowlRows ? `
 <div class="live-sb-section">
 <div class="live-sb-heading">
 ${esc(getTeamName(match, inn.bowlingTeamId))} Bowling
 </div>
 <div class="table-wrapper">
 <table class="scorecard live-scorecard">
 <thead><tr>
 <th>Bowler</th>
 <th class="num">Ov</th><th class="num">Runs</th>
 <th class="num">Wkts</th><th class="num">Econ</th>
 </tr></thead>
 <tbody>${bowlRows}</tbody>
 </table>
 </div>
 </div>` : ''}

 ${overSummaries.length ? `
 <div class="live-sb-section">
 <div class="live-sb-heading">Recent Overs</div>
 <div class="over-summaries">${overSummaries.join('')}</div>
 </div>` : ''}

 </div>
 </details>`;
 }

 function renderNeedsBatsman(panel, state, match, inn) {
 const remaining = getRemainingBatters(inn, getTeamPlayerIds(match, inn.battingTeamId));
 panel.innerHTML = `
 ${scoringHeader(match, inn)}
 ${buildLiveScoreboard(state, match, inn)}
 <div class="selector-panel" style="margin-top:0.75rem">
 <h3>Wicket! — Select next batsman</h3>
 <div class="selector-list" id="batsman-selector">
 ${remaining.map(id => `
 <div class="selector-item" data-select-batter="${esc(id)}">
 ${esc(getPlayerName(state, id))}
 </div>`).join('')}
 ${remaining.length === 0 ? '<p class="empty-state">No batters remaining.</p>' : ''}
 </div>
 <button class="btn btn--primary" id="btn-confirm-batter" disabled>Confirm</button>
 </div>
 ${buildAddSubPanel(inn.battingTeamId)}`;

 let selectedId = null;
 document.getElementById('batsman-selector').addEventListener('click', e => {
 const item = e.target.closest('[data-select-batter]');
 if (!item) return;
 document.querySelectorAll('#batsman-selector .selector-item').forEach(el => el.classList.remove('selector-item--selected'));
 item.classList.add('selector-item--selected');
 selectedId = item.dataset.selectBatter;
 document.getElementById('btn-confirm-batter').disabled = false;
 });

 document.getElementById('btn-confirm-batter').addEventListener('click', () => {
 if (!selectedId) return;
 selectNextBatsman(inn, selectedId);
 saveState(state);
 renderScoringPanel(state);
 });

 bindAddSubPanel(state, match, inn, inn.battingTeamId);
 }

 function renderNeedsBowler(panel, state, match, inn) {
 const bowlingTeam = getTeamPlayerIds(match, inn.bowlingTeamId);
 panel.innerHTML = `
 ${scoringHeader(match, inn)}
 ${buildLiveScoreboard(state, match, inn)}
 <div class="selector-panel">
 <h3>Over complete — Select next bowler</h3>
 <div class="selector-list" id="bowler-selector">
 ${bowlingTeam.map(id => {
 const bStats = getBowlerInningsStats(inn, id);
 const isLast = id === inn.lastBowlerId;
 return `
 <div class="selector-item ${isLast ? 'selector-item--warn' : ''}" data-select-bowler="${esc(id)}">
 ${esc(getPlayerName(state, id))}
 ${isLast ? '<span style="font-size:0.7rem;color:var(--color-accent)"> last over</span>' : ''}
 <span class="selector-item-stats">${bStats.oversLabel} ov, ${bStats.runs} runs, ${bStats.wickets}W</span>
 </div>`;
 }).join('')}
 </div>
 <div class="consecutive-warning" id="consecutive-warn" style="display:none">
 This bowler bowled the last over. Consecutive overs are unusual but allowed.
 </div>
 <button class="btn btn--primary" id="btn-confirm-bowler" disabled>Confirm</button>
 </div>
 ${buildAddSubPanel(inn.bowlingTeamId)}`;

 let selectedId = null;
 document.getElementById('bowler-selector').addEventListener('click', e => {
 const item = e.target.closest('[data-select-bowler]');
 if (!item) return;
 document.querySelectorAll('#bowler-selector .selector-item').forEach(el => el.classList.remove('selector-item--selected'));
 item.classList.add('selector-item--selected');
 selectedId = item.dataset.selectBowler;
 document.getElementById('btn-confirm-bowler').disabled = false;
 document.getElementById('consecutive-warn').style.display =
 selectedId === inn.lastBowlerId ? '' : 'none';
 });

 document.getElementById('btn-confirm-bowler').addEventListener('click', () => {
 if (!selectedId) return;
 selectNextBowler(inn, selectedId);
 saveState(state);
 renderScoringPanel(state);
 });

 bindAddSubPanel(state, match, inn, inn.bowlingTeamId);
 }

 function renderBetweenInnings(panel, state, match) {
 const inn0 = match.innings[0];
 const inn1 = match.innings[1];
 inn1.target = inn0.totalRuns + 1;
 saveState(state);

 panel.innerHTML = `
 <div class="match-result-banner">
 ${esc(getTeamName(match, inn0.battingTeamId))}: ${inn0.totalRuns}/${inn0.totalWickets}
 — ${esc(getTeamName(match, inn1.battingTeamId))} need ${inn1.target} to win
 </div>
 ${renderScorecardHTML(state, match, 0)}
 <hr style="margin:1rem 0;border-color:var(--color-border)">
 `;

 // Append the innings-2 setup form below the scorecard
 const setupDiv = document.createElement('div');
 renderInningsSetup(setupDiv, state, match, inn1);
 panel.appendChild(setupDiv);
 }

 function renderMatchCompleted(panel, state, match) {
 match.status = 'completed';
 match.completedAt = Date.now();
 recordCaptainStats(state, match);
 saveState(state);
 renderMatchList(state);

 const inn0 = match.innings[0];
 const inn1 = match.innings[1];
 const t0 = inn0.totalRuns;
 const t1 = inn1.totalRuns;
 const w1 = inn1.totalWickets;
 const teamAName = getTeamName(match, 'A');
 const teamBName = getTeamName(match, 'B');

 let resultText;
 if (t1 >= inn1.target) {
 const wicketsLeft = allOutThreshold(match.teamB.playerIds.length) - w1;
 resultText = `${esc(teamBName)} won by ${wicketsLeft} wicket(s)`;
 } else if (t0 > t1) {
 resultText = `${esc(teamAName)} won by ${t0 - t1} run(s)`;
 } else if (t0 === t1) {
 resultText = 'Match tied!';
 } else {
 resultText = `${esc(teamBName)} won`;
 }

 panel.innerHTML = `
 <div class="match-result-banner">${resultText}</div>
 <div class="innings-tabs">
 <button class="innings-tab innings-tab--active" data-inn="0">Innings 1 — ${esc(getTeamName(match, inn0.battingTeamId))}</button>
 <button class="innings-tab" data-inn="1">Innings 2 — ${esc(getTeamName(match, inn1.battingTeamId))}</button>
 </div>
 <div id="scorecard-body">${renderScorecardHTML(state, match, 0)}</div>`;

 panel.querySelectorAll('.innings-tab').forEach(tab => {
 tab.addEventListener('click', () => {
 panel.querySelectorAll('.innings-tab').forEach(t => t.classList.remove('innings-tab--active'));
 tab.classList.add('innings-tab--active');
 document.getElementById('scorecard-body').innerHTML =
 renderScorecardHTML(state, match, parseInt(tab.dataset.inn));
 });
 });
 }

 function renderScorecardHTML(state, match, inningsIndex) {
 const inn = match.innings[inningsIndex];
 const batTeam = getTeamPlayerIds(match, inn.battingTeamId);
 const bowlTeam = getTeamPlayerIds(match, inn.bowlingTeamId);
 const batCaptainId = getCaptainId(match, inn.battingTeamId);
 const bowlCaptainId = getCaptainId(match, inn.bowlingTeamId);

 const batRows = batTeam.map(id => {
 const s = getBatsmanInningsStats(inn, id);
 const capMark = id === batCaptainId ? ' <span class="captain-marker">(C)</span>' : '';
 if (!s.didBat) return `<tr class="dnb"><td>${esc(getPlayerName(state,id))}${capMark}</td><td colspan="6" style="color:var(--color-text-muted)">did not bat</td></tr>`;
 return `<tr class="${s.notOut ? 'not-out' : ''}">
 <td>${esc(getPlayerName(state,id))}${s.notOut ? '*' : ''}${capMark}</td>
 <td>${esc(s.howOut)}</td>
 <td class="num">${s.runs}</td>
 <td class="num">${s.balls}</td>
 <td class="num">${s.fours}</td>
 <td class="num">${s.sixes}</td>
 <td class="num">${s.strikeRate}</td>
 </tr>`;
 }).join('');

 const extrasTotal = inn.extras.wides + inn.extras.noBalls + (inn.extras.byes || 0) + (inn.extras.legByes || 0);

 const bowlRows = bowlTeam.map(id => {
 const s = getBowlerInningsStats(inn, id);
 if (s.legalBalls === 0 && !inn.balls.some(b => b.bowlerId === id)) return '';
 const capMark = id === bowlCaptainId ? ' <span class="captain-marker">(C)</span>' : '';
 return `<tr>
 <td>${esc(getPlayerName(state,id))}${capMark}</td>
 <td class="num">${s.oversLabel}</td>
 <td class="num">${s.runs}</td>
 <td class="num">${s.wickets}</td>
 <td class="num">${s.economy !== null ? s.economy : '-'}</td>
 </tr>`;
 }).join('');

 return `
 <div class="scorecard-section">
 <div class="table-wrapper">
 <table class="scorecard">
 <thead><tr>
 <th>Batsman</th><th>How Out</th>
 <th class="num">R</th><th class="num">B</th>
 <th class="num">4s</th><th class="num">6s</th>
 <th class="num">SR</th>
 </tr></thead>
 <tbody>
 ${batRows}
 <tr class="extras-row"><td colspan="2">Extras (Wd:${inn.extras.wides} Nb:${inn.extras.noBalls} B:${inn.extras.byes||0} Lb:${inn.extras.legByes||0})</td><td class="num">${extrasTotal}</td><td colspan="4"></td></tr>
 <tr class="total-row"><td colspan="2"><strong>Total</strong></td><td class="num"><strong>${inn.totalRuns}/${inn.totalWickets}</strong></td><td colspan="4">(${oversLabel(inn.balls.filter(b=>b.isLegal).length)} ov)</td></tr>
 </tbody>
 </table>
 </div>
 </div>
 <div class="scorecard-section">
 <div class="scorecard-section"><h4>Bowling</h4></div>
 <div class="table-wrapper">
 <table class="scorecard">
 <thead><tr>
 <th>Bowler</th>
 <th class="num">Ov</th><th class="num">Runs</th>
 <th class="num">Wkts</th><th class="num">Econ</th>
 </tr></thead>
 <tbody>${bowlRows}</tbody>
 </table>
 </div>
 </div>`;
 }

 function buildCaptainLeaderboard(state) {
 const rows = Object.values(state.captainStats || {});
 if (!rows.length) return '';

 // Derive win% and sort by wins desc, then win% desc
 const enriched = rows
 .filter(s => s.matches > 0)
 .map(s => ({
 ...s,
 winPct: s.matches > 0 ? Math.round((s.wins / s.matches) * 100) : 0,
 }))
 .sort((a, b) => b.wins - a.wins || b.winPct - a.winPct);

 if (!enriched.length) return '';

 const tableRows = enriched.map(s => `<tr>
 <td>${esc(getPlayerName(state, s.playerId))}</td>
 <td class="num">${s.matches}</td>
 <td class="num"><strong>${s.wins}</strong></td>
 <td class="num">${s.losses}</td>
 <td class="num">${s.ties}</td>
 <td class="num">${s.winPct}%</td>
 </tr>`).join('');

 return `
 <p class="stats-section-title">Captain Leaderboard</p>
 <div class="table-wrapper">
 <table class="stats-table">
 <thead><tr>
 <th>Captain</th>
 <th class="num">M</th>
 <th class="num">W</th>
 <th class="num">L</th>
 <th class="num">T</th>
 <th class="num">Win%</th>
 </tr></thead>
 <tbody>${tableRows}</tbody>
 </table>
 </div>`;
 }

 function renderDayStats(state) {
 const container = document.getElementById('day-stats-content');

 // Check if any innings have been played at all or if captain stats exist
 const hasMatchData = state.matches.some(m =>
 m.innings.some(inn => inn.status !== 'setup' && inn.balls.length > 0)
 );
 const hasCaptainData = Object.keys(state.captainStats || {}).length > 0;
 if (!hasMatchData && !hasCaptainData) {
 container.innerHTML = '<p class="empty-state">Stats will appear here once balls are bowled.</p>';
 return;
 }

 const { batting, bowling } = hasMatchData ? getDayStats(state) : { batting: {}, bowling: {} };
 const awards = hasMatchData ? getDayAwards(state) : [];

 // Sort defaults
 let batSortKey = 'runs';
 let batSortDir = 'desc';
 let bowlSortKey = 'wickets';
 let bowlSortDir = 'desc';

 function sortArr(arr, key, dir) {
 return [...arr].sort((a, b) => {
 const av = a[key] === null || a[key] === undefined ? (dir === 'desc' ? -Infinity : Infinity) : a[key];
 const bv = b[key] === null || b[key] === undefined ? (dir === 'desc' ? -Infinity : Infinity) : b[key];
 return dir === 'desc' ? bv - av : av - bv;
 });
 }

 function buildBatRows(arr) {
 if (!arr.length) return '<tr><td colspan="11" class="empty-state">No batting data yet.</td></tr>';
 return arr.map(a => `<tr>
 <td>${esc(getPlayerName(state, a.playerId))}</td>
 <td class="num">${a.matches}</td>
 <td class="num">${a.innings}</td>
 <td class="num"><strong>${a.runs}</strong></td>
 <td class="num">${a.highScore}${a.highScoreNotOut ? '*' : ''}</td>
 <td class="num">${a.average !== null ? a.average : '-'}</td>
 <td class="num">${a.balls}</td>
 <td class="num">${a.strikeRate}</td>
 <td class="num">${a.fours}</td>
 <td class="num">${a.sixes}</td>
 <td class="num">${a.fifties}/${a.hundreds}</td>
 </tr>`).join('');
 }

 function buildBowlRows(arr) {
 if (!arr.length) return '<tr><td colspan="10" class="empty-state">No bowling data yet.</td></tr>';
 return arr.map(a => `<tr>
 <td>${esc(getPlayerName(state, a.playerId))}</td>
 <td class="num">${a.matches}</td>
 <td class="num">${a.oversLabel}</td>
 <td class="num"><strong>${a.wickets}</strong></td>
 <td class="num">${a.runs}</td>
 <td class="num">${a.economy !== null ? a.economy : '-'}</td>
 <td class="num">${a.average !== null ? a.average : '-'}</td>
 <td class="num">${a.best}</td>
 <td class="num">${a.maidens}</td>
 <td class="num">${a.dotPct}%</td>
 </tr>`).join('');
 }

 const batArr = sortArr(Object.values(batting), batSortKey, batSortDir);
 const bowlArr = sortArr(Object.values(bowling), bowlSortKey, bowlSortDir);

 const awardsHtml = awards.length === 0 ? '' : `
 <p class="stats-section-title">Day Awards</p>
 <div class="awards-grid" id="awards-grid">
 ${awards.map(a => `
 <div class="award-card">
 <div class="award-icon">${a.icon}</div>
 <div class="award-body">
 <div class="award-label">${esc(a.label)}</div>
 <div class="award-winner">${esc(a.winner)}</div>
 <div class="award-value">${esc(String(a.value))}</div>
 </div>
 </div>`).join('')}
 </div>`;

 const captainLeaderboard = buildCaptainLeaderboard(state);

 const matchStatsHtml = hasMatchData ? `
 <p class="stats-section-title" style="margin-top:${(awards.length || captainLeaderboard) ? '1.25rem' : '0'}">Batting</p>
 <div class="table-wrapper">
 <table class="stats-table" id="bat-stats-table">
 <thead><tr>
 <th>Player</th>
 <th class="num" data-sort-bat="matches">M</th>
 <th class="num" data-sort-bat="innings">Inn</th>
 <th class="num" data-sort-bat="runs">Runs</th>
 <th class="num" data-sort-bat="highScore">HS</th>
 <th class="num" data-sort-bat="average">Avg</th>
 <th class="num" data-sort-bat="balls">Balls</th>
 <th class="num" data-sort-bat="strikeRate">SR</th>
 <th class="num" data-sort-bat="fours">4s</th>
 <th class="num" data-sort-bat="sixes">6s</th>
 <th class="num" data-sort-bat="fifties" title="50s / 100s">50/100</th>
 </tr></thead>
 <tbody id="bat-stats-body">${buildBatRows(batArr)}</tbody>
 </table>
 </div>

 <p class="stats-section-title" style="margin-top:1rem">Bowling</p>
 <div class="table-wrapper">
 <table class="stats-table" id="bowl-stats-table">
 <thead><tr>
 <th>Player</th>
 <th class="num" data-sort-bowl="matches">M</th>
 <th class="num" data-sort-bowl="oversLabel" title="Overs bowled">Ov</th>
 <th class="num" data-sort-bowl="wickets">Wkts</th>
 <th class="num" data-sort-bowl="runs">Runs</th>
 <th class="num" data-sort-bowl="economy">Econ</th>
 <th class="num" data-sort-bowl="average">Avg</th>
 <th class="num" data-sort-bowl="bestWkts" title="Best innings figures">Best</th>
 <th class="num" data-sort-bowl="maidens">Mdn</th>
 <th class="num" data-sort-bowl="dotPct" title="% of legal balls that were dot balls">Dot%</th>
 </tr></thead>
 <tbody id="bowl-stats-body">${buildBowlRows(bowlArr)}</tbody>
 </table>
 </div>` : '';

 container.innerHTML = `
 ${awardsHtml}
 ${captainLeaderboard}
 ${matchStatsHtml}`;

 // ── Sortable column headers ──
 container.querySelectorAll('[data-sort-bat]').forEach(th => {
 th.style.cursor = 'pointer';
 th.addEventListener('click', () => {
 const key = th.dataset.sortBat;
 if (batSortKey === key) { batSortDir = batSortDir === 'desc' ? 'asc' : 'desc'; }
 else { batSortKey = key; batSortDir = 'desc'; }
 container.querySelectorAll('[data-sort-bat]').forEach(t => t.classList.remove('asc','desc'));
 th.classList.add(batSortDir);
 const sorted = sortArr(Object.values(batting), batSortKey, batSortDir);
 document.getElementById('bat-stats-body').innerHTML = buildBatRows(sorted);
 });
 });

 container.querySelectorAll('[data-sort-bowl]').forEach(th => {
 th.style.cursor = 'pointer';
 th.addEventListener('click', () => {
 const key = th.dataset.sortBowl;
 if (bowlSortKey === key) { bowlSortDir = bowlSortDir === 'desc' ? 'asc' : 'desc'; }
 else { bowlSortKey = key; bowlSortDir = 'desc'; }
 container.querySelectorAll('[data-sort-bowl]').forEach(t => t.classList.remove('asc','desc'));
 th.classList.add(bowlSortDir);
 const sorted = sortArr(Object.values(bowling), bowlSortKey, bowlSortDir);
 document.getElementById('bowl-stats-body').innerHTML = buildBowlRows(sorted);
 });
 });
 }

 /* ================================================================
 K. MATCH SCORING — EVENT HANDLERS
 ================================================================ */

 function onCreateMatch(state) {
 const nameInput = document.getElementById('match-name-input');
 const oversInput = document.getElementById('match-overs-input');
 const errorEl = document.getElementById('create-match-error');
 errorEl.textContent = '';

 const name = nameInput.value.trim() || `Match ${state.matches.length + 1}`;
 const overs = parseInt(oversInput.value) || 6;

 const aChecks = [...document.querySelectorAll('.pick-cb-a:checked')].map(cb => cb.value);
 const bChecks = [...document.querySelectorAll('.pick-cb-b:checked')].map(cb => cb.value);

 if (aChecks.length === 0) { errorEl.textContent = 'Select at least 1 player for Team A.'; return; }
 if (bChecks.length === 0) { errorEl.textContent = 'Select at least 1 player for Team B.'; return; }

 const match = createMatch(name, overs, aChecks, bChecks);
 match.teamA.name = (state.lastResult ? 'Team A' : 'Team A');
 match.teamB.name = (state.lastResult ? 'Team B' : 'Team B');
 state.matches.push(match);
 state.settings.activeMatchId = match.id;
 saveState(state);

 // Close the details panel
 const details = document.getElementById('create-match-details');
 if (details) details.open = false;

 nameInput.value = '';
 renderMatchList(state);
 renderScoringPanel(state);
 renderDayStats(state);
 showToast(`Match "${name}" created!`, 'success');
 document.getElementById('section-scoring').scrollIntoView({ behavior: 'smooth', block: 'start' });
 }

 function onOpenMatch(matchId, state) {
 state.settings.activeMatchId = matchId;
 saveState(state);
 renderMatchList(state);
 renderScoringPanel(state);
 document.getElementById('section-scoring').scrollIntoView({ behavior: 'smooth', block: 'start' });
 }

 function onDeleteMatch(matchId, state) {
 if (!window.confirm('Delete this match and all its scoring data?')) return;
 state.matches = state.matches.filter(m => m.id !== matchId);
 if (state.settings.activeMatchId === matchId) state.settings.activeMatchId = null;
 saveState(state);
 renderMatchList(state);
 renderScoringPanel(state);
 renderDayStats(state);
 }

 function onConfirmInningsSetup(state, match, inn) {
 const opener1 = document.getElementById('setup-opener1').value;
 const opener2 = document.getElementById('setup-opener2').value;
 const bowler = document.getElementById('setup-bowler').value;
 const errorEl = document.getElementById('setup-error');

 if (!opener1 || !opener2 || !bowler) { errorEl.textContent = 'Select both openers and a bowler.'; return; }
 if (opener1 === opener2) { errorEl.textContent = 'Openers must be different players.'; return; }

 const batTeam = getTeamPlayerIds(match, inn.battingTeamId);
 setupInnings(inn, opener1, opener2, bowler, batTeam);

 // Set target for innings 2
 if (inn.index === 1) {
 inn.target = match.innings[0].totalRuns + 1;
 }

 saveState(state);
 renderScoringPanel(state);
 }

 function onRecordBall(state, match, inn, ballData) {
 recordBall(inn, ballData, getTeamPlayerIds(match, inn.battingTeamId).length);

 // Check if this innings just completed → update match status
 if (inn.status === 'completed') {
 if (inn.index === 1) {
 match.status = 'completed';
 match.completedAt = Date.now();
 }
 }

 saveState(state);
 renderScoringPanel(state);
 renderDayStats(state);
 renderMatchList(state);
 }

 function onConfirmWicket(state, match, inn) {
 const type = document.getElementById('wicket-type').value;
 const isRunout = type === 'runout';
 const batRuns = parseInt(document.getElementById('wicket-bat-runs').value) || 0;
 const fielderCreditId = !isRunout ? (document.getElementById('wicket-fielder').value || null) : null;
 const bowlerCreditId = (type === 'runout') ? null : inn.currentBowlerId;
 const runoutRuns = isRunout ? (parseInt(document.getElementById('wicket-runout-runs').value) || 0) : 0;
 const runoutStriker = isRunout ? document.getElementById('wicket-runout-striker').checked : true;
 const dismissedId = runoutStriker ? inn.batterIds[0] : inn.batterIds[1];

 const dismissal = {
 dismissedPlayerId: dismissedId,
 type,
 bowlerCreditId,
 fielderCreditId,
 runs: isRunout ? runoutRuns : batRuns,
 wasOnStrike: runoutStriker,
 };

 const bd = {
 type: 'wicket',
 batRuns: isRunout ? runoutRuns : batRuns,
 dismissal,
 };

 onRecordBall(state, match, inn, bd);
 }

 function onUndoBall(state, match, inn) {
 if (inn.balls.length === 0) { showToast('Nothing to undo.', 'warning'); return; }

 const last = inn.balls.pop();

 // Reverse totals
 inn.totalRuns -= last.totalRuns;
 if (last.type === 'wide') inn.extras.wides -= last.extraRuns;
 if (last.type === 'noball') inn.extras.noBalls -= last.extraRuns;
 if (last.isLegal && inn.legalBallsThisOver > 0) inn.legalBallsThisOver--;

 // Reverse dismissal
 if (last.dismissal) {
 delete inn.dismissals[last.dismissal.dismissedPlayerId];
 inn.totalWickets = Math.max(0, inn.totalWickets - 1);
 }

 // Restore striker to what it was before — simplest approach: recompute from scratch
 // Rebuild batterIds from scratch using remaining balls
 inn.batterIds = [null, null];
 inn.legalBallsThisOver = 0;
 inn.totalRuns = 0;
 inn.totalWickets = 0;
 inn.dismissals = {};
 inn.extras = { wides: 0, noBalls: 0, byes: 0, legByes: 0 };
 inn.currentBowlerId = inn.battingOrder ? inn.currentBowlerId : null;

 // Re-simulate from scratch with remaining balls
 const ballsCopy = [...inn.balls];
 inn.balls = [];
 inn.batterIds = [inn.battingOrder[0] || null, inn.battingOrder[1] || null];
 // currentBowlerId will be set ball-by-ball via bowlerId on each ball
 // We need to track it as we resim
 inn.currentBowlerId = ballsCopy.length > 0 ? ballsCopy[0].bowlerId : null;

 ballsCopy.forEach(b => {
 inn.currentBowlerId = b.bowlerId;
 recordBall(inn, { type: b.type, batRuns: b.batRuns, dismissal: b.dismissal },
 inn.battingOrder.length);
 // If resim paused for batter/bowler, auto-advance using what the historical ball tells us
 if (inn.status === 'needs_batsman' && b.dismissal) {
 // The replaced batter would have been selected; skip — leave in needs_batsman
 // until natural flow. For undo purposes just restore to active.
 }
 });

 // After resim, force back to active so player can continue
 if (inn.status === 'completed' || inn.status === 'needs_batsman' || inn.status === 'needs_bowler') {
 inn.status = 'active';
 }

 saveState(state);
 renderScoringPanel(state);
 renderDayStats(state);
 showToast('Last ball undone.', 'info');
 }

 function bindScoringEvents(state) {
 // Match list event delegation
 document.getElementById('match-list').addEventListener('click', e => {
 const btn = e.target.closest('[data-action]');
 if (!btn) return;
 if (btn.dataset.action === 'open-match') onOpenMatch(btn.dataset.id, state);
 if (btn.dataset.action === 'delete-match') onDeleteMatch(btn.dataset.id, state);
 });

 // Create match
 document.getElementById('btn-create-match').addEventListener('click', () => onCreateMatch(state));

 // Use last teams checkbox
 document.getElementById('match-use-last-teams').addEventListener('change', function () {
 if (this.checked) prefillFromLastResult(state);
 else {
 // Uncheck all
 document.querySelectorAll('.pick-cb-a, .pick-cb-b').forEach(cb => {
 cb.checked = false;
 cb.parentElement.classList.remove('player-pick-item--disabled');
 });
 }
 });

 // Auto-populate match name
 const nameInput = document.getElementById('match-name-input');
 if (nameInput && !nameInput.value) {
 nameInput.placeholder = `Match ${state.matches.length + 1}`;
 }
 }

 /* ================================================================
 L. BOOTSTRAP
 ================================================================ */

 /* ── Wake Lock ── */
 let _wakeLock = null;

 async function requestWakeLock() {
 if (!('wakeLock' in navigator)) return;
 try {
 _wakeLock = await navigator.wakeLock.request('screen');
 _wakeLock.addEventListener('release', () => { _wakeLock = null; updateWakeLockBtn(); });
 updateWakeLockBtn();
 } catch (_) { /* permission denied or unavailable */ }
 }

 async function releaseWakeLock() {
 if (_wakeLock) { await _wakeLock.release(); _wakeLock = null; }
 updateWakeLockBtn();
 }

 function updateWakeLockBtn() {
 const btn = document.getElementById('btn-wake-lock');
 if (!btn) return;
 const on = !!_wakeLock;
 btn.textContent = on ? ' Screen On' : ' Keep Awake';
 btn.classList.toggle('btn--wake-on', on);
 }

 // Re-acquire wake lock when tab becomes visible again (e.g. after phone unlock)
 document.addEventListener('visibilitychange', () => {
 if (document.visibilityState === 'visible' && _wakeLock === null) {
 const btn = document.getElementById('btn-wake-lock');
 if (btn && btn.classList.contains('btn--wake-on')) requestWakeLock();
 }
 });

 function init() {
 const state = loadState();
 ensureMatchesInState(state);
 render(state);
 renderMatchList(state);
 renderCreateMatchForm(state);
 renderScoringPanel(state);
 renderDayStats(state);
 bindEvents(state);
 bindScoringEvents(state);

 // Wire wake lock toggle
 const wakeBtn = document.getElementById('btn-wake-lock');
 if (wakeBtn) {
 if (!('wakeLock' in navigator)) {
 wakeBtn.disabled = true;
 wakeBtn.title = 'Wake Lock not supported in this browser';
 } else {
 wakeBtn.addEventListener('click', () => {
 if (_wakeLock) releaseWakeLock(); else requestWakeLock();
 });
 }
 }

 // Wire high-contrast toggle
 const contrastBtn = document.getElementById('btn-high-contrast');
 if (contrastBtn) {
 const saved = localStorage.getItem('cricketHighContrast') === '1';
 if (saved) document.body.classList.add('high-contrast');
 contrastBtn.textContent = saved ? '◑ Normal' : '◑ Outdoor';
 contrastBtn.addEventListener('click', () => {
 const on = document.body.classList.toggle('high-contrast');
 localStorage.setItem('cricketHighContrast', on ? '1' : '0');
 contrastBtn.textContent = on ? '◑ Normal' : '◑ Outdoor';
 });
 }
 }

 init();