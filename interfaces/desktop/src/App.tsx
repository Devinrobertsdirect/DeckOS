import { useState, useEffect, lazy, Suspense } from "react";
import { motion } from "framer-motion";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/Layout";
import { VisualModeProvider } from "@/contexts/VisualMode";
import { WebSocketProvider } from "@/contexts/WebSocketContext";
import { applyColor, applyHexColor, getStoredColor } from "@/components/Onboarding";
import { StartScreen } from "@/components/StartScreen";
import { GenesisSetup } from "@/genesis/GenesisSetup";
import { GenesisIntro } from "@/genesis/GenesisIntro";
import { InputChoice } from "@/genesis/InputChoice";
import { PetShell } from "@/pet/PetShell";
import { FacesGallery } from "@/collection/FacesGallery";
import { isSetupDone, isIntroDone, useUiMode, setUiMode, useExperienceMode, getBotName, syncBotNameToServer } from "@/lib/uiMode";
import { getScreenMode } from "@/lib/screenMode";
import { ReturnToFace } from "@/components/ReturnToFace";
import { PlugInWatcher } from "@/components/PlugInWatcher";
import { getInputMode } from "@/genesis/micAccess";
import { SetupGuideModal } from "@/components/SetupGuideModal";
import { TutorialProvider } from "@/contexts/TutorialContext";
import { TutorialOverlay } from "@/components/TutorialOverlay";
import NotFound from "@/pages/not-found";

// Settings stays EAGER on purpose: it's how the robot fixes its own WiFi, so it
// must never depend on a lazy chunk fetch succeeding.
import SettingsPage from "@/pages/Settings";

// Developer pages load on demand so the cold-boot critical path (StartScreen ->
// Genesis -> PetShell face) parses a much smaller initial chunk on the Pi. The
// heavy vendors these pull in (leaflet via Dashboard/MapView, recharts via
// DeviceControl, react-window via TimelinePage) only download when the page mounts.
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const Analytics = lazy(() => import("@/pages/Analytics"));
const AiControl = lazy(() => import("@/pages/AiControl"));
const AiPersonality = lazy(() => import("@/pages/AiPersonality"));
const PluginManager = lazy(() => import("@/pages/PluginManager"));
const PluginStore = lazy(() => import("@/pages/PluginStore"));
const MemorySystem = lazy(() => import("@/pages/MemorySystem"));
const DeviceControl = lazy(() => import("@/pages/DeviceControl"));
const CommandConsole = lazy(() => import("@/pages/CommandConsole"));
const MapView = lazy(() => import("@/pages/MapView"));
const RoutinesPage = lazy(() => import("@/pages/RoutinesPage"));
const BriefingsPage = lazy(() => import("@/pages/BriefingsPage"));
const TimelinePage = lazy(() => import("@/pages/TimelinePage"));
const LieDetector = lazy(() => import("@/pages/LieDetector"));

const _storedHex = localStorage.getItem("deckos_color_hex");
if (_storedHex) {
  applyHexColor(_storedHex);
} else {
  applyColor(getStoredColor());
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

function CollectionPage() {
  const [, navigate] = useLocation();
  return <FacesGallery onClose={() => navigate("/")} />;
}

// Shared fallback while a lazy page chunk loads: minimal centered pulse in the
// existing HUD style (Layout chrome stays up around it).
function RouteFallback() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
    </div>
  );
}

function Router() {
  return (
    <Layout>
      <Suspense fallback={<RouteFallback />}>
        <Switch>
          <Route path="/" component={AiControl} />
          <Route path="/hud" component={Dashboard} />
          <Route path="/analytics" component={Analytics} />
          <Route path="/ai" component={AiControl} />
          <Route path="/ai/personality" component={AiPersonality} />
          <Route path="/plugins" component={PluginManager} />
          <Route path="/plugins/store" component={PluginStore} />
          <Route path="/memory" component={MemorySystem} />
          <Route path="/devices" component={DeviceControl} />
          <Route path="/commands" component={CommandConsole} />
          <Route path="/map" component={MapView} />
          <Route path="/routines" component={RoutinesPage} />
          <Route path="/briefings" component={BriefingsPage} />
          <Route path="/settings" component={SettingsPage} />
          <Route path="/timeline" component={TimelinePage} />
          <Route path="/lie-detector" component={LieDetector} />
          <Route path="/collection" component={CollectionPage} />
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </Layout>
  );
}

