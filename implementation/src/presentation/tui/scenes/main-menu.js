const MAIN_MENU_ITEMS = Object.freeze([
  { sceneId: "continue", label: "Continue", statusText: "loading..." },
  { sceneId: "newWork", label: "New Work", statusText: "..." },
  { sceneId: "workers", label: "Workers", statusText: "..." },
  { sceneId: "profiles", label: "Profiles", statusText: "..." },
  { sceneId: "settings", label: "Settings", statusText: "..." },
  { sceneId: "help", label: "Help", statusText: "..." },
]);

function normalizeSelectionIndex(index) {
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

export function getMainMenuRows(state) {
  const selectedIndex = normalizeSelectionIndex(state?.selectedIndex ?? 0);
  return MAIN_MENU_ITEMS.map((item, index) => ({
    sceneId: item.sceneId,
    label: item.label,
    statusText: item.statusText,
    isActive: index === selectedIndex,
    index,
  }));
}

export function getSelectedMainMenuItem(state) {
  const selectedIndex = normalizeSelectionIndex(state?.selectedIndex ?? 0);
  return MAIN_MENU_ITEMS[selectedIndex];
}

export function moveMainMenuSelection(state, delta) {
  const selectedIndex = normalizeSelectionIndex((state?.selectedIndex ?? 0) + delta);
  return { selectedIndex };
}

export function jumpMainMenuSelection(state, oneBasedIndex) {
  const target = Number.parseInt(String(oneBasedIndex), 10);
  if (!Number.isInteger(target) || target < 1 || target > MAIN_MENU_ITEMS.length) {
    return state ?? createMainMenuSceneState();
  }
  return { selectedIndex: target - 1 };
}

export function handleMainMenuInput(state, rawInput) {
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
