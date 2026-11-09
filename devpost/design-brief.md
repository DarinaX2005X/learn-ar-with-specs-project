---
status: approved
---

# Design brief: Sunfall

See where the sun will fall in your room at any hour of any day of the year.

## Who it's for
People choosing where things go in a room: where the plants will get enough light, where the desk won't get glare, which corner stays warm in winter. The sharpest case is someone viewing an apartment to rent. They see it once, at one time of day, and then live there all year.

## The one spatial moment
You stand in your room and look at the window. The sun hangs outside it, on its real path across the sky for today. You pinch the sun and pull it along the path. The patch of sunlight that comes through the window slides across your actual floor, climbs the wall and crosses the coffee table, from sunrise to sunset. Pull the sun lower toward December and the light reaches deep into the room. Pull it higher toward June and it shrinks to a strip by the window.

## Why it belongs on glasses
The answer only makes sense at real scale, in the real room. A phone app can tell you "4 hours of sun", but it can't show you that the light stops ten centimeters short of the spot where you wanted the monstera. With glasses the light lands on the actual floorboards and furniture, you walk to a spot to check it, and both hands stay free to drag the sun or move a pot. The display adds light and can't darken anything, and sunlight is exactly the kind of content an additive display draws well.

## Product or overlay
An overlay on the user's own room. Nothing is replaced. The lens adds four things: the sun and its path outside the window, the light that comes through each window, a map of sun hours painted on the floor, and small markers where the user plans to put plants.

## Where things live
- The sun sits outside the window, 9 m away along its true direction, with its path for the chosen day drawn as a thin arc. The June 21 and December 21 paths are fainter arcs above and below it, so the whole year's range is visible.
- Light lies on the real floor, walls and furniture tops, projected from each marked window along the sun direction. The curtain over a sunlit window glows.
- Sheets of light and dust connect the window to the patch, so you can see which window lights which spot.
- The sun-hours map lies flat on the floor.
- A plant marker is a ring on the floor with a short card above it.
- Three buttons float low in front of the user, about 50 cm away, and follow them slowly.

## Hands and input
- Pinch a window to say it lets sun in. It snaps to the window frame in the room scan. If no frame is found, pinch two opposite corners.
- Pinch the sun and drag it. Sideways along the arc changes the time. Up or down the sky changes the date. The lens searches every time and date between the solstices for the sun position closest to where the hand points.
- Three big round buttons: Play the day, Add a plant, Now.
- Add a plant, then pinch the floor where the pot will stand.
- Every action works with a mouse click or drag in Interactive Preview.

## When things show
- At first only the window outlines and one line of text: "Pinch a window that gets sun".
- After the first window: the light, the sun and "Pinch the sun and drag it".
- The buttons appear after the first drag, once the user knows what the sun does.
- The date and time sit above the sun. Hour labels sit on the arc.
- A plant card shows one big number (hours of direct sun) from across the room. Closer than about 2 m it adds what that means for plants and the December and June numbers.

## Done criteria
1. In Interactive Preview (Sunlit Room), pinch the middle window. Light appears on the floor with the window's cross shadow, and the curtain glows.
2. Drag the sun from morning to afternoon. The label time changes and the floor patch moves in the opposite direction.
3. Drag the sun down toward December. The arc lowers, the date label changes and the patch reaches further into the room.
4. Press Play the day. The sun runs from sunrise to sunset and the floor fills with a heat map of sun hours. A label states the most sun any spot gets.
5. Add a plant on a lit spot and on a shaded spot. The two cards show different hours, and the December and June values differ from today's.
6. Sun position matches the NOAA solar ephemeris: New York, June 21 at 12:57 pm gives about 72.7 degrees elevation; December 21 at 11:55 am gives about 25.8 degrees.

## Out of scope
Shadows cast by trees and neighbouring buildings outside, clouds and weather, light bouncing off walls, saving a room between sessions, and automatic window detection from the camera. In Preview the city is fixed to New York and the window's compass direction is set in the inspector.

## Risks and open questions
- Lens Studio's Interactive Preview rooms don't answer world hit tests, so the floor, walls, furniture and window frames of the Sunlit Room were measured by hand with marker grids. On Specs the same projection would run against the world mesh.
- The furniture stand-ins are boxes, so light on the floor can look cut where a box and the real sofa disagree.
- Whether people trust a projected patch enough to move a plant needs a real trial.

## Build notes for CLAD
- Build for SPECS so it runs and can be demonstrated in Lens Studio's preview. No SPECS device is available.
- Use Spectacles Interaction Kit (SIK) for all interactions, so they work with the mouse in Interactive Preview.
- Build any stand-in exactly as described above, and keep it obvious in the scene.
- Use real-world scale in centimeters. Keep content inside the user's view during the main task.
- The display is additive: black renders as transparent. Don't rely on black or very dark content to be seen; keep text light and readable from where the user stands.
- Get the basic flow working first, then add detail.
- Don't record, identify, or follow people.

## After the build: judge it
1. **Does it work?** Run the done criteria in Interactive Preview and note which ones pass.
2. **Walk around it.** Use WASD to move, Q and E to go down and up, and right-drag (or hold Shift) to look around. Clicking acts as a pinch.
3. **Ask the three questions.**
   - Does it use what I'm looking at? It uses the window and the floor in front of you.
   - Does it put something in my space, where it belongs? The light lands where the real light would.
   - Does it free my hands or let me keep my eyes up? You keep looking at the room while you drag the sun.
4. **Check comfort.** Text stays short and light-colored. Controls are big and few.
5. **Label what you know.** Logic proven: sun math, projection, sun-hour totals. Feel unproven: hand tracking on a real sun target, reading the patch in daylight on a real device.
