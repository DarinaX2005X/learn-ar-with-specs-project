# Museum LEAF checks

The native independent-fragment public journey passed through the official optional ScenarioClient:

`15:32:16.181 RUNS: countercase-public-recording`

`15:32:55.065 [DefaultLeafScenarioManager] [38.885s] PASSED: countercase-public-recording`

Source of truth: Lens Studio native log `LensStudioLog-2026-11-05-13-00-46-686-e4a04.txt`, not the client completion print or plugin UI. The run used the ordinary initialized public museum and real LEAF/SIK interactions. No game state setter, special fixture scene, compiler call, direct game dispatch or direct archive write was invoked by the test.

The passing journey physically selects Courier, pins/re-pins it without duplication, seeks away and returns, removes/re-pins it, and checks Conservator: `needClue`, two possible takers. It separately selects and pins Guard in the mirror: `proved`, one taker. The normal ReplayGlass route retains the same case/revision/tick and exact observation IDs; removing Courier reopens the finding, and UndoEvidence restores the proof. Test duration is native run time, not a human usability measurement.

## Native result ledger

| Scenario | Current evidence |
| --- | --- |
| countercase-public-recording | Native PASSED 38.885 s, independent marks plus normal replay/remove/undo |
| countercase-curtain-revision | Native PASSED 41.952 s at 15:49:45.523, RUNS 15:49:03.572; both real copies, opposite curtain states, lid test/handoff and changed public recordings/verdicts completed. |
| countercase-curtain-reach | Not run; isolated viewer-near-mirror precondition |
| countercase-curtain-cancel | Not run |
| countercase-closed-pair | Native PASSED 79.723 s at 16:11:40.310, RUNS 16:10:20.588; actual two-wing hall, full-tape scope, shared clock ticks 0–24 and return |
| countercase-packing-partial | Native PASSED 58.192 s at 16:15:06.778; partial taker proof, physical empty/occupied box search, cache proof and honest recipient alternatives |
| countercase-original-view | Native PASSED 45.488 s at 16:01:52.324, RUNS 16:01:06.837; actual shelf reopen, original IDs/time, native scales and unchanged world-camera pose |

Earlier evidence stays separate: public-recording first failed at 14:15:34.663 after 2.364 s with `Exception in HostFunction: Object is null`. Source review found a synchronous target-destruction bug; physical control lifetimes were made stable before the affected native recheck. The earlier aggregate-frame version passed at 14:36:38.099 after 5.945 s; it does not establish the later independent-mark behavior.

The curtain journey previously failed at 15:39:45.595 after 42.743 s: its closed-copy route completed, but the second open-copy author proof remained testing at the nominal 5 s poll budget. The author proof implementation was repaired to use full sufficient grounds without the expensive minimal-ground search; the existing test wait stayed unchanged. Only the later authoritative 41.952 s pass establishes the complete two-copy curtain journey.

The closed-pair journey first failed at 15:58:58.600 after 36.296 s, before comparison was mounted: the full-tape unknown check had not produced its verdict within the unchanged poll budget. Measurement found 270 generator yields and 136 controller updates spent minimizing exclusion reasons. The bounded repair skips that extra minimization only for full-scope unknown claims, retaining exhaustive counterexamples and preserving concrete selected-clue minimal grounds. The later 79.723 s native pass is the affected recheck.

Visual acceptance remains separate: the closed-pair final native shot was rejected because the old upright folio/stamp occluded the studies. Functional two-wing/time/tape assertions passed, but that shot did not pass composition or readability review. The art repair and fresh native capture still require their own pixel inspection; no functional pass establishes physical tracking, comfort or human comprehension.

## Why ScenarioClient was used

