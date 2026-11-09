# python galshot.py out.png "query string"
import sys, asyncio, pathlib, urllib.parse
from playwright.async_api import async_playwright
async def main():
    jobs = [(sys.argv[i], sys.argv[i + 1]) for i in range(1, len(sys.argv), 2)]
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--allow-file-access-from-files'])
        pg = await b.new_page(viewport={'width': 1500, 'height': 1000})
        for out, q in jobs:
            await pg.goto(pathlib.Path('gallery.html').resolve().as_uri() + '?' + q)
            await pg.wait_for_function('window.READY === true')
            await pg.wait_for_timeout(200)
            await pg.locator('#c').screenshot(path=out, type='jpeg', quality=90)
            print('saved', out)
        await b.close()
asyncio.run(main())
