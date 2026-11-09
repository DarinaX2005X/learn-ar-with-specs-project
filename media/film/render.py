# Render frames of film.html with Playwright. usage: python render.py stills t1 t2 ... | python render.py video out.mp4 [t0 t1]
import sys, asyncio, subprocess, os
from playwright.async_api import async_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
import pathlib
URL = pathlib.Path(HERE, 'film.html').as_uri()

async def main():
    mode = sys.argv[1]
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--allow-file-access-from-files', '--disable-web-security'])
        pg = await b.new_page(viewport={'width': 1920, 'height': 1080})
        await pg.goto(URL)
        await pg.wait_for_function('window.READY === true')
        async def at(t):
            await pg.evaluate(f'renderAt({t})')
            await pg.evaluate("Promise.all([...document.images].filter(i=>i.offsetParent!==null && i.src).map(i=>i.decode().catch(()=>0)))")
        if mode == 'stills':
            os.makedirs(os.path.join(HERE, 'stills'), exist_ok=True)
            for ts in sys.argv[2:]:
                await at(float(ts))
                await pg.screenshot(path=os.path.join(HERE, 'stills', f't{float(ts):07.2f}.jpg'), type='jpeg', quality=85)
        else:
            out = sys.argv[2]
            fps = await pg.evaluate('FPS'); dur = await pg.evaluate('DUR')
            t0 = float(sys.argv[3]) if len(sys.argv) > 3 else 0.0
            t1 = float(sys.argv[4]) if len(sys.argv) > 4 else dur
            n0, n1 = int(round(t0 * fps)), int(round(t1 * fps))
            ff = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'image2pipe', '-framerate', str(fps), '-c:v', 'mjpeg', '-i', '-',
                                   '-c:v', 'h264_nvenc', '-preset', 'p7', '-tune', 'hq', '-rc', 'vbr', '-cq', '19', '-b:v', '0', '-pix_fmt', 'yuv420p', out], stdin=subprocess.PIPE)
            for n in range(n0, n1):
                await at(n / fps)
                buf = await pg.screenshot(type='jpeg', quality=92)
                ff.stdin.write(buf)
                if n % 150 == 0: print('frame', n, flush=True)
            ff.stdin.close(); ff.wait()
            import json
            json.dump(await pg.evaluate('window.EVENTS'), open(out + '.events.json', 'w'))
        await b.close()
asyncio.run(main())
