import "./Safe3D.css";
import { Component, Suspense, lazy, type ReactNode } from "react";
import type { BoardProps } from "../components/Board";

const Board3D = lazy(() => import("./Board3D"));

export function hasWebGL() {
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

class Fallback extends Component<{ fallback: ReactNode; onFail: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onFail();
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export default function Safe3D({ props, fallback, onFail }: { props: BoardProps; fallback: ReactNode; onFail: () => void }) {
  return (
    <Fallback fallback={fallback} onFail={onFail}>
      <Suspense fallback={<div className="board3d-loading">Setting up the 3D board…</div>}>
        <Board3D {...props} />
      </Suspense>
    </Fallback>
  );
}
