/**
 * Flowchart visualizer (P1D).
 *
 * Reads the dependency map computed by the shared analyzer and renders it
 * as a React Flow graph. Each non-structural survey row becomes a node;
 * dependencies (relevant/calculation/constraint/choice_filter/repeat_count/default)
 * become edges. Read-only.
 */
import { useEffect, useMemo, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MarkerType,
  type Edge,
  type Node,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { buildDependencyMap, isStructural, type XLSForm } from '@cht-ui/shared';
import { api } from '../api.js';
import { useApp } from '../state/store.js';

export function FlowchartView({ formId }: { formId: string }) {
  const setError = useApp((s) => s.setError);
  const setView = useApp((s) => s.setView);
  const [form, setForm] = useState<XLSForm | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .getForm(formId)
      .then((res) => {
        if (!alive) return;
        setForm(res.form);
        setLoading(false);
      })
      .catch((e: Error) => {
        if (!alive) return;
        setError(e.message);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [formId, setError]);

  const { nodes, edges } = useMemo(() => {
    if (!form) return { nodes: [], edges: [] };
    return buildGraph(form);
  }, [form]);

  return (
    <div className="flowchart-view">
      <header className="page-header">
        <h1>Logic graph: {formId}</h1>
        <button className="link" onClick={() => setView({ kind: 'form', id: formId })}>
          ← back to form
        </button>
      </header>
      {loading && <div className="loading">Loading…</div>}
      {!loading && form && (
        <>
          <p className="muted">
            Nodes are questions. Edges go from a referenced field to the field that depends on it
            (relevant, calculation, constraint, choice_filter, repeat_count, default).
          </p>
          <div style={{ height: 'calc(100vh - 200px)' }}>
            <ReactFlow nodes={nodes} edges={edges} fitView attributionPosition="bottom-right">
              <Background />
              <Controls />
            </ReactFlow>
          </div>
        </>
      )}
    </div>
  );
}

function buildGraph(form: XLSForm): { nodes: Node[]; edges: Edge[] } {
  const dependencyMap = buildDependencyMap(form);

  // Layout: a simple top-down stacking based on row order.
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const nameToRowId = new Map<string, string>();
  for (const r of form.survey) {
    if (!isStructural(r) && r.name) nameToRowId.set(r.name, r.rowId);
  }

  let y = 0;
  for (let i = 0; i < form.survey.length; i++) {
    const row = form.survey[i];
    if (!row || isStructural(row)) continue;
    nodes.push({
      id: row.rowId,
      position: { x: ((i % 6) * 220), y },
      data: {
        label: (
          <div>
            <strong>{row.name}</strong>
            <div style={{ fontSize: 10, opacity: 0.75 }}>{row.type}</div>
          </div>
        ),
      },
      style: {
        background: row.required ? '#fff7e6' : '#ffffff',
        border: '1px solid #cbd5e0',
        borderRadius: 6,
        padding: 6,
        minWidth: 180,
      },
    });
    if (i % 6 === 5) y += 100;
  }

  for (const [rowId, refs] of dependencyMap) {
    for (const ref of refs) {
      const sourceRowId = nameToRowId.get(ref);
      if (!sourceRowId) continue;
      edges.push({
        id: `${sourceRowId}->${rowId}`,
        source: sourceRowId,
        target: rowId,
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { stroke: '#3b82f6' },
      });
    }
  }
  return { nodes, edges };
}
