<!-- knl-view:start -->
# Knowledge graph tools
- KNL-View is the primary graph tool. For `.knowledges`, source graphs, external module graphs, and project graph questions, read the project's `knl-view` skill and use the relevant KNL-View feature first.
- Graphify is the fallback. Use it only when a specific need remains unresolved by KNL-View or the user explicitly requests Graphify. If KNL-View answers the task, stop; do not run Graphify for duplicate analysis.
- When the user explicitly invokes `/graphify`, honor that request without automatically running both tools.

## KNL-View graph access
- Use the KNL-View feature that fits the task (`graph trace`, `sources trace/sync/collect`, `modules build-graph/trace/list`, `model check/new`, consensus commands, or the viewer). Do not approximate a supported KNL-View operation with ad-hoc graph queries.
- For third-party libraries and dependencies (`node_modules`, `go mod`, `site-packages`, `crates`): NEVER read raw library files directly. Build and query the module graph on-demand: run `knl-view modules build-graph <eco>::<module_name>` (e.g. `npm::express`, `go::github.com/gin-gonic/gin`), then inspect API definitions and call hierarchies via `knl-view modules trace <eco>::<module_name> [symbol]` to save context tokens.
- Route all graph reads and writes through KNL-View's documented CLI, viewer, or application endpoints. Never connect to AnchorDB directly through AnchorWire, its CLI, direct database endpoints, files, SQL, or custom clients/scripts. If KNL-View cannot perform a requested operation, explain the limitation; do not bypass it.
- Keep graph work targeted: specify the relevant node/path, direction, and smallest useful hop count; summarize only relevant nodes and edges; avoid dumping whole graphs or large raw JSON.
- Follow the KNL-View skill's trace-before-edit and `sources sync`-after-change rules. Treat edge direction as lineage; do not claim causality without separate evidence.
<!-- knl-view:end -->
