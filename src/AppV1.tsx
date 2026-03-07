import { useState, useMemo } from "react";

const MAX_PLAYERS = 30;
const MAX_COURTS = 7;
const COLORS = {
  green: "#2d6a2d",
  greenMid: "#4a9e4a",
  greenLight: "#e8f5e8",
  yellow: "#f5c518",
  yellowLight: "#fffbe6",
  dark: "#1a3a1a",
  white: "#ffffff",
  gray: "#f0f0f0",
  grayMid: "#ccc",
  red: "#c0392b",
  blue: "#2980b9",
};

const TABS = ["Players", "Courts", "Leaderboard"];

function Badge({ color, children }) {
  return (
    <span style={{ background: color, color: "#fff", borderRadius: 8, padding: "2px 10px", fontSize: 12, fontWeight: 700 }}>
      {children}
    </span>
  );
}

function Button({ onClick, color = COLORS.green, textColor = "#fff", children, small, disabled, outline }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: outline ? "transparent" : disabled ? COLORS.grayMid : color,
        color: outline ? color : textColor,
        border: outline ? `2px solid ${color}` : "none",
        borderRadius: 8,
        padding: small ? "5px 12px" : "9px 20px",
        fontWeight: 700,
        fontSize: small ? 13 : 15,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
        transition: "opacity .15s",
      }}
    >
      {children}
    </button>
  );
}

