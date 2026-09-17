import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { HudCorners } from "@/components/HudCorners";
import { AIFace } from "@/components/AIFace";
import {
  Mail, Wallet, Briefcase, GraduationCap, RefreshCw, Lock, Unlock,
  Settings2, ShieldCheck, ArrowUpRight, ArrowDownRight,
} from "lucide-react";

// ── Data contract (mirrors GET /api/analytics/life) ───────────────────────────
type Kind = "email" | "money" | "job" | "school";
interface LifeData {
  generatedAt: string;
  nextRefreshInDays: number;
  demo?: boolean;
  kpis: Record<"inbox" | "money" | "job" | "school", { value: number; currency?: string; sub: string; trend: number }>;
  priorities: { kind: Kind; weight: number; title: string; detail: string }[];
  money: { spark: number[]; net: number; bills: { name: string; amount: number; dueInDays: number }[] };
  deadlines: { kind: Kind; label: string; whenInDays: number }[];
  brief: string;
}

// Demo fallback so the view always renders, even with no server.
const DEMO: LifeData = {
  generatedAt: new Date().toISOString(),
  nextRefreshInDays: 2,
  demo: true,
  kpis: {
    inbox: { value: 6, sub: "of 41 unread need you", trend: -2 },
    money: { value: 1840, currency: "USD", sub: "net this month", trend: 12 },
    job: { value: 3, sub: "deadlines this week", trend: 0 },
    school: { value: 4, sub: "assignments due soon", trend: 1 },
  },
  priorities: [
    { kind: "money", weight: 98, title: "Rent auto-pays Thursday", detail: "$1,450 — balance covers it, +$210 cushion" },
    { kind: "job", weight: 95, title: "Recruiter reply owed", detail: "waiting since Mon; role closes Fri" },
    { kind: "school", weight: 90, title: "CS-340 milestone due", detail: "tomorrow 11:59 PM · 60% done" },
    { kind: "email", weight: 82, title: "Landlord: renewal terms", detail: "needs a yes/no by the weekend" },
  ],
  money: { spark: [120, 240, 180, 300, 260, 420, 380, 510, 470, 560, 540, 620], net: 1840, bills: [
    { name: "Rent", amount: 1450, dueInDays: 2 }, { name: "Phone", amount: 55, dueInDays: 6 }, { name: "Utilities", amount: 96, dueInDays: 9 },
  ] },
  deadlines: [
    { kind: "school", label: "CS-340 milestone", whenInDays: 1 }, { kind: "job", label: "Application closes", whenInDays: 3 },
    { kind: "school", label: "Stats problem set", whenInDays: 4 }, { kind: "job", label: "Portfolio review call", whenInDays: 5 },
  ],
  brief: "Money's steady and rent's covered. The one thing that moves your week: reply to that recruiter before Friday, then knock out the CS-340 milestone tonight.",
};

const KIND_META: Record<Kind, { icon: typeof Mail; label: string }> = {
  email: { icon: Mail, label: "EMAIL" },
  money: { icon: Wallet, label: "MONEY" },
  job: { icon: Briefcase, label: "JOB" },
  school: { icon: GraduationCap, label: "SCHOOL" },
};

// ── Shared eye color (persists across every view — the "everything connects") ──
function useEyeColor(): string {
  const [c, setC] = useState(() => localStorage.getItem("neura_eye") || "var(--color-primary)");
  useEffect(() => {
    const onEye = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (typeof d === "string") setC(d);
    };
    window.addEventListener("neura-eye", onEye);
    return () => window.removeEventListener("neura-eye", onEye);
  }, []);
  return c;
}

// ── Simple local privacy lock (NOT crypto — just keeps a shoulder-surfer out) ──
const PW_KEY = "neura_analytics_pw";
const UNLOCK_KEY = "neura_analytics_unlocked";
function hashPw(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return String(h >>> 0);
}

function Spark({ data, color }: { data: number[]; color: string }) {
  const w = 240, h = 46;
  const mx = Math.max(...data), mn = Math.min(...data);
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * (w - 4) + 2;
    const y = h - 6 - ((v - mn) / (mx - mn || 1)) * (h - 12);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} className="mt-2" preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" opacity="0.9" />
    </svg>
  );
}

