// @ts-nocheck
import { createStatusProbeRegistry } from "../status-probes.ts";

export type MainMenuSceneId = "continue" | "newWork" | "workers" | "profiles" | "settings" | "help";

export type MainMenuState = {
  selectedIndex: number;
};

export type MainMenuItem = {
  sceneId: MainMenuSceneId;
  label: string;
  probeId: string;
};

const MAIN_MENU_ITEMS: readonly MainMenuItem[] = Object.freeze([
  { sceneId: "continue", label: "Continue", probeId: "continue" },
  { sceneId: "newWork", label: "New Work", probeId: "newWork" },
  { sceneId: "workers", label: "Workers", probeId: "workers" },
  { sceneId: "profiles", label: "Profiles", probeId: "profiles" },
  { sceneId: "settings", label: "Settings", probeId: "settings" },
  { sceneId: "help", label: "Help", probeId: "help" },
]);

const statusProbeRegistry = createStatusProbeRegistry();

function normalizeSelectionIndex(index: number): number {
  if (!Number.isInteger(index) || MAIN_MENU_ITEMS.length === 0) {
    return 0;
  }
  const limit = MAIN_MENU_ITEMS.length;
  return ((index % limit) + limit) % limit;
}

export function createMainMenuSceneState() {
  return { selectedIndex: 0 };
}

export function getMainMenuItems() {
  return MAIN_MENU_ITEMS;
}

export function getMainMenuRows(state: MainMenuState, { probeRegistry = statusProbeRegistry } = {}) {
  const selectedIndex = normalizeSelectionIndex(state?.selectedIndex ?? 0);
  return MAIN_MENU_ITEMS.map((item, index) => {
    const status = probeRegistry.getProbeStatus(item.probeId);
    const workersDrilldownHint = item.sceneId === "workers" ? "   (H: health · T: tools)" : "";
    return {
      sceneId: item.sceneId,
      label: item.label,
      statusText: `${status.text}${workersDrilldownHint}`,
      statusTone: status.tone,
      isActive: index === selectedIndex,
      index,
    };
  });
}

export async function refreshMainMenuStatuses({ probeRegistry = statusProbeRegistry } = {}) {
  await probeRegistry.refreshAllProbes();
}

export async function refreshMainMenuStatusProbe(probeId: string, { probeRegistry = statusProbeRegistry } = {}) {
  if (typeof probeId !== "string" || probeId.length === 0) {
    return;
  }
  await probeRegistry.refreshProbe(probeId);
}

export function getSelectedMainMenuItem(state: MainMenuState): MainMenuItem {
  const selectedIndex = normalizeSelectionIndex(state?.selectedIndex ?? 0);
  return MAIN_MENU_ITEMS[selectedIndex];
}

export function moveMainMenuSelection(state: MainMenuState, delta: number): MainMenuState {
  const selectedIndex = normalizeSelectionIndex((state?.selectedIndex ?? 0) + delta);
  return { selectedIndex };
}

export function jumpMainMenuSelection(state: MainMenuState, oneBasedIndex: string): MainMenuState {
  const target = Number.parseInt(String(oneBasedIndex), 10);
  if (!Number.isInteger(target) || target < 1 || target > MAIN_MENU_ITEMS.length) {
    return state ?? createMainMenuSceneState();
  }
  return { selectedIndex: target - 1 };
}

export function handleMainMenuInput(state: MainMenuState, rawInput: string) {
  const currentState = state ?? createMainMenuSceneState();
  const input = String(rawInput ?? "");
  const lowerInput = input.toLowerCase();
  const isEnter = input === "\r" || input === "\n";
  const isArrowUp = input === "\u001b[A";
  const isArrowDown = input === "\u001b[B";

  if (isArrowUp || lowerInput === "k") {
    return {
      handled: true,
      state: moveMainMenuSelection(currentState, -1),
      routeTo: null,
    };
  }

  if (isArrowDown || lowerInput === "j") {
    return {
      handled: true,
      state: moveMainMenuSelection(currentState, 1),
      routeTo: null,
    };
  }

  if (/^[1-9]$/.test(lowerInput)) {
    return {
      handled: true,
      state: jumpMainMenuSelection(currentState, lowerInput),
      routeTo: null,
    };
  }

  if (isEnter) {
    const selected = getSelectedMainMenuItem(currentState);
    return {
      handled: true,
      state: currentState,
      routeTo: selected?.sceneId ?? null,
    };
  }

  return {
    handled: false,
    state: currentState,
    routeTo: null,
  };
}
