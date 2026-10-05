import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const root = document.getElementById('root');

function StartupScreen({ error }) {
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '32px', background: '#f7fafc', color: '#0b1f33', fontFamily: 'Arial, sans-serif' }}>
      <section style={{ width: 'min(680px, 100%)', padding: '28px', border: '1px solid #dce5ec', borderRadius: '18px', background: '#fff', boxShadow: '0 18px 50px rgba(11,31,51,.10)' }}>
        <p style={{ margin: '0 0 8px', color: error ? '#dc2626' : '#2563eb', fontWeight: 700 }}>{error ? 'Carewell could not start' : 'Carewell'}</p>
        <h1 style={{ margin: '0 0 12px', fontSize: '28px' }}>{error ? 'The page encountered a startup error.' : 'Loading your care portal…'}</h1>
        {error && <pre style={{ margin: 0, padding: '14px', overflow: 'auto', borderRadius: '10px', background: '#f1f5f9', color: '#7f1d1d', whiteSpace: 'pre-wrap' }}>{error}</pre>}
      </section>
    </main>
  );
}

async function start() {
  if (!root) {
    document.body.innerHTML = '<main style="padding:32px;font-family:Arial,sans-serif">Carewell could not find the application root.</main>';
    return;
  }

  const appRoot = createRoot(root);
  appRoot.render(<StartupScreen />);

  try {
    const [{ default: App }, ReactModule] = await Promise.all([
      import('./App.jsx'),
      import('react')
    ]);
    const ErrorBoundary = class extends ReactModule.default.Component {
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
        return this.state.error
          ? <StartupScreen error={this.state.error instanceof Error ? this.state.error.message : String(this.state.error)} />
          : this.props.children;
      }
    };
    appRoot.render(
      <ReactModule.StrictMode>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </ReactModule.StrictMode>
    );
  } catch (error) {
    console.error('Carewell failed during startup:', error);
    appRoot.render(<StartupScreen error={error instanceof Error ? error.message : String(error)} />);
  }
}

start();
