import React from "react";

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ error, errorInfo });
    // Optional: send error to server or log file
    fetch("/api/report-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: error.toString(), errorInfo })
    }).catch(() => {});
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 32, color: "#b00", background: "#fff0f0" }}>
          <h2>משהו השתבש 😢</h2>
          <pre style={{ whiteSpace: "pre-wrap" }}>{this.state.error?.toString()}</pre>
          <details style={{ whiteSpace: "pre-wrap" }}>
            {this.state.errorInfo?.componentStack}
          </details>
          <button onClick={() => window.location.reload()}>רענן את הדף</button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
