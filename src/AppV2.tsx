import { useState, useMemo, useEffect } from "react";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, collection, deleteDoc, onSnapshot } from "firebase/firestore";

// Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyAqBFWIzNZUHCz83lnHzjHcGYfbjICAgQM",
  authDomain: "gogreenvue-afd10.firebaseapp.com",
  projectId: "gogreenvue-afd10",
  storageBucket: "gogreenvue-afd10.firebasestorage.app",
  messagingSenderId: "968289098989",
  appId: "1:968289098989:web:da82db1feca0a70f6e00e4"
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

const MAX_PLAYERS = 30;

const COLORS = {
  green: "#2d6a2d", greenMid: "#4a9e4a", greenLight: "#e8f5e8",
  yellow: "#f5c518", yellowLight: "#fffbe6", dark: "#1a3a1a",
  white: "#ffffff", gray: "#f0f0f0", grayMid: "#ccc",
  red: "#c0392b", blue: "#2980b9", purple: "#8e44ad",
};

const TABS = ["Players", "Courts", "Leaderboard", "History"];

interface Player { name: string; id: number; }
interface Court { courtNum: number; team1: number[]; team2: number[]; }
interface Round { courts: Court[]; sitOuts: number[]; roundNum: number; }
interface Score { s1: string; s2: string; done: boolean; }
interface Stats { name: string; wins: number; points: number; played: number; }
interface SavedTournament {
  id: string; date: string; players: Player[];
  rounds: Round[]; scores: Record<string, Score>; leaderboard: Stats[];
}

function Badge({ color, children }: { color: string; children: React.ReactNode }) {
  return <span style={{ background: color, color: "#fff", borderRadius: 8, padding: "2px 10px", fontSize: 12, fontWeight: 700 }}>{children}</span>;
}

function Button({ onClick, color = COLORS.green, textColor = "#fff", children, small = false, disabled = false, outline = false }: {
  onClick?: () => void; color?: string; textColor?: string; children: React.ReactNode;
  small?: boolean; disabled?: boolean; outline?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background: outline ? "transparent" : disabled ? COLORS.grayMid : color,
      color: outline ? color : textColor, border: outline ? `2px solid ${color}` : "none",
      borderRadius: 8, padding: small ? "5px 12px" : "9px 20px", fontWeight: 700,
      fontSize: small ? 13 : 15, cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.6 : 1, transition: "opacity .15s",
    }}>{children}</button>
  );
}

