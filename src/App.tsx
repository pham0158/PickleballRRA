import { useState, useMemo, useEffect, useCallback } from "react";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, collection, deleteDoc, onSnapshot } from "firebase/firestore";

// EmailJS config
const EMAILJS_SERVICE_ID  = "service_5tdfzpt";
const EMAILJS_TEMPLATE_ID = "template_dtkmdlr";
const EMAILJS_PUBLIC_KEY  = "HAsGlq5KZDk4pD8fz";
const FEEDBACK_EMAIL      = "gogreenvue@gmail.com";

async function sendFeedbackEmail(params: {
  subject: string; type: string; rating: string;
  from_name: string; version: string; sent_at: string; message: string;
}): Promise<boolean> {
  try {
    const res = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service_id: EMAILJS_SERVICE_ID,
        template_id: EMAILJS_TEMPLATE_ID,
        user_id: EMAILJS_PUBLIC_KEY,
        template_params: {
          email:     FEEDBACK_EMAIL,
          subject:   params.subject,
          type:      params.type,
          rating:    params.rating,
          from_name: params.from_name,
          version:   params.version,
          sent_at:   params.sent_at,
          message:   params.message,
        },
      }),
    });
    return res.ok;
  } catch { return false; }
}

interface FeedbackEntry {
  id: string;
  type: "bug" | "feature" | "general";
  rating: number;        // 0 = no rating
  message: string;
  name: string;          // optional submitter name
  version: string;
  submittedAt: string;
}

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

// ── COLOR THEMES ──────────────────────────────────────────────────────────────
// Normal group colors
const GROUP_COLORS_NORMAL   = ["#2d6a2d","#2980b9","#8e44ad","#c0392b","#d35400","#16a085","#2c3e50","#b7950b"];
// Deuteranopia-safe: avoids red/green confusion — uses blue/orange/purple/teal
const GROUP_COLORS_DEUTER   = ["#0077bb","#ee7733","#aa3377","#009988","#33bbee","#cc3311","#332288","#ee3377"];
// High contrast: bold, thick, no transparency
const GROUP_COLORS_HC       = ["#005fcc","#c45000","#6600aa","#007755","#004488","#aa0000","#555500","#880044"];

type ColorMode = "normal" | "deuteranopia" | "highcontrast";

function getGroupColors(mode: ColorMode) {
  if (mode === "deuteranopia") return GROUP_COLORS_DEUTER;
  if (mode === "highcontrast") return GROUP_COLORS_HC;
  return GROUP_COLORS_NORMAL;
}

// Theme palettes
const THEMES: Record<ColorMode, typeof C_BASE> = {
  normal: {
    green: "#2d6a2d", greenMid: "#4a9e4a", greenLight: "#e8f5e8",
    yellow: "#f5c518", yellowLight: "#fffbe6", dark: "#1a3a1a",
    gray: "#f0f0f0", grayMid: "#ccc", red: "#c0392b",
    blue: "#2980b9", purple: "#8e44ad", orange: "#d35400",
  },
  deuteranopia: {
    green: "#0077bb", greenMid: "#33bbee", greenLight: "#e0f4ff",
    yellow: "#ee7733", yellowLight: "#fff3e0", dark: "#001133",
    gray: "#f0f0f0", grayMid: "#bbb", red: "#cc3311",
    blue: "#0077bb", purple: "#aa3377", orange: "#ee7733",
  },
  highcontrast: {
    green: "#005fcc", greenMid: "#0080ff", greenLight: "#e0eeff",
    yellow: "#ffcc00", yellowLight: "#fff8cc", dark: "#000000",
    gray: "#e0e0e0", grayMid: "#999", red: "#cc0000",
    blue: "#005fcc", purple: "#6600aa", orange: "#c45000",
  },
};
// C_BASE type helper (unused at runtime, just for type inference)
const C_BASE = THEMES.normal;
// Default C — gets replaced via React state in the App component
let C = THEMES.normal;

const COLOR_MODE_LABELS: Record<ColorMode, string> = {
  normal:       "🎨 Normal",
  deuteranopia: "👁 Deuteranopia",
  highcontrast: "⚡ High Contrast",
};

// Simple hash for password (not cryptographic, just obfuscation for privacy)
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return hash.toString(36);
}

interface Player { name: string; id: string; }
interface Court { courtNum: number; team1: string[]; team2: string[]; }

// A SubRound is a mini-game generated mid-round for a specific court
interface SubRound {
  id: string;           // e.g. "r2_sub1"
  parentRoundIdx: number;
  subLabel: string;     // e.g. "2a", "2b"
  court: Court;
  sitOuts: string[];    // players who sit this sub-round
}

interface Round {
  courts: Court[];
  sitOuts: string[];
  roundNum: number;
  subRounds?: SubRound[];
}

interface Score { s1: string; s2: string; done: boolean; }
interface Stats { id: string; name: string; wins: number; points: number; played: number; }

interface TournamentState {
  started: boolean;
  rounds: Round[];
  scores: Record<string, Score>;
  currentRound: number;
  subScores: Record<string, Score>; // keyed by subRound.id
}

interface Group {
  id: string;
  name: string;
  location: string;
  color: string;
  players: Player[];
  numCourts: number;
  isPrivate: boolean;
  passwordHash?: string;
  colorMode?: ColorMode;  // per-group override
  tournament?: TournamentState;
}

interface SavedTournament {
  id: string; date: string; groupId: string; groupName: string; location: string;
  isPrivate: boolean;
  players: Player[]; rounds: Round[]; scores: Record<string,Score>;
  subScores: Record<string,Score>;
  leaderboard: Stats[];
}

// ── PARTNER-AWARE ROUND GENERATION ─────────────────────────────────────────
const pk = (a: string, b: string) => a < b ? `${a}|${b}` : `${b}|${a}`;
const incMap = (map: Record<string,number>, a: string, b: string) => { const k=pk(a,b); map[k]=(map[k]||0)+1; };
const getMap = (map: Record<string,number>, a: string, b: string) => map[pk(a,b)]||0;

function scoreAssignment(
  t1: [string,string], t2: [string,string],
  partnerCount: Record<string,number>, opponentCount: Record<string,number>
): number {
  return getMap(partnerCount, t1[0], t1[1]) * 4 +
         getMap(partnerCount, t2[0], t2[1]) * 4 +
         getMap(opponentCount, t1[0], t2[0]) +
         getMap(opponentCount, t1[0], t2[1]) +
         getMap(opponentCount, t1[1], t2[0]) +
         getMap(opponentCount, t1[1], t2[1]);
}

function bestCourtFromPool(
  pool: string[], courtNum: number,
  partnerCount: Record<string,number>, opponentCount: Record<string,number>
): Court | null {
  const candidates = pool.slice(0, Math.min(8, pool.length));
  let bestScore = Infinity;
  let bestCourt: Court | null = null;
  for (let i = 0; i < candidates.length - 3; i++) {
    for (let j = i+1; j < candidates.length - 2; j++) {
      for (let k = j+1; k < candidates.length - 1; k++) {
        for (let l = k+1; l < candidates.length; l++) {
          const four = [candidates[i], candidates[j], candidates[k], candidates[l]];
          const splits: [[string,string],[string,string]][] = [
            [[four[0],four[1]],[four[2],four[3]]],
            [[four[0],four[2]],[four[1],four[3]]],
            [[four[0],four[3]],[four[1],four[2]]],
          ];
          for (const [t1,t2] of splits) {
            const s = scoreAssignment(t1, t2, partnerCount, opponentCount);
            if (s < bestScore) {
              bestScore = s;
              bestCourt = { courtNum, team1: [t1[0],t1[1]], team2: [t2[0],t2[1]] };
            }
          }
        }
      }
    }
  }
  return bestCourt;
}

function generateRounds(players: Player[], numCourts: number): Round[] {
  const n = players.length;
  if (n < 4) return [];
  const activeCourts = Math.min(Math.floor(n / 4), numCourts);
  const sitOutCount = n - activeCourts * 4;
  const totalRounds = Math.max(n % 2 === 0 ? n - 1 : n, 10);
  const ids = players.map(p => p.id);

  const partnerCount: Record<string, number> = {};
  const opponentCount: Record<string, number> = {};
  const sitCounts: Record<string, number> = {};
  ids.forEach(id => { sitCounts[id] = 0; });

  const rounds: Round[] = [];

  for (let r = 0; r < totalRounds; r++) {
    let sitOuts: string[] = [];
    if (sitOutCount > 0) {
      sitOuts = [...ids].sort((a,b) => sitCounts[a]-sitCounts[b] || Math.random()-0.5).slice(0, sitOutCount);
    }
    const active = ids.filter(id => !sitOuts.includes(id));
    const shuffled = [...active].sort(() => Math.random() - 0.5);
    const used = new Set<string>();
    const courts: Court[] = [];

    for (let c = 0; c < activeCourts; c++) {
      const avail = shuffled.filter(id => !used.has(id));
      if (avail.length < 4) break;
      const court = bestCourtFromPool(avail, c+1, partnerCount, opponentCount)
        || { courtNum: c+1, team1: [avail[0],avail[1]], team2: [avail[2],avail[3]] };
      [...court.team1, ...court.team2].forEach(id => used.add(id));
      courts.push(court);
      incMap(partnerCount, court.team1[0], court.team1[1]);
      incMap(partnerCount, court.team2[0], court.team2[1]);
      for (const a of court.team1) for (const b of court.team2) incMap(opponentCount, a, b);
    }

    sitOuts.forEach(id => { sitCounts[id]++; });
    rounds.push({ courts, sitOuts, roundNum: r + 1, subRounds: [] });
  }
  return rounds;
}