function App() {
  const [started, setStarted] = useState(() => sessionStorage.getItem("deckos_session") === "1");
  // The Genesis sequence: set everything up, THEN a single fullscreen talking
  // face, THEN the app (Pet mode by default, Developer mode on demand).
  const [setupDone, setSetupDone] = useState(() => isSetupDone());
  const [introDone, setIntroDone] = useState(() => isIntroDone());
  // After the intro, Atlas asks "talk or type?" (which also grabs the mic).
  const [inputChosen, setInputChosen] = useState(() => getInputMode() !== null);
  const [uiMode] = useUiMode();
  const [experienceMode] = useExperienceMode();
  // A round (robot-head) screen with no explicit experience choice boots
  // face-LOCKED: the physical device IS a robot, so default it to robot mode.
  // An explicit stored choice always wins (either value), so a normal
  // rectangular screen — and every computer-mode boot — stays byte-identical.
  // We read the raw EXPERIENCE_KEY here (mirrored from lib/uiMode.ts) because
  // getExperienceMode() collapses "unset" into the "computer" default, and we
  // need to tell those two apart to honor "explicit choice wins".
  const experienceChosen = localStorage.getItem("atlas_experience_mode") !== null;
  const robotMode = experienceChosen
    ? experienceMode === "robot"
    : getScreenMode() === "round";

  function handleStart() {
    sessionStorage.setItem("deckos_session", "1");
    setStarted(true);
  }

  // Backfill the server with the chosen bot name on load, so every server-side
  // message (chat fallback, briefings, notifications) refers to the bot by name.
  useEffect(() => { syncBotNameToServer(getBotName()); }, []);

  // ── Onboarding: one calm, crossfading sequence up to "our buddy" ────────────
  // Each stage is keyed so the next one mounts and fades IN immediately (no
  // AnimatePresence exit callback — that stalls under React 19 for this app).
  // Robot mode boots STRAIGHT to the wakeable face: skip the whole StartScreen →
  // setup → intro → input gate. Keys/name default safely and stay reachable later
  // (settings), so we never block the face on a fresh robot. Computer mode keeps
  // the exact onboarding flow unchanged.
  const onboarding = !robotMode && (!started || !setupDone || !introDone || !inputChosen);
  const stageKey = !started
    ? "start"
    : !setupDone
      ? "setup"
      : !introDone
        ? "intro"
        : "input";
  const stageContent = !started ? (
    <StartScreen onStart={handleStart} />
  ) : !setupDone ? (
    <GenesisSetup onComplete={() => setSetupDone(true)} />
  ) : !introDone ? (
    <GenesisIntro onComplete={() => setIntroDone(true)} />
  ) : (
    <InputChoice onComplete={() => setInputChosen(true)} />
  );

  return (
    <VisualModeProvider>
      <WebSocketProvider>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            {onboarding ? (
              <motion.div
                key={stageKey}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.45, ease: "easeOut" }}
                className="fixed inset-0"
              >
                {stageContent}
              </motion.div>
            ) : robotMode || uiMode === "pet" ? (
              // Robot mode is face-LOCKED: never leave the face (dev/settings are
              // hidden), everything else runs in the background.
              <PetShell
                robotMode={robotMode}
                onOpenDeveloper={() => setUiMode("developer")}
              />
            ) : (
              <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
                <TutorialProvider>
                  <Router />
                  <SetupGuideModal />
                  <TutorialOverlay />
                  {/* Always-there way back to the face (computer mode only). */}
                  <ReturnToFace />
                </TutorialProvider>
              </WouterRouter>
            )}
            {!onboarding && <PlugInWatcher />}
            <Toaster />
          </TooltipProvider>
        </QueryClientProvider>
      </WebSocketProvider>
    </VisualModeProvider>
  );
}

export default App;
