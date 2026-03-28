#!/usr/bin/env python3
"""
Resonant Genesis Code Visualizer - Local CLI

AST-based codebase analysis engine that runs entirely on the user's machine.
Called by the Resonant IDE extension (toolExecutor.ts) via:
    python3 cv_cli.py <command> <path> [extra_args...]

Commands:
    scan        - Full AST scan: services, functions, classes, endpoints, imports, pipelines, dead code
    functions   - List all functions and API endpoints
    trace       - Trace dependency flow from a node (query, max_depth)
    governance  - Architecture governance: reachability, forbidden deps, drift, health score
    graph       - Full dependency graph (nodes + connections)
    pipeline    - Get auto-detected pipeline flow (pipeline_name)
    filter      - Filter graph by file path, node type, or keyword
    by_type     - Get all nodes of a specific type

License: Resonant Genesis Source Available License (see LICENSE.txt)
Copyright (c) 2024-2026 Resonant Genesis / dev-swat.com
"""

import sys
import json
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from analyzer import CodebaseAnalyzer, analyze_codebase
from governance import analyze_governance, GovernanceEngine
from comparison_analyzer import compare_projects, MultiProjectComparator
from compiler import GraphPatchCompiler, CompilerConfig, CompilerInput, FormalInvariantChecker


def cmd_scan(path, _args):
    return analyze_codebase(path)


def cmd_functions(path, _args):
    data = analyze_codebase(path)
    functions = [
        n for n in data.get("nodes", [])
        if n.get("type") in ("function", "api_endpoint")
    ]
    return {
        "functions": functions,
        "total": len(functions),
        "endpoints": len([f for f in functions if f.get("type") == "api_endpoint"]),
    }


def cmd_trace(path, args):
    query = args[0] if args else "main"
    max_depth = int(args[1]) if len(args) > 1 else 10
    analyzer = CodebaseAnalyzer(path)
    analyzer.analyze()
    matches = []
    for node_id, node in analyzer.nodes.items():
        name = node.name.lower() if hasattr(node, "name") else ""
        if query.lower() in name or query.lower() in node_id.lower():
            matches.append(node_id)
    if not matches:
        return {"error": "No node matching '{}' found".format(query), "available_nodes": len(analyzer.nodes)}
    return analyzer.trace_execution(matches[0], max_depth)


def cmd_governance(path, args):
    drift_threshold = float(args[0]) if args else 20.0
    data = analyze_codebase(path)
    nodes_dict = {n["id"]: n for n in data.get("nodes", [])}
    connections = data.get("connections", [])
    return analyze_governance(
        nodes=nodes_dict,
        connections=connections,
        base_path=path,
        drift_threshold=drift_threshold,
    )


def cmd_graph(path, _args):
    return analyze_codebase(path)


def cmd_pipeline(path, args):
    pipeline_name = args[0] if args else ""
    analyzer = CodebaseAnalyzer(path)
    data = analyzer.analyze()
    if pipeline_name:
        return analyzer.filter_by_pipeline(pipeline_name)
    return {"pipelines": data.get("pipelines", {})}


def cmd_filter(path, args):
    data = analyze_codebase(path)
    nodes = data.get("nodes", [])
    file_path = None
    node_type = None
    keyword = None
    for arg in args:
        if arg.startswith("--file="):
            file_path = arg.split("=", 1)[1]
        elif arg.startswith("--type="):
            node_type = arg.split("=", 1)[1]
        elif arg.startswith("--keyword="):
            keyword = arg.split("=", 1)[1]
    filtered = nodes
    if file_path:
        filtered = [n for n in filtered if file_path in n.get("file_path", "")]
    if node_type:
        filtered = [n for n in filtered if n.get("type") == node_type]
    if keyword:
        kw = keyword.lower()
        filtered = [n for n in filtered if kw in n.get("name", "").lower() or kw in n.get("file_path", "").lower()]
    connections = [
        c for c in data.get("connections", [])
        if any(n["id"] in (c.get("source_id", ""), c.get("target_id", "")) for n in filtered)
    ]
    return {"nodes": filtered, "connections": connections, "total": len(filtered)}


