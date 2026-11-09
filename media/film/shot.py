# python shot.py page.html out.jpg W H [query]
import sys, asyncio, pathlib
from playwright.async_api import async_playwright
async def main():
    page, out, w, h = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
    q = sys.argv[5] if len(sys.argv) > 5 else ''
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--allow-file-access-from-files'])
        pg = await b.new_page(viewport={'width': w, 'height': h})
        await pg.goto(pathlib.Path(page).resolve().as_uri() + ('?' + q if q else ''))
        await pg.wait_for_function('window.READY === true')
        await pg.evaluate("Promise.all([...document.images].map(i=>i.decode().catch(()=>0)))")
        await pg.screenshot(path=out, type='jpeg' if out.endswith('jpg') else 'png', **({'quality': 92} if out.endswith('jpg') else {}))
        await b.close()
asyncio.run(main())
