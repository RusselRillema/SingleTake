# SingleTake controls

## Windows-oriented defaults

| Tool or command | Shortcut |
|---|---|
| Select / Lasso select | Space / Shift+Space |
| Line / Rectangle / Circle / 2-point arc | L / R / C / A |
| Push/Pull / Move / Rotate / Scale / Offset | P / M / Q / S / F |
| Tape measure / Paint / Eraser | T / B / E |
| Orbit / Pan / Zoom / Zoom extents | O / H / Z / Shift+Z |
| Make component / Back edges / Photo-reference views | G / K / I |
| Search / Help | Shift+S or Ctrl+K / F1 |
| New / Open / Import / Save / Save a copy | Ctrl+N / Ctrl+O / Ctrl+I / Ctrl+S / Ctrl+Shift+S |
| Undo / Redo | Ctrl+Z / Ctrl+Shift+Z or Ctrl+Y |
| Select all / Clear selection | Ctrl+A / Ctrl+T |
| Cut / Copy / Paste / Paste in place | Ctrl+X / Ctrl+C / Ctrl+V / Ctrl+Shift+V |
| Group / Explode / Duplicate | Ctrl+G / Ctrl+Shift+G / Ctrl+D |
| Cancel operation or close editing context | Escape |
| Delete selected geometry | Delete |

Browser and operating-system shortcuts may be intercepted before a page receives them, especially Ctrl+N and Ctrl+T. Search exposes corresponding commands. Save downloads a native project; it does not overwrite the original file. I opens locally authored photo-reference views, not automatic camera calibration.

## Mouse navigation

Middle-drag temporarily orbits without changing the active drawing tool. Hold Shift, or hold left and middle buttons together, to pan. O/H/Z activate persistent navigation tools. Scroll zooms at the cursor, with a face anchor when available. Double middle-click recenters the camera. Ctrl or Alt during orbit enables free orbit. Shift-drag with Zoom changes field of view. Previous/next camera views are available through Search.

## Connected selection

A single click selects a raw face or edge. Soft-connected faces act as a surface. Double-clicking a face adds its boundary; double-clicking an edge adds adjacent faces. Triple-click selects the connected island, not disconnected geometry in the same mesh allocation.

Outside a container, its visible parts select as one object. Double-click enters the container. The breadcrumb and faded surroundings identify the editing context. Escape closes one context when no operation is pending. Groups duplicate with independent raw geometry; components share resources. Structural edits in an active component definition propagate to its other placements. Make unique detaches resources.

Ctrl adds to selection, Shift toggles, and Ctrl+Shift removes. A left-to-right window requires containment; right-to-left selects crossing entities. Lasso uses clockwise crossing and counterclockwise containment. Tags do not split connected geometry or create containers.

## Inference and precision

Visible endpoints, midpoints, edge projections, circular centers, face centers, guides and the origin are searched across the scene, not just on the hit face. Hidden folders/entities are excluded. CPU ray intersections reject obscured candidates.

Right arrow locks red X, left arrow green Y, and up arrow blue Z. Press the same arrow again to release. Down arrow locks an acquired edge direction. Holding Shift retains the current direction or construction plane; releasing Shift or leaving the window releases the held constraint. Line also accepts Alt as a held-lock alias.

Numeric values accept meters, millimeters, centimeters, feet and inches. Line and Move accept absolute `[x,y,z]` and relative `<x,y,z>` coordinates. The modeling frame is right-handed and Z-up. Rendering uses a converted internal Y-up frame.

## Tool modifiers

Push/Pull follows the face's viewer-facing normal. Cursor movement along its projected normal pulls outward; opposite movement pushes inward. Looking directly along the normal uses upward screen motion as the fallback. Ctrl retains a starting face. Double-click repeats the last distance. A typed value after a completed operation revises it without adding another undo step. Collapsing caps are rejected; arbitrary through-hole cutting is not implemented.

Move and Rotate toggle copies with Ctrl. Enter `5x` after copying for five copies, or `5/` to divide the interval. Array edits are restricted to the immediately preceding copy operation. Rotate uses center, reference and final-angle clicks, and accepts degrees or rise:run slopes. Scale has corner/edge/face grips; Ctrl uses the center and Shift constrains proportions. Numeric dimensions and scale factors are supported.

Rectangle uses opposite corners; Ctrl or Alt toggles centered creation. Circle defaults to 24 segments; Arc defaults to 12. Enter `48s` to change segmentation before finishing. Arc uses endpoints and bulge, with an `r` suffix for numeric radius input.

Tape Measure uses Ctrl to toggle guides versus measurement-only. A subsequent distance can resize the active context/model after confirmation. A separate static dimension command saves labeled measurements. Eraser hides with Shift, softens with Ctrl, and unsoftens with Alt or Ctrl+Shift. Paint samples with Alt, fills connected matching faces with Ctrl, and replaces matching materials in the active context with Shift.

## Boundaries

Bindings are implemented, but this is not full feature equivalence to another application. General intersection/healing, exhaustive tangent inference, all arc modes, associative dimensions, automatic photo calibration and dynamic formulas remain outside this build. See `COMPATIBILITY.md`.
