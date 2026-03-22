const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();
  
  // Listen to console logs
  page.on('console', msg => console.log('BROWSER:', msg.text()));
  
  // Go to login page
  await page.goto('http://localhost:8081/login');
  await page.waitForTimeout(2000);
  
  // Fill in credentials
  await page.type('input[placeholder="Email"]', 'try93@example.com');
  await page.type('input[placeholder="Password"]', 'try123');
  
  console.log('Clicking login button...');
  await page.click('text/Sign In');
  
  // Wait and see what happens
  await page.waitForTimeout(5000);
  
  console.log('Current URL:', page.url());
  
  // Check localStorage
  const token = await page.evaluate(() => localStorage.getItem('access_token'));
  console.log('Token in localStorage:', token ? token.substring(0, 40) + '...' : 'NULL');
  
  await browser.close();
})();
