# Architecture diagrams

These diagrams were authored from the server and web source with Archify JSON specifications and delivered as self-contained interactive HTML. The PNG and SVG exports are in [`../assets/`](../assets/).

| Diagram | Specification | Interactive HTML | PNG |
| --- | --- | --- | --- |
| System architecture | [JSON](system-architecture.json) | [HTML](system-architecture.html) | [PNG](../assets/system-architecture.png) |
| Run lifecycle | [JSON](run-lifecycle.json) | [HTML](run-lifecycle.html) | [PNG](../assets/run-lifecycle.png) |

Both specifications passed `archify validate <type> <spec> --quality showcase --json` on 15 November 2026: 9/9 checks, 0 composition errors, 0 warnings. Both delivered HTML files passed Archify's delivery validation at showcase quality. The system diagram passed desktop containment checks; the sequence diagram is intentionally tall and scrolls at smaller viewports, so its optional full-page containment visual check reported overflow. The exports preserve the entire sequence.