function generateRounds(players: Player[], numCourts: number): Round[] {
  const n = players.length;
  if (n < 4) return [];
  const courts = Math.min(Math.floor(n / 4), numCourts);
  const sitOutCount = n - courts * 4;
  const rounds: Round[] = [];
  const sitOutCounts = new Array(n).fill(0);
  const pool = players.map((_, i) => i);
  for (let r = 0; r < Math.max(n - 1, 8); r++) {
    let sitOuts: number[] = [];
    if (sitOutCount > 0) {
      sitOuts = [...pool].sort((a, b) => sitOutCounts[a] - sitOutCounts[b] || a - b).slice(0, sitOutCount);
    }
    const shuffled = [...pool.filter(p => !sitOuts.includes(p))];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = (i * 7 + r * 13) % (i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    rounds.push({
      courts: Array.from({ length: courts }, (_, c) => ({
        courtNum: c + 1, team1: [shuffled[c*4], shuffled[c*4+1]], team2: [shuffled[c*4+2], shuffled[c*4+3]]
      })),
      sitOuts, roundNum: r + 1
    });
    sitOuts.forEach(p => sitOutCounts[p]++);
  }
  return rounds;
}

function computeLeaderboard(players: Player[], rounds: Round[], scores: Record<string, Score>): Stats[] {
  const stats: Record<number, Stats> = {};
  players.forEach(p => { stats[p.id] = { name: p.name, wins: 0, points: 0, played: 0 }; });
  rounds.forEach((round, ri) => {
    round.courts.forEach((court, ci) => {
      const sc = scores[`${ri}-${ci}`];
      if (!sc?.done) return;
      const s1 = parseInt(sc.s1), s2 = parseInt(sc.s2);
      [...court.team1, ...court.team2].forEach(pid => { if (stats[players[pid]?.id]) stats[players[pid].id].played++; });
      court.team1.forEach(pid => { const p = players[pid]; if (!p || !stats[p.id]) return; stats[p.id].points += s1; if (s1 > s2) stats[p.id].wins++; });
      court.team2.forEach(pid => { const p = players[pid]; if (!p || !stats[p.id]) return; stats[p.id].points += s2; if (s2 > s1) stats[p.id].wins++; });
    });
  });
  return Object.values(stats).sort((a, b) => b.wins - a.wins || b.points - a.points);
}

const LeaderboardTable = ({ lb }: { lb: Stats[] }) => (
  <div>
    <div style={{ display: "grid", gridTemplateColumns: "32px 1fr 60px 60px 60px", gap: 6, marginBottom: 8 }}>
      {["#","Player","Wins","Pts","Played"].map(h => (
        <div key={h} style={{ fontSize: 11, fontWeight: 700, color: "#aaa", textAlign: h==="Player" ? "left" : "center" }}>{h}</div>
      ))}
    </div>
    {lb.map((p, i) => (
      <div key={p.name} style={{
        display: "grid", gridTemplateColumns: "32px 1fr 60px 60px 60px", gap: 6,
        alignItems: "center", padding: "9px 0", borderTop: `1px solid ${COLORS.gray}`,
        background: i===0 ? COLORS.yellowLight : i<3 ? COLORS.greenLight : "transparent",
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
    {lb.every(p => p.played === 0) && <div style={{ color:"#aaa", textAlign:"center", padding:20 }}>No scores yet.</div>}
  </div>
);

export default function App() {
  const [tab, setTab] = useState("Players");
  const [players, setPlayers] = useState<Player[]>([]);
  const [nameInput, setNameInput] = useState("");
  const [numCourts, setNumCourts] = useState(4);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [currentRound, setCurrentRound] = useState(0);
  const [tournamentStarted, setTournamentStarted] = useState(false);
  const [scores, setScores] = useState<Record<string, Score>>({});
  const [history, setHistory] = useState<SavedTournament[]>([]);
  const [selectedHistory, setSelectedHistory] = useState<SavedTournament | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [syncMsg, setSyncMsg] = useState("");

  // Load players and history from Firestore on mount, then listen for real-time updates
  useEffect(() => {
    setLoading(true);

    // Real-time listener for players
    const unsubPlayers = onSnapshot(doc(db, "pickleball", "players"), (snap) => {
      if (snap.exists()) {
        setPlayers(snap.data().list || []);
      }
      setLoading(false);
    }, () => setLoading(false));

    // Real-time listener for history
    const unsubHistory = onSnapshot(collection(db, "pickleball_history"), (snap) => {
      const tournaments: SavedTournament[] = [];
      snap.forEach(d => tournaments.push(d.data() as SavedTournament));
      tournaments.sort((a, b) => parseInt(b.id) - parseInt(a.id));
      setHistory(tournaments);
    });

    // Real-time listener for active tournament
    const unsubTournament = onSnapshot(doc(db, "pickleball", "activeTournament"), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (data.started) {
          setRounds(data.rounds || []);
          setScores(data.scores || {});
          setCurrentRound(data.currentRound || 0);
          setTournamentStarted(true);
          setSyncMsg("🔄 Synced");
          setTimeout(() => setSyncMsg(""), 2000);
        }
      }
    });

    return () => { unsubPlayers(); unsubHistory(); unsubTournament(); };
  }, []);

  // Save players to Firestore whenever they change
  const savePlayers = async (newPlayers: Player[]) => {
    try {
      await setDoc(doc(db, "pickleball", "players"), { list: newPlayers });
    } catch (e) { console.error(e); }
  };

  // Save active tournament state to Firestore
  const saveTournamentState = async (r: Round[], s: Record<string, Score>, cr: number) => {
    try {
      await setDoc(doc(db, "pickleball", "activeTournament"), {
        started: true, rounds: r, scores: s, currentRound: cr,
        updatedAt: Date.now()
      });
    } catch (e) { console.error(e); }
  };

  const addPlayer = async () => {
    const name = nameInput.trim();
    if (!name || players.length >= MAX_PLAYERS || players.find(p => p.name.toLowerCase() === name.toLowerCase())) return;
    const newPlayers = [...players, { name, id: Date.now() }];
    setPlayers(newPlayers);
    setNameInput("");
    await savePlayers(newPlayers);
  };

  const removePlayer = async (id: number) => {
    const newPlayers = players.filter(p => p.id !== id);
    setPlayers(newPlayers);
    await savePlayers(newPlayers);
  };

  const startTournament = async () => {
    if (players.length < 4) return;
    const newRounds = generateRounds(players, numCourts);
    const newScores = {};
    setRounds(newRounds);
    setScores(newScores);
    setCurrentRound(0);
    setTournamentStarted(true);
    setTab("Courts");
    await saveTournamentState(newRounds, newScores, 0);
  };

  const getScore = (ri: number, ci: number): Score => scores[`${ri}-${ci}`] || { s1: "", s2: "", done: false };

  const submitScore = async (ri: number, ci: number) => {
    const s = getScore(ri, ci);
    const s1 = parseInt(s.s1), s2 = parseInt(s.s2);
    if (isNaN(s1) || isNaN(s2) || s1 < 0 || s2 < 0) return;
    const newScores = { ...scores, [`${ri}-${ci}`]: { ...s, done: true } };
    setScores(newScores);
    await saveTournamentState(rounds, newScores, currentRound);
  };

  const setScoreField = async (ri: number, ci: number, field: keyof Score, val: string | boolean) => {
    const newScores = { ...scores, [`${ri}-${ci}`]: { ...getScore(ri, ci), [field]: val } };
    setScores(newScores);
  };

  const editScore = async (ri: number, ci: number) => {
    const newScores = { ...scores, [`${ri}-${ci}`]: { ...getScore(ri, ci), done: false } };
    setScores(newScores);
    await saveTournamentState(rounds, newScores, currentRound);
  };

  const goToRound = async (r: number) => {
    setCurrentRound(r);
    await saveTournamentState(rounds, scores, r);
  };

  const endTournament = async () => {
    setSaving(true);
    try {
      const lb = computeLeaderboard(players, rounds, scores);
      const tournament: SavedTournament = {
        id: Date.now().toString(),
        date: new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
        players, rounds, scores, leaderboard: lb,
      };
      await setDoc(doc(db, "pickleball_history", tournament.id), tournament);
      await setDoc(doc(db, "pickleball", "activeTournament"), { started: false });
      setTournamentStarted(false);
      setRounds([]); setScores({}); setCurrentRound(0);
      setSaveMsg("✅ Tournament saved!");
      setTimeout(() => setSaveMsg(""), 3000);
      setTab("History");
    } catch (e) { console.error(e); }
    setSaving(false);
  };

  const deleteHistory = async (id: string) => {
    try {
      await deleteDoc(doc(db, "pickleball_history", id));
      if (selectedHistory?.id === id) setSelectedHistory(null);
    } catch (e) { console.error(e); }
  };

  const roundDone = useMemo(() => {
    if (!tournamentStarted || !rounds[currentRound]) return false;
    return rounds[currentRound].courts.every((_, ci) => getScore(currentRound, ci).done);
  }, [scores, currentRound, rounds, tournamentStarted]);

  const leaderboard = useMemo<Stats[]>(() => {
    if (!tournamentStarted) return [];
    return computeLeaderboard(players, rounds, scores);
  }, [scores, rounds, players, tournamentStarted]);

  const round = tournamentStarted ? rounds[currentRound] : null;

  if (loading) return (
    <div style={{ minHeight: "100vh", background: COLORS.greenLight, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16 }}>
      <div style={{ fontSize: 40 }}>🥒</div>
      <div style={{ color: COLORS.green, fontWeight: 700, fontSize: 18 }}>Loading...</div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: COLORS.greenLight, fontFamily: "'Segoe UI', sans-serif" }}>
      {/* Header */}
      <div style={{ background: COLORS.green, padding: "14px 20px", display: "flex", alignItems: "center", gap: 12, boxShadow: "0 2px 8px #0003" }}>
        <span style={{ fontSize: 28 }}>🥒</span>
        <div>
          <div style={{ color: COLORS.yellow, fontWeight: 900, fontSize: 20, letterSpacing: 1 }}>PICKLEBALL</div>
          <div style={{ color: "#fff", fontSize: 12, fontWeight: 600, letterSpacing: 2 }}>ROUND-ROBIN MANAGER</div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          {syncMsg && <span style={{ color: COLORS.yellow, fontSize: 12 }}>{syncMsg}</span>}
          {saveMsg && <span style={{ color: COLORS.yellow, fontSize: 12 }}>{saveMsg}</span>}
          {saving && <span style={{ color: COLORS.yellow, fontSize: 12 }}>Saving...</span>}
          {tournamentStarted && (
            <Button small outline color={COLORS.yellow} textColor={COLORS.yellow} onClick={endTournament}>💾 End & Save</Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", background: COLORS.dark, justifyContent: "center" }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            flex: 1, maxWidth: 180, padding: "11px 0", border: "none", cursor: "pointer",
            background: tab === t ? COLORS.yellow : "transparent",
            color: tab === t ? COLORS.dark : "#aaa", fontWeight: 800, fontSize: 13, letterSpacing: 1,
            borderBottom: tab === t ? `3px solid ${COLORS.yellow}` : "3px solid transparent", transition: "all .15s",
          }}>
            {t.toUpperCase()}
            {t === "History" && history.length > 0 && (
              <span style={{ marginLeft: 4, background: COLORS.purple, color: "#fff", borderRadius: 10, padding: "1px 6px", fontSize: 10 }}>{history.length}</span>
            )}
          </button>
        ))}
      </div>

      <div style={{ maxWidth: 700, margin: "0 auto", padding: "20px 16px" }}>

        {/* ── PLAYERS TAB ── */}
        {tab === "Players" && (
          <div>
            <div style={{ background: "#fff", borderRadius: 12, padding: 20, boxShadow: "0 2px 8px #0001", marginBottom: 16 }}>
              <div style={{ fontWeight: 800, color: COLORS.dark, fontSize: 16, marginBottom: 12 }}>
                Add Players <Badge color={COLORS.greenMid}>{players.length}/{MAX_PLAYERS}</Badge>
                <span style={{ fontSize: 11, color: COLORS.greenMid, fontWeight: 500, marginLeft: 8 }}>🔥 Live sync</span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <input value={nameInput} onChange={e => setNameInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && addPlayer()} placeholder="Player name..." maxLength={30}
                  style={{ flex: 1, padding: "9px 14px", borderRadius: 8, border: `2px solid ${COLORS.grayMid}`, fontSize: 15, outline: "none" }} />
                <Button onClick={addPlayer} disabled={!nameInput.trim() || players.length >= MAX_PLAYERS}>+ Add</Button>
              </div>
              <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 6 }}>
                {players.length === 0 && <div style={{ color: "#aaa", textAlign: "center", padding: 20 }}>No players yet. Add up to 30!</div>}
                {players.map((p, i) => (
                  <div key={p.id} style={{ display: "flex", alignItems: "center", background: COLORS.greenLight, borderRadius: 8, padding: "7px 12px" }}>
                    <span style={{ color: COLORS.greenMid, fontWeight: 700, width: 26 }}>{i + 1}.</span>
                    <span style={{ flex: 1, fontWeight: 600, color: COLORS.dark }}>{p.name}</span>
                    {!tournamentStarted && <button onClick={() => removePlayer(p.id)} style={{ background: "none", border: "none", color: COLORS.red, cursor: "pointer", fontSize: 18 }}>×</button>}
                  </div>
                ))}
              </div>
            </div>

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
                      color: numCourts === n ? "#fff" : COLORS.dark, fontWeight: 700, cursor: "pointer"
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
            {!tournamentStarted || !round ? (
              <div style={{ textAlign: "center", color: "#888", padding: 40 }}>Set up players first, then start the tournament.</div>
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                  <Button small outline color={COLORS.green} onClick={() => goToRound(Math.max(0, currentRound-1))} disabled={currentRound === 0}>← Prev</Button>
                  <div style={{ fontWeight: 800, color: COLORS.dark, fontSize: 17 }}>
                    Round {currentRound + 1} <span style={{ color: "#aaa", fontWeight: 400, fontSize: 13 }}>of {rounds.length}</span>
                  </div>
                  <Button small outline color={COLORS.green} onClick={() => goToRound(Math.min(rounds.length-1, currentRound+1))} disabled={currentRound === rounds.length-1}>Next →</Button>
                </div>

                {round.sitOuts.length > 0 && (
                  <div style={{ background: COLORS.yellowLight, border: `1px solid ${COLORS.yellow}`, borderRadius: 10, padding: "8px 14px", marginBottom: 14, fontSize: 13, color: COLORS.dark }}>
                    <strong>Sitting out:</strong> {round.sitOuts.map(i => players[i]?.name).join(", ")}
                  </div>
                )}

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
                        <div style={{ background: winner===1?COLORS.greenLight:COLORS.gray, borderRadius: 10, padding: "10px 14px", border: winner===1?`2px solid ${COLORS.greenMid}`:"2px solid transparent" }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.greenMid, marginBottom: 4 }}>TEAM 1</div>
                          {court.team1.map(pi => <div key={pi} style={{ fontWeight: 600, color: COLORS.dark, fontSize: 14 }}>{players[pi]?.name}</div>)}
                        </div>
                        <div style={{ textAlign: "center", fontWeight: 900, color: COLORS.grayMid, fontSize: 16 }}>VS</div>
                        <div style={{ background: winner===2?COLORS.greenLight:COLORS.gray, borderRadius: 10, padding: "10px 14px", border: winner===2?`2px solid ${COLORS.greenMid}`:"2px solid transparent" }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.greenMid, marginBottom: 4 }}>TEAM 2</div>
                          {court.team2.map(pi => <div key={pi} style={{ fontWeight: 600, color: COLORS.dark, fontSize: 14 }}>{players[pi]?.name}</div>)}
                        </div>
                      </div>
                      <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10, justifyContent: "center" }}>
                        {sc.done ? (
                          <>
                            <div style={{ fontWeight: 900, fontSize: 22, color: COLORS.dark }}>{sc.s1} — {sc.s2}</div>
                            <Button small outline color={COLORS.blue} onClick={() => editScore(currentRound, ci)}>Edit</Button>
                          </>
                        ) : (
                          <>
                            <input type="number" min={0} max={25} value={sc.s1}
                              onChange={e => setScoreField(currentRound, ci, "s1", e.target.value)} placeholder="T1"
                              style={{ width: 56, padding: "7px 10px", borderRadius: 8, border: `2px solid ${COLORS.grayMid}`, fontSize: 18, fontWeight: 700, textAlign: "center" }} />
                            <span style={{ fontWeight: 900, color: "#aaa" }}>—</span>
                            <input type="number" min={0} max={25} value={sc.s2}
                              onChange={e => setScoreField(currentRound, ci, "s2", e.target.value)} placeholder="T2"
                              style={{ width: 56, padding: "7px 10px", borderRadius: 8, border: `2px solid ${COLORS.grayMid}`, fontSize: 18, fontWeight: 700, textAlign: "center" }} />
                            <Button small onClick={() => submitScore(currentRound, ci)} disabled={sc.s1===""||sc.s2===""} color={COLORS.green}>✓ Save</Button>
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
                      ? <Button onClick={() => goToRound(currentRound+1)} color={COLORS.yellow} textColor={COLORS.dark}>Next Round →</Button>
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
              <div style={{ textAlign: "center", color: "#888", padding: 40 }}>Start a tournament to see standings.</div>
            ) : (
              <div style={{ background: "#fff", borderRadius: 12, padding: 20, boxShadow: "0 2px 8px #0001" }}>
                <div style={{ fontWeight: 800, color: COLORS.dark, fontSize: 17, marginBottom: 14 }}>🏆 Current Standings</div>
                <LeaderboardTable lb={leaderboard} />
                <div style={{ marginTop: 20, textAlign: "center" }}>
                  <Button onClick={endTournament} color={COLORS.purple}>💾 End Tournament & Save to History</Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── HISTORY TAB ── */}
        {tab === "History" && (
          <div>
            {selectedHistory ? (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                  <Button small outline color={COLORS.green} onClick={() => setSelectedHistory(null)}>← Back</Button>
                  <div style={{ fontWeight: 800, color: COLORS.dark, fontSize: 16 }}>📅 {selectedHistory.date}</div>
                </div>
                <div style={{ background: "#fff", borderRadius: 12, padding: 20, boxShadow: "0 2px 8px #0001", marginBottom: 16 }}>
                  <div style={{ fontWeight: 800, color: COLORS.dark, fontSize: 15, marginBottom: 12 }}>🏆 Final Standings</div>
                  <LeaderboardTable lb={selectedHistory.leaderboard} />
                </div>
                <div style={{ background: "#fff", borderRadius: 12, padding: 20, boxShadow: "0 2px 8px #0001" }}>
                  <div style={{ fontWeight: 800, color: COLORS.dark, fontSize: 15, marginBottom: 12 }}>👥 Players ({selectedHistory.players.length})</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {selectedHistory.players.map(p => (
                      <span key={p.id} style={{ background: COLORS.greenLight, color: COLORS.dark, borderRadius: 20, padding: "4px 14px", fontSize: 13, fontWeight: 600 }}>{p.name}</span>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <div style={{ fontWeight: 800, color: COLORS.dark, fontSize: 17 }}>📚 Tournament History</div>
                  <Badge color={COLORS.purple}>{history.length} saved</Badge>
                </div>
                {history.length === 0 ? (
                  <div style={{ background: "#fff", borderRadius: 12, padding: 40, textAlign: "center", color: "#aaa", boxShadow: "0 2px 8px #0001" }}>
                    No tournaments saved yet.<br /><span style={{ fontSize: 13 }}>End a tournament to save it here.</span>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {history.map(t => (
                      <div key={t.id} style={{ background: "#fff", borderRadius: 12, padding: 18, boxShadow: "0 2px 8px #0001", borderLeft: `5px solid ${COLORS.purple}` }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                          <div>
                            <div style={{ fontWeight: 800, color: COLORS.dark, fontSize: 15 }}>📅 {t.date}</div>
                            <div style={{ color: "#888", fontSize: 13, marginTop: 2 }}>{t.players.length} players · {t.rounds.length} rounds</div>
                          </div>
                          <div style={{ display: "flex", gap: 8 }}>
                            <Button small outline color={COLORS.green} onClick={() => setSelectedHistory(t)}>View</Button>
                            <Button small outline color={COLORS.red} onClick={() => deleteHistory(t.id)}>Delete</Button>
                          </div>
                        </div>
                        {t.leaderboard.slice(0, 3).map((p, i) => (
                          <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginTop: 4 }}>
                            <span>{i===0?"🥇":i===1?"🥈":"🥉"}</span>
                            <span style={{ fontWeight: 700, color: COLORS.dark }}>{p.name}</span>
                            <span style={{ color: "#888" }}>{p.wins}W · {p.points}pts</span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}