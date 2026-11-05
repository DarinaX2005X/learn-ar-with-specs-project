# Countercase

Countercase is a walk-through museum mystery for two on SPECS. Stage a ruby theft for a friend and hand them the case. They enter through the foyer, wind the clock back and follow the recording through the museum to find out who could have reached the display.

<img src="docs/media/cover.webp" width="560" alt="Countercase illustrated poster. A gloved hand lifts a ruby from a velvet case while the guard appears in a small curtained mirror.">

Six seconds into **The Missing Ruby**, the entrance camera sees the courier. Look into the mirror in that same recording and the guard is across the room. That gives two people an alibi. Close the little curtain over the mirror in a copy of the case and play the theft again. The courier still has an alibi, but either the guard or the conservator could have taken the ruby.

## Play in Lens Studio

1. Download or clone the whole repository. Open **Countercase.esproj** from its root in **Lens Studio 5.23.2** and let asset import and TypeScript compilation finish. [Lens Studio 5.23.2](https://ar.snap.com/download/v5-23-2)
2. Open **Window → Preview** and choose **Interactive** in the preview-source picker. The first case begins in the foyer. Look for the clock and the case file on the wooden desk.
3. Focus the Preview. Use **W/A/S/D** to walk and **right-drag** to look around. Move the pointer over the clock until its inscription appears, then click. Click again to pause. Drag the clock control or use its step controls to return to **6.0 s**. Object controls also accept a simulated point and pinch. [Interactive Preview controls](https://developers.snap.com/lens-studio/lens-studio-workflow/previewing-your-lens#interactive-preview-mode)
4. Inspect the **entrance camera** in the hall. At the evidence bench, pin what the camera saw, choose a suspect and use **Check accusation**. An accusation can fit the evidence while a second explanation still fits. Return to the recording to look for the missing alibi.

### Give someone your version

Use the **Stage a theft** file to copy the current case. Move the mirror curtain, then use the lid at the workbench to **Test case**. If two thefts fit the recording, **Keep different thefts** lets you keep that as the puzzle. Choose **Pass the case** and let the next player **Open the case** in the same session. They receive the recording and physical clues. The casting and private staging stay with the author.

The shelf also holds **The Packing Room**. There, seeing who lifted the ruby settles only part of the case. A mark on the rim, sightings near a partition and the final contents of a box answer different questions about who carried it away. Copies, edits and investigations live for the current Lens session.

## How the evidence works

The author places actors on tracks. For each half-second of a case, the TypeScript model tests a fixed camera's view against the room. A reflection must reach the open, front-facing part of the mirror and both legs of its sight line must clear the obstacles. Walking closer helps a player inspect the glass. It never grants the fixed camera a different angle on the crime.

The detective receives a sealed recording. When they check an accusation, the game enumerates legal histories under the same movement and handling rules, then compares the observations they pinned. If two histories still fit, tabletop reconstructions at the evidence bench let you compare the two people reaching for the ruby at the same instant. A box inspection establishes where the ruby ended up. Its contents alone cannot tell you when someone put it there.

| In the source | What to look for |
| --- | --- |
| [Case model](Assets/Domain/) | Actor tracks, sight lines, mirror intersections, sealed recordings and competing explanations |
| [Player actions](Assets/Runtime/PlayTable.ts) | The clock, curtain, witness camera, evidence glass, case lid and accusation stamp |
| [Case flow](Assets/Runtime/MuseumGame.ts) | Handoff between author and detective, replay and reveal |
| [Museum art](Assets/Art/TableKit/) | The connected building, carved figures and props used at the evidence stations |

## Run the checks

These checks run from the repository root in PowerShell with Node.js and npm.

```powershell
.\Tests\Domain\run.ps1
.\Tests\Detective\run.ps1
.\Tests\MuseumGame\run.ps1
```

The first run needs npm access for the pinned TypeScript compiler. The domain checks exercise the mirror and alternative histories. The other suites exercise pinning, accusation, changing a case and handing it over. The project also includes [LEAF scenarios for Lens Studio](Assets/Tests/Leaf/). The museum walkthrough was captured in **Lens Studio Interactive Preview**. Physical SPECS testing remains open.

## Materials

Countercase uses Snap's SPECS Base Template, Spectacles Interaction Kit 2.0, Spectacles UI Kit 2.0 and LEAF 2.0. Snap's packages retain their accompanying notices. The museum geometry, puppet rigs, evidence rules and case scripts were made for this project. The two framed paintings and the illustrated project poster were generated for Countercase. The oak and plaster textures were generated procedurally. [TableKit asset notes](Assets/Art/TableKit/README.md)
