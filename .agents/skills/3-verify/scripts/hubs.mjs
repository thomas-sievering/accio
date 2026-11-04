import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { fork } from 'node:child_process';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
export default async function ({page, context, home, runDir, action, capture}) {
  const otherHome=join(runDir,'scratch','other-hub');
  const child=fork('apps/hub/dist/main.js',[],{env:{...process.env,ACCIO_HOME:otherHome,ACCIO_HUB_PORT:'0',ACCIO_HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe','ipc']});
  let output=''; child.stdout.on('data',d=>{output+=d}); child.stderr.resume();
  try {
    const deadline=Date.now()+15000;
    while(!output.includes('First-device pairing code:')) { if(Date.now()>deadline || child.exitCode!==null) throw new Error('Development hub did not become ready'); await new Promise(r=>setTimeout(r,50)); }
    const ready=JSON.parse(output.match(/ACCIO_HUB_READY (\{[^\r\n]+\})/)[1]);
    const code=output.match(/First-device pairing code: ([A-F0-9-]+)/)[1];
    const button=name=>page.getByRole('button',{name,exact:true});
    const openSettings=async(target=page)=>{
      if(!await target.getByRole('button',{name:/^Hub: /}).isVisible()) await target.getByRole('button',{name:'Settings',exact:true}).click();
    };
    const chooseHub=async(name,target=page)=>{
      await openSettings(target);
      await target.getByRole('button',{name:/^Hub: /}).click();
      await target.getByRole('menuitemradio',{name:new RegExp('^'+name+' ')}).click();
    };
    await action('hubs/local: create a profile through onboarding',async()=>{
      await button('Continue').click(); await page.getByPlaceholder(/^personal, work/).fill('Same profile'); await button('Continue').click();
      await page.getByText('Choose an account for Same profile',{exact:true}).waitFor();
    });
    await action('hubs/pair: add an independent hub using its first-device code',async()=>{
      await button('Settings').click(); await page.locator('.sidebar nav').getByRole('button',{name:/^Hub: /}).click(); await page.getByRole('menuitem',{name:'Manage hubs'}).click();
      await button('Add hub').click();
      await page.getByRole('textbox',{name:'Hub name',exact:true}).fill('Other dev');
      await page.getByRole('textbox',{name:'Hub address',exact:true}).fill('http://127.0.0.1:'+ready.port);
      await page.getByRole('textbox',{name:'Pairing code',exact:true}).fill(code); await button('Connect hub').click();
      await page.getByRole('heading',{name:'Set up Accio',exact:true}).waitFor();
      await openSettings();
      await button('Hub: Other dev').waitFor();
      await button('Back').click();
    });
    await action('hubs/isolation: a new hub starts with separate profiles',async()=>{
      await page.getByPlaceholder(/^personal, work/).fill('Same profile'); await button('Continue').click();
      await page.getByText('Choose an account for Same profile',{exact:true}).waitFor();
      await button('Settings').click(); await page.locator('.sidebar nav').getByRole('button',{name:'Accounts',exact:true}).click();
      await page.getByRole('button',{name:/^Add ChatGPT account/}).click();
      await page.getByRole('textbox',{name:'Account name',exact:true}).fill('Other account'); await button('Add account').click();
      await button('Sign in with ChatGPT').waitFor(); await button('Cancel').click(); await button('Back').click();
    });
    await capture('other-hub');
    await action('hubs/menu: themed menu, selected state, keyboard and dismissal',async()=>{
      await openSettings();
      const trigger=button('Hub: Other dev');
      await trigger.press('ArrowDown');
      const menu=page.getByRole('menu',{name:'Choose hub',exact:true});
      const selected=page.getByRole('menuitemradio',{name:/^Other dev /});
      await selected.waitFor();
      await expect(trigger).toHaveAttribute('aria-expanded','true');
      assert.equal(await selected.getAttribute('aria-checked'),'true');
      await capture('hub-menu-open');
      const cardBox=await trigger.boundingBox(), menuBox=await menu.boundingBox();
      assert(Math.abs(cardBox.width-menuBox.width)<2,'Menu matches the card width');
      assert(menuBox.y>=cardBox.y+cardBox.height,'Menu opens below the card');
      await selected.press('Home');
      assert.equal(await page.getByRole('menuitemradio',{name:/^Local dev /}).evaluate(el=>el===document.activeElement),true);
      await page.keyboard.press('End');
      assert.equal(await page.getByRole('menuitem',{name:'Manage hubs'}).evaluate(el=>el===document.activeElement),true);
      await page.keyboard.press('ArrowUp');
      assert.equal(await selected.evaluate(el=>el===document.activeElement),true);
      await page.keyboard.press('Escape');
      await menu.waitFor({state:'hidden'}); // menus fade out over 120ms
      assert.equal(await trigger.evaluate(el=>el===document.activeElement),true);
      await trigger.click();
      await selected.waitFor();
      await page.locator('.crumbs').click();
      await menu.waitFor({state:'hidden'}); // menus fade out over 120ms
      await button('Back').click();
    });
    await action('hubs/switch: restore the original hub without another pairing',async()=>{
      await chooseHub('Local dev');
      await page.getByText('Choose an account for Same profile',{exact:true}).waitFor();
      await button('Settings').click(); await page.locator('.sidebar nav').getByRole('button',{name:'Accounts',exact:true}).click();
      assert.equal(await page.getByRole('button',{name:'Other account Signed out',exact:true}).count(),0);
      await button('Back').click();
    });
    await action('hubs/windows: a second window chooses its hub independently',async()=>{
      const instance=JSON.parse(await readFile(join(runDir,'instance.json'),'utf8'));
      const {token}=JSON.parse(await readFile(join(home,'server.json'),'utf8'));
      const second=await context.newPage();
      try {
        await second.goto(instance.url+'/#token='+encodeURIComponent(token));
        await chooseHub('Other dev',second);
        await second.getByText('Choose an account for Same profile',{exact:true}).waitFor();
        await openSettings();
        await button('Hub: Local dev').waitFor();
        await button('Back').click();
        await second.getByRole('button',{name:'Settings',exact:true}).click();
        await second.locator('.sidebar nav').getByRole('button',{name:'Accounts',exact:true}).click();
        await second.getByRole('button',{name:'Other account Signed out',exact:true}).waitFor();
      } finally { await second.close(); }
    });
    await action('hubs/persistence: retain the selected hub after reload',async()=>{
      await chooseHub('Other dev'); await page.reload();
      await page.getByText('Choose an account for Same profile',{exact:true}).waitFor();
      await openSettings();
      await button('Hub: Other dev').waitFor();
    });
    await capture('hub-switching-persisted');
  } finally {
    if(child.exitCode===null){child.send({type:'shutdown'});await once(child,'exit');}
  }
}
