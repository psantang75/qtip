import bcrypt from 'bcrypt';

// Password to hash
const plainPassword = 'pass1234';

// Hash the password
async function hashPassword() {
  try {
    const saltRounds = 10;
    const hash = await bcrypt.hash(plainPassword, saltRounds);
    console.log(`Password: ${plainPassword}`);
    console.log(`Hash: ${hash}`);
  } catch (err) {
    console.error('Error hashing password:', err);
  }
}

hashPassword(); 