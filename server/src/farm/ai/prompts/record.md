Polish the recorded steps and YAML into exactly one Maestro flow at the requested output path.
Keep the user's action order and intent. Give the flow and meaningful steps clear Korean names.
Prefer stable unique selectors over coordinates when the workspace or recorded steps provide them.
Use reusable subflows only when their full contents confirm the intended behavior.
Add assertVisible checks and explicit waits where navigation suggests a new screen, using only
selectors supported by the recording or workspace. Do not invent element IDs or screen text.
If a useful assertion cannot be grounded in the available evidence, explain that in assumptions.
Return the normal files/summary/assumptions JSON result. Do not write any other file.
