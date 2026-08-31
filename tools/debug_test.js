const puppeteer = require('puppeteer');
const delay = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push(err.message));

  await page.goto('http://127.0.0.1:8124/index.html', { waitUntil: 'networkidle0', timeout: 15000 });
  await delay(2000);

  // Check splash is gone
  const splashState = await page.evaluate(() => document.getElementById('splash') ? 'EXISTS' : 'GONE');
  console.log('Splash:', splashState);

  // Check all nav buttons exist
  const navBtns = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-tab]')).map(el => ({
      tab: el.getAttribute('data-tab'),
      text: el.textContent.trim().substring(0, 10),
    }))
  );
  console.log('Nav buttons:', JSON.stringify(navBtns));

  // Click the customers nav button (physical click)
  console.log('\n--- Physical click on customers tab ---');
  await page.click('[data-tab="customers"]');
  await delay(600);

  // Now check what's in the page
  const pageState = await page.evaluate(() => {
    const dataTab = document.body.getAttribute('data-tab');
    const listBody = document.getElementById('list-body');
    const custNameInput = document.getElementById('cust-name');
    const saveBtn = document.querySelector('[data-cust-save]');
    const allBtns = Array.from(document.querySelectorAll('.btn')).map(b => b.textContent.trim().substring(0, 20));
    return {
      dataTab,
      listBodyHTML: listBody ? listBody.innerHTML.substring(0, 300) : 'NULL',
      hasCustNameInput: !!custNameInput,
      hasSaveBtn: !!saveBtn,
      btns: allBtns,
    };
  });
  console.log('Page state:', JSON.stringify(pageState, null, 2));

  // Check if bindEvents was called by testing a click
  console.log('\n--- Testing if click handler works ---');
  const clickResult = await page.evaluate(() => {
    // Dispatch a click on the save button and see if anything happens
    const btn = document.querySelector('[data-cust-save]');
    if (!btn) return 'NO_SAVE_BTN';
    // Manually dispatch click
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return 'CLICK_DISPATCHED';
  });
  console.log('Click dispatch result:', clickResult);
  await delay(300);

  // Check localStorage after manual click
  const lsAfterManual = await page.evaluate(() => localStorage.getItem('customers'));
  console.log('localStorage after manual click:', lsAfterManual);

  // Check toast
  const toastAfter = await page.evaluate(() => {
    const t = document.getElementById('toast');
    return t ? t.textContent : 'NONE';
  });
  console.log('Toast after manual click:', toastAfter);

  // Now try the full flow: type name, then physical click
  console.log('\n--- Full flow: type + physical click ---');
  await page.type('#cust-name', '测试客户2');
  await delay(200);

  const beforePhysClick = await page.evaluate(() => document.getElementById('cust-name')?.value);
  console.log('Input value before click:', beforePhysClick);

  await page.click('[data-cust-save]');
  await delay(400);

  const lsAfterPhys = await page.evaluate(() => localStorage.getItem('customers'));
  console.log('localStorage after phys click:', lsAfterPhys);

  const toastPhys = await page.evaluate(() => {
    const t = document.getElementById('toast');
    return t ? t.textContent : 'NONE';
  });
  console.log('Toast after phys click:', toastPhys);

  const custListAfter = await page.evaluate(() => {
    const list = document.getElementById('list-body');
    return list ? list.innerHTML.substring(0, 500) : 'NULL';
  });
  console.log('List body after:', custListAfter.substring(0, 300));

  // Check if __pf.saveCustomerFromForm exists and is callable
  const pfCheck = await page.evaluate(() => ({
    has__pf: typeof window.__pf !== 'undefined',
    hasSaveFn: typeof window.__pf?.saveCustomerFromForm,
    hasSwitchTab: typeof window.__pf?.switchTab,
    pfViewCustomers: typeof window.PFViewCustomers,
    pfCustomers: typeof window.PFCustomers,
  }));
  console.log('__pf check:', JSON.stringify(pfCheck));

  if (errors.length > 0) console.log('Errors:', errors);

  await browser.close();
})().catch(e => { console.error('Test error:', e.message); process.exit(1); });
