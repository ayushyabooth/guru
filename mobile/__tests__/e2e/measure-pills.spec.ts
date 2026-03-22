import { test } from '@playwright/test';

test('Measure filter pills', async ({ page }) => {
  await page.goto('http://localhost:8081/(tabs)/catchup');
  await page.waitForTimeout(3000);
  
  await page.screenshot({ path: 'pills-measurement.png' });
  
  const styles = await page.evaluate(() => {
    const pills = Array.from(document.querySelectorAll('[data-component-name="View"]'));
    const filterPills = pills.filter(el => {
      const text = el.textContent || '';
      return text.includes('Consumer') || text.includes('Food') || text.includes('Software') || text.includes('Technology');
    });
    
    return filterPills.map(el => {
      const computed = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return {
        text: el.textContent,
        actualHeight: rect.height,
        computedHeight: computed.height,
        padding: computed.padding,
        paddingTop: computed.paddingTop,
        paddingBottom: computed.paddingBottom,
        minHeight: computed.minHeight,
        maxHeight: computed.maxHeight,
        borderRadius: computed.borderRadius
      };
    });
  });
  
  styles.forEach((style, i) => {
  });
});
