import React, { useState, useEffect } from 'react';
import {apiRequest,acceptSession,restoreSession} from './api';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Authors from './components/Authors';
import About from './components/About';
import Login from './components/Login';
import Articles from './components/Articles';
import CategoryArticles from './components/CategoryArticles';
import SavedArticles from './components/SavedArticles';
import Article from './components/Article';
import NavBar from './components/NavBar';
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
        <main>
          {sessionError && <p role="alert">{sessionError}</p>}
          <Routes>
            <Route path="/editor" element={sessionLoading ? <p role="status">Checking session...</p> : userId ? <React.Suspense fallback={<p role="status">Loading research desk...</p>}><ResearchDesk /></React.Suspense> : <Navigate to="/login" />} />
            <Route path="/" element={<Articles userId={userId} />} />
            <Route path="/category/:name" element={<CategoryArticles userId={userId} />} />
            <Route path="/login" element={sessionLoading ? <p role="status">Checking session...</p> : userId ? <Navigate to="/" /> : <Login onLogin={handleLogin} />} />
            <Route path="/saved" element={sessionLoading ? <p role="status">Checking session...</p> : userId ? <SavedArticles userId={userId} /> : <Navigate to="/login" />} />
            <Route path="/authors" element={<Authors />} />
            <Route path="/about" element={<About />} />
            <Route path="/articles/:id" element={<Article />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
