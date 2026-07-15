Cricket Team Splitter
A lightweight, offline-ready web app for managing your weekend cricket group — split into balanced teams, run a toss, score ball-by-ball, and track day stats for every player. No install, no server, no account. Just open the file and go.

How to Run
Download or clone this folder.
Open index.html in any modern browser (Chrome, Firefox, Edge, Safari).
That's it — no npm, no build step, no internet required.
All data is saved automatically to your browser's localStorage and persists between sessions.

Features
Players
Add players one by one or in bulk (paste a list of names)
Tag each player with a role (Batter, Bowler, All-Rounder, Keeper) and skill level (Strong, Normal, Weak)
Playing / Resting toggle — mark players as available or sitting out for the day; resting players are excluded from team generation but stay in your permanent squad list
Persistent squad — your player list is stored in localStorage and carries over between sessions; just toggle availability each day
Team Splitting
Set constraints:
Opposite teams — two players who must never be on the same side
Same team — two players who must always be together
Auto or manual team size — let the app split evenly, or specify a fixed team size
Reshuffle — regenerate with a new random split at any time
Repeatable splits — enter a seed string to get the exact same split every time
Bench / Extras — odd-numbered groups or overflowing constraints land on the bench automatically
Conflict warnings — impossible constraints are flagged with a plain-English explanation
Copy result — copies the full team list to your clipboard
Export as text — downloads a .txt file of the result
Matches & Scoring
Toss — before each match, record who won the toss and whether they chose to bat or bowl; teams are assigned accordingly
Up to 4 matches per day, each with two innings
Ball-by-ball scoring — dot, 1–6 runs, 4, 6, Wide, No-ball (Nb / Nb+1 / Nb+2 / Nb+3 / Nb+4 / Nb+6), Wicket
Legal deliveries only — wides and no-balls do not count toward the over; each over is exactly 6 legal balls
Wicket types — Bowled, Caught, LBW, Run Out, Stumped, Hit Wicket
Strike rotation — odd runs rotate strike; end of over rotates strike automatically
Live scoreboard — collapsible in-play batting card (runs, balls, 4s, 6s, SR, how out), bowling card (overs, runs, wickets, economy), and over-by-over summary
Full scorecard — shown at end of each innings and match completion
Target chase — second innings shows runs needed; match ends automatically when target is reached or exceeded
Max overs enforcement — innings completes automatically after the configured number of overs
Reset Matches — clear all match and scoring data without touching your squad
Day Stats
Batting table — matches, innings, runs, high score, average, balls, strike rate, 4s, 6s, 50s/100s (sortable by any column)
Bowling table — matches, overs, wickets, runs, economy, average, best figures, maidens, dot% (sortable by any column)
15 day awards — Top Run Scorer, Highest Score, Best Batting Average, Fastest Striker, Six Machine, Boundary King, Most Not Outs, Most 50+ Scores, Top Wicket Taker, Best Figures, Best Economy, Best Bowling Average, Best Bowling SR, Dot Ball Specialist, Most Maidens
Data Management
Export / Import JSON — back up or share your full squad, constraints, and match data
Reset All — wipe everything and start fresh
File Structure
index.html        — HTML shell, all nine UI sections
styles.css        — All styles (mobile-first, CSS custom properties)
players.js        — Player constants, validation, rendering, and event handlers
app.js            — Core logic: state, utilities, team generation, scoring, stats
sample-data.json  — 14 sample players to try in the browser console
README.md         — This file
players.js must be loaded before app.js. Both are plain scripts sharing the same global scope — no build step required.

How the Balancing Logic Works
1. Scoring Model
Each playing player is assigned a numeric skill score used to balance teams:

Condition	Score
Skill = Strong (any role)	+3
Role = All-Rounder	+2
Role = Batter / Bowler / Keeper	+1
Role = None, Skill = Normal	0
Skill = Weak (any role)	−2
Players marked as Resting are excluded entirely from generation.

2. Union-Find Grouping
All same-team constraints are applied first using a Union-Find (disjoint set) structure. Players linked by same-team constraints are treated as a single atomic group that moves together.

3. Conflict Detection
After grouping, every opposite-team constraint is checked. If two players ended up in the same group (due to same-team chains), it's impossible to separate them. A warning is shown and that opposite constraint is skipped.

4. Opposite Constraint Assignment
Valid opposite-team pairs are processed. One group is pinned to Team A, the other to Team B. If cascading constraints create a contradiction (both groups forced to the same side), a warning is shown.

5. Snake-Draft Balancing
Remaining unpinned groups are sorted by score (highest first). They are assigned one at a time to whichever team currently has the lower total score. On a tie, Team A gets priority.

6. Bench
Any group that cannot fit within the team size limit goes to the bench. If the total playing count is odd, one player always ends up on the bench when using auto team size.

7. Seeded Randomness
Before assignment, groups are shuffled using a seeded PRNG (mulberry32) so that the same seed always produces the same teams. If no seed is provided, Date.now() is used for a different result each time.

Loading Sample Data
To pre-load 14 sample players, open the browser console (F12) and run:

fetch('sample-data.json')
  .then(r => r.json())
  .then(d => {
    localStorage.setItem('cricketTeamSplitter_v1', JSON.stringify(d));
    location.reload();
  });
Or if running from file://, paste the JSON contents directly:

const data = /* paste sample-data.json contents here */;
localStorage.setItem('cricketTeamSplitter_v1', JSON.stringify(data));
location.reload();
Future Improvement Ideas
Captain flag — mark one player per team as captain automatically
Share link — encode state as a URL query parameter for easy sharing
PWA support — add a service worker and manifest for offline installation on mobile
Dark mode — CSS media query for prefers-color-scheme: dark
Drag-and-drop — manually move players between teams after generation
Batting order — set full batting order during innings setup rather than just openers
Partnership tracking — track runs scored per batting pair