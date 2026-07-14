import { useState, useEffect } from "react";
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
import { ReturnToFace } from "@/components/ReturnToFace";
import { PlugInWatcher } from "@/components/PlugInWatcher";
import { getInputMode } from "@/genesis/micAccess";
import { SetupGuideModal } from "@/components/SetupGuideModal";
import { TutorialProvider } from "@/contexts/TutorialContext";
import { TutorialOverlay } from "@/components/TutorialOverlay";
import NotFound from "@/pages/not-found";

import Dashboard from "@/pages/Dashboard";
import AiControl from "@/pages/AiControl";
import AiPersonality from "@/pages/AiPersonality";
import PluginManager from "@/pages/PluginManager";
import PluginStore from "@/pages/PluginStore";
import MemorySystem from "@/pages/MemorySystem";
import DeviceControl from "@/pages/DeviceControl";
import CommandConsole from "@/pages/CommandConsole";
import MapView from "@/pages/MapView";
import RoutinesPage from "@/pages/RoutinesPage";
import BriefingsPage from "@/pages/BriefingsPage";
import SettingsPage from "@/pages/Settings";
import TimelinePage from "@/pages/TimelinePage";
import LieDetector from "@/pages/LieDetector";

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

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={AiControl} />
        <Route path="/hud" component={Dashboard} />
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
  const robotMode = experienceMode === "robot";

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
  const onboarding = !started || !setupDone || !introDone || !inputChosen;
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
