import { useReducer } from 'react';

import { Canvas } from './components/Canvas/Canvas';
import { TabBar } from './components/TabBar/TabBar';
import { createInitialState, tabReducer } from './hooks/useTabReducer';
import { HOME_ID } from './types/tab';

export default function App() {
  const [state, dispatch] = useReducer(tabReducer, null, createInitialState);

  const activeTab = state.tabs.find((t) => t.id === state.activeId);
  const activeSidebarWidth =
    state.activeId === HOME_ID ? state.homeSidebarWidth : (activeTab?.sidebarWidth ?? 320);

  return (
    <div className="flex h-full flex-col">
      <TabBar tabs={state.tabs} activeId={state.activeId} dispatch={dispatch} />
      <Canvas
        key={state.activeId}
        sidebarWidth={activeSidebarWidth}
        onSidebarWidthChange={(width) =>
          dispatch({ type: 'UPDATE_SIDEBAR_WIDTH', id: state.activeId, width })
        }
      />
    </div>
  );
}