def cmd_by_type(path, args):
    node_type = args[0] if args else "function"
    data = analyze_codebase(path)
    nodes = [n for n in data.get("nodes", []) if n.get("type") == node_type]
    return {"nodes": nodes, "type": node_type, "total": len(nodes)}


def cmd_compare(path, args):
    """Compare 2-3 projects: paths separated by commas, labels by commas.
    Usage: cv_cli.py compare /path1,/path2 label1,label2
    """
    paths = path.split(",")
    labels = args[0].split(",") if args else [f"project_{i}" for i in range(len(paths))]
    pairs = list(zip(paths, labels))
    return compare_projects(pairs)


def cmd_live_nodes(path, args):
    """Get all live (reachable) nodes from governance analysis."""
    drift_threshold = float(args[0]) if args else 20.0
    data = analyze_codebase(path)
    nodes_dict = {n["id"]: n for n in data.get("nodes", [])}
    connections = data.get("connections", [])
    engine = GovernanceEngine(drift_threshold=drift_threshold)
    engine.analyze(nodes_dict, connections, path)
    live = engine.get_live_nodes()
    return {"live_nodes": live, "total": len(live), "total_nodes": len(nodes_dict)}


def cmd_invalid_nodes(path, args):
    """Get all invalid/dead nodes from governance analysis."""
    drift_threshold = float(args[0]) if args else 20.0
    data = analyze_codebase(path)
    nodes_dict = {n["id"]: n for n in data.get("nodes", [])}
    connections = data.get("connections", [])
    engine = GovernanceEngine(drift_threshold=drift_threshold)
    engine.analyze(nodes_dict, connections, path)
    invalid = engine.get_invalid_nodes()
    return {"invalid_nodes": invalid, "total": len(invalid), "total_nodes": len(nodes_dict)}


def cmd_compile(path, args):
    """Compile a GAL action into a reversible patch artifact.
    Usage: cv_cli.py compile /path '{"action_type":"TAG_SUBGRAPH","target_node":"...","params":{"tag":"deprecated"}}'
    """
    if not args:
        return {"error": "GAL action JSON required as first argument"}
    try:
        gal_action = json.loads(args[0])
    except json.JSONDecodeError as e:
        return {"error": f"Invalid GAL action JSON: {e}"}
    data = analyze_codebase(path)
    compiler = GraphPatchCompiler(CompilerConfig())
    compiler_input = CompilerInput(
        gal_action=gal_action,
        graph_snapshot=data,
    )
    output = compiler.compile(compiler_input)
    return output.to_dict()


def cmd_verify_invariants(path, args):
    """Verify formal safety invariants on the current graph."""
    data = analyze_codebase(path)
    checker = FormalInvariantChecker()
    # Check invariants (before=after for current state verification)
    result = checker.check(data, data)
    result["invariants"] = checker.get_invariants()
    return result


