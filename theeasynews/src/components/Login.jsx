import React, { useState } from 'react';

const Login = ({ onLogin }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isRegister, setIsRegister] = useState(false);
  const handleSubmit = async (e) => {
    e.preventDefault();
    const endpoint = isRegister ? '/api/register' : '/api/login';
    const res = await fetch(`http://localhost:4000${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (data.userId) {
      localStorage.setItem('userId', data.userId);
      onLogin(data.userId);
    } else if (data.message && data.userId === undefined && !isRegister) {
      // login endpoint returns message but we want userId
      onLogin(data.userId);
    }
  };
  return (
    <div>
      <h1>{isRegister ? 'Register' : 'Login'}</h1>
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
      <button onClick={() => setIsRegister(!isRegister)}>
        {isRegister ? 'Have an account? Login' : 'Need an account? Register'}
      </button>
    </div>
  );
};

export default Login;
