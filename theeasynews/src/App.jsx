import React, { useState, useEffect } from 'react';
import {apiRequest,acceptSession,restoreSession} from './api';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Authors from './components/Authors';
import About from './components/About';
import Login from './components/Login';
import SavedArticles from './components/SavedArticles';
import PublicHome from './components/PublicHome';
import Topic from './components/Topic';
import Claim from './components/Claim';
import Analysis from './components/Analysis';
import Corrections from './components/Corrections';
import ReviewQueue from './components/ReviewQueue';
import ReviewDetail from './components/ReviewDetail';
import { LegacyArticleUnavailable } from './components/PublicReader';
import NavBar from './components/NavBar';
import './components/public-reader.css';
const ResearchDesk = React.lazy(() => import('./components/ResearchDesk'));

function App() {
  const [userId, setUserId] = useState(null);
  const [sessionLoading,setSessionLoading]=useState(true);
  const [sessionError,setSessionError]=useState('');
  useEffect(()=>{
    let active=true;
    localStorage.removeItem('token'); localStorage.removeItem('userId');
    restoreSession().then(session=>{if(active) setUserId(session?.userId || null);})
      .catch(()=>{if(active) setSessionError('Could not restore your session. Please sign in again.');})
      .finally(()=>{if(active) setSessionLoading(false);});
    return ()=>{active=false;};
  },[]);

  const handleLogin = (session) => {
    acceptSession(session); setSessionError('');
    setUserId(session.userId);
  };

  const handleLogout = async () => {
    try {await apiRequest('/api/logout',{method:'POST',body:{}});acceptSession(null);setUserId(null);}
    catch(error) {if(error.status===401) {acceptSession(null);setUserId(null);} else setSessionError('Logout failed. Please try again.');}
  };

  return (
    <Router>
      <div className="app">
        <NavBar userId={userId} onLogout={handleLogout} />
        <a className="reader-skip-link" href="#main-content">Skip to main content</a>
        <main id="main-content" tabIndex="-1">
          {sessionError && <p role="alert">{sessionError}</p>}
          <Routes>
            <Route path="/editor" element={sessionLoading ? <p role="status">Checking session...</p> : userId ? <React.Suspense fallback={<p role="status">Loading research desk...</p>}><ResearchDesk /></React.Suspense> : <Navigate to="/login" />} />
            <Route path="/editor/reviews" element={sessionLoading ? <p role="status">Checking session...</p> : userId ? <ReviewQueue /> : <Navigate to="/login" />} />
            <Route path="/editor/claims/:claimId/reviews/:versionId" element={sessionLoading ? <p role="status">Checking session...</p> : userId ? <ReviewDetail /> : <Navigate to="/login" />} />
            <Route path="/editor/reviews/:versionId" element={sessionLoading ? <p role="status">Checking session...</p> : userId ? <ReviewDetail /> : <Navigate to="/login" />} />
            <Route path="/" element={<PublicHome />} />
            <Route path="/topics/:slug" element={<Topic />} />
            <Route path="/claims/:id" element={<Claim />} />
            <Route path="/analyses/:slug" element={<Analysis userId={userId} />} />
            <Route path="/corrections" element={<Corrections />} />
            <Route path="/login" element={sessionLoading ? <p role="status">Checking session...</p> : userId ? <Navigate to="/" /> : <Login onLogin={handleLogin} />} />
            <Route path="/saved" element={sessionLoading ? <p role="status">Checking session...</p> : userId ? <SavedArticles userId={userId} /> : <Navigate to="/login" />} />
            <Route path="/authors" element={<Authors />} />
            <Route path="/about" element={<About />} />
            <Route path="/articles/:id" element={<LegacyArticleUnavailable />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