// ── GENERATE A SUB-ROUND for a specific finished court ─────────────────────
// availablePlayers = sit-outs + players from the finished court
// courtNum = the court number being re-used
// existing partnerCount/opponentCount built from all completed play so far
function generateSubRound(
  availablePlayers: string[],
  allPlayers: string[],
  courtNum: number,
  parentRoundIdx: number,
  subLabel: string,
  partnerCount: Record<string,number>,
  opponentCount: Record<string,number>
): SubRound | null {
  if (availablePlayers.length < 4) return null;
  const shuffled = [...availablePlayers].sort(() => Math.random() - 0.5);
  const court = bestCourtFromPool(shuffled, courtNum, partnerCount, opponentCount);
  if (!court) return null;
  const playing = new Set([...court.team1, ...court.team2]);
  const sitOuts = allPlayers.filter(id => !playing.has(id) && availablePlayers.includes(id));
  return {
    id: `r${parentRoundIdx}_sub_${Date.now()}`,
    parentRoundIdx,
    subLabel,
    court,
    sitOuts,
  };
}

// Build partnerCount/opponentCount from all completed games so far
function buildPairHistory(
  rounds: Round[], scores: Record<string,Score>, subScores: Record<string,Score>
): { partnerCount: Record<string,number>; opponentCount: Record<string,number> } {
  const partnerCount: Record<string,number> = {};
  const opponentCount: Record<string,number> = {};
  rounds.forEach((round, ri) => {
    round.courts.forEach((court, ci) => {
      if (!scores[`${ri}-${ci}`]?.done) return;
      incMap(partnerCount, court.team1[0], court.team1[1]);
      incMap(partnerCount, court.team2[0], court.team2[1]);
      for (const a of court.team1) for (const b of court.team2) incMap(opponentCount, a, b);
    });
    (round.subRounds||[]).forEach(sub => {
      if (!subScores[sub.id]?.done) return;
      incMap(partnerCount, sub.court.team1[0], sub.court.team1[1]);
      incMap(partnerCount, sub.court.team2[0], sub.court.team2[1]);
      for (const a of sub.court.team1) for (const b of sub.court.team2) incMap(opponentCount, a, b);
    });
  });
  return { partnerCount, opponentCount };
}

// ── LEADERBOARD ──────────────────────────────────────────────────────────────
function computeLeaderboard(
  players: Player[], rounds: Round[],
  scores: Record<string,Score>, subScores: Record<string,Score>
): Stats[] {
  const stats: Record<string, Stats> = {};
  players.forEach(p => { stats[p.id] = { id:p.id, name:p.name, wins:0, points:0, played:0 }; });

  rounds.forEach((round, ri) => {
    round.courts.forEach((court, ci) => {
      const sc = scores[`${ri}-${ci}`];
      if (!sc?.done) return;
      const s1 = parseInt(sc.s1), s2 = parseInt(sc.s2);
      [...court.team1,...court.team2].forEach(id => { if(stats[id]) stats[id].played++; });
      court.team1.forEach(id => { if(!stats[id]) return; stats[id].points+=s1; if(s1>s2) stats[id].wins++; });
      court.team2.forEach(id => { if(!stats[id]) return; stats[id].points+=s2; if(s2>s1) stats[id].wins++; });
    });
    (round.subRounds||[]).forEach(sub => {
      const sc = subScores[sub.id];
      if (!sc?.done) return;
      const s1 = parseInt(sc.s1), s2 = parseInt(sc.s2);
      [...sub.court.team1,...sub.court.team2].forEach(id => { if(stats[id]) stats[id].played++; });
      sub.court.team1.forEach(id => { if(!stats[id]) return; stats[id].points+=s1; if(s1>s2) stats[id].wins++; });
      sub.court.team2.forEach(id => { if(!stats[id]) return; stats[id].points+=s2; if(s2>s1) stats[id].wins++; });
    });
  });

  return Object.values(stats).sort((a,b) => b.wins-a.wins || b.points-a.points);
}

// ── UI COMPONENTS ─────────────────────────────────────────────────────────────
function Btn({ onClick, color=C.green, textColor="#fff", children, small=false, disabled=false, outline=false, full=false }: {
  onClick?: ()=>void; color?: string; textColor?: string; children: React.ReactNode;
  small?: boolean; disabled?: boolean; outline?: boolean; full?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background: outline?"transparent":disabled?C.grayMid:color,
      color: outline?color:textColor, border: outline?`2px solid ${color}`:"none",
      borderRadius:8, padding:small?"5px 12px":"9px 20px", fontWeight:700,
      fontSize:small?13:15, cursor:disabled?"not-allowed":"pointer",
      opacity:disabled?0.6:1, transition:"opacity .15s", width:full?"100%":"auto",
    }}>{children}</button>
  );
}

function Badge({ color, children }: { color: string; children: React.ReactNode }) {
  return <span style={{ background:color, color:"#fff", borderRadius:8, padding:"2px 10px", fontSize:12, fontWeight:700 }}>{children}</span>;
}

const LeaderboardTable = ({ lb }: { lb: Stats[] }) => (
  <div>
    <div style={{ display:"grid", gridTemplateColumns:"32px 1fr 60px 60px 60px", gap:6, marginBottom:8 }}>
      {["#","Player","Wins","Pts","Played"].map(h=>(
        <div key={h} style={{ fontSize:11, fontWeight:700, color:"#aaa", textAlign:h==="Player"?"left":"center" }}>{h}</div>
      ))}
    </div>
    {lb.map((p,i)=>(
      <div key={p.id} style={{
        display:"grid", gridTemplateColumns:"32px 1fr 60px 60px 60px", gap:6,
        alignItems:"center", padding:"9px 0", borderTop:`1px solid ${C.gray}`,
        background:i===0?C.yellowLight:i<3?C.greenLight:"transparent",
        borderRadius:8, paddingLeft:8
      }}>
        <div style={{ fontWeight:900, color:i===0?C.yellow:i<3?C.greenMid:"#aaa", textAlign:"center" }}>
          {i===0?"🥇":i===1?"🥈":i===2?"🥉":i+1}
        </div>
        <div style={{ fontWeight:700, color:C.dark }}>{p.name}</div>
        <div style={{ textAlign:"center", fontWeight:700, color:C.green }}>{p.wins}</div>
        <div style={{ textAlign:"center", color:"#555" }}>{p.points}</div>
        <div style={{ textAlign:"center", color:"#aaa", fontSize:13 }}>{p.played}</div>
      </div>
    ))}
    {lb.every(p=>p.played===0)&&<div style={{ color:"#aaa", textAlign:"center", padding:20 }}>No scores yet.</div>}
  </div>
);

