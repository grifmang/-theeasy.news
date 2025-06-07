import React, { useState } from 'react';

const Login = ({ onLogin }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isRegister, setIsRegister] = useState(false);
  const [error, setError] = useState('');
  const API = process.env.REACT_APP_API_URL;
  const handleSubmit = async (e) => {
    e.preventDefault();
    const endpoint = isRegister ? '/api/register' : '/api/login';
    const res = await fetch(`${API}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Unable to authenticate');
      return;
    }
    if (data.userId) {
      localStorage.setItem('userId', data.userId);
      setError('');
      onLogin(data.userId);
    }
  };
  return (
    <div className="container">
      <h1 className="page-title">{isRegister ? 'Register' : 'Login'}</h1>
      <form onSubmit={handleSubmit}>
        <input
          placeholder="Username"
          value={username}
          onChange={e => setUsername(e.target.value)}
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={e => setPassword(e.target.value)}
        />
        <button type="submit">Submit</button>
      </form>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <button onClick={() => setIsRegister(!isRegister)}>
        {isRegister ? 'Have an account? Login' : 'Need an account? Register'}
      </button>
    </div>
  );
};

export default Login;
