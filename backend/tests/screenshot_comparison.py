"""
Screenshot comparison test for article rendering vs original
"""
import asyncio
from playwright.async_api import async_playwright
import os
from datetime import datetime

# Test configuration
SCREENSHOTS_DIR = "/Users/ayushya/MatajiKaPrakop/guru-mvp/backend/tests/screenshots"
APP_URL = "http://localhost:8081"
API_URL = "http://localhost:8000"

# Test articles with their original URLs
TEST_ARTICLES = [
    {
        "id": "e6011ac1-b5ab-41ac-8260-62105d108b4f",
        "title": "US Economic Forecast Q4 2025",
        "original_url": "https://www.deloitte.com/us/en/insights/topics/economy/us-economic-forecast/united-states-outlook-analysis.html"
    }
]


async def take_screenshots():
    """Take screenshots of original articles and our rendered versions"""
    
    os.makedirs(SCREENSHOTS_DIR, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        
        for article in TEST_ARTICLES:
            print(f"\n=== Testing: {article['title']} ===")
            
            # 1. Screenshot original article
            print(f"  Taking screenshot of original: {article['original_url'][:50]}...")
            try:
                page = await browser.new_page(viewport={"width": 1280, "height": 900})
                await page.goto(article['original_url'], timeout=30000)
                await page.wait_for_timeout(2000)  # Wait for content to load
                
                original_path = f"{SCREENSHOTS_DIR}/{timestamp}_original_{article['id'][:8]}.png"
                await page.screenshot(path=original_path, full_page=True)
                print(f"  ✓ Original saved: {original_path}")
                await page.close()
            except Exception as e:
                print(f"  ✗ Original failed: {str(e)[:50]}")
            
            # 2. Login to our app and screenshot our rendered version
            print(f"  Taking screenshot of our rendering...")
            try:
                page = await browser.new_page(viewport={"width": 1280, "height": 900})
                
                # First get a valid auth token via API
                import aiohttp
                token = ""
                async with aiohttp.ClientSession() as session:
                    # Use our test user
                    user = {"email": "screenshot_test@example.com", "password": "testpass123"}
                    async with session.post(f"{API_URL}/api/v1/auth/login", json=user) as resp:
                        if resp.status == 200:
                            data = await resp.json()
                            token = data.get("access_token", "")
                            print(f"  Got auth token")
                        else:
                            print(f"  Login failed: {resp.status}")
                
                # Navigate to app and inject token
                await page.goto(f"{APP_URL}", timeout=30000)
                await page.wait_for_timeout(1000)
                
                # Inject auth token into localStorage (using correct key from auth.ts)
                if token:
                    await page.evaluate(f'''() => {{
                        localStorage.setItem("access_token", "{token}");
                    }}''')
                    print(f"  Injected auth token")
                
                # Navigate to the article
                article_url = f"{APP_URL}/article/{article['id']}"
                print(f"  Navigating to: {article_url}")
                await page.goto(article_url, timeout=30000)
                await page.wait_for_timeout(8000)  # Wait for content to load
                
                # Wait for loading to complete
                try:
                    await page.wait_for_selector('text=Loading', state='hidden', timeout=10000)
                    print(f"  Content loaded")
                except:
                    print(f"  Still loading, taking screenshot anyway")
                
                # Check console logs for errors
                page.on("console", lambda msg: print(f"    [Console] {msg.type}: {msg.text[:80]}") if "image" in msg.text.lower() or "error" in msg.type else None)
                
                # Take full page screenshot to see all content including inline images
                await page.wait_for_timeout(3000)  # Extra wait for images to load
                rendered_path = f"{SCREENSHOTS_DIR}/{timestamp}_rendered_{article['id'][:8]}_full.png"
                await page.screenshot(path=rendered_path, full_page=True)
                print(f"  ✓ Full page screenshot saved: {rendered_path}")
                
                await page.close()
            except Exception as e:
                print(f"  ✗ Rendered failed: {str(e)[:100]}")
        
        await browser.close()
    
    print(f"\n=== Screenshots saved to {SCREENSHOTS_DIR} ===")
    return SCREENSHOTS_DIR


async def main():
    await take_screenshots()


if __name__ == "__main__":
    asyncio.run(main())
