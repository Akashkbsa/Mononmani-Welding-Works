import { Component, ErrorInfo, ReactNode } from "react";
import { Button } from "./ui";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** Keeps one broken screen from taking down the whole window. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Screen failed to render:", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="max-w-md mx-auto mt-20 text-center space-y-3">
        <h2 className="text-base font-semibold text-slate-900">This screen could not be shown</h2>
        <p className="text-sm text-slate-600">Your records are safe. Try again, or restart the app if it keeps happening.</p>
        <p className="text-xs text-slate-500 font-mono break-words">{this.state.error.message}</p>
        <Button variant="primary" onClick={() => this.setState({ error: null })}>
          Try again
        </Button>
      </div>
    );
  }
}
