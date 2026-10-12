import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '../.env');

// Helper to parse CLI flags: --key=value
const args = process.argv.slice(2).reduce((acc, arg) => {
  const match = arg.match(/^--([^=]+)=(.*)$/);
  if (match && match[1]) {
    acc[match[1]] = match[2];
  }
  return acc;
}, {});

async function main() {
  console.log('====================================================');
  console.log('   Arattai Business Platform - OAuth Token Helper  ');
  console.log('====================================================');

  const clientId = args.clientId || process.env.ARATTAI_CLIENT_ID;
  const clientSecret = args.clientSecret || process.env.ARATTAI_CLIENT_SECRET;
  const redirectUri = args.redirectUri || process.env.ARATTAI_REDIRECT_URI || 'http://localhost:5050/oauth/callback';
  const code = args.code;
  const refreshToken = args.refreshToken || process.env.ARATTAI_REFRESH_TOKEN;

  if (!clientId || !clientSecret) {
    console.error('❌ Error: Missing client_id or client_secret.');
    console.log('\nUsage for initial code exchange:');
    console.log('  node scripts/getArattaiTokens.js --clientId=... --clientSecret=... --code=... --redirectUri=http://localhost:5050/oauth/callback\n');
    console.log('Usage for refresh token renewal:');
    console.log('  node scripts/getArattaiTokens.js --clientId=... --clientSecret=... --refreshToken=...\n');
    process.exit(1);
  }

  const tokenUrl = 'https://accounts.arattai.in/oauth/v2/token';

  try {
    let params = {};

    if (code) {
      console.log('🔄 Exchanging Authorization Code for Access & Refresh tokens...');
      params = {
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      };
    } else if (refreshToken) {
      console.log('🔄 Refreshing Access Token using Refresh Token...');
      params = {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      };
    } else {
      console.error('❌ Error: You must supply either --code=<AUTHORIZATION_CODE> or --refreshToken=<REFRESH_TOKEN>.');
      process.exit(1);
    }

    const response = await axios.post(tokenUrl, null, {
      params,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    const data = response.data;
    console.log('\n✅ Successfully received OAuth response from Arattai:');
    console.log(data);

    if (data.access_token) {
      let envContent = '';
      if (fs.existsSync(envPath)) {
        envContent = fs.readFileSync(envPath, 'utf-8');
      }

      const updateEnvKey = (key, val) => {
        const regex = new RegExp(`^${key}=.*$`, 'm');
        if (regex.test(envContent)) {
          envContent = envContent.replace(regex, `${key}="${val}"`);
        } else {
          envContent += `\n${key}="${val}"`;
        }
      };

      updateEnvKey('ARATTAI_ACCESS_TOKEN', data.access_token);
      if (data.refresh_token) {
        updateEnvKey('ARATTAI_REFRESH_TOKEN', data.refresh_token);
      }
      updateEnvKey('ARATTAI_CLIENT_ID', clientId);
      updateEnvKey('ARATTAI_CLIENT_SECRET', clientSecret);
      updateEnvKey('ARATTAI_REDIRECT_URI', redirectUri);

      fs.writeFileSync(envPath, envContent.trim() + '\n', 'utf-8');
      console.log(`\n💾 Saved ARATTAI_ACCESS_TOKEN and configuration to ${envPath}`);
    }
  } catch (err) {
    console.error('\n❌ Token exchange failed:', err.response?.data || err.message);
    process.exit(1);
  }
}

main();
