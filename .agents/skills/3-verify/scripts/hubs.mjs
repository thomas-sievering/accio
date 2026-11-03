import assert from 'node:assert/strict';
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
    await action('hubs/local: create a profile through onboarding',async()=>{
      await page.getByPlaceholder(/^personal, work/).fill('Same profile'); await button('Add').click();
      await page.getByText('Choose an account for Same profile',{exact:true}).waitFor();
    });
    await action('hubs/pair: add an independent hub using its first-device code',async()=>{
      await button('Settings').click(); await page.locator('.sidebar nav').getByRole('button',{name:'Hubs',exact:true}).click();
      await page.getByRole('textbox',{name:'Hub name',exact:true}).fill('Other dev');
      await page.getByRole('textbox',{name:'Hub address',exact:true}).fill('http://127.0.0.1:'+ready.port);
      await page.getByRole('textbox',{name:'Pairing code',exact:true}).fill(code); await button('Connect hub').click();
      await page.getByRole('heading',{name:'Set up accio',exact:true}).waitFor();
      assert.equal(await page.getByRole('combobox',{name:'Hub',exact:true}).inputValue(),ready.hubId);
    });
    await action('hubs/isolation: a new hub starts with separate profiles',async()=>{
      await page.getByPlaceholder(/^personal, work/).fill('Same profile'); await button('Add').click();
      await page.getByText('Choose an account for Same profile',{exact:true}).waitFor();
      await button('Settings').click(); await page.locator('.sidebar nav').getByRole('button',{name:'Accounts',exact:true}).click();
      await page.getByRole('button',{name:/^Add ChatGPT account /}).click();
      await page.getByRole('textbox',{name:'Account name',exact:true}).fill('Other account'); await button('Add account').click();
      await button('Sign in with ChatGPT').waitFor(); await button('Cancel').click(); await button('Back').click();
    });
    await capture('other-hub');
    await action('hubs/switch: restore the original hub without another pairing',async()=>{
      await page.getByRole('combobox',{name:'Hub',exact:true}).selectOption({label:'Local dev'});
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
        await second.getByRole('combobox',{name:'Hub',exact:true}).selectOption({label:'Other dev'});
        await second.getByText('Choose an account for Same profile',{exact:true}).waitFor();
        assert.equal(await page.getByRole('combobox',{name:'Hub',exact:true}).inputValue(),JSON.parse(await readFile(join(home,'hub-connections.json'),'utf8'))[0].id);
        await second.getByRole('button',{name:'Settings',exact:true}).click();
        await second.locator('.sidebar nav').getByRole('button',{name:'Accounts',exact:true}).click();
        await second.getByRole('button',{name:'Other account Signed out',exact:true}).waitFor();
      } finally { await second.close(); }
    });
    await action('hubs/persistence: retain the selected hub after reload',async()=>{
      await page.getByRole('combobox',{name:'Hub',exact:true}).selectOption({label:'Other dev'}); await page.reload();
      await page.getByText('Choose an account for Same profile',{exact:true}).waitFor();
      assert.equal(await page.getByRole('combobox',{name:'Hub',exact:true}).inputValue(),ready.hubId);
    });
    await capture('hub-switching-persisted');
  } finally {
    if(child.exitCode===null){child.send({type:'shutdown'});await once(child,'exit');}
  }
}
