import { Component, type ReactNode } from 'react'

export function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas')
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')))
  } catch {
    return false
  }
}

class Boundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

/** Render 3D only where WebGL works; otherwise (or if the context fails later) render the fallback. */
export function WebGLOnly({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) {
  if (!hasWebGL()) return <>{fallback}</>
  return <Boundary fallback={fallback}>{children}</Boundary>
}
