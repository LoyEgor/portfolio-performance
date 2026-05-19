import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import PortfolioTracker from './portfolio_tracker.jsx';

// No <React.StrictMode> on purpose — keeps dev logs clean while the app does its own
// data loading via fetch in a useEffect.
ReactDOM.createRoot(document.getElementById('root')).render(<PortfolioTracker />);
