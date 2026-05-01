import readline from 'node:readline/promises';
import process from 'node:process';
import { chromium } from 'playwright';

const profileDir = process.argv.includes('--profile-dir')
  ? process.argv[process.argv.indexOf('--profile-dir') + 1]
  : '.fb-profile';

const context = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  locale: 'hu-HU',
  timezoneId: 'Europe/Budapest',
  viewport: { width: 1280, height: 900 }
});

const page = await context.newPage();
await page.goto('https://www.facebook.com/login', { waitUntil: 'domcontentloaded' });

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

await rl.question('Log in in the Chromium window, then press Enter here to save the session...');
rl.close();
await context.close();
