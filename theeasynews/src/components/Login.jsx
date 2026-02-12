import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GoogleLogin } from '@react-oauth/google';

const API = process.env.REACT_APP_API_URL || '';

const Login = ({ onLogin }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isRegister, setIsRegister] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!username.trim()) { setError('Username is required'); return; }
    if (!password) { setError('Password is required'); return; }
    if (isRegister && password.length < 6) { setError('Password must be at least 6 characters'); return; }

    setSubmitting(true);
    try {
      const endpoint = isRegister ? '/api/register' : '/api/login';
      const res = await fetch(`${API}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password })
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Unable to authenticate');
        setSubmitting(false);
        return;
      }
      if (data.userId) {
        localStorage.setItem('userId', data.userId);
        if (data.token) localStorage.setItem('token', data.token);
        onLogin(data.userId);
        navigate('/');
      }
    } catch {
      setError('Network error. Please try again.');
    }
    setSubmitting(false);
  };

  const handleGoogleSuccess = async (cred) => {
    setError('');
    try {
      const res = await fetch(`${API}/api/google-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: cred.credential })
      });
      const data = await res.json();
      if (res.ok && data.userId) {
        localStorage.setItem('userId', data.userId);
        if (data.token) localStorage.setItem('token', data.token);
        onLogin(data.userId);
        navigate('/');
      } else {
        setError(data.error || 'Google login failed');
      }
    } catch {
      setError('Network error. Please try again.');
    }
  };

  return (
    <div className="login-container">
      <h1 className="page-title">{isRegister ? 'Create Account' : 'Welcome Back'}</h1>
      {error && <div className="error-message"><p>{error}</p></div>}
      <form onSubmit={handleSubmit}>
        <input
          placeholder="Username"
          value={username}
          onChange={e => setUsername(e.target.value)}
          autoComplete="username"
          aria-label="Username"
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          autoComplete={isRegister ? 'new-password' : 'current-password'}
          aria-label="Password"
        />
        <button type="submit" disabled={submitting}>
          {submitting ? 'Please wait...' : (isRegister ? 'Create Account' : 'Log In')}
        </button>
      </form>
      <button className="login-toggle" onClick={() => { setIsRegister(!isRegister); setError(''); }}>
        {isRegister ? 'Already have an account? Log in' : 'Need an account? Sign up'}
      </button>
      <div className="divider">or</div>
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <GoogleLogin
          onSuccess={handleGoogleSuccess}
          onError={() => setError('Google login failed')}
        />
      </div>
    </div>
  );
};

export default Login;