export default function Analytics() {
  const eye = useEyeColor();
  const [data, setData] = useState<LifeData>(DEMO);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(
    () => !!localStorage.getItem(PW_KEY) && sessionStorage.getItem(UNLOCK_KEY) !== "1",
  );
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`${import.meta.env.BASE_URL}api/analytics/life`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("no data"))))
      .then((d: LifeData) => { if (alive) setData(d); })
      .catch(() => { /* keep DEMO */ })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  if (locked) return <LockGate onUnlock={() => setLocked(false)} eye={eye} />;

  const genAgo = useMemo(() => {
    const days = Math.max(0, Math.round((Date.now() - new Date(data.generatedAt).getTime()) / 86_400_000));
    return days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
  }, [data.generatedAt]);

  const money$ = (n: number) => `$${n.toLocaleString("en-US")}`;

  return (
    <div className="relative min-h-full bg-background text-primary p-5 md:p-7 font-mono">
      <HudCorners />

      {/* Header */}
      <div className="flex flex-wrap items-end gap-3 mb-5">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 shrink-0"><AIFace style="iris" size={44} color={eye} speaking={false} /></div>
          <div>
            <div className="text-[11px] tracking-[0.35em] uppercase text-primary/40">Nobi · Life Analytics</div>
            <h1 className="text-lg font-bold tracking-wide">What I'm watching for you</h1>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-[10px] text-primary/40 flex items-center gap-1.5">
            <RefreshCw className="w-3 h-3" /> rebuilt {genAgo} · refreshes in {data.nextRefreshInDays}d
            {data.demo && <span className="ml-1 px-1.5 py-0.5 border border-primary/20 text-primary/50">SAMPLE</span>}
          </span>
          <button onClick={() => setShowSettings((v) => !v)} className="text-primary/40 hover:text-primary" title="Privacy & settings">
            <Settings2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} onLockNow={() => setLocked(true)} />}

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
        <Kpi icon={Mail} label="Inbox" value={String(data.kpis.inbox.value)} sub={data.kpis.inbox.sub} trend={data.kpis.inbox.trend} color={eye} />
        <Kpi icon={Wallet} label="Money" value={money$(data.kpis.money.value)} sub={data.kpis.money.sub} trend={data.kpis.money.trend} color={eye} />
        <Kpi icon={Briefcase} label="Job" value={String(data.kpis.job.value)} sub={data.kpis.job.sub} trend={data.kpis.job.trend} color={eye} />
        <Kpi icon={GraduationCap} label="School" value={String(data.kpis.school.value)} sub={data.kpis.school.sub} trend={data.kpis.school.trend} color={eye} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* What matters now */}
        <Panel title="What matters right now" className="lg:col-span-2">
          <div className="space-y-2">
            {data.priorities.map((p, i) => {
              const M = KIND_META[p.kind];
              return (
                <div key={i} className="flex items-start gap-3 border border-primary/10 bg-primary/[0.03] px-3 py-2.5">
                  <M.icon className="w-4 h-4 mt-0.5 shrink-0" style={{ color: eye }} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-primary/90 truncate">{p.title}</div>
                    <div className="text-[11px] text-primary/45 truncate">{p.detail}</div>
                  </div>
                  <span className="text-[9px] text-primary/30 uppercase tracking-widest shrink-0 mt-1">{M.label}</span>
                </div>
              );
            })}
          </div>
        </Panel>

        {/* Buddy + Nobi's read */}
        <Panel title="Nobi's read on your week">
          <div className="flex flex-col items-center text-center gap-3">
            <div className="w-20 h-20"><AIFace style="iris" size={80} color={eye} speaking={false} /></div>
            <p className="text-[12px] leading-relaxed text-primary/70">{data.brief}</p>
          </div>
        </Panel>

        {/* Money */}
        <Panel title="Money · this month">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold">{money$(data.money.net)}</span>
            <span className="text-[10px] text-primary/40">net</span>
          </div>
          <Spark data={data.money.spark} color={eye} />
          <div className="mt-3 space-y-1.5">
            {data.money.bills.map((b, i) => (
              <div key={i} className="flex items-center justify-between text-[12px]">
                <span className="text-primary/60">{b.name}</span>
                <span className="text-primary/45">{money$(b.amount)} · {b.dueInDays}d</span>
              </div>
            ))}
          </div>
        </Panel>

        {/* Deadlines */}
        <Panel title="Deadlines · job & school" className="lg:col-span-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {data.deadlines.map((d, i) => {
              const M = KIND_META[d.kind];
              return (
                <div key={i} className="flex items-center gap-2.5 border border-primary/10 px-3 py-2">
                  <M.icon className="w-4 h-4 shrink-0" style={{ color: eye }} />
                  <span className="text-[12px] text-primary/80 truncate flex-1">{d.label}</span>
                  <span className={`text-[11px] shrink-0 ${d.whenInDays <= 1 ? "text-[#ffb35c]" : "text-primary/40"}`}>
                    {d.whenInDays === 0 ? "today" : `in ${d.whenInDays}d`}
                  </span>
                </div>
              );
            })}
          </div>
        </Panel>
      </div>

      {loading && <div className="mt-4 text-[10px] text-primary/25">syncing latest…</div>}
    </div>
  );
}

function Kpi({ icon: Icon, label, value, sub, trend, color }: {
  icon: typeof Mail; label: string; value: string; sub: string; trend: number; color: string;
}) {
  const up = trend > 0, flat = trend === 0;
  return (
    <div className="border border-primary/15 bg-primary/[0.03] p-3.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] tracking-[0.15em] uppercase text-primary/40">{label}</span>
        <Icon className="w-3.5 h-3.5" style={{ color }} />
      </div>
      <div className="text-2xl font-bold mt-1.5 tabular-nums">{value}</div>
      <div className="flex items-center gap-1 text-[10px] text-primary/40 mt-0.5">
        {!flat && (up
          ? <ArrowUpRight className="w-3 h-3 text-[#3ddc97]" />
          : <ArrowDownRight className="w-3 h-3 text-[#3ddc97]" />)}
        <span className="truncate">{sub}</span>
      </div>
    </div>
  );
}

