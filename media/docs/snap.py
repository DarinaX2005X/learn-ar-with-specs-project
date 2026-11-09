# Render #ids of an HTML page to PNG: python snap.py page.html outdir id1 id2 ...
import sys, asyncio, pathlib
from playwright.async_api import async_playwright
async def main():
    page, out, ids = sys.argv[1], pathlib.Path(sys.argv[2]), sys.argv[3:]
    out.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--allow-file-access-from-files'])
        pg = await b.new_page(viewport={'width': 1700, 'height': 1000}, device_scale_factor=1)
        await pg.goto(pathlib.Path(page).resolve().as_uri())
        await pg.wait_for_function('window.READY === true')
        await pg.evaluate('document.fonts.ready')
        await pg.wait_for_timeout(300)
        for i in ids:
            await pg.locator('#' + i).screenshot(path=str(out / f'{i}.png'))
            print('saved', i)
        await b.close()
asyncio.run(main())