def cmd_graph_janitor(path, args):
    """Graph Janitor Agent — autonomous scan for dead code, orphans, reachability."""
    max_proposals = int(args[0]) if args else 15
    drift_threshold = float(args[1]) if len(args) > 1 else 20.0

    data = analyze_codebase(path)
    nodes_list = data.get("nodes", [])
    nodes_dict = {n["id"]: n for n in nodes_list if isinstance(n, dict) and n.get("id")}
    connections = data.get("connections", [])

    engine = GovernanceEngine(drift_threshold=drift_threshold)
    report = engine.analyze(nodes_dict, connections, path)

    total_nodes = len(nodes_dict)
    # Extract metrics from report (may be object or dict)
    r = report if isinstance(report, dict) else {}
    if not isinstance(report, dict) and report is not None:
        r = {k: getattr(report, k, None) for k in ["live_nodes", "reachability_score", "drift_score", "violations"]}
    live_nodes = int(r.get("live_nodes") or 0)
    unreachable_nodes = max(total_nodes - live_nodes, 0)
    reachability_score = float(r.get("reachability_score") or 0.0)
    drift_score = float(r.get("drift_score") or 0.0)

    # Count isolated nodes and orphan endpoints
    connected = set()
    edge_counts = {}
    for c in connections:
        if not isinstance(c, dict):
            continue
        s, t = c.get("source_id", ""), c.get("target_id", "")
        if s:
            connected.add(s); edge_counts[s] = edge_counts.get(s, 0) + 1
        if t:
            connected.add(t); edge_counts[t] = edge_counts.get(t, 0) + 1
    isolated_nodes = max(total_nodes - len(connected), 0)
    orphan_endpoints = sum(1 for n in nodes_list if isinstance(n, dict) and n.get("type") == "api_endpoint" and edge_counts.get(n.get("id", ""), 0) == 0)

    health_score = max(0, min(100, int(round((reachability_score * 0.7) + ((100.0 - drift_score) * 0.3)))))
    if health_score >= 80:
        status, emoji = "healthy", "🟢"
    elif health_score >= 60:
        status, emoji = "warning", "🟡"
    else:
        status, emoji = "critical", "🔴"

    recs = []
    if unreachable_nodes > 0:
        recs.append("Review unreachable nodes and add justifications for valid dormant code.")
    if orphan_endpoints > 0:
        recs.append("Investigate orphan endpoints and reconnect or remove dead routes.")
    if drift_score > drift_threshold:
        recs.append("Architecture drift exceeds threshold; prioritize forbidden dependency cleanup.")
    if not recs:
        recs.append("Graph health is stable. Continue periodic governance scans.")

    # Build proposals from violations
    sev_risk = {"critical": 8.5, "high": 6.5, "medium": 4.0, "low": 2.0}
    violations = r.get("violations") or []
    proposals = []
    for idx, v in enumerate(violations[:max_proposals]):
        if isinstance(v, dict):
            sev = str(v.get("severity", "medium")).lower()
            nid = str(v.get("node_id", ""))
            msg = str(v.get("message", "Issue detected"))
            sug = str(v.get("suggestion", "Review node"))
            vtype = str(v.get("type", "")).lower()
        elif v is not None:
            sev = str(getattr(v, "severity", "medium") or "medium").lower()
            nid = str(getattr(v, "node_id", "") or "")
            msg = str(getattr(v, "message", "Issue detected") or "Issue detected")
            sug = str(getattr(v, "suggestion", "Review node") or "Review node")
            vtype = str(getattr(v, "type", "") or "").lower()
        else:
            continue
        pname = "TAG_DEAD"
        if "forbidden" in vtype:
            pname = "ISOLATE_DEPENDENCY"
        elif "isolated" in vtype:
            pname = "REVIEW_ORPHAN"
        proposals.append({"proposal": pname, "risk": sev_risk.get(sev, 4.0), "reason": msg, "expected_gain": sug, "root": nid})

    return {
        "agent": "Graph Janitor Agent (local)",
        "health_indicators": {"status": status, "status_emoji": emoji, "health_score": health_score, "recommendations": recs},
        "metrics": {"reachability_score": round(reachability_score, 1), "unreachable_nodes": unreachable_nodes, "isolated_nodes": isolated_nodes, "orphan_endpoints": orphan_endpoints, "total_nodes": total_nodes},
        "proposals": proposals,
    }


COMMANDS = {
    "scan": cmd_scan,
    "functions": cmd_functions,
    "trace": cmd_trace,
    "governance": cmd_governance,
    "graph": cmd_graph,
    "pipeline": cmd_pipeline,
    "filter": cmd_filter,
    "by_type": cmd_by_type,
    "compare": cmd_compare,
    "live_nodes": cmd_live_nodes,
    "invalid_nodes": cmd_invalid_nodes,
    "compile": cmd_compile,
    "verify_invariants": cmd_verify_invariants,
    "graph_janitor": cmd_graph_janitor,
}


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: cv_cli.py <command> <path> [args...]", "commands": list(COMMANDS.keys())}))
        sys.exit(1)

    command = sys.argv[1]
    path = sys.argv[2]
    extra_args = sys.argv[3:]

    if command not in COMMANDS:
        print(json.dumps({"error": "Unknown command: {}".format(command), "commands": list(COMMANDS.keys())}))
        sys.exit(1)

    if not os.path.exists(path):
        print(json.dumps({"error": "Path does not exist: {}".format(path)}))
        sys.exit(1)

    try:
        result = COMMANDS[command](path, extra_args)
        print(json.dumps(result, default=str))
    except Exception as e:
        print(json.dumps({"error": str(e), "command": command, "path": path}))
        sys.exit(1)


if __name__ == "__main__":
    main()
