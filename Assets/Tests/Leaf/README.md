# Run a museum journey in Lens Studio

These LEAF scenarios use the clock, curtain, case file and evidence bench in the ordinary museum. They use the same Spectacles Interaction Kit targets as a player. The player scene launches on its own.

## Run one scenario

1. Open the project in Lens Studio 5.23.2 and let it compile. For a test run, create an empty child of **MuseumAnchor → Countercase** and attach **LeafIndex**.
2. Create another empty child. Attach **CountercaseScenarioClient** and enter a scenario ID from the table below in its **Scenario Id** input.
3. Refresh Interactive Preview. The client waits for the museum to open and runs the selected scenario. Leave the viewer stationary for the scale check. Run one client at a time.
4. In Logger, look for the scenario manager's **RUNS** line and its **PASSED** or **FAILED** line for that ID. Remove the two test objects and refresh to play the ordinary game again.

The project includes LEAF 2.0 for Spectacles Interaction Kit 2.0. The one-shot client is useful when resetting Preview from the LEAF panel interrupts scenario discovery in Studio 5.23.2. [Snap's LEAF 2.0 sample package](https://github.com/specs-devs/samples/blob/110a145b6572a17fa94d86f18b76047278014729/AI%20Music%20Gen/Packages/Leaf.lspkg)

For the direct curtain reach, watch Logger for `[REACH] PREPOSITION`. Pass the printed `commands` array to the Lens Studio MCP tool `MovePreviewCamera` to place the viewer in front of the mirror. Focus the Preview and press **K** within 15 seconds. Keep the viewer still while the simulated hand closes and reopens the curtain.

## Scenarios

| ID | What the player does | Observed in Interactive Preview |
| --- | --- | --- |
| `countercase-public-recording` | Pin the courier, check an accusation, pin the guard's reflection and check again. Remove and restore a pin after replaying the evidence. | Passed. Two possible takers narrow to one, return to two and narrow to one again. |
| `countercase-curtain-revision` | Close the curtain in a copy, seal it and open it as the detective. Repeat with the curtain open in a second copy. | Passed. The entrance camera records different alibis in the two revisions. |
| `countercase-author-watch` | Watch the author's camera at six seconds, close the curtain in a trial, compare, discard and return to the shelf. | Passed in 19.956 s. The glass matched the case, revision, frame and selected moment in each recording. Discard restored the original. |
| `countercase-closed-pair` | Open two possible thefts and advance their shared clock through all 25 positions. | Passed. Both studies followed the same clock and fit the same closed recording. |
| `countercase-packing-partial` | Establish who lifted the ruby, inspect two boxes and compare possible recipients. | Passed. The taker and cache could be proved while the recipient remained open. |
| `countercase-packing-third-case` | Add a rear camera to a copy of The Packing Room. Then stage a different theft in an empty room with a display, a camera and three figures. Test it, pass it and investigate it. | Passed. The added view identified the courier as the recipient in the copy. In the new case, two pinned observations established who took the ruby. |
| `countercase-original-view` | Edit a copy, reopen the original and move between tabletop and full-size views. | Passed. The original recording, clues, time and viewer pose survived the changes. |
| `countercase-room-pair-switch` | Cover the mirror, earn two possible thefts, enter a full-size reconstruction and use its version tab. Return to the tabletop pair. | Passed. Both switches preserved the time, evidence and position of the case. The camera started behind the courier, so this run checked switching and return. |
| `countercase-curtain-reach` | Position the viewer at the mirror, then use the direct right-hand pinch to close and reopen the curtain. | Passed in 13.781 s. The right hand reached both controls and each action committed one revision. |
| `countercase-curtain-cancel` | Lose SIK input during a curtain drag, recover, then close and reopen the curtain. | Passed in 16.387 s. Losing input restored the tested draft and its proof. Each subsequent drag committed one revision. |

These runs used simulated input during development. Physical hand tracking and comfort still need testing on SPECS.

The client reads the mounted recording and control state through `countercaseLeaf.read()`. Checking the case ID and revision prevents an image from an earlier case from satisfying a later check. Each scenario operates the physical controls through LEAF. The hidden solution stays with the author until the game allows a reveal.
