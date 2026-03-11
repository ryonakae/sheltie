import { createContext, useContext, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';

import type { NavigationState } from '@/lib/tauri-bridge';
import type { DisplayMode } from '@/types';

import type { PositionCorrectionAnimationData } from './flow-types';

// ノードコンポーネントが data を介さずに取得するハンドラ群。
// data オブジェクトへの埋め込みをやめ Context で配信することで、
// buildFlowNode が生成する data の参照安定性を高めて不要な再レンダリングを防ぐ。
export interface SiteboardNodeHandlers {
  onGoBack: (nodeId: string) => void;
  onGoForward: (nodeId: string) => void;
  onReload: (nodeId: string) => void;
  onPinUrl: (nodeId: string) => void;
  onResizePreset: (nodeId: string, width: number, height: number) => void;
  onNavigated: (nodeId: string, url: string, title: string) => void;
  onTitleUpdated: (nodeId: string, title: string) => void;
  onWebviewCreated: (nodeId: string, label: string) => void;
  onWebviewDestroyed: (nodeId: string) => void;
  onWebviewLoaded: (nodeId: string) => void;
  onScreenshotPresented: (nodeId: string, url: string) => void;
  onScrollStarted: (nodeId: string) => void;
  onScrollEnded: (nodeId: string) => void;
  onUrlSubmit: (nodeId: string, url: string) => void;
  onResizeStart: (nodeId: string) => void;
  onResize: (nodeId: string, width: number, height: number) => void;
  onResizeEnd: (nodeId: string, width: number, height: number) => void;
  onPositionCorrectionAnimationComplete: (nodeId: string, token: number) => void;
  onAutoHeightChange: (nodeId: string, height: number) => void;
  onColorCycle: (nodeId: string) => void;
  onContentChange: (nodeId: string, content: string) => void;
}

const SiteboardNodeHandlersContext = createContext<SiteboardNodeHandlers | null>(null);

interface SiteboardNodeHandlersProviderProps {
  children: ReactNode;
  handlers: SiteboardNodeHandlers;
}

export function SiteboardNodeHandlersProvider({
  children,
  handlers,
}: SiteboardNodeHandlersProviderProps): ReactNode {
  return (
    <SiteboardNodeHandlersContext.Provider value={handlers}>
      {children}
    </SiteboardNodeHandlersContext.Provider>
  );
}

export function useSiteboardNodeHandlers(): SiteboardNodeHandlers {
  const handlers = useContext(SiteboardNodeHandlersContext);
  if (!handlers) {
    throw new Error('useSiteboardNodeHandlers must be used within SiteboardNodeHandlersProvider');
  }
  return handlers;
}

interface WebNodeRuntimeState {
  displayMode: DisplayMode;
  screenshotUrl: string | null;
  navState: NavigationState;
  positionCorrectionAnimation: PositionCorrectionAnimationData;
}

export interface SiteboardRuntimeStoreState {
  compactControlsHidden: boolean;
  webNodes: Record<string, WebNodeRuntimeState>;
}

export interface SiteboardRuntimeStore extends SiteboardRuntimeStoreState {
  syncWebNodeIds: (nodeIds: string[]) => void;
  setCompactControlsHidden: (hidden: boolean) => void;
  setNodeDisplayMode: (nodeId: string, mode: DisplayMode) => void;
  setNodeScreenshotUrl: (nodeId: string, url: string | null) => void;
  setNodeNavState: (nodeId: string, navState: NavigationState) => void;
  clearNodeNavState: (nodeId: string) => void;
  setPositionCorrectionAnimation: (
    nodeId: string,
    animation: PositionCorrectionAnimationData,
  ) => void;
  clearPositionCorrectionAnimation: (nodeId: string) => void;
  clearWebNodeRuntime: (nodeId: string) => void;
}

const DEFAULT_NAVIGATION_STATE: NavigationState = {
  can_go_back: false,
  can_go_forward: false,
};

export const EMPTY_POSITION_CORRECTION_ANIMATION: PositionCorrectionAnimationData = {
  token: null,
  fromX: null,
  fromY: null,
  toX: null,
  toY: null,
};

function createDefaultWebNodeRuntimeState(): WebNodeRuntimeState {
  return {
    displayMode: 'hidden',
    screenshotUrl: null,
    navState: DEFAULT_NAVIGATION_STATE,
    positionCorrectionAnimation: EMPTY_POSITION_CORRECTION_ANIMATION,
  };
}

function getOrCreateWebNodeRuntime(
  state: SiteboardRuntimeStoreState,
  nodeId: string,
): WebNodeRuntimeState {
  return state.webNodes[nodeId] ?? createDefaultWebNodeRuntimeState();
}

export function createSiteboardRuntimeStore(
  initialState?: Partial<SiteboardRuntimeStoreState>,
): StoreApi<SiteboardRuntimeStore> {
  return createStore<SiteboardRuntimeStore>()((set) => ({
    compactControlsHidden: initialState?.compactControlsHidden ?? false,
    webNodes: initialState?.webNodes ?? {},

    syncWebNodeIds: (nodeIds) =>
      set((state) => {
        const nextIds = new Set(nodeIds);
        let changed = false;
        const nextWebNodes: Record<string, WebNodeRuntimeState> = {};

        for (const nodeId of nodeIds) {
          const existing = state.webNodes[nodeId];
          if (existing) {
            nextWebNodes[nodeId] = existing;
            continue;
          }

          changed = true;
          nextWebNodes[nodeId] = createDefaultWebNodeRuntimeState();
        }

        for (const nodeId of Object.keys(state.webNodes)) {
          if (!nextIds.has(nodeId)) {
            changed = true;
            break;
          }
        }

        if (!changed) return state;
        return { webNodes: nextWebNodes };
      }),

    setCompactControlsHidden: (hidden) =>
      set((state) => {
        if (state.compactControlsHidden === hidden) return state;
        return { compactControlsHidden: hidden };
      }),

    setNodeDisplayMode: (nodeId, mode) =>
      set((state) => {
        const current = getOrCreateWebNodeRuntime(state, nodeId);
        if (current.displayMode === mode) return state;
        return {
          webNodes: {
            ...state.webNodes,
            [nodeId]: {
              ...current,
              displayMode: mode,
            },
          },
        };
      }),

    setNodeScreenshotUrl: (nodeId, url) =>
      set((state) => {
        const current = getOrCreateWebNodeRuntime(state, nodeId);
        if (current.screenshotUrl === url) return state;
        return {
          webNodes: {
            ...state.webNodes,
            [nodeId]: {
              ...current,
              screenshotUrl: url,
            },
          },
        };
      }),

    setNodeNavState: (nodeId, navState) =>
      set((state) => {
        const current = getOrCreateWebNodeRuntime(state, nodeId);
        if (
          current.navState.can_go_back === navState.can_go_back &&
          current.navState.can_go_forward === navState.can_go_forward
        ) {
          return state;
        }

        return {
          webNodes: {
            ...state.webNodes,
            [nodeId]: {
              ...current,
              navState,
            },
          },
        };
      }),

    clearNodeNavState: (nodeId) =>
      set((state) => {
        const current = state.webNodes[nodeId];
        if (!current) return state;
        if (
          current.navState.can_go_back === DEFAULT_NAVIGATION_STATE.can_go_back &&
          current.navState.can_go_forward === DEFAULT_NAVIGATION_STATE.can_go_forward
        ) {
          return state;
        }
        return {
          webNodes: {
            ...state.webNodes,
            [nodeId]: {
              ...current,
              navState: DEFAULT_NAVIGATION_STATE,
            },
          },
        };
      }),

    setPositionCorrectionAnimation: (nodeId, animation) =>
      set((state) => {
        const current = getOrCreateWebNodeRuntime(state, nodeId);
        const existing = current.positionCorrectionAnimation;
        if (
          existing.token === animation.token &&
          existing.fromX === animation.fromX &&
          existing.fromY === animation.fromY &&
          existing.toX === animation.toX &&
          existing.toY === animation.toY
        ) {
          return state;
        }

        return {
          webNodes: {
            ...state.webNodes,
            [nodeId]: {
              ...current,
              positionCorrectionAnimation: animation,
            },
          },
        };
      }),

    clearPositionCorrectionAnimation: (nodeId) =>
      set((state) => {
        const current = state.webNodes[nodeId];
        if (!current) return state;
        const existing = current.positionCorrectionAnimation;
        if (
          existing.token === null &&
          existing.fromX === null &&
          existing.fromY === null &&
          existing.toX === null &&
          existing.toY === null
        ) {
          return state;
        }

        return {
          webNodes: {
            ...state.webNodes,
            [nodeId]: {
              ...current,
              positionCorrectionAnimation: EMPTY_POSITION_CORRECTION_ANIMATION,
            },
          },
        };
      }),

    clearWebNodeRuntime: (nodeId) =>
      set((state) => {
        if (!(nodeId in state.webNodes)) return state;
        const { [nodeId]: _removed, ...rest } = state.webNodes;
        return { webNodes: rest };
      }),
  }));
}

const SiteboardRuntimeStoreContext = createContext<StoreApi<SiteboardRuntimeStore> | null>(null);

interface SiteboardRuntimeProviderProps {
  children: ReactNode;
  store: StoreApi<SiteboardRuntimeStore>;
}

export function SiteboardRuntimeProvider({
  children,
  store,
}: SiteboardRuntimeProviderProps): ReactNode {
  return (
    <SiteboardRuntimeStoreContext.Provider value={store}>
      {children}
    </SiteboardRuntimeStoreContext.Provider>
  );
}

export function useSiteboardRuntimeStore<T>(selector: (state: SiteboardRuntimeStore) => T): T {
  const store = useContext(SiteboardRuntimeStoreContext);
  if (!store) {
    throw new Error('useSiteboardRuntimeStore must be used within SiteboardRuntimeProvider');
  }
  return useStore(store, selector);
}

export function useSiteboardRuntimeStoreApi(): StoreApi<SiteboardRuntimeStore> {
  const store = useContext(SiteboardRuntimeStoreContext);
  if (!store) {
    throw new Error('useSiteboardRuntimeStoreApi must be used within SiteboardRuntimeProvider');
  }
  return store;
}
