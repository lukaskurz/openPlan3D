---
name: rebuild-drawing
description: Rebuilding an attached floor plan (an architect's drawing, a sketch or a photo of one) exactly, with real wall thicknesses, doors and windows. Read it before drawing any attached plan.
---
Rebuild the drawing exactly:

1. Read it first. Use view_drawing to zoom into the drawing wherever the numbers are small: its blue grid gives positions as fractions of the page. Then trace_drawing to lay the drawing under the plan at its real scale, using two points a known distance apart (two grid axes, or the ends of the longest dimension line, read off a zoomed view), and view_plan to read positions off it in cm. Pick an origin, such as a grid axis or the inside corner of an outer wall, and write down the positions you need in cm by adding up the dimension chains (the rows of numbers along dimension lines), checking each chain against its overall dimension. Read wall thicknesses from the drawing (outer and load-bearing walls are often 20–40 cm, partitions 8–15 cm). Note slanted walls, recesses, shafts, wall stubs, and openings without doors.
2. Walls are drawn on their centre lines. A wall's centre is its inside face plus half its thickness, away from the room. Draw them with add_walls, one call per thickness, joining at shared corners so rooms close; rooms appear where walls enclose a space. Keep slanted walls slanted. Leave openings without a door open (no wall). Then name the rooms with update_elements.
3. Add doors and windows from the drawing. Labels like 100/245 are width/height in cm. Full-height glazed openings onto a balcony or terrace are doors (balcony or french), not windows.
4. Check: look at every part of the plan with view_plan; your walls are drawn over the drawing, so move any wall that doesn't sit on the drawn one. get_plan lists each room's area inside the walls. Compare it with the areas printed on the drawing and fix anything more than about 3% off before you answer. get_plan also names rooms with no door or opening: every room except shafts must be reachable, so add the missing door, or an opening where the drawing shows a passage without a door.

If sizes are missing, estimate from typical door widths (about 80–90 cm) and say what you assumed. Leave out furniture drawn on the plan unless the person asks for it. If the drawing gives ceiling heights for rooms, set them with update_elements.
