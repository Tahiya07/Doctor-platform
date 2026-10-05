import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

class StartupErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Carewell failed to render:', error, info);
  }

  render() {
    if (this.state.error) {
      const message = this.state.error instanceof Error ? this.state.error.message : String(this.state.error);
      return (
        <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '32px', background: '#f7fafc', color: '#0b1f33', fontFamily: 'Arial, sans-serif' }}>
          <section style={{ width: 'min(680px, 100%)', padding: '28px', border: '1px solid #dce5ec', borderRadius: '18px', background: '#fff', boxShadow: '0 18px 50px rgba(11,31,51,.10)' }}>
            <p style={{ margin: '0 0 8px', color: '#dc2626', fontWeight: 700 }}>Carewell could not start</p>
            <h1 style={{ margin: '0 0 12px', fontSize: '28px' }}>The page encountered a startup error.</h1>
            <p style={{ margin: '0 0 16px', color: '#526579' }}>The GitHub Pages deployment is running, but the browser encountered an error while loading the React application.</p>
            <pre style={{ margin: 0, padding: '14px', overflow: 'auto', borderRadius: '10px', background: '#f1f5f9', color: '#7f1d1d', whiteSpace: 'pre-wrap' }}>{message}</pre>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}

const root = document.getElementById('root');

if (!root) {
  document.body.innerHTML = '<main style="padding:32px;font-family:Arial,sans-serif">Carewell could not find the application root.</main>';
} else {
  createRoot(root).render(
    <React.StrictMode>
      <StartupErrorBoundary>
        <App />
      </StartupErrorBoundary>
    </React.StrictMode>
  );
}
