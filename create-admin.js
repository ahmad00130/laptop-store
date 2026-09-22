const readline = require('readline');
const crypto = require('crypto');
const db = require('./db');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

rl.question('Admin username: ', (usernameInput) => {
  rl.question('Admin password (at least 10 characters): ', (password) => {
    const username = usernameInput.trim();

    if (!username || password.length < 10) {
      console.log('Username is required and the password must be at least 10 characters.');
      rl.close();
      return;
    }

    const passwordHash = hashPassword(password);
    const existing = db.prepare('SELECT id FROM admins WHERE username = ?').get(username);

    if (existing) {
      db.prepare('UPDATE admins SET password_hash = ? WHERE username = ?').run(passwordHash, username);
      console.log(`Password updated for "${username}".`);
    } else {
      db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run(username, passwordHash);
      console.log(`Admin "${username}" created.`);
    }

    rl.close();
  });
});