// Generate round-robin rounds with fair sit-out rotation
function generateRounds(players, numCourts) {
  const n = players.length;
  if (n < 4) return [];
  const courtsNeeded = Math.floor(n / 4);
  const courts = Math.min(courtsNeeded, numCourts);
  const playersPerRound = courts * 4;
  const sitOutCount = n - playersPerRound;

  // Build all possible unique matches (pairs of 2-player teams)
  // Use a simple rotation schedule
  const rounds = [];
  const ids = players.map((_, i) => i);

  // Sit-out tracker
  const sitOutCounts = new Array(n).fill(0);

  // We'll generate enough rounds so every player plays reasonable matches
  // Use round-robin pairing via rotation
  const totalRounds = Math.max(n - 1, 8);

  let pool = [...ids];

  for (let r = 0; r < totalRounds; r++) {
    // Pick sit-outs: those with fewest sit-outs
    let sitOuts = [];
    if (sitOutCount > 0) {
      const sorted = [...pool].sort((a, b) => sitOutCounts[a] - sitOutCounts[b] || a - b);
      sitOuts = sorted.slice(0, sitOutCount);
    }

    const active = pool.filter(p => !sitOuts.includes(p));
    // Shuffle active for variety using round index
    const shuffled = [...active];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = (i * 7 + r * 13) % (i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const roundCourts = [];
    for (let c = 0; c < courts; c++) {
      const four = shuffled.slice(c * 4, c * 4 + 4);
      roundCourts.push({
        courtNum: c + 1,
        team1: [four[0], four[1]],
        team2: [four[2], four[3]],
        score1: "",
        score2: "",
        done: false,
      });
    }

    sitOuts.forEach(p => sitOutCounts[p]++);

    rounds.push({ courts: roundCourts, sitOuts, roundNum: r + 1 });
  }

  return rounds;
}

export default function App() {
  const [tab, setTab] = useState("Players");
  const [players, setPlayers] = useState([]);
  const [nameInput, setNameInput] = useState("");
  const [numCourts, setNumCourts] = useState(4);
  const [rounds, setRounds] = useState([]);
  const [currentRound, setCurrentRound] = useState(0);
  const [tournamentStarted, setTournamentStarted] = useState(false);
  const [scores, setScores] = useState({}); // key: "round-court", val: {s1, s2, done}

  // Add player
  const addPlayer = () => {
    const name = nameInput.trim();
    if (!name || players.length >= MAX_PLAYERS) return;
    if (players.find(p => p.name.toLowerCase() === name.toLowerCase())) return;
    setPlayers(prev => [...prev, { name, id: Date.now() }]);
    setNameInput("");
  };

  const removePlayer = (id) => setPlayers(prev => prev.filter(p => p.id !== id));

  const startTournament = () => {
    if (players.length < 4) return;
    const r = generateRounds(players, numCourts);
    setRounds(r);
    setScores({});
    setCurrentRound(0);
    setTournamentStarted(true);
    setTab("Courts");
  };

  const resetTournament = () => {
    setTournamentStarted(false);
    setRounds([]);
    setScores({});
    setCurrentRound(0);
  };

  // Score entry
  const getScore = (ri, ci) => scores[`${ri}-${ci}`] || { s1: "", s2: "", done: false };

  const setScore = (ri, ci, field, val) => {
    const key = `${ri}-${ci}`;
    setScores(prev => ({ ...prev, [key]: { ...getScore(ri, ci), [field]: val } }));
  };

  const submitScore = (ri, ci) => {
    const s = getScore(ri, ci);
    const s1 = parseInt(s.s1), s2 = parseInt(s.s2);
    if (isNaN(s1) || isNaN(s2) || s1 < 0 || s2 < 0) return;
    setScores(prev => ({ ...prev, [`${ri}-${ci}`]: { ...s, done: true } }));
  };

  const editScore = (ri, ci) => {
    setScores(prev => ({ ...prev, [`${ri}-${ci}`]: { ...getScore(ri, ci), done: false } }));
  };

  // Check if all courts in current round are done
  const roundDone = useMemo(() => {
    if (!tournamentStarted || rounds.length === 0) return false;
    const r = rounds[currentRound];
    return r.courts.every((_, ci) => getScore(currentRound, ci).done);
  }, [scores, currentRound, rounds, tournamentStarted]);

  // Leaderboard
  const leaderboard = useMemo(() => {
    if (!tournamentStarted) return [];
    const stats = {};
    players.forEach(p => { stats[p.id] = { name: p.name, wins: 0, points: 0, played: 0 }; });

    rounds.forEach((round, ri) => {
      round.courts.forEach((court, ci) => {
        const sc = getScore(ri, ci);
        if (!sc.done) return;
        const s1 = parseInt(sc.s1), s2 = parseInt(sc.s2);
        const allFour = [...court.team1, ...court.team2];
        allFour.forEach(pid => { if (stats[players[pid]?.id]) stats[players[pid].id].played++; });

        court.team1.forEach(pid => {
          const p = players[pid]; if (!p || !stats[p.id]) return;
          stats[p.id].points += s1;
          if (s1 > s2) stats[p.id].wins++;
        });
        court.team2.forEach(pid => {
          const p = players[pid]; if (!p || !stats[p.id]) return;
          stats[p.id].points += s2;
          if (s2 > s1) stats[p.id].wins++;
        });
      });
    });

    return Object.values(stats).sort((a, b) => b.wins - a.wins || b.points - a.points);
  }, [scores, rounds, players, tournamentStarted]);

  const round = tournamentStarted && rounds[currentRound];

  return (
    <div style={{ minHeight: "100vh", background: COLORS.greenLight, fontFamily: "'Segoe UI', sans-serif" }}>
      {/* Header */}
      <div style={{ background: COLORS.green, padding: "14px 20px", display: "flex", alignItems: "center", gap: 12, boxShadow: "0 2px 8px #0003" }}>
        <span style={{ fontSize: 28 }}>🥒</span>
        <div>
          <div style={{ color: COLORS.yellow, fontWeight: 900, fontSize: 20, letterSpacing: 1 }}>PICKLEBALL</div>
          <div style={{ color: "#fff", fontSize: 12, fontWeight: 600, letterSpacing: 2 }}>ROUND-ROBIN MANAGER</div>
        </div>
        {tournamentStarted && (
          <div style={{ marginLeft: "auto" }}>
            <Button small outline color={COLORS.yellow} textColor={COLORS.yellow} onClick={resetTournament}>↩ Reset</Button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", background: COLORS.dark, justifyContent: "center" }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            flex: 1, maxWidth: 180, padding: "11px 0", border: "none", cursor: "pointer",
            background: tab === t ? COLORS.yellow : "transparent",
            color: tab === t ? COLORS.dark : "#aaa",
            fontWeight: 800, fontSize: 14, letterSpacing: 1,
            borderBottom: tab === t ? `3px solid ${COLORS.yellow}` : "3px solid transparent",
            transition: "all .15s",
          }}>{t.toUpperCase()}</button>
        ))}
      </div>

      <div style={{ maxWidth: 700, margin: "0 auto", padding: "20px 16px" }}>

        {/* ── PLAYERS TAB ── */}
        {tab === "Players" && (
          <div>
            <div style={{ background: "#fff", borderRadius: 12, padding: 20, boxShadow: "0 2px 8px #0001", marginBottom: 16 }}>
              <div style={{ fontWeight: 800, color: COLORS.dark, fontSize: 16, marginBottom: 12 }}>
                Add Players <Badge color={COLORS.greenMid}>{players.length}/{MAX_PLAYERS}</Badge>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  value={nameInput}
                  onChange={e => setNameInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && addPlayer()}
                  placeholder="Player name..."
                  maxLength={30}
                  style={{ flex: 1, padding: "9px 14px", borderRadius: 8, border: `2px solid ${COLORS.grayMid}`, fontSize: 15, outline: "none" }}
                />
                <Button onClick={addPlayer} disabled={!nameInput.trim() || players.length >= MAX_PLAYERS}>+ Add</Button>
              </div>

              <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 6 }}>
                {players.length === 0 && <div style={{ color: "#aaa", textAlign: "center", padding: 20 }}>No players yet. Add up to 30!</div>}
                {players.map((p, i) => (
                  <div key={p.id} style={{ display: "flex", alignItems: "center", background: COLORS.greenLight, borderRadius: 8, padding: "7px 12px" }}>
                    <span style={{ color: COLORS.greenMid, fontWeight: 700, width: 26 }}>{i + 1}.</span>
                    <span style={{ flex: 1, fontWeight: 600, color: COLORS.dark }}>{p.name}</span>
                    {!tournamentStarted && (
                      <button onClick={() => removePlayer(p.id)} style={{ background: "none", border: "none", color: COLORS.red, cursor: "pointer", fontSize: 18, lineHeight: 1 }}>×</button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Courts config */}
            <div style={{ background: "#fff", borderRadius: 12, padding: 20, boxShadow: "0 2px 8px #0001", marginBottom: 16 }}>
              <div style={{ fontWeight: 800, color: COLORS.dark, fontSize: 16, marginBottom: 12 }}>Court Settings</div>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <span style={{ color: "#555" }}>Number of courts:</span>
                <div style={{ display: "flex", gap: 6 }}>
                  {[1,2,3,4,5,6,7].map(n => (
                    <button key={n} onClick={() => setNumCourts(n)} style={{
                      width: 36, height: 36, borderRadius: 8, border: "2px solid",
                      borderColor: numCourts === n ? COLORS.green : COLORS.grayMid,
                      background: numCourts === n ? COLORS.green : "#fff",
                      color: numCourts === n ? "#fff" : COLORS.dark,
                      fontWeight: 700, cursor: "pointer"
                    }}>{n}</button>
                  ))}
                </div>
              </div>
              <div style={{ marginTop: 10, color: "#888", fontSize: 13 }}>
                {players.length} players → {Math.min(Math.floor(players.length/4), numCourts)} active court(s), {Math.max(0, players.length - Math.min(Math.floor(players.length/4), numCourts)*4)} sitting out per round
              </div>
            </div>

            <div style={{ textAlign: "center" }}>
              <Button onClick={startTournament} disabled={players.length < 4} color={COLORS.yellow} textColor={COLORS.dark}>
                🎾 Start Tournament ({players.length} players)
              </Button>
              {players.length < 4 && <div style={{ color: "#888", marginTop: 8, fontSize: 13 }}>Need at least 4 players to start</div>}
            </div>
          </div>
        )}

        {/* ── COURTS TAB ── */}
        {tab === "Courts" && (
          <div>
            {!tournamentStarted ? (
              <div style={{ textAlign: "center", color: "#888", padding: 40 }}>Set up players first, then start the tournament.</div>
            ) : (
              <>
                {/* Round navigation */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                  <Button small outline color={COLORS.green} onClick={() => setCurrentRound(r => Math.max(0, r-1))} disabled={currentRound === 0}>← Prev</Button>
                  <div style={{ fontWeight: 800, color: COLORS.dark, fontSize: 17 }}>
                    Round {currentRound + 1} <span style={{ color: "#aaa", fontWeight: 400, fontSize: 13 }}>of {rounds.length}</span>
                  </div>
                  <Button small outline color={COLORS.green} onClick={() => setCurrentRound(r => Math.min(rounds.length-1, r+1))} disabled={currentRound === rounds.length-1}>Next →</Button>
                </div>

                {/* Sit-outs */}
                {round.sitOuts.length > 0 && (
                  <div style={{ background: COLORS.yellowLight, border: `1px solid ${COLORS.yellow}`, borderRadius: 10, padding: "8px 14px", marginBottom: 14, fontSize: 13, color: COLORS.dark }}>
                    <strong>Sitting out this round:</strong> {round.sitOuts.map(i => players[i]?.name).join(", ")}
                  </div>
                )}

                {/* Courts */}
                {round.courts.map((court, ci) => {
                  const sc = getScore(currentRound, ci);
                  const winner = sc.done ? (parseInt(sc.s1) > parseInt(sc.s2) ? 1 : 2) : null;
                  return (
                    <div key={ci} style={{ background: "#fff", borderRadius: 12, padding: 18, marginBottom: 14, boxShadow: "0 2px 8px #0001", borderLeft: `5px solid ${COLORS.greenMid}` }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                        <div style={{ fontWeight: 800, color: COLORS.green, fontSize: 15 }}>🏓 Court {court.courtNum}</div>
                        {sc.done && <Badge color={COLORS.greenMid}>✓ Score Entered</Badge>}
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 8, alignItems: "center" }}>
                        {/* Team 1 */}
                        <div style={{ background: winner===1 ? COLORS.greenLight : COLORS.gray, borderRadius: 10, padding: "10px 14px", border: winner===1 ? `2px solid ${COLORS.greenMid}` : "2px solid transparent" }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.greenMid, marginBottom: 4 }}>TEAM 1</div>
                          {court.team1.map(pi => (
                            <div key={pi} style={{ fontWeight: 600, color: COLORS.dark, fontSize: 14 }}>{players[pi]?.name}</div>
                          ))}
                        </div>

                        <div style={{ textAlign: "center", fontWeight: 900, color: COLORS.grayMid, fontSize: 16 }}>VS</div>

                        {/* Team 2 */}
                        <div style={{ background: winner===2 ? COLORS.greenLight : COLORS.gray, borderRadius: 10, padding: "10px 14px", border: winner===2 ? `2px solid ${COLORS.greenMid}` : "2px solid transparent" }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.greenMid, marginBottom: 4 }}>TEAM 2</div>
                          {court.team2.map(pi => (
                            <div key={pi} style={{ fontWeight: 600, color: COLORS.dark, fontSize: 14 }}>{players[pi]?.name}</div>
                          ))}
                        </div>
                      </div>

                      {/* Score entry */}
                      <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10, justifyContent: "center" }}>
                        {sc.done ? (
                          <>
                            <div style={{ fontWeight: 900, fontSize: 22, color: COLORS.dark }}>{sc.s1} — {sc.s2}</div>
                            <Button small outline color={COLORS.blue} onClick={() => editScore(currentRound, ci)}>Edit</Button>
                          </>
                        ) : (
                          <>
                            <input type="number" min={0} max={25} value={sc.s1}
                              onChange={e => setScore(currentRound, ci, "s1", e.target.value)}
                              placeholder="T1"
                              style={{ width: 56, padding: "7px 10px", borderRadius: 8, border: `2px solid ${COLORS.grayMid}`, fontSize: 18, fontWeight: 700, textAlign: "center" }} />
                            <span style={{ fontWeight: 900, color: "#aaa" }}>—</span>
                            <input type="number" min={0} max={25} value={sc.s2}
                              onChange={e => setScore(currentRound, ci, "s2", e.target.value)}
                              placeholder="T2"
                              style={{ width: 56, padding: "7px 10px", borderRadius: 8, border: `2px solid ${COLORS.grayMid}`, fontSize: 18, fontWeight: 700, textAlign: "center" }} />
                            <Button small onClick={() => submitScore(currentRound, ci)}
                              disabled={sc.s1 === "" || sc.s2 === ""} color={COLORS.green}>
                              ✓ Save
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}

                {roundDone && (
                  <div style={{ textAlign: "center", marginTop: 10 }}>
                    <div style={{ color: COLORS.green, fontWeight: 700, marginBottom: 8 }}>✅ Round {currentRound+1} complete!</div>
                    {currentRound < rounds.length - 1
                      ? <Button onClick={() => { setCurrentRound(r => r+1); setTab("Courts"); }} color={COLORS.yellow} textColor={COLORS.dark}>Next Round →</Button>
                      : <Button onClick={() => setTab("Leaderboard")} color={COLORS.yellow} textColor={COLORS.dark}>🏆 View Final Standings</Button>
                    }
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── LEADERBOARD TAB ── */}
        {tab === "Leaderboard" && (
          <div>
            {!tournamentStarted ? (
              <div style={{ textAlign: "center", color: "#888", padding: 40 }}>Start the tournament to see standings.</div>
            ) : (
              <div style={{ background: "#fff", borderRadius: 12, padding: 20, boxShadow: "0 2px 8px #0001" }}>
                <div style={{ fontWeight: 800, color: COLORS.dark, fontSize: 17, marginBottom: 14 }}>🏆 Standings</div>
                <div style={{ display: "grid", gridTemplateColumns: "32px 1fr 60px 60px 60px", gap: 6, marginBottom: 8 }}>
                  {["#","Player","Wins","Pts","Played"].map(h => (
                    <div key={h} style={{ fontSize: 11, fontWeight: 700, color: "#aaa", textAlign: h==="Player"?"left":"center" }}>{h}</div>
                  ))}
                </div>
                {leaderboard.map((p, i) => (
                  <div key={p.name} style={{
                    display: "grid", gridTemplateColumns: "32px 1fr 60px 60px 60px", gap: 6,
                    alignItems: "center", padding: "9px 0",
                    borderTop: `1px solid ${COLORS.gray}`,
                    background: i === 0 ? COLORS.yellowLight : i < 3 ? COLORS.greenLight : "transparent",
                    borderRadius: 8, paddingLeft: 8
                  }}>
                    <div style={{ fontWeight: 900, color: i===0?COLORS.yellow:i<3?COLORS.greenMid:"#aaa", textAlign:"center" }}>
                      {i===0?"🥇":i===1?"🥈":i===2?"🥉":i+1}
                    </div>
                    <div style={{ fontWeight: 700, color: COLORS.dark }}>{p.name}</div>
                    <div style={{ textAlign:"center", fontWeight:700, color: COLORS.green }}>{p.wins}</div>
                    <div style={{ textAlign:"center", color:"#555" }}>{p.points}</div>
                    <div style={{ textAlign:"center", color:"#aaa", fontSize:13 }}>{p.played}</div>
                  </div>
                ))}
                {leaderboard.every(p => p.played === 0) && (
                  <div style={{ color:"#aaa", textAlign:"center", padding:20 }}>No scores entered yet.</div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