The installed native LEAF panel repeatedly timed out before any new scenario-manager RUNS line. Read-only inspection of its `dist/main.js` found `runScenarioById` awaiting `reset()`, while `reset()` calls asynchronous `resetPreview()` without awaiting completion and immediately requests a scenario list. A still-live old bridge can answer that list; ScenarioStartRequest is then sent before the reset/new runtime finishes. Native logs showed Loaded/Running preceding the next reset and runtime initialization. The enabled MessagingBridge existed; this was not a missing component. Separate native MessageEvent queue-cap warnings occurred while Preview TypeScript was not compiled.

The official CLAD LEAF reference documents an optional ScenarioClient. `CountercaseScenarioClient.ts` uses that API unchanged: one scenario ID input, read-only wait for an initialized public session, actual registered scenario defaults, and `DefaultScenarioManager.startScenario`. It never resets or initializes the game. Keep it a standalone optional test asset. Attach exactly one client through Lens Studio MCP, never run panel and client concurrently, and remove its scene attachment before a normal player checkpoint or capture. Do not edit LEAF or plugin code to hide this panel problem.

## Journeys and scope

- Public recording is the smallest normal player gate described above.
- Curtain revision uses the physical staging file to create an author copy, changes the real handle, uses the normal lid test/ambiguity confirmation/pass/open route, and inspects the newly rendered public recording and verdict. A second copy uses the alternate endpoint to reopen the mirror. Every edit increments its own revision once.
- Cancellation drives an actual SIK selection/drag, makes the LEAF test interactor unavailable, verifies cancellation restores the committed aperture without a revision, and checks recovery. This models input loss, not physical hand tracking.
- Reach uses direct IK, fails fast instead of the factory's scripted fallback, and requires the Preview viewer already within arm reach of the museum mirror. It never teleports the viewer.
- Closed pair uses the real comparison file and physical clock over all 25 finite ticks. Actual ComparisonHall telemetry must report two visible wings, the shared tick, full-tape scope and no validation issue. Distinguishing the rendered takers and assessing movement still require pixels.
- Packing Room proves the visible taker while completion stays false, checks the empty canvas search is insufficient for a brass-cache claim, physically searches brass, then accepts honest recipient ambiguity and mounts the public alternatives.
- Original/view changes a separate draft, reopens the original through its actual shelf mapping and preserves case/revision/time/exact IDs. It checks disabled author controls, actual Theatre world scales and unchanged actual world-camera position/quaternion through compact/human/back/close. The operator must leave the viewer stationary during that isolated test.

## Runtime contract and execution

`countercaseLeaf.read()` is read-only. Its core contract is in `CountercaseLeafProbe.ts`; additional public fields for the final three checks are in `RemainingProbe.ts`. Observation selectors and shelf spines resolve through actual enabled target mappings; indices never imply identities. Rendered role telemetry comes from the actual recording renderer. No vault or private author history is required.

Scenario budgets are 60 s or 120 s. Snapshot waits use 100 polls requesting 50 ms each (nominal 5 s); native frame scheduling can stretch their elapsed time, so the failure text is not a measured proof latency. Run serially and retain exact manager RUNS/PASSED/FAILED lines. A plugin timeout with no RUNS is not a passed or failed game scenario. Lookups and triggers preserve target-specific failure labels.

Pin official LEAF 2 from the [Specs sample](https://github.com/specs-devs/samples/blob/110a145b6572a17fa94d86f18b76047278014729/AI%20Music%20Gen/Packages/Leaf.lspkg), SHA256 `c877d77b8af24b079c4d1d9384afe3dc45e80d321d1a71f680379e5cc73a8fea`, compatible with SIK 2 and Studio 5.22. Latest LEAF 4 requires InteractionKit 4 and is unsuitable for this project. Offline TypeScript 5.9.3 validation uses actual pinned LEAF source, generated installed SIK source and Lens SDK declarations. That type evidence does not replace native runs.

Unverified beyond each explicit ledger row: actual mouse interaction, physical tracking, comfort, visual readability, stereo/rear leakage and measured player comprehension. No Preview pass establishes those. Packing camera/cache author variations and reverse mark order require further focused journeys.






