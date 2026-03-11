import { useState } from 'react';
import { ReactFlow, ReactFlowProvider, Background, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

// ── 診断パターン切り替え ──────────────────────────────────────────────
// panOnScroll, nodeCount, backgroundVisible を変えて重さを比較する

const PATTERN: 'A' | 'B' | 'C' | 'D' | 'E' = 'A';

const PATTERNS = {
  // A: panOnScroll=true、ノード2個、Background あり（デフォルト）
  A: { panOnScroll: true, nodes: 2, bg: true },
  // B: panOnScroll=false（ズームのみ）
  B: { panOnScroll: false, nodes: 2, bg: true },
  // C: Background なし
  C: { panOnScroll: true, nodes: 2, bg: false },
  // D: ノード0個
  D: { panOnScroll: true, nodes: 0, bg: true },
  // E: panOnDrag=true（2本指パン無効、代わりにドラッグパン）
  E: { panOnScroll: false, nodes: 2, bg: true },
} as const;

const cfg = PATTERNS[PATTERN];

function makeNodes(count: number): Node[] {
  return Array.from({ length: count }, (_, i) => ({
    id: String(i + 1),
    position: { x: i * 220, y: 0 },
    data: { label: `Node ${i + 1}` },
  }));
}

const nodes = makeNodes(cfg.nodes);

function Flow() {
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={[]}
          panOnScroll={cfg.panOnScroll}
          panOnDrag={PATTERN === 'E'}
          proOptions={{ hideAttribution: true }}
        >
          {cfg.bg && <Background size={2} />}
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}

function App() {
  const [active, setActive] = useState(PATTERN);

  return (
    <div style={{ position: 'relative' }}>
      {/* パターン切替パネル */}
      <div
        style={{
          position: 'fixed',
          top: 8,
          left: 8,
          zIndex: 999,
          display: 'flex',
          gap: 4,
          background: 'rgba(255,255,255,0.9)',
          padding: '4px 8px',
          borderRadius: 8,
          boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
          fontSize: 12,
        }}
      >
        {(Object.keys(PATTERNS) as Array<keyof typeof PATTERNS>).map((key) => (
          <button
            key={key}
            onClick={() => setActive(key)}
            style={{
              padding: '2px 8px',
              borderRadius: 4,
              border: '1px solid #ccc',
              background: active === key ? '#3b82f6' : '#fff',
              color: active === key ? '#fff' : '#333',
              cursor: 'pointer',
            }}
          >
            {key}
          </button>
        ))}
        <span style={{ marginLeft: 8, color: '#666' }}>
          現在: {active} | panOnScroll={String(PATTERNS[active].panOnScroll)} nodes=
          {PATTERNS[active].nodes} bg={String(PATTERNS[active].bg)}
        </span>
      </div>

      <Flow key={active} />
    </div>
  );
}

export default App;