// ── SCORE CARD ────────────────────────────────────────────────────────────────
function CourtCard({
  court, scoreKey, scores, groupColor, label, onScoreChange, onSubmit, onEdit,
  showRegenerate, onRegenerate, isSubRound = false,
}: {
  court: Court; scoreKey: string; scores: Record<string,Score>; groupColor: string;
  label: string; onScoreChange: (key: string, field: "s1"|"s2", val: string)=>void;
  onSubmit: (key: string)=>void; onEdit: (key: string)=>void;
  showRegenerate?: boolean; onRegenerate?: ()=>void; isSubRound?: boolean;
}) {
  const sc = scores[scoreKey]||{s1:"",s2:"",done:false};
  const winner = sc.done?(parseInt(sc.s1)>parseInt(sc.s2)?1:2):null;
  return (
    <div style={{
      background:"#fff", borderRadius:12, padding:16, marginBottom:12,
      boxShadow:"0 2px 8px #0001",
      borderLeft:`5px solid ${isSubRound ? C.orange : groupColor}`,
      opacity: isSubRound ? 1 : 1,
    }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <div style={{ fontWeight:800, color: isSubRound?C.orange:groupColor, fontSize:14 }}>
            🏓 {label}
          </div>
          {isSubRound && <Badge color={C.orange}>⚡ Extra</Badge>}
        </div>
        <div style={{ display:"flex", gap:6, alignItems:"center" }}>
          {sc.done && showRegenerate && onRegenerate && (
            <button onClick={onRegenerate} title="Generate next game for this court" style={{
              background:C.yellowLight, border:`1px solid ${C.yellow}`, borderRadius:8,
              padding:"4px 10px", cursor:"pointer", fontSize:12, fontWeight:700, color:C.dark,
            }}>⚡ Next Game</button>
          )}
          {sc.done&&<Badge color={C.greenMid}>✓ Done</Badge>}
        </div>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr auto 1fr", gap:8, alignItems:"center" }}>
        <div style={{ background:winner===1?C.greenLight:C.gray, borderRadius:10, padding:"10px 12px", border:winner===1?`2px solid ${C.greenMid}`:"2px solid transparent" }}>
          <div style={{ fontSize:10, fontWeight:700, color:C.greenMid, marginBottom:4 }}>TEAM 1</div>
          {court.team1.map(id=><div key={id} style={{ fontWeight:600, color:C.dark, fontSize:13 }}>{id}</div>)}
        </div>
        <div style={{ textAlign:"center", fontWeight:900, color:"#ccc" }}>VS</div>
        <div style={{ background:winner===2?C.greenLight:C.gray, borderRadius:10, padding:"10px 12px", border:winner===2?`2px solid ${C.greenMid}`:"2px solid transparent" }}>
          <div style={{ fontSize:10, fontWeight:700, color:C.greenMid, marginBottom:4 }}>TEAM 2</div>
          {court.team2.map(id=><div key={id} style={{ fontWeight:600, color:C.dark, fontSize:13 }}>{id}</div>)}
        </div>
      </div>
      <div style={{ marginTop:12, display:"flex", alignItems:"center", gap:8, justifyContent:"center" }}>
        {sc.done?(
          <>
            <div style={{ fontWeight:900, fontSize:20, color:C.dark }}>{sc.s1} — {sc.s2}</div>
            <Btn small outline color={C.blue} onClick={()=>onEdit(scoreKey)}>Edit</Btn>
          </>
        ):(
          <>
            <input type="number" min={0} max={25} value={sc.s1}
              onChange={e=>onScoreChange(scoreKey,"s1",e.target.value)}
              placeholder="T1" style={{ width:52, padding:"6px 8px", borderRadius:8, border:`2px solid ${C.grayMid}`, fontSize:17, fontWeight:700, textAlign:"center" }}/>
            <span style={{ fontWeight:900, color:"#aaa" }}>—</span>
            <input type="number" min={0} max={25} value={sc.s2}
              onChange={e=>onScoreChange(scoreKey,"s2",e.target.value)}
              placeholder="T2" style={{ width:52, padding:"6px 8px", borderRadius:8, border:`2px solid ${C.grayMid}`, fontSize:17, fontWeight:700, textAlign:"center" }}/>
            <Btn small onClick={()=>onSubmit(scoreKey)} disabled={sc.s1===""||sc.s2===""} color={C.green}>✓</Btn>
          </>
        )}
      </div>
    </div>
  );
}

// ── TOURNAMENT VIEW ───────────────────────────────────────────────────────────
function TournamentView({ group, onEnd }: { group: Group; onEnd: ()=>void }) {
  const t = group.tournament!;
  const [currentRound, setCurrentRound] = useState(t.currentRound||0);
  const [scores, setScores] = useState<Record<string,Score>>(t.scores||{});
  const [subScores, setSubScores] = useState<Record<string,Score>>(t.subScores||{});
  const [activeTab, setActiveTab] = useState<"courts"|"standings">("courts");
  const players = group.players;
  const nameOf = useCallback((id: string) => players.find(p=>p.id===id)?.name||"?", [players]);

  useEffect(()=>{ setCurrentRound(t.currentRound||0); },[t.currentRound]);
  useEffect(()=>{ setScores(t.scores||{}); },[JSON.stringify(t.scores)]);
  useEffect(()=>{ setSubScores(t.subScores||{}); },[JSON.stringify(t.subScores)]);

  const saveState = async (
    ns: Record<string,Score>, nss: Record<string,Score>,
    cr: number, rounds?: Round[]
  ) => {
    await setDoc(doc(db,"pb3_groups",group.id),{
      ...group,
      tournament:{
        started:true,
        rounds: rounds||t.rounds,
        scores:ns,
        subScores:nss,
        currentRound:cr,
      }
    });
  };

  const handleScoreChange = (key: string, field: "s1"|"s2", val: string) => {
    if (key.startsWith("r")) {
      setSubScores(prev=>({...prev,[key]:{...(prev[key]||{s1:"",s2:"",done:false}),[field]:val}}));
    } else {
      setScores(prev=>({...prev,[key]:{...(prev[key]||{s1:"",s2:"",done:false}),[field]:val}}));
    }
  };

  const submitScore = async (key: string) => {
    if (key.startsWith("r")) {
      const sc = subScores[key]||{s1:"",s2:"",done:false};
      if (sc.s1===""||sc.s2==="") return;
      const nss = {...subScores, [key]:{...sc, done:true}};
      setSubScores(nss);
      await saveState(scores, nss, currentRound);
    } else {
      const sc = scores[key]||{s1:"",s2:"",done:false};
      if (sc.s1===""||sc.s2==="") return;
      const ns = {...scores, [key]:{...sc, done:true}};
      setScores(ns);
      await saveState(ns, subScores, currentRound);
    }
  };

  const editScore = async (key: string) => {
    if (key.startsWith("r")) {
      const nss = {...subScores, [key]:{...(subScores[key]||{s1:"",s2:"",done:false}), done:false}};
      setSubScores(nss);
      await saveState(scores, nss, currentRound);
    } else {
      const ns = {...scores, [key]:{...(scores[key]||{s1:"",s2:"",done:false}), done:false}};
      setScores(ns);
      await saveState(ns, subScores, currentRound);
    }
  };

  const goRound = async (r: number) => {
    setCurrentRound(r);
    await saveState(scores, subScores, r);
  };

  // Regenerate a sub-round for a finished court
  const handleRegenerate = async (courtIdx: number, courtNum: number) => {
    const round = t.rounds[currentRound];
    const roundScoreKey = `${currentRound}-${courtIdx}`;
    if (!scores[roundScoreKey]?.done) return;

    // Players available: sit-outs from this round + players from THIS finished court
    const finishedCourtPlayers = [
      ...round.courts[courtIdx].team1,
      ...round.courts[courtIdx].team2
    ];
    const sitOutPlayers = round.sitOuts;
    const availablePlayers = [...new Set([...finishedCourtPlayers, ...sitOutPlayers])];

    // Also check if any sub-rounds for this court are done — if so, include their sit-outs too
    const existingSubsForCourt = (round.subRounds||[]).filter(
      s => s.parentRoundIdx === currentRound
    );
    // Count how many subs exist for labeling
    const subCount = existingSubsForCourt.length;
    const subLabel = `${round.roundNum}${"abcdefghijklmnop"[subCount]}`;

    const { partnerCount, opponentCount } = buildPairHistory(t.rounds, scores, subScores);

    const allIds = players.map(p=>p.id);
    const sub = generateSubRound(
      availablePlayers, allIds, courtNum, currentRound, subLabel, partnerCount, opponentCount
    );
    if (!sub) return;

    // Attach sub to this round
    const updatedRounds = t.rounds.map((rnd, ri) => {
      if (ri !== currentRound) return rnd;
      return { ...rnd, subRounds: [...(rnd.subRounds||[]), sub] };
    });

    await saveState(scores, subScores, currentRound, updatedRounds);
  };

  const round = t.rounds[currentRound];
  const roundSubRounds = (round?.subRounds||[]).filter(s=>s.parentRoundIdx===currentRound);
  const roundDone = round?.courts.every((_,ci)=>scores[`${currentRound}-${ci}`]?.done);
  const leaderboard = useMemo(()=>computeLeaderboard(players,t.rounds,scores,subScores),[scores,subScores,t.rounds,players]);

  // Replace player IDs with names in courts for display
  const displayCourt = (court: Court): Court => ({
    ...court,
    team1: court.team1.map(nameOf),
    team2: court.team2.map(nameOf),
  });

  return (
    <div>
      <div style={{ display:"flex", background:C.dark, borderRadius:10, marginBottom:16, overflow:"hidden" }}>
        {(["courts","standings"] as const).map(tab=>(
          <button key={tab} onClick={()=>setActiveTab(tab)} style={{
            flex:1, padding:"10px 0", border:"none", cursor:"pointer",
            background:activeTab===tab?group.color:"transparent",
            color:activeTab===tab?"#fff":"#aaa", fontWeight:800, fontSize:13, letterSpacing:1
          }}>{tab==="courts"?"🏓 Courts":"🏆 Standings"}</button>
        ))}
      </div>

      {activeTab==="courts" && round && (
        <>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
            <Btn small outline color={group.color} onClick={()=>goRound(Math.max(0,currentRound-1))} disabled={currentRound===0}>← Prev</Btn>
            <div style={{ fontWeight:800, color:C.dark, fontSize:16 }}>
              Round {round.roundNum}
              <span style={{ color:"#aaa", fontWeight:400, fontSize:12 }}> of {t.rounds.length}</span>
            </div>
            <Btn small outline color={group.color} onClick={()=>goRound(Math.min(t.rounds.length-1,currentRound+1))} disabled={currentRound===t.rounds.length-1}>Next →</Btn>
          </div>

          {round.sitOuts.length>0 && (
            <div style={{ background:C.yellowLight, border:`1px solid ${C.yellow}`, borderRadius:10, padding:"8px 14px", marginBottom:12, fontSize:13 }}>
              <strong>Sitting out:</strong> {round.sitOuts.map(nameOf).join(", ")}
            </div>
          )}

          {/* Main courts */}
          {round.courts.map((court,ci)=>(
            <CourtCard
              key={ci}
              court={displayCourt(court)}
              scoreKey={`${currentRound}-${ci}`}
              scores={scores}
              groupColor={group.color}
              label={`Court ${court.courtNum}`}
              onScoreChange={handleScoreChange}
              onSubmit={submitScore}
              onEdit={editScore}
              showRegenerate={true}
              onRegenerate={()=>handleRegenerate(ci, court.courtNum)}
            />
          ))}

          {/* Sub-rounds */}
          {roundSubRounds.length>0 && (
            <div style={{ marginTop:4, marginBottom:8 }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
                <div style={{ height:1, flex:1, background:`${C.orange}44` }}/>
                <span style={{ fontSize:12, fontWeight:700, color:C.orange, letterSpacing:1 }}>⚡ EXTRA GAMES</span>
                <div style={{ height:1, flex:1, background:`${C.orange}44` }}/>
              </div>
              {roundSubRounds.map(sub=>(
                <CourtCard
                  key={sub.id}
                  court={displayCourt(sub.court)}
                  scoreKey={sub.id}
                  scores={subScores}
                  groupColor={group.color}
                  label={`Court ${sub.court.courtNum} — Round ${sub.subLabel}`}
                  onScoreChange={handleScoreChange}
                  onSubmit={submitScore}
                  onEdit={editScore}
                  isSubRound={true}
                />
              ))}
            </div>
          )}

          {roundDone&&(
            <div style={{ textAlign:"center", marginTop:8 }}>
              <div style={{ color:C.green, fontWeight:700, marginBottom:8 }}>✅ Round {round.roundNum} complete!</div>
              {currentRound<t.rounds.length-1
                ?<Btn onClick={()=>goRound(currentRound+1)} color={C.yellow} textColor={C.dark}>Next Round →</Btn>
                :<Btn onClick={()=>setActiveTab("standings")} color={C.yellow} textColor={C.dark}>🏆 Final Standings</Btn>
              }
            </div>
          )}
        </>
      )}

      {activeTab==="standings"&&(
        <div style={{ background:"#fff", borderRadius:12, padding:18, boxShadow:"0 2px 8px #0001" }}>
          <LeaderboardTable lb={leaderboard}/>
          <div style={{ marginTop:16, textAlign:"center" }}>
            <Btn onClick={onEnd} color={C.purple}>💾 End & Save Tournament</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

// ── FEEDBACK MODAL ────────────────────────────────────────────────────────────
const FEEDBACK_TYPES = [
  { key: "bug",     label: "🐛 Bug / Error",        color: C.red },
  { key: "feature", label: "💡 Feature Request",    color: C.blue },
  { key: "general", label: "💬 General Feedback",   color: C.green },
] as const;

function FeedbackModal({ onClose }: { onClose: ()=>void }) {
  const [type, setType] = useState<"bug"|"feature"|"general">("general");
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [message, setMessage] = useState("");
  const [name, setName] = useState("");
  const [status, setStatus] = useState<"idle"|"sending"|"done"|"error">("idle");

  const submit = async () => {
    if (!message.trim()) return;
    setStatus("sending");
    const entry: FeedbackEntry = {
      id: `fb_${Date.now()}`,
      type, rating, message: message.trim(), name: name.trim(),
      version: "v3",
      submittedAt: new Date().toISOString(),
    };

    // 1. Save to Firebase
    try {
      await setDoc(doc(db, "pb3_feedback", entry.id), entry);
    } catch (e) { console.error("Firebase feedback error:", e); }

    // 2. Send email notification
    const typeLabel = FEEDBACK_TYPES.find(t=>t.key===type)?.label || type;
    const emailOk = await sendFeedbackEmail({
      subject:   `[Pickleball V3] ${typeLabel}${rating>0?` — ${rating}/5 stars`:""}`,
      type:      typeLabel,
      rating:    rating > 0 ? `${"⭐".repeat(rating)} (${rating}/5)` : "Not rated",
      from_name: name.trim() || "Anonymous",
      version:   "V3",
      sent_at:   new Date().toLocaleString(),
      message:   message.trim(),
    });

    setStatus(emailOk ? "done" : "done"); // always show done — Firebase saved either way
  };

  if (status === "done") return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:2000, padding:20 }}>
      <div style={{ background:"#fff", borderRadius:16, padding:40, maxWidth:360, width:"100%", textAlign:"center", boxShadow:"0 8px 32px #0004" }}>
        <div style={{ fontSize:52, marginBottom:16 }}>🎉</div>
        <div style={{ fontWeight:900, color:C.dark, fontSize:20, marginBottom:8 }}>Thanks for your feedback!</div>
        <div style={{ color:"#666", fontSize:14, marginBottom:28 }}>We read every submission and use it to improve the app.</div>
        <Btn onClick={onClose} color={C.green} full>Close</Btn>
      </div>
    </div>
  );

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:2000, padding:20, overflowY:"auto" }}>
      <div style={{ background:"#fff", borderRadius:16, padding:28, width:"100%", maxWidth:460, boxShadow:"0 8px 32px #0004", margin:"auto" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
          <div style={{ fontWeight:900, color:C.dark, fontSize:19 }}>📝 Feedback</div>
          <button onClick={onClose} style={{ background:"none", border:"none", fontSize:22, color:"#aaa", cursor:"pointer" }}>×</button>
        </div>

        {/* Type selector */}
        <div style={{ marginBottom:18 }}>
          <label style={{ fontSize:11, fontWeight:700, color:"#888", letterSpacing:1 }}>CATEGORY</label>
          <div style={{ display:"flex", gap:8, marginTop:8 }}>
            {FEEDBACK_TYPES.map(ft=>(
              <button key={ft.key} onClick={()=>setType(ft.key)} style={{
                flex:1, padding:"9px 6px", borderRadius:8, border:`2px solid`,
                borderColor: type===ft.key ? ft.color : C.grayMid,
                background: type===ft.key ? ft.color : "#fff",
                color: type===ft.key ? "#fff" : "#666",
                fontWeight:700, fontSize:12, cursor:"pointer", transition:"all .15s",
              }}>{ft.label}</button>
            ))}
          </div>
        </div>

        {/* Star rating */}
        <div style={{ marginBottom:18 }}>
          <label style={{ fontSize:11, fontWeight:700, color:"#888", letterSpacing:1 }}>RATING (OPTIONAL)</label>
          <div style={{ display:"flex", gap:6, marginTop:8 }}>
            {[1,2,3,4,5].map(n=>(
              <button key={n}
                onClick={()=>setRating(rating===n ? 0 : n)}
                onMouseEnter={()=>setHoverRating(n)}
                onMouseLeave={()=>setHoverRating(0)}
                style={{ background:"none", border:"none", fontSize:28, cursor:"pointer", padding:"0 2px",
                  color: n<=(hoverRating||rating) ? C.yellow : C.grayMid,
                  transform: n<=(hoverRating||rating) ? "scale(1.15)" : "scale(1)",
                  transition:"all .1s",
                }}>★</button>
            ))}
            {rating>0&&<span style={{ marginLeft:4, color:"#888", fontSize:13, alignSelf:"center" }}>{rating}/5</span>}
          </div>
        </div>

        {/* Name */}
        <div style={{ marginBottom:14 }}>
          <label style={{ fontSize:11, fontWeight:700, color:"#888", letterSpacing:1 }}>YOUR NAME (OPTIONAL)</label>
          <input value={name} onChange={e=>setName(e.target.value)} placeholder="Anonymous"
            style={{ display:"block", width:"100%", marginTop:6, padding:"10px 14px", borderRadius:8, border:`2px solid ${C.grayMid}`, fontSize:14, outline:"none", boxSizing:"border-box" }}/>
        </div>

        {/* Message */}
        <div style={{ marginBottom:22 }}>
          <label style={{ fontSize:11, fontWeight:700, color:"#888", letterSpacing:1 }}>
            MESSAGE *
            {type==="bug"&&<span style={{ color:C.red, marginLeft:6, fontWeight:400 }}>Describe what happened and what you expected</span>}
            {type==="feature"&&<span style={{ color:C.blue, marginLeft:6, fontWeight:400 }}>Describe your idea</span>}
          </label>
          <textarea value={message} onChange={e=>setMessage(e.target.value)}
            placeholder={
              type==="bug" ? "e.g. When I click 'Next Game', the app crashes on iOS Safari..." :
              type==="feature" ? "e.g. I'd love to see a timer per round..." :
              "Tell us what you think about the app..."
            }
            rows={4}
            style={{ display:"block", width:"100%", marginTop:6, padding:"10px 14px", borderRadius:8, border:`2px solid ${C.grayMid}`, fontSize:14, outline:"none", boxSizing:"border-box", resize:"vertical", fontFamily:"inherit" }}/>
        </div>

        <div style={{ display:"flex", gap:10 }}>
          <Btn outline color={C.grayMid} textColor="#666" onClick={onClose} full>Cancel</Btn>
          <Btn
            color={FEEDBACK_TYPES.find(t=>t.key===type)?.color||C.green}
            onClick={submit}
            disabled={!message.trim() || status==="sending"}
            full
          >
            {status==="sending" ? "Sending..." : "Submit Feedback"}
          </Btn>
        </div>
      </div>
    </div>
  );
}

// ── PASSWORD GATE ─────────────────────────────────────────────────────────────
function PasswordGate({ group, onSuccess }: { group: Group; onSuccess: ()=>void }) {
  const [pw, setPw] = useState("");
  const [error, setError] = useState(false);
  const check = () => {
    if (simpleHash(pw) === group.passwordHash) {
      sessionStorage.setItem(`pw_ok_${group.id}`, "1");
      onSuccess();
    } else {
      setError(true);
      setTimeout(()=>setError(false), 1500);
    }
  };
  return (
    <div style={{ minHeight:"100vh", background:C.greenLight, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
      <div style={{ background:"#fff", borderRadius:16, padding:32, maxWidth:380, width:"100%", boxShadow:"0 8px 32px #0002", textAlign:"center" }}>
        <div style={{ fontSize:48, marginBottom:16 }}>🔒</div>
        <div style={{ fontWeight:900, color:C.dark, fontSize:20, marginBottom:8 }}>{group.name}</div>
        {group.location&&<div style={{ color:"#888", fontSize:13, marginBottom:20 }}>📍 {group.location}</div>}
        <div style={{ color:"#555", fontSize:14, marginBottom:20 }}>This group is private. Enter the password to continue.</div>
        <input
          type="password" value={pw} onChange={e=>setPw(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&check()} placeholder="Enter password"
          style={{
            width:"100%", padding:"11px 14px", borderRadius:8, fontSize:15, outline:"none",
            border:`2px solid ${error?C.red:C.grayMid}`, marginBottom:12, boxSizing:"border-box",
            transition:"border-color .2s"
          }}/>
        {error&&<div style={{ color:C.red, fontSize:13, marginBottom:12, fontWeight:600 }}>Incorrect password</div>}
        <Btn onClick={check} color={C.green} full disabled={!pw}>Enter Group</Btn>
      </div>
    </div>
  );
}

// ── MAIN APP ──────────────────────────────────────────────────────────────────
export default function App() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [history, setHistory] = useState<SavedTournament[]>([]);
  const [loading, setLoading] = useState(true);
  const [mainTab, setMainTab] = useState<"groups"|"history">("groups");
  const [selectedGroupId, setSelectedGroupId] = useState<string|null>(null);
  const [groupView, setGroupView] = useState<"players"|"tournament">("players");
  const [selectedHistory, setSelectedHistory] = useState<SavedTournament|null>(null);
  const [nameInput, setNameInput] = useState("");
  const [pwUnlocked, setPwUnlocked] = useState<Record<string,boolean>>({}); 
  const [showFeedback, setShowFeedback] = useState(false);
  const [colorMode, setColorMode] = useState<ColorMode>(()=>{
    try { return (localStorage.getItem("pb_color_mode") as ColorMode) || "normal"; }
    catch { return "normal"; }
  });
  const [showColorMenu, setShowColorMenu] = useState(false);

  // Derive theme from colorMode — fully reactive, no mutations
  const theme = useMemo(()=> THEMES[colorMode] || THEMES.normal, [colorMode]);
  C = theme; // update module-level C so sub-components pick it up

  const GROUP_COLORS = getGroupColors(colorMode);

  const changeColorMode = (mode: ColorMode) => {
    setColorMode(mode);
    try { localStorage.setItem("pb_color_mode", mode); } catch {}
  };

  // Group modal state
  const [showModal, setShowModal] = useState(false);
  const [editingGroup, setEditingGroup] = useState<Group|null>(null);
  const [mName, setMName] = useState("");
  const [mLocation, setMLocation] = useState("");
  const [mColor, setMColor] = useState(GROUP_COLORS[0]);
  const [mCourts, setMCourts] = useState(2);
  const [mPrivate, setMPrivate] = useState(false);
  const [mPassword, setMPassword] = useState("");
  const [mShowPw, setMShowPw] = useState(false);
  const [mColorMode, setMColorMode] = useState<ColorMode>("normal");

  useEffect(()=>{
    // Restore session unlocks
    const unlocked: Record<string,boolean> = {};
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k?.startsWith("pw_ok_")) unlocked[k.replace("pw_ok_","")] = true;
    }
    setPwUnlocked(unlocked);

    const u1 = onSnapshot(collection(db,"pb3_groups"),snap=>{
      const g: Group[] = [];
      snap.forEach(d=>g.push(d.data() as Group));
      g.sort((a,b)=>a.name.localeCompare(b.name));
      setGroups(g); setLoading(false);
    });
    const u2 = onSnapshot(collection(db,"pb3_history"),snap=>{
      const h: SavedTournament[] = [];
      snap.forEach(d=>h.push(d.data() as SavedTournament));
      h.sort((a,b)=>parseInt(b.id)-parseInt(a.id));
      setHistory(h);
    });
    return ()=>{ u1(); u2(); };
  },[]);

  const selectedGroup = groups.find(g=>g.id===selectedGroupId)||null;

  const openNewGroup = () => {
    setEditingGroup(null);
    setMName(""); setMLocation(""); setMColor(GROUP_COLORS[groups.length%GROUP_COLORS.length]);
    setMCourts(2); setMPrivate(false); setMPassword(""); setMColorMode("normal");
    setShowModal(true);
  };
  const openEditGroup = (g: Group) => {
    setEditingGroup(g); setMName(g.name); setMLocation(g.location||"");
    setMColor(g.color); setMCourts(g.numCourts); setMPrivate(g.isPrivate||false); setMPassword("");
    setMColorMode(g.colorMode||"normal");
    setShowModal(true);
  };
  const saveGroup = async () => {
    if (!mName.trim()) return;
    if (mPrivate && !editingGroup && !mPassword.trim()) return;
    const id = editingGroup?.id||`g_${Date.now()}`;
    const base = editingGroup||{ id, players:[], numCourts:mCourts };
    let passwordHash = editingGroup?.passwordHash;
    if (mPrivate && mPassword.trim()) passwordHash = simpleHash(mPassword.trim());
    if (!mPrivate) passwordHash = undefined;
    await setDoc(doc(db,"pb3_groups",id), {
      ...base, id, name:mName.trim(), location:mLocation.trim(),
      color:mColor, numCourts:mCourts, isPrivate:mPrivate,
      colorMode: mColorMode,
      ...(passwordHash ? {passwordHash} : {}),
    });
    if (mPrivate && mPassword.trim()) {
      sessionStorage.setItem(`pw_ok_${id}`, "1");
      setPwUnlocked(prev=>({...prev,[id]:true}));
    }
    setShowModal(false);
  };
  const deleteGroup = async (id: string) => {
    if (!window.confirm("Delete this group and all its data?")) return;
    await deleteDoc(doc(db,"pb3_groups",id));
    if (selectedGroupId===id) setSelectedGroupId(null);
  };

  const addPlayer = async () => {
    const name = nameInput.trim();
    if (!name||!selectedGroup||selectedGroup.players.length>=MAX_PLAYERS) return;
    if (selectedGroup.players.find(p=>p.name.toLowerCase()===name.toLowerCase())) return;
    const newPlayers = [...selectedGroup.players, {name, id:`p_${Date.now()}`}];
    await setDoc(doc(db,"pb3_groups",selectedGroup.id), {...selectedGroup, players:newPlayers});
    setNameInput("");
  };
  const removePlayer = async (pid: string) => {
    if (!selectedGroup) return;
    await setDoc(doc(db,"pb3_groups",selectedGroup.id), {...selectedGroup, players:selectedGroup.players.filter(p=>p.id!==pid)});
  };

  const startTournament = async () => {
    if (!selectedGroup||selectedGroup.players.length<4) return;
    const rounds = generateRounds(selectedGroup.players, selectedGroup.numCourts);
    await setDoc(doc(db,"pb3_groups",selectedGroup.id), {
      ...selectedGroup,
      tournament:{started:true, rounds, scores:{}, subScores:{}, currentRound:0}
    });
    setGroupView("tournament");
  };

  const endTournament = async () => {
    if (!selectedGroup?.tournament) return;
    const t = selectedGroup.tournament;
    const lb = computeLeaderboard(selectedGroup.players, t.rounds, t.scores, t.subScores||{});
    const saved: SavedTournament = {
      id: Date.now().toString(),
      date: new Date().toLocaleDateString("en-US",{year:"numeric",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}),
      groupId:selectedGroup.id, groupName:selectedGroup.name, location:selectedGroup.location||"",
      isPrivate: selectedGroup.isPrivate||false,
      players:selectedGroup.players, rounds:t.rounds, scores:t.scores,
      subScores:t.subScores||{}, leaderboard:lb,
    };
    await setDoc(doc(db,"pb3_history",saved.id), saved);
    await setDoc(doc(db,"pb3_groups",selectedGroup.id), {
      ...selectedGroup, tournament:{started:false,rounds:[],scores:{},subScores:{},currentRound:0}
    });
    setGroupView("players"); setMainTab("history"); setSelectedGroupId(null);
  };

  if (loading) return (
    <div style={{ minHeight:"100vh", background:C.greenLight, display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column", gap:16 }}>
      <div style={{ fontSize:40 }}>🥒</div>
      <div style={{ color:C.green, fontWeight:700, fontSize:18 }}>Loading...</div>
    </div>
  );

  // Apply group-level color mode override — must be BEFORE any early returns (Rules of Hooks)
  const effectiveColorMode: ColorMode = useMemo(()=>
    (selectedGroup?.colorMode && selectedGroup.colorMode !== "normal")
      ? selectedGroup.colorMode
      : colorMode
  , [selectedGroup?.colorMode, colorMode]);

  // Sync C to effective theme for group view (safe — no side effects, just assignment)
  const effectiveTheme = THEMES[effectiveColorMode] || THEMES.normal;
  C = effectiveTheme;

  // ── PASSWORD GATE ──
  if (selectedGroupId && selectedGroup?.isPrivate && !pwUnlocked[selectedGroupId]) {
    return (
      <PasswordGate
        group={selectedGroup}
        onSuccess={()=>setPwUnlocked(prev=>({...prev,[selectedGroupId]:true}))}
      />
    );
  }

  // ── GROUP DETAIL VIEW ──
  if (selectedGroupId && selectedGroup) {
    const hasTournament = selectedGroup.tournament?.started;
    return (
      <div style={{ minHeight:"100vh", background:C.greenLight, fontFamily:"'Segoe UI',sans-serif" }}>
        <div style={{ background:selectedGroup.color, padding:"14px 20px", display:"flex", alignItems:"center", gap:10, boxShadow:"0 2px 8px #0003" }}>
          <button onClick={()=>{ setSelectedGroupId(null); setGroupView("players"); }} style={{ background:"rgba(255,255,255,0.2)", border:"none", borderRadius:8, color:"#fff", padding:"6px 12px", cursor:"pointer", fontWeight:700, fontSize:13 }}>← Back</button>
          <div style={{ flex:1 }}>
            <div style={{ color:"#fff", fontWeight:900, fontSize:18 }}>
              {selectedGroup.name}
              {selectedGroup.isPrivate&&<span style={{ marginLeft:8, fontSize:14 }}>🔒</span>}
            </div>
            {selectedGroup.location&&<div style={{ color:"rgba(255,255,255,0.75)", fontSize:12 }}>📍 {selectedGroup.location}</div>}
          </div>
          {/* Color mode picker */}
          <div style={{ position:"relative" }}>
            <button onClick={()=>setShowColorMenu(p=>!p)} title="Accessibility / Color mode"
              style={{ background:"rgba(255,255,255,0.15)", border: colorMode!=="normal"?"2px solid #fff":"none", borderRadius:8, color:"#fff", padding:"6px 10px", cursor:"pointer", fontSize:16 }}>
              {colorMode==="deuteranopia"?"👁":colorMode==="highcontrast"?"⚡":"🎨"}
            </button>
            {showColorMenu&&(
              <div style={{ position:"absolute", right:0, top:"calc(100% + 8px)", background:"#fff", borderRadius:10, boxShadow:"0 4px 20px #0003", zIndex:500, minWidth:200, overflow:"hidden" }}>
                <div style={{ padding:"10px 14px 6px", fontSize:11, fontWeight:700, color:"#aaa", letterSpacing:1 }}>COLOR MODE</div>
                {(["normal","deuteranopia","highcontrast"] as ColorMode[]).map(mode=>(
                  <button key={mode} onClick={()=>{ changeColorMode(mode); setShowColorMenu(false); }} style={{
                    display:"block", width:"100%", textAlign:"left", padding:"10px 14px",
                    background: colorMode===mode ? C.greenLight : "#fff",
                    border:"none", cursor:"pointer", fontSize:14,
                    fontWeight: colorMode===mode ? 700 : 400,
                    color: colorMode===mode ? C.green : "#333",
                    borderLeft: colorMode===mode ? `3px solid ${C.green}` : "3px solid transparent",
                  }}>
                    {COLOR_MODE_LABELS[mode]}
                    {mode==="deuteranopia"&&<div style={{ fontSize:11, color:"#aaa", marginTop:2 }}>Red-green colorblind friendly</div>}
                    {mode==="highcontrast"&&<div style={{ fontSize:11, color:"#aaa", marginTop:2 }}>Maximum contrast</div>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button onClick={()=>setShowFeedback(true)} title="Send feedback" style={{ background:"rgba(255,255,255,0.15)", border:"none", borderRadius:8, color:"#fff", padding:"6px 10px", cursor:"pointer", fontSize:16 }}>💬</button>
          <a href="/" title="Go to homepage" style={{ background:"rgba(255,255,255,0.15)", border:"none", borderRadius:8, color:"#fff", padding:"6px 10px", cursor:"pointer", fontSize:16, textDecoration:"none" }}>🏠</a>
          <Badge color="rgba(255,255,255,0.25)">{selectedGroup.players.length} players</Badge>
        </div>

        <div style={{ display:"flex", background:C.dark }}>
          {(["players","tournament"] as const).map(v=>(
            <button key={v} onClick={()=>setGroupView(v)} style={{
              flex:1, padding:"11px 0", border:"none", cursor:"pointer",
              background:groupView===v?selectedGroup.color:"transparent",
              color:groupView===v?"#fff":"#aaa", fontWeight:800, fontSize:13, letterSpacing:1,
              borderBottom:groupView===v?`3px solid ${selectedGroup.color}`:"3px solid transparent"
            }}>
              {v==="players"?"👥 PLAYERS":"🎾 TOURNAMENT"}
              {v==="tournament"&&hasTournament&&<span style={{ marginLeft:6, background:C.yellow, color:C.dark, borderRadius:10, padding:"1px 6px", fontSize:10 }}>LIVE</span>}
            </button>
          ))}
        </div>

        <div style={{ maxWidth:700, margin:"0 auto", padding:"20px 16px" }}>
          {groupView==="players"&&(
            <div>
              <div style={{ background:"#fff", borderRadius:12, padding:20, boxShadow:"0 2px 8px #0001", marginBottom:16 }}>
                <div style={{ fontWeight:800, color:C.dark, fontSize:16, marginBottom:12 }}>
                  Players <Badge color={selectedGroup.color}>{selectedGroup.players.length}/{MAX_PLAYERS}</Badge>
                  {selectedGroup.isPrivate&&<span style={{ marginLeft:8, fontSize:12, color:"#888" }}>🔒 Private</span>}
                </div>
                <div style={{ display:"flex", gap:8, marginBottom:16 }}>
                  <input value={nameInput} onChange={e=>setNameInput(e.target.value)}
                    onKeyDown={e=>e.key==="Enter"&&addPlayer()} placeholder="Add player name..." maxLength={30}
                    style={{ flex:1, padding:"9px 14px", borderRadius:8, border:`2px solid ${C.grayMid}`, fontSize:15, outline:"none" }}/>
                  <Btn onClick={addPlayer} color={selectedGroup.color} disabled={!nameInput.trim()||selectedGroup.players.length>=MAX_PLAYERS}>+ Add</Btn>
                </div>
                {selectedGroup.players.length===0&&<div style={{ color:"#aaa", textAlign:"center", padding:20 }}>No players yet.</div>}
                {selectedGroup.players.map((p,i)=>(
                  <div key={p.id} style={{ display:"flex", alignItems:"center", background:C.greenLight, borderRadius:8, padding:"7px 12px", marginBottom:6 }}>
                    <span style={{ color:selectedGroup.color, fontWeight:700, width:26 }}>{i+1}.</span>
                    <span style={{ flex:1, fontWeight:600, color:C.dark }}>{p.name}</span>
                    {!hasTournament&&<button onClick={()=>removePlayer(p.id)} style={{ background:"none", border:"none", color:C.red, cursor:"pointer", fontSize:18 }}>×</button>}
                  </div>
                ))}
              </div>

              <div style={{ background:"#fff", borderRadius:12, padding:20, boxShadow:"0 2px 8px #0001", marginBottom:16 }}>
                <div style={{ fontWeight:800, color:C.dark, fontSize:15, marginBottom:12 }}>Court Settings</div>
                <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                  <span style={{ color:"#555", fontSize:14 }}>Courts:</span>
                  <div style={{ display:"flex", gap:6 }}>
                    {[1,2,3,4,5,6,7].map(n=>(
                      <button key={n} onClick={async()=>{ await setDoc(doc(db,"pb3_groups",selectedGroup.id),{...selectedGroup,numCourts:n}); }} style={{
                        width:36,height:36,borderRadius:8,border:"2px solid",
                        borderColor:selectedGroup.numCourts===n?selectedGroup.color:C.grayMid,
                        background:selectedGroup.numCourts===n?selectedGroup.color:"#fff",
                        color:selectedGroup.numCourts===n?"#fff":C.dark,fontWeight:700,cursor:"pointer"
                      }}>{n}</button>
                    ))}
                  </div>
                </div>
                <div style={{ marginTop:10, color:"#888", fontSize:13 }}>
                  {selectedGroup.players.length} players → {Math.min(Math.floor(selectedGroup.players.length/4),selectedGroup.numCourts)} court(s) active
                </div>
              </div>

              <div style={{ textAlign:"center" }}>
                {hasTournament
                  ?<Btn onClick={()=>setGroupView("tournament")} color={C.yellow} textColor={C.dark}>▶ Resume Live Tournament</Btn>
                  :<Btn onClick={startTournament} disabled={selectedGroup.players.length<4} color={C.yellow} textColor={C.dark}>🎾 Start Tournament</Btn>
                }
                {!hasTournament&&selectedGroup.players.length<4&&<div style={{ color:"#888", marginTop:8, fontSize:13 }}>Need at least 4 players</div>}
              </div>
            </div>
          )}

          {groupView==="tournament"&&(
            hasTournament&&selectedGroup.tournament
              ?<TournamentView group={selectedGroup} onEnd={endTournament}/>
              :<div style={{ textAlign:"center", color:"#888", padding:40 }}>
                No active tournament.<br/>
                <button onClick={()=>setGroupView("players")} style={{ marginTop:12, background:"none", border:"none", color:C.green, cursor:"pointer", fontWeight:700 }}>Go to Players →</button>
              </div>
          )}
        </div>

        {/* Feedback modal */}
        {showFeedback&&<FeedbackModal onClose={()=>setShowFeedback(false)}/>}
      </div>
    );
  }

  // ── MAIN VIEW ──────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight:"100vh", background:C.greenLight, fontFamily:"'Segoe UI',sans-serif" }}>
      <div style={{ background:C.green, padding:"14px 20px", display:"flex", alignItems:"center", gap:12, boxShadow:"0 2px 8px #0003", ...(colorMode==="highcontrast"?{border:"3px solid #fff"}:{}) }}>
        <span style={{ fontSize:28 }}>🥒</span>
        <div>
          <div style={{ color:C.yellow, fontWeight:900, fontSize:20, letterSpacing:1 }}>PICKLEBALL</div>
          <div style={{ color:"#fff", fontSize:11, fontWeight:600, letterSpacing:2 }}>ROUND-ROBIN V3 · MULTI-GROUP</div>
        </div>
        <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:8 }}>
          {groups.filter(g=>g.tournament?.started).length>0&&(
            <Badge color={C.orange}>🔴 {groups.filter(g=>g.tournament?.started).length} Live</Badge>
          )}
          {/* Color mode picker */}
          <div style={{ position:"relative" }}>
            <button onClick={()=>setShowColorMenu(p=>!p)} title="Accessibility / Color mode"
              style={{ background:"rgba(255,255,255,0.15)", border: colorMode!=="normal"?"2px solid #fff":"none", borderRadius:8, color:"#fff", padding:"6px 11px", cursor:"pointer", fontSize:16 }}>
              {colorMode==="deuteranopia"?"👁":colorMode==="highcontrast"?"⚡":"🎨"}
            </button>
            {showColorMenu&&(
              <div style={{ position:"absolute", right:0, top:"calc(100% + 8px)", background:"#fff", borderRadius:10, boxShadow:"0 4px 20px #0003", zIndex:500, minWidth:200, overflow:"hidden" }}>
                <div style={{ padding:"10px 14px 6px", fontSize:11, fontWeight:700, color:"#aaa", letterSpacing:1 }}>COLOR MODE</div>
                {(["normal","deuteranopia","highcontrast"] as ColorMode[]).map(mode=>(
                  <button key={mode} onClick={()=>{ changeColorMode(mode); setShowColorMenu(false); }} style={{
                    display:"block", width:"100%", textAlign:"left", padding:"10px 14px",
                    background: colorMode===mode ? C.greenLight : "#fff",
                    border:"none", cursor:"pointer", fontSize:14,
                    fontWeight: colorMode===mode ? 700 : 400,
                    color: colorMode===mode ? C.green : "#333",
                    borderLeft: colorMode===mode ? `3px solid ${C.green}` : "3px solid transparent",
                  }}>
                    {COLOR_MODE_LABELS[mode]}
                    {mode==="deuteranopia"&&<div style={{ fontSize:11, color:"#aaa", marginTop:2 }}>Red-green colorblind friendly</div>}
                    {mode==="highcontrast"&&<div style={{ fontSize:11, color:"#aaa", marginTop:2 }}>Maximum contrast</div>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button onClick={()=>setShowFeedback(true)} title="Send feedback" style={{ background:"rgba(255,255,255,0.15)", border:"none", borderRadius:8, color:"#fff", padding:"6px 11px", cursor:"pointer", fontSize:16 }}>💬</button>
          <a href="/" title="Go to homepage" style={{ background:"rgba(255,255,255,0.15)", border:"none", borderRadius:8, color:"#fff", padding:"6px 11px", cursor:"pointer", fontSize:16, textDecoration:"none" }}>🏠</a>
        </div>
      </div>

      <div style={{ display:"flex", background:C.dark }}>
        {(["groups","history"] as const).map(t=>(
          <button key={t} onClick={()=>setMainTab(t)} style={{
            flex:1, maxWidth:220, padding:"11px 0", border:"none", cursor:"pointer",
            background:mainTab===t?C.yellow:"transparent",
            color:mainTab===t?C.dark:"#aaa", fontWeight:800, fontSize:13, letterSpacing:1,
            borderBottom:mainTab===t?`3px solid ${C.yellow}`:"3px solid transparent"
          }}>
            {t==="groups"?"👥 GROUPS":"📚 HISTORY"}
            {t==="history"&&history.filter(h=>!h.isPrivate||pwUnlocked[h.groupId]).length>0&&
              <span style={{ marginLeft:4, background:C.purple, color:"#fff", borderRadius:10, padding:"1px 6px", fontSize:10 }}>
                {history.filter(h=>!h.isPrivate||pwUnlocked[h.groupId]).length}
              </span>
            }
          </button>
        ))}
      </div>

      <div style={{ maxWidth:700, margin:"0 auto", padding:"20px 16px" }}>

        {mainTab==="groups"&&(
          <div>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
              <div style={{ fontWeight:800, color:C.dark, fontSize:17 }}>Groups <Badge color={C.greenMid}>{groups.length}</Badge></div>
              <Btn onClick={openNewGroup} color={C.green} small>+ New Group</Btn>
            </div>

            {groups.length===0&&(
              <div style={{ background:"#fff", borderRadius:12, padding:40, textAlign:"center", color:"#aaa", boxShadow:"0 2px 8px #0001" }}>
                No groups yet.<br/><span style={{ fontSize:13 }}>Create a group for each location!</span>
              </div>
            )}

            {groups.map(g=>(
              <div key={g.id} style={{ background:"#fff", borderRadius:12, marginBottom:14, boxShadow:"0 2px 8px #0001", overflow:"hidden" }}>
                <div style={{ background:g.color, padding:"14px 18px", display:"flex", alignItems:"center", gap:12, cursor:"pointer" }}
                  onClick={()=>{ setSelectedGroupId(g.id); setGroupView("players"); }}>
                  <div style={{ flex:1 }}>
                    <div style={{ color:"#fff", fontWeight:900, fontSize:17 }}>
                      {g.name}
                      {g.isPrivate&&<span style={{ marginLeft:8, fontSize:14, opacity:0.8 }}>🔒</span>}
                    </div>
                    {g.location&&<div style={{ color:"rgba(255,255,255,0.75)", fontSize:12 }}>📍 {g.location}</div>}
                  </div>
                  {g.tournament?.started&&<Badge color="rgba(255,100,0,0.9)">🔴 LIVE</Badge>}
                  <div style={{ color:"rgba(255,255,255,0.6)", fontSize:22 }}>›</div>
                </div>
                <div style={{ padding:"12px 18px", display:"flex", alignItems:"center", gap:16 }}>
                  <span style={{ fontSize:13, color:"#555" }}>👥 {g.players.length} players</span>
                  <span style={{ fontSize:13, color:"#555" }}>🏓 {g.numCourts} court(s)</span>
                  {g.isPrivate&&<span style={{ fontSize:12, color:C.purple }}>🔒 Private</span>}
                  {g.colorMode&&g.colorMode!=="normal"&&<span style={{ fontSize:12, color:C.blue }}>{g.colorMode==="deuteranopia"?"👁 Deuteranopia":"⚡ Hi-Contrast"}</span>}
                  <div style={{ marginLeft:"auto", display:"flex", gap:8 }}>
                    <Btn small outline color={g.color} onClick={()=>openEditGroup(g)}>Edit</Btn>
                    <Btn small outline color={C.red} onClick={()=>deleteGroup(g.id)}>Delete</Btn>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {mainTab==="history"&&(
          <div>
            {selectedHistory?(
              <div>
                <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:16 }}>
                  <Btn small outline color={C.green} onClick={()=>setSelectedHistory(null)}>← Back</Btn>
                  <div>
                    <div style={{ fontWeight:800, color:C.dark, fontSize:15 }}>{selectedHistory.groupName}</div>
                    <div style={{ color:"#888", fontSize:12 }}>📅 {selectedHistory.date}{selectedHistory.location&&` · 📍 ${selectedHistory.location}`}</div>
                  </div>
                </div>
                <div style={{ background:"#fff", borderRadius:12, padding:20, boxShadow:"0 2px 8px #0001", marginBottom:16 }}>
                  <div style={{ fontWeight:800, color:C.dark, fontSize:15, marginBottom:12 }}>🏆 Final Standings</div>
                  <LeaderboardTable lb={selectedHistory.leaderboard}/>
                </div>
                <div style={{ background:"#fff", borderRadius:12, padding:20, boxShadow:"0 2px 8px #0001" }}>
                  <div style={{ fontWeight:800, color:C.dark, fontSize:14, marginBottom:12 }}>👥 Players ({selectedHistory.players.length})</div>
                  <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
                    {selectedHistory.players.map(p=>(
                      <span key={p.id} style={{ background:C.greenLight, color:C.dark, borderRadius:20, padding:"4px 14px", fontSize:13, fontWeight:600 }}>{p.name}</span>
                    ))}
                  </div>
                </div>
              </div>
            ):(
              <div>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
                  <div style={{ fontWeight:800, color:C.dark, fontSize:17 }}>Tournament History</div>
                  <Badge color={C.purple}>{history.length} saved</Badge>
                </div>
                {history.length===0&&(
                  <div style={{ background:"#fff", borderRadius:12, padding:40, textAlign:"center", color:"#aaa", boxShadow:"0 2px 8px #0001" }}>No tournaments saved yet.</div>
                )}
                {history
                  .filter(t=>!t.isPrivate||pwUnlocked[t.groupId])
                  .map(t=>{
                    const grp = groups.find(g=>g.id===t.groupId);
                    const color = grp?.color||C.purple;
                    return (
                      <div key={t.id} style={{ background:"#fff", borderRadius:12, padding:18, marginBottom:12, boxShadow:"0 2px 8px #0001", borderLeft:`5px solid ${color}` }}>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                          <div>
                            <div style={{ fontWeight:800, color:C.dark, fontSize:14 }}>
                              {t.groupName}
                              {t.isPrivate&&<span style={{ marginLeft:6, fontSize:12 }}>🔒</span>}
                            </div>
                            <div style={{ color:"#888", fontSize:12 }}>📅 {t.date}{t.location&&` · 📍 ${t.location}`}</div>
                            <div style={{ color:"#aaa", fontSize:12 }}>{t.players.length} players · {t.rounds.length} rounds</div>
                          </div>
                          <div style={{ display:"flex", gap:8 }}>
                            <Btn small outline color={C.green} onClick={()=>setSelectedHistory(t)}>View</Btn>
                            <Btn small outline color={C.red} onClick={async()=>{ await deleteDoc(doc(db,"pb3_history",t.id)); }}>Del</Btn>
                          </div>
                        </div>
                        {t.leaderboard.slice(0,3).map((p,i)=>(
                          <div key={p.id} style={{ display:"flex", alignItems:"center", gap:8, fontSize:13, marginTop:4 }}>
                            <span>{i===0?"🥇":i===1?"🥈":"🥉"}</span>
                            <span style={{ fontWeight:700, color:C.dark }}>{p.name}</span>
                            <span style={{ color:"#888" }}>{p.wins}W · {p.points}pts</span>
                          </div>
                        ))}
                      </div>
                    );
                  })
                }
              </div>
            )}
          </div>
        )}
      </div>

      {/* Group create/edit modal */}
      {showModal&&(
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000, padding:20, overflowY:"auto" }}>
          <div style={{ background:"#fff", borderRadius:16, padding:28, width:"100%", maxWidth:440, boxShadow:"0 8px 32px #0004", margin:"auto" }}>
            <div style={{ fontWeight:800, color:C.dark, fontSize:18, marginBottom:20 }}>{editingGroup?"Edit Group":"New Group"}</div>

            <div style={{ marginBottom:14 }}>
              <label style={{ fontSize:11, fontWeight:700, color:"#888", letterSpacing:1 }}>GROUP NAME *</label>
              <input value={mName} onChange={e=>setMName(e.target.value)} placeholder="e.g. City A Squad"
                style={{ display:"block", width:"100%", marginTop:6, padding:"10px 14px", borderRadius:8, border:`2px solid ${C.grayMid}`, fontSize:15, outline:"none", boxSizing:"border-box" }}/>
            </div>

            <div style={{ marginBottom:14 }}>
              <label style={{ fontSize:11, fontWeight:700, color:"#888", letterSpacing:1 }}>LOCATION</label>
              <input value={mLocation} onChange={e=>setMLocation(e.target.value)} placeholder="e.g. Riverside Courts, City A"
                style={{ display:"block", width:"100%", marginTop:6, padding:"10px 14px", borderRadius:8, border:`2px solid ${C.grayMid}`, fontSize:15, outline:"none", boxSizing:"border-box" }}/>
            </div>

            <div style={{ marginBottom:14 }}>
              <label style={{ fontSize:11, fontWeight:700, color:"#888", letterSpacing:1 }}>GROUP COLOR</label>
              <div style={{ display:"flex", gap:10, marginTop:8, flexWrap:"wrap" }}>
                {GROUP_COLORS.map(col=>(
                  <div key={col} onClick={()=>setMColor(col)} style={{
                    width:32, height:32, borderRadius:"50%", background:col, cursor:"pointer",
                    boxShadow: mColor===col?`0 0 0 3px #fff, 0 0 0 5px ${col}`:"none",
                    transition:"box-shadow .15s"
                  }}/>
                ))}
              </div>
            </div>

            <div style={{ marginBottom:14 }}>
              <label style={{ fontSize:11, fontWeight:700, color:"#888", letterSpacing:1 }}>NUMBER OF COURTS</label>
              <div style={{ display:"flex", gap:8, marginTop:8 }}>
                {[1,2,3,4,5,6,7].map(n=>(
                  <button key={n} onClick={()=>setMCourts(n)} style={{
                    width:36, height:36, borderRadius:8, border:"2px solid",
                    borderColor:mCourts===n?mColor:C.grayMid,
                    background:mCourts===n?mColor:"#fff",
                    color:mCourts===n?"#fff":C.dark, fontWeight:700, cursor:"pointer"
                  }}>{n}</button>
                ))}
              </div>
            </div>

            {/* Privacy toggle */}
            <div style={{ marginBottom:mPrivate?14:24, background:mPrivate?C.greenLight:"#fafafa", border:`2px solid ${mPrivate?C.greenMid:C.grayMid}`, borderRadius:10, padding:"14px 16px" }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                <div>
                  <div style={{ fontWeight:700, color:C.dark, fontSize:14 }}>
                    {mPrivate?"🔒 Private Group":"🌐 Public Group"}
                  </div>
                  <div style={{ fontSize:12, color:"#888", marginTop:2 }}>
                    {mPrivate?"Password required to view":"Anyone can see this group's results"}
                  </div>
                </div>
                <button onClick={()=>setMPrivate(p=>!p)} style={{
                  width:48, height:26, borderRadius:13, border:"none", cursor:"pointer",
                  background:mPrivate?C.green:C.grayMid, position:"relative", transition:"background .2s"
                }}>
                  <div style={{
                    position:"absolute", top:3, left:mPrivate?26:3, width:20, height:20,
                    borderRadius:"50%", background:"#fff", transition:"left .2s"
                  }}/>
                </button>
              </div>
              {mPrivate&&(
                <div style={{ marginTop:12 }}>
                  <label style={{ fontSize:11, fontWeight:700, color:"#888", letterSpacing:1 }}>
                    {editingGroup?"NEW PASSWORD (leave blank to keep current)":"PASSWORD *"}
                  </label>
                  <div style={{ position:"relative", marginTop:6 }}>
                    <input
                      type={mShowPw?"text":"password"}
                      value={mPassword} onChange={e=>setMPassword(e.target.value)}
                      placeholder={editingGroup?"Enter new password to change...":"Set a password..."}
                      style={{ display:"block", width:"100%", padding:"10px 40px 10px 14px", borderRadius:8, border:`2px solid ${C.grayMid}`, fontSize:15, outline:"none", boxSizing:"border-box" }}/>
                    <button onClick={()=>setMShowPw(p=>!p)} style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", cursor:"pointer", fontSize:16, color:"#aaa" }}>
                      {mShowPw?"🙈":"👁"}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Per-group color mode override */}
            <div style={{ marginBottom:22 }}>
              <label style={{ fontSize:11, fontWeight:700, color:"#888", letterSpacing:1 }}>ACCESSIBILITY / COLOR MODE</label>
              <div style={{ display:"flex", gap:8, marginTop:8, flexWrap:"wrap" }}>
                {(["normal","deuteranopia","highcontrast"] as ColorMode[]).map(mode=>(
                  <button key={mode} onClick={()=>setMColorMode(mode)} style={{
                    flex:1, minWidth:100, padding:"8px 10px", borderRadius:8, border:"2px solid",
                    borderColor: mColorMode===mode ? mColor : C.grayMid,
                    background: mColorMode===mode ? mColor : "#fff",
                    color: mColorMode===mode ? "#fff" : "#555",
                    fontWeight: mColorMode===mode ? 700 : 400,
                    fontSize:12, cursor:"pointer", transition:"all .15s",
                  }}>
                    {mode==="normal"?"🎨 Normal":mode==="deuteranopia"?"👁 Deuteranopia":"⚡ High Contrast"}
                  </button>
                ))}
              </div>
              <div style={{ fontSize:11, color:"#aaa", marginTop:6 }}>
                Overrides global setting for this group only
              </div>
            </div>

            <div style={{ display:"flex", gap:10 }}>
              <Btn outline color={C.grayMid} textColor="#666" onClick={()=>setShowModal(false)} full>Cancel</Btn>
              <Btn color={mColor} onClick={saveGroup} disabled={!mName.trim()||(mPrivate&&!editingGroup&&!mPassword.trim())} full>
                {editingGroup?"Save Changes":"Create Group"}
              </Btn>
            </div>
          </div>
        </div>
      )}

      {/* Feedback modal */}
      {showFeedback&&<FeedbackModal onClose={()=>setShowFeedback(false)}/>}
    </div>
  );
}