# Cricket Team Splitter

A lightweight, offline-ready web app for managing your weekend cricket group — split into balanced teams, run a toss, score ball-by-ball, and track stats for every player across multiple days. Built for phone use by a match umpire: big buttons, haptic feedback, screen wake lock, and an outdoor high-contrast mode.

No install, no server, no account. Just open the file and go.

---

## How to Run

1. Download or clone this folder.
2. Open **index.html** in any modern browser (Chrome, Firefox, Edge, Safari).
3. That's it — no npm, no build step, no internet required.

All data is saved automatically to your browser's `localStorage` and persists between sessions.

---

## Features

### Players
- **Add players** one by one or in bulk (paste a list of names)
- **Tag each player** with a role (Batter, Bowler, All-Rounder, Keeper) and skill level (Strong, Normal, Weak)
- **Playing / Resting toggle** — mark players as available or sitting out for the day; resting players are excluded from team generation but stay in your permanent squad list
- **Persistent squad** — your player list is stored in `localStorage` and carries over between sessions; just toggle availability each day
- **Manual team assignment** — pin any player to Team A, Team B, Common (bench), or Auto before generating

### Team Splitting
- **Set constraints** — *Opposite teams* or *Same team* for any two players
- **Auto or manual team size** — let the app split evenly, or specify a fixed team size
- **Reshuffle** — regenerate with a new random split at any time
- **Repeatable splits** — enter a seed string to get the exact same split every time
- **Common / Extras** — odd-numbered groups or overflowing constraints land in the Common pool automatically
- **Conflict warnings** — impossible constraints are flagged with a plain-English explanation
- **Copy result** — copies the full team list to your clipboard
- **Export as text** — downloads a `.txt` file of the result

### Matches & Scoring
- **Toss** — record who won the toss and whether they chose to bat or bowl; teams are assigned accordingly
- **Captain** — a random captain is assigned to each team at match creation; shown on the toss panel and all scorecards with a (C) marker
- **Up to 4 matches per day**, each with two innings
- **Innings setup** — choose openers (Opener 1 is on strike; Opener 2 dropdown automatically excludes the selected Opener 1 to prevent duplicates) and first bowler
- **Ball-by-ball scoring** — dot, 1–6 runs, 4, 6, Wide, No-ball (Nb / Nb+1 / Nb+2 / Nb+4 / Nb+6), Bye (B / B2 / B4), Leg Bye (Lb / Lb2 / Lb4), Wicket
- **Legal deliveries only** — wides and no-balls do not count toward the over; each over is exactly 6 legal balls. Byes and leg byes are legal deliveries.
- **Extras tracking** — Wides, No-balls, Byes, and Leg Byes all tracked separately in the scorecard. Byes and leg byes are not charged to the bowler's figures or economy.
- **Manual strike swap** — tap the non-striker's card at any time to manually move strike (e.g. after a miscount or run-out confusion); a ⇌ icon indicates the card is tappable
- **Wicket types** — Bowled, Caught, LBW, Run Out, Stumped, Hit Wicket
- **Strike rotation** — odd runs rotate strike; end of over rotates strike automatically
- **Live scoreboard** — collapsible in-play batting card (runs, balls, 4s, 6s, SR, how out), bowling card (overs, runs, wickets, economy), and over-by-over summary
- **Full scorecard** — shown at end of each innings and match completion
- **Target chase** — second innings shows runs needed; match ends automatically when target is reached or exceeded
- **Max overs enforcement** — innings completes automatically after the configured number of overs
- **Undo** — remove the last recorded ball at any time
- **Reset Matches** — clear all match and scoring data without touching your squad or captain stats

### Umpire / Phone Features
- **Keep Awake ( )** — toggle in the header to prevent the screen from locking mid-over using the Screen Wake Lock API; auto re-acquires if the phone is briefly unlocked
- **Outdoor mode (◑)** — high-contrast black background theme optimised for sunlight readability; preference saved across sessions
- **Haptic feedback** — a short vibration pulse on every ball recorded and every strike swap (phones that support `navigator.vibrate`)
- **Large tap targets** — ball buttons are 58px tall on mobile for reliable one-handed use

