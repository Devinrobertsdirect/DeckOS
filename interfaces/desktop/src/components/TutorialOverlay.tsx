import { useState, useEffect } from "react";
import { CheckCircle2, Circle, ChevronDown, ChevronUp, X, Zap, Target } from "lucide-react";
import { useTutorial } from "@/contexts/TutorialContext";

// ── Tutorial Prompt ───────────────────────────────────────────────────────────
// Shown once on first entry to ask user if they want the guided tour

function TutorialPrompt() {
  const { startTutorial, dismissTutorial } = useTutorial();
  const [visible, setVisible] = useState(false);

  // Slight delay so the app finishes rendering before the prompt appears
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 1200);
    return () => clearTimeout(t);
  }, []);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center pointer-events-none">
      <div
        className="pointer-events-auto w-full max-w-sm mx-4 border border-primary/50 bg-card/95 backdrop-blur-md shadow-2xl shadow-primary/20 font-mono animate-in fade-in slide-in-from-bottom-4 duration-500"
        style={{ boxShadow: "0 0 40px rgba(var(--primary-rgb),0.15), 0 0 1px rgba(var(--primary-rgb),0.4)" }}
      >
        {/* Header */}
        <div className="border-b border-primary/20 px-5 py-3 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          <span className="text-primary text-[10px] uppercase tracking-[0.2em]">Training Protocol</span>
          <span className="ml-auto text-primary/30 text-[9px]">OPTIONAL</span>
        </div>

        {/* Body */}
        <div className="px-5 py-5 space-y-4">
          <div className="text-primary text-sm font-bold tracking-wide">
            Want a guided walkthrough?
          </div>
          <p className="text-primary/60 text-xs leading-relaxed">
            Complete 7 short missions to get familiar with Deck OS — go at your own
            pace and explore the real app as you go. No slides, no reading required.
          </p>

          {/* Mission preview */}
          <div className="border border-primary/15 bg-primary/5 p-3 space-y-1.5">
            <div className="text-primary/30 text-[9px] uppercase tracking-widest mb-2">Missions include</div>
            {["Chat with your AI", "Customize its personality", "Explore Memory Bank", "Browse the Plugin Store"].map((m) => (
              <div key={m} className="flex items-center gap-2 text-[10px] text-primary/50">
                <Target className="w-3 h-3 text-primary/30 shrink-0" />
                {m}
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="border-t border-primary/20 px-5 py-3 flex items-center gap-3">
          <button
            onClick={dismissTutorial}
            className="flex-1 py-2 border border-primary/20 text-primary/40 hover:text-primary/70 hover:border-primary/40 transition-all text-xs uppercase tracking-widest"
          >
            Skip
          </button>
          <button
            onClick={startTutorial}
            className="flex-1 py-2 border border-primary bg-primary/10 text-primary hover:bg-primary/20 transition-all text-xs uppercase tracking-widest font-bold flex items-center justify-center gap-2"
          >
            <Zap className="w-3.5 h-3.5" />
            Begin Training
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Quest Panel ───────────────────────────────────────────────────────────────
// Floating collapsible checklist of tutorial steps

function QuestPanel() {
  const { steps, completedSteps, currentStep, allDone, dismissTutorial } = useTutorial();
  const [collapsed, setCollapsed] = useState(false);
  const [justCompleted, setJustCompleted] = useState<string | null>(null);

  const completedCount = completedSteps.size;
  const totalCount = steps.length;

  // Flash "step complete" highlight for 1.5s when a new step is ticked
  useEffect(() => {
    const lastCompleted = [...completedSteps].at(-1);
    if (!lastCompleted) return;
    setJustCompleted(lastCompleted);
    const t = setTimeout(() => setJustCompleted(null), 1500);
    return () => clearTimeout(t);
  }, [completedSteps.size]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      className="fixed bottom-5 right-5 z-[150] w-64 border border-primary/40 bg-card/95 backdrop-blur-md shadow-xl font-mono animate-in fade-in slide-in-from-bottom-4 duration-500"
      style={{ boxShadow: "0 0 24px rgba(var(--primary-rgb),0.12)" }}
    >
      {/* Panel header */}
      <div className="border-b border-primary/20 px-3 py-2 flex items-center gap-2">
        <span className={`w-1.5 h-1.5 rounded-full ${allDone ? "bg-[#00ff88]" : "bg-primary animate-pulse"}`} />
        <span className="text-primary text-[10px] uppercase tracking-[0.15em] flex-1">
          {allDone ? "Mission Complete" : "Training Protocol"}
        </span>
        <span className="text-primary/40 text-[9px]">{completedCount}/{totalCount}</span>
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="text-primary/30 hover:text-primary/70 transition-colors ml-1"
          title={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
        <button
          onClick={dismissTutorial}
          className="text-primary/20 hover:text-primary/60 transition-colors"
          title="Dismiss tutorial"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Progress bar */}
      <div className="h-0.5 bg-primary/10">
        <div
          className="h-full bg-primary transition-all duration-700"
          style={{ width: `${(completedCount / totalCount) * 100}%` }}
        />
      </div>

      {!collapsed && (
        <div className="py-2">
          {allDone ? (
            // All done state
            <div className="px-3 py-3 space-y-3">
              <div className="text-[#00ff88] text-xs text-center font-bold tracking-wider">
                ALL SYSTEMS MASTERED
              </div>
              <p className="text-primary/50 text-[10px] text-center leading-relaxed">
                You're ready to operate Deck OS at full capacity. Press <kbd className="border border-primary/30 px-1 text-primary">?</kbd> any time for the reference guide.
              </p>
              <button
                onClick={dismissTutorial}
                className="w-full py-1.5 border border-[#00ff88]/40 bg-[#00ff88]/10 text-[#00ff88] text-[10px] uppercase tracking-widest hover:bg-[#00ff88]/20 transition-all"
              >
                Dismiss
              </button>
            </div>
          ) : (
            // Step list
            <div className="divide-y divide-primary/8">
              {steps.map((step) => {
                const done = completedSteps.has(step.id);
                const isCurrent = currentStep?.id === step.id;
                const isJustDone = justCompleted === step.id;

                return (
                  <div
                    key={step.id}
                    className={`px-3 py-2 flex items-start gap-2.5 transition-all duration-300 ${
                      isJustDone
                        ? "bg-primary/15"
                        : isCurrent
                        ? "bg-primary/8"
                        : done
                        ? "opacity-50"
                        : "opacity-40"
                    }`}
                  >
                    {done ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-[#00ff88] shrink-0 mt-px" />
                    ) : isCurrent ? (
                      <div className="w-3.5 h-3.5 shrink-0 mt-px flex items-center justify-center">
                        <span className="w-2 h-2 rounded-full border border-primary animate-pulse bg-primary/30" />
                      </div>
                    ) : (
                      <Circle className="w-3.5 h-3.5 text-primary/20 shrink-0 mt-px" />
                    )}
                    <div className="min-w-0">
                      <div className={`text-[10px] font-bold tracking-wide ${isCurrent ? "text-primary" : done ? "text-primary/60" : "text-primary/30"}`}>
                        {step.title}
                      </div>
                      {isCurrent && (
                        <div className="text-[9px] text-primary/50 leading-relaxed mt-0.5">
                          {step.desc}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Step Hint Callout ─────────────────────────────────────────────────────────
// A small floating callout that tells the user what action to take next.
// Appears near the sidebar for nav-based steps, bottom-center for action steps.

function StepHint() {
  const { currentStep } = useTutorial();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!currentStep?.actionHint) { setVisible(false); return; }
    // Small delay before showing the hint
    const t = setTimeout(() => setVisible(true), 400);
    return () => { clearTimeout(t); setVisible(false); };
  }, [currentStep?.id, currentStep?.actionHint]);

  if (!currentStep?.actionHint || !visible) return null;

  // Action steps (send_message) → bottom-center hint
  // Nav steps → left-side hint near sidebar
  const isActionStep = currentStep.completedBy === "ws_event";

  if (isActionStep) {
    return (
      <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[140] pointer-events-none animate-in fade-in slide-in-from-bottom-2 duration-300">
        <div
          className="border border-primary/50 bg-card/95 backdrop-blur-sm px-4 py-2.5 font-mono text-xs flex items-center gap-2.5 shadow-lg"
          style={{ boxShadow: "0 0 16px rgba(var(--primary-rgb),0.25)" }}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse shrink-0" />
          <span className="text-primary/70">{currentStep.actionHint}</span>
        </div>
        {/* Arrow pointing down */}
        <div className="flex justify-center mt-1">
          <div className="w-px h-4 bg-primary/30" />
        </div>
        <div className="flex justify-center">
          <div className="w-2 h-2 border-b-2 border-r-2 border-primary/30 rotate-45 -mt-1.5" />
        </div>
      </div>
    );
  }

  // Nav step — position to the right of the sidebar (sidebar is w-52 = 208px)
  return (
    <div
      className="fixed z-[140] pointer-events-none animate-in fade-in slide-in-from-left-2 duration-300"
      style={{ left: 220, top: "50%", transform: "translateY(-50%)" }}
    >
      <div className="flex items-center gap-2">
        {/* Arrow from sidebar */}
        <div className="flex items-center">
          <div className="h-px w-6 bg-primary/40" />
          <div className="w-0 h-0 border-t-4 border-b-4 border-t-transparent border-b-transparent" style={{ borderLeftWidth: 6, borderLeftStyle: "solid", borderLeftColor: "hsl(var(--primary) / 0.5)" }} />
        </div>
        <div
          className="border border-primary/50 bg-card/95 backdrop-blur-sm px-3 py-2 font-mono max-w-[180px]"
          style={{ boxShadow: "0 0 16px rgba(var(--primary-rgb),0.2)" }}
        >
          <div className="text-primary text-[9px] uppercase tracking-widest mb-1">Next step</div>
          <div className="text-primary/70 text-[10px] leading-relaxed">{currentStep.actionHint}</div>
        </div>
      </div>
    </div>
  );
}

// ── Main Export ───────────────────────────────────────────────────────────────

export function TutorialOverlay() {
  const { phase } = useTutorial();

  if (phase === "dismissed") return null;
  if (phase === "prompt") return <TutorialPrompt />;

  return (
    <>
      <QuestPanel />
      <StepHint />
    </>
  );
}
