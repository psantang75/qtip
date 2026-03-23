import jwt from 'jsonwebtoken';
import pool from './config/database';
import { RowDataPacket } from 'mysql2';

// JWT secret key
const JWT_SECRET = process.env.JWT_SECRET || 'qtip_secret_key';

/**
 * Script to refresh auth tokens for all active users by creating new tokens with extended expiration
 */
async function refreshAuthTokens() {
  try {
    console.log('Starting auth token refresh process...');

    // Get all active users
    const [users] = await pool.execute(
      'SELECT id, role_id FROM users WHERE is_active = 1'
    );

    console.log(`Found ${users.length} active users to refresh tokens for`);

    // Generate new tokens for each user with extended expiration
    const refreshedTokens: { user_id: number, role_name: string, token: string }[] = [];

    for (const user of users) {
      try {
        // Create new token with 24-hour expiration
        const token = jwt.sign(
          { user_id: user.id, role_id: user.role_id },
          JWT_SECRET,
          { expiresIn: '24h' }
        );

        // Get role name
        let role_name = 'User';
        if (user.role_id === 1) role_name = 'Admin';
        else if (user.role_id === 2) role_name = 'QA';
        else if (user.role_id === 3) role_name = 'CSR';
        else if (user.role_id === 4) role_name = 'Trainer';
        else if (user.role_id === 5) role_name = 'Manager';
        else if (user.role_id === 6) role_name = 'Director';

        refreshedTokens.push({
          user_id: user.id,
          role_name,
          token
        });
      } catch (error) {
        console.error(`Error refreshing token for user ${user.id}:`, error);
      }
    }

    console.log(`Successfully refreshed tokens for ${refreshedTokens.length} users`);
    console.log('\nNew tokens (copy to use for login):\n');

    // Display tokens for testing
    refreshedTokens.forEach(({ user_id, role_name, token }) => {
      console.log(`User ID: ${user_id}, Role: ${role_name}`);
      console.log(`Token: ${token}`);
      console.log('---');
    });

    console.log('\nToken refresh process completed.');
  } catch (error) {
    console.error('Error in auth token refresh process:', error);
  } finally {
    // Close pool
    await pool.end();
  }
}

// Run the token refresh function
refreshAuthTokens().catch(console.error); 