function Panel({ title, className = "", children }: { title: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={`border border-primary/15 bg-card/30 p-4 ${className}`}>
      <div className="text-[10px] tracking-[0.15em] uppercase text-primary/40 mb-3">{title}</div>
      {children}
    </div>
  );
}

function SettingsPanel({ onClose, onLockNow }: { onClose: () => void; onLockNow: () => void }) {
  const [pw, setPw] = useState("");
  const hasPw = !!localStorage.getItem(PW_KEY);
  const [msg, setMsg] = useState("");
  const [enabled, setEnabled] = useState(() => localStorage.getItem("neura_analytics_enabled") !== "0");
  const toggleEnabled = () => {
    const v = !enabled;
    setEnabled(v);
    localStorage.setItem("neura_analytics_enabled", v ? "1" : "0");
    setMsg(v ? "Analytics shown in the menu." : "Hidden from the menu (still reachable at /analytics).");
  };

  const savePw = () => {
    if (pw.length < 4) { setMsg("Use at least 4 characters."); return; }
    localStorage.setItem(PW_KEY, hashPw(pw));
    sessionStorage.setItem(UNLOCK_KEY, "1");
    setPw(""); setMsg("Password lock enabled.");
  };
  const clearPw = () => { localStorage.removeItem(PW_KEY); sessionStorage.removeItem(UNLOCK_KEY); setMsg("Lock removed."); };

  return (
    <div className="border border-primary/25 bg-background/95 p-4 mb-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-widest text-primary/60 flex items-center gap-2"><ShieldCheck className="w-4 h-4" /> Privacy lock</span>
        <button onClick={onClose} className="text-primary/40 hover:text-primary text-xs">✕</button>
      </div>
      <p className="text-[11px] text-primary/40 leading-relaxed">
        Your life dashboard can show money and personal details — lock it so only you can open it on this device.
      </p>
      <button onClick={toggleEnabled} className="flex items-center justify-between w-full text-[12px] border border-primary/15 px-3 py-2 hover:border-primary/40">
        <span className="text-primary/70">Show Analytics in the menu</span>
        <span className={enabled ? "text-[#3ddc97]" : "text-primary/30"}>{enabled ? "ON" : "OFF"}</span>
      </button>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="password" value={pw} onChange={(e) => setPw(e.target.value)}
          placeholder={hasPw ? "new password" : "set a password"}
          className="bg-transparent border border-primary/25 focus:border-primary/60 px-3 py-2 text-xs text-primary placeholder-primary/25 outline-none"
        />
        <button onClick={savePw} className="px-3 py-2 text-xs border border-primary/30 hover:bg-primary/10">
          {hasPw ? "Change" : "Enable lock"}
        </button>
        {hasPw && <button onClick={clearPw} className="px-3 py-2 text-xs border border-primary/20 text-primary/50 hover:text-primary">Remove</button>}
        {hasPw && <button onClick={onLockNow} className="px-3 py-2 text-xs border border-primary/30 flex items-center gap-1.5"><Lock className="w-3 h-3" /> Lock now</button>}
      </div>
      {msg && <div className="text-[10px] text-primary/50">{msg}</div>}
    </div>
  );
}

function LockGate({ onUnlock, eye }: { onUnlock: () => void; eye: string }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (hashPw(pw) === localStorage.getItem(PW_KEY)) {
      sessionStorage.setItem(UNLOCK_KEY, "1");
      onUnlock();
    } else {
      setErr(true); setPw("");
    }
  };

  return (
    <div className="relative min-h-full bg-background text-primary flex flex-col items-center justify-center gap-6 font-mono">
      <HudCorners />
      <div className="w-16 h-16"><AIFace style="iris" size={64} color={eye} speaking={false} /></div>
      <div className="text-center">
        <div className="text-sm tracking-widest uppercase flex items-center gap-2 justify-center"><Lock className="w-4 h-4" /> Life analytics locked</div>
        <p className="text-[11px] text-primary/40 mt-1">Enter your password to open your dashboard.</p>
      </div>
      <form onSubmit={submit} className="flex flex-col items-center gap-3 w-64">
        <input
          ref={inputRef} type="password" value={pw} onChange={(e) => { setPw(e.target.value); setErr(false); }}
          placeholder="password"
          className={`w-full text-center bg-transparent border px-4 py-3 text-lg tracking-widest text-primary placeholder-primary/20 outline-none ${err ? "border-[#f03248]/60" : "border-primary/30 focus:border-primary/60"}`}
        />
        {err && <span className="text-[10px] text-[#f03248]">Wrong password.</span>}
        <button type="submit" className="w-full py-2.5 text-xs uppercase tracking-widest border border-primary/40 bg-primary/10 hover:bg-primary/20 flex items-center justify-center gap-2">
          <Unlock className="w-3.5 h-3.5" /> Unlock
        </button>
      </form>
    </div>
  );
}
