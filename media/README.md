# How the video and the README images are made

Everything here is code. The demo video is an HTML page rendered frame by frame, its music is synthesized in Python, and the README diagrams are drawn from the same sun and room math the lens uses.

## The raw takes

`raw/` holds three real Lens Studio Preview recordings of the lens (screen captures of the maximized Preview, 10 frames per second). The Preview ran at about 3 frames per second on our laptop, so each take was recorded with the lens input `timeScale = 0.1` and driven by its `demoScript` input, which plays pinches, drags and button presses with a visible hand cursor.

| Take | What happens |
| --- | --- |
| `finalU5.mp4` | Mark two windows, grab the sun, drag it through the day and toward December, glance down, add a plant |
| `finalB.mp4` | Play the day from a view of the floor, then the sun-hour map |
| `finalS.mp4` | Noon on December 21, then June 21, then December 21 again |

`film/extract.sh` speeds a take back up ten times and cuts out the area the Specs display covers:

```bash
cd film && bash extract.sh finalU5 finalB finalS
```

`film/uncut.sh` makes a continuous 1080p clip of one take with no cuts.

## The film

`film/film.html` is the whole film: one `renderAt(seconds)` function that positions the footage, captions, sun and diagrams for any moment. `film/render.py` opens it in headless Chromium with Playwright and pipes every frame into ffmpeg. `film/audio.py` builds the score (a 96 BPM synth in D major) and places a sound on each caption word, whip and lens action. `film/render-all.sh` renders three chunks in parallel, then scores and muxes `sunfall-demo.mp4`.

```bash
pip install playwright numpy scipy soundfile && playwright install chromium
cd film && bash render-all.sh
```

The encoder is `h264_nvenc`; on a machine without an NVIDIA GPU, replace it with `libx264` in `render.py` and `uncut.sh`.

## The README images

| Script | Output |
| --- | --- |
| `docs/sundata.py` | A Python port of `Solar.ts` and the sun-hour test in `Room.ts`. Writes the sun paths, the 7,703-entry drag table and the floor maps for December 21, November 9 and June 21 to `sundata.json` |
| `docs/diagrams.html` + `docs/snap.py` | The four diagrams in `../docs` |
| `docs/banner.py` | The animated banner and the stack pills, with text turned into outlines so GitHub shows the real fonts |
| `docs/gallery.html` + `docs/galshot.py` | The Devpost gallery images |
| `film/cover.html` | The cover and the YouTube thumbnail |

Fonts: Bricolage Grotesque and Inter, both under the SIL Open Font License.
