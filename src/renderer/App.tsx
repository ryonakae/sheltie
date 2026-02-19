import { useReducer } from 'react';

import { Canvas } from './components/Canvas/Canvas';
import { TabBar } from './components/TabBar/TabBar';
import { createInitialState, tabReducer } from './hooks/useTabReducer';
import { HOME_ID } from './types/tab';

export default function App() {
  const [state, dispatch] = useReducer(tabReducer, null, createInitialState);

  const activeTab = state.tabs.find((t) => t.id === state.activeId);
  const isHome = state.activeId === HOME_ID;

  return (
    <div className="flex h-full flex-col">
      <TabBar tabs={state.tabs} activeId={state.activeId} dispatch={dispatch} />
      {isHome ? (
        <div className="flex flex-1 items-center justify-center">
          <span className="text-2xl font-semibold text-gray-400">Browser Artboard</span>
        </div>
      ) : (
        <Canvas
          key={state.activeId}
          sidebarWidth={activeTab?.sidebarWidth ?? 320}
          onSidebarWidthChange={(width) =>
            dispatch({ type: 'UPDATE_SIDEBAR_WIDTH', id: state.activeId, width })
          }
        />
      )}
    </div>
  );
}
