# Screenshot SVG files at given times: python svgshot.py file.svg t1 t2 ...
import sys, asyncio, pathlib
from playwright.async_api import async_playwright


async def main():
    f = pathlib.Path(sys.argv[1]).resolve()
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width': 1600, 'height': 600})
        await pg.goto(f.as_uri())
        last = 0.0
        for t in map(float, sys.argv[2:]):
            await pg.wait_for_timeout(int((t - last) * 1000)); last = t
            await pg.screenshot(path=str(f.with_name('_' + f.stem + f'_{t:g}.png')))
        await b.close()

asyncio.run(main())