### Day Stats
- **Batting table** — matches, innings, runs, high score, average, balls, strike rate, 4s, 6s, 50s/100s (sortable by any column)
- **Bowling table** — matches, overs, wickets, runs, economy, average, best figures, maidens, dot% (sortable by any column)
- **15 day awards** — Top Run Scorer, Highest Score, Best Batting Average, Fastest Striker, Six Machine, Boundary King, Most Not Outs, Most 50+ Scores, Top Wicket Taker, Best Figures, Best Economy, Best Bowling Average, Best Bowling SR, Dot Ball Specialist, Most Maidens
- **Captain Leaderboard** — all-time win/loss/tie record per captain with win%; persists across days via import/export merge

### Cross-Day Captain Stats
Captain win/loss records accumulate across sessions:
1. At end of Day 1, **Export** your data.
2. **Reset Matches** (captain stats are preserved automatically).
3. Play Day 2 matches.
4. **Import** the Day 1 file — captain stats from both days are merged together.
5. The Captain Leaderboard in Day Stats shows the combined all-time record.
- **Reset Captain Stats** button (in the Day Stats heading) wipes the leaderboard if needed.

### Data Management
- **Export / Import JSON** — back up or share your full squad, constraints, match data, and captain stats
- **Reset All** — wipe everything and start fresh
- **Reset Matches** — clear match data only; squad and captain stats are preserved

---

## File Structure

```
index.html — HTML shell, all nine UI sections
styles.css — All styles (mobile-first, CSS custom properties, high-contrast theme)
players.js — Player constants, validation, rendering, and event handlers
app.js — Core logic: state, utilities, team generation, scoring, stats
sample-data.json — 14 sample players to try in the browser console
README.md — This file
```

`players.js` must be loaded before `app.js`. Both are plain scripts sharing the same global scope — no build step required.

---

## How the Balancing Logic Works

### 1. Scoring Model

Each playing player is assigned a numeric skill score used to balance teams:

| Condition | Score |
|---------------------------------|-------|
| Skill = Strong (any role) | +3 |
| Role = All-Rounder | +2 |
| Role = Batter / Bowler / Keeper | +1 |
| Role = None, Skill = Normal | 0 |
| Skill = Weak (any role) | −2 |

Players marked as **Resting** are excluded entirely from generation.

### 2. Union-Find Grouping

All *same-team* constraints are applied first using a Union-Find (disjoint set) structure. Players linked by same-team constraints are treated as a single atomic group that moves together.

### 3. Conflict Detection

After grouping, every *opposite-team* constraint is checked. If two players ended up in the same group (due to same-team chains), it's impossible to separate them. A warning is shown and that constraint is skipped.

### 4. Manual Pin Override

Players manually pinned to Team A, Team B, or Common via the player list are applied as hard overrides before constraint processing and snake-draft.

### 5. Opposite Constraint Assignment

Valid opposite-team pairs are processed. One group is pinned to Team A, the other to Team B. If cascading constraints create a contradiction, a warning is shown.

### 6. Snake-Draft Balancing

Remaining unpinned groups are sorted by score (highest first). They are assigned one at a time to whichever team currently has the lower total score. On a tie, Team A gets priority.

### 7. Common Pool

Any group that cannot fit within the team size limit goes to Common. If the total playing count is odd, one player always ends up in Common when using auto team size.

### 8. Seeded Randomness

Before assignment, groups are shuffled using a seeded PRNG (mulberry32) so that the same seed always produces the same teams. If no seed is provided, `Date.now()` is used for a different result each time.

---

## Loading Sample Data

To pre-load 14 sample players, open the browser console (F12) and run:

```js
fetch('sample-data.json')
 .then(r => r.json())
 .then(d => {
 localStorage.setItem('cricketTeamSplitter_v1', JSON.stringify(d));
 location.reload();
 });
```

Or if running from `file://`, paste the JSON contents directly:

```js
const data = /* paste sample-data.json contents here */;
localStorage.setItem('cricketTeamSplitter_v1', JSON.stringify(data));
location.reload();
```

---

## Future Improvement Ideas

- **PWA support** — add a service worker and manifest for offline installation on mobile home screen
- **Share link** — encode state as a URL query parameter for easy sharing
- **Dark mode** — `prefers-color-scheme: dark` media query (separate from the manual outdoor toggle)
- **Batting order** — set full batting order during innings setup rather than picking on demand
- **Partnership tracking** — track runs scored per batting pair
- **Super over** — 1-over decider when scores are tied
- **Retire hurt** — allow a batter to leave without dismissal and return later
- **All-time batting/bowling records** — same cross-day merge pattern as captain stats, extended to career batting and bowling aggregates