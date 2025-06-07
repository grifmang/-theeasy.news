import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Authors from './components/Authors';
import About from './components/About';
import Login from './components/Login';
import Articles from './components/Articles';
import SavedArticles from './components/SavedArticles';
import NavBar from './components/NavBar';

function App() {
  const [userId, setUserId] = useState(() => localStorage.getItem('userId'));

  const handleLogout = () => {
    localStorage.removeItem('userId');
    setUserId(null);
  };

  return (
    <Router>
      <NavBar userId={userId} onLogout={handleLogout} />
      <Routes>
        <Route path="/" element={<Articles userId={userId} />} />
        <Route path="/login" element={<Login onLogin={setUserId} />} />
        <Route path="/saved" element={<SavedArticles userId={userId} />} />
        <Route path="/authors" element={<Authors />} />
        <Route path="/about" element={<About />} />
      </Routes>
    </Router>
  );
}

export default App;
