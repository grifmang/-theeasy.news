import React, { useState } from 'react';

const LoginForm = ({ onLogin }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const API = process.env.REACT_APP_API_URL;

  const submit = e => {
    e.preventDefault();
    fetch(`${API}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    })
      .then(res => res.ok ? res.json() : Promise.reject('invalid'))
      .then(data => { setError(null); onLogin(data.id); })
      .catch(() => setError('Invalid credentials'));
  };

  return (
    <form onSubmit={submit}>
      <h2>Login</h2>
      {error && <p style={{color:'red'}}>{error}</p>}
      <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" />
      <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" />
      <button type="submit">Login</button>
    </form>
  );
};

export default LoginForm;
