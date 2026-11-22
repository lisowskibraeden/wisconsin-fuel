import {SOURCE} from './core.mjs';

const countyPath = name => name.toLowerCase().replaceAll(' ', '-');
const countyUrl = county => `${SOURCE}/gasprices/wisconsin/${countyPath(county.name)}-county`;

export async function collectCountyPages(counties) {
  const {chromium} = await import('playwright');
  const browser = await chromium.launch();
  const collected = {pages:[], rows:[], errors:[]};
  let blocked = false;
  try {
    const context = await browser.newContext({locale:'en-US'});
    async function readCounty(page, county) {
      const url = countyUrl(county);
      try {
        const response = await page.goto(url, {waitUntil:'domcontentloaded',timeout:20000});
        const status = response?.status();
        if ([401,403,429].includes(status)) blocked = true;
        if (!response?.ok()) throw Error(`HTTP ${status ?? 'unavailable'}`);
        const expected = county.name + ' County';
        const heading = (await page.locator('h1').first().textContent({timeout:5000}))?.trim();
        if (!heading?.includes('in ' + expected + ', WI')) throw Error('County listing heading did not match.');
        await page.waitForFunction(() => [...document.querySelectorAll('[class*="StationDisplayPrice-module__price"]')]
          .some(element => /\$\d/.test(element.textContent)), undefined, {timeout:7000}).catch(() => {});
        const rows = await page.evaluate(() => {
          const rows = [];
          for (const priceElement of document.querySelectorAll('[class*="StationDisplayPrice-module__price"]')) {
            const price = priceElement.textContent.trim().match(/^\$(\d{1,2}\.\d{2,3})$/);
            if (!price) continue;
            let card = priceElement.parentElement;
            while (card && !card.querySelector('a[href^="/station/"]')) card = card.parentElement;
            if (!card) continue;
            const links = [...card.querySelectorAll('a[href^="/station/"]')];
            const hrefs = new Set(links.map(link => link.getAttribute('href')));
            if (hrefs.size !== 1) continue;
            const id = [...hrefs][0].match(/^\/station\/(\d+)$/)?.[1];
            const name = links.map(link => link.innerText.trim()).find(Boolean);
            const lines = card.innerText.split('\n').map(line => line.trim()).filter(Boolean);
            const cityIndex = lines.findIndex(line => /^.+,\s*WI(?:\s|$)/i.test(line));
            const age = lines.find(line => /^(?:\d+\s+(?:minutes?|hours?|days?|weeks?)\s+ago|just now|moments? ago)$/i.test(line));
            if (id && name && cityIndex > 0 && age) {
              const city = lines[cityIndex].replace(/,\s*WI.*$/i, '');
              rows.push([id,name,lines[cityIndex-1],city,Number(price[1]),age]);
            }
          }
          return rows;
        });
        const index = collected.pages.length;
        collected.pages.push([expected,heading,rows.length,new Date().toISOString(),url]);
        collected.rows.push(...rows.map(row => [...row,index]));
      } catch (error) {
        collected.errors.push(`${county.name}: ${error.message.split('\n')[0]}`);
      }
    }

    const [first, ...rest] = counties;
    const probe = await context.newPage();
    await readCounty(probe, first);
    await probe.close();
    if (blocked) return collected;
    let next = 0;
    await Promise.all(Array.from({length:3}, async () => {
      const page = await context.newPage();
      while (!blocked && next < rest.length) await readCounty(page, rest[next++]);
      await page.close();
    }));
    return collected;
  } finally {
    await browser.close();
  }
}
