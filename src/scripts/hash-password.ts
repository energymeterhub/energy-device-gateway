import { getMinimumPasswordLength, hashPassword } from '../core/auth.ts';

const password = process.argv[2] ?? '';

if (!password) {
  console.error('Usage: npm run auth:hash -- "your-password"');
  process.exit(1);
}

if (password.length < getMinimumPasswordLength()) {
  console.error(`Password must be at least ${getMinimumPasswordLength()} characters`);
  process.exit(1);
}

console.log(hashPassword(password));
