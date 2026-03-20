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
from governance import analyze_governance


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


COMMANDS = {
    "scan": cmd_scan,
    "functions": cmd_functions,
    "trace": cmd_trace,
    "governance": cmd_governance,
    "graph": cmd_graph,
    "pipeline": cmd_pipeline,
    "filter": cmd_filter,
    "by_type": cmd_by_type,
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
