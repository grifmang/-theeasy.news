import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Authors from './components/Authors';
import About from './components/About';
import Login from './components/Login';
import Articles from './components/Articles';
import CategoryArticles from './components/CategoryArticles';
import SavedArticles from './components/SavedArticles';
import Article from './components/Article';
import NavBar from './components/NavBar';

function App() {
  const [userId, setUserId] = useState(() => localStorage.getItem('userId'));

  const handleLogin = (id) => {
    localStorage.setItem('userId', id);
    setUserId(id);
  };

  const handleLogout = () => {
    localStorage.removeItem('userId');
    localStorage.removeItem('token');
    setUserId(null);
  };

  return (
    <Router>
      <div className="app">
        <NavBar userId={userId} onLogout={handleLogout} />
        <main>
          <Routes>
            <Route path="/" element={<Articles userId={userId} />} />
            <Route path="/category/:name" element={<CategoryArticles userId={userId} />} />
            <Route path="/login" element={userId ? <Navigate to="/" /> : <Login onLogin={handleLogin} />} />
            <Route path="/saved" element={userId ? <SavedArticles userId={userId} /> : <Navigate to="/login" />} />
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
