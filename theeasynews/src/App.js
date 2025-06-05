import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import ArticleList from './components/ArticleList';
import SavedArticles from './components/SavedArticles';
import LoginForm from './components/LoginForm';

function App() {
  const [userId, setUserId] = useState(null);

  if (!userId) return <LoginForm onLogin={setUserId} />;

  return (
    <Router>
      <nav style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
        <Link to="/">Home</Link>
        <Link to="/saved">Saved</Link>
      </nav>
      <Routes>
        <Route path="/" element={<ArticleList userId={userId} />} />
        <Route path="/saved" element={<SavedArticles userId={userId} />} />
      </Routes>
    </Router>
  );
}

export default App;
